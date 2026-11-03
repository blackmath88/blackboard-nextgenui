'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawnSync } = require('child_process');
const safety = require('./lib/safe-dir');
const { stateStore, hash } = require('../state-store');
const root = safety.tempRoot();
try {
  for (const phase of ['state-transaction.json', 'state.json', 'metrics.jsonl', 'transcript.jsonl']) {
    const dir = path.join(root, phase); fs.mkdirSync(dir);
    const before = JSON.stringify({ rev: 1, items: [] }); fs.writeFileSync(path.join(dir, 'state.json'), before);
    const after = { rev: 2, items: [{ id: 'task-1', text: 'accepted' }] };
    const payload = { expected: hash(before), doc: after, metrics: [{ event: 'item_write', itemId: 'task-1', item: after.items[0] }], transcript: [{ id: 'note-1', text: 'accepted task-1' }] };
    // Kill a child just after the chosen atomic rename, including the narrow
    // state-written/audit-not-written window. No production fault switch.
    const script = `const fs=require('fs'),path=require('path');const rename=fs.renameSync;fs.renameSync=function(a,b){rename(a,b);if(path.basename(b)===process.argv[2])process.exit(91);};require(process.argv[3]).stateStore(process.argv[1]).commit(JSON.parse(process.argv[4]));`;
    const child = spawnSync(process.execPath, ['-e', script, dir, phase, path.resolve(__dirname, '../state-store.js'), JSON.stringify(payload)], { encoding: 'utf8' });
    assert.equal(child.status, 91, child.stderr);
    const store = stateStore(dir); assert.equal(store.recover(), true); assert.equal(store.recover(), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))), after);
    for (const name of ['metrics.jsonl', 'transcript.jsonl']) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').length, 1);
    assert.throws(() => store.commit(payload), e => e.code === 'STATE_STALE');
    console.log(`PASS interrupted after ${phase}: restart finishes once, preserving state and audit`);
  }
  {
    const dir = path.join(root, 'partial-journal'); fs.mkdirSync(dir);
    const before = JSON.stringify({ rev: 1, items: [] }); fs.writeFileSync(path.join(dir, 'state.json'), before);
    const after = { rev: 2, items: [{ id: 'task-1', text: 'accepted' }] };
    const payload = { expected: hash(before), doc: after, metrics: [{ event: 'item_write', itemId: 'task-1' }], transcript: [] };
    const script = `const fs=require('fs');const write=fs.writeFileSync;fs.writeFileSync=function(fd,data,...rest){if(typeof data==='string'&&data.includes('"version":1')&&data.includes('"after"')){write(fd,data.slice(0,13));process.kill(process.pid,'SIGKILL');}return write(fd,data,...rest)};require(process.argv[2]).stateStore(process.argv[1]).commit(JSON.parse(process.argv[3]));`;
    const child = spawnSync(process.execPath, ['-e', script, dir, path.resolve(__dirname, '../state-store.js'), JSON.stringify(payload)], { encoding: 'utf8' });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), before);
    assert.equal(stateStore(dir).recover(), false); assert(!fs.existsSync(path.join(dir, 'metrics.jsonl')));
    assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('state-transaction.json.') && name.endsWith('.tmp')).length, 1);
    stateStore(dir).commit(payload);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))), after);
    assert.equal(fs.readFileSync(path.join(dir, 'metrics.jsonl'), 'utf8').trim().split('\n').length, 1);
    console.log('PASS crash during unpublished journal write leaves canonical state untouched; explicit retry commits one outcome');
  }
  const dir = path.join(root, 'conflict'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'state.json'), 'external edit');
  fs.writeFileSync(path.join(dir, 'state-transaction.json'), JSON.stringify({ version: 1, id: 'conflict', before: hash('old'), after: JSON.stringify({ rev: 2, items: [] }), metrics: [], transcript: [] }));
  assert.throws(() => stateStore(dir).recover(), /resolve the conflict/);
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), 'external edit');
  assert(fs.existsSync(path.join(dir, 'state-transaction.json')));
  console.log('PASS conflicting hand edits are preserved with the recovery journal');
  for (const raw of ['', 'null', '{', JSON.stringify({ version: 1, id: 'bad', before: hash('external edit'), after: 'not JSON', metrics: [], transcript: [] })]) {
    fs.writeFileSync(path.join(dir, 'state-transaction.json'), raw);
    assert.throws(() => stateStore(dir).recover(), /state transaction is (unreadable|invalid)/);
    assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), 'external edit');
    assert.equal(fs.readFileSync(path.join(dir, 'state-transaction.json'), 'utf8'), raw);
  }
  console.log('PASS empty, truncated and malformed recovery journals fail closed without replacing evidence');
  console.log('ALL STORE CHECKS PASSED');
} finally { safety.remove(root, root); }
