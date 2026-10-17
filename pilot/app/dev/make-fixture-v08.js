#!/usr/bin/env node
// DEV ONLY. Writes demo/fixtures/v0.8/{transcript.jsonl, metrics.jsonl, state.json, modules.json, rules.json} from the
// v0.7 fixture plus synthetic history in the shapes the pilot-v0.8 server writes, so the demo opens one message before
// two things happen:
// - the map pane was last touched at turn 30 (a click); after turn 38 (your next message) it has been untouched for
//   8 turns (fadeAfterTurns 8) and fades to a tab;
// - the kanban pane faded at turn 30 (untouched since its last decisions at turn 22); after turn 38 it has been a tab
//   for 8 turns (askRemoveAfterTurns 8), so the controller asks once whether to remove it.
// The open proposals of the v0.7 fixture are decided first (a pane holding a proposal never fades): task-4, task-5,
// task-6 at turn 22, dec-7 and src-1 at turn 25, each with its item_write/decide ledger lines and its pane_touch.
// The index is touched at turns 23, 31 and 36. Turns 23 to 37 are a synthetic session on 2026-10-17.
// Every added line and event carries "fixture": true. demo.json and pilot.config.json are written by hand.
// Usage: node dev/make-fixture-v08.js   (deterministic: same output every run)
'use strict';
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'demo', 'fixtures');
const SRC = path.join(FIX, 'v0.7');
const OUT = path.join(FIX, 'v0.8');
const jsonl = (f) => fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const json = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
const transcript = jsonl('transcript.jsonl'), metrics = jsonl('metrics.jsonl');
const state = json('state.json'), modules = json('modules.json'), rules = json('rules.json');
const copy = (o) => JSON.parse(JSON.stringify(o));
const turn = () => transcript.filter((l) => l.role === 'user').length;
const msgs = () => transcript.filter((l) => l.role === 'user' || l.role === 'assistant').length;

let clock = 0, seq = transcript.length;
const at = () => new Date(clock).toISOString();
const adv = (sec) => { clock += sec * 1000; };
function line(role, text, model, extra = {}) {
  const l = { id: `m-f${String(++seq).padStart(3, '0')}`, ts: at(), role, text, model: model || null, ...extra, fixture: true };
  transcript.push(l);
  return l;
}
function ev(event, fields = {}) { metrics.push({ ts: at(), event, ...fields, fixture: true }); }
const pane = (mod) => modules.panes.find((p) => p.module === mod);
const touched = {};   // module -> turn of the last pane_touch (the server logs the first touch per pane per turn)
function touch(mod, how) {
  if (touched[mod] === turn()) return;
  touched[mod] = turn();
  pane(mod).lastTouch = { at: at(), turn: turn(), how };
  modules.rev++;
  ev('pane_touch', { module: mod, how, turn: turn() });
}
function decide(id, status) {
  const item = state.items.find((i) => i.id === id);
  item.status = status; item.decidedAt = at(); item.decidedBy = 'user';
  state.rev++;
  ev('item_write', { via: 'decide', itemId: id, item: copy(item) });
  line('system', `${id} ${status}: ${item.text}`, null);
  ev('decide', { itemId: id, kind: item.kind, decision: status, decidedBy: 'user', author: item.author, model: item.model, rev: state.rev });
  touch(item.kind === 'task' ? 'kanban' : 'map', 'decide');
  adv(15);
}
function exchange(user, reply) {
  line('user', user, null);
  adv(24);
  line('assistant', `[fixture] ${reply}`, 'frontier');
  ev('model_call', { role: 'chat', candidate: 'frontier', model: 'fake-frontier', ok: true, latencyMs: 2400 + (seq % 7) * 310, chars: reply.length + 10 });
  ev('turn', { ok: true, lines: transcript.length, messages: msgs() });
  adv(150);
}

// ---- end of 2026-10-16 (turn 22): the open task proposals are decided on the kanban ----
clock = Date.parse('2026-10-16T18:35:00.000Z');
decide('task-4', 'confirmed');
decide('task-5', 'confirmed');
decide('task-6', 'rejected');

// ---- 2026-10-17, a synthetic session: turns 23 to 37 ----
clock = Date.parse('2026-10-17T08:30:00.000Z');
ev('server_start', { pid: 40100, lines: transcript.length, messages: msgs(), items: state.items.length, panes: 3, answers: 3, fileErrors: [] });
adv(60);
const TURNS = [
  ['Morning. Where did we leave the claim yesterday?', 'You signed off with: print, sign, send. The letter draft is ready.'],
  ['Show me the first line of the letter again.', 'It opens with your policy number and the date of the hospital stay.'],
  ['OK, the open proposals on the map, let me look at them.', 'They are the registered-mail decision and the insurer form link.'],
  ['Is the policy number format right, with the dashes?', 'Yes, the insurer writes it with dashes on its own forms.'],
  ['The deadline was the end of the month, right?', 'Yes, the insurer said the claim must arrive by the 31st.'],
  ['How long does registered mail take here?', 'Usually one to two working days inside the country.'],
  ['Then sending on Monday is early enough.', 'Yes, with a comfortable margin before the 31st.'],
  ['What goes into the envelope, once more?', 'The signed letter, the invoice copy, the referral and the claim form.'],
  ['Let me scroll the index back to Tuesday.', 'Tuesday has the first decisions and the scanned invoice.'],
  ['Do I keep copies of everything?', 'Yes, keep one copy of each page and the registered-mail receipt.'],
  ['Where is the receipt usually kept?', 'Many people staple it to their copy of the letter.'],
  ['Remind me what the insurer said on the phone.', 'They confirmed the referral must be attached, nothing else was missing.'],
  ['Good. Anything about reimbursement time?', 'They mentioned about four weeks after the claim arrives.'],
  ['Let me check the index for the phone call.', 'The call notes are in the session from the 15th.'],
  ['Fine. I will print everything this evening.', 'Sounds good. The letter is ready to print as it is.'],
];
TURNS.forEach(([u, r], i) => {
  exchange(u, r);
  const t = turn();
  if (t === 23) { ev('index_jump', { target: 'm-f033', position: 33, of: transcript.length }); touch('index', 'click'); }
  if (t === 25) { decide('dec-7', 'confirmed'); decide('src-1', 'confirmed'); }
  if (t === 30) {
    // the controller ran after turn 30's reply: the kanban, untouched since turn 22, fades
    const k = pane('kanban');
    const idle = t - k.lastTouch.turn;
    k.state = 'faded'; k.fadedAt = at(); k.fadedTurn = t; modules.rev++;
    line('controller', `kanban pane faded to a tab: untouched for ${idle} turns (fadeAfterTurns 8). Click the tab to bring it back.`, null, { pane: 'kanban', event: 'fade' });
    ev('pane_fade', { module: 'kanban', turn: t, idle, fadeAfterTurns: 8, lastTouchTurn: k.lastTouch.turn, lastTouchRecorded: true });
    adv(20);
    touch('map', 'click');   // then you clicked into the map
  }
  if (t === 31) touch('index', 'scroll');
  if (t === 36) { ev('index_jump', { target: 'm-f041', position: 41, of: transcript.length }); touch('index', 'click'); }
});

rules.fadeAfterTurns = 8;
rules.askRemoveAfterTurns = 8;
rules._notes = [
  'Edit by hand; the controller reads this file on every turn.',
  'decisions and tasks count proposed and confirmed items, not rejected ones.',
  'fadeAfterTurns / askRemoveAfterTurns: default for every pane; a rule may set its own (pilot-v0.8).',
  'Demo fixture v0.8 (synthetic, see dev/make-fixture-v08.js): the map fades after your next message, and the removal question for the long-faded kanban is due.',
];

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'transcript.jsonl'), transcript.map((l) => JSON.stringify(l)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'metrics.jsonl'), metrics.map((l) => JSON.stringify(l)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'modules.json'), JSON.stringify(modules, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');
console.log(`v0.8 fixture: turn ${turn()}, ${transcript.length} lines, ${metrics.length} events; map last touch turn ${pane('map').lastTouch.turn}, kanban faded at turn ${pane('kanban').fadedTurn}`);
