#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { spawn } = require('child_process');
const APP = path.resolve(__dirname, '..');
const secrets = require('../secrets');
const pkg = require('../package.json');
const HELP = `Pilot ${pkg.version}
Usage: pilot init [dir]
       pilot start [dir] [--port N]
       pilot key set <NAME>    (hidden prompt or stdin; never a command-line value)
       pilot key status
       pilot key rm <NAME>
       pilot doctor [dir]
       pilot --help | --version
Install: cd pilot/app && npm link
Fallback: node /path/to/pilot/app/bin/pilot.js --help`;
function fail(message, code = 1) { console.error(message); process.exitCode = code; }
function config(dir, fallback = false) {
  const file = path.join(dir, 'pilot.config.json');
  try { return JSON.parse(fs.readFileSync(fallback && !fs.existsSync(file) ? path.join(APP, 'pilot.config.mistral.json') : file, 'utf8')); }
  catch { throw new Error('Project configuration missing or invalid; run pilot init [dir] and check pilot.config.json.'); }
}
const names = c => [...new Set(Object.values(c.roles || {}).flatMap(r => (r.candidates || []).map(c => c.keyEnv).filter(n => typeof n === 'string')))];
async function readKey() {
  if (!process.stdin.isTTY) {
    let text = ''; for await (const chunk of process.stdin) { text += chunk; if (text.length > 4100) throw new Error('Key too long.'); } return text.trim();
  }
  process.stdout.write('Key (hidden): ');
  require('readline').emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let text = '';
    const done = () => { process.stdin.off('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') { done(); reject(new Error('Cancelled.')); }
      else if (key.name === 'return' || key.name === 'enter') { done(); resolve(text.trim()); }
      else if (key.name === 'backspace') text = text.slice(0, -1);
      else if (str && !key.ctrl && text.length < 4097) text += str;
    }; process.stdin.on('keypress', onKey);
  });
}
async function main() {
  let parsed;
  try { parsed = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, port: { type: 'string' } }, allowPositionals: true }); }
  catch { return fail('Unknown option. Use pilot --help.', 2); }
  const { values, positionals: args } = parsed;
  if (values.help || !args.length && !values.version) return console.log(HELP);
  if (values.version) return console.log(pkg.version);
  const [command, arg, extra, ...rest] = args;
  if (!['init', 'start', 'key', 'doctor'].includes(command)) return fail('Unknown command. Use pilot --help.', 2);
  if (rest.length || (command !== 'key' && extra) || (command !== 'start' && values.port)) return fail('Unexpected arguments. Use pilot --help.', 2);
  const dir = path.resolve(command === 'key' ? '.' : arg || '.');
  if (command === 'init') {
    fs.mkdirSync(dir, { recursive: true });
    const data = path.join(dir, '.pilot'), file = path.join(dir, 'pilot.config.json');
    if (fs.existsSync(data)) { if (!fs.lstatSync(data).isDirectory() || fs.lstatSync(data).isSymbolicLink()) throw new Error('Refusing non-directory or symlink .pilot.'); console.log('kept .pilot/'); }
    else { fs.mkdirSync(data); console.log('created .pilot/'); }
    if (fs.existsSync(file)) console.log('kept pilot.config.json');
    else { const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.mistral.json'), 'utf8')); c.pilotDir = '.pilot'; fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n', { flag: 'wx' }); console.log('created pilot.config.json'); }
    return;
  }
  if (command === 'start') {
    if (!fs.existsSync(path.join(dir, 'pilot.config.json')) || !fs.existsSync(path.join(dir, '.pilot')) || fs.lstatSync(path.join(dir, '.pilot')).isSymbolicLink() || !fs.statSync(path.join(dir, '.pilot')).isDirectory()) throw new Error('Project is not initialized. Run pilot init [dir] first.');
    config(dir);
    if (values.port && (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)) return fail('Port must be 1..65535.', 2);
    const child = spawn(process.execPath, [path.join(APP, 'server.js')], { cwd: APP, env: { ...process.env, PILOT_PROJECT: fs.realpathSync(dir), ...(values.port ? { PILOT_PORT: values.port } : {}) }, stdio: 'inherit' });
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child.kill('SIGTERM'); });
    child.on('error', () => fail('Could not start server.'));
    child.on('exit', code => { process.exitCode = stopping || code === 0 ? 0 : 1; }); return;
  }
  const c = config(dir, command === 'key');
  if (command === 'key') {
    if (arg === 'status' && !extra) { for (const name of names(c)) console.log(`${name}: ${secrets.resolve(name).source}`); return; }
    if (!['set', 'rm'].includes(arg) || !extra || !names(c).includes(extra)) return fail('Use pilot key set|rm <configured NAME>, or pilot key status.', 2);
    if (arg === 'rm') secrets.update(extra);
    else { const value = await readKey(); if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Key must be a nonempty single line, at most 4096 characters.'); secrets.update(extra, value); }
    console.log(`${extra}: ${secrets.resolve(extra).source}`); return;
  }
  console.log(`Node ${process.versions.node}: ${Number(process.versions.node.split('.')[0]) >= 20 ? 'ok' : 'requires Node 20+'}`);
  if (Number(process.versions.node.split('.')[0]) < 20) process.exitCode = 1;
  if (!c.roles || !Array.isArray(c.roles.chat?.candidates) || !c.roles.chat.candidates.length) throw new Error('Invalid config: chat candidates required.');
  console.log('Configuration: valid');
  for (const name of names(c)) { const source = secrets.resolve(name).source; console.log(`${name}: ${source}`); if (source === 'missing') process.exitCode = 1; }
  const candidates = Object.values(c.roles).flatMap(r => r.candidates || []), seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.baseUrl)) continue; seen.add(candidate.baseUrl);
    try {
      const value = candidate.keyEnv ? secrets.resolve(candidate.keyEnv).value : null;
      const response = await fetch(candidate.baseUrl.replace(/\/$/, '') + '/models', { headers: value ? { authorization: `Bearer ${value}` } : {}, signal: AbortSignal.timeout(5000) });
      await response.body?.cancel(); console.log(`${candidate.name}: endpoint ${response.ok ? 'reachable' : `HTTP ${response.status}`}`); if (!response.ok) process.exitCode = 1;
    } catch { console.log(`${candidate.name}: endpoint unreachable (5 s timeout)`); process.exitCode = 1; }
  }
}
main().catch(e => fail(e.message));
