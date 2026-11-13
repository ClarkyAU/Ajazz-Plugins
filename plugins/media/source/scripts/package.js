// Makes dist/NowPlaying (plugin + installer) and the two zips:
//   dist/NowPlaying-build.zip   ready to install (extract, run install.bat)
//   dist/NowPlaying-source.zip  this project without node_modules / dist
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(dist, 'NowPlaying');
const name = 'com.clarkyau.nowplaying.sdPlugin';
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'plugin', name), path.join(out, name), {
  recursive: true, filter: (src) => !/plugin\.log|migration-backup/.test(src)
});
for (const f of ['install.bat', 'uninstall.bat', 'install.ps1']) fs.copyFileSync(path.join(root, 'installer', f), path.join(out, f));
const readme = fs.readFileSync(path.join(out, name, 'README.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
fs.writeFileSync(path.join(out, 'README.txt'), readme);

function zip(target, cwd, entries, exclude = []) {
  if (process.platform === 'win32') {
    const list = entries.map((e) => `'${path.join(cwd, e)}'`).join(',');
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path ${list} -DestinationPath '${target}' -Force`], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-qr', target, ...entries, ...exclude.flatMap((x) => ['-x', x])], { cwd, stdio: 'inherit' });
  }
}
zip(path.join(dist, 'NowPlaying-build.zip'), dist, ['NowPlaying']);
zip(path.join(dist, 'NowPlaying-source.zip'), path.dirname(root), [path.basename(root)], [
  `${path.basename(root)}/node_modules/*`, `${path.basename(root)}/dist/*`, `${path.basename(root)}/test/out/*`,
  `${path.basename(root)}/plugin/${name}/plugin/index.js`, `${path.basename(root)}/plugin/${name}/plugin.log*`
]);
console.log('Created dist/NowPlaying-build.zip and dist/NowPlaying-source.zip');
