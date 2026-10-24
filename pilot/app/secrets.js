// User credentials live outside the project: never export them with its blackboard.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const file = Object.hasOwn(process.env, 'PILOT_SECRETS_FILE') ? process.env.PILOT_SECRETS_FILE : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'pilot', 'secrets.json');
const refusal = () => new Error('Key store refused: use an owned regular file with mode 0600 in a private directory (0700); no symlinks.');
function checkDir(create = false) {
  if (!file || !path.isAbsolute(file)) throw refusal();
  const dir = path.dirname(file);
  if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let st;
  try { st = fs.lstatSync(dir); } catch (e) { if (!create && e.code === 'ENOENT') return; throw refusal(); }
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o7077)) throw refusal();
}
function read() {
  checkDir();
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o7177)) throw refusal();
    const doc = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || Object.values(doc).some(v => typeof v !== 'string')) throw refusal();
    return doc;
  } catch (e) { if (e.code === 'ENOENT') return {}; throw refusal(); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function update(name, value) {
  const doc = read();
  if (value === undefined) delete doc[name]; else doc[name] = value;
  checkDir(true);
  const tmp = path.join(path.dirname(file), `.secrets-${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(doc) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } catch { throw new Error('Could not save key store. Check its permissions.'); }
  finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(tmp); } catch {} }
}
function resolve(name) {
  if (process.env[name]) return { source: 'env', value: process.env[name] };
  const doc = read();
  const value = Object.hasOwn(doc, name) ? doc[name] : undefined;
  return value ? { source: 'saved', value } : { source: 'missing' };
}
function looksLikeKey(text) {
  return /\b(?:sk-(?:proj-|ant-)?|mistral[-_])[A-Za-z0-9_-]{8,}/i.test(text) || /^[A-Za-z0-9_+=\/.\-]{32,}$/.test(text.trim());
}
module.exports = { resolve, update, looksLikeKey };
