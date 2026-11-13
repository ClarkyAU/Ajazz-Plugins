'use strict';
// Start a new plugin from this template:
//   node tools/new-plugin.js <short-name> "<Display Name>" [target-folder]
// Example: node tools/new-plugin.js mousewheel "Mouse Wheel"  ->  id com.clarkyau.mousewheel
// Copies the template, renames the id and the display name, and leaves you ready for "npm install".
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const name = process.argv[2];
const display = process.argv[3];
if (!name || !display || !/^[a-z][a-z0-9]*$/.test(name)) {
  console.error('Usage: node tools/new-plugin.js <shortname, lowercase letters/digits> "<Display Name>" [target-folder]');
  process.exit(1);
}
const target = path.resolve(process.argv[4] || path.join(root, '..', name));
if (fs.existsSync(target)) { console.error('Target folder already exists: ' + target); process.exit(1); }

const OLD_ID = 'com.clarkyau.starter';
const NEW_ID = 'com.clarkyau.' + name;
const OLD_NAME = 'Starter Plugin';
const SKIP = ['node_modules', 'build', 'out', '.git'];
const TEXT = /\.(js|json|html|md|txt|ps1|bat)$/;

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((e) => {
    if (SKIP.indexOf(e.name) >= 0 || (e.name === 'out' && path.basename(from) === 'test')) return;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) return copy(a, b);
    if (!TEXT.test(e.name)) { fs.copyFileSync(a, b); return; }
    let t = fs.readFileSync(a, 'utf8');
    // Plain text replace (a JSON library would reformat the files).
    t = t.split(OLD_NAME + ' - Ajazz Stream Dock plugin template').join(display + ' - Ajazz Stream Dock plugin')
      .split('Starter template for Ajazz Stream Dock plugins.').join(display + ' for the Ajazz Stream Dock.')
      .split(OLD_ID).join(NEW_ID).split(OLD_NAME).join(display);
    fs.writeFileSync(b, t);
  });
}
copy(root, target);
// The template's own README describes the template; the new plugin gets a short one.
fs.writeFileSync(path.join(target, 'README.md'), '# ' + display + '\n\nAjazz Stream Dock plugin `' + NEW_ID + '`, made from the plugin template.\n\n' +
  '    npm install\n    node tools/build.js          # build/pkg\n    node test/run-tests.js       # tests use the built plugin\n    node tools/build.js --zip    # out/*.zip\n\n' +
  'Replace the demo reader in `src/plugin/source.js` with the real one, then rename the keys in `src/manifest.json`, `src/en.json` and `src/plugin/index.js`.\n');
console.log('Created ' + target + '\nNext: cd "' + target + '" && npm install && node tools/build.js && node test/run-tests.js');
