#!/bin/bash
# Refusal regression checks plus the legacy checks against real-data sentinels.
set -eu
cd "$(dirname "$0")/.."
node <<'JS'
const fs = require('fs'), path = require('path'), cp = require('child_process');
const safety = require('./dev/lib/safe-dir');
const root = safety.tempRoot();
const real = path.resolve('.pilot');
const madeReal = !fs.existsSync(real);
if (madeReal) fs.mkdirSync(real);
const sentinel = path.join(real, `w0-sentinel-${process.pid}`);
const demo = path.resolve(`.pilot-demo-w0-unmarked-${process.pid}`);
const bytes = Buffer.from('W0 real data must survive\n\x00\xff', 'binary');
fs.writeFileSync(sentinel, bytes, { flag: 'wx' });
fs.mkdirSync(demo); fs.writeFileSync(path.join(demo, 'sentinel'), bytes);
let child;
function check(name, ok) { if (!ok) throw Error(name); console.log(`PASS ${name}`); }
(async () => {
  try {
    const unmarked = path.join(root, 'unmarked'); fs.mkdirSync(unmarked);
    fs.symlinkSync(real, path.join(root, 'escape'));
    fs.symlinkSync('/nonexistent-w0-outside', path.join(root, 'broken-escape'));
    for (const dir of ['', undefined, '/', require('os').homedir(), real, demo, unmarked, path.join(root, 'escape'), path.join(root, 'escape', 'child'), path.join(root, 'broken-escape'), path.join(root, 'broken-escape', 'child')]) {
      let refused = false; try { safety.remove(dir, root); } catch (e) { refused = /REFUSE/.test(e.message); }
      check(`refuses ${JSON.stringify(dir)}`, refused);
    }
    const marked = safety.mark(path.join(root, 'marked')); safety.remove(marked, root);
    check('marked fixture can be deleted', !fs.existsSync(marked));
    const server = require('net').createServer();
    await new Promise((r) => server.listen(0, r));
    let refused = false; try { await safety.portsFree([server.address().port]); } catch { refused = true; }
    await new Promise((r) => server.close(r)); check('occupied port refused', refused);
    for (const name of ['p0', 'p1', 'p2']) {
      const r = cp.spawnSync('bash', [`dev/verify-${name}.sh`], { encoding: 'utf8' });
      fs.writeFileSync(path.join(root, `${name}.log`), r.stdout + r.stderr);
      check(`${name} runs with real .pilot present`, r.status === 0 && (name === 'p0' ? r.stdout.includes('"role":"assistant"') : /ALL .*PASSED/.test(r.stdout)) && !/^FAIL/m.test(r.stdout));
    }
    const refusedDemo = cp.spawnSync(process.execPath, ['scripts/demo.js', 'v0.3'], { env: { ...process.env, PILOT_DEMO_DIR: path.basename(demo), DEMO_PORT_SHIFT: '1200' }, encoding: 'utf8' });
    check('demo refuses existing unmarked directory', refusedDemo.status !== 0 && /REFUSE fixture delete/.test(refusedDemo.stderr));
    const data = path.join(root, '.pilot-demo-cleanup');
    child = cp.spawn(process.execPath, ['scripts/demo.js', 'v0.3'], { env: { ...process.env, PILOT_FIXTURE_ROOT: root, PILOT_DEMO_DIR: data, DEMO_PORT_SHIFT: '1200' }, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
    check('demo seeded isolated fixture', fs.existsSync(path.join(data, '.pilot-fixture')) && child.exitCode === null);
    child.kill(); await new Promise((r) => child.once('exit', r)); child = null;
    safety.remove(data, root); check('demo cleanup guarded', !fs.existsSync(data));
    check('real sentinel byte-identical', fs.readFileSync(sentinel).equals(bytes));
    check('unmarked demo sentinel byte-identical', fs.readFileSync(path.join(demo, 'sentinel')).equals(bytes));
    console.log('ALL W0 SAFETY CHECKS PASSED');
  } finally {
    if (child) child.kill();
    // Restore only the exact files/directories this self-test exclusively created.
    fs.unlinkSync(sentinel); if (madeReal) fs.rmdirSync(real);
    fs.unlinkSync(path.join(demo, 'sentinel')); fs.rmdirSync(demo);
    safety.remove(root, root);
  }
})().catch((e) => { console.error('FAIL W0 safety:', e.message); process.exitCode = 1; });
JS
