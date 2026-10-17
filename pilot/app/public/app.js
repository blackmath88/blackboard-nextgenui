// CLI Pilot page, P0. Talks only to its own server (same origin): GET /state, POST /chat.
'use strict';
const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('input');
const meta = document.getElementById('meta');
const count = document.getElementById('count');
let lines = 0;
document.getElementById('brand').insertAdjacentHTML('afterbegin', Pixel.sprite('teletype', 18, 'pilot') + ' ');

const WHO = { user: 'you', assistant: 'pilot', system: 'sys', controller: 'ctl' };

function addLine(role, text, model) {
  const p = document.createElement('p');
  p.className = `ln ${role}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = WHO[role] || role;
  const body = document.createElement('span');
  body.className = 'text';
  body.textContent = text;                       // model text is never parsed as HTML
  p.append(who, body);
  if (model) { const m = document.createElement('small'); m.className = 'model'; m.textContent = model; p.append(m); }
  log.append(p);
  log.scrollTop = log.scrollHeight;
  count.textContent = `${++lines} lines`;
  return { p, body };
}

async function loadState() {
  const res = await fetch('/state');
  const state = await res.json();
  log.textContent = ''; lines = 0;
  for (const l of state.transcript) addLine(l.role, l.text, l.model);
  meta.textContent = state.total > state.transcript.length ? `showing last ${state.transcript.length} of ${state.total}` : 'ready';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
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
    await loadState();                           // re-read the file truth (model names, system lines)
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
