// Builds the plugin into build/com.clarkyau.mouseinfo.sdPlugin and makes the two zips in dist/.
//   node tools/build.js          build only
//   node tools/build.js --zip    build + dist/MouseInfo-<version>-install.zip and -source.zip
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.join(root, 'build', 'com.clarkyau.mouseinfo.sdPlugin');
fs.rmSync(path.join(root, 'build'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'plugin'), { recursive: true });
require('esbuild').buildSync({ entryPoints: [path.join(root, 'src', 'index.js')], bundle: true, platform: 'node', target: 'node20', outfile: path.join(out, 'plugin', 'index.js'), logLevel: 'warning' });
for (const f of ['manifest.json', 'en.json']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, 'pi'), path.join(out, 'pi'), { recursive: true });
fs.mkdirSync(path.join(out, 'runtime'));
for (const f of ['Listener.cs', 'listener.ps1']) {
  // Windows PowerShell 5.1 reads scripts without a BOM as ANSI; keep them pure ASCII.
  const txt = fs.readFileSync(path.join(root, 'runtime', f), 'utf8');
  if (/[^\x00-\x7f]/.test(txt)) throw new Error(f + ' must be ASCII only');
  fs.writeFileSync(path.join(out, 'runtime', f), txt.replace(/\r?\n/g, '\r\n'));
}
execSync('node ' + JSON.stringify(path.join(root, 'tools', 'icons.js')) + ' ' + JSON.stringify(path.join(out, 'static')), { stdio: 'inherit' });
console.log('Built ' + manifest.Version + ' -> ' + out);

if (process.argv.includes('--zip')) {
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const stage = path.join(root, 'build', 'zip');
  fs.mkdirSync(stage, { recursive: true });
  for (const f of ['install.bat', 'uninstall.bat', 'install.ps1']) {
    fs.writeFileSync(path.join(stage, f), fs.readFileSync(path.join(root, 'installer', f), 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  fs.cpSync(out, path.join(stage, path.basename(out)), { recursive: true });
  const z1 = path.join(dist, 'MouseInfo-' + manifest.Version + '-install.zip');
  const z2 = path.join(dist, 'MouseInfo-' + manifest.Version + '-source.zip');
  for (const z of [z1, z2]) fs.rmSync(z, { force: true });
  execSync('cd ' + JSON.stringify(stage) + ' && zip -qr ' + JSON.stringify(z1) + ' .');
  execSync('cd ' + JSON.stringify(root) + ' && zip -qr ' + JSON.stringify(z2) + ' README.md package.json package-lock.json manifest.json en.json src pi runtime installer tools test -x "test/out/*"');
  console.log('Zips: ' + z1 + '\n      ' + z2);
}
