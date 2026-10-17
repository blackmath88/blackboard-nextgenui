#!/usr/bin/env node
// DEV ONLY. Not used by the normal start path (`node server.js`).
// A tiny fake OpenAI-compatible endpoint: POST /v1/chat/completions,
// streaming (SSE) and non-streaming, canned replies, no dependencies.
// Usage: node dev/fake-model.js <port> [name] [--delay=<ms>] [--status=<code>] [--stall-after=<n>]
//        [--extract=good|malformed|badquote|many|dupes] [--extract-delay=<ms>]
//   e.g. node dev/fake-model.js 5701 frontier
//   --delay=<ms>     wait before the first byte (to exercise timeouts)
//   --status=<code>  answer every request with this HTTP error (to exercise fallback)
//   --stall-after=<n> stream n content tokens, then send nothing more but keep the connection open
//                    (to exercise the stall timeout; streaming requests only)
//   --extract=<mode>  how to answer an extraction request (pilot-v0.4): one that carries `response_format`
//                    or whose system message contains "PILOT-EXTRACT". Default good. The turn is read from the
//                    server's prompt ("Last user message:" / "Last assistant message:"); sentences starting
//                    "Decision:" become decisions, "Task:" / "TODO" tasks, http(s) URLs sources (quote = the
//                    sentence or the URL, so quotes really occur in the turn).
//                    good      the derived items, at most 3
//                    malformed truncated JSON
//                    badquote  like good, but the first item's quote is not in the turn
//                    many      every derived item plus every other sentence as a decision, up to 5 (> 3)
//                    dupes     the first derived item twice (second in capitals with "!") plus "the <title>"
//                              of the first existing item, i.e. near-duplicates within the batch and of state.json
//   --extract-delay=<ms> extra wait before answering an extraction request (chat requests are not delayed)
// Extraction requests never advance the canned chat replies, and each prints one "[extract] ..." log line.
// Every chat reply starts with "[fake:<name>]" so you can tell instances apart.
'use strict';
const http = require('http');

const port = Number(process.argv[2]);
const name = (process.argv[3] && !process.argv[3].startsWith('--')) ? process.argv[3] : `fake-${port}`;
const opt = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : 0; };
const delay = opt('delay');
const failStatus = opt('status');
const stallAfter = opt('stall-after');
const extractMode = ((process.argv.find((x) => x.startsWith('--extract=')) || '--extract=good').split('=')[1]);
const extractDelay = opt('extract-delay');
if (!['good', 'malformed', 'badquote', 'many', 'dupes'].includes(extractMode)) { console.error(`unknown --extract mode "${extractMode}"`); process.exit(1); }
if (!port) { console.error('usage: node dev/fake-model.js <port> [name]'); process.exit(1); }

const CANNED = [
  'Noted. Let us keep the first version small and see what grows.',
  'That sounds like a decision: ship the skeleton first, then add roles.',
  'One task falls out of this: write the checks before the next step.',
  'Good question. The files in .pilot/ stay the source of truth either way.',
];
let turn = 0;

// ---- fake extractor (deterministic, derived from the turn in the prompt) ----
const sentences = (t) => String(t).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const clean = (t) => t.replace(/[.!?\s]+$/, '').slice(0, 240);
function readPrompt(msgs) {
  const u = msgs.filter((m) => m.role === 'user').pop();
  const c = String(u ? u.content : '');
  const sec = (h, next) => { const i = c.indexOf(h); if (i < 0) return ''; const from = i + h.length; const j = next ? c.indexOf(next, from) : -1; return c.slice(from, j < 0 ? undefined : j).trim(); };
  const existing = sec('Existing items:\n', '\n\nLast user message:\n').split('\n')
    .map((l) => /^- (\S+) \((\w+), (\w+)\): (.*)$/.exec(l)).filter(Boolean).map((m) => ({ id: m[1], kind: m[2], status: m[3], text: m[4] }));
  return { existing, turn: sec('Last user message:\n', '\n\nLast assistant message:\n') + '\n' + sec('Last assistant message:\n') };
}
function derive(turnText) {
  const out = [];
  // Ignore this fake's own chat echo ("(you said: "..."; n messages in context)"), or it would re-propose the user's words.
  const text = String(turnText).replace(/\(you said: "[\s\S]*?"; \d+ messages in context\)/g, '');
  for (const s of sentences(text)) {
    let m;
    if ((m = /^Decision:\s*(.{3,})$/i.exec(s))) out.push({ kind: 'decision', text: clean(m[1]), quote: s });
    else if ((m = /^(?:Task:|TODO:?)\s*(.{3,})$/i.exec(s))) out.push({ kind: 'task', text: clean(m[1]), quote: s });
    for (const raw of s.match(/https?:\/\/[^\s)>\]]+/g) || []) {
      const url = raw.replace(/[.,;:!?]+$/, '');
      out.push({ kind: 'source', text: clean(`Source: ${url.replace(/^https?:\/\//, '')}`), quote: url, url });
    }
  }
  return out;
}
function extraction(msgs) {
  const { existing, turn: t } = readPrompt(msgs);
  const d = derive(t);
  if (extractMode === 'malformed') return '{"items": [{"kind": "decision", "text": "unterminated';
  let items;
  if (extractMode === 'good') items = d.slice(0, 3);
  if (extractMode === 'badquote') {
    items = d.length ? d.slice(0, 3) : [{ kind: 'decision', text: 'A decision nobody made', quote: 'x' }];
    items[0] = { ...items[0], quote: 'words that were never said in this turn' };
  }
  if (extractMode === 'many') {
    items = [...d];
    for (const s of sentences(t)) { if (items.length >= 5) break; if (!d.some((x) => x.quote === s) && s.length >= 3) items.push({ kind: 'decision', text: clean(s) || s, quote: s }); }
  }
  if (extractMode === 'dupes') {
    items = [];
    if (d[0]) items.push(d[0], { ...d[0], text: d[0].text.toUpperCase() + '!' });
    const e = existing.find((x) => x.status !== 'rejected');
    const quote = d[0] ? d[0].quote : (sentences(t)[0] || 'x');
    if (e) items.push({ kind: e.kind, text: `the ${e.text}`, quote });
    items = items.slice(0, 3);
  }
  return JSON.stringify({ items });
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'not found' } }));
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let peek = {};
    try { peek = JSON.parse(body); } catch { /* ignore */ }
    const isExtract = !!peek.response_format || (Array.isArray(peek.messages) && peek.messages.some((m) => m.role === 'system' && String(m.content).includes('PILOT-EXTRACT')));
    setTimeout(() => respond(req, res, body, isExtract), delay + (isExtract ? extractDelay : 0));
  });
}).listen(port, '127.0.0.1', () => console.log(`[dev] fake model "${name}" on http://127.0.0.1:${port}/v1${delay ? ` (delay ${delay} ms)` : ''}${failStatus ? ` (always HTTP ${failStatus})` : ''}${stallAfter ? ` (stalls after ${stallAfter} tokens)` : ''} (extract: ${extractMode}${extractDelay ? `, +${extractDelay} ms` : ''})`));

function respond(req, res, body, isExtract) {
  if (failStatus) {
    res.writeHead(failStatus, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `[fake:${name}] forced error ${failStatus}` } }));
  }
  let reqJson = {};
  try { reqJson = JSON.parse(body); } catch { /* ignore */ }
  const msgs = Array.isArray(reqJson.messages) ? reqJson.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const echo = lastUser ? String(lastUser.content).slice(0, 60) : '';
  let reply;
  if (isExtract) {
    reply = extraction(msgs);
    let n = 0; try { n = JSON.parse(reply).items.length; } catch { n = 'malformed'; }
    console.log(`[extract] mode=${extractMode} response_format=${reqJson.response_format ? 'yes' : 'no'} items=${n}`);
  } else reply = `[fake:${name}] ${CANNED[turn++ % CANNED.length]} (you said: "${echo}"; ${msgs.length} messages in context)`;
  const model = reqJson.model || name;
  const id = `chatcmpl-fake-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  if (!reqJson.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const words = isExtract ? reply.match(/[\s\S]{1,40}/g) || [] : reply.split(/(?<= )/);
  let i = 0;
  const chunk = (delta, finish) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason: finish || null }] })}\n\n`;
  res.write(chunk({ role: 'assistant' }));
  const t = setInterval(() => {
    if (stallAfter && i >= stallAfter) return;   // hang: no more tokens, no [DONE], socket stays open
    if (i < words.length) return res.write(chunk({ content: words[i++] }));
    clearInterval(t);
    res.write(chunk({}, 'stop'));
    res.end('data: [DONE]\n\n');
  }, 40);
  res.on('close', () => clearInterval(t));
}
