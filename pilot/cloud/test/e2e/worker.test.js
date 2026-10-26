// End to end against `wrangler dev` (local workerd + SQLite Durable Object) and a fake provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakeProvider, startWorker, KEYS } from './harness.js';

const ME = 'me@example.com';
let provider, worker, persist;
const vars = (extra = {}) => ({
  ...KEYS, ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.port}`, MISTRAL_BASE_URL: `http://127.0.0.1:${provider.port}/v1`, ...extra,
});
const noKeys = (s, where) => { for (const k of Object.values(KEYS)) { assert.ok(!s.includes(k), `key leaked in ${where}`); assert.ok(!s.includes(k.slice(0, 16)), `key prefix leaked in ${where}`); } };

const get = (p) => fetch(worker.base + p);
const post = (p, body, headers = {}) => fetch(worker.base + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: worker.base, ...headers }, body: JSON.stringify(body) });
const getJson = async (p) => { const r = await get(p); assert.equal(r.status, 200, p); return r.json(); };
const newChat = async () => (await (await post('/api/conversations', {})).json()).conversation;

// Reads a streamed reply; returns the text and how many separate chunks arrived.
async function chat(id, text, providerId) {
  const res = await post(`/api/conversations/${id}/messages`, { text, provider: providerId });
  if (res.status !== 200) return { status: res.status, body: await res.json() };
  const reader = res.body.getReader(), dec = new TextDecoder();
  let out = '', chunks = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks++; out += dec.decode(value, { stream: true }); }
  return { status: 200, text: out, chunks, type: res.headers.get('content-type') };
}

before(async () => {
  provider = await fakeProvider();
  persist = mkdtempSync(path.join(tmpdir(), 'pilot-cloud-e2e-'));
  worker = await startWorker({ persist, vars: vars({ DEV_AUTH_EMAIL: ME }) });
});
after(async () => { await worker?.stop(); await provider?.close(); rmSync(persist, { recursive: true, force: true }); });

let first;   // conversation reused by the restart test

test('UI and /api/me load; key status is a boolean only', async () => {
  const html = await (await get('/')).text();
  assert.match(html, /<title>Pilot<\/title>/);
  const me = await getJson('/api/me');
  assert.equal(me.email, ME); assert.equal(me.auth, 'dev'); assert.equal(me.context, 'conversation-only');
  assert.deepEqual(me.providers.map((p) => [p.id, p.configured]), [['claude', true], ['mistral', true]]);
  noKeys(JSON.stringify(me), '/api/me');
  const res = await get('/');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});

test('Mistral and Claude replies stream through the Worker with server-side keys', async () => {
  first = await newChat();
  const m = await chat(first.id, 'hello mistral slow', 'mistral');
  assert.equal(m.status, 200); assert.match(m.type, /text\/plain/);
  assert.match(m.text, /^reply from mistral #\d+$/);
  assert.ok(m.chunks > 1, `expected a streamed reply, got ${m.chunks} chunk(s)`);
  const mc = provider.calls.at(-1);
  assert.equal(mc.key, KEYS.MISTRAL_API_KEY); assert.equal(mc.body.stream, true);

  const c = await chat(first.id, 'hello claude slow', 'claude');
  assert.match(c.text, /^reply from claude #\d+$/); assert.ok(c.chunks > 1);
  const cc = provider.calls.at(-1);
  assert.equal(cc.key, KEYS.ANTHROPIC_API_KEY); assert.equal(cc.headers['anthropic-version'], '2023-06-01');
  assert.equal(cc.headers.authorization, undefined, 'Claude call must not carry the Mistral bearer');
  assert.deepEqual(cc.body.messages.map((x) => x.role), ['user', 'assistant', 'user']);

  const conv = await getJson(`/api/conversations/${first.id}`);
  assert.deepEqual(conv.messages.map((x) => [x.role, x.provider]), [['user', null], ['assistant', 'mistral'], ['user', null], ['assistant', 'claude']]);
  assert.equal(conv.conversation.title, 'hello mistral slow');
});

test('context is conversation-only: another chat sends none of the first', async () => {
  const second = await newChat();
  await chat(second.id, 'separate topic', 'mistral');
  const sent = JSON.stringify(provider.calls.at(-1).body.messages);
  assert.ok(!sent.includes('hello mistral') && !sent.includes('reply from'), sent);
  assert.equal(provider.calls.at(-1).body.messages.length, 1);
});

test('a key echoed by the provider never reaches the browser or storage', async () => {
  const c = await newChat();
  for (const p of ['mistral', 'claude']) {
    const r = await chat(c.id, 'please echo key', p);
    assert.match(r.text, /\[redacted\]/); noKeys(r.text, `${p} stream`);
  }
  noKeys(JSON.stringify(await getJson(`/api/conversations/${c.id}`)), 'stored messages');
  const f = await chat(c.id, 'now fail', 'claude');
  assert.match(f.text, /chat failed: HTTP 500 from Claude \(api_error\)/); noKeys(f.text, 'error');
  for (const p of ['/', '/app.js', '/style.css', '/cloud.css', '/api/conversations']) noKeys(await (await get(p)).text(), p);
  noKeys(worker.logs(), 'worker logs');
});

test('key-like chat input is refused before it is stored or sent', async () => {
  const c = await newChat(), calls = provider.calls.length;
  for (const text of ['sk-ant-abcdefghijklmnop', `my key ${KEYS.MISTRAL_API_KEY}`]) {
    const r = await chat(c.id, text, 'mistral');
    assert.equal(r.status, 400); assert.match(r.body.error, /API key/);
  }
  assert.equal(provider.calls.length, calls);
  assert.equal((await getJson(`/api/conversations/${c.id}`)).messages.length, 0);
  // Review b87fff3 P2: titles went to storage unchecked.
  for (const title of [KEYS.ANTHROPIC_API_KEY, `x ${KEYS.MISTRAL_API_KEY}`, 'sk-proj-abcdefghijklmnop']) {
    const r = await post('/api/conversations', { title });
    assert.equal(r.status, 400); noKeys(await r.text(), 'title refusal');
  }
  noKeys(JSON.stringify(await getJson('/api/conversations')), 'conversation list');
});

test('cross-origin and non-JSON writes are refused', async () => {
  const body = JSON.stringify({});
  const r1 = await fetch(worker.base + '/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const r2 = await fetch(worker.base + '/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body });
  const r3 = await fetch(worker.base + '/api/conversations', { method: 'POST', headers: { 'content-type': 'text/plain', origin: worker.base }, body });
  assert.deepEqual([r1.status, r2.status, r3.status], [403, 403, 403]);
  assert.equal((await post('/api/conversations/nope/messages', { text: 'x', provider: 'mistral' })).status, 404);
  assert.equal((await post(`/api/conversations/${first.id}/messages`, { text: 'x', provider: 'openai' })).status, 400);
});

test('Durable Object state survives a Worker restart; another user sees nothing', async () => {
  const before = await getJson(`/api/conversations/${first.id}`);
  const list = (await getJson('/api/conversations')).conversations;
  await worker.stop();

  worker = await startWorker({ persist, vars: vars({ DEV_AUTH_EMAIL: 'other@example.com' }) });
  assert.deepEqual((await getJson('/api/conversations')).conversations, []);
  assert.equal((await get(`/api/conversations/${first.id}`)).status, 404);
  await worker.stop();

  worker = await startWorker({ persist, vars: vars({ DEV_AUTH_EMAIL: ME }) });
  assert.deepEqual((await getJson('/api/conversations')).conversations.map((c) => c.id), list.map((c) => c.id));
  assert.deepEqual(await getJson(`/api/conversations/${first.id}`), before);
  const r = await chat(first.id, 'still here?', 'claude');
  assert.match(r.text, /^reply from claude/);
  assert.equal(provider.calls.at(-1).body.messages.length, 5, 'history after restart is the stored conversation');
});

test('without dev login, every route requires a valid Access identity', async () => {
  await worker.stop();
  worker = await startWorker({ persist, vars: vars({ ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAILS: ME }) });
  for (const p of ['/', '/index.html', '/app.js', '/style.css', '/api/me', '/api/conversations', `/api/conversations/${first.id}`]) {
    const r = await get(p);
    assert.equal(r.status, 401, p); noKeys(await r.text(), p);
  }
  assert.equal((await post(`/api/conversations/${first.id}/messages`, { text: 'hi', provider: 'claude' })).status, 401);
  assert.equal((await fetch(worker.base + '/api/me', { headers: { 'cf-access-jwt-assertion': 'not-a-token' } })).status, 403);
  await worker.stop();
  worker = await startWorker({ persist, vars: vars({ ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com', ACCESS_AUD: 'aud' }) });
  assert.equal((await get('/api/me')).status, 500, 'no allowlist: fail closed');
});
