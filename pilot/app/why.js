// CLI Pilot (pilot-v0.7): /why explains the current workbench from the files in a pilot dir only (no model, no
// guessing, no writes). For each pane: which rule grew it, every question the controller asked (count, threshold,
// the question line), every answer and who gave it, and how the pane was added. For each item: its origin (author,
// model, the message it came from, the quote), who decided it and when, and what was changed by hand.
// Every statement cites where it was read: `file:line id` for JSONL lines (physical line numbers, 1-based) and
// `file:line path` for JSON entries (the line of the entry in the file as it is now; the path alone if not found).
// A fact that is not recorded is said plainly ("no recorded answer", "when is not recorded").
// The Observstory idea `explain_frame` ("why does my screen look like this?") applied to this pilot.
// Node 20+, no dependencies. server.js requires it for /why.
'use strict';
const fs = require('fs');
const path = require('path');
const stats = require('./stats.js');

const MODULES = ['index', 'map', 'kanban'];   // panes this build can show (server.js BUILT)
const TITLES = { chat: 'chat', index: 'index', map: 'reasoning map', kanban: 'kanban' };
const WHO = { user: 'you', assistant: 'model', system: 'system', controller: 'controller' };

// ---- reading, with line numbers ----
function readRaw(file) {
  try { return { raw: fs.readFileSync(file, 'utf8') }; } catch (e) { return e.code === 'ENOENT' ? { missing: true, raw: '' } : { error: e.message, raw: '' }; }
}
// JSONL -> [{n, obj}] with n = physical line number (blank and broken lines are skipped but keep their numbers)
function readJsonlNumbered(file) {
  const r = readRaw(file);
  const rows = [];
  r.raw.split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    try { rows.push({ n: i + 1, obj: JSON.parse(l) }); } catch { /* a broken hand-edited line is skipped */ }
  });
  return { rows, missing: !!r.missing };
}
function readJsonDoc(file) {
  const r = readRaw(file);
  if (r.missing) return { missing: true, raw: '' };
  if (r.error) return { error: `${path.basename(file)}: ${r.error}`, raw: '' };
  try { return { doc: JSON.parse(r.raw), raw: r.raw }; } catch (e) { return { error: `${path.basename(file)} is not valid JSON: ${e.message}`, raw: r.raw }; }
}
// The first line of `raw` that matches `re` (after line `from`), 1-based, or null.
function lineOf(raw, re, from = 0) {
  const ls = raw.split('\n');
  for (let i = from; i < ls.length; i++) if (re.test(ls[i])) return i + 1;
  return null;
}
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- citations ----
// A statement: {text, cite: [string], msg?: message id the page can scroll to}. A heading: {text, head: true}.
const jl = (file, row, label) => `${file}:${row.n} ${label}`;
function inFile(ctx, file, re, label) {
  const raw = (ctx.raw[file] || '');
  const n = re ? lineOf(raw, re) : null;
  return n ? `${file}:${n} ${label}` : `${file} ${label}`;
}
const itemCite = (ctx, id) => inFile(ctx, 'state.json', new RegExp(`"id"\\s*:\\s*"${esc(id)}"`), `items ${id}`);
const answerCite = (ctx, mod) => {
  const raw = ctx.raw['modules.json'] || '';
  const a = lineOf(raw, /"answers"\s*:/);
  const n = a ? lineOf(raw, new RegExp(`^\\s*"${esc(mod)}"\\s*:`), a) : null;
  return n ? `modules.json:${n} answers.${mod}` : `modules.json answers.${mod}`;
};
const paneCite = (ctx, mod) => inFile(ctx, 'modules.json', new RegExp(`"module"\\s*:\\s*"${esc(mod)}"`), `panes ${mod}`);
const ruleCite = (ctx, mod) => inFile(ctx, 'rules.json', new RegExp(`"module"\\s*:\\s*"${esc(mod)}"`), `rules ${mod}`);

function load(dir) {
  const ctx = { dir, raw: {} };
  const tr = readJsonlNumbered(path.join(dir, 'transcript.jsonl'));
  const me = readJsonlNumbered(path.join(dir, 'metrics.jsonl'));
  ctx.lines = tr.rows; ctx.events = me.rows;
  for (const [key, file] of [['modules', 'modules.json'], ['state', 'state.json'], ['rules', 'rules.json']]) {
    const r = readJsonDoc(path.join(dir, file));
    ctx.raw[file] = r.raw;
    ctx[key] = r;
  }
  const m = ctx.modules.doc && typeof ctx.modules.doc === 'object' ? ctx.modules.doc : {};
  ctx.panes = Array.isArray(m.panes) ? m.panes.filter((p) => p && typeof p.module === 'string') : [];
  ctx.answers = m.answers && typeof m.answers === 'object' ? m.answers : {};
  ctx.pending = m.pending || null;
  const s = ctx.state.doc && typeof ctx.state.doc === 'object' ? ctx.state.doc : {};
  ctx.items = Array.isArray(s.items) ? s.items.filter((i) => i && typeof i.id === 'string' && typeof i.kind === 'string') : [];
  const r = ctx.rules.doc && typeof ctx.rules.doc === 'object' ? ctx.rules.doc : {};
  ctx.rules.list = Array.isArray(r.rules) ? r.rules : [];
  return ctx;
}

const ev = (ctx, pred) => ctx.events.filter((r) => r.obj && pred(r.obj));
const msgRow = (ctx, id) => ctx.lines.find((r) => r.obj && r.obj.id === id) || null;
const author = (line) => (line.role === 'assistant' ? `model${line.model ? ` · ${line.model}` : ''}` : WHO[line.role] || line.role);
const norm = (t) => String(t).replace(/\s+/g, ' ').trim().toLowerCase();
const shown = (ctx, mod) => ctx.panes.some((p) => p.module === mod) && ['yes', 'always'].includes((ctx.answers[mod] || {}).answer);

// The controller line that asked: same module and the same timestamp as the controller_ask event (the server writes
// both with one ts); null when it is not in the transcript (cut or edited by hand).
function questionLine(ctx, ask) {
  return ctx.lines.find((r) => r.obj.role === 'controller' && r.obj.module === ask.module && r.obj.ts === ask.ts) || null;
}

// ---- panes ----
function paneHistory(ctx, mod) {
  const out = [];
  for (const row of ev(ctx, (e) => e.module === mod && ['controller_ask', 'consent', 'controller_add'].includes(e.event))) {
    const e = row.obj;
    if (e.event === 'controller_ask') {
      const q = questionLine(ctx, e);
      out.push({ text: `the controller asked at ${e.ts}: ${e.count} ${e.metric} reached the threshold ${e.threshold}`
        + (q ? `, "${q.obj.text}"` : ' (the question line is not in transcript.jsonl)'),
        cite: [jl('metrics.jsonl', row, 'controller_ask'), ...(q ? [jl('transcript.jsonl', q, q.obj.id)] : [])], ...(q ? { msg: q.obj.id } : {}) });
    } else if (e.event === 'consent') {
      out.push({ text: `you answered "${e.answer}" at ${e.ts} (count ${e.count})`, cite: [jl('metrics.jsonl', row, `consent ${e.id || ''}`.trim())] });
    } else {
      const ref = e.answerRef ? ev(ctx, (c) => c.event === 'consent' && c.id === e.answerRef)[0] : null;
      out.push({ text: `the controller added the pane at ${e.ts} at count ${e.count}, allowed by your answer "${e.answer}"`
        + (e.answerRef ? ` (${e.answerRef}${ref ? '' : ', not found in metrics.jsonl'})` : ' (no answer id: older data)'),
        cite: [jl('metrics.jsonl', row, 'controller_add'), ...(ref ? [jl('metrics.jsonl', ref, `consent ${e.answerRef}`)] : [])] });
    }
  }
  return out;
}

function ruleFacts(ctx, mod, entry) {
  const out = [];
  const idx = ctx.rules.list.findIndex((r) => r && r.module === mod);
  const now = idx >= 0 ? ctx.rules.list[idx] : null;
  if (entry && entry.rule && entry.rule.metric) {
    const same = now && now.metric === entry.rule.metric && now.threshold === entry.rule.threshold;
    out.push({ text: `rule recorded with the pane: ${entry.rule.metric} ≥ ${entry.rule.threshold ?? '?'}${same ? ' (rules.json says the same now)' : ''}`,
      cite: [paneCite(ctx, mod) + '.rule', ...(same ? [ruleCite(ctx, mod)] : [])] });
    if (now && !same) {
      out.push({ text: `rules.json says ${now.metric} ≥ ${now.threshold} now (changed after the pane was added)`, cite: [ruleCite(ctx, mod)] });
    }
  } else if (now) {
    out.push({ text: `rule: ${now.metric} ≥ ${now.threshold} (from rules.json now; the pane entry records no rule)`, cite: [ruleCite(ctx, mod), ...(entry ? [paneCite(ctx, mod)] : [])] });
  } else {
    out.push({ text: `no rule for ${mod} in rules.json${entry ? ' and none recorded with the pane' : ''}`, cite: [ctx.rules.error ? 'rules.json (not valid JSON)' : 'rules.json rules', ...(entry ? [paneCite(ctx, mod)] : [])] });
  }
  return out;
}

// The answer in modules.json and whether metrics.jsonl has its consent event.
function answerFacts(ctx, mod) {
  const ans = ctx.answers[mod];
  if (!ans || typeof ans !== 'object') return [{ text: 'no recorded answer', cite: [`modules.json answers.${mod} (absent)`] }];
  const c = stats.consentFor(mod, ans, ctx.events.map((r) => r.obj));
  const row = c ? ctx.events.find((r) => r.obj === c) : null;
  if (row) return [{ text: `answer on file: "${ans.answer}" at ${ans.at}, given by you (recorded: consent ${c.id || c.ts})`, cite: [answerCite(ctx, mod), jl('metrics.jsonl', row, `consent ${c.id || ''}`.trim())] }];
  return [{ text: `answer on file: "${ans.answer}"${ans.at ? ` (says ${ans.at})` : ''}, but no consent event matches it: written by file edit, when is not recorded`,
    cite: [answerCite(ctx, mod), `metrics.jsonl (no consent ${ans.consentId || mod})`] }];
}

function explainPane(ctx, mod) {
  const out = [{ head: true, text: `${mod} pane${TITLES[mod] && TITLES[mod] !== mod ? ` (${TITLES[mod]})` : ''}` }];
  if (mod === 'chat') {
    out.push({ text: 'always there: the chat is not grown by a rule and needs no answer', cite: ['modules.json panes (chat is never listed)'] });
    return out;
  }
  if (ctx.modules.error) { out.push({ text: `cannot explain: ${ctx.modules.error} (fix the file by hand)`, cite: ['modules.json'] }); return out; }
  const entry = ctx.panes.find((p) => p.module === mod) || null;
  const ans = ctx.answers[mod];
  if (shown(ctx, mod)) out.push({ text: `shown: listed in modules.json and answered "${ans.answer}"`, cite: [paneCite(ctx, mod), answerCite(ctx, mod)] });
  else if (entry) out.push({ text: `not shown: listed in modules.json, but ${ans ? `the answer is "${ans.answer}"` : 'there is no recorded answer'} (a pane needs yes or always)`, cite: [paneCite(ctx, mod), ans ? answerCite(ctx, mod) : `modules.json answers.${mod} (absent)`] });
  else if (ctx.pending === mod) out.push({ text: 'not shown: the controller is asking now', cite: [inFile(ctx, 'modules.json', /"pending"\s*:/, 'pending')] });
  else out.push({ text: 'not shown: not listed in modules.json', cite: ['modules.json panes'] });
  out.push(...ruleFacts(ctx, mod, entry));
  const hist = paneHistory(ctx, mod);
  out.push(...hist);
  if (!hist.length) out.push({ text: 'no question, answer or add for this pane in metrics.jsonl', cite: ['metrics.jsonl'] });
  out.push(...answerFacts(ctx, mod));
  if (entry && !ev(ctx, (e) => e.event === 'controller_add' && e.module === mod).length) {
    out.push({ text: `the pane entry has no controller_add event: added by file edit, when is not recorded${entry.addedAt ? ` (the entry says addedAt ${entry.addedAt})` : ''}`, cite: [paneCite(ctx, mod), 'metrics.jsonl (no controller_add)'] });
  }
  return out;
}

// ---- items ----
function fileEditFor(ctx, id, test) {
  const rows = ev(ctx, (e) => e.event === 'file_edit' && e.itemId === id && test(e));
  return rows.length ? rows[rows.length - 1] : null;
}
const when = (row) => (row ? ` at ${row.obj.ts}` : ', when is not recorded (no file_edit event in metrics.jsonl)');
const whenCite = (row, label) => (row ? [jl('metrics.jsonl', row, `file_edit ${label}`)] : []);
const fmt = (v) => (v === undefined ? '(none)' : JSON.stringify(v));

function explainItem(ctx, it) {
  const status = it.status || 'confirmed';
  const out = [{ head: true, text: `${it.id} (${it.kind}): "${it.text}", ${status}` }];
  const writes = ev(ctx, (e) => e.event === 'item_write' && e.itemId === it.id);
  const last = writes.length ? writes[writes.length - 1] : null;
  const prov = stats.provenance(it, last && last.obj);
  const first = writes[0] || null;

  // origin
  if (first && first.obj.via === 'extract' && !first.obj.addedByFile) {
    const ex = ev(ctx, (e) => e.event === 'extract' && Array.isArray(e.ids) && e.ids.includes(it.id))[0];
    out.push({ text: `proposed by model ${first.obj.item.model || '?'} at ${first.obj.ts} (extraction${ex ? `, candidate ${ex.obj.candidate}, model id ${ex.obj.model}` : ''})`,
      cite: [jl('metrics.jsonl', first, `item_write ${it.id}`), ...(ex ? [jl('metrics.jsonl', ex, 'extract')] : [])] });
  } else if (prov && prov.added) {
    const fe = fileEditFor(ctx, it.id, (e) => e.added === true);
    out.push({ text: `added by you (file edit)${when(fe)}${fe ? '' : `; the file says createdAt ${it.createdAt || '(none)'}`}`, cite: [itemCite(ctx, it.id), ...whenCite(fe, it.id)] });
  } else if (!first) {
    out.push({ text: `the file says author ${it.author || '(none)'}${it.model ? ` · ${it.model}` : ''}; the server never wrote it (no item_write in metrics.jsonl: older data or a file edit)`,
      cite: [itemCite(ctx, it.id), `metrics.jsonl (no item_write ${it.id})`] });
  } else {
    out.push({ text: `first written by the server at ${first.obj.ts} (${first.obj.via})`, cite: [jl('metrics.jsonl', first, `item_write ${it.id}`)] });
  }

  // the message it came from, and the quote
  if (it.fromMessage) {
    const m = msgRow(ctx, it.fromMessage);
    if (m) {
      out.push({ text: `from message ${it.fromMessage} by ${author(m.obj)} at ${m.obj.ts}`, cite: [jl('transcript.jsonl', m, it.fromMessage)], msg: it.fromMessage });
      if (it.quote !== undefined) {
        const found = norm(m.obj.text).includes(norm(it.quote));
        out.push({ text: `quote "${it.quote}" ${found ? 'is in that message' : 'is NOT in that message (one of them was edited)'}`, cite: [itemCite(ctx, it.id), jl('transcript.jsonl', m, it.fromMessage)], msg: it.fromMessage });
      }
    } else {
      out.push({ text: `from message ${it.fromMessage}, which is not in transcript.jsonl`, cite: [itemCite(ctx, it.id), 'transcript.jsonl'] });
      if (it.quote !== undefined) out.push({ text: `quote "${it.quote}"`, cite: [itemCite(ctx, it.id)] });
    }
  } else {
    out.push({ text: 'no source message recorded', cite: [itemCite(ctx, it.id)] });
  }

  // decision
  const fields = prov ? prov.fields : [];
  const decides = ev(ctx, (e) => e.event === 'decide' && e.itemId === it.id);
  for (const d of decides) out.push({ text: `${d.obj.decision} by ${d.obj.decidedBy === 'user' ? 'you' : d.obj.decidedBy} at ${d.obj.ts} (through the page)`, cite: [jl('metrics.jsonl', d, `decide ${it.id}`)] });
  if (fields.includes('status') || (prov && prov.added && it.author !== 'model')) {
    const fe = fileEditFor(ctx, it.id, (e) => (e.fields || []).includes('status') || e.added === true);
    const was = last ? ` (the server last wrote ${fmt(last.obj.item.status)})` : '';
    out.push({ text: `status "${status}" set by you (file edit)${when(fe)}${was}`, cite: [itemCite(ctx, it.id), ...(last ? [jl('metrics.jsonl', last, `item_write ${it.id}`)] : []), ...whenCite(fe, it.id)] });
  } else if (status === 'proposed') {
    out.push({ text: 'not decided yet: proposed (c confirms, r rejects on the focused card)', cite: [itemCite(ctx, it.id)] });
  } else if (!decides.length) {
    out.push({ text: `status "${status}": no decide event in metrics.jsonl${it.decidedBy ? `; the file says decidedBy ${it.decidedBy}${it.decidedAt ? ` at ${it.decidedAt}` : ''}` : ''}`, cite: [itemCite(ctx, it.id), `metrics.jsonl (no decide ${it.id})`] });
  }

  // other fields changed by hand
  for (const f of fields.filter((x) => !['status', 'decidedAt', 'decidedBy'].includes(x))) {
    const fe = fileEditFor(ctx, it.id, (e) => (e.fields || []).includes(f));
    const was = last ? `the server wrote ${fmt(last.obj.item[f])}, ` : '';
    out.push({ text: `${f} edited by you (file edit)${when(fe)}: ${was}the file says ${fmt(it[f])}`, cite: [itemCite(ctx, it.id), ...(last ? [jl('metrics.jsonl', last, `item_write ${it.id}`)] : []), ...whenCite(fe, it.id)] });
  }
  return out;
}

// ---- the whole workbench, compact ----
function explainFrame(ctx) {
  const out = [{ head: true, text: `why the workbench looks like this (from the files in ${ctx.label}, no model)` }];
  if (ctx.modules.error) out.push({ text: `${ctx.modules.error}: panes cannot be explained until it is fixed`, cite: ['modules.json'] });
  const vis = MODULES.filter((m) => shown(ctx, m));
  out.push({ text: `panes: chat${vis.map((m) => ` + ${m}`).join('')} (chat is always there)`, cite: ['modules.json panes', 'modules.json answers'] });
  for (const mod of MODULES) {
    const entry = ctx.panes.find((p) => p.module === mod) || null;
    const ans = ctx.answers[mod];
    const add = ev(ctx, (e) => e.event === 'controller_add' && e.module === mod).pop();
    if (shown(ctx, mod)) {
      const rule = entry.rule && entry.rule.metric ? `${entry.rule.metric} ≥ ${entry.rule.threshold}` : 'no rule recorded';
      const c = stats.consentFor(mod, ans, ctx.events.map((r) => r.obj));
      const crow = c ? ctx.events.find((r) => r.obj === c) : null;
      const ask = ev(ctx, (e) => e.event === 'controller_ask' && e.module === mod && (!crow || Date.parse(e.ts) <= Date.parse(crow.obj.ts))).pop();
      const q = ask ? questionLine(ctx, ask.obj) : null;
      const asked = ask ? `asked at ${ask.obj.count} ${ask.obj.metric} (${ask.obj.ts})` : 'no question recorded';
      const said = crow ? `you said ${crow.obj.answer} (${crow.obj.ts})` : `answer "${ans.answer}" written by file edit (no consent event)`;
      const added = add ? `added by the controller${add.obj.answer === 'always' && crow && add.obj.ts !== crow.obj.ts ? ` at ${add.obj.ts} (always)` : ''}` : 'added by file edit (no controller_add)';
      out.push({ text: `${mod}: ${rule}; ${asked}; ${said}; ${added}`,
        cite: [paneCite(ctx, mod) + '.rule', ...(ctx.rules.list.some((r) => r && r.module === mod && entry.rule && r.metric === entry.rule.metric && r.threshold === entry.rule.threshold) ? [ruleCite(ctx, mod)] : []), ...(ask ? [jl('metrics.jsonl', ask, 'controller_ask')] : []), ...(q ? [jl('transcript.jsonl', q, q.obj.id)] : []),
          crow ? jl('metrics.jsonl', crow, `consent ${crow.obj.id || ''}`.trim()) : answerCite(ctx, mod), ...(add ? [jl('metrics.jsonl', add, 'controller_add')] : [])],
        ...(q ? { msg: q.obj.id } : {}) });
    } else if (entry || ans || ctx.pending === mod) {
      const why = entry && !ans ? 'listed in modules.json without a recorded answer' : ctx.pending === mod ? 'the controller is asking now'
        : `you answered "${ans.answer}" at ${ans.count}${ans.answer === 'no' ? ' (asks again when the count has doubled)' : ''}`;
      out.push({ text: `${mod} not shown: ${why}`, cite: [entry ? paneCite(ctx, mod) : ans ? answerCite(ctx, mod) : inFile(ctx, 'modules.json', /"pending"\s*:/, 'pending')] });
    }
  }
  if (ctx.state.error) out.push({ text: `${ctx.state.error}: items cannot be explained until it is fixed`, cite: ['state.json'] });
  else if (ctx.items.length) {
    const events = ctx.events.map((r) => r.obj);
    const led = stats.ledgerOf(events);
    const byExtract = [], byFile = [], undeclared = [], statusByFile = [], edited = [];
    for (const it of ctx.items) {
      const first = ctx.events.find((r) => r.obj.event === 'item_write' && r.obj.itemId === it.id);
      const p = stats.provenance(it, led.get(it.id));
      if (first && first.obj.via === 'extract' && !first.obj.addedByFile) byExtract.push(it.id);
      else if (p && p.added) byFile.push(it.id);
      else undeclared.push(it.id);
      if (p && p.fields.includes('status')) statusByFile.push(it.id);
      if (p && p.fields.some((f) => !['status', 'decidedAt', 'decidedBy'].includes(f))) edited.push(it.id);
    }
    const n = (s) => ctx.items.filter((i) => (i.status || 'confirmed') === s).length;
    const writes = ev(ctx, (e) => e.event === 'item_write' && e.via === 'extract');
    const decides = ev(ctx, (e) => e.event === 'decide');
    out.push({ text: `${ctx.items.length} items: ${byExtract.length} proposed by a model (extraction)${byFile.length ? `, ${byFile.length} added by you (file edit): ${byFile.join(', ')}` : ''}`
      + `${undeclared.length ? `, ${undeclared.length} never written by the server: ${undeclared.join(', ')}` : ''}`,
      cite: [inFile(ctx, 'state.json', /"items"\s*:/, 'items'), `metrics.jsonl item_write via extract ×${writes.length}${writes.length ? ` (lines ${writes[0].n}–${writes[writes.length - 1].n})` : ''}`] });
    out.push({ text: `${n('confirmed')} confirmed, ${n('rejected')} rejected, ${n('proposed')} proposed; ${decides.length} decided by you through the page`
      + `${statusByFile.length ? `, status set by file edit: ${statusByFile.join(', ')}` : ''}${edited.length ? `; other fields edited by file edit: ${edited.join(', ')}` : ''}`,
      cite: [inFile(ctx, 'state.json', /"items"\s*:/, 'items'), `metrics.jsonl decide ×${decides.length}`] });
  } else out.push({ text: 'no items yet', cite: [ctx.state.missing ? 'state.json (absent)' : 'state.json items'] });
  out.push({ head: true, text: 'details: /why <pane> (index, map, kanban, chat) or /why <item id> (e.g. /why dec-2)' });
  return out;
}

// /why [target] -> {ok, statements} ; formatted to text lines by format().
function explain(dir, target, label) {
  const ctx = load(dir);
  ctx.label = label || dir;
  const t = String(target || '').trim();
  if (!t) return { ok: true, statements: explainFrame(ctx) };
  const mod = Object.keys(TITLES).find((m) => m === t.toLowerCase() || TITLES[m] === t.toLowerCase());
  if (mod) return { ok: true, statements: explainPane(ctx, mod) };
  const it = ctx.items.find((i) => i.id === t);
  if (it) return { ok: true, statements: explainItem(ctx, it) };
  const ids = ctx.items.map((i) => i.id);
  return { ok: false, statements: [{ head: true, text: `nothing called "${t}". Panes: chat, ${MODULES.join(', ')}. Items: ${ids.join(', ') || 'none'}${ctx.state.error ? ` (${ctx.state.error})` : ''}` }] };
}

// Plain text: a heading as is; a statement indented, its sources in brackets.
function format(statements) {
  return statements.map((s) => (s.head ? s.text : `  ${s.text}  [${s.cite.join('; ')}]`));
}

module.exports = { explain, format };
