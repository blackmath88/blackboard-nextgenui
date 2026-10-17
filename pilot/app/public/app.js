// CLI Pilot page. Talks only to its own server (same origin): GET /state, POST /chat, /command, /answer.
// pilot-v0.4: map and kanban panes show items from state.json; proposals can be confirmed (c) or rejected (r).
'use strict';
const $ = (id) => document.getElementById(id);
const bench = $('bench'), log = $('log'), form = $('form'), input = $('input');
const meta = $('meta'), count = $('count'), models = $('models');
const PLACEHOLDER = input.placeholder;
const KEYS = { y: 'yes', n: 'no', a: 'always', x: 'never' };
const WHO = { user: 'you', assistant: 'pilot', system: 'sys', controller: 'ctl', out: '' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state = { transcript: [], panes: [], pending: null, answers: {}, items: [], extracting: false };
let shownPanes = '';
let selected = null;        // id of the highlighted proposal (c / r in the empty input act on it)
let seen = null;            // proposal ids already shown; a new one takes the highlight
let showRejected = false;   // rejected items are hidden behind a toggle in the pane bar
let pollTimer = null;       // while an extraction runs, /state is polled until it is done (live files come in v0.5)
$('brand').insertAdjacentHTML('afterbegin', Pixel.sprite('teletype', 18, 'pilot') + ' ');

function addLine(role, text, model, id, kind) {
  const p = document.createElement('p');
  p.className = `ln ${role}`;
  if (kind) p.classList.add(kind);              // system lines: blocked | stall | error
  if (id) p.id = `msg-${id}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = WHO[role] ?? role;
  const body = document.createElement('span');
  body.className = 'text';
  body.textContent = text;                       // model text is never parsed as HTML
  p.append(who, body);
  if (model) { const m = document.createElement('small'); m.className = 'model'; m.textContent = model; p.append(m); }
  log.append(p);
  log.scrollTop = log.scrollHeight;
  return { p, body };
}

// Controller question: sprite, text, and y/n/a/x buttons while it is the pending one.
function addController(line, isLastForModule) {
  const { p } = addLine('controller', '', null, line.id);
  p.querySelector('.who').innerHTML = Pixel.sprite('keeper', 22, 'controller');   // static sprite markup, no user text
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
  const proposed = (state.items || []).filter((i) => i.status === 'proposed').length;
  count.textContent = `${state.transcript.length} lines${proposed ? ` · ${proposed} proposed` : ''}`;
}

function updatePlaceholder() {
  const parts = [];
  if (state.pending) parts.push('y/n/a/x answer the question');
  if (selected) parts.push('c/r confirm/reject the outlined proposal');
  input.placeholder = parts.length ? `Empty input: ${parts.join(' · ')}` : PLACEHOLDER;
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
  const meta = document.createElement('small');
  meta.className = 'meta';
  const tag = document.createElement('span');
  tag.className = `tag ${status}`; tag.textContent = status;
  meta.append(`${it.id} · ${byModel ? `model · ${it.model || 'unknown'}` : 'you'} · `, tag);
  el.append(text, meta);
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
  el.addEventListener('focus', () => select(it.id));
  el.addEventListener('click', () => { select(it.id); el.focus(); });
  return el;
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
  const nodes = [heading('decisions'), itemList(itemsFor(['decision']), 'No decisions yet. Proposals appear here, dashed, after a turn.')];
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

// Selection: the highlighted proposal. Defaults to the newest proposal shown in a pane.
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
  bench.querySelectorAll('.item').forEach((c) => c.classList.toggle('selected', c.dataset.id === selected && !!c.dataset.proposed));
  updatePlaceholder();
}

async function sendDecision(id, word, fromCard) {
  const res = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: id, decision: word }) });
  if (!res.ok) addLine('out', (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`).p.classList.add('err');
  if (selected === id) selected = null;
  await loadState();
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
  el.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
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
      PANES[mod].render(sec.querySelector('.body'));
      bench.append(sec);
    });
    bench.className = `bench n${list.length + 1}`;
  };
  if (key === shownPanes || contentOnly) {       // same panes: refresh contents only
    list.forEach((mod) => { const b = bench.querySelector(`#pane-${mod} .body`); if (b) PANES[mod].render(b); });
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

const signature = (s) => [s.total, s.stateRev, s.pending, (s.panes || []).join(','), JSON.stringify(s.models)].join('|');
async function loadState(poll) {
  const next = await (await fetch('/state')).json();
  const changed = !poll || signature(next) !== signature(state);
  state = next;
  if (changed) {                                 // a poll that found nothing new leaves the page alone (scroll, focus)
    renderLog();
    renderPanes();
    renderModels(state.models);
    updatePlaceholder();
  }
  meta.textContent = state.extracting ? 'extracting proposals…' : state.stateError ? 'state.json has an error, see /state'
    : state.total > state.transcript.length ? `showing last ${state.transcript.length} of ${state.total}` : 'ready';
  document.body.dataset.loaded = '1';
  clearTimeout(pollTimer);
  if (state.extracting) pollTimer = setTimeout(() => loadState(true).catch(() => {}), 300);
}

async function sendAnswer(module, word) {
  const res = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ module, answer: word }) });
  if (!res.ok) addLine('out', (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`).p.classList.add('err');
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
  for (const l of out.lines || []) addLine('out', l).p.classList.toggle('err', !out.ok);
}

// Consent keys: a lowercase y/n/a/x answers the pending question only if the input is empty at keydown.
// Once anything is typed, every key is text. The buttons always work.
input.addEventListener('keydown', (e) => {
  if (!state.pending || input.value !== '' || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !KEYS[e.key]) return;
  e.preventDefault();
  sendAnswer(state.pending, KEYS[e.key]);
});

// Proposal keys: c confirms, r rejects. On a focused card they act on that card; in the chat input only while it
// is empty (the consent rule), on the highlighted proposal. Arrow keys move between cards, or the highlight from
// the empty input. Same guards as the consent keys.
document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const card = e.target && e.target.closest ? e.target.closest('.item') : null;
  const emptyInput = e.target === input && input.value === '';
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const step = e.key === 'ArrowDown' ? 1 : -1;
    if (card) {
      const all = [...bench.querySelectorAll('.item')];
      const to = all[all.indexOf(card) + step];
      if (to) { e.preventDefault(); to.focus(); }
    } else if (emptyInput && selected) {
      const all = visibleProposals();
      const to = all[all.findIndex((c) => c.dataset.id === selected) + step];
      if (to) { e.preventDefault(); select(to.dataset.id); to.scrollIntoView({ block: 'nearest' }); }
    }
    return;
  }
  if (e.key !== 'c' && e.key !== 'r') return;
  const id = card ? (card.dataset.proposed ? card.dataset.id : null) : emptyInput ? selected : null;
  if (!id) return;
  e.preventDefault();
  sendDecision(id, e.key === 'c' ? 'confirm' : 'reject', card);
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
    await loadState();                           // re-read the file truth (model names, controller questions)
  } catch (err) {
    p.classList.remove('streaming');
    addLine('system', `error: ${err.message}`);
    meta.textContent = 'error';
  } finally {
    input.disabled = false;
    input.focus();
  }
});

loadState().catch((err) => { meta.textContent = 'offline'; addLine('system', `cannot load state: ${err.message}`); });
