'use strict';
// Makes the two zips:
//   release/SmartHome-<ver>.zip         ready to install (install.bat + plugin)
//   release/SmartHome-<ver>-source.zip  source, scripts, tests
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'release');
const version = require('../plugin-files/actions').version;

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

function zip(file, add) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const a = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve(a.pointer()));
    a.on('error', reject);
    a.pipe(out);
    add(a);
    a.finalize();
  });
}

function addTree(a, dir, prefix, skip = () => false) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const rel = path.posix.join(prefix, f);
    if (skip(rel, p)) continue;
    if (fs.statSync(p).isDirectory()) addTree(a, p, rel, skip);
    else if (/\.(bat|cmd)$/i.test(f)) a.append(crlf(fs.readFileSync(p, 'utf8')), { name: rel });
    else a.file(p, { name: rel });
  }
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'com.clarkyau.smarthome.sdPlugin', 'plugin', 'index.js'))) {
    throw new Error('Run "npm run build" first.');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const build = path.join(OUT, `SmartHome-${version}.zip`);
  const src = path.join(OUT, `SmartHome-${version}-source.zip`);
  const top = `SmartHome-${version}`;
  const n1 = await zip(build, (a) => addTree(a, DIST, top));
  const n2 = await zip(src, (a) => {
    for (const f of ['README.md', 'package.json', 'package-lock.json']) a.file(path.join(ROOT, f), { name: `${top}-source/${f}` });
    for (const d of ['src', 'propertyInspector', 'plugin-files', 'installer', 'scripts', 'test']) {
      addTree(a, path.join(ROOT, d), `${top}-source/${d}`, (rel) => /__pycache__/.test(rel));
    }
  });
  console.log(`${path.relative(ROOT, build)}  ${(n1 / 1024).toFixed(0)} KB`);
  console.log(`${path.relative(ROOT, src)}  ${(n2 / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
