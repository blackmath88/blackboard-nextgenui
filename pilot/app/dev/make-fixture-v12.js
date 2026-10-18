#!/usr/bin/env node
// DEV ONLY. Writes demo/fixtures/v0.12/ from the v0.11 fixture: the same project with three chats in the list and a
// fourth one archived, all sharing one board. transcript.jsonl (the chat "main") is copied byte for byte from v0.11:
// the first chat is never moved or rewritten. The other chats live in chats/<id>.jsonl, listed in chats.json:
//   main        "letter"    named by you (chat_rename by user)      the v0.11 history (44 turns)
//   c-invoices  "invoices"  named by the title role (model · morrow) turns 46-47, proposes task-9 (dashed)
//   c-hospital  (no title: the first sentence of its first message)  turns 48-49, task-10 (confirmed, moved to doing)
//                                                                    and task-11 (proposed)
//   c-scratch   "scratch"   archived (hidden behind the toggle)      turn 45
// Every item from the new chats records fromChat. The kanban stays shown (it holds proposals; you touched it at turn
// 48), the map and the index stay tabs; rules.json is v0.11's (askRemoveAfterTurns 20: no removal question comes up).
// pilot.config.json: demo ports (server 4786, fakes 5794/5795), experiments off, and a `title` role on the morrow fake,
// so a chat you start in the demo is named after its first reply. Every added data line carries "fixture": true.
// demo.json is written by hand. Usage: node dev/make-fixture-v12.js   (deterministic)
'use strict';
const fs = require('fs');
const path = require('path');
const board = require('../public/board.js');

const FIX = path.join(__dirname, '..', 'demo', 'fixtures');
const SRC = path.join(FIX, 'v0.11'), OUT = path.join(FIX, 'v0.12');
fs.mkdirSync(path.join(OUT, 'chats'), { recursive: true });
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const line = (o) => JSON.stringify({ ...o, fixture: true });

const mainRaw = read('transcript.jsonl');                     // copied byte for byte
const main = mainRaw.trimEnd().split('\n').map((l) => JSON.parse(l));
const metrics = read('metrics.jsonl').trimEnd().split('\n');
const state = json('state.json');
const modules = json('modules.json');
let rev = state.rev, crev = 0, n = 200;
let lines = main.length, msgs = main.filter((l) => l.role === 'user' || l.role === 'assistant').length, turn = main.filter((l) => l.role === 'user').length;
const ts = (h, m, s) => `2026-10-17T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
const id = () => `m-f${String(++n).padStart(3, '0')}`;
const files = { 'c-scratch': [], 'c-invoices': [], 'c-hospital': [] };
const chatsDoc = { rev: 0, chats: [{ id: 'main', file: 'transcript.jsonl', createdAt: main[0].ts }] };
const ev = (o) => metrics.push(line(o));

// One turn in a chat: user line, reply, the chat model call and the turn event (counts over all chats).
function say(chat, at, user, reply) {
  const u = { id: id(), ts: ts(...at), role: 'user', text: user, model: null };
  const r = { id: id(), ts: ts(at[0], at[1], at[2] + 25), role: 'assistant', text: `[fixture] ${reply}`, model: 'frontier' };
  files[chat].push(line(u), line(r));
  lines += 2; msgs += 2; turn += 1;
  ev({ ts: r.ts, event: 'model_call', role: 'chat', candidate: 'frontier', model: 'fake-frontier', ok: true, latencyMs: 2400 + turn, chars: r.text.length });
  ev({ ts: ts(at[0], at[1], at[2] + 26), event: 'turn', ok: true, lines, messages: msgs, chat });
  return { u, r };
}
// An extraction after that turn: one proposed task, recorded like the server records it.
function propose(chat, t, itemId, text, quote, from, sec) {
  const at = ts(t[0], t[1], sec);
  const it = { id: itemId, kind: 'task', text, status: 'proposed', author: 'model', model: 'morrow', quote, fromMessage: from.id, fromChat: chat, createdAt: at, column: 'todo' };
  state.items.push(it); rev += 1;
  ev({ ts: at, event: 'model_call', role: 'extract', candidate: 'morrow', model: 'fake-morrow', ok: true, latencyMs: 1800, chars: 150 });
  ev({ ts: at, event: 'item_write', via: 'extract', itemId, item: { ...it } });
  ev({ ts: at, event: 'extract', candidate: 'morrow', model: 'fake-morrow', fromMessage: from.id, returned: 1, proposed: 1, dropped: 0, ids: [itemId], rev, latencyMs: 1800 });
  return it;
}
const newChat = (chat, at, from, extra = {}) => {
  chatsDoc.chats.push({ id: chat, file: `chats/${chat}.jsonl`, createdAt: ts(...at), ...extra });
  crev += 1;
  ev({ ts: ts(...at), event: 'chat_new', chat, file: `chats/${chat}.jsonl`, from, rev: crev, ...(extra.title ? { title: extra.title, by: 'user' } : {}), ...(crev === 1 ? { created: 'chats.json' } : {}) });
};
const sw = (from, to, at, how) => ev({ ts: ts(...at), event: 'chat_switch', from, to, how, turn });

// turn 45: a scratch chat to try the feature, then archived
newChat('c-scratch', [10, 0, 0], 'main', { title: 'scratch', titleBy: 'user', titledAt: ts(10, 0, 0) });
say('c-scratch', [10, 0, 10], 'Just trying out a second chat.', 'It works: this chat has its own history, the board is shared.');
chatsDoc.chats.find((c) => c.id === 'c-scratch').archived = true; crev += 1;
ev({ ts: ts(10, 1, 0), event: 'chat_archive', chat: 'c-scratch', archived: true, rev: crev });
sw('c-scratch', 'main', [10, 1, 0], 'archive');
// main is named by you
Object.assign(chatsDoc.chats[0], { title: 'letter', titleBy: 'user', titledAt: ts(10, 2, 0) }); crev += 1;
ev({ ts: ts(10, 2, 0), event: 'chat_rename', chat: 'main', title: 'letter', was: main.find((l) => l.role === 'user').text.split(/(?<=[.!?])\s/)[0], by: 'user', rev: crev });

// turns 46-47: invoices (named by the title role after its first reply)
newChat('c-invoices', [10, 3, 0], 'main');
sw('main', 'c-invoices', [10, 3, 0], 'new');
const a = say('c-invoices', [10, 3, 20], 'Task: sort the pharmacy receipts by date.', 'Good, oldest first. The insurer checks the dates against the claim period.');
Object.assign(chatsDoc.chats.find((c) => c.id === 'c-invoices'), { title: 'invoices', titleBy: 'model', titleModel: 'morrow', titledAt: ts(10, 3, 48) }); crev += 1;
ev({ ts: ts(10, 3, 48), event: 'model_call', role: 'title', candidate: 'morrow', model: 'fake-morrow', ok: true, latencyMs: 900, chars: 8 });
ev({ ts: ts(10, 3, 48), event: 'chat_rename', chat: 'c-invoices', title: 'invoices', was: 'Task: sort the pharmacy receipts by date.', by: 'model', model: 'morrow', rev: crev });
propose('c-invoices', [10, 3], 'task-9', 'sort the pharmacy receipts by date', 'Task: sort the pharmacy receipts by date.', a.u, 50);
say('c-invoices', [10, 6, 2], 'There are eleven receipts in the folder.', 'Then one stapled bundle is enough, with a list of the amounts on top.');

// turns 48-49: hospital (no title: the first sentence of its first message)
newChat('c-hospital', [10, 9, 0], 'c-invoices');
sw('c-invoices', 'c-hospital', [10, 9, 0], 'new');
const h = say('c-hospital', [10, 9, 15], 'The hospital sent the discharge letter today. Task: copy the discharge letter for the insurer.', 'Keep the original. One copy goes with the claim, one stays in your folder.');
const t10 = propose('c-hospital', [10, 9], 'task-10', 'copy the discharge letter for the insurer', 'Task: copy the discharge letter for the insurer.', h.u, 45);
// you confirm task-10 (a touch of the kanban) and move it to doing
{
  const at = ts(10, 11, 5);
  Object.assign(t10, { status: 'confirmed', decidedAt: at, decidedBy: 'user' }); rev += 1;
  ev({ ts: at, event: 'item_write', via: 'decide', itemId: 'task-10', item: { ...t10 } });
  ev({ ts: at, event: 'decide', itemId: 'task-10', kind: 'task', decision: 'confirmed', decidedBy: 'user', author: 'model', model: 'morrow', rev });
  ev({ ts: at, event: 'pane_touch', module: 'kanban', how: 'decide', turn });
  modules.panes.find((p) => p.module === 'kanban').lastTouch = { at, turn, how: 'decide' };
  files['c-hospital'].push(line({ id: id(), ts: at, role: 'system', text: 'task-10 confirmed: copy the discharge letter for the insurer', model: null }));
  lines += 1;
  const mv = ts(10, 11, 20), fromIndex = board.indexOf(state.items, t10), p = board.place(state.items, t10, 'doing', 1);
  Object.assign(t10, { column: 'doing', order: p.order, movedBy: 'user', movedAt: mv }); rev += 1;
  ev({ ts: mv, event: 'item_write', via: 'move', itemId: 'task-10', item: { ...t10 } });
  ev({ ts: mv, event: 'item_move', id: 'task-10', from: 'todo', to: 'doing', order: p.order, fromIndex, index: p.index, between: p.neighbours, status: 'confirmed', by: 'user', turn, rev });
}
const h2 = say('c-hospital', [10, 12, 30], 'Task: ask the hospital for an itemised bill.', 'Yes, the insurer wants every line of the bill, not only the total.');
propose('c-hospital', [10, 12], 'task-11', 'ask the hospital for an itemised bill', 'Task: ask the hospital for an itemised bill.', h2.u, 58);

chatsDoc.rev = crev;
state.rev = rev;
modules.rev += 1;
fs.writeFileSync(path.join(OUT, 'transcript.jsonl'), mainRaw);
for (const [c, ls] of Object.entries(files)) fs.writeFileSync(path.join(OUT, 'chats', `${c}.jsonl`), ls.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'chats.json'), JSON.stringify(chatsDoc, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'metrics.jsonl'), metrics.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'modules.json'), JSON.stringify(modules, null, 2) + '\n');

const rules = json('rules.json');
rules._notes = rules._notes.filter((x) => !x.startsWith('Demo fixture'));
rules._notes.push('Demo fixture v0.12 (from v0.11, see dev/make-fixture-v12.js): the same rules; they count messages in all chats of the project.');
fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');

const config = json('pilot.config.json');
config.port = 4786;
for (const r of Object.values(config.roles)) for (const c of r.candidates) c.baseUrl = c.baseUrl.replace(':5788/', ':5794/').replace(':5789/', ':5795/');
config.roles.title = { policy: 'manual', candidates: [{ name: 'morrow', local: true, baseUrl: 'http://127.0.0.1:5795/v1', model: 'fake-morrow', timeoutMs: 10000 }] };
config.experiments = { settledInput: false, settleMs: 1800, frameProposals: false };
config._notes = ['DEMO ONLY (npm run demo -- v0.12). Derived from the v0.11 demo config with own ports (server 4786, fakes 5794/5795). Every experiment is off. The title role points at the morrow fake (it answers with the first words of the first message), so a new chat gets a name after its first reply. Untested with a real model.'];
fs.writeFileSync(path.join(OUT, 'pilot.config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}/`);
