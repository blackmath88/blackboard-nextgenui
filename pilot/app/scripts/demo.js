#!/usr/bin/env node
// DEV/DEMO ONLY. npm run demo -- <version>   (e.g. npm run demo -- v0.3)
// Wipes and seeds a throwaway .pilot-demo/ from demo/fixtures/<version>/, starts the fake model endpoints
// listed in the fixture's demo.json and the server against them (PILOT_DIR=.pilot-demo, PILOT_CONFIG = the
// fixture's pilot.config.json), prints the URL and "try this" lines. Ctrl+C stops everything.
// Never touches .pilot/. Env (for scripts): DEMO_PORT_SHIFT=<n> adds n to every port;
// PILOT_DEMO_DIR=.pilot-demo-<x> uses another throwaway dir (must start with .pilot-demo).
// Verification may pass an absolute demo path beneath its marked PILOT_FIXTURE_ROOT.
// Fixture layout: demo.json {fakes: [{name, port, args?, toggleKey?}], try: [lines; {url} {dir} {app} {rel} are filled in]},
// pilot.config.json,
// and data files copied verbatim into the demo dir (transcript.jsonl, rules.json, modules.json, roles.json, ...).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const safety = require('../dev/lib/safe-dir');

const APP = path.join(__dirname, '..');
const FIX = path.join(APP, 'demo', 'fixtures');
const versions = () => (fs.existsSync(FIX) ? fs.readdirSync(FIX).filter((d) => fs.existsSync(path.join(FIX, d, 'demo.json'))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : []);
const version = process.argv[2];
if (!version || !versions().includes(version)) {
  console.error(`${version ? `unknown demo version "${version}". ` : ''}usage: npm run demo -- <version>\navailable: ${versions().join(', ') || 'none'}`);
  process.exit(2);
}
const dirName = process.env.PILOT_DEMO_DIR || '.pilot-demo';
if ((!path.isAbsolute(dirName) && dirName !== path.basename(dirName)) || !/^\.pilot-demo[\w-]*$/.test(path.basename(dirName)) || (path.isAbsolute(dirName) && (!process.env.PILOT_FIXTURE_ROOT || !dirName.startsWith(process.env.PILOT_FIXTURE_ROOT + path.sep)))) { console.error('PILOT_DEMO_DIR must be a name starting with .pilot-demo'); process.exit(2); }
const shift = Number(process.env.DEMO_PORT_SHIFT) || 0;
const src = path.join(FIX, version);
const demo = JSON.parse(fs.readFileSync(path.join(src, 'demo.json'), 'utf8'));
const DIR = path.resolve(APP, dirName);
const fixtureRoot = process.env.PILOT_FIXTURE_ROOT;

// Refuse occupied ports before seeding or starting children.
require('child_process').execFileSync(process.execPath, [path.join(APP, 'dev/lib/safe-dir.js'), 'ports', String(JSON.parse(fs.readFileSync(path.join(src, 'pilot.config.json'), 'utf8')).port + shift), ...(demo.fakes || []).map((f) => String(f.port + shift))], { stdio: 'inherit' });

// ---- seed the throwaway dir ----
safety.remove(DIR, fixtureRoot);
safety.mark(DIR);
for (const f of fs.readdirSync(src)) {
  if (f === 'demo.json' || f === 'pilot.config.json') continue;
  fs.copyFileSync(path.join(src, f), path.join(DIR, f));
}
// The config lives in the throwaway dir too, with ports shifted if asked.
const config = JSON.parse(fs.readFileSync(path.join(src, 'pilot.config.json'), 'utf8'));
const mapPort = (p) => p + shift;
config.port = mapPort(config.port);
for (const r of Object.values(config.roles || {})) for (const c of r.candidates || []) {
  c.baseUrl = c.baseUrl.replace(/:(\d+)\//, (_, p) => `:${mapPort(Number(p))}/`);
}
const configFile = path.join(DIR, 'demo.config.json');
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
const URL = `http://127.0.0.1:${config.port}`;

// ---- children ----
const children = new Map();   // key -> ChildProcess
let stopping = false;
function launch(key, args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: APP, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${key}] `;
  const relay = (stream, out) => readline.createInterface({ input: stream }).on('line', (l) => out.write(tag + l + '\n'));
  relay(child.stdout, process.stdout); relay(child.stderr, process.stderr);
  child.on('exit', (code, sig) => {
    if (children.get(key) === child) children.delete(key);
    if (stopping || child.toggledOff) return;
    if (sig === 'SIGINT') return stopAll(0);   // Ctrl+C reached the whole process group
    console.error(`${tag}exited (${sig || code}); stopping the demo`);
    stopAll(1);
  });
  children.set(key, child);
  return child;
}
function fakeArgs(f) { return ['dev/fake-model.js', String(mapPort(f.port)), f.name, ...(f.args || [])]; }
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  const list = [...children.values()];
  if (!list.length) process.exit(code);
  let left = list.length;
  for (const c of list) {
    c.once('exit', () => { if (--left === 0) process.exit(code); });
    c.kill('SIGTERM');
  }
  setTimeout(() => { for (const c of list) c.kill('SIGKILL'); process.exit(code); }, 3000).unref();
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
process.on('SIGHUP', () => stopAll(0));

for (const f of demo.fakes || []) launch(f.name, fakeArgs(f));
console.log(`[demo] ${version}: seeded ${dirName}/ from demo/fixtures/${version}/ (PILOT_DIR=${dirName})`);
launch('server', ['server.js'], { PILOT_DIR: dirName, PILOT_CONFIG: path.relative(APP, configFile) });

(async () => {
  for (let i = 0; i < 100; i++) {
    if (stopping) return;
    try { const r = await fetch(`${URL}/state`); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\n  CLI Pilot demo ${version}: open ${URL}\n\n  try this:`);
  // {url} and {dir} in a try line become this demo's URL and its absolute data dir (one-liners stay copy-pasteable);
  // {app} = absolute pilot/app, {rel} = the data dir relative to it (pilot-v0.6, for `npm run stats -- <dir>`)
  for (const l of demo.try || []) console.log(`   - ${l.replaceAll('{url}', URL).replaceAll('{dir}', DIR).replaceAll('{app}', APP).replaceAll('{rel}', dirName)}`);
  console.log('\n  Ctrl+C stops the demo (server and fakes).\n');
})();

// Toggle keys: "<key> + Enter" in this terminal stops or restarts that fake (to simulate an outage).
const toggles = (demo.fakes || []).filter((f) => f.toggleKey);
if (toggles.length && process.stdin.isTTY) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const f = toggles.find((t) => t.toggleKey === line.trim());
    if (!f || stopping) return;
    const running = children.get(f.name);
    if (running) { running.toggledOff = true; running.kill('SIGTERM'); console.log(`[demo] ${f.name} fake stopped (${f.toggleKey} + Enter starts it again)`); }
    else { launch(f.name, fakeArgs(f)); console.log(`[demo] ${f.name} fake started again`); }
  });
}
