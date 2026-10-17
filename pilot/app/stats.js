// CLI Pilot (pilot-v0.6): authorship and the P5 measures, computed only from metrics.jsonl and the files in a pilot
// dir. No model, no writes, no side effects on load: server.js requires this module, and so does the read-only
// `npm run stats -- <pilotDir>` (scripts/stats.js). Node 20+, no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');

// A gap of more than 30 minutes between two activity timestamps ends a work session (Usefulness) and does not count
// as work (Quiet). See CHECKS.md # pilot-v0.6 "Definitions".
const SESSION_GAP_MS = 30 * 60 * 1000;

function readJsonl(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const out = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* a broken hand-edited line is skipped */ }
  }
  return out;
}
function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// ---- authorship of items: the server's write ledger in metrics.jsonl ----
// Every time the server creates an item (extraction) or decides one (POST /answer) it appends an `item_write` event
// with a full copy of the item as written. The last such copy per id is what the server vouches for. An item in
// state.json that differs from it was changed by hand: the differing fields are "you (file edit)". The file itself
// carries no extra field. No ledger entry = no evidence: the item's declared `author` is shown as is, except that a
// user item can only have come from a file edit (the server never creates one).
function ledgerOf(events) {
  const map = new Map();
  for (const e of events) if (e && e.event === 'item_write' && e.item && typeof e.itemId === 'string') map.set(e.itemId, e);
  return map;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// -> null (nothing to attribute to a file edit) or {added, fields}: added = the item came in through the file;
// fields = item fields that differ from the server's last write (plus hand-edited fields carried over by that write).
function provenance(item, entry) {
  if (!entry) return item.author === 'user' ? { added: true, fields: [] } : null;
  const keys = new Set([...Object.keys(item), ...Object.keys(entry.item)]);
  const fields = new Set(entry.handFields || []);
  for (const k of keys) if (!same(item[k], entry.item[k])) fields.add(k);
  const added = !!entry.addedByFile || item.author === 'user';
  return added || fields.size ? { added, fields: [...fields].sort() } : null;
}
function withProvenance(items, events) {
  const led = ledgerOf(events);
  return items.map((it) => { const p = provenance(it, led.get(it.id)); return p ? { ...it, prov: p } : it; });
}

// ---- panes: which rule, which answer, and whether that answer was recorded through the server ----
// A consent event matches a pane's answer by id (answers.<module>.consentId, since pilot-v0.6) or, for older data,
// by module + timestamp. An answer without a matching event was written into modules.json by hand.
function consentFor(module, ans, events) {
  if (!ans) return null;
  return events.find((e) => e.event === 'consent' && e.module === module && e.answer === ans.answer
    && ((ans.consentId && e.id === ans.consentId) || (!ans.consentId && e.ts === ans.at))) || null;
}
function paneInfo(modules, rules, events) {
  const out = {};
  for (const p of modules.panes || []) {
    if (!p || out[p.module]) continue;
    const ans = (modules.answers || {})[p.module] || null;
    const rule = p.rule || (rules || []).find((r) => r.module === p.module) || {};
    out[p.module] = { module: p.module, metric: rule.metric || null, threshold: typeof rule.threshold === 'number' ? rule.threshold : null,
      atCount: p.atCount, addedAt: p.addedAt || null, answer: ans ? ans.answer : null, answeredAt: ans ? ans.at : null,
      recorded: !!consentFor(p.module, ans, events) };
  }
  return out;
}

// ---- the five P5 measures (pilot/cli-pilot-v1/04-build-plan.md, "P5 Dogfood week", proposed thresholds) ----
const THRESHOLDS = {
  continuity: 'state survived every restart (at least 1 restart, nothing lost)',
  consent: 'no pane appeared without a recorded answer (at least 1 pane)',
  usefulness: 'the index was used to jump back at least 3 times in one session',
  signal: 'at least half of confirmed-or-rejected proposals were confirmed',
  quiet: 'the controller asked no more than once per hour of work (at least 1 h of work)',
};

const isMsg = (l) => l.role === 'user' || l.role === 'assistant';
const t = (s) => Date.parse(s);
const hm = (s) => (s ? String(s).slice(5, 16).replace('T', ' ') : '?');   // "10-15 14:05" (UTC, like the files)

// Work sessions: activity timestamps sorted; a gap of more than SESSION_GAP_MS starts a new session.
function sessions(stamps) {
  const ts = stamps.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const out = [];
  for (const x of ts) {
    const cur = out[out.length - 1];
    if (cur && x - cur.end <= SESSION_GAP_MS) cur.end = x; else out.push({ start: x, end: x });
  }
  return out;
}

function continuity(events) {
  const starts = [];
  let high = { lines: 0, answers: 0 };
  for (const e of events) {
    if (e.event === 'turn' && Number.isInteger(e.lines)) high.lines = Math.max(high.lines, e.lines);
    if (e.event !== 'server_start') continue;
    const lost = [];
    if (starts.length) {
      if ((e.lines || 0) < high.lines) lost.push(`${high.lines - (e.lines || 0)} transcript lines`);
      if ((e.answers || 0) < high.answers) lost.push(`${high.answers - (e.answers || 0)} consent answers`);
    }
    starts.push({ e, lost });
    high = { lines: Math.max(high.lines, e.lines || 0), answers: Math.max(high.answers, e.answers || 0) };
  }
  const restarts = Math.max(0, starts.length - 1);
  const losses = starts.filter((s) => s.lost.length);
  const pass = restarts >= 1 && !losses.length;
  const lines = [];
  if (!starts.length) lines.push('no server_start in metrics.jsonl yet');
  else {
    lines.push(`${starts.length} server starts (${restarts} restart${restarts === 1 ? '' : 's'}); at each start:`);
    lines.push(`transcript lines ${starts.map((s) => s.e.lines || 0).join(' → ')}; answers ${starts.map((s) => s.e.answers || 0).join(' → ')}; items ${starts.map((s) => s.e.items || 0).join(' → ')}`);
    for (const s of losses) lines.push(`LOST at the start of ${hm(s.e.ts)}: ${s.lost.join(', ')} (compared with the previous run's last turn)`);
    if (!losses.length && restarts) lines.push('nothing lost (transcript lines and answers never fewer than before the restart)');
  }
  if (!restarts && starts.length) lines.push('needs at least one restart to show anything');
  return { pass, lines };
}

function consent(events, modules) {
  const consents = events.filter((e) => e.event === 'consent');
  const adds = events.filter((e) => e.event === 'controller_add');
  const bad = [];
  for (const a of adds) {
    const ok = consents.find((c) => c.module === a.module && ['yes', 'always'].includes(c.answer)
      && ((a.answerRef && c.id === a.answerRef) || (!a.answerRef && t(c.ts) <= t(a.ts))));
    if (!ok) bad.push(`controller_add ${a.module} at ${hm(a.ts)} has no matching consent answer`);
  }
  const shown = [];
  for (const p of modules.panes || []) {
    const ans = (modules.answers || {})[p.module];
    if (!ans || !['yes', 'always'].includes(ans.answer) || shown.includes(p.module)) continue;   // hidden: not shown
    shown.push(p.module);
    if (!consentFor(p.module, ans, events)) bad.push(`pane ${p.module} is shown with answer "${ans.answer}" that has no consent event (file edit)`);
  }
  const pass = shown.length > 0 && !bad.length;
  const lines = [`${adds.length} pane adds logged, ${shown.length} pane${shown.length === 1 ? '' : 's'} shown now (${shown.join(', ') || 'none'}), ${consents.length} consent answers recorded`];
  for (const a of adds) lines.push(`${a.module}: added ${hm(a.ts)} at ${a.count} after "${a.answer}"${a.answerRef ? ` (answer ${a.answerRef})` : ''}`);
  lines.push(...bad);
  if (!shown.length) lines.push('no pane shown yet');
  return { pass, lines };
}

function usefulness(events, transcript) {
  const jumps = events.filter((e) => e.event === 'index_jump').map((e) => t(e.ts));
  const ss = sessions([...transcript.filter(isMsg).map((l) => t(l.ts)), ...jumps]);
  let best = null;
  for (const s of ss) { s.jumps = jumps.filter((j) => j >= s.start && j <= s.end).length; if (!best || s.jumps > best.jumps) best = s; }
  const n = best ? best.jumps : 0;
  const iso = (x) => new Date(x).toISOString();
  const lines = [`${jumps.length} index jumps in ${ss.length} work session${ss.length === 1 ? '' : 's'}; most in one session: ${n}`
    + (best && n ? ` (${hm(iso(best.start))}–${iso(best.end).slice(11, 16)})` : '')];
  if (n < 3) lines.push(`needs 3 in one session (${3 - n} more)`);
  return { pass: n >= 3, lines };
}

function signal(events, items) {
  const led = ledgerOf(events);
  const model = items.filter((i) => i.author === 'model');
  const conf = model.filter((i) => i.status === 'confirmed'), rej = model.filter((i) => i.status === 'rejected');
  const decided = conf.length + rej.length;
  const byFile = [...conf, ...rej].filter((i) => { const p = provenance(i, led.get(i.id)); return p && p.fields.includes('status'); }).length;
  const decides = events.filter((e) => e.event === 'decide');
  const pct = decided ? Math.round((100 * conf.length) / decided) : 0;
  const lines = [`${decided} model proposals decided: ${conf.length} confirmed, ${rej.length} rejected${decided ? ` (${pct}% confirmed)` : ''}; ${model.length - decided} still proposed`,
    `${decides.length} decide events (through the page), ${byFile} decided by file edit; items added by you are not counted`];
  if (!decided) lines.push('no proposal decided yet');
  return { pass: decided > 0 && conf.length * 2 >= decided, lines };
}

function quiet(events, transcript) {
  const asks = events.filter((e) => e.event === 'controller_ask');
  const stamps = transcript.filter(isMsg).map((l) => t(l.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < stamps.length; i++) { const gap = stamps[i] - stamps[i - 1]; if (gap <= SESSION_GAP_MS) ms += gap; }
  const hours = ms / 3600000;
  const allowed = Math.max(1, Math.ceil(hours));
  const lines = [`${asks.length} controller questions in ${hours.toFixed(1)} h of work${hours ? ` (${(asks.length / hours).toFixed(2)} per hour)` : ''}; allowed: ${allowed} (one per started hour, at least 1)`];
  if (asks.length) lines.push(`asked: ${asks.map((a) => `${a.module} ${hm(a.ts)}`).join(', ')}`);
  if (asks.length > allowed) lines.push(`${asks.length - allowed} more than allowed`);
  if (hours < 1) lines.push('needs at least 1 h of work to judge');
  return { pass: hours >= 1 && asks.length <= allowed, lines };
}

// Everything /stats and `npm run stats` print, from the dir alone. Read-only: never creates or writes a file.
function computeStats(dir) {
  const events = readJsonl(path.join(dir, 'metrics.jsonl'));
  const transcript = readJsonl(path.join(dir, 'transcript.jsonl'));
  const st = readJsonSafe(path.join(dir, 'state.json'), null);
  const items = st && Array.isArray(st.items) ? st.items.filter((i) => i && typeof i.id === 'string') : [];
  const mod = readJsonSafe(path.join(dir, 'modules.json'), {}) || {};
  const modules = { panes: Array.isArray(mod.panes) ? mod.panes : [], answers: mod.answers && typeof mod.answers === 'object' ? mod.answers : {} };
  const notes = [];
  if (fs.existsSync(path.join(dir, 'state.json')) && !st) notes.push('state.json is not valid JSON: signal counted without it');
  return {
    events: events.length, fixtureEvents: events.filter((e) => e.fixture === true).length,
    lines: transcript.length, fixtureLines: transcript.filter((l) => l.fixture === true).length, notes,
    measures: { continuity: continuity(events), consent: consent(events, modules), usefulness: usefulness(events, transcript),
      signal: signal(events, items), quiet: quiet(events, transcript) },
  };
}

function formatStats(s, label) {
  const out = [`P5 acceptance (pilot/cli-pilot-v1/04-build-plan.md), from metrics.jsonl and the files in ${label} (no model)`];
  if (s.fixtureEvents || s.fixtureLines) {
    out.push(`FIXTURE DATA: ${s.fixtureEvents} of ${s.events} metrics events and ${s.fixtureLines} of ${s.lines} transcript lines are synthetic demo data ("fixture": true), not a real week.`);
  }
  for (const n of s.notes) out.push(`note: ${n}`);
  let pass = 0;
  for (const [name, m] of Object.entries(s.measures)) {
    if (m.pass) pass++;
    out.push(`${name.padEnd(11)} ${(m.pass ? 'PASS' : 'NOT YET').padEnd(8)} ${THRESHOLDS[name]}`);
    for (const l of m.lines) out.push(`${' '.repeat(21)}${l}`);
  }
  const total = Object.keys(s.measures).length;
  out.push(`${pass} PASS, ${total - pass} NOT YET. Not measurable from files: "you never re-explained the project", the kill criterion.`);
  out.push('Work session: activity with no gap over 30 min. Hour of work: sum of gaps of at most 30 min between messages.');
  return out;
}

module.exports = { SESSION_GAP_MS, readJsonl, ledgerOf, provenance, withProvenance, paneInfo, consentFor, computeStats, formatStats, THRESHOLDS };
