'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawn } = require('child_process');
const safety = require('./lib/safe-dir');
const { acquireWorkspace } = require('../workspace-lock');
const root = safety.tempRoot();
let child;
(async () => {
  try {
    const release = acquireWorkspace(root);
    assert.throws(() => acquireWorkspace(root), /live writer/); release();
    child = spawn(process.execPath, ['-e', `require(process.argv[1]).acquireWorkspace(process.argv[2]);console.log('ready');setInterval(()=>{},1000)`, path.resolve(__dirname, '../workspace-lock.js'), root], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
    assert.throws(() => acquireWorkspace(root), /live writer/);
    const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exit; child = null;
    const recovered = acquireWorkspace(root); recovered();
    fs.writeFileSync(path.join(root, '.server-lock'), '{}');
    assert.throws(() => acquireWorkspace(root), /owner is unknown/);
    assert.equal(fs.readFileSync(path.join(root, '.server-lock'), 'utf8'), '{}');
    console.log('PASS duplicate writers refused; dead local writer recovered; unknown owner preserved');
    console.log('ALL LOCK CHECKS PASSED');
  } finally { if (child) child.kill('SIGKILL'); safety.remove(root, root); }
})().catch(e => { console.error('FAIL workspace lock', e); process.exitCode = 1; });
