'use strict';
// node tools/build.js          -> build/<id>.sdPlugin + installer files in build/pkg
// node tools/build.js --zip    -> also out/<name>-<version>-build.zip and -source.zip
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ID = pkg.name;
const NAME = manifest.Name;
const VERSION = pkg.version;
const pkgDir = path.join(root, 'build', 'pkg');
const plugDir = path.join(pkgDir, ID + '.sdPlugin');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function sub(text) { return text.split('__ID__').join(ID).split('__NAME__').join(NAME).split('__VERSION__').join(VERSION); }
function crlf(text) { return text.replace(/\r?\n/g, '\r\n'); }

async function main() {
  if (manifest.Actions[0].UUID.indexOf(ID + '.') !== 0) throw new Error('package.json name and manifest action ids do not match: ' + ID);
  rmrf(path.join(root, 'build'));
  mkdir(path.join(plugDir, 'plugin'));
  mkdir(path.join(plugDir, 'pi'));

  // 1. the single index.js (wasm + fonts packed inside)
  await esbuild.build({
    entryPoints: [path.join(root, 'src/plugin/index.js')],
    outfile: path.join(plugDir, 'plugin/index.js'),
    bundle: true, platform: 'node', target: 'node20', format: 'cjs', legalComments: 'none',
    loader: { '.wasm': 'binary', '.ttf': 'binary' },
    define: { __PLUGIN_ID__: JSON.stringify(ID), __PLUGIN_NAME__: JSON.stringify(NAME), __VERSION__: JSON.stringify(VERSION) },
    logLevel: 'warning'
  });

  // 2. manifest (version comes from package.json), language file, settings panel
  const m = JSON.parse(JSON.stringify(manifest));
  m.Version = VERSION;
  fs.writeFileSync(path.join(plugDir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  fs.copyFileSync(path.join(root, 'src/en.json'), path.join(plugDir, 'en.json'));
  fs.writeFileSync(path.join(plugDir, 'pi/index.html'), sub(fs.readFileSync(path.join(root, 'src/pi/index.html'), 'utf8')));

  // 3. icons
  await require('./make-icons').make(plugDir);

  // 4. installer files next to the plugin folder (.ps1 and .bat: ASCII, CRLF)
  const inst = path.join(root, 'src/installer');
  fs.writeFileSync(path.join(pkgDir, 'install.ps1'), crlf(sub(fs.readFileSync(path.join(inst, 'install.ps1'), 'utf8'))));
  fs.writeFileSync(path.join(pkgDir, 'install.bat'), crlf(sub(fs.readFileSync(path.join(inst, 'install.bat'), 'utf8'))));
  fs.writeFileSync(path.join(pkgDir, 'uninstall.bat'), crlf(sub(fs.readFileSync(path.join(inst, 'uninstall.bat'), 'utf8'))));
  fs.writeFileSync(path.join(pkgDir, 'README.txt'), crlf(sub(fs.readFileSync(path.join(inst, 'README-USER.txt'), 'utf8'))));

  const size = fs.statSync(path.join(plugDir, 'plugin/index.js')).size;
  console.log('Built ' + ID + ' ' + VERSION + ' (index.js ' + Math.round(size / 1024) + ' KB) in build/pkg');

  if (process.argv.indexOf('--zip') >= 0) zip();
}

function zip() {
  const out = path.join(root, 'out');
  mkdir(out);
  const base = NAME.replace(/[^A-Za-z0-9]+/g, '') + '-' + VERSION;
  const buildZip = path.join(out, base + '-build.zip');
  const srcZip = path.join(out, base + '-source.zip');
  rmrf(buildZip); rmrf(srcZip);
  execFileSync('zip', ['-qr', buildZip, '.'], { cwd: pkgDir });
  const include = ['src', 'tools', 'test', 'package.json', 'package-lock.json', 'README.md'].filter((p) => fs.existsSync(path.join(root, p)));
  execFileSync('zip', ['-qr', srcZip].concat(include, ['-x', 'test/out/*', '*/node_modules/*']), { cwd: root });
  console.log(execFileSync('unzip', ['-l', buildZip]).toString().split('\n').slice(0, 40).join('\n'));
  console.log('Wrote ' + path.relative(root, buildZip) + ' and ' + path.relative(root, srcZip));
}

main().catch((e) => { console.error(e); process.exit(1); });
