'use strict';
// Test/demo fixtures only. Never accept an environment-selected temp root.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const MARK = '.pilot-fixture';
function mark(dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, MARK), 'pilot fixture\n'); return dir; }
function tempRoot() { return mark(fs.mkdtempSync(path.join(__dirname, '../..', '.pilot-verify-run-'))); }
function validate(dir, root) {
  const refuse = () => { throw new Error(`REFUSE fixture delete: ${JSON.stringify(dir)} (requires a marked fixture within its temp root or a marked .pilot-demo*/.pilot-verify* directory)`); };
  if (!dir || typeof dir !== 'string') refuse();
  const target = path.resolve(dir);
  if ([path.parse(target).root, os.homedir()].includes(target) || path.basename(target) === '.pilot') refuse();
  // Resolve existing ancestors too: neither the target nor a parent may escape via a symlink.
  let ancestor = target;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  let component = target;
  while (component !== path.dirname(component)) {
    if (fs.lstatSync(component, { throwIfNoEntry: false })?.isSymbolicLink()) refuse();
    component = path.dirname(component);
  }
  const real = fs.realpathSync(ancestor);
  if (real !== ancestor) refuse();
  const inside = root && fs.existsSync(root) && fs.realpathSync(root) === path.resolve(root)
    && fs.existsSync(path.join(root, MARK)) && (target === path.resolve(root) || target.startsWith(path.resolve(root) + path.sep));
  if (!inside && !/^\.pilot-(demo|verify)[\w-]*$/.test(path.basename(target))) refuse();
  if (!fs.existsSync(target)) return;
  const marker = path.join(target, MARK);
  if (!fs.existsSync(marker) || !fs.lstatSync(marker).isFile() || fs.lstatSync(marker).isSymbolicLink()) refuse();
  return target;
}
function remove(dir, root) {
  const target = validate(dir, root);
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
module.exports = { mark, tempRoot, validate, remove, portsFree };
if (require.main === module) {
  const [cmd, root, ...args] = process.argv.slice(2);
  (async () => {
    if (cmd === 'temp') console.log(tempRoot());
    else if (cmd === 'remove') { if (!args.length) remove(undefined, root); for (const dir of args) remove(dir, root); }
    else if (cmd === 'validate') { if (!args.length) validate(undefined, root); for (const dir of args) validate(dir, root); }
    else if (cmd === 'reset') { remove(args[0], root); mark(args[0]); }
    else if (cmd === 'ports') await portsFree([root, ...args]);
    else throw new Error('unknown fixture helper command');
  })().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
