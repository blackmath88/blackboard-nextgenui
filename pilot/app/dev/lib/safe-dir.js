'use strict';
// Test/demo fixtures only. Never accept an environment-selected temp root.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const MARK = '.pilot-fixture';
function mark(dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, MARK), 'pilot fixture\n'); return dir; }
function tempRoot() { return validateRoot(mark(fs.mkdtempSync(path.join(__dirname, '../..', '.pilot-verify-run-')))); }
function refuse(dir) { throw new Error(`REFUSE fixture delete: ${JSON.stringify(dir)} (requires a valid marked run root and marked fixture; named demos require their own marker)`); }
function canonical(dir) {
  if (!dir || typeof dir !== 'string' || path.resolve(dir) !== dir) refuse(dir);
  if ([path.parse(dir).root, os.homedir()].includes(dir) || path.basename(dir) === '.pilot') refuse(dir);
  let component = dir;
  while (component !== path.dirname(component)) {
    if (fs.lstatSync(component, { throwIfNoEntry: false })?.isSymbolicLink()) refuse(dir);
    component = path.dirname(component);
  }
  return dir;
}
function marked(dir) {
  const st = fs.lstatSync(path.join(dir, MARK), { throwIfNoEntry: false });
  return st?.isFile() && !st.isSymbolicLink();
}
function validateRoot(root) {
  canonical(root);
  if (!/^\.pilot-verify-run-[\w-]+$/.test(path.basename(root)) || !fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory() || !marked(root) || fs.realpathSync(root) !== root) refuse(root);
  return root;
}
function validate(dir, root) {
  validateRoot(root);
  canonical(dir);
  if (dir !== root && !dir.startsWith(root + path.sep)) refuse(dir);
  if (!fs.existsSync(dir)) return;
  if (!marked(dir)) refuse(dir);
  return dir;
}
function remove(dir, root) {
  const target = validate(dir, root);
  if (target) fs.rmSync(target, { recursive: true, force: true });
}
// Explicit standalone-demo policy, never used as fallback for run-owned paths.
function validateDemo(dir) {
  canonical(dir);
  if (!/^\.pilot-demo[\w-]*$/.test(path.basename(dir))) refuse(dir);
  if (!fs.existsSync(dir)) return;
  if (!marked(dir)) refuse(dir);
  return dir;
}
function removeDemo(dir) {
  const target = validateDemo(dir);
  if (target) fs.rmSync(target, { recursive: true, force: true });
}
async function portsFree(ports) {
  for (const port of new Set(ports.map(Number))) {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 4747) throw new Error(`REFUSE test/demo port ${port}`);
    await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', () => reject(new Error(`REFUSE port ${port}: already in use; stop the other process or choose isolated ports`)));
      s.listen(port, () => s.close(resolve));
    });
  }
}
module.exports = { mark, tempRoot, validateRoot, validate, remove, validateDemo, removeDemo, portsFree };
if (require.main === module) {
  const [cmd, root, ...args] = process.argv.slice(2);
  (async () => {
    if (cmd === 'temp') console.log(tempRoot());
    else if (cmd === 'root') validateRoot(root);
    else if (cmd === 'remove') { if (!args.length) remove(undefined, root); for (const dir of args) remove(dir, root); }
    else if (cmd === 'validate') { if (!args.length) validate(undefined, root); for (const dir of args) validate(dir, root); }
    else if (cmd === 'reset') { remove(args[0], root); mark(args[0]); }
    else if (cmd === 'ports') await portsFree([root, ...args]);
    else throw new Error('unknown fixture helper command');
  })().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
