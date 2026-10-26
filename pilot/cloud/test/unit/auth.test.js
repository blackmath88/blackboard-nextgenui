import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, verifyJwt, checkWrite, AuthError } from '../../src/auth.js';

const TEAM = 'team.cloudflareaccess.com', AUD = 'aud-123', ISS = `https://${TEAM}`;
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: 'Me@Example.com' };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const pair = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const keys = await pair(), other = await pair();
const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
const jwks = async () => [jwk];
const now = Date.now(), t = Math.floor(now / 1000);

async function sign(payload, { key = keys.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const head = b64u(JSON.stringify({ alg, kid, typ: 'JWT' })), body = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
  return `${head}.${body}.${b64u(sig)}`;
}
const good = { iss: ISS, aud: [AUD], email: 'me@example.com', exp: t + 600, iat: t };
const req = (token, url = 'https://pilot.example.com/api/me') => new Request(url, { headers: token ? { 'cf-access-jwt-assertion': token } : {} });
async function status(p) { try { await p; return 200; } catch (e) { assert.ok(e instanceof AuthError, e); return e.status; } }

test('valid Access token for an allowed email is accepted', async () => {
  const u = await authenticate(req(await sign(good)), env, { fetchJwks: jwks, now });
  assert.deepEqual(u, { email: 'me@example.com', mode: 'access' });
});

test('missing token is 401, every bad token is 403', async () => {
  assert.equal(await status(authenticate(req(null), env, { fetchJwks: jwks, now })), 401);
  const bad = {
    garbage: 'not-a-jwt',
    otherKey: await sign(good, { key: other.privateKey }),
    unknownKid: await sign(good, { kid: 'k2' }),
    hs256: await sign(good, { alg: 'HS256' }),
    expired: await sign({ ...good, exp: t - 3600 }),
    notYet: await sign({ ...good, nbf: t + 3600 }),
    wrongIss: await sign({ ...good, iss: 'https://evil.cloudflareaccess.com' }),
    wrongAud: await sign({ ...good, aud: ['other'] }),
    notAllowed: await sign({ ...good, email: 'someone@else.com' }),
    noEmail: await sign({ ...good, email: undefined }),
  };
  const [h, p] = (await sign(good)).split('.');
  bad.tampered = `${h}.${b64u(JSON.stringify({ ...good, email: 'me@example.com', exp: t + 99999 }))}.${(await sign(good)).split('.')[2]}`;
  for (const [name, tok] of Object.entries(bad)) assert.equal(await status(authenticate(req(tok), env, { fetchJwks: jwks, now })), 403, name);
  assert.ok(p);
});

test('fails closed when Access is not configured', async () => {
  for (const missing of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ALLOWED_EMAILS']) {
    assert.equal(await status(authenticate(req(await sign(good)), { ...env, [missing]: '' }, { fetchJwks: jwks, now })), 500, missing);
  }
});

test('dev login works only on loopback hosts', async () => {
  const dev = { DEV_AUTH_EMAIL: 'dev@example.com' };
  for (const u of ['http://localhost:8787/', 'http://127.0.0.1:8787/api/me', 'http://[::1]:8787/']) {
    assert.equal((await authenticate(req(null, u), dev)).mode, 'dev', u);
  }
  assert.equal(await status(authenticate(req(null, 'https://pilot.example.com/'), dev)), 500);
  assert.equal(await status(authenticate(req(null, 'https://localhost.evil.com/'), dev)), 500);
});

test('verifyJwt checks audience strings as well as arrays', async () => {
  const p = await verifyJwt(await sign({ ...good, aud: AUD }), { jwks: [jwk], issuer: ISS, audience: AUD, now });
  assert.equal(p.email, 'me@example.com');
});

test('writes need same origin and JSON', () => {
  const r = (h, m = 'POST') => new Request('https://pilot.example.com/api/conversations', { method: m, headers: h });
  assert.equal(checkWrite(r({}, 'GET')), null);
  assert.equal(checkWrite(r({ origin: 'https://pilot.example.com', 'content-type': 'application/json' })), null);
  assert.match(checkWrite(r({ 'content-type': 'application/json' })), /cross-origin/);
  assert.match(checkWrite(r({ origin: 'https://evil.com', 'content-type': 'application/json' })), /cross-origin/);
  assert.match(checkWrite(r({ origin: 'https://pilot.example.com', 'content-type': 'text/plain' })), /json/);
});
