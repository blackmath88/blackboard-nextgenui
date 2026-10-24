// CLI Pilot page. Talks only to its own server (same origin): GET /state, POST /chat, /command, /answer.
// pilot-v0.4: map and kanban panes show items from state.json; proposals can be confirmed (c) or rejected (r).
// pilot-v0.5: live files. GET /events (SSE) says which file changed; the page reloads only that part of /state.
// Writes carry the rev the page last saw; a stale one comes back 409 {stale} and the page reloads with a notice.
// c/r act only on a focused proposal card (Tab or arrows into a pane; Escape back to the input).
// pilot-v0.6: every line, item and pane says who authored it (peach you, sky model, lavender controller); a hand edit
// of state.json shows as "you (file edit)" (the server compares the file with its own write ledger, see stats.js).
// Index jumps are reported with POST /metric (the Usefulness measure of /stats).
// pilot-v0.7: /why (typed, or the "why?" button on a pane bar or a card) shows the server's explanation with its sources;
// a "show m-…" link scrolls to the message (no index_jump: it is not an index use).
// pilot-v0.8: panes can go. A faded pane is a slim labelled tab in its place (the grid rows shrink); a click or Enter on
// the tab brings it back at once (View Transition, instant with reduced motion). The page reports touches with
// POST /touch: a pointerdown or a wheel/touchmove inside a pane, or keyboard focus moved into it by you (Tab, arrows);
// decisions on cards are touches on the server side. At most one report per pane per turn (the server writes only the
// first). The removal question ("remove the map pane?") takes y/n/x.
// pilot-v0.9: experiment "settled input", only while state.flags.settledInput is on (default off; /flag settled-input
// on|off). After a pause of flags.settleMs on an input that looks finished (settle.js), a quiet inline "send?" appears;
// Tab sends while it shows, Enter always sends, nothing is ever sent without a key. Off: no offer element, no listener
// acts, Tab and Enter as before. Reports settle_offer / settle_accept / settle_ignore / enter_send (POST /metric).
// pilot-v0.10: frame proposals, only while state.flags.frameProposals is on (default off; /flag frame-proposals on|off).
// A proposal from the frame role (state.frames.pending.<pane>) is a dashed lavender note at the top of that pane,
// "model suggests: focus dec-2 · order …", marked "suggested by <model>, not by you"; f (focus in that pane, not on a
// button, same guards as c/r) or its apply button applies it (POST /frame), dismiss drops it. An applied frame
// (state.frames.applied.<pane>) only arranges the cards: order first, focus marked and scrolled to, group sub-headings;
// nothing is hidden. Its line says who suggested it and that you applied it; reset = /frame reset <pane>.
// Off: no note, no frame line, cards in their own order, f is just a key.
// pilot-ui: several chats (left sidebar), one shared board. Each transcript line names its chat (no chat = the first);
// the log and the index show the open chat only, and a pending controller question shows in every chat. A theme switch
// sits under the chat list (auto → light → dark). Confirmed tasks move between kanban columns by drag and drop, or with
// ←/→ on a focused card (POST /move).
'use strict';
const $ = (id) => document.getElementById(id);
const bench = $('bench'), log = $('log'), form = $('form'), input = $('input');
const meta = $('meta'), count = $('count'), models = $('models'), notice = $('notice');
const PLACEHOLDER = input.placeholder;
const KEYS = { y: 'yes', n: 'no', a: 'always', x: 'never' };
const WHO = { user: 'you', assistant: 'model', system: 'system', controller: 'controller', out: '' };
const AUTHOR = { user: 'you', assistant: 'model', system: 'system', controller: 'controller' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state = { transcript: [], panes: [], pending: null, pendingKind: null, answers: {}, removals: {}, faded: [], turn: 0, items: [], extracting: false, fileErrors: {} };
let shownPanes = '';
let selected = null;        // the proposal ArrowDown/ArrowUp from the empty input moves focus to (the newest by default)
let seen = null;            // proposal ids already shown; a new one becomes the arrow target
let showRejected = false;   // rejected items are hidden behind a toggle in the pane bar
let pollTimer = null;       // fallback without SSE: while an extraction runs, /state is polled until it is done
let es = null, live = false; // EventSource on /events; live = connected (else: refresh after each action + poll)
let streaming = false;      // this tab is streaming a reply: file events wait (a re-render would drop the live line)
const deferred = new Set(); // files changed while streaming
let flash = null, flashTimer = null;   // short notice after a stale write
const chatList = $('chat-list'), newChatBtn = $('new-chat'), themeBtn = $('theme-toggle');
let activeChat = null;      // the open chat; kept in this browser (localStorage), falls back to the first chat
try { activeChat = localStorage.getItem('pilot-chat'); } catch { /* storage blocked */ }
const chatOf = (l) => (l && typeof l.chat === 'string' && l.chat) || state.defaultChat || 'c-1';
const hdrs = () => ({ 'x-pilot': '1', 'content-type': 'application/json', 'x-pilot-chat': encodeURIComponent(activeChat || '') });   // every write names its chat
const chatLines = () => state.transcript.filter((l) => chatOf(l) === activeChat);
$('brand').insertAdjacentHTML('afterbegin', Pixel.sprite('teletype', 18, 'pilot') + ' ');

function addLine(role, text, model, id, kind) {
  const p = document.createElement('p');
  p.className = `ln ${role}`;
  if (kind) p.classList.add(kind);              // system lines: blocked | stall | error
  if (id) p.id = `msg-${id}`;
  if (AUTHOR[role]) { p.dataset.author = AUTHOR[role]; p.title = `authored by ${AUTHOR[role]}${model ? ` · ${model}` : ''}`; }
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = WHO[role] ?? role;
  const body = document.createElement('span');
  body.className = 'text';
  body.textContent = text;                       // model text is never parsed as HTML
  p.append(who);
  // the model name sits right after the "model" label (pilot-v0.6), so every reply says which model wrote it
  if (model) { const m = document.createElement('small'); m.className = 'model'; m.textContent = model; p.append(m, ' '); }
  p.append(body);
  log.append(p);
  log.scrollTop = log.scrollHeight;
  return { p, body };
}

// Controller question: sprite, text, and y/n/a/x buttons while it is the pending one.
// pilot-v0.8: a removal question (line.question "remove") takes y/n/x; its answer is in state.removals, not answers.
// Fade/unfade lines (line.pane, no module) are plain controller lines without keys.
const isRemove = (line) => line.question === 'remove';
function addController(line, isLastForModule) {
  const { p } = addLine('controller', '', null, line.id);
  p.querySelector('.who').innerHTML = Pixel.sprite('keeper', 22, 'controller') + '<span class="role">controller</span>';   // static markup, no user text
  p.querySelector('.text').textContent = line.text;
  if (line.pane) p.classList.add('fade-note');
  const pending = isLastForModule && state.pending && state.pending === line.module && isRemove(line) === (state.pendingKind === 'remove');
  if (pending) {
    const keys = document.createElement('span');
    keys.className = 'keys';
    for (const [k, word] of Object.entries(KEYS)) {
      if (isRemove(line) && k === 'a') continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'key'; b.dataset.answer = word;
      b.innerHTML = `<kbd>${k}</kbd> ${word}`;
      b.addEventListener('click', () => sendAnswer(line.module, word));
      keys.append(b);
    }
    p.querySelector('.text').append(keys);
    p.classList.add('pending');
    log.scrollTop = log.scrollHeight;   // the buttons made the line taller after addLine scrolled
  } else {
    p.classList.add('done');
    const a = line.module ? (isRemove(line) ? (state.removals || {})[line.module] : state.answers[line.module]) : null;
    if (isLastForModule && a) { const s = document.createElement('small'); s.className = `model ${a.answer}`; s.textContent = `answered: ${a.answer}`; p.append(s); }
  }
}

function renderLog() {
  log.textContent = '';
  const lastCtl = {};
  const ctlKey = (l) => `${l.module}|${isRemove(l) ? 'remove' : 'grow'}`;
  state.transcript.forEach((l, i) => { if (l.role === 'controller' && l.module) lastCtl[ctlKey(l)] = i; });
  state.transcript.forEach((l, i) => {
    const last = !!l.module && lastCtl[ctlKey(l)] === i;
    const pendingHere = l.role === 'controller' && last && state.pending === l.module && isRemove(l) === (state.pendingKind === 'remove');   // a question shows in every chat
    if (chatOf(l) !== activeChat && !pendingHere) return;
    if (l.role === 'controller') addController(l, last);
    else addLine(l.role, l.text, l.model, l.id, l.kind);
  });
  if (!log.children.length) addLine('out', 'New chat. It shares the board (decisions, tasks, sources) with your other chats.');
  const ib = bench.querySelector('#pane-index:not(.faded) .body');   // pilot-ui: the index follows the open chat's log
  if (ib) renderIndex(ib);
  updateCount();
}
function updateCount() {
  const proposed = (state.items || []).filter((i) => i.status === 'proposed').length;
  count.textContent = `${chatLines().length} lines in this chat${proposed ? ` · ${proposed} proposed` : ''}`;
}

function updatePlaceholder() {
  const parts = [];
  if (state.pending) parts.push(state.pendingKind === 'remove' ? 'y/n/x answer the question' : 'y/n/a/x answer the question');
  if (selected) parts.push('↓ or Tab to the proposals (c/r there, Esc back)');
  if (!parts.length && settleOn()) { input.placeholder = 'Type a message and press Enter (or pause, then Tab when it offers "send?")'; return; }
  input.placeholder = parts.length ? `Empty input: ${parts.join(' · ')}` : PLACEHOLDER;
}

// Notice above the log: a broken hand-edited file (until it is fixed) and, for a few seconds, a stale-write message.
function renderNotice() {
  const lines = Object.keys(state.fileErrors || {}).map((f) => f === 'context.json' ? 'file context.json is invalid; board sharing is off' : `file ${f} is not valid JSON, showing last good version`);
  if (flash) lines.push(flash);
  notice.textContent = lines.join('\n');
  notice.title = Object.values(state.fileErrors || {}).join('\n');
  notice.hidden = !lines.length;
}
function showFlash(text) {
  flash = text; renderNotice();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = null; renderNotice(); }, 5000);
}

// ---- panes: CSS grid templates for 1 to 4 panes, swapped with a View Transition ----
const PANES = {
  index: { title: 'index', render: renderIndex },
  map: { title: 'reasoning map', render: renderMap, kinds: ['decision', 'source'] },
  kanban: { title: 'kanban', render: renderKanban, kinds: ['task'] },
};

// ---- items (state.json): proposed by a model = dashed lavender; confirmed = mint; rejected = rose, hidden by default;
// added by hand (author user) = solid. Every card says who authored it (and which model). ----
const statusOf = (it) => it.status || 'confirmed';   // a hand-added item without a status counts as confirmed
function itemCard(it) {
  const el = document.createElement('div');
  const status = statusOf(it);
  const byModel = it.author === 'model';
  el.className = `item ${status} ${byModel ? 'by-model' : 'by-user'}`;
  if (status === 'proposed') el.dataset.proposed = '1';
  el.dataset.id = it.id;
  el.tabIndex = 0;
  if (it.quote) el.title = `"${it.quote}"`;
  const text = document.createElement('span');
  text.className = 'text';
  if (it.kind === 'source' && /^https?:\/\//i.test(it.url || '')) {
    const a = document.createElement('a');
    a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = it.text;
    text.append(a);
  } else text.textContent = it.text;
  el.append(whyButton(it.id, `why is ${it.id} here?`), text, itemMeta(it, status, byModel));
  if (status === 'proposed') {
    const keys = document.createElement('span');
    keys.className = 'keys';
    for (const [k, word] of [['c', 'confirm'], ['r', 'reject']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'key'; b.dataset.decision = word; b.tabIndex = -1;
      b.title = `${word} ${it.id} (${k})`;
      b.innerHTML = `<kbd>${k}</kbd><span class="w"> ${word}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); sendDecision(it.id, word, el); });
      keys.append(b);
    }
    el.append(keys);
  }
  if (it.kind === 'task' && status === 'confirmed') {   // pilot-ui: drag to another column (or ←/→ when focused)
    el.draggable = true; el.classList.add('movable');
    el.title = `${it.quote ? `"${it.quote}"\n` : ''}drag to another column, or focus and press ← / →`;
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; dragging = it.id; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { dragging = null; el.classList.remove('dragging'); bench.querySelectorAll('.col.drop').forEach((c) => c.classList.remove('drop')); });
  } else if (it.kind === 'task' && status === 'proposed') el.title = `${it.quote ? `"${it.quote}"\n` : ''}confirm it (c) to move it`;
  el.addEventListener('focus', () => { if (status === 'proposed') select(it.id); el.classList.toggle('selected', status === 'proposed'); });
  el.addEventListener('blur', () => el.classList.remove('selected'));
  el.addEventListener('click', () => el.focus());
  return el;
}

// Byline of a card (pilot-v0.6): "<id> · <author> · <status>", then who decided it and what was changed by hand.
// prov comes from the server: {added, fields} when (part of) the item came from a hand edit of state.json.
// times in the page are local ("10-14 11:06"); the full ISO timestamp from the file is in the tooltip
const pad = (n) => String(n).padStart(2, '0');
const clock = (ts) => { const d = new Date(ts); return ts && !isNaN(d) ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; };
function when(ts) { const s = document.createElement('span'); s.className = 'when'; s.textContent = clock(ts); s.title = ts; return s; }
function chip(cls, text) { const s = document.createElement('span'); s.className = `by ${cls}`; s.textContent = text; return s; }
function itemMeta(it, status, byModel) {
  const meta = document.createElement('small');
  meta.className = 'meta';
  const prov = it.prov || null;
  const fields = prov ? prov.fields : [];
  const tag = document.createElement('span');
  tag.className = `tag ${status}`; tag.textContent = status;
  meta.append(`${it.id} · `, byModel ? chip('model', `model · ${it.model || 'unknown'}`) : chip('you', prov && prov.added ? 'you (file edit)' : 'you'), ' · ', tag);
  if (byModel && prov && prov.added) meta.append(' · added by ', chip('you', 'you (file edit)'));
  if (status !== 'proposed') {
    const byFile = fields.includes('status') || (!it.decidedBy && !(prov && prov.added && !byModel));
    if (byFile) meta.append(` · ${status} by `, chip('you', 'you (file edit)'));
    else if (it.decidedBy) meta.append(` · ${status} by `, chip('you', it.decidedBy === 'user' ? 'you' : it.decidedBy), ...(it.decidedAt ? [' ', when(it.decidedAt)] : []));
  }
  if (it.movedBy) meta.append(' · moved by ', chip('you', it.movedBy === 'user' ? 'you' : it.movedBy), ...(it.movedAt ? [' ', when(it.movedAt)] : []));
  const edited = fields.filter((f) => !['status', 'decidedAt', 'decidedBy', 'movedAt', 'movedBy'].includes(f));
  if (edited.length) meta.append(' · edited by ', chip('you', 'you (file edit)'), `: ${edited.join(', ')}`);
  return meta;
}

function itemsFor(kinds) { return (state.items || []).filter((i) => kinds.includes(i.kind)); }
function itemList(items, empty, fr) {
  const box = document.createElement('div');
  box.className = 'items';
  const shown = arrange(items, fr).filter((i) => showRejected || statusOf(i) !== 'rejected');
  if (!shown.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = empty; box.append(p); }
  let group = null;
  for (const it of shown) {
    // pilot-v0.10: an applied frame with group adds a sub-heading per group (presentation only)
    if (fr && fr.intent.group && groupOf(fr.intent.group, it) !== group) {
      group = groupOf(fr.intent.group, it);
      const g = document.createElement('p'); g.className = 'grp'; g.textContent = group; box.append(g);
    }
    const card = itemCard(it);
    if (fr && fr.intent.focus === it.id) {
      card.classList.add('framed');
      card.querySelector('.meta').append(' · ', chip('frame', `frame focus, suggested by ${fr.model || 'a model'}`));
    }
    box.append(card);
  }
  return box;
}

// ---- pilot-v0.10: frames. Proposals are allographic (written by a model about your workbench, not by you): dashed
// lavender, and they say so. Only an applied frame changes the presentation, and only the order, a marked card and
// sub-headings. ----
const frameOn = () => !!(state.flags && state.flags.frameProposals);
const okIntent = (f, mod) => !!f && f.intent && typeof f.intent === 'object' && f.intent.pane === mod;
const appliedFrame = (mod) => { const f = frameOn() && state.frames && state.frames.applied[mod]; return okIntent(f, mod) ? f : null; };
const proposedFrame = (mod) => { const f = frameOn() && state.frames && state.frames.pending[mod]; return okIntent(f, mod) ? f : null; };
const GROUP_ORDER = { status: ['proposed', 'confirmed', 'rejected'], author: ['you', 'model'] };
const groupOf = (g, it) => (g === 'status' ? statusOf(it) : it.author === 'model' ? 'model' : 'you');
// Cards named in order come first, in that order; the others keep theirs (ids that are gone are skipped: the file is
// hand-editable). group then sorts by group, stable.
function arrange(items, fr) {
  if (!fr) return items;
  const order = Array.isArray(fr.intent.order) ? fr.intent.order : [];
  const pos = (it) => { const k = order.indexOf(it.id); return k < 0 ? order.length + items.indexOf(it) : k; };
  let out = items.slice().sort((a, b) => pos(a) - pos(b));
  const g = GROUP_ORDER[fr.intent.group];
  if (g) out = out.map((it, i) => [it, i]).sort((a, b) => g.indexOf(groupOf(fr.intent.group, a[0])) - g.indexOf(groupOf(fr.intent.group, b[0])) || a[1] - b[1]).map((x) => x[0]);
  return out;
}
const describeFrame = (intent, max = 4) => {
  const parts = [];
  if (intent.focus) parts.push(`focus ${intent.focus}`);
  if (Array.isArray(intent.order) && intent.order.length) parts.push(`order ${intent.order.slice(0, max).join(', ')}${intent.order.length > max ? ', …' : ''}`);
  if (intent.group) parts.push(`group by ${intent.group}`);
  return parts.join(' · ');
};
// The proposal note (focusable, so Tab reaches it; f there applies) and the applied-frame line, at the top of a pane body.
function frameNodes(mod) {
  const nodes = [];
  const p = proposedFrame(mod), a = appliedFrame(mod);
  if (p) {
    const n = document.createElement('div');
    n.className = 'frame-note'; n.tabIndex = 0; n.dataset.frame = p.id; n.dataset.author = 'model';
    n.title = `frame ${p.id}, proposed by the frame role (${p.model || '?'}) at ${p.at || '?'}: ${describeFrame(p.intent, 99)}. Nothing changes until you apply it (f here).`;
    const what = document.createElement('span'); what.className = 'fn-what'; what.textContent = `model suggests: ${describeFrame(p.intent)}`;
    const by = document.createElement('small'); by.className = 'fn-by'; by.textContent = `suggested by ${p.model || 'a model'}, not by you`;
    const keys = document.createElement('span'); keys.className = 'keys';
    for (const [k, word] of [['f', 'apply'], [null, 'dismiss']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'key'; b.dataset.frameAction = word;
      b.innerHTML = k ? `<kbd>${k}</kbd><span class="w"> ${word}</span>` : `<span class="w">${word}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); sendFrame(mod, p.id, word, true); });
      keys.append(b);
    }
    n.append(what, ' ', by, ' ', keys, ' ', whyButton(mod, `why is the ${PANES[mod].title} pane framed like this?`));
    nodes.push(n);
  }
  if (a) {
    const l = document.createElement('small');
    l.className = 'frame-applied'; l.dataset.frame = a.id;
    l.title = `frame ${a.id}: ${describeFrame(a.intent, 99)}; suggested by ${a.model || '?'} at ${a.at || '?'}, applied by you at ${a.appliedAt || '?'}`;
    const r = document.createElement('button');
    r.type = 'button'; r.className = 'why'; r.textContent = 'reset'; r.title = `/frame reset ${mod}`;
    r.addEventListener('click', (e) => { e.stopPropagation(); runCommand(`/frame reset ${mod}`).catch((err) => addLine('system', `error: ${err.message}`)); });
    l.append(`frame ${a.id}: ${describeFrame(a.intent)} · `, chip('frame', `suggested by ${a.model || 'a model'}`), ' · applied by ', chip('you', 'you'), ...(a.appliedAt ? [' ', when(a.appliedAt)] : []), ' · ', r);
    nodes.push(l);
  }
  return nodes;
}
async function sendFrame(mod, id, action, fromPane) {
  const res = await fetch('/frame', { method: 'POST', headers: hdrs(), body: JSON.stringify({ pane: mod, id, action, rev: (state.frames || {}).rev }) });
  if (!res.ok) await writeFailed(res);
  await loadState();
  if (!fromPane) return;
  // focus stays in the pane: on the framed card after apply, else the pane body (Escape returns to the input)
  const a = appliedFrame(mod);
  const card = action === 'apply' && a && a.intent.focus ? bench.querySelector(`#pane-${mod} .item[data-id="${CSS.escape(a.intent.focus)}"]`) : null;
  const body = bench.querySelector(`#pane-${mod} .body`), to = card || body;
  if (body) body.scrollTop = 0;   // the frame line at the top stays in view; the marked card is scrolled to if it is lower
  if (to) { restoring = true; to.focus({ preventScroll: true }); restoring = false; to.scrollIntoView({ block: 'nearest' }); }
}
// The pane bar carries a toggle "rejected: n" when there are rejected items of the pane's kinds.
function rejectedToggle(body, kinds) {
  const bar = body.parentElement && body.parentElement.querySelector('.bar');
  if (!bar) return;
  const n = itemsFor(kinds).filter((i) => statusOf(i) === 'rejected').length;
  let b = bar.querySelector('.toggle');
  if (!n) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('button');
    b.type = 'button'; b.className = 'toggle';
    b.addEventListener('click', () => { showRejected = !showRejected; renderPanes(true); });
    bar.append(b);
  }
  b.textContent = `rejected: ${n} (${showRejected ? 'hide' : 'show'})`;
  b.setAttribute('aria-pressed', String(showRejected));
}
function heading(text) { const h = document.createElement('h3'); h.className = 'sub'; h.textContent = text; return h; }

function renderMap(body) {
  const fr = appliedFrame('map');
  const chain = itemList(itemsFor(['decision']), 'No decisions yet. Proposals appear here, dashed, after a turn.', fr);
  chain.classList.add('chain');                  // decisions as a chain, in the order they came up (01-concept, day 2)
  const nodes = [...frameNodes('map'), heading('decisions'), chain];
  const sources = itemsFor(['source']);
  if (sources.length) nodes.push(heading('sources'), itemList(sources, 'No sources shown.', fr));
  body.replaceChildren(...nodes);
  rejectedToggle(body, PANES.map.kinds);
}

function renderKanban(body) {
  const cols = document.createElement('div');
  cols.className = 'cols';
  const tasks = itemsFor(['task']);
  for (const col of ['todo', 'doing', 'done']) {
    const c = document.createElement('div');
    c.className = `col ${col}`;
    c.dataset.col = col;
    c.append(heading(col), itemList(tasks.filter((t) => (t.column || 'todo') === col), col === 'todo' && !tasks.length ? 'No tasks yet.' : '—', appliedFrame('kanban')));
    // pilot-ui: a column is a drop target for a dragged confirmed task
    c.addEventListener('dragover', (e) => { if (!dragging) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; c.classList.add('drop'); });
    c.addEventListener('dragleave', (e) => { if (!c.contains(e.relatedTarget)) c.classList.remove('drop'); });
    c.addEventListener('drop', (e) => { e.preventDefault(); c.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain') || dragging; dragging = null; if (id) moveTask(id, col); });
    cols.append(c);
  }
  body.replaceChildren(...frameNodes('kanban'), cols);
  rejectedToggle(body, PANES.kanban.kinds);
}

// pilot-ui: move a confirmed task to another column. The card moves at once; the server's answer (or a stale/refused
// write) follows and the page reloads the file truth.
const COLS = ['todo', 'doing', 'done'];
let dragging = null;
let moveChain = Promise.resolve();   // moves go one after another, each with the rev the previous one produced
function moveTask(id, col) {
  const it = (state.items || []).find((i) => i.id === id);
  if (!it || (it.column || 'todo') === col) return;
  const before = it.column;
  it.column = col; renderPanes(true);   // the card moves at once
  moveChain = moveChain.then(() => sendMove(id, col, before)).catch((err) => addLine('system', `error: ${err.message}`));
}
async function sendMove(id, col, before) {
  const undo = () => { const cur = (state.items || []).find((i) => i.id === id); if (cur) { cur.column = before; renderPanes(true); } };
  try {
    const res = await fetch('/move', { method: 'POST', headers: hdrs(), body: JSON.stringify({ itemId: id, column: col, rev: state.stateRev }) });
    if (!res.ok) { undo(); await writeFailed(res); }
    else { const b = await res.json().catch(() => ({})); if (Number.isInteger(b.rev)) state.stateRev = b.rev; }
  } catch (err) { undo(); throw err; }
  await loadState();
  const card = bench.querySelector(`#pane-kanban .item[data-id="${CSS.escape(id)}"]`);
  if (card) { restoring = true; card.focus({ preventScroll: true }); restoring = false; card.scrollIntoView({ block: 'nearest' }); }
}

// Arrow target: the proposal ArrowDown/ArrowUp from the empty input moves focus to. Defaults to the newest proposal
// shown in a pane. Only the focused card is outlined (.selected), and only a focused card takes c/r.
function visibleProposals() { return [...bench.querySelectorAll('.item[data-proposed]')]; }
function select(id) { selected = id; markSelected(); }
function markSelected() {
  const cards = visibleProposals();
  const order = (state.items || []).map((i) => i.id);
  const newestOf = (list) => list.slice().sort((a, b) => order.indexOf(b.dataset.id) - order.indexOf(a.dataset.id))[0];
  const fresh = seen ? cards.filter((c) => !seen.has(c.dataset.id)) : [];
  seen = new Set([...(seen || []), ...cards.map((c) => c.dataset.id)]);
  if (fresh.length) selected = newestOf(fresh).dataset.id;
  else if (!cards.some((c) => c.dataset.id === selected)) { const n = newestOf(cards); selected = n ? n.dataset.id : null; }
  bench.querySelectorAll('.item').forEach((c) => c.classList.toggle('selected', c === document.activeElement && !!c.dataset.proposed));
  updatePlaceholder();
}

// A failed write: a stale rev (409 {stale}) reloads state and shows a short notice; anything else is an error line.
async function writeFailed(res) {
  const body = await res.json().catch(() => ({}));
  if (body.stale) { showFlash(body.error || `${body.file} changed meanwhile; reloaded, try again`); return; }
  addLine('out', body.error || `HTTP ${res.status}`).p.classList.add('err');
}

async function sendDecision(id, word, fromCard) {
  const res = await fetch('/answer', { method: 'POST', headers: hdrs(), body: JSON.stringify({ itemId: id, decision: word, rev: state.stateRev }) });
  if (!res.ok) await writeFailed(res);
  else if (selected === id) selected = null;
  await loadState();
  // focus stays in the pane: the next proposal, else the card just decided (Escape returns to the input)
  const next = fromCard && (visibleProposals().find((c) => c.dataset.id === selected) || bench.querySelector(`.item[data-id="${CSS.escape(id)}"]`));
  (next || input).focus();
}

function firstSentence(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const s = t.split(/(?<=[.!?])\s/)[0];
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

function renderIndex(body) {
  const ol = document.createElement('ol');
  ol.className = 'idx';
  for (const l of chatLines()) {
    if (l.role !== 'user' && l.role !== 'assistant') continue;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = l.role; b.dataset.target = l.id;
    b.textContent = firstSentence(l.text) || '(empty)';
    b.title = `${l.role} · ${l.ts}`;
    b.addEventListener('click', () => jumpTo(l.id));
    li.append(b); ol.append(li);
  }
  body.replaceChildren(ol);
}

function jumpTo(id) {
  if (!$(`msg-${id}`)) return;
  // Usefulness (P5): the server logs index_jump; fire and forget, a failure never blocks the jump
  fetch('/metric', { method: 'POST', headers: hdrs(), body: JSON.stringify({ event: 'index_jump', target: id }) }).catch(() => {});
  scrollToMsg(id);
}
function scrollToMsg(id) {
  const el = $(`msg-${id}`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  return true;
}

// pilot-ui: a message in another chat: open that chat first, then scroll to it
async function showMsg(id) {
  if (scrollToMsg(id)) return;
  const res = await fetch('/chats', { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'find', msg: id }) });
  const out = await res.json().catch(() => ({}));
  if (res.ok && out.chat && out.chat !== activeChat) { await switchChat(out.chat, false); if (scrollToMsg(id)) return; }
  addLine('out', `${id} is not among the lines shown`).p.classList.add('err');
}

// pilot-v0.7: "why?" on a pane bar or a card runs the same /why command as typing it. A real button, so Tab reaches it
// and Enter/Space press it; its click does not reach the card (which would focus it).
function whyButton(target, label) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'why'; b.textContent = 'why?';
  b.dataset.why = target; b.setAttribute('aria-label', label); b.title = `/why ${target}`;
  b.addEventListener('click', (e) => { e.stopPropagation(); runCommand(`/why ${target}`).catch((err) => addLine('system', `error: ${err.message}`)); });
  return b;
}

// /why output: headings, then one line per statement with its sources ([file:line id; ...]) and, when the statement
// names a message, a "show m-…" button that scrolls to it.
function renderWhy(statements, ok) {
  let first = null;
  for (const st of statements) {
    const { p, body } = addLine('out', st.head ? st.text : '');
    p.classList.add('why-line', st.head ? 'why-head' : 'why-fact');
    p.classList.toggle('err', !ok);
    if (!st.head) {
      body.append(st.text, ' ');
      const c = document.createElement('small'); c.className = 'cite'; c.textContent = `[${st.cite.join('; ')}]`;
      body.append(c);
      if (st.msg) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'go'; b.textContent = `show ${st.msg}`;
        b.addEventListener('click', () => showMsg(st.msg).catch((err) => addLine('system', `error: ${err.message}`)));
        body.append(' ', b);
      }
    }
    first = first || p;
  }
  if (first) first.scrollIntoView({ block: 'start' });   // long explanations: start at their heading
}

// Pane bar byline (pilot-v0.6): which rule grew the pane (controller, lavender) and which answer allowed it (you,
// peach). An answer in modules.json without a matching consent event in metrics.jsonl was written by hand.
function paneByline(bar, mod) {
  const info = (state.paneInfo || {})[mod];
  let by = bar.querySelector('.pby');
  if (!info) { if (by) by.remove(); return; }
  if (!by) { by = document.createElement('small'); by.className = 'pby'; bar.querySelector('span').after(by); }
  const rule = info.metric ? `${info.metric} ≥ ${info.threshold ?? '?'}` : 'no rule';
  by.replaceChildren(chip('ctl', `controller · ${rule}`), ' · ', chip('you', info.recorded ? 'you' : 'you (file edit)'), `: ${info.answer || 'no answer'}`,
    ...(info.answeredAt ? [' ', when(info.answeredAt)] : []));
  by.title = `added ${info.addedAt || '?'} at ${info.atCount ?? '?'} ${info.metric || ''}; answer ${info.answer || 'none'} ${info.recorded ? 'recorded through the page' : 'not in metrics.jsonl (hand edit of modules.json)'}`;
}

// pilot-v0.8: the tab of a faded pane: a real button (Tab reaches it; click, Enter or Space bring the pane back).
function fadedTab(sec, mod) {
  const f = ((state.paneInfo || {})[mod] || {}).fade || {};
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tab'; b.setAttribute('aria-expanded', 'false');
  b.setAttribute('aria-label', `${PANES[mod].title}: faded, press to bring it back`);
  const lt = f.lastTouch || {};
  b.title = `faded at turn ${f.fadedTurn ?? '?'}: untouched since turn ${lt.turn ?? '?'} (fadeAfterTurns ${f.fadeAfter ?? '?'}). Click or press Enter to bring it back.`;
  const t = document.createElement('span'); t.className = 'tt'; t.textContent = `▸ ${PANES[mod].title}`;
  const s = document.createElement('small'); s.textContent = `tab · untouched since turn ${lt.turn ?? '?'}`;
  b.append(t, ' ', s);
  b.addEventListener('click', () => bringBack(mod));
  sec.append(b);
}
// Brings a faded pane back at once (locally first, then POST /touch {how: "tab"}; the server's answer follows by SSE).
let afterRender = null;   // runs once the next pane render is applied (after its View Transition callback)
function bringBack(mod) {
  sendTouch(mod, 'tab', true);   // first, so the focus that follows is not reported as a second touch
  state.faded = (state.faded || []).filter((m) => m !== mod);
  afterRender = () => { const b = document.querySelector(`#pane-${mod} .body`); if (b) { restoring = true; b.focus({ preventScroll: true }); restoring = false; } };
  renderPanes();
}
// Grid template for a layout with tabs: a shown pane gets a 1fr row, a tab an auto row; with only tabs, the side
// column shrinks to the tabs' titles (at most 18rem; the note after a title only uses space that is left) and an empty
// row fills the height.
function benchTemplate(list) {
  const faded = (m) => (state.faded || []).includes(m);
  const anyShown = list.some((m) => !faded(m));
  const rows = list.map((m, i) => `"chat p${i + 1}" ${faded(m) ? 'auto' : 'minmax(0, 1fr)'}`);
  if (!anyShown) rows.push('"chat ." minmax(0, 1fr)');
  return `${rows.join(' ')} / ${anyShown ? 'minmax(0, 1.6fr) minmax(0, 1fr)' : 'minmax(0, 1fr) fit-content(18rem)'}`;
}

function renderPanes(contentOnly, initialSnapshot = false) {
  const list = state.panes.filter((m) => PANES[m]).slice(0, 3);
  const isFaded = (m) => (state.faded || []).includes(m);
  const key = list.map((m) => (isFaded(m) ? `${m}:tab` : m)).join(',');
  const focusedId = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('item') ? document.activeElement.dataset.id : null;
  const done = () => {
    if (afterRender) { const f = afterRender; afterRender = null; f(); }
    markSelected();
    if (focusedId) { const el = bench.querySelector(`.item[data-id="${CSS.escape(focusedId)}"]`); if (el) { restoring = true; el.focus(); restoring = false; } }
  };
  const apply = () => {
    bench.querySelectorAll('.side').forEach((el) => el.remove());
    list.forEach((mod, i) => {
      const sec = document.createElement('section');
      sec.className = `pane side ${mod}`;
      sec.id = `pane-${mod}`;
      sec.dataset.pane = mod;
      sec.style.gridArea = `p${i + 1}`;
      sec.style.viewTransitionName = `pane-${mod}`;
      sec.setAttribute('aria-label', PANES[mod].title);
      if (isFaded(mod)) { sec.classList.add('faded'); fadedTab(sec, mod); bench.append(sec); return; }
      sec.innerHTML = `<div class="bar"><span>${PANES[mod].title}</span></div><div class="body"></div>`;
      sec.querySelector('.bar').append(whyButton(mod, `why is the ${PANES[mod].title} pane here?`));
      paneByline(sec.querySelector('.bar'), mod);
      sec.querySelector('.body').tabIndex = -1;   // focus target when the pane comes back from a tab
      PANES[mod].render(sec.querySelector('.body'));
      bench.append(sec);
    });
    bench.className = `bench n${list.length + 1}`;
    if (list.some(isFaded)) { bench.classList.add('dyn'); bench.style.setProperty('--tpl', benchTemplate(list)); }
    else bench.style.removeProperty('--tpl');
  };
  if (key === shownPanes || contentOnly) {       // same panes: refresh contents only
    list.forEach((mod) => {
      if (isFaded(mod)) return;
      const b = bench.querySelector(`#pane-${mod} .body`);
      if (b) { paneByline(b.parentElement.querySelector('.bar'), mod); PANES[mod].render(b); }
    });
    return done();
  }
  const first = initialSnapshot || (shownPanes === '' && !document.body.dataset.loaded);
  shownPanes = key;
  if (!first && document.startViewTransition && !reducedMotion.matches) document.startViewTransition(() => { apply(); done(); });
  else { apply(); done(); }
}

// Status bar: active model per role; "a→b" when fallback answered with another candidate; "(pinned)" after /model.
// pilot-v0.10: the frame role is listed only while the frame-proposals experiment is on (off = the old status bar)
function renderModels(m) {
  const roles = Object.entries(m || {}).filter(([role]) => role !== 'frame' || frameOn());
  models.textContent = roles.map(([role, r]) => {
    const name = r.active || 'none';
    return `${role}: ${r.last && r.last !== name ? `${name}→${r.last}` : name}${r.pinned ? ' (pinned)' : ''}`;
  }).join(' · ');
  models.textContent += ` · ${state.context?.status || 'conversation-only'}`;
  models.title = roles.map(([role, r]) => `${role}: ${r.pinned ? 'pinned, no fallback' : r.policy}, candidates ${
    r.candidates.map((n) => (r.local || []).includes(n) ? `${n} (local)` : n).join(', ') || 'none'}`).join('\n');
}

// Theme: /theme light|dark|auto, kept in this browser only (localStorage); auto follows the OS.
// pilot-ui: the switch under the chat list cycles auto → light → dark and stays in sync with /theme.
const THEME_LABEL = { auto: '◐ theme: auto', light: '☀ theme: light', dark: '☾ theme: dark' };
let theme = 'auto';
function applyTheme(t) {
  theme = t === 'light' || t === 'dark' ? t : 'auto';
  if (theme !== 'auto') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  themeBtn.textContent = THEME_LABEL[theme];
  themeBtn.title = `colour theme: ${theme}${theme === 'auto' ? ' (follows your system)' : ''}. Click to switch (or /theme light|dark|auto).`;
}
function setTheme(t) { applyTheme(t); try { localStorage.setItem('pilot-theme', theme); } catch { /* not kept */ } }
try { applyTheme(localStorage.getItem('pilot-theme')); } catch { applyTheme('auto'); }
themeBtn.addEventListener('click', () => setTheme({ auto: 'light', light: 'dark', dark: 'auto' }[theme]));

// ---- pilot-ui: chats. The list is newest activity first; double-click a title to rename it (Enter saves, Esc cancels).
function renderChats() {
  const chats = (state.chats || []).slice().sort((a, b) => String(b.lastTs || b.createdAt || '').localeCompare(String(a.lastTs || a.createdAt || '')));
  chatList.replaceChildren(...chats.map((c) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chat'; b.dataset.chat = c.id; b.disabled = streaming && c.id !== activeChat;
    if (c.id === activeChat) b.setAttribute('aria-current', 'true');
    const t = document.createElement('span'); t.className = 'ct'; t.textContent = c.title;
    const m = document.createElement('small'); m.textContent = `${c.messages} msg${c.lastTs ? ` · ${clock(c.lastTs)}` : ''}`;
    b.append(t, m);
    b.title = `${c.title}${c.named ? '' : ' (from its first message)'}. Double-click to rename.`;
    b.addEventListener('click', () => switchChat(c.id));
    b.addEventListener('dblclick', () => renameChat(li, c));
    li.append(b);
    return li;
  }));
}
function switchChat(id, focus = true) {
  if (streaming || !(state.chats || []).some((c) => c.id === id)) return;
  const changed = id !== activeChat;
  activeChat = id;
  try { localStorage.setItem('pilot-chat', id); } catch { /* not kept */ }
  fetch('/chats', { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'open', id }) }).catch(() => {});
  renderChats(); updatePlaceholder();
  if (focus) input.focus();
  return changed ? loadState(['transcript.jsonl']).then(() => renderPanes(true)) : Promise.resolve();
}
async function newChat() {
  if (streaming) return;
  const res = await fetch('/chats', { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'new' }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { addLine('out', out.error || `HTTP ${res.status}`).p.classList.add('err'); return; }
  await loadState(['chats.json']);
  switchChat(out.chat);
}
function renameChat(li, c) {
  const inp = document.createElement('input');
  inp.className = 'chat-rename'; inp.value = c.named ? c.title : ''; inp.placeholder = c.title; inp.maxLength = 80;
  inp.setAttribute('aria-label', `rename ${c.title}`);
  li.replaceChildren(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    if (save) {
      const res = await fetch('/chats', { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'rename', id: c.id, title: inp.value }) });
      if (!res.ok) await writeFailed(res);
      await loadState(['chats.json']);
    }
    renderChats();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}
newChatBtn.addEventListener('click', () => newChat().catch((err) => addLine('system', `error: ${err.message}`)));

// /state parts per file (GET /state?only=<files>). Every request gets a generation; a part is applied only if its
// response is newer than the one that last set it, so an older full load can never overwrite a newer partial one.
const PARTS = { 'transcript.jsonl': ['transcript', 'total'], 'modules.json': ['panes', 'pending', 'answers', 'modulesRev', 'models'],
  'roles.json': ['models'], 'state.json': ['items', 'stateRev', 'stateError'] };
PARTS['modules.json'].push('paneInfo', 'pendingKind', 'removals', 'faded');   // pilot-v0.6, pilot-v0.8
PARTS['transcript.jsonl'].push('turn');                                       // pilot-v0.8
PARTS['context.json'] = ['context'];
PARTS['flags.json'] = ['flags'];                                              // pilot-v0.9
PARTS['frames.json'] = ['frames'];                                            // pilot-v0.10
PARTS['transcript.jsonl'].push('chats', 'chatsRev', 'defaultChat');           // pilot-ui
PARTS['chats.json'] = ['chats', 'chatsRev', 'defaultChat'];
let reqGen = 0;
const appliedGen = {};
const sigs = {};
const sigOf = {
  log: (s) => [activeChat, s.total, (s.transcript[s.transcript.length - 1] || {}).id, s.pending, s.pendingKind, JSON.stringify(s.answers), JSON.stringify(s.removals)].join('|'),
  // items too: hand edits keep rev. pilot-v0.8: of the fade status only what the panes show (tab or not, its label), so
  // a touch (lastTouch moves) does not re-render the panes
  panes: (s) => [(s.panes || []).join(','), (s.faded || []).join(','), JSON.stringify(s.frames), !!(s.flags && s.flags.frameProposals), s.stateRev, JSON.stringify(s.items), JSON.stringify(s.paneInfo, (k, v) => (k === 'fade'
    ? (v && v.faded ? { fadedTurn: v.fadedTurn, lastTouch: v.lastTouch && v.lastTouch.turn, fadeAfter: v.fadeAfter } : null) : v))].join('|'),
  models: (s) => JSON.stringify(s.context) + JSON.stringify(s.models) + !!(s.flags && s.flags.frameProposals),
  chats: (s) => JSON.stringify(s.chats) + activeChat + streaming,
};
async function loadState(files) {
  const gen = ++reqGen;
  const list = files ? files.filter((f) => PARTS[f]) : Object.keys(PARTS);
  if (files && !list.length) return;
  const chatQ = activeChat ? `chat=${encodeURIComponent(activeChat)}` : '';   // pilot-ui: the open chat's own tail
  const next = await (await fetch(files ? `/state?only=${encodeURIComponent(list.join(','))}${chatQ ? `&${chatQ}` : ''}` : `/state${chatQ ? `?${chatQ}` : ''}`)).json();
  const initialModules = !appliedGen['modules.json'] && list.includes('modules.json') && Array.isArray(next.panes);
  if (next.context) state.context = next.context;
  if ('project' in next) state.project = next.project;
  for (const f of list) {
    if (gen <= (appliedGen[f] || 0)) continue;
    appliedGen[f] = gen;
    for (const k of PARTS[f]) if (k in next) state[k] = next[k];
  }
  if (gen > (appliedGen.flags || 0)) { appliedGen.flags = gen; state.extracting = next.extracting; state.fileErrors = next.fileErrors || {}; }
  // pilot-ui: the open chat must exist (a fresh project, another browser, a hand-edited file): else the first one
  if (state.chats && !state.chats.some((c) => c.id === activeChat)) { activeChat = state.defaultChat || 'c-1'; sigs.log = null; setTimeout(() => loadState(['transcript.jsonl']).catch(() => {}), 0); }
  // re-render only the areas whose content changed (keeps scroll and focus when nothing did)
  const dirty = (area) => { const v = sigOf[area](state); if (sigs[area] === v) return false; sigs[area] = v; return true; };
  if (dirty('log')) renderLog();
  if (dirty('panes')) renderPanes(false, initialModules);
  if (dirty('models')) renderModels(state.models);
  if (dirty('chats')) renderChats();
  updateCount();
  updatePlaceholder();
  renderNotice();
  if (typeof renderWorkspace === 'function') renderWorkspace();
  syncSettle();
  meta.textContent = state.extracting ? 'extracting proposals…'
    : state.total > state.transcript.length ? `showing last ${state.transcript.length} of ${state.total}` : live ? 'ready · live' : 'ready';
  // An early transcript/context SSE response is not the initial pane snapshot.
  if (appliedGen['modules.json']) document.body.dataset.loaded = '1';
  clearTimeout(pollTimer);
  if (state.extracting && !live) pollTimer = setTimeout(() => loadState().catch(() => {}), 300);   // fallback only
}

// Live files: the server pushes `change` {file, rev} for every file change in the pilot dir (own writes and hand
// edits) and `status` {extracting}. EventSource reconnects by itself; after a reconnect the page reloads everything.
// Without SSE (no EventSource, never connected, or dropped) the page refreshes after each action, as before.
function onFiles(files) {
  if (streaming) { files.forEach((f) => deferred.add(f)); return; }
  loadState(files).catch(() => {});
}
function connectEvents() {
  if (typeof EventSource !== 'function') return;
  es = new EventSource('/events');
  let wasLive = false;
  es.addEventListener('hello', () => {
    const again = wasLive; live = true; wasLive = true;
    if (again || document.body.dataset.loaded) onFiles(Object.keys(PARTS));   // catch up on what was missed
  });
  es.addEventListener('change', (e) => { try { onFiles([JSON.parse(e.data).file]); } catch { /* ignore a bad event */ } });
  es.addEventListener('status', (e) => {
    try { state.extracting = JSON.parse(e.data).extracting; } catch { return; }
    if (!state.extracting) onFiles(['state.json', 'modules.json', 'transcript.jsonl']);
    else meta.textContent = 'extracting proposals…';
  });
  es.onerror = () => { live = false; if (!streaming) meta.textContent = 'reconnecting…'; };   // EventSource retries
}

// ---- pilot-v0.8: touches. A touch is your interaction with a pane: pointerdown inside it (click, index jump, card,
// button, scrollbar), wheel or touchmove inside it (scrolling), or keyboard focus moved into it by you (Tab or arrows,
// i.e. a keydown just before the focus arrived; focus the page restores after a re-render is not a touch). c/r on a
// card are decided on the server, which counts the decision as a touch. Reported at most once per pane per turn.
let restoring = false, lastKeyAt = 0;
const touched = {};   // pane -> turn of the last report
function sendTouch(mod, how, force) {
  if (!force && touched[mod] === state.turn) return;
  touched[mod] = state.turn;
  fetch('/touch', { method: 'POST', headers: hdrs(), body: JSON.stringify({ module: mod, how }) })
    .then((r) => r.json()).then((b) => {
      // keep the modules.json rev current, so the touch never makes a consent answer stale
      if (b && Number.isInteger(b.rev) && b.rev > (state.modulesRev || 0)) state.modulesRev = b.rev;
      // A touch can withdraw the shared question: refresh both its state and the active chat's system line together.
      loadState(['modules.json', 'transcript.jsonl']).catch(() => {});
    }).catch(() => {});
}
const paneOf = (el) => { const sec = el && el.closest ? el.closest('.side[data-pane]') : null; return sec && !sec.classList.contains('faded') ? sec.dataset.pane : null; };
bench.addEventListener('pointerdown', (e) => { const m = paneOf(e.target); if (m) sendTouch(m, 'click'); });
bench.addEventListener('wheel', (e) => { const m = paneOf(e.target); if (m) sendTouch(m, 'scroll'); }, { passive: true });
bench.addEventListener('touchmove', (e) => { const m = paneOf(e.target); if (m) sendTouch(m, 'scroll'); }, { passive: true });
document.addEventListener('keydown', () => { lastKeyAt = Date.now(); }, true);
bench.addEventListener('focusin', (e) => {
  const m = paneOf(e.target);
  if (m && !restoring && Date.now() - lastKeyAt < 500) sendTouch(m, 'focus');
});

async function sendAnswer(module, word) {
  const res = await fetch('/answer', { method: 'POST', headers: hdrs(), body: JSON.stringify({ module, answer: word, rev: state.modulesRev }) });
  if (!res.ok) await writeFailed(res);
  await loadState();
  input.focus();
}

// Command output is shown locally only; it never goes to a model and is not stored (except /model switches).
async function runCommand(text) {
  const [cmd, arg] = text.trim().split(/\s+/);
  if (looksLikeKey(text) || (cmd === '/key' && arg && arg !== 'status')) { addLine('system', KEY_HINT); return; }
  if (cmd === '/key' && !arg) { await openSettings(); return; }
  if (cmd === '/theme') {                        // page-only command, never sent to the server
    const ok = ['light', 'dark', 'auto'].includes(arg);
    if (ok) setTheme(arg);
    addLine('out', text).p.classList.add('cmd');
    addLine('out', ok ? `theme: ${arg}` : 'usage: /theme light|dark|auto').p.classList.toggle('err', !ok);
    return;
  }
  const res = await fetch('/command', { method: 'POST', headers: hdrs(), body: JSON.stringify({ text }) });
  const out = await res.json();
  await loadState();                             // picks up a /model system line and the new status bar
  addLine('out', text).p.classList.add('cmd');
  if (cmd === '/why' && Array.isArray(out.why)) return renderWhy(out.why, out.ok);
  for (const l of out.lines || []) {
    const { p } = addLine('out', l);
    p.classList.toggle('err', !out.ok);
    const v = cmd === '/stats' && /^\w+ +(PASS|NOT YET) /.exec(l);   // /stats verdict lines: mint PASS, rose NOT YET
    if (v) p.classList.add('stat', v[1] === 'PASS' ? 'pass' : 'notyet');
  }
}

// ---- pilot-v0.9: settled input (experiment). "Last keystroke" = the last change of the input's value (the input event),
// so pasting and IME text count too. The offer is a proposal of this page's heuristic (settle.js), never of a model.
const settleOn = () => !!(state.flags && state.flags.settledInput);
let offerEl = null;          // created only while the flag is on: off renders exactly the old prompt
let settleTimer = null, lastInputAt = 0, offer = null, tabSend = null, offerSeq = 0;
function settleMetric(event, fields) {
  fetch('/metric', { method: 'POST', headers: hdrs(), body: JSON.stringify({ event, ...fields }) }).catch(() => {});
}
// Drops the offer. how = typed | escape logs settle_ignore; without how it just goes (blur, flag off, sent).
function dropOffer(how) {
  const o = offer;
  offer = null;
  if (offerEl) offerEl.hidden = true;
  input.removeAttribute('aria-describedby');
  if (o && how) settleMetric('settle_ignore', { offerRef: o.id, how, offerMs: Date.now() - o.at });
  return o;
}
function syncSettle() {
  if (settleOn() && !offerEl) {
    offerEl = document.createElement('span');
    offerEl.id = 'settle'; offerEl.className = 'settle'; offerEl.hidden = true;
    offerEl.setAttribute('role', 'status');
    offerEl.dataset.author = 'controller';
    offerEl.title = 'proposed by the settled-input heuristic of this page (no model); nothing is sent without a key';
    offerEl.textContent = 'send? (Tab to send, keep typing to ignore)';
    form.append(offerEl);
  } else if (!settleOn() && offerEl) {
    clearTimeout(settleTimer); dropOffer(); offerEl.remove(); offerEl = null;
  }
}
function maybeOffer() {
  if (!settleOn() || offer || input.disabled || document.activeElement !== input) return;
  const v = Settle.looksFinished(input.value);
  if (!v.finished) return;
  offer = { id: `so-${Date.now().toString(36)}${(offerSeq++ % 36).toString(36)}`, at: Date.now() };
  offerEl.hidden = false;
  input.setAttribute('aria-describedby', 'settle');
  const t = input.value.trim();
  settleMetric('settle_offer', { offer: offer.id, cue: v.cue, chars: t.length, words: t.split(/\s+/).length, sinceKeyMs: Date.now() - lastInputAt });
}
input.addEventListener('input', () => {
  if (!settleOn()) return;
  lastInputAt = Date.now();
  clearTimeout(settleTimer);
  if (offer) dropOffer('typed');
  settleTimer = setTimeout(maybeOffer, state.flags.settleMs);
});
input.addEventListener('blur', () => { clearTimeout(settleTimer); dropOffer(); });
input.addEventListener('keydown', (e) => {
  if (!offer || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { e.preventDefault(); dropOffer('escape'); return; }
  if (e.key !== 'Tab' || e.shiftKey) return;     // without an offer Tab moves focus as before
  e.preventDefault();
  tabSend = dropOffer();
  form.requestSubmit();
});

// Consent keys: a lowercase y/n/a/x answers the pending question only if the input is empty at keydown.
// Once anything is typed, every key is text. The buttons always work.
input.addEventListener('keydown', (e) => {
  if (!state.pending || input.value !== '' || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !KEYS[e.key]) return;
  if (e.key === 'a' && state.pendingKind === 'remove') return;   // the removal question has no "always": a stays text
  e.preventDefault();
  sendAnswer(state.pending, KEYS[e.key]);
});

// Proposal keys (pilot-v0.5): c confirms, r rejects, only on a focused proposal card, never from the chat input
// (empty or not). From the empty input, ArrowDown/ArrowUp move focus to the newest proposal (Tab works too); on a
// card, arrows move between cards and Escape returns to the input. Same guards as the consent keys.
document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const card = e.target && e.target.closest ? e.target.closest('.item') : null;
  const emptyInput = e.target === input && input.value === '';
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && card && e.target === card && card.classList.contains('movable')) {
    const it = (state.items || []).find((i) => i.id === card.dataset.id);
    const to = it && COLS[COLS.indexOf(it.column || 'todo') + (e.key === 'ArrowRight' ? 1 : -1)];
    e.preventDefault();
    if (to) moveTask(it.id, to);
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (card) {
      const all = [...bench.querySelectorAll('.item')];
      const to = all[all.indexOf(card) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (to) { e.preventDefault(); to.focus(); }
    } else if (emptyInput && selected) {
      const to = visibleProposals().find((c) => c.dataset.id === selected);
      if (to) { e.preventDefault(); to.focus(); to.scrollIntoView({ block: 'nearest' }); }
    }
    return;
  }
  if (e.key === 'Escape' && (card || (e.target.closest && e.target.closest('.frame-note')))) { e.preventDefault(); input.focus(); return; }
  // pilot-v0.10: f applies the open frame proposal of the pane that has focus (a card, the note or the pane body; not a
  // button, never the chat input)
  if (e.key === 'f') {
    const sec = e.target && e.target.closest ? e.target.closest('.side[data-pane]') : null;
    const mod = sec && !sec.classList.contains('faded') ? sec.dataset.pane : null;
    const p = mod && e.target.tagName !== 'BUTTON' ? proposedFrame(mod) : null;
    if (!p) return;
    e.preventDefault();
    sendFrame(mod, p.id, 'apply', true);
    return;
  }
  // pilot-v0.7: only the card itself, not a button inside it (a focused "why?" must never decide a proposal)
  if ((e.key !== 'c' && e.key !== 'r') || !card || e.target !== card || !card.dataset.proposed) return;
  e.preventDefault();
  sendDecision(card.dataset.id, e.key === 'c' ? 'confirm' : 'reject', card);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  const viaTab = tabSend; tabSend = null;
  if (!text) return;
  if (looksLikeKey(text) || (/^\/key\s/.test(text) && text !== '/key status')) { input.value = ''; addLine('system', KEY_HINT); return; }
  // pilot-v0.9: measure the send (messages only; commands never get an offer and are not counted)
  clearTimeout(settleTimer);
  if (settleOn() && !text.startsWith('/')) {
    const since = Date.now() - lastInputAt;
    if (viaTab) settleMetric('settle_accept', { offerRef: viaTab.id, sinceKeyMs: since, offerMs: Date.now() - viaTab.at, chars: text.length });
    else { const o = dropOffer(); settleMetric('enter_send', { offerShowing: !!o, offerRef: o ? o.id : null, sinceKeyMs: since, chars: text.length }); }
  } else dropOffer();
  input.value = '';
  if (text.startsWith('/')) {
    try { await runCommand(text); } catch (err) { addLine('system', `error: ${err.message}`); }
    return;
  }
  input.disabled = true;
  streaming = true; renderChats();   // no chat switch while a reply streams
  addLine('user', text);
  const { p, body } = addLine('assistant', '');
  p.classList.add('streaming');
  meta.textContent = 'thinking…';
  try {
    const res = await fetch('/chat', { method: 'POST', headers: hdrs(), body: JSON.stringify({ text, chat: activeChat }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      body.textContent += dec.decode(value, { stream: true });
      log.scrollTop = log.scrollHeight;
    }
    streaming = false; deferred.clear();
    await loadState();                           // re-read the file truth (model names, controller questions)
  } catch (err) {
    p.classList.remove('streaming');
    addLine('system', `error: ${err.message}`);
    meta.textContent = 'error';
  } finally {
    if (streaming) { streaming = false; if (deferred.size) onFiles([...deferred]); deferred.clear(); }
    input.disabled = false;
    renderChats();
    input.focus();
  }
});

loadState().then(() => switchChat(activeChat, false))   // tells the server which chat is open (controller lines land there)
  .catch((err) => { meta.textContent = 'offline'; addLine('system', `cannot load state: ${err.message}`); });
connectEvents();

// Credentials never enter the conversation, localStorage, metrics, or rendered output.
const KEY_HINT = 'API keys cannot be sent in chat. Use Settings (or /key) to save a key locally.';
function looksLikeKey(text) {
  return /\b(?:sk-(?:proj-|ant-)?|mistral[-_])[A-Za-z0-9_-]{8,}/i.test(text) || /^[A-Za-z0-9_+=\/.\-]{32,}$/.test(text.trim());
}
async function openSettings() {
  const dialog = $('settings'), fields = $('key-fields');
  fields.textContent = ''; $('key-notice').textContent = '';
  if (!dialog.open) dialog.showModal();
  try {
    const res = await fetch('/settings/keys'); const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    for (const k of out.keys) {
      const row = document.createElement('div'); row.className = 'key-setting';
      const label = document.createElement('label'); label.textContent = k.name;
      const field = document.createElement('input'); field.type = 'password'; field.autocomplete = 'new-password'; field.maxLength = 4096; field.id = `key-${k.name}`; label.htmlFor = field.id;
      const status = document.createElement('span'); status.className = 'key-source'; status.textContent = k.source === 'env' ? 'from environment' : k.source;
      row.append(label, field, status);
      for (const [title, method] of [['Save', 'POST'], ['Remove', 'DELETE']]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = title;
        b.addEventListener('click', async () => {
          const value = field.value; field.value = ''; b.disabled = true;
          try {
            const res = await fetch('/settings/key', { method, headers: { 'content-type': 'application/json', 'x-pilot': '1' }, body: JSON.stringify({ name: k.name, ...(method === 'POST' ? { value } : {}) }) });
            const out = await res.json(); if (!res.ok) throw new Error(out.error);
            const source = out.keys.find(x => x.name === k.name).source;
            status.textContent = source === 'env' ? 'from environment' : source;
            $('key-notice').textContent = method === 'POST' ? 'Key saved locally.' : 'Saved key removed.';
          } catch (e) { $('key-notice').textContent = e.message; }
          finally { b.disabled = false; }
        }); row.append(b);
      }
      fields.append(row);
    }
  } catch (e) { $('key-notice').textContent = e.message; }
}
$('settings-open').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', () => $('settings').close());
$('settings').addEventListener('close', () => { $('key-fields').textContent = ''; input.focus(); });
