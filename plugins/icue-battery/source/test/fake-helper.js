'use strict';
// Stands in for runtime/helper.ps1 in the tests: prints whatever JSON state the test puts in the
// state file (one line each time it changes), reads "rescan" from stdin, exits when stdin closes.
const fs = require('fs');
const file = process.argv[2];
let last = '';
function tick() {
  let s = '';
  try { s = fs.readFileSync(file, 'utf8').trim(); } catch (e) { return; }
  if (s && s !== last) { last = s; process.stdout.write(s.replace(/\n/g, ' ') + '\n'); }
}
process.stdout.write('{"type":"log","level":"info","msg":"Helper ready in 1 ms (fake)"}\n');
setInterval(tick, 100);
tick();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => process.stdout.write('{"type":"log","level":"info","msg":"command: ' + l.replace(/[^\w ]/g, '') + '"}\n')));
process.stdin.on('end', () => process.exit(0));
