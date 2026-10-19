#!/usr/bin/env node
// DEV ONLY. Writes demo/fixtures/v0.13/: a projects home (PILOT_HOME) with two projects.
//   health-insurance-claim/  "health insurance claim": the v0.12 fixture's data files copied byte for byte (three chats
//                            and an archived one, the shared kanban with eleven tasks)
//   move-flat/               "move flat": synthetic, two chats ("flat search" = main, named by you; "boxes", named by
//                            morrow), a small board of its own: one decision on the map, four tasks on the kanban, both
//                            panes consented (controller_ask, consent, controller_add in its metrics.jsonl) and every
//                            item in the item_write ledger, so nothing reads "you (file edit)"
//   projects.json            both, health insurance claim first
// pilot.config.json: the v0.12 demo config on demo ports (server 4790, fakes 5800/5801). Every synthetic line carries
// "fixture": true. demo.json is written by hand. Usage: node dev/make-fixture-v13.js   (deterministic)
'use strict';
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'demo', 'fixtures');
const SRC = path.join(FIX, 'v0.12'), OUT = path.join(FIX, 'v0.13');
const A = path.join(OUT, 'health-insurance-claim'), B = path.join(OUT, 'move-flat');
fs.mkdirSync(path.join(B, 'chats'), { recursive: true });
fs.mkdirSync(A, { recursive: true });
const line = (o) => JSON.stringify({ ...o, fixture: true });
const write = (f, s) => fs.writeFileSync(f, s);
const jsonOut = (o) => JSON.stringify(o, null, 2) + '\n';

// ---- project A: the v0.12 project, byte for byte ----
for (const f of ['transcript.jsonl', 'metrics.jsonl', 'state.json', 'modules.json', 'rules.json', 'chats.json']) fs.copyFileSync(path.join(SRC, f), path.join(A, f));
fs.cpSync(path.join(SRC, 'chats'), path.join(A, 'chats'), { recursive: true });

// ---- project B: move flat ----
const ts = (d, h, m, s) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
let n = 0;
const id = () => `m-g${String(++n).padStart(3, '0')}`;
const main = [], boxes = [], metrics = [], items = [];
let srev = 0;
const ev = (o) => metrics.push(line(o));
ev({ ts: ts(16, 18, 0, 0), event: 'server_start', pid: 1, lines: 0, messages: 0, items: 0, panes: 0, answers: 0, fileErrors: [] });
function turn(file, chat, t, user, reply) {
  const u = { id: id(), ts: t[0], role: 'user', text: user, model: null };
  const a = { id: id(), ts: t[1], role: 'assistant', text: `[fixture] ${reply}`, model: 'frontier' };
  file.push(u, a);
  const all = main.length + boxes.length;
  ev({ ts: t[1], event: 'model_call', role: 'chat', candidate: 'frontier', model: 'fake-frontier', ok: true, latencyMs: 900, chars: a.text.length });
  ev({ ts: t[1], event: 'turn', ok: true, lines: all, messages: all, ...(chat !== 'main' ? { chat } : {}) });
  return [u, a];
}
function propose(kind, text, quote, from, at, chat, extra = {}) {
  const pre = { decision: 'dec', task: 'task' }[kind];
  const item = { id: `${pre}-${items.filter((i) => i.kind === kind).length + 1}`, kind, text, status: 'proposed', author: 'model', model: 'morrow',
    quote, fromMessage: from.id, createdAt: at, ...(chat ? { fromChat: chat } : {}), ...(kind === 'task' ? { column: 'todo' } : {}) };
  items.push(item); srev++;
  ev({ ts: at, event: 'item_write', via: 'extract', itemId: item.id, item: JSON.parse(JSON.stringify(item)) });
  ev({ ts: at, event: 'extract', candidate: 'morrow', model: 'fake-morrow', fromMessage: from.id, returned: 1, proposed: 1, dropped: 0, ids: [item.id], rev: srev, latencyMs: 300 });
  Object.assign(item, extra);
  return item;
}
function decide(item, at) {
  item.status = 'confirmed'; item.decidedAt = at; item.decidedBy = 'user'; srev++;
  ev({ ts: at, event: 'item_write', via: 'decide', itemId: item.id, item: JSON.parse(JSON.stringify(item)) });
  ev({ ts: at, event: 'decide', itemId: item.id, kind: item.kind, decision: 'confirmed', decidedBy: 'user', author: 'model', model: 'morrow', rev: srev });
}
const panes = [], answers = {};
let mrev = 0;
function consent(mod, metric, threshold, count, askAt, ansAt, file, cid, turnNo) {
  file.push({ id: id(), ts: askAt, role: 'controller', text: { map: `${count} decisions so far. Add a reasoning map?`, kanban: `${count} tasks have come up. Track them on a board?` }[mod], model: null, module: mod });
  ev({ ts: askAt, event: 'controller_ask', module: mod, metric, count, threshold });
  file.push({ id: id(), ts: ansAt, role: 'system', text: `${mod}: yes, pane added`, model: null });
  ev({ ts: ansAt, event: 'consent', id: cid, module: mod, answer: 'yes', count, metric });
  ev({ ts: ansAt, event: 'controller_add', module: mod, count, answer: 'yes', answerRef: cid, answerAt: ansAt });
  answers[mod] = { answer: 'yes', at: ansAt, count, consentId: cid };
  panes.push({ module: mod, addedAt: ansAt, atCount: count, rule: { metric, threshold }, lastTouch: { at: ansAt, turn: turnNo, how: 'added' } });
  mrev += 2;
}

// main: "flat search"
let [u, a] = turn(main, 'main', [ts(16, 18, 1, 0), ts(16, 18, 1, 20)], 'We move flat at the end of November. Decision: we take the flat on Lindenstrasse.', 'Congratulations. Decision: we take the flat on Lindenstrasse. Let us list what has to happen before the move.');
const d1 = propose('decision', 'we take the flat on Lindenstrasse', 'Decision: we take the flat on Lindenstrasse.', u, ts(16, 18, 1, 23));
decide(d1, ts(16, 18, 2, 0));
[u, a] = turn(main, 'main', [ts(16, 18, 3, 0), ts(16, 18, 3, 25)], 'Task: give notice on the old flat by Friday.', 'Noted. Task: give notice on the old flat by Friday. The notice period is three months, so it is due now.');
const t1 = propose('task', 'give notice on the old flat by Friday', 'Task: give notice on the old flat by Friday.', u, ts(16, 18, 3, 28));
decide(t1, ts(16, 18, 4, 0));
[u, a] = turn(main, 'main', [ts(16, 18, 5, 0), ts(16, 18, 5, 22)], 'Task: book a moving van for the 29th.', 'Good. Task: book a moving van for the 29th. Vans for the end of the month go early.');
const t2 = propose('task', 'book a moving van for the 29th', 'Task: book a moving van for the 29th.', u, ts(16, 18, 5, 25));
// boxes chat
const chatsDoc = { rev: 3, chats: [
  { id: 'main', file: 'transcript.jsonl', createdAt: main[0].ts, title: 'flat search', titleBy: 'user', titledAt: ts(16, 18, 6, 0) },
  { id: 'c-boxes', file: 'chats/c-boxes.jsonl', createdAt: ts(17, 9, 0, 0), title: 'boxes', titleBy: 'model', titleModel: 'morrow', titledAt: ts(17, 9, 0, 40) },
] };
ev({ ts: ts(16, 18, 6, 0), event: 'chat_rename', chat: 'main', title: 'flat search', was: 'main', by: 'user', rev: 1, created: 'chats.json' });
ev({ ts: ts(17, 9, 0, 0), event: 'chat_new', chat: 'c-boxes', file: 'chats/c-boxes.jsonl', from: 'main', rev: 2 });
[u, a] = turn(boxes, 'c-boxes', [ts(17, 9, 0, 10), ts(17, 9, 0, 35)], 'How many boxes do we need for two rooms? Task: collect boxes from the supermarket.', 'About forty. Task: collect boxes from the supermarket. Books go in small boxes.');
ev({ ts: ts(17, 9, 0, 40), event: 'chat_rename', chat: 'c-boxes', title: 'boxes', was: 'How many boxes do we need for two rooms?', by: 'model', model: 'morrow', rev: 3 });
const t3 = propose('task', 'collect boxes from the supermarket', 'Task: collect boxes from the supermarket.', u, ts(17, 9, 0, 38), 'c-boxes');
consent('kanban', 'tasks', 3, 3, ts(17, 9, 0, 39), ts(17, 9, 1, 0), boxes, 'c-g01', 4);
[u, a] = turn(boxes, 'c-boxes', [ts(17, 9, 2, 0), ts(17, 9, 2, 20)], 'Task: label every box with its room.', 'Yes. Task: label every box with its room. It saves an evening on the other side.');
const t4 = propose('task', 'label every box with its room', 'Task: label every box with its room.', u, ts(17, 9, 2, 23), 'c-boxes');
// you moved the notice task to doing (v0.11 move)
srev++;
Object.assign(t1, { column: 'doing', order: 1, movedBy: 'user', movedAt: ts(17, 9, 3, 0) });
ev({ ts: ts(17, 9, 3, 0), event: 'item_write', via: 'move', itemId: t1.id, item: JSON.parse(JSON.stringify(t1)) });
ev({ ts: ts(17, 9, 3, 0), event: 'item_move', id: t1.id, from: 'todo', to: 'doing', order: 1, fromIndex: 0, index: 0, between: [null, null], status: 'confirmed', by: 'user', turn: 5, rev: srev });
// the map: one decision is below the rule's threshold (2), so only the kanban grows; the map is not shown
void t2; void t3; void t4; void a;

const rules = JSON.parse(fs.readFileSync(path.join(SRC, 'rules.json'), 'utf8'));
rules._notes = rules._notes.filter((x) => !/^Demo fixture/.test(x)).concat('Demo fixture v0.13 (dev/make-fixture-v13.js): the rules of the other project; each project has its own rules.json.');
write(path.join(B, 'transcript.jsonl'), main.map(line).join('\n') + '\n');
write(path.join(B, 'chats', 'c-boxes.jsonl'), boxes.map(line).join('\n') + '\n');
write(path.join(B, 'chats.json'), jsonOut(chatsDoc));
write(path.join(B, 'metrics.jsonl'), metrics.join('\n') + '\n');
write(path.join(B, 'state.json'), jsonOut({ rev: srev, items }));
write(path.join(B, 'modules.json'), jsonOut({ rev: mrev, panes, answers, pending: null }));
write(path.join(B, 'rules.json'), jsonOut(rules));

// ---- the home ----
write(path.join(OUT, 'projects.json'), jsonOut({ rev: 2, projects: [
  { id: 'health-insurance-claim', name: 'health insurance claim', dir: 'health-insurance-claim', createdAt: '2026-10-14T09:01:00.000Z' },
  { id: 'move-flat', name: 'move flat', dir: 'move-flat', createdAt: ts(16, 18, 0, 0) },
] }));
const conf = JSON.parse(fs.readFileSync(path.join(SRC, 'pilot.config.json'), 'utf8'));
conf.port = 4790;
for (const r of Object.values(conf.roles)) for (const c of r.candidates) c.baseUrl = c.baseUrl.replace(':5794/', ':5800/').replace(':5795/', ':5801/');
delete conf.pilotDir;
conf._notes = ['DEMO ONLY (npm run demo -- v0.13). The v0.12 demo config with own ports (server 4790, fakes 5800/5801); demo.js starts the server with PILOT_HOME (several projects). Every experiment is off. Untested with a real model.'];
write(path.join(OUT, 'pilot.config.json'), jsonOut(conf));
console.log(`wrote ${path.relative(process.cwd(), OUT)}/: projects.json, health-insurance-claim/ (v0.12, byte for byte), move-flat/ (${items.length} items, ${main.length + boxes.length} lines)`);
