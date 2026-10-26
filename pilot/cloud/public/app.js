// Pilot Cloud browser client. Everything it needs comes from /api/*; it never sees a provider key.
'use strict';
const $ = (id) => document.getElementById(id);
const log = $('log'), form = $('form'), input = $('input'), list = $('chat-list'), notice = $('notice'), providerSel = $('provider');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
let me = null, chats = [], active = null, sending = false;

const api = async (path, opts = {}) => {
  const res = await fetch('/api' + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) { let msg = `HTTP ${res.status}`; try { msg = (await res.json()).error || msg; } catch { /* not JSON */ } throw new Error(msg); }
  return res;
};
const show = (msg) => { notice.textContent = msg || ''; notice.hidden = !msg; };

function line(role, text, { model, status } = {}) {
  const p = document.createElement('p');
  p.className = `ln ${role}${role === 'system' && status === 'error' ? ' error' : ''}`;
  const who = document.createElement('span'); who.className = 'who';
  who.textContent = role === 'user' ? 'you' : role === 'assistant' ? 'pilot' : 'system';
  p.append(who);
  if (model) { const m = document.createElement('span'); m.className = 'model'; m.textContent = model + (status === 'partial' ? ' (partial)' : ''); p.append(m, ' '); }
  const t = document.createElement('span'); t.className = 'text'; t.textContent = text; p.append(t);
  log.append(p); log.scrollTop = log.scrollHeight;
  return t;
}

function renderChats() {
  list.replaceChildren(...chats.map((c) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.className = 'chat'; b.disabled = sending;
    if (c.id === active) b.setAttribute('aria-current', 'true');
    const t = document.createElement('span'); t.className = 'ct'; t.textContent = c.title || 'new chat';
    const s = document.createElement('small'); s.textContent = `${c.messages} messages`;
    b.append(t, s); b.onclick = () => open(c.id); li.append(b); return li;
  }));
}

async function refreshChats() { chats = (await (await api('/conversations')).json()).conversations; renderChats(); }

async function open(id) {
  active = id; store.set('pilot.chat', id); renderChats();
  const out = await (await api('/conversations/' + encodeURIComponent(id))).json();
  log.replaceChildren();
  for (const m of out.messages) line(m.role, m.text, m);
  if (out.streaming) show('A reply is still being written in this chat; reopen it in a moment.'); else show('');
  input.focus();
}

async function newChat() {
  const c = (await (await api('/conversations', { method: 'POST', body: '{}' })).json()).conversation;
  await refreshChats(); await open(c.id);
}

async function send(text) {
  if (!active) await newChat();
  sending = true; input.disabled = true; renderChats(); show('');
  line('user', text);
  const provider = providerSel.value;
  const target = line('assistant', '', { model: (me.providers.find((p) => p.id === provider) || {}).model });
  try {
    const res = await api(`/conversations/${encodeURIComponent(active)}/messages`, { method: 'POST', body: JSON.stringify({ text, provider }) });
    const reader = res.body.getReader(), dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; target.textContent += dec.decode(value, { stream: true }); log.scrollTop = log.scrollHeight; }
  } catch (err) { show(err.message); }
  sending = false; input.disabled = false; input.focus();
  await refreshChats(); await open(active);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || sending) return;
  input.value = '';
  send(text).catch((err) => show(err.message));
});
$('new-chat').onclick = () => newChat().catch((err) => show(err.message));
providerSel.onchange = () => store.set('pilot.provider', providerSel.value);

const themeBtn = $('theme-toggle');
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; themeBtn.textContent = `theme: ${t || 'system'}`; }
themeBtn.onclick = () => { const order = [null, 'light', 'dark']; const next = order[(order.indexOf(document.documentElement.dataset.theme || null) + 1) % 3]; store.set('pilot.theme', next || ''); applyTheme(next); };
applyTheme(store.get('pilot.theme') || null);

(async () => {
  try {
    me = await (await api('/me')).json();
    $('who').textContent = me.email + (me.auth === 'dev' ? ' (local dev login)' : '');
    $('meta').textContent = 'connected';
    providerSel.replaceChildren(...me.providers.map((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.label} · ${p.model}${p.configured ? '' : ' (no key)'}`; o.disabled = !p.configured; return o; }));
    const saved = store.get('pilot.provider'), ok = me.providers.filter((p) => p.configured);
    providerSel.value = ok.some((p) => p.id === saved) ? saved : (ok[0] || {}).id || '';
    if (!ok.length) show('No model provider is configured on the server yet.');
    await refreshChats();
    const last = store.get('pilot.chat');
    if (chats.some((c) => c.id === last)) await open(last); else if (chats[0]) await open(chats[0].id);
  } catch (err) { $('meta').textContent = 'not connected'; show(err.message); }
})();
