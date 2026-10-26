// Ported from pilot/app/secrets.js (looksLikeKey) and server.js (shortTitle); those are CommonJS with Node fs
// and cannot be imported into a Worker. Keep the two copies in step (test/unit/parity.test.js checks it).

export function looksLikeKey(text) {
  return /\b(?:sk-(?:proj-|ant-)?|mistral[-_])[A-Za-z0-9_-]{8,}/i.test(text) || /^[A-Za-z0-9_+=\/.\-]{32,}$/.test(text.trim());
}

export const shortTitle = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]; return s.length > 48 ? s.slice(0, 45) + '…' : s; };
