'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
function rawFile(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } }
function atomic(file, raw) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, raw); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    // Keep process-crash recovery portable; directory sync is unsupported on
    // some filesystems. Unexpected I/O errors still fail the transaction.
    try { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
    catch (e) { if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EPERM', 'EISDIR'].includes(e.code)) throw e; }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

// A short-lived redo journal bridges state.json, its provenance ledger, and the
// conversation note. It never replaces the hand-editable canonical state file.
// Replay is idempotent by transaction+event index and refuses an external edit
// that matches neither the before nor after image.
function stateStore(dir) {
  const state = path.join(dir, 'state.json'), journal = path.join(dir, 'state-transaction.json');
  function appendEvents(name, events, id) {
    if (!events.length) return;
    const file = path.join(dir, name), raw = rawFile(file);
    const seen = new Set();
    for (const line of raw.split('\n')) { try { const e = JSON.parse(line); if (e.transactionId === id) seen.add(e.transactionIndex); } catch {} }
    const missing = events.flatMap((e, index) => seen.has(index) ? [] : [{ ...e, transactionId: id, transactionIndex: index }]);
    if (missing.length) atomic(file, raw + (raw && !raw.endsWith('\n') ? '\n' : '') + missing.map(e => JSON.stringify(e) + '\n').join(''));
  }
  function recover() {
    const raw = rawFile(journal);
    if (!raw && !fs.existsSync(journal)) return false;
    let tx;
    try { tx = JSON.parse(raw); } catch { throw new Error('state transaction is unreadable; preserve state-transaction.json and repair it before writing'); }
    const records = list => Array.isArray(list) && list.every(e => e && typeof e === 'object' && !Array.isArray(e));
    let after;
    try { after = JSON.parse(tx?.after); } catch { /* rejected below before any write */ }
    if (tx?.version !== 1 || typeof tx.id !== 'string' || !tx.id || !/^[a-f0-9]{64}$/.test(tx.before) ||
        !after || !Number.isSafeInteger(after.rev) || after.rev < 0 || !Array.isArray(after.items) ||
        !records(tx.metrics) || !records(tx.transcript)) throw new Error('state transaction is invalid; preserve it before repair');
    const current = rawFile(state);
    if (hash(current) === tx.before) atomic(state, tx.after);
    else if (hash(current) !== hash(tx.after)) throw new Error('state.json changed during an interrupted write; preserve state-transaction.json and resolve the conflict before writing');
    appendEvents('metrics.jsonl', tx.metrics, tx.id);
    appendEvents('transcript.jsonl', tx.transcript, tx.id);
    fs.unlinkSync(journal);
    return true;
  }
  function commit({ expected, doc, metrics = [], transcript = [] }) {
    recover();
    if (hash(rawFile(state)) !== expected) {
      const err = new Error('state.json changed before the write; reload and review it again'); err.code = 'STATE_STALE'; throw err;
    }
    const tx = { version: 1, id: crypto.randomUUID(), before: expected, after: JSON.stringify(doc, null, 2) + '\n', metrics, transcript };
    atomic(journal, JSON.stringify(tx) + '\n');
    recover();
    return tx.id;
  }
  return { recover, commit, journal };
}
module.exports = { stateStore, hash, rawFile, atomic };
