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

// Review b87fff3 P1: upstream error text could carry a key or its prefix out to the browser.
test('no upstream error text reaches the error message, so no key prefix can', async () => {
  const LONG = 'sk-ant-' + 'x'.repeat(100);
  const e2 = { ...env, ANTHROPIC_API_KEY: LONG };
  const bodies = [{ error: { type: LONG } }, { error: { type: LONG.slice(0, 16) } }, { type: LONG.slice(0, 30) }, { error: { type: 'invalid_request_error', message: LONG } }];
  for (const b of bodies) {
    globalThis.fetch = async () => new Response(JSON.stringify(b), { status: 500 });
    await assert.rejects(streamChat('claude', e2, [{ role: 'user', content: 'hi' }], () => {}), (e) => !e.message.includes('sk-ant-') && /^HTTP 500 from Claude/.test(e.message));
  }
  globalThis.fetch = async () => sse([`data: ${JSON.stringify({ type: 'error', error: { type: LONG.slice(0, 40) } })}\n\n`]);
  await assert.rejects(streamChat('claude', e2, [{ role: 'user', content: 'hi' }], () => {}), (e) => e.message === 'Claude reported an error');
});

// Review b87fff3 P2: a body cut off before the end marker was stored as a complete reply.
test('a stream that ends without its end marker fails and keeps the partial text', async () => {
  const cut = {
    claude: () => sse([`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'truncated' } })}\n\n`]),
    mistral: () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'truncated' } }] })}\n\n`]),
  };
  for (const [id, mk] of Object.entries(cut)) {
    globalThis.fetch = async () => mk();
    await assert.rejects(streamChat(id, env, [{ role: 'user', content: 'hi' }], () => {}), (e) => /ended before the reply was complete/.test(e.message) && e.partial === 'truncated', id);
    globalThis.fetch = async () => sse([]);
    await assert.rejects(streamChat(id, env, [{ role: 'user', content: 'hi' }], () => {}), (e) => e.partial === '', `${id} empty`);
  }
});

// Review b87fff3 P2: Mistral error envelopes inside a 200 stream were ignored.
test('Mistral in-stream errors fail the reply, also when [DONE] follows', async () => {
  const err = `data: ${JSON.stringify({ error: { message: 'overloaded ' + KEY_M, type: 'server_error' } })}\n\n`;
  const part = `data: ${JSON.stringify({ choices: [{ delta: { content: 'part' } }] })}\n\n`;
  for (const events of [[err], [part, err, 'data: [DONE]\n\n'], [`data: ${JSON.stringify({ object: 'error', type: 'invalid_request', message: 'x' })}\n\n`, 'data: [DONE]\n\n']]) {
    globalThis.fetch = async () => sse(events);
    await assert.rejects(streamChat('mistral', env, [{ role: 'user', content: 'hi' }], () => {}),
      (e) => /^Mistral reported an error/.test(e.message) && !e.message.includes(KEY_M) && e.partial === (events.length === 3 ? 'part' : ''));
  }
});
