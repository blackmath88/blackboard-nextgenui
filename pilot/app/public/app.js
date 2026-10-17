// CLI Pilot page. Talks only to its own server (same origin): GET /state, POST /chat, /command, /answer.
'use strict';
const $ = (id) => document.getElementById(id);
const bench = $('bench'), log = $('log'), form = $('form'), input = $('input');
const meta = $('meta'), count = $('count'), models = $('models');
const PLACEHOLDER = input.placeholder;
const KEYS = { y: 'yes', n: 'no', a: 'always', x: 'never' };
const WHO = { user: 'you', assistant: 'pilot', system: 'sys', controller: 'ctl', out: '' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state = { transcript: [], panes: [], pending: null, answers: {} };
let shownPanes = '';
$('brand').insertAdjacentHTML('afterbegin', Pixel.sprite('teletype', 18, 'pilot') + ' ');

function addLine(role, text, model, id) {
  const p = document.createElement('p');
  p.className = `ln ${role}`;
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
    if (isLastForModule && a) { const s = document.createElement('small'); s.className = 'model'; s.textContent = `answered: ${a.answer}`; p.append(s); }
  }
}

function renderLog() {
  log.textContent = '';
  const lastCtl = {};
  state.transcript.forEach((l, i) => { if (l.role === 'controller' && l.module) lastCtl[l.module] = i; });
  state.transcript.forEach((l, i) => {
    if (l.role === 'controller') addController(l, lastCtl[l.module] === i);
    else addLine(l.role, l.text, l.model, l.id);
  });
  count.textContent = `${state.transcript.length} lines`;
  input.placeholder = state.pending ? 'Press y / n / a / x to answer the question, or type a message' : PLACEHOLDER;
}

// ---- panes: CSS grid templates for 1 to 4 panes, swapped with a View Transition ----
const PANES = {
  index: { title: 'index', render: renderIndex },
  map: { title: 'reasoning map', render: (body) => { body.textContent = 'Arrives in P3.'; } },
  kanban: { title: 'kanban', render: (body) => { body.textContent = 'Arrives in P3.'; } },
};

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

function renderPanes() {
  const list = state.panes.filter((m) => PANES[m]).slice(0, 3);
  const key = list.join(',');
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
  if (key === shownPanes) {                      // same panes: refresh contents only
    list.forEach((mod) => { const b = bench.querySelector(`#pane-${mod} .body`); if (b) PANES[mod].render(b); });
    return;
  }
  const first = shownPanes === '' && !document.body.dataset.loaded;
  shownPanes = key;
  if (!first && document.startViewTransition && !reducedMotion.matches) document.startViewTransition(apply);
  else apply();
}

// Status bar: active model per role; "a→b" when fallback answered with another candidate.
function renderModels(m) {
  models.textContent = Object.entries(m || {}).map(([role, r]) => {
    const name = r.active || 'none';
    return `${role}: ${r.last && r.last !== name ? `${name}→${r.last}` : name}`;
  }).join(' · ');
  models.title = Object.entries(m || {}).map(([role, r]) => `${role}: ${r.policy}, candidates ${r.candidates.join(', ') || 'none'}`).join('\n');
}

async function loadState() {
  state = await (await fetch('/state')).json();
  renderLog();
  renderPanes();
  renderModels(state.models);
  meta.textContent = state.total > state.transcript.length ? `showing last ${state.transcript.length} of ${state.total}` : 'ready';
  document.body.dataset.loaded = '1';
}

async function sendAnswer(module, word) {
  const res = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ module, answer: word }) });
  if (!res.ok) addLine('out', (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`).p.classList.add('err');
  await loadState();
  input.focus();
}

// Command output is shown locally only; it never goes to a model and is not stored (except /model switches).
async function runCommand(text) {
  const res = await fetch('/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const out = await res.json();
  await loadState();                             // picks up a /model system line and the new status bar
  addLine('out', text).p.classList.add('cmd');
  for (const l of out.lines || []) addLine('out', l).p.classList.toggle('err', !out.ok);
}

// Consent keys: a single lowercase y/n/a/x in the empty input answers the pending question.
input.addEventListener('keydown', (e) => {
  if (!state.pending || input.value !== '' || e.ctrlKey || e.metaKey || e.altKey || !KEYS[e.key]) return;
  e.preventDefault();
  sendAnswer(state.pending, KEYS[e.key]);
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
