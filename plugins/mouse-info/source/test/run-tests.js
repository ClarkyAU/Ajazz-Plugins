// Mouse Info tests. Run with Node 20: node test/run-tests.js
// 1) unit checks  2) the built plugin against a fake Ajazz host + fake mouse listener, with a whole
// deck of keys per scenario; every key image is checked against the AKP153E quirks; deck previews
// are written to test/out/deck-<scenario>.png
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const assert = require('assert');
const { WebSocketServer } = require('ws');
const { Resvg } = require('@resvg/resvg-js');
const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build', 'com.clarkyau.mouseinfo.sdPlugin');
const OUT = path.join(__dirname, 'out');
const NODE = process.env.NODE20 || process.execPath;
const { parseGloriousReport, MiceState } = require('../src/mice');
const { readCore, profileFor } = require('../src/core');
const { realPosition, computeLayout } = require('../src/layout');
const R = require('../src/render');
const INTER = ['Regular', 'SemiBold', 'Bold'].map(w => '/usr/share/fonts/opentype/inter/Inter-' + w + '.otf').filter(f => fs.existsSync(f));
const FONT = { fontFiles: INTER, loadSystemFonts: false, defaultFontFamily: 'Inter' };

let failures = 0, passes = 0;
function check(name, fn) {
  try { fn(); passes++; } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); }
}

// ------------------------------------------------------------------ key image quirk checks
const PREFIX = 'data:image/svg+xml;charset=utf8,';
function imageProblems(url) {
  const p = [];
  if (!url.startsWith(PREFIX)) return ['not an SVG data URL'];
  const svg = url.slice(PREFIX.length);
  if (svg.includes('#')) p.push('contains #');
  if (svg.includes('%')) p.push('contains %');
  if (/url\(/i.test(svg)) p.push('uses url()');
  if (/<(filter|linearGradient|radialGradient|clipPath|mask)\b/i.test(svg)) p.push('uses filter/gradient/clip');
  if (!/^<svg[^>]*width="144" height="144"/.test(svg)) p.push('not 144x144');
  for (const m of svg.matchAll(/font-size="([\d.]+)"/g)) if (+m[1] < 19) p.push('font ' + m[1] + 'px < 19');
  for (const m of svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)) if (/^\s|\s$/.test(m[1])) p.push('tspan edge space "' + m[1] + '"');
  for (const m of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) if (/^\s|\s$/.test(m[1])) p.push('text edge space');
  // Text must stay inside the key: render only the text and measure it.
  const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) 144 144"/);
  const texts = svg.match(/<text[\s\S]*?<\/text>/g) || [];
  if (vb && texts.length) {
    const vx = +vb[1], vy = +vb[2];
    for (const t of texts) {
      const one = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="' + (vx - 228) + ' ' + (vy - 228) + ' 600 600">' + t + '</svg>';
      const bb = new Resvg(one, { font: FONT }).getBBox();
      if (!bb) continue;
      if (bb.x < vx - 0.5 || bb.y < vy - 0.5 || bb.x + bb.width > vx + 144.5 || bb.y + bb.height > vy + 144.5) {
        p.push('text outside key: ' + t.replace(/<[^>]+>/g, '') + ' (' + [bb.x - vx, bb.y - vy, bb.width, bb.height].map(n => n.toFixed(0)).join(',') + ')');
      }
    }
  }
  return p;
}
function toPng(url, size) {
  return new Resvg(url.slice(PREFIX.length), { font: FONT, fitTo: { mode: 'width', value: size || 144 } }).render().asPng();
}

// ------------------------------------------------------------------ unit checks
function units() {
  check('parse reports', () => {
    assert.deepStrictEqual(parseGloriousReport('06fb150000000000'), { level: 21, charging: false });
    assert.deepStrictEqual(parseGloriousReport('06fb4001'), { level: 64, charging: true });
    assert.deepStrictEqual(parseGloriousReport('04f102'), { profile: 2 });          // Model I 2 profile switch
    assert.deepStrictEqual(parseGloriousReport('06f60100000000'), { profile: 2 });  // Model O 2 family, 0-based
    assert.strictEqual(parseGloriousReport('06f9800100000000'), null);
    assert.strictEqual(parseGloriousReport('06fbff00'), null);
    assert.strictEqual(parseGloriousReport('04f1a0'), null); // reset event
  });
  check('key positions (hardware order)', () => {
    assert.deepStrictEqual(realPosition({ column: 2, row: 2 }), { col: 0, row: 0, side: false }); // top-left
    assert.deepStrictEqual(realPosition({ column: 2, row: 0 }), { col: 4, row: 2, side: false });
    assert.deepStrictEqual(realPosition({ column: 0, row: 0 }), { col: 4, row: 0, side: false });
    assert.deepStrictEqual(realPosition({ column: 5, row: 1 }), { col: 5, row: 1, side: true });
    const seen = new Set();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { const p = realPosition({ column: c, row: r }); seen.add(p.col + ',' + p.row); }
    assert.strictEqual(seen.size, 15);
  });
  check('joining and automatic roles', () => {
    const k = (ctx, col, row, s, dev) => ({ context: ctx, device: dev || 'D', pos: { col, row, side: col === 5 }, settings: s || {} });
    const L = computeLayout([k('a', 2, 0), k('b', 3, 0), k('c', 4, 0), k('s1', 5, 0), k('s2', 5, 1), k('x', 4, 1, { join: false }), k('y', 0, 2)]);
    assert.deepStrictEqual(['a', 'b', 'c'].map(c => L.get(c).role), ['battery', 'connection', 'profile']);
    assert.deepStrictEqual(['s1', 's2'].map(c => L.get(c).role), ['battery', 'connection']); // side screen separate
    assert.strictEqual(L.get('c').group.includes('s1'), false);
    assert.strictEqual(L.get('x').role, 'battery'); assert.strictEqual(L.get('x').group.length, 1);
    const L2 = computeLayout([k('a', 0, 0, { shows: 'profile' }), k('b', 1, 0)]);
    assert.deepStrictEqual(['a', 'b'].map(c => L2.get(c).role), ['profile', 'connection']);
    const L3 = computeLayout([k('a', 0, 0, {}, 'D1'), k('b', 1, 0, {}, 'D2')]); // different decks never join
    assert.strictEqual(L3.get('b').role, 'battery');
  });
  check('cable means charging, last level kept', () => {
    const s = new MiceState();
    s.setGloriousDevices([{ pid: '821D', model: 'Model I 2', conn: 'receiver' }], 1);
    s.gloriousReport({ pid: '821D', model: 'Model I 2', conn: 'receiver', hex: '06fb1500' }, 2);
    const m = s.mice.get('glorious:821');
    assert.strictEqual(m.charging, false);
    s.setGloriousDevices([], 3); assert.strictEqual(m.present, false);
    s.setGloriousDevices([{ pid: '821A', model: 'Model I 2', conn: 'cable' }], 4);
    assert.strictEqual(m.conn, 'cable'); assert.strictEqual(m.charging, true); assert.strictEqual(m.level, 21);
    assert.ok(R.levelIsOld(m));
    s.setGloriousDevices([{ pid: '821D', model: 'Model I 2', conn: 'receiver' }], 5);
    assert.strictEqual(m.charging, false); assert.ok(!R.levelIsOld(m));
  });
  check('mouse choice', () => {
    const s = new MiceState();
    s.setBluetooth([{ id: 'A', name: 'WH-1000XM5', level: 90 }, { id: 'B', name: 'MX Master 3S', level: 40 }], 1);
    assert.strictEqual(s.selected('auto', 'auto').name, 'MX Master 3S');
    s.setGloriousDevices([{ pid: '821D', model: 'Model I 2', conn: 'receiver' }], 2);
    assert.strictEqual(s.selected('auto', 'auto').id, 'glorious:821');
    assert.strictEqual(s.selected('bluetooth', 'auto').name, 'MX Master 3S');
    assert.strictEqual(s.selected('auto', 'bt:A').name, 'WH-1000XM5');
  });
  check('profiles from Glorious Core', () => {
    process.env.MOUSEINFO_CORE_DIR = path.join(__dirname, 'fixtures', 'core');
    const core = readCore();
    const i2 = core.get('ModelI2Wireless');
    assert.strictEqual(i2.current, 1); assert.strictEqual(i2.profiles.length, 3);
    const m = { source: 'glorious', coreProduct: 'ModelI2Wireless', conn: 'receiver' };
    const p = profileFor(m, core);
    assert.strictEqual(p.num, 1); assert.strictEqual(p.dpi, 1600); assert.strictEqual(p.dpiColor, 'rgb(255,38,38)'); assert.strictEqual(p.polling, 1000);
    m.liveProfile = 3; m.liveProfileAt = Date.now() + 1000;
    const p3 = profileFor(m, core);
    assert.strictEqual(p3.num, 3); assert.strictEqual(p3.dpi, 3200);
    assert.strictEqual(profileFor({ source: 'bluetooth' }, core), null);
    delete process.env.MOUSEINFO_CORE_DIR;
  });
  check('every key type passes the image checks in edge cases', () => {
    const ms = [null, { id: 'x', short: 'Model O 2 Mini', present: true, level: 100, charging: true, conn: 'cable', cableSince: 5, levelAt: 1 },
      { id: 'y', short: 'Logitech MX Master 3S For Mac', present: false, level: 5, conn: 'bluetooth', source: 'bluetooth' },
      { id: 'z', short: 'Model I 2', present: true, level: null, conn: 'receiver', source: 'glorious' }];
    const profiles = [null, { num: 3, name: 'Profile 3', dpi: 26000, dpiColor: 'rgb(24,179,10)', polling: 8000, wirelessPolling: 4000 }, { num: 1, name: 'Profile 1' }];
    for (const m of ms) for (const s of [{}, { low: 'off' }, { low: '30', detail: 'polling' }, { detail: 'none' }]) {
      const imgs = [R.batteryKey(m, s), R.connectionKey(m, s), R.setupKey(m, 'ok'), R.setupKey(m, 'error'), R.setupKey(m, 'searching')].concat(profiles.map(p => R.profileKey(m, p, s)));
      for (const svg of imgs) { const pr = imageProblems(R.dataUrl(svg)); assert.deepStrictEqual(pr, [], pr.join('; ') + ' in ' + svg.slice(0, 200)); }
    }
  });
}

// ------------------------------------------------------------------ fake host
// Real position -> reported (hardware order) coordinates.
function reported(col, row) {
  if (col === 5) return { column: 5, row };
  const index = (4 - col) * 3 + row;
  return { column: index % 5, row: Math.floor(index / 5) };
}

const DECK = [
  // [context, action, real col, real row, settings]
  ['setup', 'setup', 1, 0, {}],
  ['m1', 'mouse', 2, 0, {}], ['m2', 'mouse', 3, 0, {}], ['m3', 'mouse', 4, 0, {}],
  ['b1', 'mouse', 1, 1, { shows: 'battery', join: false, low: '30' }], ['c1', 'mouse', 2, 1, { shows: 'connection', join: false }],
  ['p1', 'mouse', 3, 1, { shows: 'profile', join: false, detail: 'polling' }], ['p2', 'mouse', 4, 1, { shows: 'profile', join: false, detail: 'none' }],
  ['s1', 'mouse', 5, 0, {}], ['s2', 'mouse', 5, 1, {}], ['s3', 'mouse', 5, 2, {}],
];

function runScenario(scenario, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mouseinfo-'));
    fs.cpSync(BUILD, dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'diag', 'core'), { recursive: true }); // left over from the probe build
    const images = new Map(), sent = [], piStates = [];
    const wss = new WebSocketServer({ port: 0 });
    let sock, plugin;
    wss.on('listening', () => {
      plugin = spawn(NODE, [path.join(dir, 'plugin', 'index.js'), '-port', wss.address().port, '-pluginUUID', 'PLUGIN', '-registerEvent', 'registerPlugin',
        '-info', JSON.stringify({ application: { version: '3.10.188.226' }, devices: [{ id: 'DEV', name: 'AKP153E', size: { columns: 6, rows: 3 } }] })],
      { env: Object.assign({}, process.env, { MOUSEINFO_FAKE_LISTENER: path.join(__dirname, 'fake-listener.js'), MOUSEINFO_SCENARIO: scenario, MOUSEINFO_CORE_DIR: path.join(__dirname, 'fixtures', 'core') }) });
    });
    wss.on('connection', s => {
      sock = s;
      s.on('message', raw => {
        const m = JSON.parse(raw); sent.push(m);
        if (m.event === 'registerPlugin') {
          s.send(JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: opts.globals || {} } }));
          for (const [ctx, act, col, row, st] of DECK) {
            s.send(JSON.stringify({ event: 'willAppear', action: 'com.clarkyau.mouseinfo.' + act, context: ctx, device: 'DEV', payload: { coordinates: reported(col, row), settings: st } }));
          }
          setTimeout(() => {
            s.send(JSON.stringify({ event: 'keyDown', action: 'com.clarkyau.mouseinfo.mouse', context: 'm1', device: 'DEV', payload: {} }));
            s.send(JSON.stringify({ event: 'propertyInspectorDidAppear', action: 'com.clarkyau.mouseinfo.setup', context: 'setup', device: 'DEV', payload: {} }));
            s.send(JSON.stringify({ event: 'sendToPlugin', action: 'com.clarkyau.mouseinfo.mouse', context: 'm2', payload: { type: 'hello' } }));
          }, 900);
          if (opts.pressSetup) setTimeout(() => s.send(JSON.stringify({ event: 'keyDown', action: 'com.clarkyau.mouseinfo.setup', context: 'setup', device: 'DEV', payload: {} })), 1200);
        }
        if (m.event === 'setImage') images.set(m.context, m.payload.image);
        if (m.event === 'sendToPropertyInspector') piStates.push(m);
      });
    });
    setTimeout(() => {
      try { sock && sock.close(); } catch (e) { }
      setTimeout(() => {
        try { plugin.kill(); } catch (e) { }
        wss.close();
        const log = fs.existsSync(path.join(dir, 'plugin.log')) ? fs.readFileSync(path.join(dir, 'plugin.log'), 'utf8') : '';
        resolve({ images, sent, piStates, log, dir, diagGone: !fs.existsSync(path.join(dir, 'diag')) });
      }, 700);
    }, opts.wait || 2200);
  });
}

function deckPreview(images, title, file) {
  const K = 144, G = 28, side = 52, pad = 36;
  const W = pad * 2 + 5 * K + 4 * G + side + K, H = pad * 2 + 3 * K + 2 * G + 40;
  let body = '<rect width="' + W + '" height="' + H + '" fill="rgb(40,42,48)"/>' +
    '<text x="' + pad + '" y="30" font-size="22" fill="rgb(220,224,230)" font-family="Inter">' + title + '</text>';
  for (const [ctx, act, col, row] of DECK) {
    const x = pad + (col === 5 ? 5 * K + 4 * G + side : col * (K + G)), y = pad + 40 + row * (K + G);
    const url = images.get(ctx);
    if (!url) { body += '<rect x="' + x + '" y="' + y + '" width="144" height="144" fill="rgb(70,0,0)"/>'; continue; }
    body += '<image x="' + x + '" y="' + y + '" width="144" height="144" href="data:image/png;base64,' + toPng(url).toString('base64') + '"/>';
  }
  // the user's Scene Shift key (top-left)
  body += '<rect x="' + pad + '" y="' + (pad + 40) + '" width="144" height="144" fill="rgb(28,30,36)"/><text x="' + (pad + 72) + '" y="' + (pad + 120) + '" font-size="20" fill="rgb(110,116,128)" text-anchor="middle" font-family="Inter">Scene key</text>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' + body + '</svg>';
  fs.writeFileSync(file, new Resvg(svg, { font: FONT }).render().asPng());
}

async function hostTests() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f));
  const scenarios = [
    ['receiver', 'Model I 2 wireless, 21 ％, profile 1 (from Glorious Core)'],
    ['cable', 'Plugged in by cable: Charging (the mouse reports nothing on the cable)'],
    ['profile', 'Profile button pressed on the mouse: profile 3'],
    ['low', 'Low battery (12 ％)'],
    ['waiting', 'Receiver found, mouse has not sent its level yet'],
    ['none', 'No mouse found'],
    ['bluetooth', 'Bluetooth mouse (MX Master 3S) through Windows'],
  ];
  for (const [sc, title] of scenarios) {
    const r = await runScenario(sc, { pressSetup: sc === 'none', wait: 2200 });
    check(sc + ': registered and every key drawn', () => {
      assert.ok(r.sent.some(m => m.event === 'registerPlugin' && m.uuid === 'PLUGIN'));
      for (const [ctx] of DECK) assert.ok(r.images.has(ctx), 'no image for ' + ctx);
    });
    check(sc + ': every key image passes the quirk checks', () => {
      for (const [ctx, url] of r.images) { const p = imageProblems(url); assert.deepStrictEqual(p, [], ctx + ': ' + p.join('; ')); }
    });
    check(sc + ': settings panel gets state', () => {
      const st = r.piStates.filter(m => m.context === 'setup').pop();
      assert.ok(st && st.payload.type === 'state' && Array.isArray(st.payload.mice));
      const m2 = r.piStates.filter(m => m.context === 'm2').pop();
      assert.strictEqual(m2.payload.role, 'connection');
    });
    check(sc + ': probe leftovers removed', () => assert.ok(r.diagGone));
    const img = c => r.images.get(c);
    if (sc === 'receiver') check('receiver: battery, connection and profile shown', () => {
      assert.ok(/Battery Model I 2 \(receiver, read\): 21/.test(r.log));
      assert.ok(img('m1').includes('>21</text>') && img('m1').includes('Low') === false);
      assert.ok(img('m2').includes('Wireless'));
      assert.ok(img('m3').includes('>1</text>') && img('m3').includes('1600 DPI') && img('m3').includes('rgb(255,38,38)'));
      assert.ok(img('p1').includes('1000 Hz'));
      assert.ok(!/DPI|Hz/.test(img('p2')));
      assert.ok(img('b1').includes('Low battery'), 'warning at 30');
    });
    if (sc === 'cable') check('cable: shows Charging, no stale number, no low warning', () => {
      assert.ok(img('m1').includes('>Charging</text>') && img('m1').includes('On cable') && !img('m1').includes('>21</text>'));
      assert.ok(img('m2').includes('Cable') && img('m2').includes('Charging'));
      assert.ok(!img('b1').includes('Low battery'));
    });
    if (sc === 'profile') check('profile: switch on the mouse shows at once', () => {
      assert.ok(/Profile switched on Model I 2 \(receiver, consumer\): 3/.test(r.log));
      assert.ok(img('m3').includes('>3</text>') && img('m3').includes('3200 DPI'));
    });
    if (sc === 'low') check('low: red warning', () => { assert.ok(img('m1').includes('Low battery')); assert.ok(img('m1').includes('rgb(58,18,20)')); });
    if (sc === 'none') check('none: setup search', () => assert.ok(/got rescan/.test(r.log)));
    if (sc === 'bluetooth') check('bluetooth: picks the mouse, not the headphones', () => {
      assert.ok(img('setup').includes('MX Master 3S') && img('m1').includes('>58</text>'));
      assert.ok(img('m3').includes('Not available'));
    });
    deckPreview(r.images, title.replace(/％/g, '%'), path.join(OUT, 'deck-' + sc + '.png'));
    fs.writeFileSync(path.join(OUT, 'log-' + sc + '.txt'), r.log);
  }
  const r = await runScenario('crash', { wait: 2500 });
  check('listener crash: restarts and setup key says so', () => {
    assert.ok((r.log.match(/Starting listener/g) || []).length >= 2, 'did not restart');
    assert.ok(r.images.get('setup').includes('not running'));
  });
}

(async () => {
  console.log('Node ' + process.version);
  units();
  await hostTests();
  console.log(passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
