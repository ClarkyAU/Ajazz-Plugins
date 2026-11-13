'use strict';
// Checks cloud sign-in, device list (incl. local keys) and request signing
// against a fake Tuya cloud that verifies signatures with Tuya's own
// tuya-connector-python code.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { TuyaCloud } = require('../src/tuya/cloud');
const model = require('../src/tuya/model');
const { check, summary, waitFor, sleep } = require('./helpers');

const ID = 'testaccessid1234', SECRET = 'testsecret0987654321abcdef';
const PORT = 18099;

const PLUG_SPEC = {
  category: 'cz',
  functions: [{ code: 'switch_1', dp_id: 1, type: 'Boolean', values: '{}' }],
  status: [
    { code: 'switch_1', dp_id: 1, type: 'Boolean', values: '{}' },
    { code: 'cur_current', dp_id: 18, type: 'Integer', values: '{"unit":"mA","min":0,"max":30000,"scale":0,"step":1}' },
    { code: 'cur_power', dp_id: 19, type: 'Integer', values: '{"unit":"W","min":0,"max":50000,"scale":1,"step":1}' },
    { code: 'cur_voltage', dp_id: 20, type: 'Integer', values: '{"unit":"V","min":0,"max":5000,"scale":1,"step":1}' },
  ],
};
const LIGHT_SPEC = {
  category: 'dj',
  functions: [
    { code: 'switch_led', dp_id: 20, type: 'Boolean', values: '{}' },
    { code: 'work_mode', dp_id: 21, type: 'Enum', values: '{"range":["white","colour","scene","music"]}' },
    { code: 'bright_value_v2', dp_id: 22, type: 'Integer', values: '{"min":10,"max":1000,"scale":0,"step":1}' },
    { code: 'temp_value_v2', dp_id: 23, type: 'Integer', values: '{"min":0,"max":1000,"scale":0,"step":1}' },
    { code: 'colour_data_v2', dp_id: 24, type: 'Json', values: '{"h":{"min":0,"max":360},"s":{"min":0,"max":1000},"v":{"min":0,"max":1000}}' },
  ],
  status: [],
};
const BOARD_SPEC = {
  category: 'pc',
  functions: [1, 2, 3, 4].map((n) => ({ code: `switch_${n}`, dp_id: n, type: 'Boolean', values: '{}' }))
    .concat([{ code: 'switch_usb1', dp_id: 7, type: 'Boolean', values: '{}' }]),
  status: [],
};

const DEVICES = [
  { id: 'bf3a1c2d3e4f5a6b7c8d00', name: 'Racing Cockpit', local_key: '0123456789abcdef', category: 'cz', product_name: 'Smart Plug', online: true, spec: PLUG_SPEC, cloud_status: { switch_1: true, cur_power: 1184 } },
  { id: 'bfaabbccddeeff00112233', name: 'Lounge Lamp', local_key: 'A1b2C3d4E5f6G7h8', category: 'dj', product_name: 'Smart Bulb', online: true, spec: LIGHT_SPEC, hide_key: true },
  { id: 'bf99887766554433221100', name: 'Desk Board', local_key: 'qwertyuiopasdfgh', category: 'pc', product_name: 'Powerboard', online: false, spec: BOARD_SPEC },
];

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakecloud-'));
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(DEVICES));
  const proc = spawn('python3', [path.join(__dirname, 'sim', 'fake_cloud.py'), String(PORT), ID, SECRET, path.join(dir, 'd.json')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const reqs = [];
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { reqs.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  await sleep(800);
  try {
    // wrong secret
    const bad = new TuyaCloud({ accessId: ID, accessSecret: 'nope', baseUrl: `http://127.0.0.1:${PORT}` });
    let err = null;
    try { await bad.connect(); } catch (e) { err = e; }
    check('wrong Access Secret gives a clear message', err && err.kind === 'auth' && /wrong/i.test(err.message), err && err.message);

    const cloud = new TuyaCloud({ accessId: ID, accessSecret: SECRET, baseUrl: `http://127.0.0.1:${PORT}` });
    await cloud.connect();
    check('signs in and gets a token', cloud.token === 'faketoken123456');
    const list = await cloud.listDevices();
    check('lists all devices', list.length === 3, list.map((d) => d.name));
    check('gets the local key even when the first list leaves it out', list.find((d) => d.name === 'Lounge Lamp').local_key === 'A1b2C3d4E5f6G7h8');

    const described = [];
    for (const d of list) described.push(model.describe(d, await cloud.specifications(d.id)));
    const plug = described.find((d) => d.name === 'Racing Cockpit');
    const lamp = described.find((d) => d.name === 'Lounge Lamp');
    const board = described.find((d) => d.name === 'Desk Board');
    check('plug recognised as a plug with a power meter', plug.kind === 'plug' && plug.power && plug.power.dp === '19' && plug.power.scale === 1, plug);
    check('power reading scaled to watts', model.powerWatts(plug, { 19: 1184 }) === 118.4);
    check('bulb recognised as a dimmable colour light', lamp.kind === 'light' && lamp.light.brightDp === '22' && lamp.light.colourDp === '24' && lamp.light.colourV2, lamp.light);
    check('power board has 4 outlets + USB', board.switches.length === 5 && board.switches[4].label === 'USB 1', board.switches);

    const st = await cloud.status(plug.id);
    check('cloud status maps back to data points', JSON.stringify(model.cloudStatusToDps(plug, st)) === JSON.stringify({ 1: true, 19: 1184 }), model.cloudStatusToDps(plug, st));
    try { await cloud.command(plug.id, model.dpsToCloudCommands(plug, { 1: false })); } catch (e) { console.log("POST reqs:", JSON.stringify(reqs.filter((r) => r.method === "POST"))); throw e; }
    const post = reqs.find((r) => r.method === 'POST');
    check('cloud command is sent with the right code', post && JSON.parse(post.body).commands[0].code === 'switch_1' && JSON.parse(post.body).commands[0].value === false, post);
    const signed = reqs.filter((r) => r.path !== '/v1.0/token' || r.sign_ok);
    check(`every request was signed correctly (${signed.length} checked with Tuya's code)`, signed.length > 6 && signed.every((r) => r.sign_ok), reqs.filter((r) => !r.sign_ok));

    // light helpers
    const ls = model.lightState(lamp, { 20: true, 21: 'white', 22: 500, 23: 0 });
    check('light brightness read as %', ls.on && ls.pct === 50, ls);
    const set = model.brightnessDps(lamp, { 20: false, 21: 'white', 22: 505 }, 100);
    check('setting brightness turns the light on', set[22] === 1000 && set[20] === true, set);
    const colour = model.brightnessDps(lamp, { 20: true, 21: 'colour', 24: '00f003e803e8' }, 25);
    const c = model.parseColour(colour[24], true);
    check('brightness in colour mode keeps the colour', c.h === 240 && Math.abs(c.v - 0.25) < 0.01, colour);
    check('colour shown on the key matches the bulb', JSON.stringify(model.lightState(lamp, { 20: true, 21: 'colour', 24: '00f003e803e8' }).rgb) === JSON.stringify([0, 0, 255]));
  } catch (e) {
    check('no crash', false, e.stack);
  } finally {
    proc.kill();
  }
  process.exit(summary() ? 0 : 1);
})();
