'use strict';
// node tools/build.js [--zip]
// Bundles the plugin into one file (plugin/index.js) with esbuild, copies the rest and, with --zip,
// writes dist/iCUE-Battery-<version>-build.zip (ready to install) and ...-source.zip.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const ID = 'com.clarkyau.icuebattery.sdPlugin';
const out = path.join(root, 'build', ID);
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).Version;

fs.rmSync(path.join(root, 'build'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'plugin'), { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'plugin', 'index.js')],
  outfile: path.join(out, 'plugin', 'index.js'),
  bundle: true, platform: 'node', target: 'node20', format: 'cjs', legalComments: 'none',
});

function copy(rel) {
  const from = path.join(root, rel), to = path.join(out, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}
['manifest.json', 'en.json', 'pi', 'static', 'runtime/helper.ps1', 'runtime/Helper.cs', 'runtime/Tray.cs', 'runtime/iCUESDK.x64_2019.dll'].forEach(copy);
console.log('built', out);

if (process.argv.includes('--zip')) {
  const dist = path.join(root, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  // build zip: installer files next to the plugin folder
  const stage = path.join(root, 'build', 'stage');
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync(out, path.join(stage, ID), { recursive: true });
  ['install.bat', 'install.ps1', 'uninstall.bat', 'uninstall.ps1', 'INSTALL.txt'].forEach((f) => fs.copyFileSync(path.join(root, 'installer', f), path.join(stage, f)));
  const buildZip = path.join(dist, 'iCUE-Battery-' + version + '-build.zip');
  execFileSync('zip', ['-qr', buildZip, '.'], { cwd: stage });
  // source zip
  const srcZip = path.join(dist, 'iCUE-Battery-' + version + '-source.zip');
  execFileSync('zip', ['-qr', srcZip, '.', '-x', 'node_modules/*', 'build/*', 'dist/*', 'test/out/*', '.git/*'], { cwd: root });
  console.log('zips in', dist);
}
