'use strict';
// Builds dist/com.clarkyau.mozabase.sdPlugin (single bundled plugin/index.js, manifest, panel, icons).
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const keys = require('../src/keys');
const { toPng } = require('./render');
const pkg = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const ID = 'com.clarkyau.mozabase';
const OUT = path.join(ROOT, 'dist', ID + '.sdPlugin');

function copy(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }

function iconSvg(size) {
  // line icon on a dark rounded tile
  const s = size;
  const c = s / 2;
  const r = s * 0.28;
  const hub = r * 0.28;
  const sw = Math.max(2, s * 0.045);
  const col = 'rgb(45,212,191)';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" rx="${s * 0.18}" fill="rgb(24,26,31)"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"/><circle cx="${c}" cy="${c}" r="${hub}" fill="none" stroke="${col}" stroke-width="${sw}"/>` +
    `<line x1="${c - r}" y1="${c}" x2="${c - hub}" y2="${c}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${c + hub}" y1="${c}" x2="${c + r}" y2="${c}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>` +
    `<line x1="${c}" y1="${c + hub}" x2="${c}" y2="${c + r}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'plugin'), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'index.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: path.join(OUT, 'plugin', 'index.js'),
    legalComments: 'none',
    logLevel: 'warning',
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pkg', 'manifest.json'), 'utf8'));
  manifest.Version = pkg.version;
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  copy(path.join(ROOT, 'pkg', 'en.json'), path.join(OUT, 'en.json'));
  copy(path.join(ROOT, 'pkg', 'pi', 'index.html'), path.join(OUT, 'pi', 'index.html'));
  fs.mkdirSync(path.join(OUT, 'static', 'actions'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'static', 'keys'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'static', 'plugin.png'), toPng(iconSvg(144)));
  fs.writeFileSync(path.join(OUT, 'static', 'category.png'), toPng(iconSvg(56)));
  fs.writeFileSync(path.join(OUT, 'static', 'actions', 'mode.png'), toPng(iconSvg(72)));
  fs.writeFileSync(path.join(OUT, 'static', 'keys', 'mode.png'), toPng(keys.render({ state: 'checking' })));
  const size = fs.statSync(path.join(OUT, 'plugin', 'index.js')).size;
  console.log(`Built ${OUT} (plugin/index.js ${Math.round(size / 1024)} KB)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
