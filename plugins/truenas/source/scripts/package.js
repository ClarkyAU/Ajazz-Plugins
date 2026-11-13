'use strict';
// Makes the two zips in dist/:
//   TrueNAS-for-Ajazz-<version>.zip         ready to install (unzip, run install.bat)
//   TrueNAS-for-Ajazz-<version>-source.zip  source, README, build/package scripts, test tools
// Run after `node scripts/build.js` (npm run package does both, plus the tests).
const fs = require('fs');
const path = require('path');
const { writeZip, walk } = require('./zip');

const ROOT = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8')).Version;
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

// copy fresh previews into docs/ so the README can show them
const prev = path.join(ROOT, 'test', 'previews');
if (fs.existsSync(prev)) {
  fs.mkdirSync(path.join(ROOT, 'docs', 'previews'), { recursive: true });
  for (const f of fs.readdirSync(prev)) if (f.endsWith('.png')) fs.copyFileSync(path.join(prev, f), path.join(ROOT, 'docs', 'previews', f));
}

const buildDir = path.join(ROOT, 'build', 'TrueNAS-for-Ajazz');
if (!fs.existsSync(buildDir)) throw new Error('Run node scripts/build.js first');
const ID = 'com.clarkyau.truenas';
const buildZip = path.join(DIST, `${ID}-${version}.zip`);
writeZip(buildZip, walk(buildDir).map((e) => ({ full: e.full, rel: `TrueNAS-for-Ajazz/${e.rel}` })));

const include = ['README.md', 'package.json', 'package-lock.json', '.gitignore', 'src', 'pi', 'assets', 'installer', 'scripts', 'test', 'tools', 'docs'];
const entries = [];
for (const item of include) {
  const full = path.join(ROOT, item);
  if (!fs.existsSync(full)) continue;
  if (fs.statSync(full).isDirectory()) {
    for (const e of walk(full)) {
      if (e.rel.startsWith('previews/') && item === 'test') continue; // generated
      entries.push({ full: e.full, rel: `truenas-streamdock-source/${item}/${e.rel}` });
    }
  } else entries.push({ full, rel: `truenas-streamdock-source/${item}` });
}
const srcZip = path.join(DIST, `${ID}-${version}-source.zip`);
writeZip(srcZip, entries);

for (const f of [buildZip, srcZip]) console.log(`${path.relative(ROOT, f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
