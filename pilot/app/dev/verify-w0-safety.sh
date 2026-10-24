#!/bin/bash
# All sentinel data and copied runners live in an owned disposable layout.
set -eu
cd "$(dirname "$0")/.." || exit 1
SELFTEST_PID=""
interrupt() { [ -z "$SELFTEST_PID" ] || { kill -TERM "$SELFTEST_PID" 2>/dev/null || true; wait "$SELFTEST_PID" 2>/dev/null || true; }; exit "$1"; }
trap 'interrupt 130' INT
trap 'interrupt 143' TERM
node <<'JS' &
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const safety = require('./dev/lib/safe-dir');
const APP = process.cwd();
let root, cleaning, stopping = false;
const children = new Set();
function check(name, ok) { if (!ok) throw Error(name); console.log(`PASS ${name}`); }
function tree(dir) {
  const result = [];
  function walk(file, rel) {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) result.push([rel, 'link', fs.readlinkSync(file)]);
    else if (st.isDirectory()) { result.push([rel, 'dir', st.mode]); for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), path.join(rel, name)); }
    else result.push([rel, st.mode, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
  }
  walk(dir, '.'); return JSON.stringify(result);
}
async function stop(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ } }, 5000);
    child.once('exit', () => clearTimeout(timer));
  });
}
function cleanup() {
  if (!cleaning) cleaning = (async () => {
    stopping = true;
    await Promise.all([...children].map((child) => stop(child)));
    if (root) {
      safety.validateRoot(root);
      const writable = (dir) => {
        const st = fs.lstatSync(dir); if (!st.isDirectory() || st.isSymbolicLink()) return;
        fs.chmodSync(dir, 0o700);
        for (const name of fs.readdirSync(dir)) writable(path.join(dir, name));
      };
      writable(root); safety.remove(root, root);
    }
  })();
  return cleaning;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(signal, () => {
  cleanup().then(() => process.exit(code), (e) => { console.error('FAIL cleanup', e.message); process.exit(1); });
});
function launch(args, cwd, env = {}) {
  if (stopping) throw Error('self-test stopping');
  const child = cp.spawn(args[0], args.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.add(child); child.once('exit', () => children.delete(child));
  return child;
}
async function run(args, cwd, env) {
  const child = launch(args, cwd, env); let stdout = '', stderr = '';
  child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
  const status = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  return { status, stdout, stderr };
}
(async () => {
  try {
    root = safety.tempRoot(); safety.validateRoot(root);
    try { await safety.portsFree([4750, 5701, 5702, 5950, 6951, 6952]); }
    catch (e) { const port = /port (\d+): already in use/.exec(e.message); if (port) throw Error(`BLOCKED: port ${port[1]} in use`); throw e; }
    // Do not inspect, copy, create, chmod or write through the actual APP/.pilot.
    const layout = path.join(root, 'repo space "quote\' dollar$', 'pilot', 'app');
    fs.mkdirSync(layout, { recursive: true });
    for (const name of fs.readdirSync(APP)) {
      if (!name.startsWith('.pilot')) fs.cpSync(path.join(APP, name), path.join(layout, name), { recursive: true });
    }
    const real = path.join(layout, '.pilot');
    fs.mkdirSync(path.join(real, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(real, 'state.json'), '{"sentinel":true}\n');
    fs.writeFileSync(path.join(real, 'nested', 'unknown.bin'), Buffer.from([0, 255, 34, 10]));
    fs.symlinkSync('state.json', path.join(real, 'sentinel-link'));
    fs.chmodSync(path.join(real, 'state.json'), 0o444);
    fs.chmodSync(path.join(real, 'nested', 'unknown.bin'), 0o444);
    fs.chmodSync(path.join(real, 'nested'), 0o555); fs.chmodSync(real, 0o555);
    const before = tree(real);
    const demo = path.join(layout, '.pilot-demo-unmarked');
    fs.mkdirSync(demo); fs.writeFileSync(path.join(demo, 'sentinel'), 'legacy demo\n');
    const demoBefore = tree(demo);
    const unmarked = path.join(root, 'unmarked'); fs.mkdirSync(unmarked);
    fs.symlinkSync(real, path.join(root, 'escape'));
    fs.symlinkSync(path.join(root, 'missing-target'), path.join(root, 'broken-escape'));
    for (const dir of ['', undefined, '/', require('os').homedir(), real, demo, unmarked, path.join(root, 'escape'), path.join(root, 'escape', 'child'), path.join(root, 'broken-escape'), path.join(root, 'broken-escape', 'child')]) {
      let refused = false; try { safety.remove(dir, root); } catch (e) { refused = /REFUSE/.test(e.message); }
      check(`refuses ${JSON.stringify(dir)}`, refused);
    }
    const target = path.join(root, '.pilot-verify-missing');
    for (const invalid of ['', undefined, path.join(root, 'absent'), unmarked]) {
      for (const cmd of ['reset', 'remove', 'validate']) {
        const r = await run([process.execPath, path.join(APP, 'dev/lib/safe-dir.js'), cmd, invalid || '', target], layout);
        check(`${cmd} refuses invalid run root`, r.status !== 0 && !fs.existsSync(target));
      }
    }
    const marked = safety.mark(path.join(root, 'marked')); safety.remove(marked, root);
    check('marked fixture can be deleted', !fs.existsSync(marked));
    const server = require('net').createServer(); await new Promise((r) => server.listen(0, r));
    let refused = false; try { await safety.portsFree([server.address().port]); } catch { refused = true; }
    await new Promise((r) => server.close(r)); check('occupied port refused', refused);

    // Inject failed, empty-success and invalid-success allocation in the copied shell helper.
    const helper = path.join(layout, 'dev/lib/safe-dir.sh'); const original = fs.readFileSync(helper, 'utf8');
    const scripts = fs.readdirSync(path.join(layout, 'dev')).filter((n) => /^verify-(p|v).*\.sh$/.test(n)).map((n) => `dev/${n}`).concat(['scripts/verify-all.sh', 'scripts/try.sh']);
    for (const fault of ['return 1', 'return 0', `printf '%s\\n' '${unmarked.replaceAll("'", "'\\''")}'`]) {
      fs.writeFileSync(helper, original + `\nfixture_temp() { ${fault}; }\n`);
      const snapshot = tree(layout);
      for (const script of scripts) {
        const r = await run(['bash', '-x', script, 'pilot-v0.3'], layout, { TRY_REF: 'HEAD' });
        check(`${script}: allocation failure before sinks/children`, r.status !== 0 && !/^\+ (?:FIXTURE_ROOT=|DIR=|WT=|trap |node -e |git .*worktree add|run )/m.test(r.stderr) && tree(layout) === snapshot);
      }
    }
    fs.writeFileSync(helper, original);
    // JS entry points must also fail before output sinks or children when allocation throws.
    const probe = path.join(root, 'alloc-probe.js'), events = path.join(root, 'alloc-events');
    fs.writeFileSync(probe, `const fs=require('fs'),cp=require('child_process');fs.mkdtempSync=()=>{throw Error('injected allocation failure')};const sink=()=>{fs.appendFileSync(${JSON.stringify(events)},'unexpected sink or child\\n');throw Error('unexpected sink or child')};fs.writeFileSync=sink;for(const k of ['spawn','spawnSync','execFileSync'])cp[k]=sink;`);
    for (const script of ['dev/browser-check.js', 'dev/verify-w0-safety.sh']) {
      const args = script.endsWith('.js') ? [process.execPath, '-r', probe, script, 'p1'] : ['bash', script];
      const r = await run(args, layout, { NODE_OPTIONS: `--require=${JSON.stringify(probe)}` });
      check(`${script}: failed allocation launches no sink/child`, r.status !== 0 && !fs.existsSync(events));
    }
    for (const name of ['p0', 'p1', 'p2']) {
      const r = await run(['bash', `dev/verify-${name}.sh`], layout);
      fs.writeFileSync(path.join(root, `${name}.log`), r.stdout + r.stderr);
      const ok = r.status === 0 && (name === 'p0' ? r.stdout.includes('"role":"assistant"') : /ALL .*PASSED/.test(r.stdout)) && !/^FAIL/m.test(r.stdout);
      if (!ok) {
        console.error(`== ${name} failure log\n${r.stdout}${r.stderr}`);
        const port = /REFUSE port (\d+): already in use/.exec(r.stderr);
        if (port) throw Error(`BLOCKED: port ${port[1]} in use`);
      }
      check(`${name} runs beside read-only fake .pilot`, ok);
      check(`${name}: whole sentinel tree unchanged`, tree(real) === before);
    }
    // Symlink scenario stays inside the sandbox, including its complete target tree.
    const saved = path.join(layout, 'saved-real'); fs.renameSync(real, saved); fs.symlinkSync(saved, real);
    const symlinkBefore = tree(real), savedBefore = tree(saved);
    const p0 = await run(['bash', 'dev/verify-p0.sh'], layout);
    check('P0 preserves symlink .pilot and complete target tree', p0.status === 0 && tree(real) === symlinkBefore && tree(saved) === savedBefore);
    const legacy = await run([process.execPath, 'scripts/demo.js', 'v0.3'], layout, { PILOT_DEMO_DIR: path.basename(demo), DEMO_PORT_SHIFT: '1200' });
    check('legacy unmarked demo: actionable one-line refusal, exit 2', legacy.status === 2 && /^REFUSE demo directory .*PILOT_DEMO_DIR=.*\n$/.test(legacy.stderr) && tree(demo) === demoBefore);
    const layoutSafety = require(path.join(layout, 'dev/lib/safe-dir'));
    const demoRoot = layoutSafety.tempRoot();
    const data = path.join(demoRoot, '.pilot-demo-cleanup');
    const child = launch([process.execPath, 'scripts/demo.js', 'v0.3'], layout, { PILOT_FIXTURE_ROOT: demoRoot, PILOT_DEMO_DIR: data, DEMO_PORT_SHIFT: '1200' });
    child.stdout.resume(); child.stderr.resume();
    await new Promise((r) => setTimeout(r, 1500));
    check('demo seeded isolated fixture', fs.existsSync(path.join(data, '.pilot-fixture')) && child.exitCode === null);
    await stop(child); layoutSafety.remove(demoRoot, demoRoot);
    check('demo cleanup guarded', !fs.existsSync(demoRoot));
    check('all sandbox sentinel trees unchanged', tree(real) === symlinkBefore && tree(saved) === savedBefore && tree(demo) === demoBefore);
    console.log('ALL W0 SAFETY CHECKS PASSED');
  } finally { await cleanup(); }
})().catch((e) => { console.error(e.message.startsWith('BLOCKED:') ? e.message : `FAIL W0 safety: ${e.message}`); process.exitCode = 1; });
JS
SELFTEST_PID=$!
wait "$SELFTEST_PID"
