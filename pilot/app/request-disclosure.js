'use strict';
const crypto = require('crypto');

// In-memory inspection only: do not create a second on-disk copy of private
// conversation content. Keep at most 30 role/chat/provider receipts, each bounded to
// 100k characters, and label truncation. Authorization headers never enter it.
function requestDisclosures() {
  const recent = new Map();
  function begin(role, chat, candidate, body) {
    const raw = JSON.stringify(body), pretty = JSON.stringify(body, null, 2);
    let endpoint = '(invalid endpoint)';
    try { endpoint = new URL(candidate.baseUrl).origin; } catch { /* no credentials/query in the display */ }
    const receipt = { at: new Date().toISOString(), role, chat, candidate: candidate.name, model: candidate.model,
      location: candidate.local === true ? 'local' : 'cloud', endpoint, status: 'attempting',
      hash: crypto.createHash('sha256').update(raw).digest('hex'),
      payload: pretty.slice(0, 100000), chars: pretty.length, truncated: pretty.length > 100000 };
    const key = JSON.stringify([role, chat, candidate.name, candidate.model, endpoint]); recent.delete(key); recent.set(key, receipt);
    while (recent.size > 30) recent.delete(recent.keys().next().value);
    return receipt;
  }
  const attempts = (role, chat) => [...recent.values()].filter(r => r.role === role && r.chat === chat).reverse();
  return { begin, attempts, latest: (role, chat) => attempts(role, chat)[0] || null };
}
module.exports = { requestDisclosures };
