#!/usr/bin/env node
// CLI Pilot (P0-P2 + pilot-v0.3 to pilot-v0.6): serves the page, proxies POST /chat to the `chat` role with
// streaming and per-role candidates/policies, appends lines to .pilot/transcript.jsonl,
// runs the deterministic growth controller (rules.json -> consent -> modules.json),
// runs the `extract` role in the background after each reply (proposals -> .pilot/state.json),
// handles commands via POST /command and answers via POST /answer, logs to .pilot/metrics.jsonl,
// watches .pilot/ (fs.watch, 150 ms debounce) and pushes {file, rev} to the page over SSE (GET /events).
// pilot-v0.6: authorship (item_write ledger in metrics.jsonl, hand edits shown as "you (file edit)"), the P5 metrics
// events (server_start, turn, controller_add with answerRef, index_jump via POST /metric) and /stats (stats.js).
// Node 20+, no dependencies. All paths resolve against this file's folder.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const stats = require('./stats.js');

const APP = __dirname;
const PUBLIC = path.join(APP, 'public');
const configPath = path.resolve(APP, process.env.PILOT_CONFIG || 'pilot.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
// PILOT_DIR (env, relative to pilot/app/) overrides config.pilotDir, e.g. PILOT_DIR=.pilot-demo for demos.
const PILOT = path.resolve(APP, process.env.PILOT_DIR || config.pilotDir || '.pilot');
const STALL_MS = Number(config.stallMs) || 20000;   // max gap between tokens once a reply has started
const TRANSCRIPT = path.join(PILOT, 'transcript.jsonl');
const METRICS = path.join(PILOT, 'metrics.jsonl');
const ROLES = path.join(PILOT, 'roles.json');      // /model pins: a role listed in `active` is pinned (see CHECKS.md)
const RULES = path.join(PILOT, 'rules.json');
const MODULES = path.join(PILOT, 'modules.json');
const STATE = path.join(PILOT, 'state.json');      // decisions, tasks, sources (proposed by the model or added by hand)
const EXTRACTION_SCHEMA = JSON.parse(fs.readFileSync(path.join(APP, 'schemas', 'extraction.schema.json'), 'utf8'));
const BUILT = ['index', 'map', 'kanban'];   // panes this build can show; the controller only evaluates their rules
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

function appendLine(role, text, model, kind) {
  const line = { id: 'm-' + crypto.randomUUID().slice(0, 8), ts: new Date().toISOString(), role, text, model: model || null };
  if (kind) line.kind = kind;   // optional on system lines: blocked | stall | error (the page colours them)
  return serial(() => appendJsonl(TRANSCRIPT, line));
}

function metric(event, fields) {
  return serial(() => appendJsonl(METRICS, { ts: new Date().toISOString(), event, ...fields }));
}

// metrics.jsonl parsed, cached by size/mtime/inode (authorship and pane info read it on every GET /state).
let metricsCache = { sig: null, events: [] };
function metricsEvents() {
  let st;
  try { st = fs.statSync(METRICS); } catch { return []; }
  const s = `${st.size}|${st.mtimeMs}|${st.ino}`;
  if (metricsCache.sig !== s) metricsCache = { sig: s, events: stats.readJsonl(METRICS) };
  return metricsCache.events;
}
const shortId = (p) => p + '-' + crypto.randomUUID().slice(0, 8);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

// Hand-editable JSON files (modules.json, roles.json): the last version that parsed is kept, so a broken hand edit
// never crashes the server and the page keeps showing the last good version. Writes never use it: while a file is
// broken the server refuses to write it (it is never overwritten). Returns {doc, error}; doc is null when the file
// is broken and nothing good was seen since the start.
const lastGood = {};
function readJsonGood(file, fallback) {
  const name = path.basename(file);
  try {
    const doc = readJson(file, fallback);
    lastGood[name] = doc;
    return { doc };
  } catch (e) {
    const error = e instanceof SyntaxError ? `${name} is not valid JSON: ${e.message}` : `${name}: ${e.message}`;
    return { doc: lastGood[name] === undefined ? null : lastGood[name], error };
  }
}

// ---- growth: deterministic controller over rules.json, consent answers in modules.json ----
const ANSWERS = { y: 'yes', n: 'no', a: 'always', x: 'never', yes: 'yes', no: 'no', always: 'always', never: 'never' };

// A broken modules.json reads as its last good version with `error` set; callers must not write it then.
function readModules() {
  const r = readJsonGood(MODULES, null);
  const m = r.doc && typeof r.doc === 'object' && !Array.isArray(r.doc) ? r.doc : {};
  const out = { rev: Number.isInteger(m.rev) ? m.rev : 0, panes: Array.isArray(m.panes) ? m.panes : [],
    answers: m.answers && typeof m.answers === 'object' ? m.answers : {}, pending: m.pending || null };
  if (r.error) out.error = r.error;
  return out;
}
function writeModules(m) { delete m.error; m.rev = (m.rev || 0) + 1; atomicWrite(MODULES, JSON.stringify(m, null, 2) + '\n'); lastGood['modules.json'] = m; }

// Visible panes: only those with a recorded yes/always answer (a hand-added pane without one stays hidden).
function visiblePanes(m) {
  return m.panes.map((p) => p.module).filter((mod, i, a) => a.indexOf(mod) === i && ['yes', 'always'].includes((m.answers[mod] || {}).answer));
}

// decisions/tasks/sources count proposed and confirmed items, not rejected ones (rules.example.json _notes).
function counts(lines, items = readState().items) {
  const live = (kind) => items.filter((i) => i.kind === kind && i.status !== 'rejected').length;
  return { messages: lines.filter((l) => l.role === 'user' || l.role === 'assistant').length,
    decisions: live('decision'), tasks: live('task'), sources: live('source') };
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
    if (m.error) { appendJsonl(METRICS, { ts: new Date().toISOString(), event: 'controller_error', error: m.error }); return; }
    if (m.pending) return;
    const c = counts(readTranscript());
    for (const rule of rules) {
      const n = c[rule.metric];
      if (typeof n !== 'number' || typeof rule.threshold !== 'number' || !ruleDue(rule, n, m)) continue;
      const ts = new Date().toISOString();
      const prior = m.answers[rule.module] || {};
      if (prior.answer === 'always') {   // consent already given for good
        m.panes.push({ module: rule.module, addedAt: ts, atCount: n, rule: { metric: rule.metric, threshold: rule.threshold } });
        writeModules(m);
        appendJsonl(TRANSCRIPT, { id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'controller', text: `${n} ${rule.metric}. Added the ${rule.module} pane (you said always).`, model: null, module: rule.module });
        appendJsonl(METRICS, { ts, event: 'controller_add', module: rule.module, count: n, answer: 'always', answerRef: prior.consentId || null, answerAt: prior.at || null });
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

// POST /answer {module, answer, rev?}: records the answer; yes/always add the pane. With `rev` (the modules.json rev
// the page last saw), a stale rev is rejected with 409 {stale: true}; without it the answer is accepted (curl, old checks).
function answer(module, raw, seenRev) {
  const ans = ANSWERS[String(raw || '').toLowerCase()];
  return serial(() => {
    if (!ans) return { code: 400, body: { error: 'answer must be y/n/a/x or yes/no/always/never' } };
    const m = readModules();
    if (m.error) return { code: 409, body: { error: `${m.error}; fix the file by hand first` } };
    if (seenRev !== undefined && seenRev !== m.rev) return stale('modules.json', seenRev, m.rev);
    if (!module || m.pending !== module) return { code: 409, body: { error: `no pending question for "${module}"`, pending: m.pending } };
    const ts = new Date().toISOString();
    // count = the rule's own metric (decisions for map, tasks for kanban), so "no" waits for that count to double
    let rule = {};
    try { rule = (readJson(RULES, { rules: [] }).rules || []).find((r) => r.module === module) || {}; } catch { /* keep messages */ }
    const metricName = rule.metric || 'messages';
    const c = counts(readTranscript());
    const n = typeof c[metricName] === 'number' ? c[metricName] : c.messages;
    // pilot-v0.6: the answer carries the id of its consent event; a pane added by it says which rule and which answer
    const consentId = shortId('c');
    m.answers[module] = { answer: ans, at: ts, count: n, consentId };
    const adds = (ans === 'yes' || ans === 'always') && !m.panes.some((p) => p.module === module);
    if (adds) m.panes.push({ module, addedAt: ts, atCount: n, rule: { metric: metricName, threshold: typeof rule.threshold === 'number' ? rule.threshold : null } });
    m.pending = null;
    writeModules(m);
    const effect = { yes: 'pane added', always: 'pane added; will not ask again', no: 'will ask again when the count has doubled', never: 'will never ask again' }[ans];
    appendJsonl(TRANSCRIPT, { id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'system', text: `${module}: ${ans}, ${effect}`, model: null });
    appendJsonl(METRICS, { ts, event: 'consent', id: consentId, module, answer: ans, count: n, metric: metricName });
    if (adds) appendJsonl(METRICS, { ts, event: 'controller_add', module, count: n, answer: ans, answerRef: consentId, answerAt: ts });
    return { code: 200, body: { ok: true, module, answer: ans } };
  });
}

// ---- model roles: candidates, policy, active choice (persisted in .pilot/roles.json) ----
const lastUsed = {};   // role -> candidate name that answered last (since server start)

function roleConfig(role) {
  const rc = (config.roles && config.roles[role]) || {};
  return { ...rc, policy: rc.policy || 'manual', candidates: rc.candidates || [] };
}

// The pinned candidate for a role, or null. An explicit `/model <role> <name>` pins; `/model <role> auto` unpins.
// A saved name that no longer exists in the config is ignored.
// A broken roles.json keeps its last good pins (losing a pin silently could send a private chat to the cloud).
function pinnedName(role) {
  const names = roleConfig(role).candidates.map((c) => c.name);
  const doc = readJsonGood(ROLES, {}).doc;
  const saved = doc && doc.active ? doc.active[role] : null;
  return names.includes(saved) ? saved : null;
}

function activeName(role) {
  return pinnedName(role) || (roleConfig(role).candidates[0] || {}).name || null;
}

// Candidates in the order they are tried: pinned or manual = the active one only;
// fallback = first candidate, then the rest in config order.
function attemptOrder(role) {
  const rc = roleConfig(role);
  const active = rc.candidates.find((c) => c.name === activeName(role));
  if (!active) return [];
  if (pinnedName(role)) return [active];
  return rc.policy === 'fallback' ? [active, ...rc.candidates.filter((c) => c !== active)] : [active];
}

function modelsSummary() {
  const out = {};
  for (const role of Object.keys(config.roles || {})) {
    const rc = roleConfig(role);
    out[role] = { policy: rc.policy || 'manual', active: activeName(role), pinned: !!pinnedName(role), last: lastUsed[role] || null,
      candidates: rc.candidates.map((c) => c.name), local: rc.candidates.filter((c) => c.local === true).map((c) => c.name),
      allowCloudFallback: rc.allowCloudFallback === true };
  }
  return out;
}

// One attempt against one candidate. Streams via onDelta; resolves with the full text.
// timeoutMs covers the wait for the first delta (a long healthy reply is not cut off);
// stallMs covers each gap between deltas after the first one (an endpoint that hangs mid-reply is cut off).
async function callCandidate(candidate, messages, onDelta, signal, extraBody) {
  const headers = { 'content-type': 'application/json' };
  if (candidate.keyEnv) {
    const key = process.env[candidate.keyEnv];
    if (!key) throw new Error(`environment variable ${candidate.keyEnv} is not set`);
    headers.authorization = `Bearer ${key}`;
  }
  const ms = candidate.timeoutMs || 60000;
  const firstByte = new AbortController();
  const timer = setTimeout(() => firstByte.abort(new Error(`no reply within ${ms} ms`)), ms);
  const stallMs = Number(candidate.stallMs) || STALL_MS;
  const stall = new AbortController();
  let stallTimer = null;
  const started = () => {
    clearTimeout(timer);
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { const e = new Error(`no new token for ${stallMs} ms`); e.stall = true; e.stallMs = stallMs; stall.abort(e); }, stallMs);
  };
  try {
    const res = await fetch(candidate.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers,
      body: JSON.stringify({ model: candidate.model, messages, stream: true, ...(extraBody ? extraBody(candidate) : {}) }),
      signal: AbortSignal.any([firstByte.signal, stall.signal, signal]),
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
    if (stall.signal.aborted && !signal.aborted) throw stall.signal.reason;
    if (firstByte.signal.aborted && !signal.aborted) throw firstByte.signal.reason;
    throw err;
  } finally { clearTimeout(timer); clearTimeout(stallTimer); }
}

// Runs a role per its policy. Falls back only while nothing has streamed yet, so a reply never mixes two models
// (a stall after the first token therefore never falls back). A pinned role never falls back. After a local
// candidate (`local: true`) failed, non-local candidates are skipped unless the role sets `allowCloudFallback: true`;
// a missing `local` counts as non-local. Resolves {text, candidate}; on failure throws with err.partial / err.candidate.
async function callRole(role, messages, onDelta, signal, extraBody) {
  const order = attemptOrder(role);
  const rc = roleConfig(role);
  if (!order.length) throw new Error(`no candidate configured for role "${role}"`);
  let streamed = '', lastErr, failedLocal = null;
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    if (lastErr && failedLocal && c.local !== true && rc.allowCloudFallback !== true) {
      await metric('fallback_blocked', { role, from: lastErr.candidate.name, to: c.name, reason: `${failedLocal.name} is local` });
      await appendLine('system', `fallback to ${c.name} blocked: ${failedLocal.name} is local`, null, 'blocked');
      continue;
    }
    if (lastErr) await metric('fallback', { role, from: lastErr.candidate.name, to: c.name, reason: lastErr.reason });
    const t0 = Date.now();
    try {
      const text = await callCandidate(c, messages, (d) => { streamed += d; onDelta(d); }, signal, extraBody);
      await metric('model_call', { role, candidate: c.name, model: c.model, ok: true, latencyMs: Date.now() - t0, chars: text.length });
      lastUsed[role] = c.name;
      return { text, candidate: c };
    } catch (err) {
      const msg = String((err && err.message) || err);
      await metric('model_call', { role, candidate: c.name, model: c.model, ok: false, latencyMs: Date.now() - t0, error: msg });
      if (err && err.stall) await metric('stall', { role, candidate: c.name, stallMs: err.stallMs, chars: streamed.length, latencyMs: Date.now() - t0 });
      lastErr = new Error(`${c.name}: ${msg}`);
      lastErr.candidate = c; lastErr.partial = streamed; lastErr.reason = msg; lastErr.stall = !!(err && err.stall);
      if (c.local === true) failedLocal = c;
      if (streamed || signal.aborted) break;
    }
  }
  if (lastErr && pinnedName(role) && rc.policy === 'fallback' && !streamed && !signal.aborted) lastErr.message += ` (${role} is pinned to ${lastErr.candidate.name}, no fallback; /model ${role} auto unpins)`;
  throw lastErr;
}

// ---- state.json: decisions, tasks, sources. Hand-editable; a broken file is reported, never overwritten ----
// readState() -> {doc, rev, items, error}: doc is the file as parsed (written back with every unknown field and
// item kept), items the usable view (objects with string id, kind, text).
// pilot-v0.5: a broken file reads as {doc: null, error} with rev/items of the last good version (for display and
// counts only; doc stays null so nothing is ever written over the broken file).
let lastGoodState = { rev: 0, items: [] };
function readState() {
  const broken = (error) => ({ doc: null, rev: lastGoodState.rev, items: lastGoodState.items, error });
  let raw;
  try { raw = fs.readFileSync(STATE, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') { lastGoodState = { rev: 0, items: [] }; return { doc: { rev: 0, items: [] }, rev: 0, items: [] }; }
    return broken(`state.json: ${e.message}`);
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { return broken(`state.json is not valid JSON: ${e.message}`); }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) return broken('state.json: expected {"rev": n, "items": [...]}');
  const items = doc.items.filter((i) => i && typeof i === 'object' && typeof i.id === 'string' && typeof i.kind === 'string' && typeof i.text === 'string');
  const rev = Number.isInteger(doc.rev) ? doc.rev : 0;
  lastGoodState = { rev, items };
  return { doc, rev, items };
}
function writeState(doc) { doc.rev = (Number.isInteger(doc.rev) ? doc.rev : 0) + 1; atomicWrite(STATE, JSON.stringify(doc, null, 2) + '\n'); return doc.rev; }

const PREFIX = { decision: 'dec', task: 'task', source: 'src' };
function nextId(doc, kind) {
  const re = new RegExp(`^${PREFIX[kind]}-(\\d+)$`);
  const max = doc.items.reduce((n, i) => { const m = re.exec(i && i.id); return m ? Math.max(n, Number(m[1])) : n; }, 0);
  return `${PREFIX[kind]}-${max + 1}`;
}

// ---- validation: a small hand validator for the subset of JSON Schema that extraction.schema.json uses ----
// (type, required, additionalProperties: false, properties, enum, minLength, maxLength, maxItems, items).
// Chosen over Ajv: no dependency, and the schema is closed and tiny. An unknown keyword fails loudly at startup.
const KNOWN = new Set(['$schema', 'title', 'description', 'type', 'required', 'additionalProperties', 'properties', 'enum', 'minLength', 'maxLength', 'maxItems', 'items']);
(function assertSupported(s) {
  for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`extraction.schema.json uses "${k}", which the hand validator does not support`);
  if (s.properties) Object.values(s.properties).forEach(assertSupported);
  if (s.items) assertSupported(s.items);
})(EXTRACTION_SCHEMA);
function validate(s, v, at = '$') {
  const errs = [];
  const type = Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;
  if (s.type && !(s.type === type || (s.type === 'number' && type === 'integer'))) return [`${at}: expected ${s.type}, got ${type}`];
  if (s.enum && !s.enum.includes(v)) errs.push(`${at}: must be one of ${s.enum.join(', ')}`);
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${at}: shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(`${at}: longer than ${s.maxLength}`);
  }
  if (type === 'object') {
    for (const r of s.required || []) if (!(r in v)) errs.push(`${at}: missing "${r}"`);
    for (const [k, val] of Object.entries(v)) {
      if (s.properties && s.properties[k]) errs.push(...validate(s.properties[k], val, `${at}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${at}: unexpected "${k}"`);
    }
  }
  if (type === 'array') {
    if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${at}: ${v.length} items, at most ${s.maxItems} allowed`);
    if (s.items) v.forEach((x, i) => errs.push(...validate(s.items, x, `${at}[${i}]`)));
  }
  return errs;
}

// Model output -> {items} or {error, reason}. A ```json fence around the object is tolerated; nothing else is.
function parseExtraction(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  let j;
  try { j = JSON.parse(t); } catch (e) { return { reason: 'malformed', error: `not JSON: ${e.message}` }; }
  const errs = validate(EXTRACTION_SCHEMA, j);
  return errs.length ? { reason: 'schema', error: errs.slice(0, 5).join('; ') } : { items: j.items };
}

// Quote rule: after collapsing whitespace and lowercasing, the quote must be a substring of the user or the
// assistant message of this turn; fromMessage is the id of the message it was found in.
const norm = (t) => String(t).replace(/\s+/g, ' ').trim().toLowerCase();
// Near-duplicate rule: lowercase, split on anything that is not a letter or digit, drop a few stopwords; two
// texts are near-duplicates when those word sets are equal or their Jaccard similarity is >= 0.75 (e.g.
// "Keep the claim local" vs "keep claim local!"). Compared across kinds, and two sources with the same url are
// duplicates. Compared against every non-rejected item in state.json and against earlier survivors of the batch.
const STOP = new Set('a an the to of and or we i you it is are be will for on in at this that with as by our so'.split(' '));
const words = (t) => new Set(String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)));
function similar(a, b) {
  if (a.url && b.url && a.url === b.url) return true;
  const A = words(a.text), B = words(b.text);
  if (!A.size || !B.size) return norm(a.text) === norm(b.text);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.75;
}

// ---- extraction: role `extract` after each complete reply, in the background, one run at a time ----
let extracting = 0;                    // queued + running extraction runs (GET /state reports extracting: true)
let extractChain = Promise.resolve();

function extractionMessages(userLine, replyLine, items, maxItems) {
  const existing = items.map((i) => `- ${i.id} (${i.kind}, ${i.status || 'confirmed'}): ${i.text}`).join('\n') || '(none)';
  return [
    { role: 'system', content: 'PILOT-EXTRACT v1\nYou propose decisions, tasks and sources from ONE conversation turn. Reply with JSON only: '
      + `{"items": [...]}, at most ${maxItems} items, each {"kind": "decision" | "task" | "source", "text": short title, "quote": words copied `
      + 'exactly from the turn}; sources also carry "url". Propose only what the turn clearly states. Skip anything already in the '
      + 'existing items. If nothing qualifies, reply {"items": []}.' },
    { role: 'user', content: `Existing items:\n${existing}\n\nLast user message:\n${userLine.text}\n\nLast assistant message:\n${replyLine.text}` },
  ];
}

function queueExtraction(userLine, replyLine) {
  const rc = roleConfig('extract');
  if (!rc.candidates.length) return;
  const every = Math.max(1, Number(rc.everyNTurns) || 1);
  const turns = readTranscript().filter((l) => l.role === 'assistant').length;
  if (turns % every !== 0) return;
  extracting++;
  if (extracting === 1) broadcast('status', { extracting: true });
  extractChain = extractChain.then(() => runExtraction(userLine, replyLine))
    .catch((err) => { console.error('extraction failed:', err); return metric('extract_error', { reason: 'internal', error: String(err.message || err) }); })
    .catch(() => {})
    .finally(() => { extracting--; if (!extracting) broadcast('status', { extracting: false }); });
}

async function runExtraction(userLine, replyLine) {
  const rc = roleConfig('extract');
  const schemaMax = EXTRACTION_SCHEMA.properties.items.maxItems;
  const maxItems = Math.max(1, Math.min(schemaMax, Number(rc.maxItems) || schemaMax));
  const before = readState();
  if (before.error) { await metric('extract_error', { reason: 'state', error: before.error, fromMessage: replyLine.id }); return; }
  const schema = JSON.parse(JSON.stringify(EXTRACTION_SCHEMA));
  schema.properties.items.maxItems = maxItems;
  delete schema.$schema;
  const structured = (c) => c.structured === true ? { response_format: { type: 'json_schema', json_schema: { name: 'pilot_extraction', schema } } } : {};
  const t0 = Date.now();
  let out;
  try { out = await callRole('extract', extractionMessages(userLine, replyLine, before.items, maxItems), () => {}, new AbortController().signal, structured); }
  catch (err) { await metric('extract_error', { reason: err.stall ? 'stall' : 'model', error: String(err.message || err), fromMessage: replyLine.id }); return; }
  const base = { candidate: out.candidate.name, model: out.candidate.model, fromMessage: replyLine.id };
  const parsed = parseExtraction(out.text);
  if (parsed.error) { await metric('extract_error', { ...base, reason: parsed.reason, error: parsed.error, chars: out.text.length }); return; }

  const turn = [[userLine.id, norm(userLine.text)], [replyLine.id, norm(replyLine.text)]];
  await serial(() => {
    const st = readState();   // fresh: the user may have decided or hand-edited meanwhile
    const ts = new Date().toISOString();
    const drop = (reason, it, extra = {}) => appendJsonl(METRICS, { ts, event: 'extract_drop', ...base, reason, kind: it.kind, text: it.text, ...extra });
    if (st.error) { appendJsonl(METRICS, { ts, event: 'extract_error', ...base, reason: 'state', error: st.error }); return; }
    const live = st.items.filter((i) => i.status !== 'rejected');
    const kept = [];
    for (const it of parsed.items) {
      const found = turn.find(([, t]) => t.includes(norm(it.quote)));
      if (!found) { drop('quote', it, { quote: it.quote }); continue; }
      const dup = live.find((i) => similar(i, it)) || kept.find((k) => similar(k, it));
      if (dup) { drop('duplicate', it, { of: dup.id || dup.text }); continue; }
      if (kept.length >= maxItems) { drop('maxItems', it); continue; }
      kept.push({ ...it, fromMessage: found[0] });
    }
    const ids = [];
    for (const it of kept) {
      const item = { id: nextId(st.doc, it.kind), kind: it.kind, text: it.text, status: 'proposed', author: 'model', model: out.candidate.name,
        quote: it.quote, fromMessage: it.fromMessage, createdAt: ts };
      if (it.kind === 'task') item.column = 'todo';
      if (it.url !== undefined) item.url = it.url;
      st.doc.items.push(item);
      ids.push(item.id);
    }
    const rev = ids.length ? writeState(st.doc) : st.rev;
    for (const id of ids) itemWrite(st.doc.items.find((i) => i.id === id), 'extract', null, ts);
    appendJsonl(METRICS, { ts, event: 'extract', ...base, returned: parsed.items.length, proposed: ids.length,
      dropped: parsed.items.length - ids.length, ids, rev, latencyMs: Date.now() - t0 });
  });
  await runController();   // new proposals may cross a map/kanban threshold
}

// pilot-v0.6: the server's write ledger. Every item the server creates or decides is logged as `item_write` with a
// copy of the item as written (see stats.js provenance). Hand edits made before this write stay attributed: their
// fields go along as handFields (except the ones this write sets), an item that came in through the file keeps
// addedByFile. Call inside the write chain, right after writeState.
function itemWrite(item, via, before, ts) {
  const set = via === 'decide' ? ['status', 'decidedAt', 'decidedBy'] : [];
  const handFields = before ? before.fields.filter((f) => !set.includes(f)) : [];
  const e = { ts, event: 'item_write', via, itemId: item.id, item: JSON.parse(JSON.stringify(item)) };
  if (handFields.length) e.handFields = handFields;
  if (before && before.added) e.addedByFile = true;
  appendJsonl(METRICS, e);
  noteItems();   // the server's own write is the new baseline for file-edit detection
}

// File-edit detection (pilot-v0.6): on every state.json change the watcher compares each item with the ledger; when
// the set of hand-edited fields of an item changes, a `file_edit` event is logged (informational: the page and /stats
// derive authorship from the ledger and the file, so edits made while the server was down are shown too).
let provSeen = null;   // id -> JSON of the last provenance seen
function noteItems(log) {
  const st = readState();
  if (st.error) return [];
  const led = stats.ledgerOf(metricsEvents());
  const now = new Map(st.items.map((i) => [i.id, JSON.stringify(stats.provenance(i, led.get(i.id)))]));
  const out = [];
  if (provSeen && log) {
    for (const [id, p] of now) if (provSeen.get(id) !== p && p !== 'null') out.push({ itemId: id, ...JSON.parse(p) });
    for (const id of provSeen.keys()) if (!now.has(id) && led.has(id)) out.push({ itemId: id, removed: true });
  }
  provSeen = now;
  return out;
}
function onStateFileChange() {
  serial(() => {
    const ts = new Date().toISOString();
    for (const e of noteItems(true)) appendJsonl(METRICS, { ts, event: 'file_edit', file: 'state.json', ...e });
  }).catch((err) => console.error('file_edit:', err.message));
}

// A write from the page carried a rev that is no longer the file's: 409 with stale: true; the page reloads state.
function stale(file, sent, current) {
  return { code: 409, body: { error: `${file} changed since this page last saw it (rev ${sent}, now ${current}); reloaded, try again`, stale: true, file, rev: current } };
}

// POST /answer {itemId, decision, rev?}: confirm or reject a proposed item; records decidedAt and decidedBy: "user".
// `rev` = the state.json rev the page last saw (optional; a stale one is rejected with 409 {stale: true}).
const DECISIONS = { c: 'confirmed', confirm: 'confirmed', confirmed: 'confirmed', r: 'rejected', reject: 'rejected', rejected: 'rejected' };
function decide(itemId, raw, seenRev) {
  const status = DECISIONS[String(raw || '').toLowerCase()];
  return serial(() => {
    if (!status) return { code: 400, body: { error: 'decision must be c/r or confirm/reject' } };
    const st = readState();
    if (st.error) return { code: 409, body: { error: `${st.error}; fix the file by hand first` } };
    if (seenRev !== undefined && seenRev !== st.rev) return stale('state.json', seenRev, st.rev);
    const item = st.doc.items.find((i) => i && i.id === itemId);
    if (!item) return { code: 404, body: { error: `no item "${itemId}"` } };
    if (item.status !== 'proposed') return { code: 409, body: { error: `${itemId} is ${item.status || 'not a proposal'}, only proposed items can be decided` } };
    const ts = new Date().toISOString();
    const before = stats.provenance(item, stats.ledgerOf(metricsEvents()).get(itemId));   // hand edits so far
    item.status = status; item.decidedAt = ts; item.decidedBy = 'user';
    const rev = writeState(st.doc);
    itemWrite(item, 'decide', before, ts);
    appendJsonl(TRANSCRIPT, { id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'system', text: `${itemId} ${status}: ${item.text}`, model: null });
    appendJsonl(METRICS, { ts, event: 'decide', itemId, kind: item.kind, decision: status, decidedBy: 'user', author: item.author || null, model: item.model || null, rev });
    return { code: 200, body: { ok: true, item, rev } };
  });
}

// ---- live files (pilot-v0.5): fs.watch on the pilot dir -> SSE {file, rev} ----
// fs.watch filenames are only a hint (macOS coalesces events, editors save by rename, the name can be null), so any
// event (debounced 150 ms) re-stats every file in the dir and pushes one `change` event per file whose mtime, size
// or inode changed, own writes and hand edits alike. The server's own temp files (.<name>.<pid>.<ts>.tmp) and other
// dotfiles are ignored. rev: JSON files -> their `rev` field (null while the file is not valid JSON, 0 when it is
// missing or has none); JSONL files -> the number of non-empty lines (so a hand edit that keeps the count keeps the
// rev, but is still pushed).
const DEBOUNCE_MS = 150;
const clients = new Set();   // open GET /events responses
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
function fileRev(name) {
  const file = path.join(PILOT, name);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { rev: 0, missing: true }; }
  if (name.endsWith('.jsonl')) return { rev: raw.split('\n').filter((l) => l.trim()).length };
  if (!name.endsWith('.json')) return { rev: null };
  try {
    const j = JSON.parse(raw);
    if (name === 'modules.json' || name === 'roles.json') lastGood[name] = j;   // keep the last good version fresh
    return { rev: j && Number.isInteger(j.rev) ? j.rev : 0 };
  }
  catch (e) { return { rev: null, error: `${name} is not valid JSON: ${e.message}` }; }
}
const watched = (name) => !!name && !name.startsWith('.') && !name.endsWith('.tmp') && !name.endsWith('~');
const sig = (st) => `${st.mtimeMs}|${st.size}|${st.ino}`;
function snapshot() {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(PILOT); } catch { return out; }
  for (const n of names) {
    if (!watched(n)) continue;
    try { const st = fs.statSync(path.join(PILOT, n)); if (st.isFile()) out.set(n, sig(st)); } catch { /* gone meanwhile */ }
  }
  return out;
}
let known = snapshot();
let debounce = null;
function scan() {
  debounce = null;
  try {
    const now = snapshot();
    const changed = [...now.keys()].filter((n) => known.get(n) !== now.get(n));
    for (const n of known.keys()) if (!now.has(n)) changed.push(n);
    known = now;
    for (const file of changed.sort()) broadcast('change', { file, ...fileRev(file) });
    if (changed.includes('state.json')) onStateFileChange();
  } catch (err) { console.error('watch:', err.message); }
}
function startWatch() {
  try {
    const w = fs.watch(PILOT, () => { clearTimeout(debounce); debounce = setTimeout(scan, DEBOUNCE_MS); });
    w.on('error', (err) => { console.error(`watch ${path.relative(APP, PILOT)}/ stopped: ${err.message}`); w.close(); setTimeout(startWatch, 1000).unref(); });
  } catch (err) { console.error(`cannot watch ${path.relative(APP, PILOT)}/: ${err.message}`); setTimeout(startWatch, 1000).unref(); }
}
startWatch();

// GET /events: Server-Sent Events (D7). First a `hello` with the current revs, then `change` {file, rev[, error]}
// per changed file and `status` {extracting} when background extraction starts or ends. A comment every 15 s keeps
// proxies and the connection alive; EventSource reconnects by itself (retry 1000 ms).
function handleEvents(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const revs = {};
  for (const n of known.keys()) revs[n] = fileRev(n).rev;
  res.write(`retry: 1000\nevent: hello\ndata: ${JSON.stringify({ revs, extracting: extracting > 0 })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

// GET /state[?only=transcript.jsonl,state.json,modules.json,roles.json]: everything, or only the parts that belong to
// the named files (the page reloads only what changed). extracting and fileErrors are always included.
function statePayload(only) {
  const want = (f) => !only || only.includes(f);
  const out = { extracting: extracting > 0 };
  if (want('transcript.jsonl')) { const lines = readTranscript(); out.transcript = lines.slice(-TAIL); out.total = lines.length; }
  if (want('modules.json') || want('roles.json')) out.models = modelsSummary();
  let m = null, st = null;
  if (want('modules.json')) {
    m = readModules();
    let rules = [];
    try { rules = readJson(RULES, { rules: [] }).rules || []; } catch { /* broken rules.json: rule from the pane entry only */ }
    Object.assign(out, { panes: visiblePanes(m), pending: m.pending, answers: m.answers, modulesRev: m.rev, paneInfo: stats.paneInfo(m, rules, metricsEvents()) });
  }
  // items carry `prov` ({added, fields}) when a part of them came from a hand edit (pilot-v0.6, see stats.js)
  if (want('state.json')) { st = readState(); Object.assign(out, { items: stats.withProvenance(st.items, metricsEvents()), stateRev: st.rev, stateError: st.error || null }); }
  // a broken hand-editable file: the page says "file X is not valid JSON, showing last good version" until fixed
  const fileErrors = {};
  for (const [f, e] of [['state.json', (st || readState()).error], ['modules.json', (m || readModules()).error], ['roles.json', readJsonGood(ROLES, {}).error]]) if (e) fileErrors[f] = e;
  out.fileErrors = fileErrors;
  return out;
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

  const userLine = await appendLine('user', text, null);
  const history = readTranscript().filter((l) => l.role === 'user' || l.role === 'assistant').slice(-HISTORY)
    .map((l) => ({ role: l.role, content: l.text }));

  // no-cache, not no-store: Chrome reports a streamed no-store body read by a reader as net::ERR_ABORTED.
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });

  let replyLine = null;
  try {
    const { text: reply, candidate } = await callRole('chat', history, (d) => res.write(d), abort.signal);
    replyLine = await appendLine('assistant', reply, candidate.name);
  } catch (err) {
    // Keep whatever arrived before the failure, then record the failure as a system line.
    if (err.partial) await appendLine('assistant', err.partial, err.candidate && err.candidate.name);
    const msg = err.stall ? `reply stalled: ${err.message}; kept the partial reply, no fallback` : `chat failed: ${err.message || err}`;
    await appendLine('system', msg, null, err.stall ? 'stall' : 'error');
    console.error(msg);
    if (!res.writableEnded) res.write(`\n[${msg}]`);
  }
  await runController();
  const after = readTranscript();
  await metric('turn', { ok: !!replyLine, lines: after.length, messages: after.filter((l) => l.role === 'user' || l.role === 'assistant').length });
  // Extraction only after a complete reply (not after a failure or a stall), queued before res.end() so
  // GET /state already reports it as running, and never awaited here: it cannot delay the chat reply.
  if (replyLine) queueExtraction(userLine, replyLine);
  res.end();
}

// ---- commands: never sent to a model, never counted as messages ----
const HELP = [
  '/model                     show roles, policies and candidates',
  '/model <role> <candidate>  pin a role to a candidate: no fallback (kept across restarts)',
  '/model <role> auto         unpin: back to the role policy, starting at the first candidate',
  '/rules                     rules from .pilot/rules.json with current counts',
  '/panes                     panes and your answers',
  '/stats                     the five P5 measures (04-build-plan.md) from metrics.jsonl and the files, PASS / NOT YET',
  '/theme light|dark|auto     colour theme of this page (kept in this browser only)',
  '/help                      this list',
];

async function runCommand(input) {
  const [cmd, ...args] = input.trim().split(/\s+/);
  if (cmd === '/help') return { ok: true, lines: HELP };
  if (cmd === '/theme') return { ok: true, lines: ['/theme is handled in the page (it changes only this browser)'] };
  if (cmd === '/model') {
    const summary = modelsSummary();
    if (!args.length) {
      return { ok: true, lines: Object.entries(summary).map(([role, m]) =>
        `${role}: ${m.active || 'none'} (${m.pinned ? 'pinned' : m.policy})  candidates: ${m.candidates.map((n) => m.local.includes(n) ? `${n} [local]` : n).join(', ') || 'none'}`) };
    }
    const [role, name] = args;
    if (!summary[role]) return { ok: false, lines: [`unknown role "${role}". Roles: ${Object.keys(summary).join(', ')}`] };
    if (name === 'auto') {
      await serial(() => {
        const saved = readJson(ROLES, { rev: 0, active: {} });
        saved.rev = (saved.rev || 0) + 1;
        saved.active = { ...saved.active };
        delete saved.active[role];
        atomicWrite(ROLES, JSON.stringify(saved, null, 2) + '\n');
        lastGood['roles.json'] = saved;
      });
      delete lastUsed[role];
      const first = activeName(role);
      await appendLine('system', `model for ${role} unpinned: ${summary[role].policy} policy, starting at ${first || 'none'}`, null);
      await metric('model_unpin', { role, candidate: first });
      return { ok: true, lines: [`${role} follows its ${summary[role].policy} policy again, starting at ${first || 'none'}`] };
    }
    if (!summary[role].candidates.includes(name)) return { ok: false, lines: [`unknown candidate "${name}" for ${role}. Candidates: ${summary[role].candidates.join(', ') || 'none'}`] };
    await serial(() => {
      const saved = readJson(ROLES, { rev: 0, active: {} });
      saved.rev = (saved.rev || 0) + 1;
      saved.active = { ...saved.active, [role]: name };
      atomicWrite(ROLES, JSON.stringify(saved, null, 2) + '\n');
      lastGood['roles.json'] = saved;
    });
    delete lastUsed[role];
    await appendLine('system', `model for ${role} switched to ${name} (pinned)`, null);
    await metric('model_switch', { role, candidate: name, pinned: true });
    return { ok: true, lines: [`${role} now uses ${name} (pinned: no fallback until /model ${role} auto)`] };
  }
  if (cmd === '/rules') {
    let rules;
    try { rules = readJson(RULES, { rules: [] }).rules || []; } catch (err) { return { ok: false, lines: [`rules.json is not valid JSON: ${err.message}`] }; }
    const c = counts(readTranscript()), m = readModules();
    return { ok: true, lines: rules.map((r) => {
      const ans = m.answers[r.module];
      const state = m.panes.some((p) => p.module === r.module) ? 'pane shown' : m.pending === r.module ? 'asking now'
        : ans ? `answered ${ans.answer} at ${ans.count}` : BUILT.includes(r.module) ? 'not asked yet' : 'not built yet';
      return `${r.module}: ${r.metric} ${c[r.metric]} / ${r.threshold}  (${state})`;
    }) };
  }
  if (cmd === '/stats') return { ok: true, lines: stats.formatStats(stats.computeStats(PILOT), `${path.relative(APP, PILOT)}/`) };
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
    const { pathname, searchParams } = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && pathname === '/state') {
      const only = searchParams.has('only') ? searchParams.get('only').split(',').filter(Boolean) : null;
      return sendJson(res, 200, statePayload(only));
    }
    if (req.method === 'GET' && pathname === '/events') return handleEvents(req, res);
    if (req.method === 'POST' && pathname === '/answer') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'expected JSON {module, answer} or {itemId, decision}' }); }
      const rev = body && body.rev !== undefined && body.rev !== null ? body.rev : undefined;   // optional: the rev the page last saw
      const out = body && body.itemId !== undefined ? await decide(body.itemId, body.decision, rev) : await answer(body && body.module, body && body.answer, rev);
      return sendJson(res, out.code, out.body);
    }
    // pilot-v0.6: the page reports index jumps (Usefulness). Only this one event, with a message id that exists.
    if (req.method === 'POST' && pathname === '/metric') {
      let body;
      try { body = JSON.parse(await readBody(req, 2000)); } catch { return sendJson(res, 400, { error: 'expected JSON {event: "index_jump", target}' }); }
      if (!body || body.event !== 'index_jump') return sendJson(res, 400, { error: 'only {event: "index_jump", target} is accepted' });
      const target = typeof body.target === 'string' ? body.target : '';
      const lines = readTranscript();
      const at = lines.findIndex((l) => l.id === target);
      if (at < 0) return sendJson(res, 400, { error: `no message "${target}"` });
      await metric('index_jump', { target, position: at + 1, of: lines.length });
      return sendJson(res, 200, { ok: true });
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
  // pilot-v0.6: continuity. Counts at start, compared by /stats with the previous run's last turn.
  const lines = readTranscript(), m = readModules(), st = readState();
  metric('server_start', { pid: process.pid, lines: lines.length, messages: lines.filter((l) => l.role === 'user' || l.role === 'assistant').length,
    items: st.items.length, panes: visiblePanes(m).length, answers: Object.keys(m.answers).length,
    fileErrors: [m.error, st.error].filter(Boolean) }).catch((err) => console.error('server_start:', err.message));
  noteItems();   // baseline for file-edit detection (edits made while the server was down show via the ledger)
  console.log(`CLI Pilot on http://${HOST}:${PORT}  (config: ${path.relative(APP, configPath)}, data: ${path.relative(APP, PILOT)}/)`);
});
