'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const safety = require('./lib/safe-dir');
const root = safety.tempRoot(), app = path.resolve(__dirname, '..'), data = path.join(root, '.pilot-demo-loop');
const url = 'http://127.0.0.1:5270', children = new Set(); let logs = '';
const env = { ...process.env, PILOT_FIXTURE_ROOT: root, PILOT_DEMO_DIR: data, DEMO_PORT_SHIFT: '400', PILOT_SECRETS_FILE: path.join(root, 'secrets.json') };
function start(args, extra = {}) {
  const child = spawn(process.execPath, args, { cwd: app, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }); children.add(child);
  child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x); return child;
}
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done;
  }
  children.delete(child);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(route, body) {
  const res = await fetch(url + route, { method: body ? 'POST' : 'GET', headers: { 'x-pilot': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text(); assert(res.ok, text); try { return JSON.parse(text); } catch { return text; }
}
async function ready() { for (let n = 0; n < 100; n++) { try { return await request('/state'); } catch { await pause(40); } } throw new Error(logs); }
async function idle() { for (let n = 0; n < 100; n++) { const s = await request('/state'); if (!s.extracting) return s; await pause(40); } throw new Error('extraction did not settle'); }
const files = () => Object.fromEntries(fs.readdirSync(data).sort().map(name => [name, fs.readFileSync(path.join(data, name), 'utf8')]));
(async () => {
  try {
    await safety.portsFree([5270, 6271, 6272, 5370, 6371, 6372]);
    let demo = start(['scripts/demo.js', 'loop']); await ready();
    await request('/chat', { text: 'Task: persist this demo record. Decision: leave this proposal pending.' });
    let s = await idle(), task = s.items.find(i => i.kind === 'task');
    await request('/answer', { itemId: task.id, decision: 'confirm', rev: s.stateRev, token: s.stateToken });
    s = await request('/state'); await request('/edit', { itemId: task.id, text: 'Accepted demo survives restart', rev: s.stateRev, token: s.stateToken });
    s = await request('/state'); await request('/move', { itemId: task.id, column: 'done', rev: s.stateRev, token: s.stateToken });
    await request('/command', { text: '/context share board on' });
    const before = await request('/state'), snapshot = files();
    const concurrent = spawnSync(process.execPath, ['scripts/demo.js', 'loop'], { cwd: app, env: { ...env, DEMO_PORT_SHIFT: '500' }, encoding: 'utf8' });
    assert.equal(concurrent.status, 2); assert.match(concurrent.stderr, /live writer/); assert.deepEqual(files(), snapshot);
    console.log('PASS a second demo with different ports cannot reset a live demo directory');
    await stop(demo);
    demo = start(['scripts/demo.js', 'loop', '--resume']); s = await ready();
    assert.deepEqual(s.items, before.items); assert.deepEqual(s.transcript, before.transcript); assert.equal(s.context.share.board, true);
    const reply = await request('/chat', { text: 'What is the latest accepted task?' });
    assert(reply.includes('[done]: Accepted demo survives restart')); await idle();
    console.log('PASS demo --resume preserves accepted edits, done stage, pending review, chat history and sharing; next reply uses saved state');
    await stop(demo);
    const server = start(['server.js'], { PILOT_CONFIG: path.join(data, 'demo.config.json'), PILOT_DIR: data }); await ready();
    const standalone = files();
    const refused = spawnSync(process.execPath, ['scripts/demo.js', 'loop'], { cwd: app, env: { ...env, DEMO_PORT_SHIFT: '500' }, encoding: 'utf8' });
    assert.equal(refused.status, 2); assert.match(refused.stderr, /live writer/); assert.deepEqual(files(), standalone);
    await stop(server);
    console.log('PASS demo reset refuses a live standalone writer and preserves every data file');
    const configPath = path.join(data, 'demo.config.json'), config = JSON.parse(fs.readFileSync(configPath));
    config.roles.chat.candidates[0].baseUrl = 'https://example.invalid/v1'; fs.writeFileSync(configPath, JSON.stringify(config));
    const altered = files();
    const badResume = spawnSync(process.execPath, ['scripts/demo.js', 'loop', '--resume'], { cwd: app, env, encoding: 'utf8' });
    assert.equal(badResume.status, 2); assert.match(badResume.stderr, /no matching saved demo/); assert.deepEqual(files(), altered);
    await safety.portsFree([5270, 6271, 6272, 5370, 6371, 6372]);
    console.log('PASS resume refuses altered provider configuration without launching children or changing data');
    console.log('ALL DEMO LOOP CHECKS PASSED');
  } finally { await Promise.all([...children].map(stop)); safety.remove(root, root); }
})().catch(error => { console.error('FAIL demo loop:', error.stack); process.exitCode = 1; });
