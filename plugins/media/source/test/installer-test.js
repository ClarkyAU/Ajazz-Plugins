'use strict';
// Runs installer/install.ps1 (needs PowerShell: set PWSH=/path/to/pwsh) against
// a pretend Stream Dock folder holding a copy of a real profile with old keys,
// and checks the result matches the tested Node migration (src/migrate.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { migrateProfile } = require('../src/migrate');

const ROOT = path.resolve(__dirname, '..');
const PWSH = process.env.PWSH || 'pwsh';
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failures++; };

const OLD = { textStyle: 'stacked', textSize: 'large', scrollSpeed: 'normal', titleColor: '#ffffff', artistColor: '#b4b4c0', textBackground: 'tinted', artGap: 20, artPress: 'none', controlColor: 'art', customColor: '#7888ff', controlStyle: 'glow', keyLayout: 'auto' };

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'np-install-'));
  const sd = path.join(base, 'StreamDock');
  const plugins = path.join(sd, 'plugins');
  const music = path.join(sd, 'profiles', 'Y4H3TLL8-YJOQ-0305-27IJ-HRWC82WPU1II.sdProfile');
  const other = path.join(sd, 'profiles', 'OTHER000-0000-0000-0000-000000000000.sdProfile');
  fs.mkdirSync(music, { recursive: true }); fs.mkdirSync(other, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'music-profile.json'), path.join(music, 'manifest.json'));
  fs.writeFileSync(path.join(other, 'manifest.json'), JSON.stringify({ Name: 'Other', Actions: { '0,0': { UUID: 'com.example.x', Settings: { a: 1 } } } }, null, 4));
  const old = path.join(plugins, 'dev.nowplaying.deck.sdPlugin');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'manifest.json'), JSON.stringify({ Actions: [{ UUID: 'dev.nowplaying.deck.art' }] }));
  fs.writeFileSync(path.join(old, 'nowplaying.log'), `2026-10-18T10:00:00.000Z settings {"textSize":"small"}\n2026-10-18T10:21:36.874Z settings ${JSON.stringify(OLD)}\n`);
  // the package as users get it
  const pkg = path.join(base, 'NowPlaying');
  fs.mkdirSync(pkg);
  fs.cpSync(path.join(ROOT, 'plugin', 'com.clarkyau.nowplaying.sdPlugin'), path.join(pkg, 'com.clarkyau.nowplaying.sdPlugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'installer', 'install.ps1'), path.join(pkg, 'install.ps1'));
  return { base, plugins, music, other, pkg, old };
}

const run = (pkg, plugins, extra = []) =>
  execFileSync(PWSH, ['-NoProfile', '-File', path.join(pkg, 'install.ps1'), '-PluginsDir', plugins, '-NoRestart', '-Yes', ...extra], { encoding: 'utf8' });

console.log('Installer (PowerShell)');
const t = setup();
const before = JSON.parse(fs.readFileSync(path.join(t.music, 'manifest.json'), 'utf8'));
const otherBefore = fs.readFileSync(path.join(t.other, 'manifest.json'), 'utf8');
const out = run(t.pkg, t.plugins);
const after = JSON.parse(fs.readFileSync(path.join(t.music, 'manifest.json'), 'utf8'));
const expected = migrateProfile(before, OLD).manifest;
check(fs.existsSync(path.join(t.plugins, 'com.clarkyau.nowplaying.sdPlugin', 'plugin', 'index.js')), 'plugin copied into the plugins folder');
check(!fs.existsSync(t.old), 'previous version removed');
check(/Moved 14 key/.test(out), 'reports 14 keys moved (original v1 page)');
let same = true;
for (const [pos, a] of Object.entries(expected.Actions)) {
  const b = after.Actions[pos];
  const pick = (x) => JSON.stringify({ UUID: x.UUID, Name: x.Name, ActionID: x.ActionID, Controller: x.Controller, Settings: x.Settings, States: x.States });
  if (pick(a) !== pick(b)) { same = false; console.log('    differs at', pos, pick(a), '\n             vs', pick(b)); }
}
check(same, 'every key matches the tested Node migration (positions, IDs, settings)');
check(!JSON.stringify(after).includes('dev.nowplaying.deck'), 'no old keys left on the page');
check(fs.readFileSync(path.join(t.other, 'manifest.json'), 'utf8') === otherBefore, 'pages without old keys are untouched');
const backup = path.join(t.plugins, 'com.clarkyau.nowplaying.sdPlugin', 'migration-backup', 'Y4H3TLL8-YJOQ-0305-27IJ-HRWC82WPU1II.sdProfile', 'manifest.json');
check(fs.existsSync(backup) && JSON.stringify(JSON.parse(fs.readFileSync(backup, 'utf8'))) === JSON.stringify(before), 'original page backed up');
const raw = fs.readFileSync(path.join(t.music, 'manifest.json'));
check(raw[0] !== 0xef, 'page saved without a byte-order mark');
// running again (update) keeps everything
run(t.pkg, t.plugins);
check(fs.existsSync(backup), 'updating keeps the migration backup');
check(JSON.stringify(JSON.parse(fs.readFileSync(path.join(t.music, 'manifest.json'), 'utf8'))) === JSON.stringify(after), 'updating leaves keys and settings alone');
run(t.pkg, t.plugins, ['-Uninstall']);
check(!fs.existsSync(path.join(t.plugins, 'com.clarkyau.nowplaying.sdPlugin')), 'uninstall removes the plugin');
// v2 page (one "Now Playing" action) -> separate actions
const t2 = setup();
fs.rmSync(t2.old, { recursive: true, force: true });
fs.copyFileSync(path.join(__dirname, 'fixtures', 'music-profile-v2.json'), path.join(t2.music, 'manifest.json'));
const before2 = JSON.parse(fs.readFileSync(path.join(t2.music, 'manifest.json'), 'utf8'));
const out2 = run(t2.pkg, t2.plugins);
const after2 = JSON.parse(fs.readFileSync(path.join(t2.music, 'manifest.json'), 'utf8'));
const expected2 = migrateProfile(before2, null).manifest;
let same2 = true;
for (const [pos, a] of Object.entries(expected2.Actions)) {
  const b = after2.Actions[pos];
  const pick = (x) => JSON.stringify({ UUID: x.UUID, Name: x.Name, ActionID: x.ActionID, Settings: x.Settings, States: x.States });
  if (pick(a) !== pick(b)) { same2 = false; console.log('    differs at', pos, pick(a), '\n             vs', pick(b)); }
}
check(/Moved 9 key/.test(out2) && same2, 'current v2 page: 9 keys become Album Art / Track Info / Time / Progress Bar, same as the Node migration');
console.log(failures ? `${failures} installer check(s) FAILED` : 'All installer checks passed');
process.exit(failures ? 1 : 0);
