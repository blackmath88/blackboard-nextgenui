'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

// A local workspace has one writer. Unknown owners fail closed; a dead local
// process can be recovered after SIGKILL without relying on a timeout/heartbeat.
function acquireWorkspace(dir, name = '.server-lock') {
  if (!name || ['.', '..'].includes(name) || path.basename(name) !== name) throw new Error('workspace lock name must be a filename');
  const file = path.join(dir, name);
  const owner = { pid: process.pid, host: os.hostname(), token: crypto.randomUUID(), startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let raw, previous;
      try {
        if (!fs.lstatSync(file).isFile()) throw new Error();
        raw = fs.readFileSync(file, 'utf8'); previous = JSON.parse(raw);
        if (!Number.isInteger(previous.pid) || previous.pid <= 0 || previous.host !== owner.host || typeof previous.token !== 'string') throw new Error();
      } catch { throw new Error(`workspace lock owner is unknown; inspect ${file} before restarting`); }
      let alive = true;
      try { process.kill(previous.pid, 0); } catch (err) { if (err.code === 'ESRCH') alive = false; }
      if (alive) throw new Error(`workspace already has a live writer (pid ${previous.pid}); stop it before starting another server`);
      if (attempt) throw new Error('workspace lock changed during recovery; retry startup');
      const guard = file + '.recovery';
      try { fs.mkdirSync(guard, { mode: 0o700 }); }
      catch { throw new Error(`another startup may be recovering the workspace lock; inspect ${guard} before retrying`); }
      try {
        if (fs.readFileSync(file, 'utf8') !== raw) throw new Error('workspace lock changed during recovery; retry startup');
        fs.unlinkSync(file);
      } finally { fs.rmdirSync(guard); }
    }
  }
  return () => {
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === owner.token) fs.unlinkSync(file); }
    catch (e) { if (e.code !== 'ENOENT') console.error('workspace lock cleanup:', e.message); }
  };
}
module.exports = { acquireWorkspace };
