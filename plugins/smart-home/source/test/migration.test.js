'use strict';
// Moving over from the old plugin (dev.smarthome.tuya) to com.clarkyau.smarthome:
//  1. the old folder runs the handover code (plugin/bridge.js): it reads the
//     old saved account details from the software and passes them on,
//  2. the new plugin imports them into its own settings, upgrades old key
//     settings, keeps the device list, and removes the old folder.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FakeHost } = require('./fake-host');
const { check, summary, waitFor, sleep } = require('./helpers');

const DIST = path.join(__dirname, '..', 'dist', 'com.clarkyau.smarthome.sdPlugin');
const OLD_GLOBALS = {
  accessId: 'oldaccessid5678', accessSecret: 'oldsecretabcdef0123456789', region: 'eu',
  onColor: '#5fd38d', style: 'flat', showNames: 'on', showPower: 'on', gap: 20, keyLayout: 'auto',
};
const DEVICES = {
  savedAt: 1, refreshedAt: 1, region: 'eu',
  devices: [{ id: 'bf58b0e715109a7165test', name: 'Cockpit', key: '0123456789abcdef', category: 'cz', product: 'PC191HA', model: '', kind: 'plug',
    switches: [{ dp: '1', code: 'switch_1', label: 'Outlet 1' }], light: null, power: { dp: '19', scale: 1, unit: 'W' },
    cloudCodes: { 1: 'switch_1', 19: 'cur_power' }, sub: false, ip: '127.0.0.99', version: '3.3' }],
};

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

(async () => {
  console.log(`Running on Node ${process.version}`);
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  const oldDir = path.join(plugins, 'dev.smarthome.tuya.sdPlugin');
  const newDir = path.join(plugins, 'com.clarkyau.smarthome.sdPlugin');
  // old plugin as installed, with its code swapped for the handover (what the installer does)
  fs.mkdirSync(path.join(oldDir, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'manifest.json'), JSON.stringify({ Name: 'Smart Home', Actions: [{ UUID: 'dev.smarthome.tuya.switch' }, { UUID: 'dev.smarthome.tuya.power' }] }));
  fs.writeFileSync(path.join(oldDir, 'devices.json'), JSON.stringify(DEVICES));
  fs.copyFileSync(path.join(DIST, 'plugin', 'bridge.js'), path.join(oldDir, 'plugin', 'index.js'));
  fs.writeFileSync(path.join(oldDir, 'MOVED.txt'), 'moved');
  copyDir(DIST, newDir);

  const env = { TUYA_CLOUD_BASE: 'http://127.0.0.1:9' }; // no cloud reachable
  const oldHost = new FakeHost({ globals: OLD_GLOBALS, script: path.join(oldDir, 'plugin', 'index.js'), prefix: 'dev.smarthome.tuya.', pluginDir: oldDir, env });
  let newHost = null;
  try {
    await oldHost.start();
    oldHost.addKey('old-key', 'switch', 4, 1, { deviceId: 'bf58b0e715109a7165test', label: 'Cockpit' });
    const handed = await waitFor(() => fs.existsSync(path.join(newDir, 'import-settings.json')), 5000);
    check('old plugin hands its saved details to the new plugin', handed);
    check('old plugin copies the device list across', fs.existsSync(path.join(newDir, 'devices.json')));
    await waitFor(() => oldHost.images.get('old-key'), 3000);
    check('an old key left behind shows "Moved"', /Moved/.test(decodeURIComponent(oldHost.images.get('old-key') || '')), oldHost.images.get('old-key'));
    check('the "Moved" picture passes the quirk checks (no # or %)', oldHost.problems.length === 0, oldHost.problems);
    const hlog = fs.readFileSync(path.join(oldDir, 'handover.log'), 'utf8');
    check('handover log has no secrets', !hlog.includes(OLD_GLOBALS.accessSecret) && !hlog.includes(OLD_GLOBALS.accessId), hlog);
    await oldHost.stop();

    // new plugin starts with no settings of its own
    newHost = new FakeHost({ globals: {}, script: path.join(newDir, 'plugin', 'index.js'), pluginDir: newDir, env });
    await newHost.start();
    // a key moved over by the profile update keeps its old settings
    newHost.addKey('k1', 'switch', 4, 1, { color: '', deviceId: 'bf58b0e715109a7165test', dp: '', icon: 'auto', label: 'Cockpit', press: 'none' });
    newHost.addKey('k2', 'power', 1, 1, { color: '', deviceId: 'bf58b0e715109a7165test', dp: '', icon: 'auto', label: '', press: 'none' });
    const imported = await waitFor(() => newHost.globals.accessId === OLD_GLOBALS.accessId && newHost.globals.accessSecret === OLD_GLOBALS.accessSecret, 8000);
    check('new plugin saves the imported account details as its own', imported, Object.keys(newHost.globals));
    check('import file is removed after use', !fs.existsSync(path.join(newDir, 'import-settings.json')));
    const s1 = newHost.settings.get('k1');
    check('old key settings are upgraded (device, name kept)', s1 && s1.v === 2 && s1.deviceId === 'bf58b0e715109a7165test' && s1.label === 'Cockpit', s1);
    await waitFor(() => newHost.settings.get('k1').style === 'flat', 4000);
    const s1b = newHost.settings.get('k1');
    check('old look settings carry over per key (flat, green)', s1b.style === 'flat' && s1b.color === '#5fd38d', s1b);
    check('the old plugin folder is removed', await waitFor(() => !fs.existsSync(oldDir), 6000));
    await waitFor(() => newHost.textOf('k1'), 4000);
    check('moved keys show the device straight away (from the saved list)', /Cockpit|Looking|Connecting|Offline/.test(newHost.textOf('k1')), newHost.textOf('k1'));
    const log = newHost.log();
    check('log says it imported, without the secret', /imported the account details/.test(log) && !log.includes(OLD_GLOBALS.accessSecret) && !log.includes(OLD_GLOBALS.accessId), log.split('\n').slice(-8));
    check('no image problems', newHost.problems.length === 0, newHost.problems.slice(0, 5));
  } catch (e) {
    check('no crash', false, e.stack);
  } finally {
    await oldHost.stop().catch(() => {});
    if (newHost) await newHost.stop().catch(() => {});
  }
  await sleep(100);
  process.exit(summary() ? 0 : 1);
})();
