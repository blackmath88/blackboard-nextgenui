#!/usr/bin/env node
// CLI Pilot v1, step P0: serves the page, proxies POST /chat to the `chat` role
// with streaming, appends user and assistant lines to .pilot/transcript.jsonl.
// Node 20+, no dependencies. All paths resolve against this file's folder.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP = __dirname;
const PUBLIC = path.join(APP, 'public');
const configPath = path.resolve(APP, process.env.PILOT_CONFIG || 'pilot.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PILOT = path.resolve(APP, config.pilotDir || '.pilot');
const TRANSCRIPT = path.join(PILOT, 'transcript.jsonl');
const PORT = Number(config.port) || 4747;
const HOST = '127.0.0.1';
const TAIL = 500;      // lines returned by GET /state
const HISTORY = 40;    // user/assistant lines sent to the model

if (path.relative(APP, PILOT).startsWith('..')) throw new Error(`pilotDir must stay inside ${APP}`);
fs.mkdirSync(PILOT, { recursive: true });

// ---- .pilot/ files: atomic writes (temp file in .pilot/, then rename), serialized ----
let writeChain = Promise.resolve();
function serial(fn) { const p = writeChain.then(fn); writeChain = p.catch(() => {}); return p; }

function atomicWrite(file, data) {
  const tmp = path.join(PILOT, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readTranscript() {
  let raw = '';
  try { raw = fs.readFileSync(TRANSCRIPT, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const lines = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { lines.push(JSON.parse(l)); } catch { /* skip a broken hand-edited line */ }
  }
  return lines;
}

function appendLine(role, text, model) {
  return serial(() => {
    const line = { id: 'm-' + crypto.randomUUID().slice(0, 8), ts: new Date().toISOString(), role, text, model: model || null };
    let raw = '';
    try { raw = fs.readFileSync(TRANSCRIPT, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (raw && !raw.endsWith('\n')) raw += '\n';
    atomicWrite(TRANSCRIPT, raw + JSON.stringify(line) + '\n');
    return line;
  });
}

// ---- model role `chat` (P0: first candidate only; policies come in P1) ----
function chatCandidate() {
  const c = config.roles && config.roles.chat && config.roles.chat.candidates && config.roles.chat.candidates[0];
  if (!c) throw new Error('no candidate configured for role "chat"');
  return c;
}

// Streams the reply; calls onDelta(text) per chunk; resolves with the full text.
async function callChat(candidate, messages, onDelta, signal) {
  const headers = { 'content-type': 'application/json' };
  if (candidate.keyEnv) {
    const key = process.env[candidate.keyEnv];
    if (!key) throw new Error(`environment variable ${candidate.keyEnv} is not set for candidate "${candidate.name}"`);
    headers.authorization = `Bearer ${key}`;
  }
  const timeout = AbortSignal.timeout(candidate.timeoutMs || 60000);
  const res = await fetch(candidate.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers,
    body: JSON.stringify({ model: candidate.model, messages, stream: true }),
    signal: AbortSignal.any([timeout, signal]),
  });
  if (!res.ok) throw new Error(`${candidate.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

  let full = '';
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/event-stream')) {           // endpoint ignored stream:true
    const body = await res.json();
    full = (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
    if (full) onDelta(full);
    return full;
  }
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      let delta = '';
      try { const j = JSON.parse(data); delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''; } catch { continue; }
      if (delta) { full += delta; onDelta(delta); }
    }
  }
  return full;
}

// ---- HTTP ----
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (path.relative(PUBLIC, file).startsWith('..') || path.isAbsolute(path.relative(PUBLIC, file))) return sendJson(res, 404, { error: 'not found' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

async function handleChat(req, res) {
  let text;
  try { text = String(JSON.parse(await readBody(req)).text || '').trim(); } catch { return sendJson(res, 400, { error: 'expected JSON {text}' }); }
  if (!text) return sendJson(res, 400, { error: 'empty message' });

  await appendLine('user', text, null);
  const history = readTranscript().filter((l) => l.role === 'user' || l.role === 'assistant').slice(-HISTORY)
    .map((l) => ({ role: l.role, content: l.text }));

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });

  let candidate, streamed = '';
  try {
    candidate = chatCandidate();
    const full = await callChat(candidate, history, (d) => { streamed += d; res.write(d); }, abort.signal);
    await appendLine('assistant', full, candidate.name);
  } catch (err) {
    // Keep whatever arrived before the failure, then record the failure as a system line.
    if (streamed) await appendLine('assistant', streamed, candidate && candidate.name);
    const msg = `chat failed: ${err.message || err}`;
    await appendLine('system', msg, null);
    console.error(msg);
    if (!res.writableEnded) res.write(`\n[${msg}]`);
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && pathname === '/state') {
      const lines = readTranscript();
      return sendJson(res, 200, { transcript: lines.slice(-TAIL), total: lines.length });
    }
    if (req.method === 'POST' && pathname === '/chat') return await handleChat(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CLI Pilot P0 on http://${HOST}:${PORT}  (config: ${path.relative(APP, configPath)}, data: ${path.relative(APP, PILOT)}/)`);
});
