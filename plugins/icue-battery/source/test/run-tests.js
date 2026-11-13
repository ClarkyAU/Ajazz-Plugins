'use strict';
// node test/run-tests.js   (set NODE20=/path/to/node20 to run the plugin on Node 20)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const { checkImage, textElements } = require('./checks');
const { deckPng } = require('./deck');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let passed = 0, failed = 0;
const problems = [];

const HS80 = (props) => ({ id: 'HS80ID', model: 'HS80 MAX WIRELESS', kind: 8, supported: [1, 2, 3, 4, 5, 9],
  props: Object.assign({ battery: 47, mic: true }, props || {}) });
const MOUSE = (battery) => ({ id: 'M1', model: 'M75 AIR WIRELESS', kind: 2, supported: [1, 9], props: { battery: battery == null ? 80 : battery } });
const state = (session, devices, hid, tray) => ({ type: 'state', session, icue: '5.52.93', sdk: '4.0.84', tray: tray || [], devices: devices || [], hid: hid || { ok: false, pid: '', note: 'receiver not found', t: Math.floor(Date.now() / 1000) } });
const now = () => Math.floor(Date.now() / 1000);
const RX = (battery, charging, age) => ({ ok: true, battery, charging, t: now() - (age || 0), pid: '0a97', note: 'ok' });
const noBattery = (b) => { const d = HS80({ battery: b }); delete d.props.battery; d.supported = [1, 2, 3, 4, 5]; return d; };
const texts = (svg) => textElements(svg).map((t) => t.content);

async function scenario(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + (e && e.message));
  }
}

// every image a scenario produced must pass the key-image checks
function checkAll(h, label) {
  h.host.history.forEach((im, i) => checkImage(label + '#' + i, im.url).forEach((p) => problems.push(p)));
}

(async () => {
  console.log('iCUE Battery tests on Node ' + process.version);
  const previews = [];

  await scenario('no Setup key yet: every key says "Add the Setup key"', async () => {
    const h = await H.start({ helperState: state(6, [HS80()]) });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    assert.deepStrictEqual(texts(h.svg('a')), ['Add the', 'Setup key']);
    checkAll(h, 'nosetup'); await h.stop();
  });

  await scenario('Setup key: first appearance saves setupSeen, press is logged, shows Connected + device', async () => {
    const h = await H.start({ helperState: state(6, [HS80()]) });
    h.appear([{ ctx: 's', action: 'setup', col: 4, row: 2 }]);
    await h.settle(700);
    h.press('s', 'setup');
    await h.settle(400);
    assert.strictEqual(h.host.globals.setupSeen, true, 'setupSeen not saved');
    assert.ok(/Setup key pressed/.test(h.log()), 'press not logged');
    assert.ok(texts(h.svg('s')).includes('Connected'), 'setup key should say Connected: ' + texts(h.svg('s')));
    assert.ok(texts(h.svg('s')).includes('HS80 MAX'), 'setup key should name the device');
    checkAll(h, 'setup'); await h.stop();
  });

  await scenario('iCUE SDK off: Setup key says Turn on iCUE SDK, other keys say Finish the Setup key', async () => {
    const h = await H.start({ helperState: state(4, []), globals: { setupSeen: true } });
    h.appear([{ ctx: 's', action: 'setup', col: 4, row: 2 }, { ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    assert.deepStrictEqual(texts(h.svg('s')), ['Starting']);
    await h.settle(7200);
    assert.deepStrictEqual(texts(h.svg('s')), ['Turn on', 'iCUE SDK']);
    assert.deepStrictEqual(texts(h.svg('a')), ['Finish the', 'Setup key']);
    checkAll(h, 'sdkoff'); await h.stop();
  });

  await scenario('connected, headset off: Setup key says No device', async () => {
    const h = await H.start({ helperState: state(6, []), globals: { setupSeen: true } });
    h.appear([{ ctx: 's', action: 'setup', col: 4, row: 2 }]);
    await h.settle(700);
    assert.deepStrictEqual(texts(h.svg('s')), ['No device', 'Turn it on']);
    checkAll(h, 'nodevice'); await h.stop();
  });

  await scenario('joined group fills Battery, Mic, Connection in reading order', async () => {
    const h = await H.start({ helperState: state(6, [HS80()]), globals: { setupSeen: true } });
    const order = [[0, 0], [1, 0], [2, 0], [0, 1]];
    h.appear(order.map((p, i) => ({ ctx: 'k' + i, col: p[0], row: p[1] })));
    await h.settle(900);
    const t = order.map((p, i) => texts(h.svg('k' + i)));
    assert.deepStrictEqual(t[0].slice(-1), ['HS80 MAX']); assert.ok(t[0].includes('47'));
    assert.deepStrictEqual(t[1], ['ON', 'Mic']);
    assert.deepStrictEqual(t[2], ['ON', 'Connected']);
    assert.strictEqual(t[3].length, 0, 'fourth key stays empty');
    checkAll(h, 'group');
    previews.push(['Joined group of keys (reading order)', order.map((p, i) => ({ col: p[0], row: p[1], svg: h.svg('k' + i) }))]);
    await h.stop();
  });

  await scenario('hardware-order positions are converted (reported {2,0} is real column 4, row 2)', async () => {
    const h = await H.start({ helperState: state(6, [HS80()]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 4, row: 2 }, { ctx: 'b', col: 3, row: 2 }]);
    await h.settle(800);
    assert.ok(texts(h.svg('b')).includes('47'));
    assert.deepStrictEqual(texts(h.svg('a')), ['ON', 'Mic']);
    assert.ok(/at column 4, row 2 \(reported \{"column":2,"row":0\}\)/.test(h.log()), 'log: ' + h.log().split('\n').filter((l) => /Key added/.test(l)).join(' | '));
    checkAll(h, 'coords'); await h.stop();
  });

  await scenario('battery levels: colours, bar, 100 fits, low warning flashes', async () => {
    const levels = [100, 47, 15, 5, 0];
    const shots = [];
    for (const lv of levels) {
      const h = await H.start({ helperState: state(6, [HS80({ battery: lv })]), globals: { setupSeen: true } });
      h.appear([{ ctx: 'a', col: 0, row: 0, settings: { low: '20' } }]);
      await h.settle(700);
      const first = h.svg('a');
      await h.settle(1100);
      const second = h.svg('a');
      assert.ok(texts(first).includes(String(lv)), 'shows ' + lv);
      if (lv <= 20) assert.notStrictEqual(first, second, lv + ' should flash'); else assert.strictEqual(first, second, lv + ' should not flash');
      shots.push({ col: levels.indexOf(lv) % 5, row: Math.floor(levels.indexOf(lv) / 5), svg: first });
      checkAll(h, 'level' + lv); await h.stop();
    }
    previews.push(['Battery key at 100, 47, 15 (low), 5, 0', shots]);
  });

  await scenario('charging: battery reading disappears for 3 s -> "Charging", bolt, bar animates, last level kept', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 46 })]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    assert.ok(!texts(h.svg('a')).includes('Charging'));
    const noBattery = HS80({ battery: 46 }); delete noBattery.props.battery; noBattery.supported = [1, 2, 3, 4, 5];
    h.setState(state(6, [noBattery]));
    await h.settle(1500);
    assert.ok(!texts(h.svg('a')).includes('Charging'), 'a short gap must not count as charging');
    await h.settle(2600);
    const t = texts(h.svg('a'));
    assert.ok(t.includes('Charging') && t.includes('46'), 'charging with last level: ' + t.join('|'));
    const f1 = h.svg('a');
    await h.settle(1100);
    assert.notStrictEqual(f1, h.svg('a'), 'bar should animate');
    h.setState(state(6, [HS80({ battery: 50 })]));
    await h.settle(900);
    const back = texts(h.svg('a'));
    assert.ok(back.includes('50') && !back.includes('Charging'), 'back to normal: ' + back.join('|'));
    checkAll(h, 'charging');

    await h.stop();
  });

  await scenario('receiver says charging: key says Charging at once with the receiver\'s level (iCUE gives none)', async () => {
    const h = await H.start({ helperState: state(6, [noBattery()], RX(45.6, true)), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(900);
    const t = texts(h.svg('a'));
    assert.ok(t.includes('Charging') && t.includes('46'), t.join('|'));
    h.setState(state(6, [HS80({ battery: 62 })], RX(62.2, true)));
    await h.settle(700);
    assert.ok(texts(h.svg('a')).includes('62') && texts(h.svg('a')).includes('Charging'), 'level follows the receiver while charging');
    h.setState(state(6, [HS80({ battery: 63 })], RX(63.0, false)));
    await h.settle(700);
    assert.ok(!texts(h.svg('a')).includes('Charging') && texts(h.svg('a')).includes('63'), 'unplugged');
    checkAll(h, 'rx-charging'); await h.stop();
  });

  await scenario('receiver says not charging even though the level is missing: not "Charging"', async () => {
    const h = await H.start({ helperState: state(6, [noBattery()], RX(80, false)), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(4500);
    assert.ok(!texts(h.svg('a')).includes('Charging'), texts(h.svg('a')).join('|'));
    assert.ok(texts(h.svg('a')).includes('80'), 'uses the receiver level when iCUE has none');
    await h.stop();
  });

  await scenario('headset switched off (receiver there, headset not answering, no battery value): not "Charging"', async () => {
    const off = { ok: false, battery: 0, charging: false, t: now(), pid: '0a97', note: 'headset not answering (asleep or off)' };
    const h = await H.start({ helperState: state(6, [HS80({ battery: 46 })], RX(46, false)), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    h.setState(state(6, [noBattery()], off));
    await h.settle(4500);
    assert.ok(!texts(h.svg('a')).includes('Charging'), 'off is not charging: ' + texts(h.svg('a')).join('|'));
    await h.stop();
  });

  await scenario('iCUE says the headset is disconnected: greyed "Not found", never "Charging"', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 46 })], RX(46, false)), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    const gone = noBattery(); gone.connected = false;
    h.setState(state(6, [gone], { ok: false, pid: '', note: 'receiver not found', t: now() }));
    await h.settle(4500);
    const t = texts(h.svg('a'));
    assert.ok(!t.includes('Charging') && t.includes('46'), 'disconnected keeps the last level, not charging: ' + t.join('|'));
    await h.stop();
  });

  await scenario('headset off right after start, before the receiver has reported: not "Charging"', async () => {
    const h = await H.start({ helperState: state(6, [noBattery()], { ok: false, pid: '', note: 'waiting' }), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(4500);
    assert.ok(!texts(h.svg('a')).includes('Charging'), texts(h.svg('a')).join('|'));
    await h.stop();
  });

  await scenario('iCUE said "disconnected" but a battery reading is back (no "connected" event came): shown normally', async () => {
    const h = await H.start({ helperState: state(6, [Object.assign(HS80({ battery: 80 }), { connected: false })], RX(80, false)), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(900);
    const t = texts(h.svg('a'));
    assert.ok(t.includes('80') && !t.includes('Charging') && !t.includes('Not found'), t.join('|'));
    await h.stop();
  });

  await scenario('iCUE tray text says Charging: key says Charging at once, even though the receiver still says on battery', async () => {
    const h = await H.start({ helperState: state(6, [noBattery(80)], RX(80, false), ['HS80 MAX WIRELESS Battery Status Charging']), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(900);
    const t = texts(h.svg('a'));
    assert.ok(t.includes('Charging') && t.includes('80'), t.join('|'));
    h.setState(state(6, [noBattery(80)], RX(80, true), ['HS80 MAX WIRELESS Battery Status High HS80 MAX WIRELESS Battery Status Charging']));
    await h.settle(700);
    assert.ok(texts(h.svg('a')).includes('Charging'), 'the in-between text with both words still ends in Charging');
    checkAll(h, 'tray-charging'); await h.stop();
  });

  await scenario('iCUE tray text says High/Medium/Low: not Charging, even if the receiver is still behind', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 80 })], RX(80, true), ['HS80 MAX WIRELESS Battery Status High']), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(900);
    const t = texts(h.svg('a'));
    assert.ok(!t.includes('Charging') && t.includes('80'), t.join('|'));
    await h.stop();
  });

  await scenario('tray text disappears and iCUE has no battery value: headset off, greyed "Not found" after a few seconds, never Charging', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 80 })], RX(80, false), ['HS80 MAX WIRELESS Battery Status High']), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(900);
    h.setState(state(6, [noBattery()], RX(80, false), []));
    await h.settle(1200);
    assert.ok(!texts(h.svg('a')).includes('Charging'), 'not charging right away');
    await h.settle(3500);
    const t = texts(h.svg('a'));
    assert.ok(!t.includes('Charging') && t.includes('80'), 'off keeps the last level: ' + t.join('|'));
    h.setState(state(6, [HS80({ battery: 81 })], RX(81, false), ['HS80 MAX WIRELESS Battery Status High']));
    await h.settle(900);
    assert.ok(texts(h.svg('a')).includes('81'), 'back on');
    await h.stop();
  });

  await scenario('charging: tray text present while iCUE has no battery value is NOT treated as off', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 80 })], RX(80, false), ['HS80 MAX WIRELESS Battery Status High']), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(900);
    h.setState(state(6, [noBattery()], RX(80, false), ['HS80 MAX WIRELESS Battery Status Charging']));
    await h.settle(4500);
    assert.ok(texts(h.svg('a')).includes('Charging'), texts(h.svg('a')).join('|'));
    await h.stop();
  });

  await scenario('tray text for a different device is ignored', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 80 })], RX(80, false), ['M75 AIR WIRELESS Battery Status Charging']), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(900);
    assert.ok(!texts(h.svg('a')).includes('Charging'), texts(h.svg('a')).join('|'));
    await h.stop();
  });

  await scenario('stale receiver data (headset just switched off, helper slow to report): not "Charging"', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 46 })], RX(46, false, 500)), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    h.setState(state(6, [noBattery()], RX(46, false, 500)));
    await h.settle(4200);
    assert.ok(!texts(h.svg('a')).includes('Charging'), 'stale is not charging: ' + texts(h.svg('a')).join('|'));
    await h.stop();
  });

  await scenario('check interval is sent to the helper, default 10 s, changeable from the Setup key panel', async () => {
    const h = await H.start({ helperState: state(6, [HS80()], RX(47, false)), globals: { setupSeen: true } });
    h.appear([{ ctx: 's', action: 'setup', col: 4, row: 2 }]);
    await h.settle(700);
    assert.ok(/command: poll 10/.test(h.log()), 'default poll sent');
    h.send({ event: 'sendToPlugin', action: 'com.clarkyau.icuebattery.setup', context: 's', payload: { type: 'global', settings: { device: 'auto', poll: 30 } } });
    await h.settle(500);
    assert.ok(/command: poll 30/.test(h.log()), 'poll 30 sent');
    h.send({ event: 'sendToPlugin', action: 'com.clarkyau.icuebattery.setup', context: 's', payload: { type: 'hello' } });
    await h.settle(400);
    const st = h.host.pi.slice(-1)[0].payload;
    assert.strictEqual(st.receiver.ok, true);
    await h.stop();
  });

  await scenario('charging while already low does not flash red', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 8 })]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    const noBattery = HS80({ battery: 8 }); delete noBattery.props.battery;
    h.setState(state(6, [noBattery]));
    await h.settle(3800);
    const bgOf = (svg) => (svg.match(/<rect width="144" height="144" fill="([^"]+)"/) || [])[1];
    const seen = new Set();
    for (let i = 0; i < 6; i++) { seen.add(bgOf(h.svg('a'))); await h.settle(450); }
    assert.strictEqual(seen.size, 1, 'background must not flash: ' + Array.from(seen));
    assert.ok(texts(h.svg('a')).includes('Charging'));
    checkAll(h, 'chargelow'); await h.stop();
  });

  await scenario('a device that never reports a battery is not called charging', async () => {
    const h = await H.start({ helperState: state(6, [{ id: 'KB', model: 'K70', kind: 1, supported: [1, 7], props: {} }]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0, settings: { device: 'KB' } }]);
    await h.settle(4500);
    assert.ok(!texts(h.svg('a')).includes('Charging'), texts(h.svg('a')).join('|'));
    await h.stop();
  });

  await scenario('low warning can be switched off per key', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ battery: 5 })]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0, settings: { low: 'off' } }]);
    await h.settle(700);
    const first = h.svg('a');
    await h.settle(1100);
    assert.strictEqual(first, h.svg('a'), 'should not flash');
    await h.stop();
  });

  await scenario('headset turned off: last reading stays, greyed, "Not found"', async () => {
    const h = await H.start({ helperState: state(6, [HS80()]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    h.setState(state(6, []));
    await h.settle(700);
    const t = texts(h.svg('a'));
    assert.ok(t.includes('47') && t.includes('Not found'), t.join('|'));
    assert.ok(!/rgb\(74,222,128\)/.test(h.svg('a')), 'should not be green when off');
    checkAll(h, 'off'); await h.stop();
  });

  await scenario('remembered reading from the last run is shown while the headset is off', async () => {
    const h = await H.start({ helperState: state(6, []), globals: { setupSeen: true },
      lastKnown: [{ id: 'HS80ID', model: 'HS80 MAX WIRELESS', kind: 8, props: { battery: 62, mic: true } }] });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(800);
    assert.ok(texts(h.svg('a')).includes('62'));
    checkAll(h, 'lastknown'); await h.stop();
  });

  await scenario('Join off makes a key stand alone; side screen never joins the main keys', async () => {
    const h = await H.start({ helperState: state(6, [HS80()]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }, { ctx: 'b', col: 1, row: 0, settings: { join: false } }, { ctx: 'c', col: 4, row: 0 }, { ctx: 'd', col: 5, row: 0 }, { ctx: 'e', col: 5, row: 1 }]);
    await h.settle(900);
    assert.ok(texts(h.svg('a')).includes('47'), 'a alone is battery');
    assert.ok(texts(h.svg('b')).includes('47'), 'b stands alone: battery');
    assert.ok(texts(h.svg('c')).includes('47'), 'c (column 4) is first of its own group');
    assert.ok(texts(h.svg('d')).includes('47'), 'side screen starts its own group');
    assert.deepStrictEqual(texts(h.svg('e')), ['ON', 'Mic'], 'second side key follows the first');
    checkAll(h, 'join'); await h.stop();
  });

  await scenario('"Shows" and "Device" per key override Automatic', async () => {
    const h = await H.start({ helperState: state(6, [HS80(), MOUSE(80)]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0, settings: { shows: 'connection' } }, { ctx: 'b', col: 2, row: 2, settings: { device: 'M1' } }]);
    await h.settle(800);
    assert.deepStrictEqual(texts(h.svg('a')), ['ON', 'Connected']);
    assert.ok(texts(h.svg('b')).includes('80') && texts(h.svg('b')).includes('M75 AIR'), texts(h.svg('b')).join('|'));
    h.setSettings('a', { shows: 'mic' });
    await h.settle(400);
    assert.deepStrictEqual(texts(h.svg('a')), ['ON', 'Mic']);
    checkAll(h, 'override'); await h.stop();
  });

  await scenario('a device without a mic (a mouse) only offers Battery then Connection in a group', async () => {
    const h = await H.start({ helperState: state(6, [MOUSE(80)]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }, { ctx: 'b', col: 1, row: 0 }, { ctx: 'c', col: 2, row: 0 }]);
    await h.settle(800);
    assert.ok(texts(h.svg('a')).includes('80'));
    assert.deepStrictEqual(texts(h.svg('b')), ['ON', 'Connected']);
    assert.ok(!h.svg('c').includes('<text') || texts(h.svg('c')).length === 0, 'extra key stays empty');
    checkAll(h, 'mouse'); await h.stop();
  });

  await scenario('muted mic reads MUTED in red and fits the key', async () => {
    const h = await H.start({ helperState: state(6, [HS80({ mic: false })]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0, settings: { shows: 'mic' } }]);
    await h.settle(700);
    assert.deepStrictEqual(texts(h.svg('a')), ['MUTED', 'Mic']);
    checkAll(h, 'muted'); await h.stop();
  });

  await scenario('property inspector gets state and can change settings', async () => {
    const h = await H.start({ helperState: state(6, [HS80(), MOUSE(80)]), globals: { setupSeen: true } });
    h.appear([{ ctx: 'a', col: 0, row: 0 }]);
    await h.settle(700);
    const A = 'com.clarkyau.icuebattery.headset';
    h.send({ event: 'sendToPlugin', action: A, context: 'a', payload: { type: 'hello' } });
    await h.settle(400);
    const st = h.host.pi.slice(-1)[0].payload;
    assert.strictEqual(st.type, 'state'); assert.strictEqual(st.status, 'ok'); assert.strictEqual(st.role, 'battery');
    assert.ok(st.devices.length === 2 && st.roles.indexOf('mic') >= 0);
    h.send({ event: 'sendToPlugin', action: A, context: 'a', payload: { type: 'settings', settings: { shows: 'mic' } } });
    await h.settle(400);
    assert.deepStrictEqual(texts(h.svg('a')), ['ON', 'Mic']);
    h.send({ event: 'sendToPlugin', action: A, context: 'a', payload: { type: 'global', settings: { device: 'M1' } } });
    h.send({ event: 'sendToPlugin', action: A, context: 'a', payload: { type: 'settings', settings: {} } });
    await h.settle(500);
    assert.ok(texts(h.svg('a')).includes('80'), 'default device changed to the mouse: ' + texts(h.svg('a')));
    checkAll(h, 'pi'); await h.stop();
  });

  await scenario('plugin runs on Node 20, logs the device properties, exits when the host closes', async () => {
    const h = await H.start({ helperState: state(6, [HS80()]), globals: { setupSeen: true } });
    await h.settle(500);
    assert.ok(/Starting iCUE Battery 1\.0\.0\. Node v20/.test(h.log()) || process.version.indexOf('v20') !== 0, 'log: ' + h.log().split('\n')[0]);
    assert.ok(/Device HS80 MAX WIRELESS \(type 8\): iCUE offers properties \[1,2,3,4,5,9\]/.test(h.log()), 'device line missing');
    await h.stop();
    assert.ok(h.host.exited, 'plugin should exit after the host closes');
    assert.strictEqual(h.stderr(), '', 'stderr: ' + h.stderr());
  });

  // ---- whole-deck previews ----
  const full = await H.start({ helperState: state(6, [HS80(), MOUSE(80)]), globals: { setupSeen: true } });
  const deck = [];
  deck.push({ ctx: 's', action: 'setup', col: 4, row: 2 });
  [[0, 0], [1, 0], [2, 0]].forEach((p, i) => deck.push({ ctx: 'k' + i, col: p[0], row: p[1] }));
  deck.push({ ctx: 'm', col: 3, row: 0, settings: { device: 'M1', join: false } });
  deck.push({ ctx: 'x1', col: 5, row: 0, settings: { shows: 'battery' } });
  deck.push({ ctx: 'x2', col: 5, row: 1, settings: { shows: 'mic' } });
  full.appear(deck);
  await full.settle(900);
  checkAll(full, 'deck');
  const shot = () => deck.map((k) => ({ col: k.col, row: k.row, svg: full.svg(k.ctx) })).filter((k) => k.svg);
  deckPng(shot(), 'Everything: Setup key, three joined keys, a mouse key, side screen', path.join(OUT, 'deck-everything.png'));
  full.setState(state(6, []));
  await full.settle(700);
  checkAll(full, 'deck-off');
  deckPng(shot(), 'Headset switched off: last readings kept, greyed', path.join(OUT, 'deck-headset-off.png'));
  await full.stop();

  const nosetup = await H.start({ helperState: state(4, []) });
  nosetup.appear([{ ctx: 'a', col: 0, row: 0 }]);
  await nosetup.settle(700);
  const notice = [{ col: 0, row: 0, svg: nosetup.svg('a') }];
  await nosetup.stop();
  const fin = await H.start({ helperState: state(4, []), globals: { setupSeen: true } });
  fin.appear([{ ctx: 'a', col: 1, row: 0 }, { ctx: 's', action: 'setup', col: 4, row: 2 }]);
  await fin.settle(8000);
  notice.push({ col: 1, row: 0, svg: fin.svg('a') }, { col: 4, row: 2, svg: fin.svg('s') });
  checkAll(fin, 'notice');
  deckPng(notice, 'Not set up yet: Add / Finish the Setup key, and the Setup key', path.join(OUT, 'deck-setup-states.png'));
  await fin.stop();

  previews.forEach((p, i) => deckPng(p[1].filter((k) => k.svg), p[0], path.join(OUT, 'deck-' + ['group', 'levels'][i] + '.png')));

  // charging animation frames (drawn straight from the renderer)
  const R = require('../src/plugin/render');
  const frames = [0, 1, 2, 3, 4, 5].map((f) => ({ col: f % 5, row: Math.floor(f / 5), svg: R.batteryKey({ present: true, level: 46, low: 20, blink: false, model: 'HS80 MAX WIRELESS', kind: 8, charging: true, frame: f }) }));
  frames.forEach((k, i) => checkImage('charging-frame' + i, R.toDataUrl(k.svg)).forEach((p) => problems.push(p)));
  deckPng(frames, 'Charging: the bar refills from the last level, over and over (6 frames, 2 per second)', path.join(OUT, 'deck-charging.png'));

  const uniq = Array.from(new Set(problems));
  uniq.forEach((p) => console.log('  IMAGE PROBLEM ' + p));
  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + uniq.length + ' image problems');
  process.exit(failed || uniq.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
