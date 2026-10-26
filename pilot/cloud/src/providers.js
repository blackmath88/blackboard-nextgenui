// Provider adapters: Claude (Anthropic Messages API) and Mistral (OpenAI-compatible chat completions).
// Keys come only from Worker secrets (env) and never leave this module: deltas and error messages are scrubbed,
// including a key prefix split across two deltas (ported from callCandidate in pilot/app/server.js).

export const PROVIDERS = {
  claude: {
    label: 'Claude', keyName: 'ANTHROPIC_API_KEY',
    config: (env) => ({ baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', key: env.ANTHROPIC_API_KEY }),
  },
  mistral: {
    label: 'Mistral', keyName: 'MISTRAL_API_KEY',
    config: (env) => ({ baseUrl: env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1', model: env.MISTRAL_MODEL || 'mistral-large-latest', key: env.MISTRAL_API_KEY }),
  },
};

// What the browser may know: names, models, and whether a key is configured. Never the key.
export function providerStatus(env) {
  return Object.entries(PROVIDERS).map(([id, p]) => { const c = p.config(env); return { id, label: p.label, model: c.model, configured: !!c.key }; });
}

export function configuredKeys(env) {
  return Object.values(PROVIDERS).map((p) => p.config(env).key).filter(Boolean);
}

// Wraps onDelta so no configured key (or a trailing prefix of one) is ever emitted.
export function scrubber(keys, onDelta) {
  keys = keys.filter((k) => k && k.length >= 8);
  let pending = '';
  const scrub = (t) => keys.reduce((s, k) => s.replaceAll(k, '[redacted]'), String(t));
  const emit = (delta, flush = false) => {
    pending = scrub(pending + delta);
    let keep = 0;
    for (const k of keys) for (let n = 1; n < k.length && n <= pending.length; n++) if (pending.endsWith(k.slice(0, n))) keep = Math.max(keep, n);
    const safe = pending.slice(0, pending.length - keep) + (flush && keep ? '[redacted]' : '');
    pending = flush ? '' : pending.slice(pending.length - keep);
    if (safe) onDelta(safe);
    return safe;
  };
  return { emit, scrub };
}

async function* sseData(body, signal) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    if (signal.aborted) throw signal.reason;
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const last = buf.trim();
  if (last.startsWith('data:')) yield last.slice(5).trim();
}

// Anthropic requires alternating roles starting with a user turn: merge runs, drop a leading assistant turn.
export function claudeMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!out.length && m.role !== 'user') continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += '\n\n' + m.content; else out.push({ role: m.role, content: m.content });
  }
  return out;
}

function request(id, c, messages, env) {
  if (id === 'claude') {
    return { url: c.baseUrl.replace(/\/$/, '') + '/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01' },
      body: { model: c.model, max_tokens: Number(env.ANTHROPIC_MAX_TOKENS) || 8192, stream: true, messages: claudeMessages(messages) } };
  }
  return { url: c.baseUrl.replace(/\/$/, '') + '/chat/completions',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}` },
    body: { model: c.model, stream: true, messages } };
}

// One SSE data payload -> { delta } | { done } | { error } | null
function parseEvent(id, data) {
  if (id === 'mistral') {
    if (data === '[DONE]') return { done: true };
    try { const j = JSON.parse(data); return { delta: j.choices?.[0]?.delta?.content || '' }; } catch { return null; }
  }
  let j; try { j = JSON.parse(data); } catch { return null; }
  if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') return { delta: j.delta.text || '' };
  if (j.type === 'message_stop') return { done: true };
  if (j.type === 'error') return { error: `provider error: ${String(j.error?.type || 'unknown').slice(0, 60)}` };
  return null;
}

// Streams one reply. Resolves { text, model, firstTokenMs }; rejects with err.partial (text already streamed).
// timeoutMs bounds the wait for the first token, stallMs each later gap.
export async function streamChat(id, env, messages, onDelta, { signal = new AbortController().signal, timeoutMs = 60000, stallMs = 30000 } = {}) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`unknown provider "${id}"`);
  const c = p.config(env);
  if (!c.key) throw new Error(`${p.label} is not configured on the server`);
  const { emit, scrub } = scrubber(configuredKeys(env), onDelta);
  const t0 = Date.now();
  let text = '', firstTokenMs = null;
  const timer = new AbortController();
  let handle = setTimeout(() => timer.abort(new Error(`no reply within ${timeoutMs} ms`)), timeoutMs);
  const tick = () => { if (firstTokenMs === null) firstTokenMs = Date.now() - t0; clearTimeout(handle); handle = setTimeout(() => timer.abort(new Error(`no new token for ${stallMs} ms`)), stallMs); };
  const both = AbortSignal.any([signal, timer.signal]);
  try {
    const r = request(id, c, messages, env);
    const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: both });
    if (!res.ok) {
      let type = '';
      try { const j = await res.json(); type = String(j?.error?.type || j?.type || '').slice(0, 60); } catch { /* body is not JSON */ }
      throw new Error(`HTTP ${res.status} from ${p.label}${type ? ` (${type})` : ''}`);
    }
    for await (const data of sseData(res.body, both)) {
      const ev = parseEvent(id, data);
      if (!ev) continue;
      if (ev.error) throw new Error(ev.error);
      if (ev.delta) { tick(); text += emit(ev.delta); }
      if (ev.done) break;
    }
    text += emit('', true);
    return { text, model: c.model, firstTokenMs };
  } catch (err) {
    text += emit('', true);
    const reason = both.aborted && both.reason instanceof Error ? both.reason : err;
    const e = new Error(scrub(String(reason?.message || reason)));
    e.partial = text; e.firstTokenMs = firstTokenMs;
    throw e;
  } finally { clearTimeout(handle); }
}
