#!/usr/bin/env node
// DEV ONLY. Writes demo/fixtures/v0.6/{transcript.jsonl, metrics.jsonl, state.json, modules.json, rules.json}:
// three synthetic work sessions (2026-10-14 to 10-16) on the insurance-claim topic, simulated with the same line and
// event shapes the server writes, so counts, timestamps and the item_write ledger agree. Every transcript line and
// metrics event carries "fixture": true (/stats labels them). demo.json and pilot.config.json are written by hand.
// Usage: node dev/make-fixture-v06.js   (deterministic: same output every run)
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'demo', 'fixtures', 'v0.6');
const RULES = [
  { module: 'index', metric: 'messages', threshold: 12, ask: '{n} messages. Scrolling back gets slow. Add an index pane?' },
  { module: 'map', metric: 'decisions', threshold: 2, ask: '{n} decisions so far. Add a reasoning map?' },
  { module: 'kanban', metric: 'tasks', threshold: 3, ask: '{n} tasks have come up. Track them on a board?' },
];
const transcript = [], metrics = [];
const state = { rev: 0, items: [] };
const modules = { rev: 0, panes: [], answers: {}, pending: null };
let clock = 0, seq = 0, cseq = 0;
const at = () => new Date(clock).toISOString();
const adv = (sec) => { clock += sec * 1000; };
const copy = (o) => JSON.parse(JSON.stringify(o));
const msgs = () => transcript.filter((l) => l.role === 'user' || l.role === 'assistant').length;
const live = (kind) => state.items.filter((i) => i.kind === kind && i.status !== 'rejected').length;

function line(role, text, model, extra = {}) {
  const l = { id: `m-f${String(++seq).padStart(3, '0')}`, ts: at(), role, text, model: model || null, ...extra, fixture: true };
  transcript.push(l);
  return l;
}
function ev(event, fields = {}) { metrics.push({ ts: at(), event, ...fields, fixture: true }); }
function start(day) {
  clock = Date.parse(day);
  ev('server_start', { pid: 40000 + metrics.length, lines: transcript.length, messages: msgs(), items: state.items.length,
    panes: modules.panes.filter((p) => ['yes', 'always'].includes((modules.answers[p.module] || {}).answer)).length,
    answers: Object.keys(modules.answers).length, fileErrors: [] });
  adv(60);
}
function ask(module) {
  const rule = RULES.find((r) => r.module === module);
  const n = rule.metric === 'messages' ? msgs() : live(rule.metric === 'decisions' ? 'decision' : 'task');
  line('controller', rule.ask.replace('{n}', n), null, { module });
  modules.pending = module; modules.rev++;
  ev('controller_ask', { module, metric: rule.metric, count: n, threshold: rule.threshold });
}
function answer(module, ans) {
  adv(8);
  const rule = RULES.find((r) => r.module === module);
  const n = rule.metric === 'messages' ? msgs() : live(rule.metric === 'decisions' ? 'decision' : 'task');
  const id = `c-f${String(++cseq).padStart(2, '0')}`;
  modules.answers[module] = { answer: ans, at: at(), count: n, consentId: id };
  const adds = ['yes', 'always'].includes(ans);
  if (adds) modules.panes.push({ module, addedAt: at(), atCount: n, rule: { metric: rule.metric, threshold: rule.threshold } });
  modules.pending = null; modules.rev++;
  const effect = { yes: 'pane added', always: 'pane added; will not ask again', no: 'will ask again when the count has doubled' }[ans];
  line('system', `${module}: ${ans}, ${effect}`, null);
  ev('consent', { id, module, answer: ans, count: n, metric: rule.metric });
  if (adds) ev('controller_add', { module, count: n, answer: ans, answerRef: id, answerAt: at() });
}
// One chat turn: user line, chat model call, assistant line, controller (optional ask), turn event, then extraction.
function turn(gapSec, user, reply, o = {}) {
  adv(gapSec);
  const u = line('user', user, null);
  adv(o.think || 24);
  ev('model_call', { role: 'chat', candidate: 'frontier', model: 'fake-frontier', ok: true, latencyMs: (o.think || 24) * 1000 - 300, chars: reply.length });
  const a = line('assistant', reply, 'frontier');
  if (o.ask) ask(o.ask);
  ev('turn', { ok: true, lines: transcript.length, messages: msgs() });
  if (!o.extract) return;
  adv(3);
  ev('model_call', { role: 'extract', candidate: 'morrow', model: 'fake-morrow', ok: true, latencyMs: 2600, chars: 180 });
  const ids = [];
  for (const it of o.extract) {
    const n = state.items.filter((i) => i.kind === it.kind).length + 1;
    const id = `${{ decision: 'dec', task: 'task', source: 'src' }[it.kind]}-${n}`;
    const from = (it.inUser ? u : a);
    if (!from.text.includes(it.quote)) throw new Error(`quote not in turn: ${it.quote}`);
    const item = { id, kind: it.kind, text: it.text, status: 'proposed', author: 'model', model: 'morrow', quote: it.quote, fromMessage: from.id, createdAt: at() };
    if (it.kind === 'task') item.column = 'todo';
    if (it.url) item.url = it.url;
    state.items.push(item); ids.push(id);
  }
  state.rev++;
  for (const id of ids) ev('item_write', { via: 'extract', itemId: id, item: copy(state.items.find((i) => i.id === id)) });
  ev('extract', { candidate: 'morrow', model: 'fake-morrow', fromMessage: a.id, returned: ids.length, proposed: ids.length, dropped: 0, ids, rev: state.rev, latencyMs: 2600 });
  if (o.askAfter) ask(o.askAfter);
}
function decide(id, d) {
  adv(20);
  const item = state.items.find((i) => i.id === id);
  item.status = d === 'c' ? 'confirmed' : 'rejected'; item.decidedAt = at(); item.decidedBy = 'user';
  state.rev++;
  ev('item_write', { via: 'decide', itemId: id, item: copy(item) });
  line('system', `${id} ${item.status}: ${item.text}`, null);
  ev('decide', { itemId: id, kind: item.kind, decision: item.status, decidedBy: 'user', author: 'model', model: 'morrow', rev: state.rev });
}
function jump(n) {   // n-th user/assistant message (1-based), as the index pane lists them
  adv(15);
  const target = transcript.filter((l) => l.role === 'user' || l.role === 'assistant')[n - 1];
  ev('index_jump', { target: target.id, position: transcript.indexOf(target) + 1, of: transcript.length });
}

// ---- session 1: 2026-10-14, 09:00 ----
start('2026-10-14T09:00:00.000Z');
turn(0, 'Let us dogfood the pilot on one real topic this week: my health insurance claim.',
  '[fixture] Good choice. Decision: dogfood the pilot on the insurance claim. It has deadlines, documents and a few decisions.',
  { extract: [{ kind: 'decision', text: 'dogfood the pilot on the insurance claim', quote: 'Decision: dogfood the pilot on the insurance claim.' }] });
turn(230, 'Decision: the claim stays on local models only. I do not want the invoices in the cloud.',
  '[fixture] Understood. The extract role runs on morrow, so the text stays on your network.',
  { extract: [{ kind: 'decision', text: 'the claim stays on local models only', quote: 'Decision: the claim stays on local models only.', inUser: true }], askAfter: 'map' });
answer('map', 'yes');
decide('dec-1', 'c'); decide('dec-2', 'c');
turn(200, 'What does the insurer need from me first?',
  '[fixture] Usually the itemised invoice, the referral and the claim form. Task: scan the hospital invoice.',
  { extract: [{ kind: 'task', text: 'scan the hospital invoice', quote: 'Task: scan the hospital invoice.' }] });
turn(260, 'The invoice is here, I will scan it tonight.',
  '[fixture] Fine. Their checklist is at https://example.org/claims/guide if you want to tick things off.',
  { extract: [{ kind: 'source', text: 'insurer claim checklist', quote: 'https://example.org/claims/guide', url: 'https://example.org/claims/guide' }] });
turn(240, 'Should we write the letter with a paid cloud model? It writes better German.',
  '[fixture] That would break your local-only decision. Decision: use a paid cloud model for the letter. Only if you change your mind.',
  { extract: [{ kind: 'decision', text: 'use a paid cloud model for the letter', quote: 'Decision: use a paid cloud model for the letter.' }] });
decide('dec-3', 'r');
turn(180, 'No, keep it local. The letter can be plain.', '[fixture] Then morrow drafts it and you polish it.', { ask: 'index' });
answer('index', 'no');
turn(300, 'When is the deadline exactly?', '[fixture] The letter says 30 days from the invoice date, so 2026-11-06.');
turn(220, 'Good. That is enough for today.', '[fixture] Summary: two decisions, one task, the deadline is 2026-11-06.');
decide('task-1', 'c');

// ---- session 2: 2026-10-15, 14:00 ----
start('2026-10-15T14:00:00.000Z');
turn(0, 'Back on the claim. I scanned the invoice yesterday.',
  '[fixture] Good. Next is the call. Task: call the insurer about the deadline.',
  { extract: [{ kind: 'task', text: 'call the insurer about the deadline', quote: 'Task: call the insurer about the deadline.' }] });
turn(270, 'I called. They want the referral letter as well.',
  '[fixture] Then the referral goes with the claim. Decision: send the referral together with the claim.',
  { extract: [{ kind: 'decision', text: 'send the referral together with the claim', quote: 'Decision: send the referral together with the claim.' }] });
turn(190, 'Can you remind me what we decided about the models?', '[fixture] dec-2: the claim stays on local models only.');
turn(240, 'Right. Let us draft the letter now.',
  '[fixture] A first outline: greeting, claim number, the three documents, one sentence on the deadline. Task: draft the claim letter.',
  { ask: 'index', extract: [{ kind: 'task', text: 'draft the claim letter', quote: 'Task: draft the claim letter.' }] });
answer('index', 'yes');
jump(4); jump(10);
turn(260, 'Decision: send it by registered mail, not the portal.',
  '[fixture] Registered mail gives you a receipt with a date on it.',
  { ask: 'kanban', extract: [{ kind: 'decision', text: 'send it by registered mail', quote: 'Decision: send it by registered mail, not the portal.', inUser: true }] });
answer('kanban', 'no');
decide('task-2', 'c'); decide('dec-4', 'c'); decide('dec-5', 'c'); decide('task-3', 'c');
turn(230, 'Should I also ask the hospital for an itemised bill?',
  '[fixture] Only if the insurer asks for it. Decision: ask the hospital for an itemised bill. I would wait.',
  { extract: [{ kind: 'decision', text: 'ask the hospital for an itemised bill', quote: 'Decision: ask the hospital for an itemised bill.' }] });
decide('dec-6', 'r');
turn(200, 'Agreed, we wait. Enough for today.', '[fixture] Summary: invoice scanned, insurer called, letter outlined, registered mail.');

// ---- session 3: 2026-10-16, 10:00 ----
start('2026-10-16T10:00:00.000Z');
turn(0, 'Letter day. Task: print the claim form.',
  '[fixture] Noted. Task: sign the claim form after printing.',
  { extract: [{ kind: 'task', text: 'print the claim form', quote: 'Task: print the claim form.', inUser: true },
    { kind: 'task', text: 'sign the claim form after printing', quote: 'Task: sign the claim form after printing.' }] });
turn(250, 'The referral is a photocopy, is that fine?',
  '[fixture] Most insurers accept a copy. Task: ask the insurer whether a copy of the referral is enough.',
  { extract: [{ kind: 'task', text: 'ask whether a copy of the referral is enough', quote: 'Task: ask the insurer whether a copy of the referral is enough.' }], askAfter: 'kanban' });
answer('kanban', 'always');
turn(210, 'Decision: keep a copy of everything in one folder.',
  '[fixture] One folder makes the receipt easy to find later.',
  { extract: [{ kind: 'decision', text: 'keep a copy of everything in one folder', quote: 'Decision: keep a copy of everything in one folder.', inUser: true }] });
turn(230, 'Should the letter mention the 30-day deadline?',
  '[fixture] Yes, in one sentence. Decision: mention the deadline in the first paragraph.',
  { extract: [{ kind: 'decision', text: 'mention the deadline in the first paragraph', quote: 'Decision: mention the deadline in the first paragraph.' }] });
turn(260, 'Decision: write the letter in English.',
  '[fixture] Your insurer writes in German; I would answer in German.',
  { extract: [{ kind: 'decision', text: 'write the letter in English', quote: 'Decision: write the letter in English.', inUser: true }] });
decide('dec-9', 'r');
turn(240, 'Fine, German. Let me look back at the outline.', '[fixture] The outline is in yesterday\'s reply about drafting the letter.');
jump(16); jump(18);
turn(200, 'Done for today, thanks.', '[fixture] Tomorrow: print, sign, send.');

// ---- hand edits after session 3 (the server was not running): state.json changed in an editor ----
// dec-8 confirmed by hand, task-1 and task-2 moved to done by hand, task-7 added by hand. No ledger entry for these
// changes, so the page and /stats show them as "you (file edit)". (No file_edit events: nobody was watching.)
clock = Date.parse('2026-10-16T18:30:00.000Z');
state.items.find((i) => i.id === 'dec-8').status = 'confirmed';
state.items.find((i) => i.id === 'task-1').column = 'done';
state.items.find((i) => i.id === 'task-2').column = 'done';
state.items.push({ id: 'task-7', kind: 'task', text: 'buy envelopes and stamps', status: 'confirmed', author: 'user', createdAt: at(), column: 'todo' });

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'transcript.jsonl'), jsonl(transcript));
fs.writeFileSync(path.join(OUT, 'metrics.jsonl'), jsonl(metrics));
fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'modules.json'), JSON.stringify(modules, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify({ rev: 1, rules: RULES, afterNo: 'ask again when the count has doubled',
  _notes: ['Edit by hand; the controller reads this file on every turn.', 'decisions and tasks count proposed and confirmed items, not rejected ones.',
    'Demo fixture v0.6 (synthetic, see dev/make-fixture-v06.js): all three panes already added through the controller and your answers.'] }, null, 2) + '\n');
console.log(`wrote ${transcript.length} transcript lines, ${metrics.length} metrics events, ${state.items.length} items to ${path.relative(process.cwd(), OUT)}/`);
