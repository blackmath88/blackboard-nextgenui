import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { streamChat, scrubber, claudeMessages, providerStatus } from '../../src/providers.js';

const KEY_A = 'sk-ant-TESTKEY-aaaaaaaaaaaaaaaaaaaa', KEY_M = 'mistral-TESTKEY-mmmmmmmmmmmmmmmmmmm';
const env = { ANTHROPIC_API_KEY: KEY_A, MISTRAL_API_KEY: KEY_M, ANTHROPIC_BASE_URL: 'http://fake', MISTRAL_BASE_URL: 'http://fake/v1' };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const sse = (events) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(e)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
const anth = (texts) => sse([`event: message_start\ndata: {"type":"message_start"}\n\n`, ...texts.map((t) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })}\n\n`), `data: {"type":"message_stop"}\n\n`]);
const oai = (texts) => sse([...texts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`), 'data: [DONE]\n\n']);

test('Claude adapter: request shape and streamed text', async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return anth(['Hel', 'lo']); };
  const deltas = [];
  const out = await streamChat('claude', env, [{ role: 'user', content: 'hi' }], (d) => deltas.push(d));
  assert.equal(out.text, 'Hello'); assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.equal(seen.url, 'http://fake/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], KEY_A);
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.stream, true); assert.equal(body.model, 'claude-sonnet-5-5'); assert.ok(body.max_tokens > 0);
});

test('Mistral adapter: request shape and streamed text', async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return oai(['a', 'b', 'c']); };
  const out = await streamChat('mistral', env, [{ role: 'user', content: 'hi' }], () => {});
  assert.equal(out.text, 'abc');
  assert.equal(seen.url, 'http://fake/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, `Bearer ${KEY_M}`);
});

test('a key echoed by the provider, even split across deltas, never reaches onDelta', async () => {
  for (const [id, mk] of [['claude', anth], ['mistral', oai]]) {
    for (const key of [KEY_A, KEY_M]) {
      globalThis.fetch = async () => mk(['x ', key.slice(0, 7), key.slice(7, 20), key.slice(20), ' y']);
      let streamed = '';
      const out = await streamChat(id, env, [{ role: 'user', content: 'hi' }], (d) => { streamed += d; });
      assert.ok(!streamed.includes(key) && !out.text.includes(key), `${id} leaked`);
      assert.ok(!streamed.includes(key.slice(0, 12)), `${id} leaked a prefix`);
      assert.match(streamed, /\[redacted\]/);
    }
  }
});

test('trailing key prefix at stream end is redacted', () => {
  let s = '';
  const { emit } = scrubber([KEY_A], (d) => { s += d; });
  emit('hello ' + KEY_A.slice(0, 10)); emit('', true);
  assert.equal(s, 'hello [redacted]');
});

test('provider errors carry no response body and keep partial text', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { type: 'overloaded_error', message: `bad key ${KEY_A}` } }), { status: 529 });
  await assert.rejects(streamChat('claude', env, [{ role: 'user', content: 'hi' }], () => {}), (e) => /HTTP 529 from Claude \(overloaded_error\)/.test(e.message) && !e.message.includes(KEY_A));
  globalThis.fetch = async () => sse([`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'part' } })}\n\n`, `data: {"type":"error","error":{"type":"overloaded_error"}}\n\n`]);
  await assert.rejects(streamChat('claude', env, [{ role: 'user', content: 'hi' }], () => {}), (e) => e.partial === 'part');
});

test('first-token timeout aborts', async () => {
  globalThis.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  await assert.rejects(streamChat('mistral', env, [{ role: 'user', content: 'hi' }], () => {}, { timeoutMs: 50 }), /no reply within 50 ms/);
});

test('missing key is refused before any request', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  await assert.rejects(streamChat('claude', { MISTRAL_API_KEY: KEY_M }, [], () => {}), /not configured/);
});

test('providerStatus exposes no key material', () => {
  const s = JSON.stringify(providerStatus(env));
  assert.ok(!s.includes(KEY_A) && !s.includes(KEY_M));
  assert.deepEqual(providerStatus({}).map((p) => p.configured), [false, false]);
});

test('claudeMessages makes alternating turns that start with the user', () => {
  assert.deepEqual(claudeMessages([{ role: 'assistant', content: 'x' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }]),
    [{ role: 'user', content: 'a\n\nb' }, { role: 'assistant', content: 'c' }]);
});
