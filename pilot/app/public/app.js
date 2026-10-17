// CLI Pilot page. Talks only to its own server (same origin): GET /state, POST /chat, /command, /answer.
// pilot-v0.4: map and kanban panes show items from state.json; proposals can be confirmed (c) or rejected (r).
// pilot-v0.5: live files. GET /events (SSE) says which file changed; the page reloads only that part of /state.
// Writes carry the rev the page last saw; a stale one comes back 409 {stale} and the page reloads with a notice.
// c/r act only on a focused proposal card (Tab or arrows into a pane; Escape back to the input).
// pilot-v0.6: every line, item and pane says who authored it (peach you, sky model, lavender controller); a hand edit
// of state.json shows as "you (file edit)" (the server compares the file with its own write ledger, see stats.js).
// Index jumps are reported with POST /metric (the Usefulness measure of /stats).
'use strict';
const $ = (id) => document.getElementById(id);
const bench = $('bench'), log = $('log'), form = $('form'), input = $('input');
const meta = $('meta'), count = $('count'), models = $('models'), notice = $('notice');
const PLACEHOLDER = input.placeholder;
const KEYS = { y: 'yes', n: 'no', a: 'always', x: 'never' };
const WHO = { user: 'you', assistant: 'model', system: 'system', controller: 'controller', out: '' };
const AUTHOR = { user: 'you', assistant: 'model', system: 'system', controller: 'controller' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state = { transcript: [], panes: [], pending: null, answers: {}, items: [], extracting: false, fileErrors: {} };
let shownPanes = '';
let selected = null;        // the proposal ArrowDown/ArrowUp from the empty input moves focus to (the newest by default)
let seen = null;            // proposal ids already shown; a new one becomes the arrow target
let showRejected = false;   // rejected items are hidden behind a toggle in the pane bar
let pollTimer = null;       // fallback without SSE: while an extraction runs, /state is polled until it is done
let es = null, live = false; // EventSource on /events; live = connected (else: refresh after each action + poll)
let streaming = false;      // this tab is streaming a reply: file events wait (a re-render would drop the live line)
const deferred = new Set(); // files changed while streaming
let flash = null, flashTimer = null;   // short notice after a stale write
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
function addController(line, isLastForModule) {
  const { p } = addLine('controller', '', null, line.id);
  p.querySelector('.who').innerHTML = Pixel.sprite('keeper', 22, 'controller') + '<span class="role">controller</span>';   // static markup, no user text
  p.querySelector('.text').textContent = line.text;
  const pending = isLastForModule && state.pending && state.pending === line.module;
  if (pending) {
    const keys = document.createElement('span');
    keys.className = 'keys';
    for (const [k, word] of Object.entries(KEYS)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'key'; b.dataset.answer = word;
      b.innerHTML = `<kbd>${k}</kbd> ${word}`;
      b.addEventListener('click', () => sendAnswer(line.module, word));
      keys.append(b);
    }
    p.querySelector('.text').append(keys);
    p.classList.add('pending');
  } else {
    p.classList.add('done');
    const a = state.answers[line.module];
    if (isLastForModule && a) { const s = document.createElement('small'); s.className = `model ${a.answer}`; s.textContent = `answered: ${a.answer}`; p.append(s); }
  }
}

function renderLog() {
  log.textContent = '';
  const lastCtl = {};
  state.transcript.forEach((l, i) => { if (l.role === 'controller' && l.module) lastCtl[l.module] = i; });
  state.transcript.forEach((l, i) => {
    if (l.role === 'controller') addController(l, lastCtl[l.module] === i);
    else addLine(l.role, l.text, l.model, l.id, l.kind);
  });
  updateCount();
}
function updateCount() {
  const proposed = (state.items || []).filter((i) => i.status === 'proposed').length;
  count.textContent = `${state.transcript.length} lines${proposed ? ` · ${proposed} proposed` : ''}`;
}

function updatePlaceholder() {
  const parts = [];
  if (state.pending) parts.push('y/n/a/x answer the question');
  if (selected) parts.push('↓ or Tab to the proposals (c/r there, Esc back)');
  input.placeholder = parts.length ? `Empty input: ${parts.join(' · ')}` : PLACEHOLDER;
}

// Notice above the log: a broken hand-edited file (until it is fixed) and, for a few seconds, a stale-write message.
function renderNotice() {
  const lines = Object.keys(state.fileErrors || {}).map((f) => `file ${f} is not valid JSON, showing last good version`);
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
  el.append(text, itemMeta(it, status, byModel));
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
  const edited = fields.filter((f) => !['status', 'decidedAt', 'decidedBy'].includes(f));
  if (edited.length) meta.append(' · edited by ', chip('you', 'you (file edit)'), `: ${edited.join(', ')}`);
  return meta;
}

function itemsFor(kinds) { return (state.items || []).filter((i) => kinds.includes(i.kind)); }
function itemList(items, empty) {
  const box = document.createElement('div');
  box.className = 'items';
  const shown = items.filter((i) => showRejected || statusOf(i) !== 'rejected');
  if (!shown.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = empty; box.append(p); }
  for (const it of shown) box.append(itemCard(it));
  return box;
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
  const chain = itemList(itemsFor(['decision']), 'No decisions yet. Proposals appear here, dashed, after a turn.');
  chain.classList.add('chain');                  // decisions as a chain, in the order they came up (01-concept, day 2)
  const nodes = [heading('decisions'), chain];
  const sources = itemsFor(['source']);
  if (sources.length) nodes.push(heading('sources'), itemList(sources, 'No sources shown.'));
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
    c.append(heading(col), itemList(tasks.filter((t) => (t.column || 'todo') === col), col === 'todo' && !tasks.length ? 'No tasks yet.' : '—'));
    cols.append(c);
  }
  body.replaceChildren(cols);
  rejectedToggle(body, PANES.kanban.kinds);
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
  const res = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: id, decision: word, rev: state.stateRev }) });
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
  for (const l of state.transcript) {
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
  const el = $(`msg-${id}`);
  if (!el) return;
  // Usefulness (P5): the server logs index_jump; fire and forget, a failure never blocks the jump
  fetch('/metric', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'index_jump', target: id }) }).catch(() => {});
  el.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
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

function renderPanes(contentOnly) {
  const list = state.panes.filter((m) => PANES[m]).slice(0, 3);
  const key = list.join(',');
  const focusedId = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('item') ? document.activeElement.dataset.id : null;
  const done = () => {
    markSelected();
    if (focusedId) { const el = bench.querySelector(`.item[data-id="${CSS.escape(focusedId)}"]`); if (el) el.focus(); }
  };
  const apply = () => {
    bench.querySelectorAll('.side').forEach((el) => el.remove());
    list.forEach((mod, i) => {
      const sec = document.createElement('section');
      sec.className = `pane side ${mod}`;
      sec.id = `pane-${mod}`;
      sec.style.gridArea = `p${i + 1}`;
      sec.style.viewTransitionName = `pane-${mod}`;
      sec.setAttribute('aria-label', PANES[mod].title);
      sec.innerHTML = `<div class="bar"><span>${PANES[mod].title}</span></div><div class="body"></div>`;
      paneByline(sec.querySelector('.bar'), mod);
      PANES[mod].render(sec.querySelector('.body'));
      bench.append(sec);
    });
    bench.className = `bench n${list.length + 1}`;
  };
  if (key === shownPanes || contentOnly) {       // same panes: refresh contents only
    list.forEach((mod) => {
      const b = bench.querySelector(`#pane-${mod} .body`);
      if (b) { paneByline(b.parentElement.querySelector('.bar'), mod); PANES[mod].render(b); }
    });
    return done();
  }
  const first = shownPanes === '' && !document.body.dataset.loaded;
  shownPanes = key;
  if (!first && document.startViewTransition && !reducedMotion.matches) document.startViewTransition(() => { apply(); done(); });
  else { apply(); done(); }
}

// Status bar: active model per role; "a→b" when fallback answered with another candidate; "(pinned)" after /model.
function renderModels(m) {
  models.textContent = Object.entries(m || {}).map(([role, r]) => {
    const name = r.active || 'none';
    return `${role}: ${r.last && r.last !== name ? `${name}→${r.last}` : name}${r.pinned ? ' (pinned)' : ''}`;
  }).join(' · ');
  models.title = Object.entries(m || {}).map(([role, r]) => `${role}: ${r.pinned ? 'pinned, no fallback' : r.policy}, candidates ${
    r.candidates.map((n) => (r.local || []).includes(n) ? `${n} (local)` : n).join(', ') || 'none'}`).join('\n');
}

// Theme: /theme light|dark|auto, kept in this browser only (localStorage); auto follows the OS.
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem('pilot-theme')); } catch { /* storage blocked: auto */ }

// /state parts per file (GET /state?only=<files>). Every request gets a generation; a part is applied only if its
// response is newer than the one that last set it, so an older full load can never overwrite a newer partial one.
const PARTS = { 'transcript.jsonl': ['transcript', 'total'], 'modules.json': ['panes', 'pending', 'answers', 'modulesRev', 'models'],
  'roles.json': ['models'], 'state.json': ['items', 'stateRev', 'stateError'] };
PARTS['modules.json'].push('paneInfo');
let reqGen = 0;
const appliedGen = {};
const sigs = {};
const sigOf = {
  log: (s) => [s.total, (s.transcript[s.transcript.length - 1] || {}).id, s.pending, JSON.stringify(s.answers)].join('|'),
  panes: (s) => [(s.panes || []).join(','), s.stateRev, JSON.stringify(s.items), JSON.stringify(s.paneInfo)].join('|'),   // items too: hand edits keep rev
  models: (s) => JSON.stringify(s.models),
};
async function loadState(files) {
  const gen = ++reqGen;
  const list = files ? files.filter((f) => PARTS[f]) : Object.keys(PARTS);
  if (files && !list.length) return;
  const next = await (await fetch(files ? `/state?only=${encodeURIComponent(list.join(','))}` : '/state')).json();
  for (const f of list) {
    if (gen <= (appliedGen[f] || 0)) continue;
    appliedGen[f] = gen;
    for (const k of PARTS[f]) if (k in next) state[k] = next[k];
  }
  if (gen > (appliedGen.flags || 0)) { appliedGen.flags = gen; state.extracting = next.extracting; state.fileErrors = next.fileErrors || {}; }
  // re-render only the areas whose content changed (keeps scroll and focus when nothing did)
  const dirty = (area) => { const v = sigOf[area](state); if (sigs[area] === v) return false; sigs[area] = v; return true; };
  if (dirty('log')) renderLog();
  if (dirty('panes')) renderPanes();
  if (dirty('models')) renderModels(state.models);
  updateCount();
  updatePlaceholder();
  renderNotice();
  meta.textContent = state.extracting ? 'extracting proposals…'
    : state.total > state.transcript.length ? `showing last ${state.transcript.length} of ${state.total}` : live ? 'ready · live' : 'ready';
  document.body.dataset.loaded = '1';
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

async function sendAnswer(module, word) {
  const res = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ module, answer: word, rev: state.modulesRev }) });
  if (!res.ok) await writeFailed(res);
  await loadState();
  input.focus();
}

// Command output is shown locally only; it never goes to a model and is not stored (except /model switches).
async function runCommand(text) {
  const [cmd, arg] = text.trim().split(/\s+/);
  if (cmd === '/theme') {                        // page-only command, never sent to the server
    const ok = ['light', 'dark', 'auto'].includes(arg);
    if (ok) { applyTheme(arg); try { localStorage.setItem('pilot-theme', arg); } catch { /* not kept */ } }
    addLine('out', text).p.classList.add('cmd');
    addLine('out', ok ? `theme: ${arg}` : 'usage: /theme light|dark|auto').p.classList.toggle('err', !ok);
    return;
  }
  const res = await fetch('/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const out = await res.json();
  await loadState();                             // picks up a /model system line and the new status bar
  addLine('out', text).p.classList.add('cmd');
  for (const l of out.lines || []) {
    const { p } = addLine('out', l);
    p.classList.toggle('err', !out.ok);
    const v = cmd === '/stats' && /^\w+ +(PASS|NOT YET) /.exec(l);   // /stats verdict lines: mint PASS, rose NOT YET
    if (v) p.classList.add('stat', v[1] === 'PASS' ? 'pass' : 'notyet');
  }
}

// Consent keys: a lowercase y/n/a/x answers the pending question only if the input is empty at keydown.
// Once anything is typed, every key is text. The buttons always work.
input.addEventListener('keydown', (e) => {
  if (!state.pending || input.value !== '' || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !KEYS[e.key]) return;
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
  if (e.key === 'Escape' && card) { e.preventDefault(); input.focus(); return; }
  if ((e.key !== 'c' && e.key !== 'r') || !card || !card.dataset.proposed) return;
  e.preventDefault();
  sendDecision(card.dataset.id, e.key === 'c' ? 'confirm' : 'reject', card);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (text.startsWith('/')) {
    try { await runCommand(text); } catch (err) { addLine('system', `error: ${err.message}`); }
    return;
  }
  input.disabled = true;
  streaming = true;
  addLine('user', text);
  const { p, body } = addLine('assistant', '');
  p.classList.add('streaming');
  meta.textContent = 'thinking…';
  try {
    const res = await fetch('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
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
    input.focus();
  }
});

loadState().catch((err) => { meta.textContent = 'offline'; addLine('system', `cannot load state: ${err.message}`); });
connectEvents();
