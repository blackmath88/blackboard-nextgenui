'use strict';
function verdict(name, code, output) {
  const failures = (output.match(/^FAIL\b/gm) || []).length;
  const skipped = (output.match(/^SKIP\b/gm) || []).length;
  const completed = /^ALL .*PASSED/m.test(output);
  if (code === 77 && skipped && !failures) return { status: 'SKIP', failures, skipped };
  if (code !== 0 || failures || !completed) return { status: 'FAIL', failures, skipped };
  return { status: skipped ? 'PARTIAL' : 'PASS', failures, skipped };
}
module.exports = { verdict };
if (require.main === module) {
  const [name, code, file] = process.argv.slice(2);
  const v = verdict(name, Number(code), require('fs').readFileSync(file, 'utf8'));
  console.log(`${v.status}|${v.failures}|${v.skipped}`);
}
