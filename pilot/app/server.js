#!/usr/bin/env node
// CLI Pilot (P0-P2 + pilot-v0.3 to pilot-v0.6): serves the page, proxies POST /chat to the `chat` role with
// streaming and per-role candidates/policies, appends lines to .pilot/transcript.jsonl,
// runs the deterministic growth controller (rules.json -> consent -> modules.json),
// runs the `extract` role in the background after each reply (proposals -> .pilot/state.json),
// handles commands via POST /command and answers via POST /answer, logs to .pilot/metrics.jsonl,
// watches .pilot/ (fs.watch, 150 ms debounce) and pushes {file, rev} to the page over SSE (GET /events).
// pilot-v0.6: authorship (item_write ledger in metrics.jsonl, hand edits shown as "you (file edit)"), the P5 metrics
// events (server_start, turn, controller_add with answerRef, index_jump via POST /metric) and /stats (stats.js).
// pilot-v0.7: /why explains the current panes and items from the files only, every statement with its source (why.js).
// pilot-v0.8: panes can go. A pane nobody touched for fadeAfterTurns turns fades to a tab (modules.json state "faded",
// never deleted); a touch (POST /touch, or a decision on one of its cards) brings it back. After askRemoveAfterTurns
// more turns as a tab the controller asks once whether to remove it; only a recorded yes/never removes it (fade.js).
// pilot-v0.9: experiment "settled input" behind a flag (experiments.settledInput in the config, or /flag settled-input
// on|off, kept in .pilot/flags.json; default off). The page proposes "send?" after a pause on a finished-looking input
// (public/settle.js) and reports settle_offer / settle_accept / settle_ignore / enter_send via POST /metric.
// pilot-v0.10: frame proposals behind a flag (experiments.frameProposals, /flag frame-proposals on|off; default off).
// After a turn the `frame` role may return a FrameIntent (schemas/frame-intent.schema.json, checked by frame.js): how a
// shown map or kanban presents its cards. It is kept as a proposal in .pilot/frames.json; only you apply it (f in that
// pane, POST /frame) or dismiss it; /frame reset undoes an applied one. It never touches modules.json or state.json.
// Node 20+, no dependencies. All paths resolve against this file's folder.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const stats = require('./stats.js');
const why = require('./why.js');
const fade = require('./fade.js');
const frame = require('./frame.js');

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
const FLAGS = path.join(PILOT, 'flags.json');      // pilot-v0.9: /flag overrides of config.experiments (hand-editable)
const FRAMES = path.join(PILOT, 'frames.json');    // pilot-v0.10: frame proposals and applied frames (hand-editable)
const CHATS = path.join(PILOT, 'chats.json');      // pilot-ui: the chats of this project (hand-editable); lines carry `chat`
const DEFAULT_CHAT = 'c-1';                         // lines written before chats existed belong to the first chat
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

// pilot-ui: several chats share one board. Every transcript line names its chat; user and assistant lines get the chat
// they were sent in, controller and system lines the chat you were last in (the last message or chat switch).
let currentChat = DEFAULT_CHAT;
const chatOf = (l) => (l && typeof l.chat === 'string' && l.chat) || DEFAULT_CHAT;
function appendTranscript(line) { if (!line.chat) line.chat = currentChat; return appendJsonl(TRANSCRIPT, line); }

function appendLine(role, text, model, kind, chat) {
  const line = { id: 'm-' + crypto.randomUUID().slice(0, 8), ts: new Date().toISOString(), role, text, model: model || null };
  if (kind) line.kind = kind;   // optional on system lines: blocked | stall | error (the page colours them)
  line.chat = chat || currentChat;
  return serial(() => appendTranscript(line));
}

// chats.json {rev, chats: [{id, title?, createdAt}]}. The list in /state also has every chat id found in the transcript
// (the first chat exists implicitly), with its message count, last activity and a title: the stored one, else the first
// sentence of its first message. A broken chats.json reads as its last good version and is never written.
function readChats() {
  const r = readJsonGood(CHATS, { rev: 0, chats: [] });
  const doc = r.doc && typeof r.doc === 'object' && Array.isArray(r.doc.chats) ? r.doc : { rev: 0, chats: [] };
  return { doc, rev: Number.isInteger(doc.rev) ? doc.rev : 0, chats: doc.chats.filter((c) => c && typeof c.id === 'string'), error: r.error };
}
const shortTitle = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]; return s.length > 48 ? s.slice(0, 45) + '…' : s; };
function chatsSummary(lines) {
  const stored = readChats().chats;
  const by = new Map();
  const add = (id, c = {}) => { if (!by.has(id)) by.set(id, { id, title: null, createdAt: null, messages: 0, lastTs: null, first: null }); Object.assign(by.get(id), c); };
  add(DEFAULT_CHAT);
  for (const c of stored) add(c.id, { title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : null, createdAt: c.createdAt || null });
  for (const l of lines) {
    if (l.role !== 'user' && l.role !== 'assistant') continue;
    const id = chatOf(l); add(id);
    const c = by.get(id);
    if (l.role === 'user') { c.messages++; if (!c.first) c.first = l.text; }
    c.lastTs = l.ts || c.lastTs; if (!c.createdAt) c.createdAt = l.ts || null;
  }
  return [...by.values()].map(({ first, ...c }) => ({ ...c, title: c.title || shortTitle(first) || 'new chat', named: !!c.title }));
}
// The lines of one chat, plus the latest controller question still pending (wherever it was asked), in file order.
function chatTail(lines, chat) {
  const m = readModules();
  const remove = m.pendingKind === 'remove';
  let q = -1;
  if (m.pending) lines.forEach((l, i) => { if (l.role === 'controller' && l.module === m.pending && (l.question === 'remove') === remove) q = i; });
  return lines.filter((l, i) => chatOf(l) === chat || i === q);
}
// Which chat a message is in (for "show m-…" links to another chat); null when there is no such message.
function chatOfMessage(id) { const l = readTranscript().find((x) => x.id === id); return l ? chatOf(l) : null; }
const chatExists = (id) => typeof id === 'string' && chatsSummary(readTranscript()).some((c) => c.id === id);

// POST /chats {action: "new", title?} | {action: "open", id} | {action: "rename", id, title}
function chatAction(body) {
  const action = body && body.action;
  return serial(() => {
    const r = readChats();
    if (action === 'find') {
      const c = typeof body.msg === 'string' ? chatOfMessage(body.msg) : null;
      return c ? { code: 200, body: { ok: true, chat: c } } : { code: 404, body: { error: `no message "${body.msg}"` } };
    }
    if (action === 'open') {
      if (!chatExists(body.id)) return { code: 404, body: { error: `no chat "${body.id}"` } };
      currentChat = body.id;
      return { code: 200, body: { ok: true, chat: body.id } };
    }
    if (action !== 'new' && action !== 'rename') return { code: 400, body: { error: 'action must be new, open, rename or find' } };
    if (r.error) return { code: 409, body: { error: `${r.error}; fix the file by hand first` } };
    const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const doc = { ...r.doc, chats: r.chats.slice() };
    let id;
    if (action === 'new') {
      const used = new Set(chatsSummary(readTranscript()).map((c) => c.id));
      let n = used.size + 1; while (used.has(`c-${n}`)) n++;
      id = `c-${n}`;
      doc.chats.push({ id, ...(title ? { title } : {}), createdAt: new Date().toISOString() });
      currentChat = id;
    } else {
      id = body.id;
      if (!chatExists(id)) return { code: 404, body: { error: `no chat "${id}"` } };
      const c = doc.chats.find((x) => x.id === id);
      if (c) { if (title) c.title = title; else delete c.title; }
      else doc.chats.push({ id, ...(title ? { title } : {}), createdAt: new Date().toISOString() });
    }
    doc.rev = r.rev + 1;
    atomicWrite(CHATS, JSON.stringify(doc, null, 2) + '\n'); lastGood['chats.json'] = JSON.parse(JSON.stringify(doc));
    appendJsonl(METRICS, { ts: new Date().toISOString(), event: action === 'new' ? 'chat_new' : 'chat_rename', chat: id });
    return { code: 200, body: { ok: true, chat: id, rev: doc.rev } };
  });
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

// ---- pilot-v0.9: experiment flags. config.experiments gives the default (missing = off); .pilot/flags.json, written by
// /flag and hand-editable, overrides it. A broken flags.json reads as its last good version and is never written. ----
const EXPERIMENTS = config.experiments && typeof config.experiments === 'object' ? config.experiments : {};
const SETTLE_MS = Math.min(10000, Math.max(300, Number(EXPERIMENTS.settleMs) || 1800));   // pause before the offer
const FLAG_NAMES = { 'settled-input': 'settledInput', 'frame-proposals': 'frameProposals' };   // pilot-v0.10: frame-proposals
function readFlags() {
  const r = readJsonGood(FLAGS, null);
  const d = r.doc && typeof r.doc === 'object' && !Array.isArray(r.doc) ? r.doc : {};
  const exp = d.experiments && typeof d.experiments === 'object' && !Array.isArray(d.experiments) ? d.experiments : {};
  const out = { rev: Number.isInteger(d.rev) ? d.rev : 0, experiments: exp };
  if (r.error) out.error = r.error;
  return out;
}
// One flag: [value, source]; source names where the value comes from (flags.json, the config, or the default).
function flagValue(f, key) {
  let v = false, source = 'default (off)';
  if (typeof EXPERIMENTS[key] === 'boolean') { v = EXPERIMENTS[key]; source = `${path.relative(APP, configPath)} experiments.${key}`; }
  if (typeof f.experiments[key] === 'boolean') { v = f.experiments[key]; source = `${path.relative(APP, PILOT)}/flags.json (/flag)`; }
  return [v, source];
}
// -> {settledInput, settleMs, source, frameProposals, frameSource, rev}: `source` stays the settled-input source (v0.9)
function flagsSummary() {
  const f = readFlags();
  const [settledInput, source] = flagValue(f, 'settledInput');
  const [frameProposals, frameSource] = flagValue(f, 'frameProposals');
  return { settledInput, settleMs: SETTLE_MS, source, frameProposals, frameSource, rev: f.rev };
}

// ---- growth: deterministic controller over rules.json, consent answers in modules.json ----
const ANSWERS = { y: 'yes', n: 'no', a: 'always', x: 'never', yes: 'yes', no: 'no', always: 'always', never: 'never' };
const lineId = () => 'm-' + crypto.randomUUID().slice(0, 8);

// A broken modules.json reads as its last good version with `error` set; callers must not write it then.
function readModules() {
  const r = readJsonGood(MODULES, null);
  const m = r.doc && typeof r.doc === 'object' && !Array.isArray(r.doc) ? r.doc : {};
  const out = { rev: Number.isInteger(m.rev) ? m.rev : 0, panes: Array.isArray(m.panes) ? m.panes : [],
    answers: m.answers && typeof m.answers === 'object' ? m.answers : {}, pending: m.pending || null };
  // pilot-v0.8: removal answers are kept apart from the growth answers (answers.<module> stays the growth consent);
  // pendingKind "remove" marks the pending question as the removal question (missing = a growth question)
  out.removals = m.removals && typeof m.removals === 'object' && !Array.isArray(m.removals) ? m.removals : {};
  if (m.pendingKind === 'remove' && out.pending) out.pendingKind = 'remove';
  if (r.error) out.error = r.error;
  return out;
}
function writeModules(m) {
  delete m.error; if (!m.pending) delete m.pendingKind;
  m.rev = (m.rev || 0) + 1;
  // pilot-v0.8: an empty removals map is not written (files without removals stay as they were); m keeps it
  const out = m.removals && !Object.keys(m.removals).length ? { ...m, removals: undefined } : m;
  atomicWrite(MODULES, JSON.stringify(out, null, 2) + '\n'); lastGood['modules.json'] = JSON.parse(JSON.stringify(out));
}

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
// pilot-v0.8: after a removal (yes) the rule asks again, never re-adds through an old "always", and only once its count
// has doubled since the removal (like after "no"); after removal "never" it never asks again.
function ruleDue(rule, n, m) {
  if (!BUILT.includes(rule.module) || m.panes.some((p) => p.module === rule.module)) return false;
  const ans = m.answers[rule.module];
  if (ans && ans.answer === 'never') return false;
  const rem = removedSince(m, rule.module);
  if (rem && rem.answer === 'never') return false;
  if (rem) return n >= Math.max(rule.threshold, 2 * (rem.count || 0));
  const need = ans && ans.answer === 'no' ? Math.max(rule.threshold, 2 * ans.count) : rule.threshold;
  return n >= need;
}
// The removal answer that removed a module's pane, if the pane has not come back since (removal yes/never).
function removedSince(m, mod) {
  const rem = m.removals[mod];
  if (!rem || !['yes', 'never'].includes(rem.answer)) return null;
  const ans = m.answers[mod];
  return ans && Date.parse(ans.at) > Date.parse(rem.at) ? null : rem;
}

// Runs after every turn, inside the write chain. Reads rules.json fresh each time. At most one question at a time.
function runController() {
  return serial(() => {
    let rulesDoc;
    try { rulesDoc = readJson(RULES, { rules: [] }) || {}; }
    catch (err) { appendJsonl(METRICS, { ts: new Date().toISOString(), event: 'controller_error', error: `rules.json: ${err.message}` }); return; }
    const rules = Array.isArray(rulesDoc.rules) ? rulesDoc.rules : [];
    const m = readModules();
    if (m.error) { appendJsonl(METRICS, { ts: new Date().toISOString(), event: 'controller_error', error: m.error }); return; }
    const lines = readTranscript();
    // pilot-v0.8: fading is not a question, so it runs before the one-question-at-a-time check
    if (runFades(m, rulesDoc, lines)) writeModules(m);
    if (m.pending) return;
    const c = counts(lines);
    for (const rule of rules) {
      const n = c[rule.metric];
      if (typeof n !== 'number' || typeof rule.threshold !== 'number' || !ruleDue(rule, n, m)) continue;
      const ts = new Date().toISOString();
      const prior = m.answers[rule.module] || {};
      if (prior.answer === 'always' && !removedSince(m, rule.module)) {   // consent already given for good (not after a removal)
        m.panes.push({ module: rule.module, addedAt: ts, atCount: n, rule: { metric: rule.metric, threshold: rule.threshold }, lastTouch: { at: ts, turn: fade.turnOf(lines), how: 'added' } });
        writeModules(m);
        appendTranscript({ id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'controller', text: `${n} ${rule.metric}. Added the ${rule.module} pane (you said always).`, model: null, module: rule.module });
        appendJsonl(METRICS, { ts, event: 'controller_add', module: rule.module, count: n, answer: 'always', answerRef: prior.consentId || null, answerAt: prior.at || null });
        return;
      }
      const text = String(rule.ask || `Add the ${rule.module} pane?`).replace('{n}', n);
      appendTranscript({ id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'controller', text, model: null, module: rule.module });
      m.pending = rule.module;
      writeModules(m);
      appendJsonl(METRICS, { ts, event: 'controller_ask', module: rule.module, metric: rule.metric, count: n, threshold: rule.threshold });
      return;
    }
    askRemoval(m, rulesDoc, lines);
  });
}

// ---- pilot-v0.8: panes can go (fade.js has the rules; these functions write) ----
// Fades every shown pane that is due (untouched for fadeAfterTurns turns, holding no proposal) and brings back a faded
// pane that holds a proposal (a faded pane must not hide a decision; that is not a touch). Mutates m, returns whether
// it changed; the caller writes modules.json. Inside the write chain.
function runFades(m, rulesDoc, lines) {
  const turn = fade.turnOf(lines);
  const items = readState().items;
  let changed = false;
  for (const entry of m.panes) {
    if (!entry || !BUILT.includes(entry.module) || !visiblePanes(m).includes(entry.module)) continue;
    const st = fade.status(entry, { lines, turn, rulesDoc, items });
    const ts = new Date().toISOString();
    if (st.fadeDue) {
      entry.state = 'faded'; entry.fadedAt = ts; entry.fadedTurn = turn;
      changed = true;
      appendTranscript({ id: lineId(), ts, role: 'controller', text: `${entry.module} pane faded to a tab: untouched for ${st.idle} turns (fadeAfterTurns ${st.fadeAfter}). Click the tab to bring it back.`, model: null, pane: entry.module, event: 'fade' });
      appendJsonl(METRICS, { ts, event: 'pane_fade', module: entry.module, turn, idle: st.idle, fadeAfterTurns: st.fadeAfter, lastTouchTurn: st.lastTouch.turn, lastTouchRecorded: st.lastTouch.recorded });
    } else if (st.faded && st.holds.length) {
      unfade(entry);
      changed = true;
      appendTranscript({ id: lineId(), ts, role: 'controller', text: `${entry.module} pane is back: it holds a proposal (${st.holds.join(', ')}), and a tab must not hide a decision.`, model: null, pane: entry.module, event: 'unfade' });
      appendJsonl(METRICS, { ts, event: 'pane_unfade', module: entry.module, turn, reason: 'proposal', holds: st.holds });
      withdrawRemoval(m, entry.module, 'it holds a proposal', ts);
    }
  }
  return changed;
}
function unfade(entry) { delete entry.state; delete entry.fadedAt; delete entry.fadedTurn; }

// Asks the removal question for the first faded pane that is due (once per pane). Inside the write chain, m.pending empty.
function askRemoval(m, rulesDoc, lines) {
  const turn = fade.turnOf(lines);
  const items = readState().items;
  for (const entry of m.panes) {
    if (!entry || !BUILT.includes(entry.module)) continue;
    const st = fade.status(entry, { lines, turn, rulesDoc, items });
    if (!st.removeDue) continue;
    const ts = new Date().toISOString();
    entry.removalAsked = true;
    m.pending = entry.module; m.pendingKind = 'remove';
    writeModules(m);
    appendTranscript({ id: lineId(), ts, role: 'controller', text: `The ${entry.module} pane has been a tab for ${st.fadedFor} turns. Remove the ${entry.module} pane? (y removes it, the rule may offer it again later; n keeps the tab; x removes it for good)`, model: null, module: entry.module, question: 'remove' });
    appendJsonl(METRICS, { ts, event: 'controller_ask', question: 'remove', module: entry.module, turn, fadedFor: st.fadedFor, askRemoveAfterTurns: st.askRemoveAfter, fadedTurn: st.fadedTurn });
    return;
  }
}

// A touch while the removal question for that pane is open withdraws the question (you are using the pane). A
// withdrawn question does not count as asked: looking at a pane is not an answer, so the question can come again
// once the pane has faded again and stayed a tab for askRemoveAfterTurns turns. Mutates m; inside the write chain.
function withdrawRemoval(m, mod, why, ts) {
  if (m.pending !== mod || m.pendingKind !== 'remove') return false;
  m.pending = null; delete m.pendingKind;
  const entry = m.panes.find((p) => p && p.module === mod);
  if (entry) delete entry.removalAsked;
  appendTranscript({ id: lineId(), ts, role: 'system', text: `remove ${mod}: question withdrawn, ${why}`, model: null });
  appendJsonl(METRICS, { ts, event: 'controller_withdraw', question: 'remove', module: mod, reason: why });
  return true;
}

// Records a touch on a pane: lastTouch moves to this turn; a faded pane comes back. Only the first touch of a pane in
// a turn is written and logged (a later one in the same turn changes nothing, so it is not written: no rev bump, no
// event). Mutates m and returns {changed, unfaded}; the caller writes. Inside the write chain.
function applyTouch(m, mod, how, ts, turn) {
  const entry = m.panes.find((p) => p && p.module === mod);
  if (!entry) return { changed: false };
  const was = entry.lastTouch;
  const faded = fade.isFaded(entry);
  if (!faded && was && was.turn === turn) return { changed: false };
  entry.lastTouch = { at: ts, turn, how };
  if (faded) unfade(entry);
  appendJsonl(METRICS, { ts, event: 'pane_touch', module: mod, how, turn, ...(faded ? { unfaded: true } : {}) });
  withdrawRemoval(m, mod, 'you used the pane', ts);
  return { changed: true, unfaded: faded };
}

// POST /touch {module, how}: the page reports an interaction with a pane (see CHECKS.md # pilot-v0.8 for the list).
// No rev: a touch never conflicts with anything. Returns {ok, changed, unfaded, rev}.
function touch(mod, how) {
  return serial(() => {
    if (mod === 'chat') return { code: 400, body: { error: 'the chat pane never fades, it needs no touch' } };
    if (!fade.TOUCH_HOWS.includes(how)) return { code: 400, body: { error: `how must be one of ${fade.TOUCH_HOWS.join(', ')}` } };
    const m = readModules();
    if (m.error) return { code: 409, body: { error: `${m.error}; fix the file by hand first` } };
    if (!visiblePanes(m).includes(mod)) return { code: 404, body: { error: `no pane "${mod}" shown` } };
    const r = applyTouch(m, mod, how, new Date().toISOString(), fade.turnOf(readTranscript()));
    if (r.changed) writeModules(m);
    return { code: 200, body: { ok: true, module: mod, changed: r.changed, unfaded: !!r.unfaded, rev: m.rev } };
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
    if (m.pendingKind === 'remove') return answerRemoval(m, module, ans);
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
    // pilot-v0.8: being added counts as the first touch (the fade count starts here)
    if (adds) m.panes.push({ module, addedAt: ts, atCount: n, rule: { metric: metricName, threshold: typeof rule.threshold === 'number' ? rule.threshold : null }, lastTouch: { at: ts, turn: fade.turnOf(readTranscript()), how: 'added' } });
    m.pending = null;
    writeModules(m);
    const effect = { yes: 'pane added', always: 'pane added; will not ask again', no: 'will ask again when the count has doubled', never: 'will never ask again' }[ans];
    appendTranscript({ id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'system', text: `${module}: ${ans}, ${effect}`, model: null });
    appendJsonl(METRICS, { ts, event: 'consent', id: consentId, module, answer: ans, count: n, metric: metricName });
    if (adds) appendJsonl(METRICS, { ts, event: 'controller_add', module, count: n, answer: ans, answerRef: consentId, answerAt: ts });
    return { code: 200, body: { ok: true, module, answer: ans } };
  });
}

// pilot-v0.8: the answer to "remove the <module> pane?". yes: the pane entry is removed (its rule may offer it again,
// see ruleDue); no: it stays a tab and is not asked again; never: removed, and its rule never asks again. "always" has
// no meaning here and is refused. Recorded like any consent (consent event with question "remove"). In the chain.
function answerRemoval(m, module, ans) {
  if (ans === 'always') return { code: 400, body: { error: 'the removal question takes y/n/x (yes/no/never)' } };
  const ts = new Date().toISOString();
  const turn = fade.turnOf(readTranscript());
  let rule = {};
  try { rule = (readJson(RULES, { rules: [] }).rules || []).find((r) => r.module === module) || {}; } catch { /* no rule */ }
  const c = counts(readTranscript());
  const n = typeof c[rule.metric] === 'number' ? c[rule.metric] : c.messages;
  const consentId = shortId('c');
  const entry = m.panes.find((p) => p.module === module);
  m.removals[module] = { answer: ans, at: ts, turn, count: n, metric: rule.metric || 'messages', consentId };
  if (ans !== 'no') m.panes = m.panes.filter((p) => p.module !== module);
  m.pending = null; delete m.pendingKind;
  writeModules(m);
  const effect = { yes: 'pane removed; its rule may offer it again once the count has doubled', no: 'kept as a tab; will not ask again', never: 'pane removed; its rule will never offer it again' }[ans];
  appendTranscript({ id: lineId(), ts, role: 'system', text: `remove ${module}: ${ans}, ${effect}`, model: null });
  appendJsonl(METRICS, { ts, event: 'consent', question: 'remove', id: consentId, module, answer: ans, count: n, metric: rule.metric || 'messages', turn });
  if (ans !== 'no') appendJsonl(METRICS, { ts, event: 'pane_remove', module, answer: ans, answerRef: consentId, turn, fadedTurn: entry && entry.fadedTurn });
  return { code: 200, body: { ok: true, module, answer: ans, question: 'remove' } };
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

// ---- validation: the hand validator (schema-check.js, moved there unchanged in pilot-v0.10) for the subset of JSON
// Schema that extraction.schema.json uses. An unknown keyword fails loudly at startup.
const { assertSupported, validate } = require('./schema-check.js');
assertSupported(EXTRACTION_SCHEMA, 'extraction.schema.json');

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

// ---- pilot-v0.10: frame proposals (frame.js has the rules; these functions write frames.json, nothing else) ----
// frames.json {rev, pending: {pane: proposal}, applied: {pane: frame}, resets: {pane: reset}}: one open proposal and one
// applied frame per pane. A proposal: {id, pane, intent, author: "model", model, modelId, at, fromMessage, turn}; an
// applied frame is the proposal plus appliedBy "user" and appliedAt. Hand-editable like the other JSON files: a broken
// one is read as its last good version and never written.
function readFrames() {
  const r = readJsonGood(FRAMES, null);
  const out = frame.normalize(r.doc);
  if (r.error) out.error = r.error;
  return out;
}
function writeFrames(f) {   // inside the write chain, only after readFrames() said the file is fine; keeps unknown fields
  let base = {};
  try { const d = readJson(FRAMES, {}); if (d && typeof d === 'object' && !Array.isArray(d)) base = d; } catch { /* not reached */ }
  const doc = { ...base, rev: (f.rev || 0) + 1, pending: f.pending, applied: f.applied, resets: f.resets };
  atomicWrite(FRAMES, JSON.stringify(doc, null, 2) + '\n'); lastGood['frames.json'] = JSON.parse(JSON.stringify(doc));
  f.rev = doc.rev;
  return doc.rev;
}
// What a frame may refer to now: panes shown with consent, which of them are tabs, the items.
function frameContext() {
  const m = readModules(), st = readState();
  const visible = visiblePanes(m);
  return { visible, faded: visible.filter((mod) => fade.isFaded(m.panes.find((p) => p.module === mod))), items: st.items, error: m.error || st.error || null };
}
function nextFrameId(f) {
  const nums = metricsEvents().filter((e) => e.event === 'frame_propose').map((e) => e.id)
    .concat(Object.values(f.pending).map((p) => p && p.id), Object.values(f.applied).map((p) => p && p.id))
    .map((id) => /^fr-(\d+)$/.exec(String(id))).filter(Boolean).map((x) => Number(x[1]));
  return `fr-${Math.max(0, ...nums) + 1}`;
}

let framing = 0;                       // queued + running frame runs (GET /state reports framing: true)
let frameChain = Promise.resolve();

function frameMessages(userLine, replyLine, panes, items, applied) {
  const list = (mod) => items.filter((i) => fade.PANE_KINDS[mod].includes(i.kind) && i.status !== 'rejected')
    .map((i) => `- ${i.id} (${i.kind}, ${i.status || 'confirmed'}${i.kind === 'task' ? `, ${i.column || 'todo'}` : ''}): ${i.text}`).join('\n') || '(no cards)';
  const shown = panes.map((p) => `${p}:\n${list(p)}`).join('\n\n');
  const now = panes.map((p) => `- ${p}: ${applied[p] && applied[p].intent ? frame.describe(applied[p].intent) : '(default)'}`).join('\n');
  return [
    { role: 'system', content: 'PILOT-FRAME v1\nYou may suggest ONE frame for ONE of the panes below: how that pane presents its cards. Reply with JSON '
      + 'only: {"pane": "map" | "kanban", "focus": item id, "order": [item ids], "group": "status" | "author"} (focus, order and group are '
      + 'optional), or {} for no suggestion. Use only the ids listed under that pane. A frame only arranges: it cannot add, remove, '
      + 'change, confirm or reject cards, and cannot add or remove panes. The person decides whether to apply it.' },
    { role: 'user', content: `Panes shown:\n${shown}\n\nFrames now:\n${now}\n\nLast user message:\n${userLine.text}\n\nLast assistant message:\n${replyLine.text}` },
  ];
}

// After a complete reply, only while the flag is on and a frame role is configured; queued after this turn's
// extraction (its proposals are cards a frame may name), never awaited by the chat.
function queueFrame(userLine, replyLine) {
  if (!flagsSummary().frameProposals || !roleConfig('frame').candidates.length) return;
  framing++;
  const after = extractChain;
  frameChain = Promise.all([after, frameChain]).then(() => runFrame(userLine, replyLine))
    .catch((err) => { console.error('frame failed:', err); return metric('frame_error', { reason: 'internal', error: String(err.message || err) }); })
    .catch(() => {})
    .finally(() => { framing--; });
}

async function runFrame(userLine, replyLine) {
  if (!flagsSummary().frameProposals) return;   // switched off meanwhile
  const ctx = frameContext();
  const panes = frame.FRAME_PANES.filter((p) => ctx.visible.includes(p) && !ctx.faded.includes(p));
  if (ctx.error || !panes.length) return;        // nothing a frame could arrange: no model call
  const cur = readFrames();
  if (cur.error) { await metric('frame_error', { reason: 'frames', error: cur.error, fromMessage: replyLine.id }); return; }
  const schema = JSON.parse(JSON.stringify(frame.SCHEMA));
  delete schema.$schema;
  const structured = (c) => c.structured === true ? { response_format: { type: 'json_schema', json_schema: { name: 'pilot_frame', schema } } } : {};
  const t0 = Date.now();
  let out;
  try { out = await callRole('frame', frameMessages(userLine, replyLine, panes, ctx.items, cur.applied), () => {}, new AbortController().signal, structured); }
  catch (err) { await metric('frame_error', { reason: err.stall ? 'stall' : 'model', error: String(err.message || err), fromMessage: replyLine.id }); return; }
  const base = { candidate: out.candidate.name, model: out.candidate.model, fromMessage: replyLine.id };
  const parsed = frame.parse(out.text);
  if (parsed.none) { await metric('frame_none', { ...base, latencyMs: Date.now() - t0 }); return; }
  if (parsed.error) { await metric('frame_reject', { ...base, reason: parsed.reason, errors: [parsed.error], chars: out.text.length }); return; }
  const intent = parsed.intent, pane = intent.pane;
  await serial(() => {
    const ts = new Date().toISOString();
    const f = readFrames();   // fresh: you may have applied, dismissed or hand-edited meanwhile
    if (f.error) { appendJsonl(METRICS, { ts, event: 'frame_error', ...base, reason: 'frames', error: f.error }); return; }
    const c = frame.check(intent, frameContext());
    if (!c.ok) { appendJsonl(METRICS, { ts, event: 'frame_reject', ...base, module: pane, reason: c.reason, errors: c.errors, intent }); return; }
    const dup = [f.applied[pane], f.pending[pane]].find((p) => p && frame.same(p.intent, intent));
    if (dup) { appendJsonl(METRICS, { ts, event: 'frame_reject', ...base, module: pane, reason: 'same', errors: [`same as ${dup.id} (${dup === f.applied[pane] ? 'applied' : 'proposed'})`], intent }); return; }
    const id = nextFrameId(f), prev = f.pending[pane];
    f.pending[pane] = { id, pane, intent, author: 'model', model: out.candidate.name, modelId: out.candidate.model, at: ts, fromMessage: replyLine.id, turn: fade.turnOf(readTranscript()) };
    const rev = writeFrames(f);
    appendJsonl(METRICS, { ts, event: 'frame_propose', id, module: pane, intent, ...base, turn: f.pending[pane].turn, rev, latencyMs: Date.now() - t0, ...(prev && prev.id ? { replaces: prev.id } : {}) });
  });
}

// POST /frame {pane, id, action: apply|dismiss, rev?}: only you apply or dismiss a proposal. Apply checks it again
// against what is on screen now (cards or panes may have changed since it was proposed); one that no longer fits is
// dropped (409). `rev` = the frames.json rev the page last saw; a stale one is 409 {stale: true}.
function frameAnswer(pane, id, action, seenRev) {
  return serial(() => {
    if (!frame.FRAME_PANES.includes(pane)) return { code: 400, body: { error: `pane must be one of ${frame.FRAME_PANES.join(', ')}` } };
    if (action !== 'apply' && action !== 'dismiss') return { code: 400, body: { error: 'action must be apply or dismiss' } };
    if (!flagsSummary().frameProposals) return { code: 409, body: { error: 'the frame-proposals experiment is off (/flag frame-proposals on)' } };
    const f = readFrames();
    if (f.error) return { code: 409, body: { error: `${f.error}; fix the file by hand first` } };
    if (seenRev !== undefined && seenRev !== f.rev) return stale('frames.json', seenRev, f.rev);
    const p = f.pending[pane];
    if (!p || p.id !== id) return { code: 409, body: { error: `no open frame proposal "${id}" for ${pane}`, pending: p ? p.id : null } };
    const ts = new Date().toISOString();
    const who = `suggested by ${p.model || 'a model'}`;
    if (action === 'dismiss') {
      delete f.pending[pane];
      const rev = writeFrames(f);
      appendTranscript({ id: lineId(), ts, role: 'system', text: `${pane}: frame ${id} dismissed (${who}); nothing changed`, model: null });
      appendJsonl(METRICS, { ts, event: 'frame_dismiss', id, module: pane, by: 'user', model: p.model || null, rev });
      return { code: 200, body: { ok: true, pane, id, action, rev } };
    }
    const c = p.intent && typeof p.intent === 'object' ? frame.check(p.intent, frameContext()) : { ok: false, reason: 'schema', errors: ['no intent'] };
    if (!c.ok) {
      delete f.pending[pane];
      const rev = writeFrames(f);
      appendJsonl(METRICS, { ts, event: 'frame_reject', id, module: pane, reason: 'stale', errors: c.errors, rev });
      return { code: 409, body: { error: `frame ${id} no longer fits (${c.errors.join('; ')}); dropped, nothing changed`, rev } };
    }
    const prev = f.applied[pane];
    f.applied[pane] = { ...p, appliedBy: 'user', appliedAt: ts };
    delete f.pending[pane];
    const rev = writeFrames(f);
    appendTranscript({ id: lineId(), ts, role: 'system', text: `${pane}: frame ${id} applied by you (${who}): ${frame.describe(p.intent)}. /frame reset ${pane} undoes it`, model: null });
    appendJsonl(METRICS, { ts, event: 'frame_apply', id, module: pane, intent: p.intent, by: 'user', model: p.model || null, proposedAt: p.at || null, rev, ...(prev && prev.id ? { replaces: prev.id } : {}) });
    return { code: 200, body: { ok: true, pane, id, action, frame: f.applied[pane], rev } };
  });
}

// /frame reset [pane]: back to the pane's own order (works with the flag off too: a frame must always be undoable).
function frameReset(panes) {
  return serial(() => {
    const f = readFrames();
    if (f.error) return { ok: false, lines: [`frames.json is not valid JSON, not changed: ${f.error}`] };
    const ts = new Date().toISOString(), done = [];
    for (const pane of panes) {
      const a = f.applied[pane];
      if (!a) continue;
      delete f.applied[pane];
      f.resets[pane] = { at: ts, by: 'user', frame: a.id || null };
      done.push([pane, a]);
    }
    if (!done.length) return { ok: true, lines: [`nothing to reset: no frame applied${panes.length === 1 ? ` to ${panes[0]}` : ''}`] };
    const rev = writeFrames(f);
    for (const [pane, a] of done) {
      appendTranscript({ id: lineId(), ts, role: 'system', text: `${pane}: frame ${a.id} reset by you; the pane shows its own order again`, model: null });
      appendJsonl(METRICS, { ts, event: 'frame_reset', id: a.id || null, module: pane, by: 'user', rev });
    }
    return { ok: true, lines: done.map(([pane, a]) => `${pane}: frame ${a.id} reset (kept in ${path.relative(APP, PILOT)}/frames.json resets.${pane})`) };
  });
}
function frameLines() {
  const f = readFrames(), on = flagsSummary().frameProposals;
  const lines = [];
  if (!on) lines.push('frame-proposals is off: no frame is proposed or shown (/flag frame-proposals on)');
  if (f.error) lines.push(`${f.error}: showing the last good version`);
  for (const pane of frame.FRAME_PANES) {
    const a = f.applied[pane], p = f.pending[pane];
    if (a) lines.push(`${pane}: frame ${a.id} applied by you at ${a.appliedAt} (suggested by ${a.model}): ${frame.describe(a.intent)}  (/frame reset ${pane} undoes it)`);
    if (p) lines.push(`${pane}: frame ${p.id} proposed by ${p.model} at ${p.at}: ${frame.describe(p.intent)}  (f in the ${pane} pane applies it)`);
    if (!a && !p) lines.push(`${pane}: no frame (its own order)`);
  }
  return lines;
}

// pilot-v0.6: the server's write ledger. Every item the server creates or decides is logged as `item_write` with a
// copy of the item as written (see stats.js provenance). Hand edits made before this write stay attributed: their
// fields go along as handFields (except the ones this write sets), an item that came in through the file keeps
// addedByFile. Call inside the write chain, right after writeState.
function itemWrite(item, via, before, ts) {
  const set = via === 'decide' ? ['status', 'decidedAt', 'decidedBy'] : via === 'move' ? ['column', 'movedAt', 'movedBy'] : [];
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
    appendTranscript({ id: 'm-' + crypto.randomUUID().slice(0, 8), ts, role: 'system', text: `${itemId} ${status}: ${item.text}`, model: null });
    appendJsonl(METRICS, { ts, event: 'decide', itemId, kind: item.kind, decision: status, decidedBy: 'user', author: item.author || null, model: item.model || null, rev });
    // pilot-v0.8: a decision on a card is a touch of the pane that shows it
    const mod = fade.paneOfKind(item.kind), m = readModules();
    if (mod && !m.error && visiblePanes(m).includes(mod) && applyTouch(m, mod, 'decide', ts, fade.turnOf(readTranscript())).changed) writeModules(m);
    return { code: 200, body: { ok: true, item, rev } };
  });
}

// POST /move {itemId, column, rev?} (pilot-ui): you drag a task to another kanban column. Only confirmed tasks (or
// tasks added by hand) move: a proposal is decided first. Records movedAt and movedBy: "user"; a move is a touch of
// the kanban pane.
const COLUMNS = ['todo', 'doing', 'done'];
function moveItem(itemId, column, seenRev) {
  return serial(() => {
    if (!COLUMNS.includes(column)) return { code: 400, body: { error: `column must be ${COLUMNS.join(', ')}` } };
    const st = readState();
    if (st.error) return { code: 409, body: { error: `${st.error}; fix the file by hand first` } };
    if (seenRev !== undefined && seenRev !== st.rev) return stale('state.json', seenRev, st.rev);
    const item = st.doc.items.find((i) => i && i.id === itemId);
    if (!item) return { code: 404, body: { error: `no item "${itemId}"` } };
    if (item.kind !== 'task') return { code: 409, body: { error: `${itemId} is a ${item.kind}, only tasks move` } };
    if ((item.status || 'confirmed') !== 'confirmed') return { code: 409, body: { error: `${itemId} is ${item.status}; confirm it before moving it` } };
    const from = item.column || 'todo';
    if (from === column) return { code: 200, body: { ok: true, item, rev: st.rev, changed: false } };
    const ts = new Date().toISOString();
    const before = stats.provenance(item, stats.ledgerOf(metricsEvents()).get(itemId));
    item.column = column; item.movedAt = ts; item.movedBy = 'user';
    const rev = writeState(st.doc);
    itemWrite(item, 'move', before, ts);
    appendJsonl(METRICS, { ts, event: 'move', itemId, from, to: column, by: 'user', rev });
    const m = readModules();
    if (!m.error && visiblePanes(m).includes('kanban') && applyTouch(m, 'kanban', 'decide', ts, fade.turnOf(readTranscript())).changed) writeModules(m);
    return { code: 200, body: { ok: true, item, rev, changed: true } };
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
    if (['modules.json', 'roles.json', 'flags.json', 'frames.json', 'chats.json'].includes(name)) lastGood[name] = j;   // keep the last good version fresh
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
function statePayload(only, chat) {
  const want = (f) => !only || only.includes(f);
  const out = { extracting: extracting > 0, framing: framing > 0 };
  if (want('transcript.jsonl')) {
    const lines = readTranscript();
    // pilot-ui: ?chat=<id> sends that chat's tail (plus the open controller question, which shows in every chat)
    const shown = chat ? chatTail(lines, chat) : lines;
    out.transcript = shown.slice(-TAIL); out.total = shown.length; out.turn = fade.turnOf(lines);
  }
  if (want('transcript.jsonl') || want('chats.json')) { out.chats = chatsSummary(readTranscript()); out.chatsRev = readChats().rev; out.defaultChat = DEFAULT_CHAT; }   // pilot-ui
  if (want('modules.json') || want('roles.json')) out.models = modelsSummary();
  let m = null, st = null;
  if (want('modules.json')) {
    m = readModules();
    let rulesDoc = { rules: [] };
    try { rulesDoc = readJson(RULES, { rules: [] }) || rulesDoc; } catch { /* broken rules.json: rule from the pane entry only */ }
    const rules = Array.isArray(rulesDoc.rules) ? rulesDoc.rules : [];
    const paneInfo = stats.paneInfo(m, rules, metricsEvents());
    // pilot-v0.8: paneInfo.<module>.fade = fade.status() (faded, lastTouch, idle, thresholds, proposals held)
    const lines = readTranscript(), items = readState().items, turn = fade.turnOf(lines);
    for (const p of m.panes) if (p && paneInfo[p.module]) paneInfo[p.module].fade = fade.status(p, { lines, turn, rulesDoc, items });
    Object.assign(out, { panes: visiblePanes(m), pending: m.pending, pendingKind: m.pendingKind || null, answers: m.answers, removals: m.removals,
      modulesRev: m.rev, paneInfo, faded: visiblePanes(m).filter((mod) => fade.isFaded(m.panes.find((p) => p.module === mod))) });
  }
  if (want('flags.json')) out.flags = flagsSummary();   // pilot-v0.9
  if (want('frames.json')) { const f = readFrames(); out.frames = { rev: f.rev, pending: f.pending, applied: f.applied, resets: f.resets }; }   // pilot-v0.10
  // items carry `prov` ({added, fields}) when a part of them came from a hand edit (pilot-v0.6, see stats.js)
  if (want('state.json')) { st = readState(); Object.assign(out, { items: stats.withProvenance(st.items, metricsEvents()), stateRev: st.rev, stateError: st.error || null }); }
  // a broken hand-editable file: the page says "file X is not valid JSON, showing last good version" until fixed
  const fileErrors = {};
  for (const [f, e] of [['state.json', (st || readState()).error], ['modules.json', (m || readModules()).error], ['roles.json', readJsonGood(ROLES, {}).error], ['flags.json', readFlags().error], ['frames.json', readFrames().error], ['chats.json', readChats().error]]) if (e) fileErrors[f] = e;
  out.fileErrors = fileErrors;
  return out;
}

// pilot-v0.9: settled-input events from the page. Only numbers, booleans and the named enums are kept; never any text
// (an ignored offer was a draft nobody sent). Every outcome names its offer; one offer has at most one outcome.
const SETTLE_EVENTS = {
  settle_offer: { cue: ['punct', 'question'], chars: 'n', words: 'n', sinceKeyMs: 'n' },
  settle_accept: { offerRef: 'id', sinceKeyMs: 'n', offerMs: 'n', chars: 'n' },
  settle_ignore: { offerRef: 'id', how: ['typed', 'escape'], offerMs: 'n' },
  enter_send: { offerShowing: 'b', offerRef: 'id?', sinceKeyMs: 'n', chars: 'n' },
};
const offerOutcome = new Map();   // offer id -> outcome event (this server run; older ones are checked in metrics.jsonl)
function settleEvent(body) {
  if (!flagsSummary().settledInput) return { error: 'the settled-input experiment is off (/flag settled-input on)' };
  const spec = SETTLE_EVENTS[body.event], fields = {};
  for (const [k, t] of Object.entries(spec)) {
    const v = body[k];
    if (t === 'id?' && (v === undefined || v === null)) continue;
    const ok = Array.isArray(t) ? t.includes(v) : t === 'n' ? Number.isFinite(v) && v >= 0 && v < 864e5 : t === 'b' ? typeof v === 'boolean'
      : typeof v === 'string' && /^so-[a-z0-9]{1,12}$/.test(v);
    if (!ok) return { error: `${body.event}: bad or missing ${k}` };
    fields[k] = t === 'n' ? Math.round(v) : v;
  }
  if (body.event === 'settle_offer') {
    if (typeof body.offer !== 'string' || !/^so-[a-z0-9]{1,12}$/.test(body.offer)) return { error: 'settle_offer: bad or missing offer id' };
    fields.offer = body.offer;
    offerOutcome.set(body.offer, null);
  }
  if (body.event === 'enter_send' && fields.offerShowing !== !!fields.offerRef) return { error: 'enter_send: offerRef goes with offerShowing true' };
  const ref = fields.offerRef;
  if (ref) {
    const known = offerOutcome.has(ref) || metricsEvents().some((e) => e.event === 'settle_offer' && e.offer === ref);
    if (!known) return { error: `no settle_offer "${ref}"` };
    if (offerOutcome.get(ref) || metricsEvents().some((e) => e.offerRef === ref)) return { error: `offer "${ref}" already has an outcome` };
    offerOutcome.set(ref, body.event);
  }
  fields.settleMs = SETTLE_MS;
  fields.turn = fade.turnOf(readTranscript());
  return { fields };
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

// The board as a system message for the chat role: confirmed decisions, open tasks with their column, sources, each
// with its id. Proposed and rejected items are left out (a missing status means added by hand, i.e. confirmed). A broken
// state.json reads as its last good items (readState); an empty board adds nothing.
const BOARD_MAX = 8;   // per kind, so the message stays small
function boardContext() {
  let items;
  try { items = readState().items; } catch { return null; }
  const live = items.filter((i) => (i.status || 'confirmed') === 'confirmed');
  const list = (title, its, fmt) => {
    if (!its.length) return [];
    const shown = its.slice(-BOARD_MAX).map((i) => `- ${i.id}: ${fmt(i)}`);
    return [`${title}:`, ...shown, ...(its.length > BOARD_MAX ? [`- (${its.length - BOARD_MAX} older not shown)`] : [])];
  };
  const lines = [
    ...list('Confirmed decisions', live.filter((i) => i.kind === 'decision'), (i) => i.text),
    ...list('Open tasks', live.filter((i) => i.kind === 'task' && i.column !== 'done'), (i) => `[${i.column || 'todo'}] ${i.text}`),
    ...list('Sources', live.filter((i) => i.kind === 'source'), (i) => i.url ? `${i.text} <${i.url}>` : i.text),
  ];
  if (!lines.length) return null;
  return { role: 'system', content: ['Project board (the user\'s confirmed state):', ...lines,
    'Treat confirmed decisions as current constraints. If a request conflicts with one, say so and name its id.'].join('\n') };
}

async function handleChat(req, res) {
  let text, chat;
  try { const b = JSON.parse(await readBody(req)); text = String(b.text || '').trim(); chat = b.chat === undefined ? DEFAULT_CHAT : b.chat; } catch { return sendJson(res, 400, { error: 'expected JSON {text, chat?}' }); }
  if (!text) return sendJson(res, 400, { error: 'empty message' });
  if (!chatExists(chat)) return sendJson(res, 400, { error: `no chat "${chat}"` });
  currentChat = chat;

  // pilot-ui: the model sees only this chat's history (plus the shared board below)
  const userLine = await appendLine('user', text, null, undefined, chat);
  const history = readTranscript().filter((l) => (l.role === 'user' || l.role === 'assistant') && chatOf(l) === chat).slice(-HISTORY)
    .map((l) => ({ role: l.role, content: l.text }));
  const board = boardContext();
  if (board) history.unshift(board);

  // no-cache, not no-store: Chrome reports a streamed no-store body read by a reader as net::ERR_ABORTED.
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });

  let replyLine = null;
  try {
    const { text: reply, candidate } = await callRole('chat', history, (d) => res.write(d), abort.signal);
    replyLine = await appendLine('assistant', reply, candidate.name, undefined, chat);
  } catch (err) {
    // Keep whatever arrived before the failure, then record the failure as a system line.
    if (err.partial) await appendLine('assistant', err.partial, err.candidate && err.candidate.name, undefined, chat);
    const msg = err.stall ? `reply stalled: ${err.message}; kept the partial reply, no fallback` : `chat failed: ${err.message || err}`;
    await appendLine('system', msg, null, err.stall ? 'stall' : 'error', chat);
    console.error(msg);
    if (!res.writableEnded) res.write(`\n[${msg}]`);
  }
  await runController();
  const after = readTranscript();
  await metric('turn', { ok: !!replyLine, lines: after.length, messages: after.filter((l) => l.role === 'user' || l.role === 'assistant').length });
  // Extraction only after a complete reply (not after a failure or a stall), queued before res.end() so
  // GET /state already reports it as running, and never awaited here: it cannot delay the chat reply.
  if (replyLine) { queueExtraction(userLine, replyLine); queueFrame(userLine, replyLine); }   // pilot-v0.10: frame after extraction
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
  '/why [pane|item id]        why the workbench looks like this: rules, questions, answers, origins, with sources',
  '/theme light|dark|auto     colour theme of this page (kept in this browser only)',
  '/flag [settled-input on|off]  experiments (pilot-v0.9): show them, or switch one (kept in flags.json; default off)',
  '/flag frame-proposals on|off  experiment (pilot-v0.10): the frame role may suggest how a pane shows its cards',
  '/frame [reset [map|kanban]]  frames (pilot-v0.10): what is proposed and applied per pane; reset undoes an applied frame',
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
      const entry = m.panes.find((p) => p.module === r.module), rem = removedSince(m, r.module);
      const state = m.pending === r.module ? (m.pendingKind === 'remove' ? 'asking whether to remove it' : 'asking now')
        : entry ? (fade.isFaded(entry) ? 'pane faded to a tab' : 'pane shown') : rem ? `removed (${rem.answer})`
        : ans ? `answered ${ans.answer} at ${ans.count}` : BUILT.includes(r.module) ? 'not asked yet' : 'not built yet';
      return `${r.module}: ${r.metric} ${c[r.metric]} / ${r.threshold}  (${state})`;
    }) };
  }
  // pilot-v0.7: read-only; `why` carries the statements with their sources and message ids for the page's links
  if (cmd === '/why') {
    const r = why.explain(PILOT, args.join(' '), `${path.relative(APP, PILOT)}/`);
    return { ok: r.ok, lines: why.format(r.statements), why: r.statements };
  }
  // pilot-v0.9: experiment flags. Without arguments: each flag, its value and where it comes from.
  if (cmd === '/flag') {
    const fs0 = flagsSummary();
    const noRole = roleConfig('frame').candidates.length ? '' : '; no frame role in the config, so nothing is proposed';
    const show = () => [`settled-input: ${fs0.settledInput ? 'on' : 'off'}  (from ${fs0.source}; offer after ${fs0.settleMs} ms; Enter always sends)`,
      `frame-proposals: ${fs0.frameProposals ? 'on' : 'off'}  (from ${fs0.frameSource}; the frame role only suggests, f applies, /frame reset undoes${noRole})`];
    if (!args.length) return { ok: true, lines: show() };
    const [name, val] = args;
    if (!FLAG_NAMES[name]) return { ok: false, lines: [`unknown flag "${name}". Flags: ${Object.keys(FLAG_NAMES).join(', ')}`] };
    if (val !== 'on' && val !== 'off') return { ok: false, lines: [`usage: /flag ${name} on|off`] };
    const cur = readFlags();
    if (cur.error) return { ok: false, lines: [`flags.json is not valid JSON, not changed: ${cur.error}`] };
    const on = val === 'on', key = FLAG_NAMES[name];
    const was = key === 'settledInput' ? fs0.settledInput : fs0.frameProposals;
    await serial(() => {
      const doc = readJson(FLAGS, {}) || {};
      doc.rev = (Number.isInteger(doc.rev) ? doc.rev : 0) + 1;
      doc.experiments = { ...(doc.experiments && typeof doc.experiments === 'object' ? doc.experiments : {}), [key]: on };
      atomicWrite(FLAGS, JSON.stringify(doc, null, 2) + '\n');
      lastGood['flags.json'] = doc;
    });
    const effect = { settledInput: ': after a pause on a finished-looking input the page offers "send?" (Tab sends, Enter always sends)',
      frameProposals: ': after a turn the frame role may suggest how the map or kanban shows its cards; only you apply it (f in that pane)' }[key];
    await appendLine('system', `experiment ${name} ${val} (/flag)${on ? effect : ''}`, null);
    await metric('flag', { name, value: on, was });
    return { ok: true, lines: [`${name}: ${val}  (kept in ${path.relative(APP, PILOT)}/flags.json; /flag ${name} ${on ? 'off' : 'on'} switches back)`] };
  }
  // pilot-v0.10: frames per pane; /frame reset [pane] undoes an applied frame
  if (cmd === '/frame') {
    if (!args.length) return { ok: true, lines: frameLines() };
    if (args[0] !== 'reset' || args.length > 2 || (args[1] && !frame.FRAME_PANES.includes(args[1]))) return { ok: false, lines: [`usage: /frame [reset [${frame.FRAME_PANES.join('|')}]]`] };
    return frameReset(args[1] ? [args[1]] : frame.FRAME_PANES);
  }
  if (cmd === '/stats') return { ok: true, lines: stats.formatStats(stats.computeStats(PILOT), `${path.relative(APP, PILOT)}/`) };
  if (cmd === '/panes') {
    const m = readModules();
    const lines = ['chat (always, never fades)', ...m.panes.map((p) => `${p.module} added ${p.addedAt} at ${p.atCount} messages${fade.isFaded(p) ? `, faded to a tab at turn ${p.fadedTurn}` : ''}`)];
    for (const [mod, a] of Object.entries(m.answers)) lines.push(`answer ${mod}: ${a.answer} (${a.at}, count ${a.count})`);
    for (const [mod, a] of Object.entries(m.removals)) lines.push(`remove ${mod}: ${a.answer} (${a.at}, turn ${a.turn})`);
    if (m.pending) lines.push(`pending question: ${m.pendingKind === 'remove' ? `remove ${m.pending}` : m.pending}`);
    return { ok: true, lines };
  }
  return { ok: false, lines: [`unknown command "${cmd}". Try /help`] };
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname, searchParams } = new URL(req.url, `http://${HOST}`);
    // pilot-ui: every write from the page names the chat it was made in (x-pilot-chat), so controller and system lines
    // land there, also after a server restart or with tabs open in different chats
    if (req.method === 'POST' && req.headers['x-pilot-chat']) {
      let hc = ''; try { hc = decodeURIComponent(String(req.headers['x-pilot-chat'])); } catch { /* ignore a bad header */ }
      if (hc && chatExists(hc)) currentChat = hc;
    }
    if (req.method === 'GET' && pathname === '/state') {
      const only = searchParams.has('only') ? searchParams.get('only').split(',').filter(Boolean) : null;
      return sendJson(res, 200, statePayload(only, searchParams.get('chat') || null));
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
    // pilot-v0.9: and the settled-input events, only while that experiment is on (settleEvent validates them).
    if (req.method === 'POST' && pathname === '/metric') {
      let body;
      try { body = JSON.parse(await readBody(req, 2000)); } catch { return sendJson(res, 400, { error: 'expected JSON {event: "index_jump", target}' }); }
      if (body && SETTLE_EVENTS[body.event]) {
        const out = settleEvent(body);
        if (out.error) return sendJson(res, 400, { error: out.error });
        await metric(body.event, out.fields);
        return sendJson(res, 200, { ok: true });
      }
      if (!body || body.event !== 'index_jump') return sendJson(res, 400, { error: 'only {event: "index_jump", target} is accepted' });
      const target = typeof body.target === 'string' ? body.target : '';
      const lines = readTranscript();
      const at = lines.findIndex((l) => l.id === target);
      if (at < 0) return sendJson(res, 400, { error: `no message "${target}"` });
      await metric('index_jump', { target, position: at + 1, of: lines.length });
      return sendJson(res, 200, { ok: true });
    }
    // pilot-v0.10: apply or dismiss a frame proposal (only you; the frame role only proposes)
    if (req.method === 'POST' && pathname === '/frame') {
      let body;
      try { body = JSON.parse(await readBody(req, 2000)); } catch { return sendJson(res, 400, { error: 'expected JSON {pane, id, action}' }); }
      const rev = body && body.rev !== undefined && body.rev !== null ? body.rev : undefined;
      const out = await frameAnswer(body && body.pane, body && body.id, body && body.action, rev);
      return sendJson(res, out.code, out.body);
    }
    // pilot-ui: chats (new / open / rename) and moving a task between kanban columns
    if (req.method === 'POST' && pathname === '/chats') {
      let body;
      try { body = JSON.parse(await readBody(req, 2000)); } catch { return sendJson(res, 400, { error: 'expected JSON {action, id?, title?}' }); }
      const out = await chatAction(body);
      return sendJson(res, out.code, out.body);
    }
    if (req.method === 'POST' && pathname === '/move') {
      let body;
      try { body = JSON.parse(await readBody(req, 2000)); } catch { return sendJson(res, 400, { error: 'expected JSON {itemId, column, rev?}' }); }
      const rev = body && body.rev !== undefined && body.rev !== null ? body.rev : undefined;
      const out = await moveItem(body && body.itemId, body && body.column, rev);
      return sendJson(res, out.code, out.body);
    }
    // pilot-v0.8: the page reports an interaction with a pane (a faded pane comes back)
    if (req.method === 'POST' && pathname === '/touch') {
      let body;
      try { body = JSON.parse(await readBody(req, 2000)); } catch { return sendJson(res, 400, { error: 'expected JSON {module, how}' }); }
      const out = await touch(body && body.module, body && body.how);
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
  // pilot-v0.6: continuity. Counts at start, compared by /stats with the previous run's last turn.
  const lines = readTranscript(), m = readModules(), st = readState();
  metric('server_start', { pid: process.pid, lines: lines.length, messages: lines.filter((l) => l.role === 'user' || l.role === 'assistant').length,
    items: st.items.length, panes: visiblePanes(m).length, answers: Object.keys(m.answers).length,
    fileErrors: [m.error, st.error].filter(Boolean) }).catch((err) => console.error('server_start:', err.message));
  noteItems();   // baseline for file-edit detection (edits made while the server was down show via the ledger)
  console.log(`CLI Pilot on http://${HOST}:${PORT}  (config: ${path.relative(APP, configPath)}, data: ${path.relative(APP, PILOT)}/)`);
});
