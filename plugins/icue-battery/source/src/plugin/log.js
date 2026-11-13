'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..');
const file = path.join(dir, 'plugin.log');
let size = 0;
try { size = fs.statSync(file).size; } catch (e) { size = 0; }

function write(level, msg) {
  const line = new Date().toISOString() + ' [' + level + '] ' + msg + '\n';
  try {
    if (size > 1000000) {
      try { fs.renameSync(file, file + '.old'); } catch (e) { /* ignore */ }
      size = 0;
    }
    fs.appendFileSync(file, line);
    size += line.length;
  } catch (e) { /* logging must never crash the plugin */ }
}

module.exports = {
  dir,
  info: (m) => write('INFO', m),
  warn: (m) => write('WARN', m),
  error: (m) => write('ERROR', m),
};
