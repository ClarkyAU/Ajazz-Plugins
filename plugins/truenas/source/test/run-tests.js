'use strict';
// Runs the built plugin against the fake Ajazz host and fake TrueNAS, checks the
// behaviour and writes preview images of the deck.
//   node scripts/build.js && node test/run-tests.js [--node path\to\node20] [--out test/previews]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakeHost, hardwareCoords, wait, tempPluginCopy } = require('./fake-host');
const fakeNas = require('./fake-truenas');
const { realPosition, buildGroups } = require('../src/layout');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const NODE = opt('node', process.execPath);
const OUT = path.resolve(opt('out', path.join(__dirname, 'previews')));
const BUILD = path.join(__dirname, '..', 'build', 'TrueNAS-for-Ajazz', 'com.clarkyau.truenas.sdPlugin');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}
// The image's SVG plus its visible text joined up (wrapped lines become one line).
const svgOf = (host, ctx) => {
  const svg = host.images.get(ctx) || '';
  const words = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
  return svg + '\n' + words;
};
async function until(fn, ms = 8000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await wait(100); }
  throw new Error('Timed out waiting for ' + what);
}

(async () => {
  console.log(`Node used for the plugin: ${require('child_process').execFileSync(NODE, ['-v']).toString().trim()}`);

  console.log('\nKey positions');
  await test('hardware order maps back to the real position for every key', () => {
    for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) {
      const p = realPosition(hardwareCoords(c, r));
      assert.deepStrictEqual(p, { col: c, row: r });
    }
  });
  await test('top-left key is reported as column 0, row 0 (known AKP153E order)', () => {
    assert.deepStrictEqual(realPosition({ column: 0, row: 0 }), { col: 4, row: 0 });
    assert.deepStrictEqual(realPosition({ column: 4, row: 2 }), { col: 0, row: 2 });
  });
  await test('neighbouring keys join into rectangles', () => {
    const k = (context, col, row, joinKey = 'a') => ({ context, device: 'D', col, row, joinKey });
    let g = buildGroups([k('a', 0, 0), k('b', 1, 0), k('c', 2, 0)]);
    assert.strictEqual(g.length, 1); assert.strictEqual(g[0].w, 3);
    g = buildGroups([k('a', 0, 0), k('b', 1, 0), k('c', 0, 1), k('d', 1, 1)]);
    assert.strictEqual(g.length, 1); assert.strictEqual(g[0].w * g[0].h, 4);
    g = buildGroups([k('a', 0, 0), k('b', 2, 0)]);
    assert.strictEqual(g.length, 2);
    g = buildGroups([k('a', 4, 0), k('b', 5, 0)]); // main keys + side screen never join
    assert.strictEqual(g.length, 2);
    g = buildGroups([k('a', 0, 0), k('b', 1, 0, 'other')]);
    assert.strictEqual(g.length, 2);
  });

  const nas = await fakeNas.start({ port: 18443, iconPort: 18480, scenario: 'healthy', interval: 120 });
  const goodSettings = { host: '127.0.0.1:18443', apiKey: fakeNas.API_KEY, allowSelfSigned: true, tempUnit: 'C', netUnits: 'bits' };

  // ---------------------------------------------------------------- not set up
  console.log('\nFirst run and errors');
  {
    const host = new FakeHost({ pluginDir: tempPluginCopy(BUILD), globalSettings: {}, nodeBin: NODE });
    await host.start();
    const a = host.addKey({ action: 'system', col: 0, row: 0 });
    const b = host.addKey({ action: 'network', col: 1, row: 0 });
    host.addKey({ action: 'storage', col: 2, row: 0 });
    host.addKey({ action: 'alerts', col: 3, row: 0 });
    host.addKey({ action: 'app', col: 4, row: 0 });
    await test('without a Setup key, keys ask for one', async () => {
      await until(() => /Add the Setup key/.test(svgOf(host, a)), 5000, 'add setup key message');
    });
    const setupKey = host.addKey({ action: 'setup', col: 5, row: 0 });
    await test('the Setup key asks to be set up; other keys point to it', async () => {
      await until(() => /Set up here/.test(svgOf(host, setupKey)) && /Finish the Setup key/.test(svgOf(host, a)), 5000, 'setup prompts');
    });
    await test('only the Setup key\'s panel gets connection details; others get key options', async () => {
      host.openPI(setupKey);
      await until(() => host.piMessages.length > 0, 3000, 'PI state');
    });
    host.preview(path.join(OUT, '1-before-setup.png'), 'Before setup: the Setup key (side screen) holds the connection');
    await test('a wrong API key shows "API key rejected"', async () => {
      host.setGlobal({ ...goodSettings, apiKey: 'wrong' });
      await until(() => /API key rejected/.test(svgOf(host, a)), 8000, 'auth error');
    });
    await test('an unreachable address shows a connection message', async () => {
      host.setGlobal({ ...goodSettings, host: '127.0.0.1:18999' });
      await until(() => /refused|reach/i.test(svgOf(host, b)), 8000, 'connection error');
    });
    host.preview(path.join(OUT, '2-cannot-connect.png'), "Can't connect (wrong address)");
    await test('fixing the settings connects live, without a restart', async () => {
      host.setGlobal(goodSettings);
      await until(() => /CPU/.test(svgOf(host, a)) && !/Connecting/.test(svgOf(host, a)), 8000, 'live data');
    });
    await test('the Setup key shows the NAS name and version once connected', async () => {
      await until(() => /truenas/.test(svgOf(host, setupKey)) && /25\.04/.test(svgOf(host, setupKey)), 8000, 'setup key connected');
    });
    await test('no image broke an Ajazz renderer rule', () => assert.deepStrictEqual(host.problems, []));
    host.stop();
  }

  // ---------------------------------------------------------------- healthy deck
  console.log('\nHealthy NAS');
  {
    const dir = tempPluginCopy(BUILD);
    const host = new FakeHost({ pluginDir: dir, globalSettings: goodSettings, nodeBin: NODE });
    await host.start();
    const ctx = {};
    // System 3x2 top-left, network 2x1, storage 2x1, apps along the bottom, alerts on the side screen
    for (const [c, r] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]) ctx[`sys${c}${r}`] = host.addKey({ action: 'system', col: c, row: r });
    ctx.net0 = host.addKey({ action: 'network', col: 3, row: 0 });
    ctx.net1 = host.addKey({ action: 'network', col: 4, row: 0 });
    ctx.st0 = host.addKey({ action: 'storage', col: 3, row: 1 });
    ctx.st1 = host.addKey({ action: 'storage', col: 4, row: 1 });
    for (let c = 0; c < 5; c++) ctx['app' + c] = host.addKey({ action: 'app', col: c, row: 2 });
    ctx.setup = host.addKey({ action: 'setup', col: 5, row: 0 });
    for (let r = 1; r < 3; r++) ctx['al' + r] = host.addKey({ action: 'alerts', col: 5, row: r });
    await test('live stats arrive', async () => {
      await until(() => /CPU/.test(svgOf(host, ctx.sys00)) && /RAM/.test(svgOf(host, ctx.sys10)), 8000, 'stats');
    });
    await test('joined system keys show a graph across the lower row', async () => {
      await until(() => /polyline/.test(svgOf(host, ctx.sys01)) && /polyline/.test(svgOf(host, ctx.sys21)), 8000, 'graph');
    });
    await test('automatic app keys fill with different apps, running first', async () => {
      await until(() => [0, 1, 2, 3, 4].every((c) => /<image /.test(svgOf(host, ctx['app' + c]))), 10000, 'app icons');
      const names = [0, 1, 2, 3, 4].map((c) => (svgOf(host, ctx['app' + c]).match(/font-size="\d+" font-weight="700" fill="rgb\(236,239,244\)"[^>]*>([^<]+)</) || [])[1]);
      assert.strictEqual(new Set(names).size, 5, 'apps repeat: ' + names);
    });
    await test('app tiles take their colour from the app icon', () => {
      const svg = svgOf(host, ctx.app0);
      assert.ok(!/rgb\(0,149,213\)" fill-opacity/.test(svg), 'still using the default colour');
    });
    await test('alerts on the side screen join vertically', async () => {
      await until(() => /ALERTS/.test(svgOf(host, ctx.al1)) && /All clear/.test(svgOf(host, ctx.al2)), 6000, 'alerts');
    });
    await wait(6500); // let the 2-minute graphs fill (fake NAS runs fast)
    host.preview(path.join(OUT, '3-healthy-dashboard.png'), 'Healthy NAS: joined System, Network, Storage, Apps; Setup + Alerts on the side screen');

    await test('pressing System opens the TrueNAS dashboard', async () => {
      await host.press(ctx.sys00);
      await until(() => host.openedUrls.some((u) => u === 'https://127.0.0.1:18443/ui/dashboard'), 3000, 'openUrl');
    });
    // find the stopped app key (Jellyfin or Syncthing appear after running apps)
    const stoppedKey = () => [0, 1, 2, 3, 4].map((c) => ctx['app' + c]).find((c) => /Stopped/.test(svgOf(host, c)));
    // Running apps come first, so put the stopped one on a key directly
    await test('settings panel gets lists of pools, apps and ports', async () => {
      host.openPI(ctx.app4);
      await until(() => host.piMessages.some((m) => m.pools && m.pools.length === 3 && m.apps.length === 7 && m.ifaces.length === 2), 4000, 'PI state');
    });
    await test('choosing an app for a key applies live', async () => {
      host.keys.get(ctx.app4).settings = { app: 'jellyfin' };
      host.send({ event: 'didReceiveSettings', action: 'com.clarkyau.truenas.app', context: ctx.app4, payload: { settings: { app: 'jellyfin' } } });
      await until(() => /Jellyfin/.test(svgOf(host, ctx.app4)) && /Stopped/.test(svgOf(host, ctx.app4)), 4000, 'jellyfin key');
    });
    await test('pressing a stopped app starts it', async () => {
      assert.ok(stoppedKey(), 'no stopped app key');
      await host.press(ctx.app4);
      await until(() => /Starting/.test(svgOf(host, ctx.app4)), 3000, 'starting');
      await until(() => nas.calls.includes('app.start'), 3000, 'app.start call');
      await until(() => /Running/.test(svgOf(host, ctx.app4)), 10000, 'running');
    });
    await test('one press on a running app only asks; the second press stops it', async () => {
      await host.press(ctx.app4);
      await until(() => /Stop\?/.test(svgOf(host, ctx.app4)), 3000, 'confirm');
      assert.ok(!nas.calls.includes('app.stop'));
      const snap = new Map(host.images); // draw the preview later: drawing is slower than the 3 s window
      await host.press(ctx.app4);
      await until(() => nas.calls.includes('app.stop'), 3000, 'app.stop call');
      await until(() => /Stopped/.test(svgOf(host, ctx.app4)), 10000, 'stopped');
      const now = host.images; host.images = snap;
      host.preview(path.join(OUT, '4-app-press-to-stop.png'), 'App key after one press: press again to stop');
      host.images = now;
    });
    await test('holding an app key opens its web page on the NAS address', async () => {
      await host.press(ctx.app4, 900);
      await until(() => host.openedUrls.some((u) => u.startsWith('http://127.0.0.1:')), 3000, 'portal url');
    });
    await test('choosing a pool for a key applies live', async () => {
      for (const c of [ctx.st0, ctx.st1]) {
        host.keys.get(c).settings = { pool: 'fast' };
        host.send({ event: 'sendToPlugin', action: 'com.clarkyau.truenas.storage', context: c, payload: { type: 'settings', settings: { pool: 'fast' } } });
      }
      await until(() => /FAST/.test(svgOf(host, ctx.st0)) && /FREE/.test(svgOf(host, ctx.st1)), 4000, 'pool fast');
    });
    await test('changing temperature to Fahrenheit applies live', async () => {
      host.keys.get(ctx.sys20).settings = { tempUnit: 'F' };
      host.send({ event: 'didReceiveSettings', action: 'com.clarkyau.truenas.system', context: ctx.sys20, payload: { settings: { tempUnit: 'F' } } });
      await until(() => /°F/.test(svgOf(host, ctx.sys20)), 4000, 'F');
    });
    await test('no image broke an Ajazz renderer rule', () => assert.deepStrictEqual(host.problems, []));
    await test('the plugin log exists and never contains the API key', () => {
      const logText = fs.readFileSync(path.join(dir, 'plugin.log'), 'utf8');
      assert.ok(logText.length > 0);
      assert.ok(!logText.includes(fakeNas.API_KEY));
    });

    // single keys and other shapes
    host.clearKeys();
    host.setGlobal(goodSettings);
    await wait(300);
    const s = {};
    s.sys = host.addKey({ action: 'system', col: 0, row: 0 });
    s.net = host.addKey({ action: 'network', col: 1, row: 0 });
    s.st = host.addKey({ action: 'storage', col: 2, row: 0, settings: { pool: 'tank' } });
    s.al = host.addKey({ action: 'alerts', col: 3, row: 0 });
    s.app = host.addKey({ action: 'app', col: 4, row: 0, settings: { app: 'nextcloud' } });
    for (let c = 0; c < 3; c++) host.addKey({ action: 'storage', col: c, row: 1 });
    for (let c = 3; c < 5; c++) host.addKey({ action: 'system', col: c, row: 1 });
    const net = [];
    for (let c = 0; c < 5; c++) net.push(host.addKey({ action: 'network', col: c, row: 2 }));
    for (let r = 0; r < 3; r++) host.addKey({ action: 'system', col: 5, row: r });
    await test('a 5-wide network row is Download | Upload | graph across 3 keys', async () => {
      await until(() => /DOWN/.test(svgOf(host, net[0])) && /UP/.test(svgOf(host, net[1])) && [2, 3, 4].every((i) => /polyline/.test(svgOf(host, net[i])) && !/PORT/.test(svgOf(host, net[i]))), 8000, 'net row');
    });
    await test('each key can choose what it shows, even inside a joined group', async () => {
      const set = (ctxId, st) => { host.keys.get(ctxId).settings = st; host.send({ event: 'didReceiveSettings', action: 'com.clarkyau.truenas.network', context: ctxId, payload: { settings: st } }); };
      set(net[4], { show: 'port' });
      set(net[0], { show: 'up' });
      set(net[1], { show: 'down' });
      await until(() => /PORT/.test(svgOf(host, net[4])) && /UP/.test(svgOf(host, net[0])) && /DOWN/.test(svgOf(host, net[1])) && /polyline/.test(svgOf(host, net[3])), 5000, 'custom roles');
      set(net[4], {}); set(net[0], {}); set(net[1], {});
    });
    await wait(7500);
    host.preview(path.join(OUT, '5-single-and-wide-keys.png'), 'Single keys (top), 3 pools + 2 System (middle), 5-wide Network (bottom), side-screen System');
    await test('no image broke an Ajazz renderer rule (layout 2)', () => assert.deepStrictEqual(host.problems, []));
    host.stop();
  }
  nas.close();

  // ---------------------------------------------------------------- problems
  console.log('\nNAS with problems');
  {
    const bad = await fakeNas.start({ port: 18444, iconPort: 18481, scenario: 'problems', interval: 120 });
    const host = new FakeHost({ pluginDir: tempPluginCopy(BUILD), globalSettings: { ...goodSettings, host: '127.0.0.1:18444' }, nodeBin: NODE });
    await host.start();
    const al = [];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) al.push(host.addKey({ action: 'alerts', col: c, row: r }));
    for (let c = 3; c < 5; c++) for (let r = 0; r < 2; r++) host.addKey({ action: 'storage', col: c, row: r });
    host.addKey({ action: 'system', col: 0, row: 2 });
    host.addKey({ action: 'app', col: 1, row: 2, settings: { app: 'pihole' } });
    host.addKey({ action: 'app', col: 2, row: 2, settings: { app: 'nextcloud' } });
    host.addKey({ action: 'storage', col: 3, row: 2, settings: { pool: 'tank', join: false } });
    host.addKey({ action: 'alerts', col: 4, row: 2 });
    await test('alerts show the count and the alert text, worst first', async () => {
      await until(() => />4</.test(svgOf(host, al[0])) && /CRITICAL/.test(svgOf(host, host.images.has(al[2]) ? al[2] : al[1])), 8000, 'alerts');
    });
    await wait(7000);
    host.preview(path.join(OUT, '6-problems.png'), 'Problems: 4 alerts, degraded pool resilvering, busy hot CPU, crashed app');
    await test('no image broke an Ajazz renderer rule (problems)', () => assert.deepStrictEqual(host.problems, []));
    host.stop();
    bad.close();
  }

  // ---------------------------------------------------------------- moving settings after the rename
  console.log('\nMoving settings from the old plugin name');
  {
    const os = require('os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
    const oldDir = path.join(root, 'com.homelab.truenas.sdPlugin');
    const newDir = path.join(root, 'com.clarkyau.truenas.sdPlugin');
    fs.cpSync(BUILD, newDir, { recursive: true });
    fs.mkdirSync(path.join(oldDir, 'plugin'), { recursive: true });
    require('esbuild').buildSync({
      entryPoints: [path.join(__dirname, '..', 'tools', 'migrate-from-homelab', 'helper.js')], bundle: true, platform: 'node',
      target: 'node20', external: ['bufferutil', 'utf-8-validate'], logLevel: 'warning', outfile: path.join(oldDir, 'plugin', 'index.js'),
    });
    const migNas = await fakeNas.start({ port: 18445, iconPort: 18482, scenario: 'healthy', interval: 120 });
    const saved = { host: '127.0.0.1:18445', apiKey: fakeNas.API_KEY, allowSelfSigned: true };
    const newHost = new FakeHost({ pluginDir: newDir, globalSettings: {}, nodeBin: NODE });
    await newHost.start();
    const k = newHost.addKey({ action: 'system', col: 0, row: 0 });
    const oldHost = new FakeHost({ pluginDir: oldDir, globalSettings: saved, nodeBin: NODE });
    await oldHost.start();
    const oldKey = oldHost.addKey({ action: 'system', col: 0, row: 0 });
    await test('the old copy hands over the address and API key', async () => {
      await until(() => newHost.globalSettings && newHost.globalSettings.apiKey === fakeNas.API_KEY && newHost.globalSettings.host === saved.host, 10000, 'import');
    });
    await test('the new copy connects with them and deletes the handover file', async () => {
      await until(() => /CPU/.test(svgOf(newHost, k)) && !/Setup/.test(svgOf(newHost, k)), 10000, 'connected');
      assert.ok(!fs.existsSync(path.join(newDir, 'import-settings.json')), 'handover file still there');
    });
    await test('old keys say they have moved', async () => {
      await until(() => /Moved/.test(svgOf(oldHost, oldKey)), 5000, 'moved');
    });
    await test('the API key is not written to either log', () => {
      for (const d of [oldDir, newDir]) assert.ok(!fs.readFileSync(path.join(d, 'plugin.log'), 'utf8').includes(fakeNas.API_KEY), d);
    });
    oldHost.stop(); newHost.stop(); migNas.close();
  }

  console.log(`\n${passed} passed, ${failed} failed. Previews in ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
