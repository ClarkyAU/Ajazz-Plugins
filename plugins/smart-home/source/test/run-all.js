'use strict';
// Runs every test on Node 20.8.1 (the version inside the Ajazz software).
// "npm test" uses the node@20.8.1 dev dependency automatically.
const { spawnSync } = require('child_process');
const path = require('path');
const steps = [
  ['build', ['scripts/build.js']],
  ['protocol (3.3/3.4/3.5 vs tinytuya)', ['test/protocol.test.js']],
  ['cloud (signing vs tuya-connector)', ['test/cloud.test.js']],
  ['end-to-end (fake Ajazz host, every image checked)', ['test/e2e.test.js']],
  ['moving over from the old plugin', ['test/migration.test.js']],
];
console.log(`Node ${process.version}${process.version === 'v20.8.1' ? '' : '  (warning: the Ajazz software uses v20.8.1; run "npm test")'}`);
let failed = 0;
for (const [name, args] of steps) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(`!!! ${name} failed`); }
}
console.log(failed ? `\n${failed} test group(s) failed` : '\nAll test groups passed');
process.exit(failed ? 1 : 0);
