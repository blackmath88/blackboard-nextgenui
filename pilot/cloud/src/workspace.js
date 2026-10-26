// One SQLite-backed Durable Object per signed-in user: owns that user's conversations and messages and
// serializes their writes. The model sees only the current conversation (conversation-only context, as in
// local Pilot's default); nothing else from the workspace is ever added to a prompt.
import { DurableObject } from 'cloudflare:workers';
import { streamChat, PROVIDERS, providerStatus, configuredKeys } from './providers.js';
import { looksLikeKey, shortTitle } from './guard.js';

export const SCHEMA_VERSION = 1;
const HISTORY = 40;            // user/assistant messages sent to the model (same as local Pilot)
const MAX_TEXT = 20000;
const MAX_CONVERSATIONS = 500;
const KEY_HINT = 'That looks like an API key. Keys are configured on the server only and are never sent in chat.';

const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const newId = (p) => p + '-' + crypto.randomUUID().slice(0, 12);

export class Workspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.busy = new Set();     // conversations with a reply in flight
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    const row = this.sql.exec("SELECT v FROM meta WHERE k = 'schema_version'").toArray()[0];
    const v = row ? Number(row.v) : 0;
    if (v > SCHEMA_VERSION) throw new Error(`stored schema ${v} is newer than this build (${SCHEMA_VERSION})`);
    if (v < 1) {
      this.sql.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      this.sql.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), seq INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')), text TEXT NOT NULL, provider TEXT, model TEXT,
        status TEXT NOT NULL DEFAULT 'complete', created_at INTEGER NOT NULL, UNIQUE (conversation_id, seq))`);
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema_version', '1')");
    }
  }

  listConversations() {
    return this.sql.exec(`SELECT c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.role != 'system') AS messages
      FROM conversations c ORDER BY c.updated_at DESC`).toArray();
  }
  conversation(id) { return this.sql.exec('SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE id = ?', id).toArray()[0] || null; }
  messages(id) { return this.sql.exec('SELECT id, seq, role, text, provider, model, status, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY seq', id).toArray(); }

  createConversation(title) {
    const count = this.sql.exec('SELECT COUNT(*) AS n FROM conversations').one().n;
    if (count >= MAX_CONVERSATIONS) return null;
    const now = Date.now(), id = newId('c');
    this.sql.exec('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', id, shortTitle(title || ''), now, now);
    return this.conversation(id);
  }

  append(conversationId, role, text, { provider = null, model = null, status = 'complete' } = {}) {
    const now = Date.now(), id = newId('m');
    const seq = this.sql.exec('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM messages WHERE conversation_id = ?', conversationId).one().s;
    this.sql.exec('INSERT INTO messages (id, conversation_id, seq, role, text, provider, model, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, conversationId, seq, role, text, provider, model, status, now);
    this.sql.exec('UPDATE conversations SET updated_at = ? WHERE id = ?', now, conversationId);
    return id;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);   // ['conversations', id?, 'messages'?]
    if (parts[0] !== 'conversations') return json(404, { error: 'not found' });
    if (parts.length === 1 && request.method === 'GET') return json(200, { conversations: this.listConversations() });
    if (parts.length === 1 && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const title = typeof body?.title === 'string' ? body.title : '';
      if (this.keyLike(title)) return json(400, { error: KEY_HINT });
      const c = this.createConversation(title);
      return c ? json(201, { conversation: c }) : json(409, { error: `conversation limit (${MAX_CONVERSATIONS}) reached` });
    }
    const c = parts[1] ? this.conversation(parts[1]) : null;
    if (!c) return json(404, { error: 'no such conversation' });
    if (parts.length === 2 && request.method === 'GET') return json(200, { conversation: c, messages: this.messages(c.id), streaming: this.busy.has(c.id) });
    if (parts.length === 3 && parts[2] === 'messages' && request.method === 'POST') return this.chat(c, await request.json().catch(() => null));
    return json(405, { error: 'method not allowed' });
  }

  // Every user-supplied string that is stored or sent: refuse key-looking text and any configured key, also inside text.
  keyLike(text) { return !!text && (looksLikeKey(text) || configuredKeys(this.env).some((k) => text.includes(k))); }

  chat(c, body) {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const provider = typeof body?.provider === 'string' ? body.provider : '';
    if (!text) return json(400, { error: 'empty message' });
    if (text.length > MAX_TEXT) return json(400, { error: `message longer than ${MAX_TEXT} characters` });
    if (this.keyLike(text)) return json(400, { error: KEY_HINT });
    if (!PROVIDERS[provider]) return json(400, { error: 'unknown provider' });
    if (!providerStatus(this.env).find((p) => p.id === provider).configured) return json(409, { error: `${PROVIDERS[provider].label} is not configured on the server` });
    if (this.busy.has(c.id)) return json(409, { error: 'a reply is still streaming in this conversation' });

    this.busy.add(c.id);
    this.append(c.id, 'user', text);
    if (!c.title) this.sql.exec('UPDATE conversations SET title = ? WHERE id = ?', shortTitle(text), c.id);
    const history = this.sql.exec(`SELECT role, text FROM (SELECT role, text, seq FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant')
      ORDER BY seq DESC LIMIT ?) ORDER BY seq`, c.id, HISTORY).toArray().map((m) => ({ role: m.role, content: m.text }));

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter(), enc = new TextEncoder();
    let clientGone = false;
    const send = (s) => { if (!clientGone) writer.write(enc.encode(s)).catch(() => { clientGone = true; }); };
    const t0 = Date.now();
    // Not awaited: the reply is stored even if the browser goes away mid-stream.
    (async () => {
      try {
        const { text: reply, model, firstTokenMs } = await streamChat(provider, this.env, history, send);
        this.append(c.id, 'assistant', reply, { provider, model });
        log({ event: 'model_call', provider, model, ok: true, latencyMs: Date.now() - t0, firstTokenMs, chars: reply.length, context: 'conversation' });
      } catch (err) {
        const model = PROVIDERS[provider].config(this.env).model;
        if (err.partial) this.append(c.id, 'assistant', err.partial, { provider, model, status: 'partial' });
        const msg = `chat failed: ${err.message}`;
        this.append(c.id, 'system', msg, { status: 'error' });
        log({ event: 'model_call', provider, model, ok: false, latencyMs: Date.now() - t0, firstTokenMs: err.firstTokenMs ?? null, error: category(err.message), context: 'conversation' });
        send(`\n[${msg}]`);
      } finally {
        this.busy.delete(c.id);
        writer.close().catch(() => {});
      }
    })();
    // identity + no-transform: a compressed body is buffered (workerd locally, the edge in production) and stops streaming.
    return new Response(readable, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-encoding': 'identity', 'cache-control': 'no-cache, no-transform', 'x-content-type-options': 'nosniff' } });
  }
}

// Metadata-only telemetry: never prompts, replies or keys.
function log(fields) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields })); }
function category(msg) {
  if (/HTTP 401|HTTP 403/.test(msg)) return 'auth';
  if (/HTTP 429/.test(msg)) return 'rate_limit';
  if (/HTTP 5\d\d/.test(msg)) return 'provider_5xx';
  if (/HTTP \d+/.test(msg)) return 'provider_4xx';
  if (/no reply within|no new token/.test(msg)) return 'timeout';
  return 'other';
}
