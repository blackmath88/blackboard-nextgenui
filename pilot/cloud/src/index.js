// Pilot Cloud Worker: authenticates every request (including static assets), then serves the UI or forwards
// the API to the signed-in user's Durable Object. Provider keys live in Worker secrets only.
import { authenticate, checkWrite, AuthError } from './auth.js';
import { providerStatus } from './providers.js';
export { Workspace } from './workspace.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const MAX_BODY = 64 * 1024;
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function secure(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env) {
    return secure(await handle(request, env));
  },
};

async function handle(request, env) {
  let user;
  try { user = await authenticate(request, env); }
  catch (err) {
    if (!(err instanceof AuthError)) throw err;
    return json(err.status, { error: err.message });
  }
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method not allowed' });
    return env.ASSETS.fetch(request);
  }
  const refused = checkWrite(request);
  if (refused) return json(403, { error: refused });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json(413, { error: 'request too large' });

  if (url.pathname === '/api/me' && request.method === 'GET') {
    return json(200, { email: user.email, auth: user.mode, providers: providerStatus(env), context: 'conversation-only' });
  }
  if (url.pathname === '/api/conversations' || url.pathname.startsWith('/api/conversations/')) {
    const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName('user:' + user.email));
    const inner = new Request('https://workspace' + url.pathname.slice('/api'.length), {
      method: request.method, headers: { 'content-type': 'application/json' },
      body: request.method === 'POST' ? await limitedText(request) : undefined,
    });
    return stub.fetch(inner);
  }
  return json(404, { error: 'not found' });
}

// content-length can be absent (chunked); count what actually arrives.
async function limitedText(request) {
  const text = await request.text();
  return text.length > MAX_BODY ? '' : text;
}
