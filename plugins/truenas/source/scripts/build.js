'use strict';
// Builds the ready-to-install plugin folder in build/.
//   node scripts/build.js
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const PLUGIN = 'com.clarkyau.truenas.sdPlugin';
const OUT = path.join(ROOT, 'build', 'TrueNAS-for-Ajazz');
const DEST = path.join(OUT, PLUGIN);

fs.rmSync(path.join(ROOT, 'build'), { recursive: true, force: true });
fs.mkdirSync(path.join(DEST, 'plugin'), { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'index.js')],
  outfile: path.join(DEST, 'plugin', 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: false,
  legalComments: 'none',
  // optional native speed-ups of the ws library; it works without them
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
});

const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(DEST, to), { recursive: true });
copy('assets/manifest.json', 'manifest.json');
copy('assets/en.json', 'en.json');
copy('assets/static', 'static');
copy('pi', 'pi');

// installer goes next to the plugin folder
for (const f of fs.readdirSync(path.join(ROOT, 'installer'))) {
  let data = fs.readFileSync(path.join(ROOT, 'installer', f), 'utf8');
  if (/\.(bat|ps1|txt)$/i.test(f)) data = data.replace(/\r?\n/g, '\r\n'); // Windows line endings
  fs.writeFileSync(path.join(OUT, f), data);
}

const size = fs.statSync(path.join(DEST, 'plugin', 'index.js')).size;
console.log(`Built ${PLUGIN} (plugin/index.js ${(size / 1024).toFixed(0)} KB) in build/TrueNAS-for-Ajazz`);
