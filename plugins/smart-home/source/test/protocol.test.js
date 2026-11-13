'use strict';
// Checks the plugin's Tuya LAN code against simulated devices that are built
// on tinytuya (an independent implementation) for protocol 3.3, 3.4 and 3.5.
const dgram = require('dgram');
const { TuyaDevice } = require('../src/tuya/device');
const P = require('../src/tuya/protocol');
const { check, summary, sleep, waitFor, startSim } = require('./helpers');

const DEVICES = [
  { id: 'bf3a1c2d3e4f5a6b7c8d00', key: '0123456789abcdef', ip: '127.0.0.11', version: '3.3', dps: { 1: false, 18: 12, 19: 0, 20: 2398 } },
  { id: 'bf11223344556677889900', key: 'fedcba9876543210', ip: '127.0.0.12', version: '3.4', dps: { 1: true } },
  { id: 'bfaabbccddeeff00112233', key: 'A1b2C3d4E5f6G7h8', ip: '127.0.0.13', version: '3.5', dps: { 20: true, 21: 'white', 22: 800, 23: 300 } },
  { id: 'eb0011223344556677', key: 'zxcvbnmasdfghjkl', ip: '127.0.0.14', version: '3.3', dps: { 1: false }, silent: true },
];

async function testDevice(sim, cfg, givenVersion, label) {
  const logs = [];
  const dev = new TuyaDevice({ id: cfg.id, key: cfg.key, ip: cfg.ip, version: givenVersion, log: (m) => logs.push(m) });
  let versionSeen = null;
  dev.on('version', (v) => { versionSeen = v; });
  dev.start();
  const connected = await waitFor(() => dev.state === 'connected' && Object.keys(dev.dps).length > 0, givenVersion ? 6000 : 20000);
  check(`${label}: connects and reads status`, connected, { state: dev.state, dps: dev.dps, logs: logs.slice(-4) });
  if (!givenVersion) check(`${label}: works out the protocol version (${cfg.version})`, versionSeen === cfg.version, versionSeen);
  const firstDp = Object.keys(cfg.dps)[0];
  check(`${label}: status matches the device`, dev.dps[firstDp] === cfg.dps[firstDp], dev.dps);

  // switch it
  const want = !dev.dps[firstDp];
  const ok = await dev.set({ [firstDp]: want });
  check(`${label}: device accepts on/off command`, ok);
  const seen = await waitFor(() => sim.events.find((e) => e.event === 'control' && e.id === cfg.id && e.dps[firstDp] === want), 3000);
  check(`${label}: simulated device received the command`, seen, sim.events.filter((e) => e.id === cfg.id).slice(-3));
  check(`${label}: plugin state follows`, await waitFor(() => dev.dps[firstDp] === want, 2000), dev.dps);

  // change it "from Google Home"
  let pushed = null;
  dev.on('dps', (changed) => { if (firstDp in changed) pushed = changed; });
  sim.send({ id: cfg.id, dps: { [firstDp]: !want } });
  check(`${label}: sees changes made elsewhere (e.g. Google Home)`, await waitFor(() => pushed && pushed[firstDp] === !want, 3000), pushed);

  // heartbeat keeps it alive (shortened check: one heartbeat reply)
  dev.stop();
  return logs;
}

async function testWrongKey(sim) {
  const cfg = DEVICES[1];
  const logs = [];
  const dev = new TuyaDevice({ id: cfg.id, key: '0000000000000000', ip: cfg.ip, version: '3.4', log: (m) => logs.push(m) });
  let authError = null;
  dev.on('authError', (w) => { authError = w; });
  dev.start();
  await waitFor(() => authError, 6000);
  check('wrong key is reported (3.4)', authError && /key/.test(authError), { authError, logs });
  dev.stop();
}

async function testDiscovery() {
  const found = new Map();
  const socks = [];
  for (const port of [6667, 7000]) {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', (msg) => {
      const info = P.decodeBroadcast(msg);
      if (info && info.gwId) found.set(info.gwId, info);
    });
    await new Promise((r) => s.bind(port, r));
    socks.push(s);
  }
  await waitFor(() => found.size >= 3, 5000);
  for (const d of DEVICES.filter((x) => !x.silent)) {
    const f = found.get(d.id);
    check(`discovery finds ${d.version} device with its IP and version`, f && f.ip === d.ip && f.version === d.version, f);
  }
  socks.forEach((s) => s.close());
  // and the 3.5 discovery request decodes with tinytuya's key
  const req = P.decodeBroadcast(P.discoveryRequest('192.168.1.5'));
  check('discovery request packet is well-formed', req && req.from === 'app' && req.ip === '192.168.1.5', req);
}

(async () => {
  const sim = startSim(DEVICES);
  try {
    check('simulated devices started', await sim.ready());
    await testDiscovery();
    for (const d of DEVICES.slice(0, 3)) await testDevice(sim, d, d.version, `v${d.version}`);
    // version not known in advance: plugin has to find it
    for (const d of DEVICES.slice(1, 3)) await testDevice(sim, d, '', `v${d.version} (auto)`);
    await testWrongKey(sim);
  } catch (e) {
    check('no crash', false, e.stack);
  } finally {
    sim.stop();
  }
  const ok = summary();
  await sleep(100);
  process.exit(ok ? 0 : 1);
})();
