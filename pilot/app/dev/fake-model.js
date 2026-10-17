#!/usr/bin/env node
// DEV ONLY. Not used by the normal start path (`node server.js`).
// A tiny fake OpenAI-compatible endpoint: POST /v1/chat/completions,
// streaming (SSE) and non-streaming, canned replies, no dependencies.
// Usage: node dev/fake-model.js <port> [name]    e.g. node dev/fake-model.js 5701 frontier
// Every reply starts with "[fake:<name>]" so you can tell instances apart.
'use strict';
const http = require('http');

const port = Number(process.argv[2]);
const name = process.argv[3] || `fake-${port}`;
if (!port) { console.error('usage: node dev/fake-model.js <port> [name]'); process.exit(1); }

const CANNED = [
  'Noted. Let us keep the first version small and see what grows.',
  'That sounds like a decision: ship the skeleton first, then add roles.',
  'One task falls out of this: write the checks before the next step.',
  'Good question. The files in .pilot/ stay the source of truth either way.',
];
let turn = 0;

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'not found' } }));
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let reqJson = {};
    try { reqJson = JSON.parse(body); } catch { /* ignore */ }
    const msgs = Array.isArray(reqJson.messages) ? reqJson.messages : [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const echo = lastUser ? String(lastUser.content).slice(0, 60) : '';
    const reply = `[fake:${name}] ${CANNED[turn++ % CANNED.length]} (you said: "${echo}"; ${msgs.length} messages in context)`;
    const model = reqJson.model || name;
    const id = `chatcmpl-fake-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    if (!reqJson.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id, object: 'chat.completion', created, model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const words = reply.split(/(?<= )/);
    let i = 0;
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta, finish_reason: finish || null }] })}\n\n`;
    res.write(chunk({ role: 'assistant' }));
    const t = setInterval(() => {
      if (i < words.length) return res.write(chunk({ content: words[i++] }));
      clearInterval(t);
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    }, 40);
    res.on('close', () => clearInterval(t));
  });
}).listen(port, '127.0.0.1', () => console.log(`[dev] fake model "${name}" on http://127.0.0.1:${port}/v1`));
