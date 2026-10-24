// Read-only, bounded project file view. Dot entries, dependencies and symlinks are excluded.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const LIMIT = 200 * 1024;
module.exports = function projectFiles(root) {
  const secret = path.resolve(Object.hasOwn(process.env, 'PILOT_SECRETS_FILE') ? process.env.PILOT_SECRETS_FILE : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'pilot', 'secrets.json'));
  // Resolve the selected store on every operation: Settings replaces it atomically.
  // A genuinely absent store has no identity; an existing but unresolvable store fails closed.
  function secretIdentity() {
    try { fs.lstatSync(secret); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const canonical = fs.realpathSync(secret);
    let fd;
    try {
      fd = fs.openSync(canonical, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const st = fs.fstatSync(fd, { bigint: true });
      if (!st.isFile()) throw new Error('secret store identity unavailable');
      return { canonical, dev: st.dev, ino: st.ino };
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  const excluded = (file, st, identity) => file === secret || identity &&
    (file === identity.canonical || st.dev === identity.dev && st.ino === identity.ino);
  function safe(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative)) throw new Error('file not available');
    const parts = relative.split('/');
    if (parts.some(p => !p || p.startsWith('.') || p === 'node_modules')) throw new Error('file not available');
    let file = root;
    for (const part of parts) { file = path.join(file, part); if (fs.lstatSync(file).isSymbolicLink()) throw new Error('file not available'); }
    if (file === secret || !fs.statSync(file).isFile()) throw new Error('file not available');
    return file;
  }
  function list() {
    const identity = secretIdentity();
    const files = []; let visited = 0;
    function walk(dir, prefix, depth) {
      if (depth > 3 || files.length >= 200 || visited >= 1000) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
        if (++visited > 1000 || files.length >= 200) break;
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name, file = path.join(root, relative);
        if (file === secret) continue;
        if (entry.isDirectory()) walk(file, relative + '/', depth + 1);
        else if (entry.isFile()) {
          const st = fs.lstatSync(file, { bigint: true });
          if (st.isFile() && !excluded(file, st, identity)) files.push(relative);
        }
      }
    }
    walk(root, '', 0); return { files, capped: files.length >= 200 || visited >= 1000 };
  }
  function read(relative) {
    let fd;
    try {
      const file = safe(relative);
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const st = fs.fstatSync(fd, { bigint: true });
      if (!st.isFile() || st.size > BigInt(LIMIT) || excluded(file, st, secretIdentity())) throw new Error();
      const bytes = Buffer.alloc(LIMIT + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (length > LIMIT || bytes.subarray(0,length).includes(0)) throw new Error();
      return { name: relative, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0,length)) };
    } catch { throw new Error('file not available (text files up to 200 KB only)'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return { list, read };
};
