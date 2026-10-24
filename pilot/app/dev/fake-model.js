#!/usr/bin/env node
// DEV ONLY. Not used by the normal start path (`node server.js`).
// A tiny fake OpenAI-compatible endpoint: POST /v1/chat/completions,
// streaming (SSE) and non-streaming, canned replies, no dependencies.
// Usage: node dev/fake-model.js <port> [name] [--delay=<ms>] [--status=<code>] [--stall-after=<n>]
//        [--extract=good|malformed|badquote|many|dupes] [--extract-delay=<ms>] [--frame=good|bad|...]
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
//   --frame=<mode>   how to answer a frame request (pilot-v0.10): one whose system message contains "PILOT-FRAME"
//                    (checked before the extraction test, since both carry response_format). Default good. The panes
//                    and their cards are read from the server's prompt ("Panes shown:"). The first pane with cards is
//                    framed; each card scores the words it shares with the last user message.
//                    good      {pane, focus: the best-scoring card, order: focus, then by score, then newest first}
//                    group     good plus "group": "status"
//                    none      {} (no suggestion)
//                    bad       {"pane", "focus": "<prefix>-99", "hide": [<first card>]}: an unknown id AND a key the
//                              schema does not have (the server must reject it whole)
//                    badid     good, but focus is "<prefix>-99" (unknown id)
//                    badkey    good plus "status": {<focus>: "confirmed"} (a key the schema does not have)
//                    wrongpane good, but pane "index" (not in the closed vocabulary)
//                    malformed truncated JSON
// Extraction and frame requests never advance the canned chat replies; each prints one "[extract] ..." or
// "[frame] ..." log line.
// Every chat reply starts with "[fake:<name>]" so you can tell instances apart.
'use strict';
const http = require('http');
const fs = require('fs');

const port = Number(process.argv[2]);
const name = (process.argv[3] && !process.argv[3].startsWith('--')) ? process.argv[3] : `fake-${port}`;
const opt = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : 0; };
const delay = opt('delay');
const failStatus = opt('status');
const stallAfter = opt('stall-after');
const extractMode = ((process.argv.find((x) => x.startsWith('--extract=')) || '--extract=good').split('=')[1]);
const extractDelay = opt('extract-delay');
if (!['good', 'malformed', 'badquote', 'many', 'dupes'].includes(extractMode)) { console.error(`unknown --extract mode "${extractMode}"`); process.exit(1); }
const frameMode = ((process.argv.find((x) => x.startsWith('--frame=')) || '--frame=good').split('=')[1]);
if (!['good', 'group', 'none', 'bad', 'badid', 'badkey', 'wrongpane', 'malformed'].includes(frameMode)) { console.error(`unknown --frame mode "${frameMode}"`); process.exit(1); }
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

// ---- fake frame role (pilot-v0.10; deterministic, derived from the panes and the last user message in the prompt) ----
const STOP = new Set('a an the to of and or we i you it is are be will for on in at this that with as by our so what about how do does'.split(' '));
const wordsOf = (t) => new Set(String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)));
function framing(msgs) {
  const u = msgs.filter((m) => m.role === 'user').pop();
  const c = String(u ? u.content : '');
  const sec = (h, next) => { const i = c.indexOf(h); if (i < 0) return ''; const from = i + h.length; const j = next ? c.indexOf(next, from) : -1; return c.slice(from, j < 0 ? undefined : j); };
  const panes = sec('Panes shown:\n', '\n\nFrames now:\n').split('\n\n').map((block) => {
    const [head, ...rest] = block.split('\n');
    return { pane: head.replace(/:$/, ''), cards: rest.map((l) => /^- (\S+) \(([^)]*)\): (.*)$/.exec(l)).filter(Boolean).map((m) => ({ id: m[1], text: m[3] })) };
  }).filter((p) => p.pane);
  const said = wordsOf(sec('Last user message:\n', '\n\nLast assistant message:\n'));
  return { panes, said };
}
function frameReply(msgs) {
  if (frameMode === 'malformed') return '{"pane": "map", "focus';
  if (frameMode === 'none') return '{}';
  const { panes, said } = framing(msgs);
  const p = panes.find((x) => x.cards.length);
  if (!p) return '{}';
  const score = (card) => [...wordsOf(card.text)].filter((w) => said.has(w)).length;
  const ranked = p.cards.map((card, i) => ({ id: card.id, s: score(card), i })).sort((a, b) => b.s - a.s || a.i - b.i);
  const focus = ranked[0].id;
  const order = [focus, ...ranked.slice(1).sort((a, b) => b.s - a.s || b.i - a.i).map((r) => r.id)];
  const unknown = `${focus.split('-')[0]}-99`;
  const out = { pane: p.pane, focus, order };
  if (frameMode === 'group') out.group = 'status';
  if (frameMode === 'badid') out.focus = unknown;
  if (frameMode === 'badkey') out.status = { [focus]: 'confirmed' };
  if (frameMode === 'wrongpane') out.pane = 'index';
  if (frameMode === 'bad') return JSON.stringify({ pane: p.pane, focus: unknown, hide: [p.cards[0].id] });
  return JSON.stringify(out);
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'not found' } }));
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (process.env.PILOT_FAKE_CAPTURE) fs.appendFileSync(process.env.PILOT_FAKE_CAPTURE, JSON.stringify({ headers: req.headers, body: JSON.parse(body || '{}') }) + '\n', { mode: 0o600 });
    let peek = {};
    try { peek = JSON.parse(body); } catch { /* ignore */ }
    const sys = (tag) => Array.isArray(peek.messages) && peek.messages.some((m) => m.role === 'system' && String(m.content).includes(tag));
    const isFrame = sys('PILOT-FRAME');   // pilot-v0.10: before the extraction test (both carry response_format)
    const isExtract = !isFrame && (!!peek.response_format || sys('PILOT-EXTRACT'));
    setTimeout(() => respond(req, res, body, isExtract, isFrame), delay + (isExtract ? extractDelay : 0));
  });
}).listen(port, '127.0.0.1', () => console.log(`[dev] fake model "${name}" on http://127.0.0.1:${port}/v1${delay ? ` (delay ${delay} ms)` : ''}${failStatus ? ` (always HTTP ${failStatus})` : ''}${stallAfter ? ` (stalls after ${stallAfter} tokens)` : ''} (extract: ${extractMode}${extractDelay ? `, +${extractDelay} ms` : ''}; frame: ${frameMode})`));

function respond(req, res, body, isExtract, isFrame) {
  const reflect = process.argv.find(a => a.startsWith('--reflect-key='))?.split('=')[1];
  if (reflect) {
    const key = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (reflect === 'error') { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('upstream echoed ' + key); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const parts = ['reflected ', key.slice(0, 7), key.slice(7, 18), key.slice(18), ' end'];
    for (const part of parts) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: part } }] }) + '\n\n');
    return res.end('data: [DONE]\n\n');
  }
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
  if (isFrame) {
    reply = frameReply(msgs);
    console.log(`[frame] mode=${frameMode} response_format=${reqJson.response_format ? 'yes' : 'no'} reply=${reply}`);
  } else if (isExtract) {
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
  const words = isExtract || isFrame ? reply.match(/[\s\S]{1,40}/g) || [] : reply.split(/(?<= )/);
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
