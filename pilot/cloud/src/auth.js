// Server-side identity for every request (pages, assets, API, streams). Fails closed.
// Production: Cloudflare Access puts a signed JWT in Cf-Access-Jwt-Assertion; we verify signature, issuer,
// audience, expiry and an email allowlist here, so a misconfigured or bypassed Access policy still gets no data.
// Local development: DEV_AUTH_EMAIL (from .dev.vars, never deployed) is honored only on a loopback host.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const JWKS_TTL_MS = 10 * 60 * 1000;
const SKEW_S = 60;
let jwksCache = { url: null, at: 0, keys: [] };

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const emails = (list) => String(list || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const teamDomain = (d) => String(d || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function defaultFetchJwks(url) {
  if (jwksCache.url === url && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new AuthError(503, 'identity keys unavailable');
  const keys = (await res.json()).keys || [];
  jwksCache = { url, at: Date.now(), keys };
  return keys;
}

// Verifies an RS256 JWT against a JWKS. Returns the payload or throws AuthError(403).
export async function verifyJwt(token, { jwks, issuer, audience, now = Date.now() }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError(403, 'malformed identity token');
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { throw new AuthError(403, 'malformed identity token'); }
  if (header.alg !== 'RS256') throw new AuthError(403, 'unsupported token algorithm');
  const jwk = jwks.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw new AuthError(403, 'unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new AuthError(403, 'invalid token signature');
  const t = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_S < t) throw new AuthError(403, 'token expired');
  if (typeof payload.nbf === 'number' && payload.nbf - SKEW_S > t) throw new AuthError(403, 'token not yet valid');
  if (payload.iss !== issuer) throw new AuthError(403, 'wrong token issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) throw new AuthError(403, 'wrong token audience');
  return payload;
}

// -> { email, mode }. Throws AuthError (401 no credentials, 403 rejected, 500 misconfigured).
export async function authenticate(request, env, { fetchJwks = defaultFetchJwks, now } = {}) {
  const url = new URL(request.url);
  if (env.DEV_AUTH_EMAIL) {
    if (!LOCAL_HOSTS.has(url.hostname)) throw new AuthError(500, 'development login is configured on a non-local host');
    return { email: String(env.DEV_AUTH_EMAIL).trim().toLowerCase(), mode: 'dev' };
  }
  const team = teamDomain(env.ACCESS_TEAM_DOMAIN), audience = String(env.ACCESS_AUD || '').trim(), allowed = emails(env.ALLOWED_EMAILS);
  if (!team || !audience || !allowed.length) throw new AuthError(500, 'authentication is not configured');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new AuthError(401, 'sign-in required');
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new AuthError(403, 'malformed identity token');
  const payload = await verifyJwt(token, { jwks: await fetchJwks(`https://${team}/cdn-cgi/access/certs`), issuer: `https://${team}`, audience, now });
  const email = String(payload.email || '').toLowerCase();
  if (!email || !allowed.includes(email)) throw new AuthError(403, 'this account is not allowed');
  return { email, mode: 'access' };
}

// Cookie-authenticated writes need a same-origin check (CSRF); JSON content type keeps simple forms out.
export function checkWrite(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return 'cross-origin request refused';
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return 'expected application/json';
  return null;
}
