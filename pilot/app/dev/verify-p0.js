'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
const { spawn } = require('child_process');
const safety = require('./lib/safe-dir');
const root = process.argv[2]; safety.validateRoot(root);
const app = path.resolve(__dirname, '..'), data = path.join(root, 'data'), configPath = path.join(root, 'dev.json');
const config = JSON.parse(fs.readFileSync(path.join(app, 'pilot.config.dev.json'))); config.port = 4750;
fs.writeFileSync(configPath, JSON.stringify(config));
const base = 'http://127.0.0.1:4750', children = new Set(); let logs = '';
const env = { ...process.env, PILOT_DIR: data, PILOT_CONFIG: configPath, PILOT_SECRETS_FILE: path.join(root, 'private', 'secrets.json') };
function start(args) {
  const child = spawn(process.execPath, args, { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] }); children.add(child);
  child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x); child.on('error', e => { logs += e.message; });
  return child;
}
async function stop(child) {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await done; clearTimeout(timer);
  }
  children.delete(child);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) {
  for (let n = 0; n < 60; n++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(250) }); await r.body?.cancel(); return; } catch { await pause(50); }
  }
  throw new Error('fixture did not start: ' + logs);
}
async function request(route, body, endpoint = base) {
  const r = await fetch(endpoint + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-pilot': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const text = await r.text(); assert.equal(r.status, 200, `${route}: HTTP ${r.status}`); return { text, headers: r.headers };
}
const state = async () => JSON.parse((await request('/state')).text);
async function idle() {
  for (let n = 0; n < 100; n++) { const s = await state(); if (!s.extracting && !s.framing) return s; await pause(40); }
  throw new Error('background work did not settle');
}
function rawStatus(route) {
  return new Promise((resolve, reject) => {
    const r = http.get(base + '/', { path: route }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject); r.setTimeout(2000, () => r.destroy(new Error('raw HTTP timeout')));
  });
}
const pass = label => console.log('PASS ' + label);
(async () => {
  try {
    const frontier = start(['dev/fake-model.js', '5701', 'frontier']); const morrow = start(['dev/fake-model.js', '5702', 'morrow']);
    await Promise.all([ready('http://127.0.0.1:5701'), ready('http://127.0.0.1:5702')]);
    const completion = JSON.parse((await request('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] }, 'http://127.0.0.1:5701')).text);
    assert.equal(completion.choices[0].message.role, 'assistant'); assert.match(completion.choices[0].message.content, /\[fake:frontier\]/);
    const stream = await request('/v1/chat/completions', { stream: true, messages: [{ role: 'user', content: 'hi' }] }, 'http://127.0.0.1:5702');
    assert.match(stream.headers.get('content-type'), /text\/event-stream/); assert.match(stream.text, /data: \[DONE\]/);
    assert.match(stream.text, /"content":/); pass('P0 fake providers return valid nonstreaming completions and terminated content streams');
    let server = start(['server.js']); await ready(base + '/state');
    const page = await request('/'); assert.match(page.headers.get('content-type'), /text\/html/); assert(page.text.includes('id="input"'));
    for (const route of ['/../server.js', '/%2e%2e/pilot.config.json']) assert.equal(await rawStatus(route), 404, route);
    pass('P0 page serves successfully and raw traversal requests cannot read server/config files');
    const one = await request('/chat', { text: 'First message: hello pilot' }); await idle(); assert.match(one.text, /\[fake:frontier\]/);
    const two = await request('/chat', { text: 'Second message' }); const before = await idle(); assert.match(two.text, /3 messages in context/);
    assert.deepEqual(before.transcript.filter(l => ['user', 'assistant'].includes(l.role)).map(l => [l.role, l.model]), [['user', null], ['assistant', 'frontier'], ['user', null], ['assistant', 'frontier']]);
    assert(before.transcript.every(l => typeof l.id === 'string' && typeof l.text === 'string'));
    pass('P0 two replies persist with authorship and the next request includes prior conversation');
    await stop(server); server = start(['server.js']); await ready(base + '/state');
    assert.deepEqual((await state()).transcript, before.transcript);
    pass('P0 restart returns the same persisted conversation and message identities');
    await stop(frontier);
    const fallback = await request('/chat', { text: 'Third, with frontier down' }); const after = await idle();
    assert.match(fallback.text, /\[fake:morrow\]/); assert.equal(after.transcript.filter(l => l.role === 'assistant').at(-1).model, 'morrow');
    const events = fs.readFileSync(path.join(data, 'metrics.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert(events.some(e => e.event === 'fallback' && e.from === 'frontier' && e.to === 'morrow'));
    assert(!fs.readdirSync(data).some(name => name.endsWith('.tmp')));
    await stop(server); await stop(morrow);
    assert(!fs.existsSync(path.join(data, '.server-lock'))); await safety.portsFree([4750, 5701, 5702]);
    pass('P0 fallback uses the remaining fake, audits the switch, and shutdown settles ports/lock/temp files');
    console.log('ALL P0 CHECKS PASSED');
  } finally { await Promise.all([...children].map(stop)); }
})().catch(error => { console.error('FAIL P0:', error.stack); process.exitCode = 1; });
