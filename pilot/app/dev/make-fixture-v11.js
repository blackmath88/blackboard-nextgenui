#!/usr/bin/env node
// DEV ONLY. Writes demo/fixtures/v0.11/ from the v0.10 fixture: the same workbench seven turns later, with the kanban
// shown and the map and the index faded to tabs (by the v0.8 rules, fadeAfterTurns 8), so the kanban has the whole side
// column and you can drag at once. Eight tasks on file, seven on the board (task-6 is rejected and stays off it):
//   todo: task-4, task-5, task-7 (added by you), task-8 (proposed by morrow, dashed); doing: task-3; done: task-1, task-2.
// task-3 reached "doing" through a recorded move (item_write via move + item_move, as the server writes them), so
// `/why task-3` shows a move history from the start. task-8 comes from turn 38 with the extraction events the server
// would write (extract, item_write via extract), so /why task-8 cites them. See the turn list below.
// pilot.config.json: demo ports (server 4782, fakes 5788/5789); experiments all off (frame-proposals can be switched on
// with /flag; the frame role is configured). Every added data line carries "fixture": true. demo.json is written by hand.
// Usage: node dev/make-fixture-v11.js   (deterministic)
'use strict';
const fs = require('fs');
const path = require('path');
const board = require('../public/board.js');

const FIX = path.join(__dirname, '..', 'demo', 'fixtures');
const SRC = path.join(FIX, 'v0.10'), OUT = path.join(FIX, 'v0.11');
fs.mkdirSync(OUT, { recursive: true });
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const line = (o) => JSON.stringify({ ...o, fixture: true });

// ---- seven more turns (38 to 44), with what the server would have written along the way:
// turn 38: task-8 is proposed (extraction); the map (last touch turn 30) fades: 8 untouched turns; the kanban, a tab
//          since turn 30, comes back because it now holds a proposal (a tab must not hide a decision, v0.8);
// turn 40: you move task-3 to "doing" (a click on the card, then the move: pane_touch, item_write via move, item_move);
// turn 44: the index (last touch turn 36) fades. Now the kanban has the whole side column.
const transcript = read('transcript.jsonl').trimEnd().split('\n');
const metrics = read('metrics.jsonl').trimEnd().split('\n');
const state = json('state.json');
const modules = json('modules.json');
const TURNS = [
  ['Task: ask the GP for a copy of the referral. The insurer may want the original.', 'Good idea. Ask for a certified copy, then the original can stay in your folder.'],
  ['The GP practice opens at eight tomorrow.', 'Then call right at eight, the line gets busy later.'],
  ['I started drafting the letter now.', 'Start with the claim number and the deadline, the rest follows from the invoice.'],
  ['Is one page enough for the letter?', 'Yes. One page plus the attachments is what insurers expect.'],
  ['Should I list the attachments at the bottom?', 'Yes, as a short list under the signature: invoice, referral, claim form.'],
  ['How do I write the date, day first?', 'Day first is fine for a German insurer: 17.10.2026.'],
  ['Good, the draft is half done.', 'Nice. Print it once it is done and read it on paper before you sign.'],
];
let n = 100, msgs = 74, rev = state.rev;
const clock = (min, sec) => `2026-10-17T${String(9 + Math.floor((20 + min) / 60)).padStart(2, '0')}:${String((20 + min) % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}.000Z`;
const id = () => `m-f${String(++n).padStart(3, '0')}`;
let t3moved = null, t8 = null;
TURNS.forEach(([u, a], k) => {
  const turn = 38 + k, min = k * 3;
  const user = { id: id(), ts: clock(min, 4), role: 'user', text: u, model: null };
  const reply = { id: id(), ts: clock(min, 31), role: 'assistant', text: `[fixture] ${a}`, model: 'frontier' };
  transcript.push(line(user), line(reply));
  msgs += 2;
  metrics.push(line({ ts: reply.ts, event: 'model_call', role: 'chat', candidate: 'frontier', model: 'fake-frontier', ok: true, latencyMs: 2400 + 37 * k, chars: reply.text.length }));
  const fadeLine = (mod, idle, last) => {
    const p = modules.panes.find((x) => x.module === mod);
    Object.assign(p, { state: 'faded', fadedAt: clock(min, 32), fadedTurn: turn });
    transcript.push(line({ id: id(), ts: clock(min, 32), role: 'controller', text: `${mod} pane faded to a tab: untouched for ${idle} turns (fadeAfterTurns 8). Click the tab to bring it back.`, model: null, pane: mod, event: 'fade' }));
    metrics.push(line({ ts: clock(min, 32), event: 'pane_fade', module: mod, turn, idle, fadeAfterTurns: 8, lastTouchTurn: last, lastTouchRecorded: true }));
  };
  if (turn === 38) fadeLine('map', 8, 30);
  if (turn === 44) fadeLine('index', 8, 36);
  metrics.push(line({ ts: clock(min, 32), event: 'turn', ok: true, lines: transcript.length, messages: msgs }));
  if (turn === 38) {
    t8 = { id: 'task-8', kind: 'task', text: 'ask the GP for a copy of the referral', status: 'proposed', author: 'model', model: 'morrow',
      quote: 'Task: ask the GP for a copy of the referral.', fromMessage: user.id, createdAt: clock(min, 34), column: 'todo' };
    state.items.push(t8); rev += 1;
    metrics.push(line({ ts: clock(min, 34), event: 'model_call', role: 'extract', candidate: 'morrow', model: 'fake-morrow', ok: true, latencyMs: 1900, chars: 160 }),
      line({ ts: clock(min, 34), event: 'item_write', via: 'extract', itemId: 'task-8', item: t8 }),
      line({ ts: clock(min, 34), event: 'extract', candidate: 'morrow', model: 'fake-morrow', fromMessage: reply.id, returned: 1, proposed: 1, dropped: 0, ids: ['task-8'], rev, latencyMs: 1900 }));
    const kb = modules.panes.find((x) => x.module === 'kanban');
    delete kb.state; delete kb.fadedAt; delete kb.fadedTurn;
    transcript.push(line({ id: id(), ts: clock(min, 35), role: 'controller', text: 'kanban pane is back: it holds a proposal (task-8), and a tab must not hide a decision.', model: null, pane: 'kanban', event: 'unfade' }));
    metrics.push(line({ ts: clock(min, 35), event: 'pane_unfade', module: 'kanban', turn, reason: 'proposal', holds: ['task-8'] }));
  }
  if (turn === 40) {
    const at = clock(min, 50), t3 = state.items.find((i) => i.id === 'task-3');
    const p = board.place(state.items, t3, 'doing', 0);
    Object.assign(t3, { column: 'doing', order: p.order, movedBy: 'user', movedAt: at });
    rev += 1;
    modules.panes.find((x) => x.module === 'kanban').lastTouch = { at: clock(min, 49), turn, how: 'click' };
    metrics.push(line({ ts: clock(min, 49), event: 'pane_touch', module: 'kanban', how: 'click', turn }),
      line({ ts: at, event: 'item_write', via: 'move', itemId: 'task-3', item: { ...t3 } }),
      line({ ts: at, event: 'item_move', id: 'task-3', from: 'todo', to: 'doing', order: p.order, fromIndex: 0, index: 0, between: [null, null], status: 'confirmed', by: 'user', turn, rev }));
    t3moved = t3;
  }
});
state.rev = rev;
modules.rev += 3;
fs.writeFileSync(path.join(OUT, 'transcript.jsonl'), transcript.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'metrics.jsonl'), metrics.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'modules.json'), JSON.stringify(modules, null, 2) + '\n');

// ---- rules.json and the config ----
const rules = json('rules.json');
rules._notes = rules._notes.filter((n) => !n.startsWith('Demo fixture'));
rules._notes.push('Demo fixture v0.11 (from v0.10, see dev/make-fixture-v11.js): fadeAfterTurns 8 again (the map and the index faded to tabs, the kanban has the side column); askRemoveAfterTurns 20, so no removal question comes up during the demo.');
rules.fadeAfterTurns = 8;
rules.askRemoveAfterTurns = 20;
fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');

const config = json('pilot.config.json');
config.port = 4782;
for (const r of Object.values(config.roles)) for (const c of r.candidates) c.baseUrl = c.baseUrl.replace(':5783/', ':5788/').replace(':5784/', ':5789/');
config.experiments = { settledInput: false, settleMs: 1800, frameProposals: false };
config._notes = ['DEMO ONLY (npm run demo -- v0.11). Derived from the v0.10 demo config with own ports (server 4782, fakes 5788/5789). Every experiment is off (the default); /flag frame-proposals on works, the frame role points at the morrow fake. Untested with a real model.'];
fs.writeFileSync(path.join(OUT, 'pilot.config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}/`);
