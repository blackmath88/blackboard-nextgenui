#!/usr/bin/env node
// CLI Pilot v1 (P0-P2): serves the page, proxies POST /chat to the `chat` role with
// streaming and per-role candidates/policies, appends lines to .pilot/transcript.jsonl,
// runs the deterministic growth controller (rules.json -> consent -> modules.json),
// handles commands via POST /command and answers via POST /answer, logs to .pilot/metrics.jsonl.
// Node 20+, no dependencies. All paths resolve against this file's folder.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP = __dirname;
const PUBLIC = path.join(APP, 'public');
const configPath = path.resolve(APP, process.env.PILOT_CONFIG || 'pilot.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PILOT = path.resolve(APP, config.pilotDir || '.pilot');
const TRANSCRIPT = path.join(PILOT, 'transcript.jsonl');
const METRICS = path.join(PILOT, 'metrics.jsonl');
const ROLES = path.join(PILOT, 'roles.json');      // persisted /model choices (see CHECKS.md)
const RULES = path.join(PILOT, 'rules.json');
const MODULES = path.join(PILOT, 'modules.json');
const BUILT = ['index'];   // panes this build can show; the controller only evaluates their rules
const PORT = Number(config.port) || 4747;
const HOST = '127.0.0.1';
const TAIL = 500;      // lines returned by GET /state
const HISTORY = 40;    // user/assistant lines sent to the model

if (path.relative(APP, PILOT).startsWith('..')) throw new Error(`pilotDir must stay inside ${APP}`);
fs.mkdirSync(PILOT, { recursive: true });
if (!fs.existsSync(RULES)) atomicWrite(RULES, fs.readFileSync(path.join(APP, 'rules.example.json')));

// ---- .pilot/ files: atomic writes (temp file in .pilot/, then rename), serialized ----
let writeChain = Promise.resolve();
function serial(fn) { const p = writeChain.then(fn); writeChain = p.catch(() => {}); return p; }

function atomicWrite(file, data) {
  const tmp = path.join(PILOT, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readTranscript() {
  let raw = '';
  try { raw = fs.readFileSync(TRANSCRIPT, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const lines = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { lines.push(JSON.parse(l)); } catch { /* skip a broken hand-edited line */ }
  }
  return lines;
}

function appendJsonl(file, obj) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (raw && !raw.endsWith('\n')) raw += '\n';
  atomicWrite(file, raw + JSON.stringify(obj) + '\n');
  return obj;
}

function appendLine(role, text, model) {
  return serial(() => appendJsonl(TRANSCRIPT, { id: 'm-' + crypto.randomUUID().slice(0, 8), ts: new Date().toISOString(), role, text, model: model || null }));
}

function metric(event, fields) {
  return serial(() => appendJsonl(METRICS, { ts: new Date().toISOString(), event, ...fields }));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

// ---- growth: deterministic controller over rules.json, consent answers in modules.json ----
const ANSWERS = { y: 'yes', n: 'no', a: 'always', x: 'never', yes: 'yes', no: 'no', always: 'always', never: 'never' };

function readModules() {
  const m = readJson(MODULES, null) || {};
  return { rev: m.rev || 0, panes: m.panes || [], answers: m.answers || {}, pending: m.pending || null };
}
function writeModules(m) { m.rev = (m.rev || 0) + 1; atomicWrite(MODULES, JSON.stringify(m, null, 2) + '\n'); }

// Visible panes: only those with a recorded yes/always answer (a hand-added pane without one stays hidden).
function visiblePanes(m) {
  return m.panes.map((p) => p.module).filter((mod, i, a) => a.indexOf(mod) === i && ['yes', 'always'].includes((m.answers[mod] || {}).answer));
}

function counts(lines) {
  return { messages: lines.filter((l) => l.role === 'user' || l.role === 'assistant').length, decisions: 0, tasks: 0, sources: 0 };  // items arrive in P3
}

// When a rule may ask: count >= threshold, not answered never, and after "no" only once the count has doubled.
function ruleDue(rule, n, m) {
  if (!BUILT.includes(rule.module) || m.panes.some((p) => p.module === rule.module)) return false;
  const ans = m.answers[rule.module];
  if (ans && ans.answer === 'never') return false;
  const need = ans && ans.answer === 'no' ? Math.max(rule.threshold, 2 * ans.count) : rule.threshold;
  return n >= need;
}

// Runs after every turn, inside the write chain. Reads rules.json fresh each time. At most one question at a time.
function runController() {
  return serial(() => {
    let rules;
    try { rules = readJson(RULES, { rules: [] }).rules || []; }
    catch (err) { appendJsonl(METRICS, { ts: new Date().toISOString(), event: 'controller_error', error: `rules.json: ${err.message}` }); return; }
    const m = readModules();
    if (m.pending) return;
    const c = counts(readTranscript());
    for (const rule of rules) {
      const n = c[rule.metric];
      if (typeof n !== 'number' || typeof rule.threshold !== 'number' || !ruleDue(rule, n, m)) continue;
      const ts = new Date().toISOString();
      if ((m.answers[rule.module] || {}).answer === 'always') {   // consent already given for good
        m.panes.push({ module: rule.module, addedAt: ts, atCount: n });
        writeModules(m);
        appendJsonl(TRANSCRIPT, { id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'controller', text: `${n} ${rule.metric}. Added the ${rule.module} pane (you said always).`, model: null, module: rule.module });
        appendJsonl(METRICS, { ts, event: 'controller_add', module: rule.module, count: n, answer: 'always' });
        return;
      }
      const text = String(rule.ask || `Add the ${rule.module} pane?`).replace('{n}', n);
      appendJsonl(TRANSCRIPT, { id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'controller', text, model: null, module: rule.module });
      m.pending = rule.module;
      writeModules(m);
      appendJsonl(METRICS, { ts, event: 'controller_ask', module: rule.module, metric: rule.metric, count: n, threshold: rule.threshold });
      return;
    }
  });
}

// POST /answer {module, answer}: records the answer; yes/always add the pane.
function answer(module, raw) {
  const ans = ANSWERS[String(raw || '').toLowerCase()];
  return serial(() => {
    if (!ans) return { code: 400, body: { error: 'answer must be y/n/a/x or yes/no/always/never' } };
    const m = readModules();
    if (!module || m.pending !== module) return { code: 409, body: { error: `no pending question for "${module}"`, pending: m.pending } };
    const ts = new Date().toISOString();
    const n = counts(readTranscript()).messages;
    m.answers[module] = { answer: ans, at: ts, count: n };
    if ((ans === 'yes' || ans === 'always') && !m.panes.some((p) => p.module === module)) m.panes.push({ module, addedAt: ts, atCount: n });
    m.pending = null;
    writeModules(m);
    const effect = { yes: 'pane added', always: 'pane added; will not ask again', no: 'will ask again when the count has doubled', never: 'will never ask again' }[ans];
    appendJsonl(TRANSCRIPT, { id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'system', text: `${module}: ${ans}, ${effect}`, model: null });
    appendJsonl(METRICS, { ts, event: 'consent', module, answer: ans, count: n });
    return { code: 200, body: { ok: true, module, answer: ans } };
  });
}

// ---- model roles: candidates, policy, active choice (persisted in .pilot/roles.json) ----
const lastUsed = {};   // role -> candidate name that answered last (since server start)

function roleConfig(role) {
  const rc = (config.roles && config.roles[role]) || {};
  return { ...rc, policy: rc.policy || 'manual', candidates: rc.candidates || [] };
}

function activeName(role) {
  const names = roleConfig(role).candidates.map((c) => c.name);
  let saved;
  try { saved = (readJson(ROLES, {}).active || {})[role]; } catch { saved = null; }
  return names.includes(saved) ? saved : (names[0] || null);
}

// Candidates in the order they are tried: manual = the active one only; fallback = active first, then the rest in config order.
function attemptOrder(role) {
  const rc = roleConfig(role);
  const active = rc.candidates.find((c) => c.name === activeName(role));
  if (!active) return [];
  return rc.policy === 'fallback' ? [active, ...rc.candidates.filter((c) => c !== active)] : [active];
}

function modelsSummary() {
  const out = {};
  for (const role of Object.keys(config.roles || {})) {
    const rc = roleConfig(role);
    out[role] = { policy: rc.policy || 'manual', active: activeName(role), last: lastUsed[role] || null, candidates: rc.candidates.map((c) => c.name) };
  }
  return out;
}

// One attempt against one candidate. Streams via onDelta; resolves with the full text.
// timeoutMs covers the wait for the first delta (a long healthy reply is not cut off).
async function callCandidate(candidate, messages, onDelta, signal) {
  const headers = { 'content-type': 'application/json' };
  if (candidate.keyEnv) {
    const key = process.env[candidate.keyEnv];
    if (!key) throw new Error(`environment variable ${candidate.keyEnv} is not set`);
    headers.authorization = `Bearer ${key}`;
  }
  const ms = candidate.timeoutMs || 60000;
  const firstByte = new AbortController();
  const timer = setTimeout(() => firstByte.abort(new Error(`no reply within ${ms} ms`)), ms);
  const started = () => clearTimeout(timer);
  try {
    const res = await fetch(candidate.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers,
      body: JSON.stringify({ model: candidate.model, messages, stream: true }),
      signal: AbortSignal.any([firstByte.signal, signal]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

    let full = '';
    if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {   // endpoint ignored stream:true
      const body = await res.json();
      started();
      full = (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
      if (full) onDelta(full);
      return full;
    }
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return full;
        let delta = '';
        try { const j = JSON.parse(data); delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''; } catch { continue; }
        if (delta) { started(); full += delta; onDelta(delta); }
      }
    }
    return full;
  } catch (err) {
    if (firstByte.signal.aborted && !signal.aborted) throw firstByte.signal.reason;
    throw err;
  } finally { clearTimeout(timer); }
}

// Runs a role per its policy. Falls back only while nothing has streamed yet, so a reply never mixes two models.
// Resolves {text, candidate}; on failure throws with err.partial / err.candidate set.
async function callRole(role, messages, onDelta, signal) {
  const order = attemptOrder(role);
  if (!order.length) throw new Error(`no candidate configured for role "${role}"`);
  let streamed = '', lastErr;
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const t0 = Date.now();
    try {
      const text = await callCandidate(c, messages, (d) => { streamed += d; onDelta(d); }, signal);
      await metric('model_call', { role, candidate: c.name, model: c.model, ok: true, latencyMs: Date.now() - t0, chars: text.length });
      lastUsed[role] = c.name;
      return { text, candidate: c };
    } catch (err) {
      const msg = String((err && err.message) || err);
      await metric('model_call', { role, candidate: c.name, model: c.model, ok: false, latencyMs: Date.now() - t0, error: msg });
      lastErr = new Error(`${c.name}: ${msg}`);
      lastErr.candidate = c; lastErr.partial = streamed;
      if (streamed || signal.aborted || i === order.length - 1) break;
      await metric('fallback', { role, from: c.name, to: order[i + 1].name, reason: msg });
    }
  }
  throw lastErr;
}

// ---- HTTP ----
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (path.relative(PUBLIC, file).startsWith('..') || path.isAbsolute(path.relative(PUBLIC, file))) return sendJson(res, 404, { error: 'not found' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

async function handleChat(req, res) {
  let text;
  try { text = String(JSON.parse(await readBody(req)).text || '').trim(); } catch { return sendJson(res, 400, { error: 'expected JSON {text}' }); }
  if (!text) return sendJson(res, 400, { error: 'empty message' });

  await appendLine('user', text, null);
  const history = readTranscript().filter((l) => l.role === 'user' || l.role === 'assistant').slice(-HISTORY)
    .map((l) => ({ role: l.role, content: l.text }));

  // no-cache, not no-store: Chrome reports a streamed no-store body read by a reader as net::ERR_ABORTED.
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });

  try {
    const { text: reply, candidate } = await callRole('chat', history, (d) => res.write(d), abort.signal);
    await appendLine('assistant', reply, candidate.name);
  } catch (err) {
    // Keep whatever arrived before the failure, then record the failure as a system line.
    if (err.partial) await appendLine('assistant', err.partial, err.candidate && err.candidate.name);
    const msg = `chat failed: ${err.message || err}`;
    await appendLine('system', msg, null);
    console.error(msg);
    if (!res.writableEnded) res.write(`\n[${msg}]`);
  }
  await runController();
  res.end();
}

// ---- commands: never sent to a model, never counted as messages ----
const HELP = [
  '/model                     show roles, policies and candidates',
  '/model <role> <candidate>  switch the model for a role (kept across restarts)',
  '/rules                     rules from .pilot/rules.json with current counts',
  '/panes                     panes and your answers',
  '/help                      this list',
];

async function runCommand(input) {
  const [cmd, ...args] = input.trim().split(/\s+/);
  if (cmd === '/help') return { ok: true, lines: HELP };
  if (cmd === '/model') {
    const summary = modelsSummary();
    if (!args.length) {
      return { ok: true, lines: Object.entries(summary).map(([role, m]) =>
        `${role}: ${m.active || 'none'} (${m.policy})  candidates: ${m.candidates.join(', ') || 'none'}`) };
    }
    const [role, name] = args;
    if (!summary[role]) return { ok: false, lines: [`unknown role "${role}". Roles: ${Object.keys(summary).join(', ')}`] };
    if (!summary[role].candidates.includes(name)) return { ok: false, lines: [`unknown candidate "${name}" for ${role}. Candidates: ${summary[role].candidates.join(', ') || 'none'}`] };
    await serial(() => {
      const saved = readJson(ROLES, { rev: 0, active: {} });
      saved.rev = (saved.rev || 0) + 1;
      saved.active = { ...saved.active, [role]: name };
      atomicWrite(ROLES, JSON.stringify(saved, null, 2) + '\n');
    });
    delete lastUsed[role];
    await appendLine('system', `model for ${role} switched to ${name}`, null);
    await metric('model_switch', { role, candidate: name });
    return { ok: true, lines: [`${role} now uses ${name} (${summary[role].policy})`] };
  }
  if (cmd === '/rules') {
    let rules;
    try { rules = readJson(RULES, { rules: [] }).rules || []; } catch (err) { return { ok: false, lines: [`rules.json is not valid JSON: ${err.message}`] }; }
    const c = counts(readTranscript()), m = readModules();
    return { ok: true, lines: rules.map((r) => {
      const ans = m.answers[r.module];
      const state = m.panes.some((p) => p.module === r.module) ? 'pane shown' : m.pending === r.module ? 'asking now'
        : ans ? `answered ${ans.answer} at ${ans.count}` : BUILT.includes(r.module) ? 'not asked yet' : 'not built yet (P3)';
      return `${r.module}: ${r.metric} ${c[r.metric]} / ${r.threshold}  (${state})`;
    }) };
  }
  if (cmd === '/panes') {
    const m = readModules();
    const lines = ['chat (always)', ...m.panes.map((p) => `${p.module} added ${p.addedAt} at ${p.atCount} messages`)];
    for (const [mod, a] of Object.entries(m.answers)) lines.push(`answer ${mod}: ${a.answer} (${a.at}, count ${a.count})`);
    if (m.pending) lines.push(`pending question: ${m.pending}`);
    return { ok: true, lines };
  }
  return { ok: false, lines: [`unknown command "${cmd}". Try /help`] };
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && pathname === '/state') {
      const lines = readTranscript();
      const m = readModules();
      return sendJson(res, 200, { transcript: lines.slice(-TAIL), total: lines.length, models: modelsSummary(),
        panes: visiblePanes(m), pending: m.pending, answers: m.answers });
    }
    if (req.method === 'POST' && pathname === '/answer') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'expected JSON {module, answer}' }); }
      const out = await answer(body.module, body.answer);
      return sendJson(res, out.code, out.body);
    }
    if (req.method === 'POST' && pathname === '/command') {
      let text;
      try { text = String(JSON.parse(await readBody(req)).text || ''); } catch { return sendJson(res, 400, { ok: false, lines: ['expected JSON {text}'] }); }
      const out = await runCommand(text);
      return sendJson(res, out.ok ? 200 : 400, out);
    }
    if (req.method === 'POST' && pathname === '/chat') return await handleChat(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CLI Pilot on http://${HOST}:${PORT}  (config: ${path.relative(APP, configPath)}, data: ${path.relative(APP, PILOT)}/)`);
});
