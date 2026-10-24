// Read-only, bounded project file view. Dot entries, dependencies and symlinks are excluded.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const LIMIT = 200 * 1024;
module.exports = function projectFiles(root) {
  const secret = path.resolve(process.env.PILOT_SECRETS_FILE || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'pilot', 'secrets.json'));
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
    const files = []; let visited = 0;
    function walk(dir, prefix, depth) {
      if (depth > 3 || files.length >= 200 || visited >= 1000) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
        if (++visited > 1000 || files.length >= 200) break;
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name, file = path.join(root, relative);
        if (file === secret) continue;
        if (entry.isDirectory()) walk(file, relative + '/', depth + 1);
        else if (entry.isFile()) files.push(relative);
      }
    }
    walk(root, '', 0); return { files, capped: files.length >= 200 || visited >= 1000 };
  }
  function read(relative) {
    let fd;
    try {
      const file = safe(relative);
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > LIMIT) throw new Error();
      const bytes = Buffer.alloc(LIMIT + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (length > LIMIT || bytes.subarray(0,length).includes(0)) throw new Error();
      return { name: relative, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0,length)) };
    } catch { throw new Error('file not available (text files up to 200 KB only)'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return { list, read };
};
