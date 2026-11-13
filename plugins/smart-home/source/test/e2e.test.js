'use strict';
// End-to-end: the built plugin, run by a fake Ajazz host on the same Node
// version as the software (20.8.1), talking to simulated Tuya devices
// (tinytuya-based) and a fake Tuya cloud. Every key image is checked
// automatically (see image-check.js). Writes deck previews to test/previews/.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { FakeHost } = require('./fake-host');
const { deckPng } = require('./deck');
const { check, summary, sleep, waitFor, startSim } = require('./helpers');

const PREVIEW_DIR = path.join(__dirname, 'previews');
const CLOUD_PORT = 18123;
const CREDS = { accessId: 'testaccessid1234', accessSecret: 'testsecret0987654321abcdef' };

const PLUG = { id: 'bf3a1c2d3e4f5a6b7c8d01', key: '0123456789abcdef', ip: '127.0.0.21', version: '3.3', dps: { 1: false, 18: 0, 19: 0, 20: 2398 } };
const LAMP = { id: 'bfaabbccddeeff00112201', key: 'A1b2C3d4E5f6G7h8', ip: '127.0.0.22', version: '3.5', dps: { 20: true, 21: 'white', 22: 600, 23: 150, 24: '00f003e803e8' } };
const BOARD = { id: 'bf99887766554433221101', key: 'qwertyuiopasdfgh', ip: '127.0.0.23', version: '3.4', dps: { 1: true, 2: false, 3: false, 4: false, 7: false } };
const GARAGE = { id: 'bf55667788990011223301', key: 'mnbvcxzlkjhgfdsa', ip: '127.0.0.24', version: '3.4', dps: { 1: false }, silent: true };

const spec = (fns) => ({ functions: fns.map(([code, dp, type, values]) => ({ code, dp_id: dp, type, values: JSON.stringify(values || {}) })), status: [] });
const CLOUD_DEVICES = [
  { id: PLUG.id, name: 'Racing Cockpit', local_key: PLUG.key, category: 'cz', product_name: 'PC191HA', online: true,
    spec: spec([['switch_1', 1, 'Boolean'], ['cur_current', 18, 'Integer', { unit: 'mA', scale: 0 }], ['cur_power', 19, 'Integer', { unit: 'W', scale: 1 }], ['cur_voltage', 20, 'Integer', { unit: 'V', scale: 1 }]]) },
  { id: LAMP.id, name: 'Lounge Lamp', local_key: LAMP.key, category: 'dj', product_name: 'Smart Bulb', online: true,
    spec: spec([['switch_led', 20, 'Boolean'], ['work_mode', 21, 'Enum'], ['bright_value_v2', 22, 'Integer', { min: 10, max: 1000 }], ['temp_value_v2', 23, 'Integer', { min: 0, max: 1000 }], ['colour_data_v2', 24, 'Json']]) },
  { id: BOARD.id, name: 'Desk Board', local_key: BOARD.key, category: 'pc', product_name: 'Powerboard', online: true,
    spec: spec([['switch_1', 1, 'Boolean'], ['switch_2', 2, 'Boolean'], ['switch_3', 3, 'Boolean'], ['switch_4', 4, 'Boolean'], ['switch_usb1', 7, 'Boolean']]) },
  { id: GARAGE.id, name: 'Garage Heater', local_key: GARAGE.key, category: 'kg', product_name: 'Wall Switch', online: true,
    spec: spec([['switch_1', 1, 'Boolean']]) },
];

function startCloud() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2ecloud-')), 'd.json');
  fs.writeFileSync(file, JSON.stringify(CLOUD_DEVICES));
  const proc = spawn('python3', [path.join(__dirname, 'sim', 'fake_cloud.py'), String(CLOUD_PORT), CREDS.accessId, CREDS.accessSecret, file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const reqs = [];
  let buf = '';
  proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { reqs.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  return { reqs, stop: () => proc.kill() };
}

const lastPanel = (host) => [...host.toPI].reverse().find((p) => p.type === 'state');
const viewX = (svg) => { const m = /viewBox="([-\d.]+) /.exec(svg || ''); return m ? Number(m[1]) : null; };
const controlFor = (sim, id, test) => sim.events.find((e) => e.event === 'control' && e.id === id && test(e.dps));

async function main() {
  console.log(`Running on Node ${process.version}`);
  check('tests run on the same Node as the Ajazz software (20.8.1)', process.version === 'v20.8.1', process.version);
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  for (const f of fs.readdirSync(PREVIEW_DIR)) fs.unlinkSync(path.join(PREVIEW_DIR, f));
  const sim = startSim([PLUG, LAMP, BOARD, GARAGE]);
  const cloud = startCloud();
  const env = { TUYA_CLOUD_BASE: `http://127.0.0.1:${CLOUD_PORT}`, TUYA_SCAN_HOSTS: '127.0.0.24,127.0.0.30' };
  let host = new FakeHost({ globals: {}, env });
  try {
    check('simulated devices started', await sim.ready());
    await host.start();

    // ---- A: nothing set up
    host.addKey('k-sw-a', 'switch', 0, 0, {});
    await waitFor(() => host.textOf('k-sw-a'), 5000);
    check('without a Setup key, keys say "Add the Setup key"', /Add the/.test(host.textOf('k-sw-a')) && /Setup key/.test(host.textOf('k-sw-a')), host.textOf('k-sw-a'));
    host.addKey('k-setup', 'setup', 5, 0, {});
    await waitFor(() => /Finish the/.test(host.textOf('k-sw-a')), 4000);
    check('with a Setup key on the deck, keys say "Finish the Setup key"', /Finish the/.test(host.textOf('k-sw-a')), host.textOf('k-sw-a'));
    await waitFor(() => /Set up/.test(host.textOf('k-setup')), 3000);
    check('Setup key says it needs setting up', /Set up/.test(host.textOf('k-setup')), host.textOf('k-setup'));
    host.press('k-setup');
    check('pressing the Setup key before setup opens the Tuya site', await waitFor(() => host.openUrls.includes('https://iot.tuya.com/'), 2000), host.openUrls);
    host.openPanel('k-setup');
    host.fromPanel('k-setup', { type: 'hello' });
    const p0 = await waitFor(() => lastPanel(host), 3000);
    check('Setup panel is told there is no account yet', p0 && p0.hasCreds === false && p0.setupVisible === true, p0);
    await deckPng(host.deckImages(), path.join(PREVIEW_DIR, '1-first-run.png'), { title: 'First run: Setup key on the side screen, a Switch key waiting' });

    // ---- B: account entered on the Setup key
    const G = { ...CREDS, region: 'auto', keyLayout: 'auto' };
    host.fromPanel('k-setup', { type: 'globals', settings: G });
    host.globals = G;
    const p1 = await waitFor(() => { const p = lastPanel(host); return p && p.devices.length === 4 && p.account.state === 'ok' ? p : null; }, 15000);
    check('signs in to the (fake) Tuya cloud and lists 4 devices', p1, lastPanel(host));
    check('all cloud requests were signed correctly', cloud.reqs.length > 4 && cloud.reqs.every((r) => r.sign_ok), cloud.reqs.filter((r) => !r.sign_ok));
    await waitFor(() => /Connected/.test(host.textOf('k-setup')), 3000);
    check('Setup key shows "Connected" and the device count', /Connected/.test(host.textOf('k-setup')) && /4 devices/.test(host.textOf('k-setup')), host.textOf('k-setup'));
    await waitFor(() => /Pick a device/.test(host.textOf('k-sw-a')), 3000);
    check('a key with no device asks for one', /Pick a device/.test(host.textOf('k-sw-a')), host.textOf('k-sw-a'));
    host.removeKey('k-sw-a');

    // ---- C: the full layout (main keys + side screen)
    const add = (ctx, action, col, row, s) => host.addKey(ctx, action, col, row, { v: 2, join: true, show: 'auto', style: 'glow', ...s });
    // row 1: wide Cockpit switch (button, name, watts) + Power Use (watts + graph)
    add('sw1', 'switch', 0, 0, { deviceId: PLUG.id, label: 'Racing Cockpit' });
    add('sw2', 'switch', 1, 0, { deviceId: PLUG.id, label: 'Racing Cockpit' });
    add('sw3', 'switch', 2, 0, { deviceId: PLUG.id, label: 'Racing Cockpit' });
    add('pw1', 'power', 3, 0, { deviceId: PLUG.id });
    add('pw2', 'power', 4, 0, { deviceId: PLUG.id });
    // row 2: brightness (level + 2-key slider), lamp, monitor outlet
    add('br1', 'brightness', 0, 1, { deviceId: LAMP.id });
    add('br2', 'brightness', 1, 1, { deviceId: LAMP.id });
    add('br3', 'brightness', 2, 1, { deviceId: LAMP.id });
    add('lamp', 'light', 3, 1, { deviceId: LAMP.id });
    add('mon', 'switch', 4, 1, { deviceId: BOARD.id, dp: '2', label: 'Monitor', icon: 'power' });
    // row 3: board shows On/Off, garage stands alone, 2-key graph, cockpit next to the side screen
    add('board', 'switch', 0, 2, { deviceId: BOARD.id, dp: '1', show: 'state', label: 'Desk' });
    add('garage', 'switch', 1, 2, { deviceId: GARAGE.id, join: false });
    add('g1', 'power', 2, 2, { deviceId: PLUG.id, show: 'graph' });
    add('g2', 'power', 3, 2, { deviceId: PLUG.id, show: 'graph' });
    add('edge', 'switch', 4, 2, { deviceId: PLUG.id, label: 'Cockpit' });
    // side screen
    add('side-dev', 'setup', 5, 1, { show: 'devices' });
    add('side-sw', 'switch', 5, 2, { deviceId: PLUG.id, label: 'Cockpit' });

    const linked = await waitFor(() => {
      host.fromPanel('k-setup', { type: 'hello' });
      const p = lastPanel(host);
      if (!p) return null;
      const by = Object.fromEntries(p.devices.map((d) => [d.name, d]));
      return ['Racing Cockpit', 'Lounge Lamp', 'Desk Board'].every((n) => by[n] && by[n].link === 'local') ? by : null;
    }, 20000, 400);
    check('finds the 3.3, 3.4 and 3.5 devices on the home network', linked, lastPanel(host) && lastPanel(host).devices.map((d) => [d.name, d.link]));
    await sleep(800);

    // automatic layout
    check('wide switch: key 2 shows the name', /Racing/.test(host.textOf('sw2')) && !/W$/.test(host.textOf('sw2')), host.textOf('sw2'));
    check('wide switch: key 3 shows watts (plug has a meter)', /watts/.test(host.textOf('sw3')), host.textOf('sw3'));
    check('joined keys don\'t repeat the name shown next to them', /^Off$|^On$/.test(host.textOf('sw1')) && !/Racing/.test(host.textOf('sw3')), [host.textOf('sw1'), host.textOf('sw3')]);
    check('Power Use pair: watts then graph', /watts/.test(host.textOf('pw1')) && /Peak|Graph starting/.test(host.textOf('pw2')), [host.textOf('pw1'), host.textOf('pw2')]);
    check('Brightness: level key then a 2-key slider (50%, 100%)', /60%/.test(host.textOf('br1')) && /50%/.test(host.textOf('br2')) && /100%/.test(host.textOf('br3')), [host.textOf('br1'), host.textOf('br2'), host.textOf('br3')]);
    check('slider keys share one graphic (second key is the next window)', viewX(host.svgs.get('br3')) === 172, viewX(host.svgs.get('br3')));
    check('chosen "On / Off" display works', /ON|OFF/.test(host.textOf('board')), host.textOf('board'));
    check('"Stand alone" key does not join its neighbour', /Garage Heater/.test(host.textOf('garage')), host.textOf('garage'));
    check('two neighbouring Graph keys share one graph', viewX(host.svgs.get('g2')) === 172, viewX(host.svgs.get('g2')));
    check('main keys and the side screen never join', /Cockpit/.test(host.textOf('edge')) && /Cockpit/.test(host.textOf('side-sw')) && viewX(host.svgs.get('side-sw')) === 0, [host.textOf('edge'), host.textOf('side-sw')]);
    check('Setup key set to "Devices" shows the count', /Devices/.test(host.textOf('side-dev')) && /\b4\b/.test(host.textOf('side-dev')), host.textOf('side-dev'));

    // ---- D: presses
    host.press('sw2');
    check('pressing the name key of the wide switch turns the plug on', await waitFor(() => controlFor(sim, PLUG.id, (d) => d['1'] === true), 4000));
    for (const w of [0, 35.5, 82.1, 118.4, 121.0, 96.3, 140.2, 118.4]) { sim.send({ id: PLUG.id, dps: { 19: Math.round(w * 10) } }); await sleep(450); }
    await sleep(2500);
    check('watts update from the plug', /118/.test(host.textOf('sw3')) && /118/.test(host.textOf('pw1')), [host.textOf('sw3'), host.textOf('pw1')]);
    await deckPng(host.deckImages(), path.join(PREVIEW_DIR, '2-whole-deck-on.png'), { title: 'Whole deck: Racing Cockpit on, lamp at 60%', caption: 'Row 1 switch + power · Row 2 brightness, lamp, monitor · Row 3 On/Off, garage, graph, cockpit · Side: Setup, devices, cockpit' });

    sim.events.length = 0;
    host.press('br2');
    const b50 = await waitFor(() => controlFor(sim, LAMP.id, (d) => d['22'] !== undefined), 4000);
    check('slider key 1 of 2 sets 50%', b50 && Math.abs(b50.dps['22'] - 500) <= 12, b50 && b50.dps);
    sim.events.length = 0;
    host.press('br1');
    const step = await waitFor(() => controlFor(sim, LAMP.id, (d) => d['22'] !== undefined), 4000);
    check('level key steps the brightness up', step && step.dps['22'] > 500, step && step.dps);
    host.press('mon');
    check('Monitor key switches outlet 2 of the power board', await waitFor(() => controlFor(sim, BOARD.id, (d) => d['2'] === true), 4000));
    host.press('lamp');
    check('Light key turns the lamp off', await waitFor(() => controlFor(sim, LAMP.id, (d) => d['20'] === false), 4000));

    sim.send({ id: PLUG.id, dps: { 1: false, 19: 0 } });
    check('switching it off elsewhere (Google Home) updates the keys', await waitFor(() => /OFF|Off/.test(host.textOf('board')) || /\b0\b/.test(host.textOf('pw1')), 4000));
    sim.send({ id: LAMP.id, dps: { 20: true, 21: 'colour', 24: '00d203e802bc' } });
    const garage = await waitFor(() => {
      host.fromPanel('k-setup', { type: 'hello' });
      const d = (lastPanel(host) || { devices: [] }).devices.find((x) => x.name === 'Garage Heater');
      return d && d.link === 'local' ? d : null;
    }, 45000, 1000);
    check('a device that never broadcasts is found by scanning the network', garage);
    await sleep(1000);
    await deckPng(host.deckImages(), path.join(PREVIEW_DIR, '3-whole-deck-mixed.png'), { title: 'Cockpit off, lamp blue, monitor outlet on' });

    // per-key look: flat + custom colour on one key, names only on another
    host.setKeySettings('mon', { v: 2, deviceId: BOARD.id, dp: '2', label: 'Monitor', icon: 'power', show: 'icon', join: true, style: 'flat', color: '#5fd38d' });
    host.setKeySettings('lamp', { v: 2, deviceId: LAMP.id, show: 'level', join: true, style: 'glow' });
    await sleep(1000);
    check('per-key "Shows" change applies straight away', /%/.test(host.textOf('lamp')), host.textOf('lamp'));
    await deckPng(host.deckImages(), path.join(PREVIEW_DIR, '4-per-key-options.png'), { title: 'Per-key options: lamp shows its level, monitor is flat green icon only' });

    // ---- E: checks on everything sent so far
    check(`every key image passed the quirk and readability checks (${[...host.imageCount.values()].reduce((a, b) => a + b, 0)} images)`, host.problems.length === 0, host.problems.slice(0, 10));
    const log = host.log();
    check('Access ID and Secret never appear in the log', !log.includes(CREDS.accessSecret) && !log.includes(CREDS.accessId));
    check('no crashes in the plugin log', !/uncaughtException|unhandledRejection|render error|event error/.test(log), log.split('\n').filter((l) => /uncaught|unhandled|error/i.test(l)).slice(0, 5));

    // ---- F: restart with no cloud: still works from devices.json
    const dir = host.pluginDir;
    await host.stop();
    host = new FakeHost({ globals: {}, env: { TUYA_SCAN_HOSTS: '127.0.0.24' }, pluginDir: dir });
    await host.start();
    host.addKey('sw1', 'switch', 0, 0, { v: 2, deviceId: PLUG.id, show: 'auto', join: true });
    const relinked = await waitFor(() => {
      host.openPanel('sw1');
      host.fromPanel('sw1', { type: 'hello' });
      const d = ((lastPanel(host) || {}).devices || []).find((x) => x.name === 'Racing Cockpit');
      return d && d.link === 'local';
    }, 15000, 500);
    check('after a restart without the cloud it still connects from the saved list', relinked);
    sim.events.length = 0;
    host.press('sw1');
    check('...and switches the plug', await waitFor(() => controlFor(sim, PLUG.id, () => true), 4000));
    check('no image problems after restart', host.problems.length === 0, host.problems.slice(0, 5));
  } catch (e) {
    check('no crash in test', false, e.stack);
  } finally {
    await host.stop().catch(() => {});
    sim.stop();
    cloud.stop();
  }
  process.exit(summary() ? 0 : 1);
}

main();
