'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert/strict');
const safety = require('./lib/safe-dir');
const root = process.argv[2]; safety.validateRoot(root);
const data = safety.mark(path.join(root, 'data'));
const store = path.join(root, 'private', 'secrets.json');
const capture = path.join(root, 'capture.jsonl');
const sentinel = 'sk-m1-SENTINEL-123456789012345678901234567890';
const envKey = 'sk-m1-ENV-123456789012345678901234567890';
const url = 'http://127.0.0.1:4840';
const config = path.join(root, 'config.json');
const candidate = { name: 'mistral-test', model: 'fake-mistral', stallMs: 200, baseUrl: 'http://127.0.0.1:5841/v1', keyEnv: 'M1_TEST_KEY' };
fs.writeFileSync(config, JSON.stringify({ port: 4840, experiments: { frameProposals: true }, roles: { chat: { policy: 'fallback', candidates: [candidate, { ...candidate, name: 'fallback-must-not-run-after-token' }] }, extract: { candidates: [candidate] }, frame: { candidates: [candidate] } } }));
fs.writeFileSync(path.join(data, 'modules.json'), JSON.stringify({ rev: 1, panes: [{ module: 'map' }], answers: { map: { answer: 'yes' } } }));
const children = new Set(); let log = '', outputs = '';
function start(args, env = {}) {
  const p = spawn(process.execPath, args, { env: { ...process.env, M1_TEST_KEY: '', PILOT_CONFIG: config, PILOT_DIR: data, PILOT_SECRETS_FILE: store, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(p); p.stdout.on('data', b => { log += b; }); p.stderr.on('data', b => { log += b; });
  return p;
}
async function stop(p) { if (p.exitCode === null && p.signalCode === null) { const exited = new Promise(r => p.once('exit', r)); p.kill(); await exited; } children.delete(p); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ready(base) { for (let i = 0; i < 80; i++) { try { await fetch(base); return; } catch { await sleep(50); } } throw new Error('server not ready'); }
async function request(route, body, method = body === undefined ? 'GET' : 'POST', headers = {}) {
  const r = await fetch(url + route, { method, headers: { 'content-type': 'application/json', 'x-pilot': '1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); outputs += text;
  if (route === '/chat') for (let i = 0; i < 100; i++) { const st = await (await fetch(url + '/state')).json(); if (!st.extracting && !st.framing) break; await sleep(20); } let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
async function cmd(text) { return (await request('/command', { text })).json; }
const calls = () => fs.existsSync(capture) ? fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const chatCalls = () => calls().filter(c => !c.body.messages.some(m => /PILOT-(EXTRACT|FRAME)/.test(m.content)));
const roleCalls = role => calls().filter(c => c.body.messages.some(m => m.content.includes('PILOT-' + role.toUpperCase())));
const pass = text => console.log('PASS ' + text);
async function main() {
  let server;
  try {
    let fake = start(['dev/fake-model.js', '5841', 'mistral'], { PILOT_FAKE_CAPTURE: capture }); await ready('http://127.0.0.1:5841');
    server = start(['server.js']); await ready(url);
    assert.deepEqual((await request('/settings/keys')).json.keys, [{ name: 'M1_TEST_KEY', source: 'missing' }]);
    await request('/chat', { text: 'missing key request' }); assert.equal(calls().length, 0); pass('missing key fails without a model request');
    assert.equal((await request('/settings/key', { name: 'M1_TEST_KEY', value: '  ' + sentinel + '  ' })).status, 200);
    assert.equal(fs.statSync(store).mode & 0o777, 0o600); assert.equal(fs.statSync(path.dirname(store)).mode & 0o777, 0o700);
    assert.equal((await request('/settings/keys')).json.keys[0].source, 'saved'); pass('saved key source, trimmed save, file 0600 and directory 0700');
    fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ rev: 1, items: [
      { id: 'dec-1', kind: 'decision', text: 'Keep Postgres', status: 'confirmed', author: 'user' },
      { id: 'task-1', kind: 'task', text: 'Draft', status: 'confirmed', column: 'todo' },
      { id: 'dec-2', kind: 'decision', text: 'DO NOT SHARE PROPOSAL', status: 'proposed' },
    ] }));
    assert.equal((await request('/state')).json.context.share.board, false);
    assert((await cmd('/context')).lines.includes('nothing beyond this conversation'));
    await request('/chat', { text: 'default conversation' });
    assert(!chatCalls().at(-1).body.messages.some(m => m.role === 'system')); assert.equal(chatCalls().at(-1).headers.authorization, 'Bearer ' + sentinel);
    assert(roleCalls('extract').length > 0);
    assert(!JSON.stringify(roleCalls('extract').at(-1).body).includes('Keep Postgres'));
    assert.equal(roleCalls('frame').length, 0);
    assert(fs.readFileSync(path.join(data, 'metrics.jsonl'), 'utf8').includes('board sharing is off'));
    assert.equal((await cmd('/context')).context.roles.frame.skipReason, 'board sharing is off');
    pass('default off with confirmed board; saved key reaches Authorization; extraction has no board titles and frame is skipped');
    const preview = await cmd('/context share board on'); assert.equal(preview.context.rev, 1); assert.match(preview.lines[0], /board is sent to mistral-test \(cloud\)/);
    await request('/chat', { text: 'use MongoDB please' });
    assert(JSON.stringify(roleCalls('extract').at(-1).body).includes('Keep Postgres'));
    assert(JSON.stringify(roleCalls('frame').at(-1).body).includes('Keep Postgres'));
    assert(preview.context.roles.extract.messagesTemplate.some(m => m.content.includes('Keep Postgres')));
    assert.equal(preview.context.roles.extract.location, 'cloud');
    const messages = chatCalls().at(-1).body.messages;
    assert.deepEqual(messages.at(-2), preview.context.nextMessage); assert.deepEqual(JSON.parse(preview.lines.at(-1)), messages.at(-2));
    assert.equal(messages.at(-1).content, 'use MongoDB please'); assert(!messages.at(-2).content.includes('DO NOT SHARE'));
    let metrics = fs.readFileSync(path.join(data, 'metrics.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert(metrics.some(e => e.event === 'model_call' && e.context?.board === true && e.context.items === 2));
    assert(metrics.some(e => e.event === 'model_call' && e.context?.board === false && e.context.items === 0));
    assert((await cmd('/stats')).lines.some(l => /board=true items=2/.test(l)));
    const tr = (await request('/state')).json.transcript; assert(tr.some(l => l.role === 'system' && /board sharing on/.test(l.text))); assert(tr.some(l => l.role === 'assistant' && l.model === 'mistral-test'));
    pass('opt-in exact preview placed before newest user; provenance, transcript, rev and context metrics');
    fs.writeFileSync(path.join(data, 'context.json'), '{broken');
    const broken = (await request('/state')).json; assert.equal(broken.context.share.board, false); assert(broken.fileErrors['context.json']);
    assert.equal((await cmd('/context share board on')).ok, false); await request('/chat', { text: 'broken context request' }); assert(!chatCalls().at(-1).body.messages.some(m => m.role === 'system'));
    fs.writeFileSync(path.join(data, 'context.json'), JSON.stringify({ rev: 9, share: { board: true }, changedBy: 'editor' }));
    assert.equal((await request('/state')).json.context.rev, 9); await cmd('/context share board off'); assert.equal((await request('/state')).json.context.rev, 10);
    pass('corrupt context fails closed after on; hand editing and off preserve revisions');
    const before = calls().length;
    for (const text of [sentinel, 'Abc01234567890123456789012345678901', '/key ' + sentinel]) assert.equal((await request('/chat', { text })).status, 400);
    assert.equal((await cmd('/key ' + sentinel)).ok, false); assert.equal(calls().length, before);
    assert.equal((await request('/chat', { text: sentinel }, 'POST', { origin: 'https://evil.test' })).status, 403, 'cross-origin');
    const hostStatus = await new Promise((resolve, reject) => { require('http').get(url + '/state', { headers: { Host: 'evil.test:4840' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject); });
    assert.equal(hostStatus, 403, 'bad Host');
    assert.equal((await request('/settings/key', { name: 'M1_TEST_KEY' }, 'DELETE', { origin: 'null' })).status, 403, 'null-origin');
    assert.equal((await request('/command', { text: '/context' }, 'POST', { origin: url })).status, 200);
    assert.equal((await request('/command', { text: '/context' }, 'POST', { 'x-pilot': '' })).status, 403, 'missing custom header');
    pass('key-shaped chat refused before storage/model; bad Host, cross-origin, null origin, missing custom header rejected');
    for (const value of ['', 'x\ny', 'x'.repeat(4097)]) assert.equal((await request('/settings/key', { name: 'M1_TEST_KEY', value })).status, 400);
    assert.equal((await request('/settings/key', { name: 'UNKNOWN', value: sentinel })).status, 400);
    fs.chmodSync(store, 0o644); assert.equal((await request('/settings/keys')).status, 409); await request('/chat', { text: 'wide mode' }); assert.equal(calls().length, before);
    fs.chmodSync(store, 0o600); fs.renameSync(store, store + '.real'); fs.symlinkSync(store + '.real', store);
    assert.equal((await request('/settings/keys')).status, 409); assert.equal((await request('/settings/key', { name: 'M1_TEST_KEY', value: sentinel })).status, 409);
    fs.unlinkSync(store); fs.renameSync(store + '.real', store); pass('invalid saves, wide-mode and symlink stores refused');
    await stop(fake); fake = start(['dev/fake-model.js', '5841', 'mistral', '--reflect-key=stream'], { PILOT_FAKE_CAPTURE: capture }); await ready('http://127.0.0.1:5841');
    await request('/chat', { text: 'reflected streaming credential' });
    await stop(fake); fake = start(['dev/fake-model.js', '5841', 'mistral', '--reflect-key=error'], { PILOT_FAKE_CAPTURE: capture }); await ready('http://127.0.0.1:5841');
    await request('/chat', { text: 'reflected error credential' });
    await stop(fake); fake = start(['dev/fake-model.js', '5841', 'mistral'], { PILOT_FAKE_CAPTURE: capture }); await ready('http://127.0.0.1:5841');
    pass('provider error-body and split streaming credential reflections cannot escape');
    await stop(fake); fake = start(['dev/fake-model.js', '5841', 'mistral', '--reflect-key=prefix-stall'], { PILOT_FAKE_CAPTURE: capture }); await ready('http://127.0.0.1:5841');
    const prefixCalls = calls().length;
    await request('/chat', { text: 'withheld prefix stalls' });
    assert.equal(calls().length, prefixCalls + 1, 'a withheld credential prefix must not enable fallback');
    await stop(fake); fake = start(['dev/fake-model.js', '5841', 'mistral'], { PILOT_FAKE_CAPTURE: capture }); await ready('http://127.0.0.1:5841');
    pass('no fallback after a credential prefix was received and withheld');
    await stop(server); server = start(['server.js'], { M1_TEST_KEY: envKey }); await ready(url);
    assert.equal((await request('/settings/keys')).json.keys[0].source, 'env'); await request('/chat', { text: 'environment priority' }); assert.equal(chatCalls().at(-1).headers.authorization, 'Bearer ' + envKey);
    await request('/settings/key', { name: 'M1_TEST_KEY' }, 'DELETE'); assert.equal((await request('/settings/keys')).json.keys[0].source, 'env');
    await stop(server); server = start(['server.js']); await ready(url); assert.equal((await request('/settings/keys')).json.keys[0].source, 'missing');
    pass('environment overrides saved; Remove deletes saved only; missing survives restart');
    const ac = new AbortController(); const r = await fetch(url + '/events', { signal: ac.signal }); const reader = r.body.getReader(); outputs += new TextDecoder().decode((await reader.read()).value); ac.abort();
    await stop(server);
    let project = ''; for (const name of fs.readdirSync(data)) if (fs.statSync(path.join(data, name)).isFile()) project += fs.readFileSync(path.join(data, name), 'utf8');
    for (const secret of [sentinel, envKey]) assert(![project, outputs, log].some(s => s.includes(secret)), 'key leaked to an observable output');
    pass('sentinel absent from state, settings, SSE, transcript, metrics, server log and error output');
    console.log('ALL M1 HTTP CHECKS PASSED');
  } finally { await Promise.all([...children].map(stop)); }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { Promise.all([...children].map(stop)).then(() => process.exit(1)); });
main().catch(e => { console.error('FAIL M1:', e.message.replaceAll(sentinel, '[redacted]').replaceAll(envKey, '[redacted]')); process.exitCode = 1; });
