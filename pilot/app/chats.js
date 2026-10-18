// CLI Pilot (pilot-v0.12): several chats in one project (one pilot dir). Pure readers over a pilot dir, shared by
// server.js, why.js and stats.js; every function takes the dir, so nothing assumes a single pilot dir (projects, v0.13).
// - The first chat is "main": transcript.jsonl, exactly as before. It is never moved, rewritten or migrated.
// - Further chats live in chats/<id>.jsonl. chats.json {rev, chats: [{id, title?, titleBy?, titleModel?, titledAt?,
//   file, createdAt, archived?}]} lists them. It is created on the first "new chat"; a dir without it has one chat (main)
//   and behaves exactly as before pilot-v0.12.
// - Nothing is ever deleted: archived: true only hides a chat from the list (/chat unarchive brings it back).
// - Ids and files: "main" is transcript.jsonl; any other id must match ID_RE and its file is chats/<id>.jsonl. An entry
//   whose file says anything else is ignored (a hand edit can never make the server read or write outside the dir).
// Node 20+, no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');

const MAIN = 'main';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const fileFor = (id) => (id === MAIN ? 'transcript.jsonl' : `chats/${id}.jsonl`);
const isChatFile = (name) => name === 'transcript.jsonl' || /^chats\/[a-z0-9][a-z0-9-]{0,47}\.jsonl$/.test(name);
const idOfFile = (name) => (name === 'transcript.jsonl' ? MAIN : /^chats\/(.+)\.jsonl$/.exec(name)[1]);

// JSONL -> [{n, obj}] (n = physical line number, 1-based; blank and broken lines are skipped but keep their numbers)
function readRows(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const rows = [];
  raw.split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    try { rows.push({ n: i + 1, obj: JSON.parse(l) }); } catch { /* a broken hand-edited line is skipped */ }
  });
  return rows;
}
const readLines = (file) => readRows(file).map((r) => r.obj);

// chats.json as parsed -> {exists, doc, error}. doc null when missing or broken.
function readDoc(dir) {
  const file = path.join(dir, 'chats.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { exists: false, doc: null } : { exists: true, doc: null, error: `chats.json: ${e.message}` }; }
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.chats)) return { exists: true, doc: null, error: 'chats.json: expected {"rev": n, "chats": [...]}' };
    return { exists: true, doc };
  } catch (e) { return { exists: true, doc: null, error: `chats.json is not valid JSON: ${e.message}` }; }
}

// The chat list from a parsed doc (or null = no chats.json): main first (added when the file does not list it), then
// the valid entries in file order. Each {id, file, title, titleBy, titleModel, titledAt, createdAt, archived, listed}.
function normalize(doc) {
  const out = [];
  const seen = new Set();
  for (const c of (doc && Array.isArray(doc.chats) ? doc.chats : [])) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || seen.has(c.id)) continue;
    if (c.id !== MAIN && !ID_RE.test(c.id)) continue;
    if (c.file !== undefined && c.file !== fileFor(c.id)) continue;   // never a path the id does not give
    seen.add(c.id);
    out.push({ id: c.id, file: fileFor(c.id), title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : null,
      titleBy: typeof c.titleBy === 'string' ? c.titleBy : null, titleModel: typeof c.titleModel === 'string' ? c.titleModel : null,
      titledAt: typeof c.titledAt === 'string' ? c.titledAt : null, createdAt: typeof c.createdAt === 'string' ? c.createdAt : null,
      archived: c.archived === true, listed: true });
  }
  if (!seen.has(MAIN)) out.unshift({ id: MAIN, file: fileFor(MAIN), title: null, titleBy: null, titleModel: null, titledAt: null, createdAt: null, archived: false, listed: false });
  else out.sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : 0));
  return out;
}

// The first sentence of the first user message (the index pane's rule since P2), at most 80 characters.
function firstSentence(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const s = t.split(/(?<=[.!?])\s/)[0];
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

// Lines of every listed chat (archived ones too: archiving hides a chat, it does not take its messages out of the
// project), each row {chat, file, n, obj}. Order: chat by chat, file order inside a chat.
function allRows(dir, list) {
  const out = [];
  for (const c of list) for (const r of readRows(path.join(dir, c.file))) out.push({ chat: c.id, file: c.file, n: r.n, obj: r.obj });
  return out;
}

// Per chat: messages, last activity (the last line's ts, else createdAt), the derived title. -> list with these added.
function withActivity(dir, list) {
  return list.map((c) => {
    const lines = readLines(path.join(dir, c.file));
    const msgs = lines.filter((l) => l && (l.role === 'user' || l.role === 'assistant'));
    const firstUser = lines.find((l) => l && l.role === 'user' && typeof l.text === 'string');
    const last = lines.length ? lines[lines.length - 1].ts : null;
    const derived = firstUser ? firstSentence(firstUser.text) : null;
    return { ...c, lines: lines.length, messages: msgs.length, lastActivity: last || c.createdAt || null, derivedTitle: derived };
  });
}

// Who named a chat, from its entry and the server's ledger (chat_new / chat_rename events in metrics.jsonl carry the
// title the server wrote). A title that differs from the server's last write was written by hand: "you (file edit)".
// -> {title, by: "you" | "you (file edit)" | "model" | "first message" | null, model}
function titleOf(chat, events) {
  const led = (events || []).filter((e) => e && (e.event === 'chat_rename' || e.event === 'chat_new') && e.chat === chat.id && typeof e.title === 'string');
  const last = led.length ? led[led.length - 1] : null;
  if (chat.title) {
    if (!last || last.title !== chat.title) return { title: chat.title, by: 'you (file edit)', model: null };
    if (last.by === 'model') return { title: chat.title, by: 'model', model: last.model || chat.titleModel || null };
    return { title: chat.title, by: 'you', model: null };
  }
  if (chat.derivedTitle) return { title: chat.derivedTitle, by: 'first message', model: null };
  return { title: chat.id === MAIN ? 'main' : 'new chat', by: null, model: null };
}

module.exports = { MAIN, ID_RE, fileFor, isChatFile, idOfFile, readRows, readLines, readDoc, normalize, firstSentence, allRows, withActivity, titleOf };
