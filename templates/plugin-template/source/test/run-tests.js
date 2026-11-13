'use strict';
// node tools/build.js && node test/run-tests.js      (tests use the BUILT plugin in build/pkg)
// Use the same Node as the Ajazz software:  NODE20=/path/to/node20 node test/run-tests.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakeHost, png } = require('./lib/fake-host');

const root = path.resolve(__dirname, '..');
const pkgDir = path.join(root, 'build', 'pkg');
const ID = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name;
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(path.join(pkgDir, ID + '.sdPlugin', 'plugin', 'index.js'))) {
  console.error('Build first: node tools/build.js');
  process.exit(2);
}

// ---- helpers -------------------------------------------------------------------
function texts(svg) {
  const out = [];
  String(svg || '').replace(/<text[^>]*>([^<]*)<\/text>/g, (m, t) => { out.push(t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); return m; });
  return out;
}
function has(svg, t) { return texts(svg).indexOf(t) >= 0; }
function writeSource(file, obj) { fs.writeFileSync(file, JSON.stringify(obj)); }
const MOUSE = { id: 'a', name: 'Mouse', value: 42, charging: false };

// Every picture must be a valid 144x144 PNG, not blank (unless blank on purpose), no text under 19, nothing outside the key.
function checkImage(rec, opts) {
  assert.ok(rec, 'no image');
  const img = png.decode(rec.png);
  assert.strictEqual(img.width, 144); assert.strictEqual(img.height, 144);
  if (!(opts && opts.blank)) assert.ok(png.inkShare(img) > 0.005, 'picture is blank');
  assert.ok(rec.inspect, 'no inspect data (is PLUGIN_DEBUG_SVG set?)');
  if (rec.inspect.minFont != null) assert.ok(rec.inspect.minFont >= 19, 'text under 19 px: ' + rec.inspect.minFont);
  const b = rec.inspect.box;
  if (b) {
    const t = 0.6;
    assert.ok(b.x >= -t && b.y >= -t && b.x + b.width <= 144 + t && b.y + b.height <= 144 + t, 'drawing leaves the key: ' + JSON.stringify(b));
  }
}

async function withHost(opts, fn) {
  const h = new FakeHost(Object.assign({ pkgDir, id: ID }, opts));
  await h.start();
  try { await fn(h); }
  finally {
    const log = h.log();
    await h.stop();
    if (/\[ERROR\]/.test(log)) throw new Error('The plugin logged an error:\n' + log.split('\n').filter((l) => /ERROR/.test(l)).join('\n'));
  }
}
// Hosts need the source file path before the plugin starts, so scenarios build it first.
function sourceEnv(items, status) {
  const file = path.join(require('os').tmpdir(), 'plugin-src-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  writeSource(file, { status: status || 'ok', items });
  return { file, env: { PLUGIN_SOURCE_FILE: file } };
}

// ---- scenarios -------------------------------------------------------------------
const scenarios = [];
function scenario(name, fn) { scenarios.push({ name, fn }); }

scenario('layout: positions, joining, side screen', async () => {
  const { realPosition, groupKeys } = require('../src/plugin/layout');
  assert.deepStrictEqual(realPosition({ column: 0, row: 0 }), { col: 4, row: 0, side: false });
  assert.deepStrictEqual(realPosition({ column: 1, row: 0 }), { col: 4, row: 1, side: false });
  assert.deepStrictEqual(realPosition({ column: 3, row: 2 }), { col: 0, row: 1, side: false });
  assert.strictEqual(realPosition({ column: 5, row: 1 }).side, true);
  const k = (context, col, row, side, join) => ({ context, device: 'D', col, row, side: !!side, join });
  const g = groupKeys([k('a', 4, 0), k('b', 4, 1), k('c', 4, 2), k('d', 0, 0)]);
  assert.deepStrictEqual(g.get('a'), { index: 0, size: 3 });
  assert.deepStrictEqual(g.get('c'), { index: 2, size: 3 });
  assert.deepStrictEqual(g.get('d'), { index: 0, size: 1 });
  const g2 = groupKeys([k('a', 4, 0), k('b', 4, 1, false, false), k('c', 4, 2)]);
  assert.deepStrictEqual(g2.get('b'), { index: 0, size: 1 }, 'join:false key stands alone');
  assert.deepStrictEqual(g2.get('a'), { index: 0, size: 1 });
  const g3 = groupKeys([k('m', 4, 0), k('s', 5, 0, true)]);
  assert.strictEqual(g3.get('m').size, 1, 'main keys and the side screen never join');
  assert.strictEqual(g3.get('s').size, 1);
});

scenario('start: registers, asks for settings, drawing engine ready', async () => {
  await withHost({ globals: { source: 'demo', poll: 10, setupSeen: true } }, async (h) => {
    await h.waitFor(() => h.messages.some((m) => m.event === 'getGlobalSettings'), 4000, 'asks for global settings');
    await h.waitFor(() => /Drawing engine ready/.test(h.log()), 6000, 'engine ready');
    assert.ok(/Starting .* 1\.0\.0/.test(h.log()), 'log has the version');
    assert.ok(/Registered with Stream Dock/.test(h.log()));
  });
});

scenario('no Setup key on the deck: other keys say "Add the Setup key"', async () => {
  await withHost({ globals: { source: 'demo', poll: 10, setupSeen: false } }, async (h) => {
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => has(h.svg(a), 'Setup key'), 6000, 'notice drawn');
    assert.ok(has(h.svg(a), 'Add the'));
    checkImage(h.images.get(a));
  });
});

scenario('with a Setup key: Setup says Connected, value key shows the number', async () => {
  const s = sourceEnv([MOUSE]);
  await withHost({ env: s.env, globals: { source: 'file', poll: 10, setupSeen: true } }, async (h) => {
    const setup = h.addKey('setup', { column: 4, row: 2 });
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => has(h.svg(setup), 'Connected'), 6000, 'setup connected');
    await h.waitFor(() => has(h.svg(a), '42'), 6000, 'value shown');
    assert.ok(has(h.svg(a), 'Mouse'), 'name shown');
    assert.ok(!texts(h.svg(a)).some((t) => t.indexOf('%') >= 0), 'no % glyph');
    assert.ok(/<circle/.test(h.svg(a)), '% is drawn as shapes');
    [setup, a].forEach((c) => checkImage(h.images.get(c)));
    // value changes -> redraw; at or below the low level the key turns red
    writeSource(s.file, { status: 'ok', items: [Object.assign({}, MOUSE, { value: 17 })] });
    await h.waitFor(() => has(h.svg(a), '17'), 6000, 'new value');
    assert.ok(h.svg(a).indexOf('rgb(248,81,73)') >= 0, 'low value is red');
    // charging
    writeSource(s.file, { status: 'ok', items: [Object.assign({}, MOUSE, { value: 17, charging: true })] });
    await h.waitFor(() => has(h.svg(a), 'Charging'), 6000, 'charging label');
    checkImage(h.images.get(a));
  });
});

scenario('joined keys: Automatic gives Value then Status, only one name, Join off stands alone', async () => {
  const s = sourceEnv([MOUSE]);
  await withHost({ env: s.env }, async (h) => {
    h.addKey('setup', { column: 4, row: 2 });
    const a = h.addKey('example', { column: 0, row: 0 });
    const b = h.addKey('example', { column: 1, row: 0 }); // directly below a on the real deck
    await h.waitFor(() => has(h.svg(a), '42') && has(h.svg(b), 'Status'), 6000, 'group drawn');
    assert.ok(has(h.svg(a), 'Mouse'));
    assert.ok(!has(h.svg(b), 'Mouse'), 'second key of the group does not show the name');
    assert.ok(has(h.svg(b), 'OK'));
    h.changeSettings(b, { shows: 'value' }); // two Value keys in one group: still only one name
    await h.waitFor(() => has(h.svg(b), '42') && !has(h.svg(b), 'Status'), 6000, 'b forced to Value');
    assert.ok(!has(h.svg(b), 'Mouse'), 'only the first key of a joined group shows the name');
    assert.ok(has(h.svg(a), 'Mouse'));
    h.changeSettings(b, { join: false });
    await h.waitFor(() => has(h.svg(b), '42') && has(h.svg(b), 'Mouse'), 6000, 'b stands alone');
    h.changeSettings(b, { shows: 'status' });
    await h.waitFor(() => has(h.svg(b), 'Status'), 6000, 'b forced to Status');
    [a, b].forEach((c) => checkImage(h.images.get(c)));
  });
});

scenario('per-key display switches: name, icon', async () => {
  const s = sourceEnv([MOUSE]);
  await withHost({ env: s.env }, async (h) => {
    h.addKey('setup', { column: 4, row: 2 });
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => has(h.svg(a), 'Mouse'), 6000);
    assert.ok(h.svg(a).indexOf('translate(49 8)') >= 0, 'icon drawn by default');
    h.changeSettings(a, { showName: false });
    await h.waitFor(() => !has(h.svg(a), 'Mouse') && has(h.svg(a), '42'), 6000, 'name hidden');
    checkImage(h.images.get(a));
    h.changeSettings(a, { showName: false, showIcon: false });
    await h.waitFor(() => h.svg(a).indexOf('translate(49 8)') < 0 && has(h.svg(a), '42'), 6000, 'icon hidden');
    checkImage(h.images.get(a));
    h.changeSettings(a, { low: 'off' });
    await h.waitFor(() => has(h.svg(a), 'Mouse'), 6000);
  });
});

scenario('source trouble: "Finish the Setup key", then "Not found" keeps the last value', async () => {
  const s = sourceEnv([MOUSE]);
  await withHost({ env: s.env }, async (h) => {
    const setup = h.addKey('setup', { column: 4, row: 2 });
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => has(h.svg(a), '42'), 6000);
    writeSource(s.file, { status: 'nosource', items: [] });
    await h.waitFor(() => has(h.svg(a), 'Finish the') && has(h.svg(setup), 'No source'), 6000, 'trouble shown');
    checkImage(h.images.get(a)); checkImage(h.images.get(setup));
    writeSource(s.file, { status: 'ok', items: [] }); // source works but the item is gone
    await h.waitFor(() => has(h.svg(a), 'Not found'), 6000, 'not found');
    assert.ok(has(h.svg(a), '42'), 'last value kept');
    checkImage(h.images.get(a));
    writeSource(s.file, { status: 'ok', items: [MOUSE] });
    await h.waitFor(() => has(h.svg(a), 'Mouse'), 6000, 'recovers');
    await h.sleep(2300); // last readings are saved to data/last.json
    assert.ok(fs.existsSync(path.join(h.pluginDir, 'data', 'last.json')), 'data/last.json saved');
  });
});

scenario('long names are shrunk, never under 19 px, never outside the key', async () => {
  const s = sourceEnv([{ id: 'a', name: 'An extremely long device name', value: 88, charging: false }]);
  await withHost({ env: s.env }, async (h) => {
    h.addKey('setup', { column: 4, row: 2 });
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => has(h.svg(a), '88'), 6000);
    assert.ok(texts(h.svg(a)).some((t) => /…$/.test(t)), 'long name ends with an ellipsis');
    checkImage(h.images.get(a));
  });
});

scenario('settings panel messages: state, per-key settings, global settings, search again', async () => {
  const s = sourceEnv([MOUSE]);
  await withHost({ env: s.env }, async (h) => {
    const setup = h.addKey('setup', { column: 4, row: 2 });
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => has(h.svg(a), '42'), 6000);
    h.openPanel(a);
    await h.waitFor(() => h.lastState(a), 4000, 'state sent to the panel');
    let st = h.lastState(a);
    assert.strictEqual(st.role, 'value'); assert.strictEqual(st.status, 'ok');
    assert.ok(st.items.some((i) => i.name === 'Mouse')); assert.ok(st.sources.some((x) => x.id === 'demo'));
    h.toPlugin(a, { type: 'settings', settings: { showName: false } });
    await h.waitFor(() => !has(h.svg(a), 'Mouse'), 6000, 'panel setting applied');
    h.toPlugin(a, { type: 'global', settings: { source: 'file', poll: 30 } });
    h.openPanel(setup);
    await h.waitFor(() => { const x = h.lastState(setup); return x && x.global.poll === 30; }, 4000, 'global poll updated');
    writeSource(s.file, { status: 'ok', items: [Object.assign({}, MOUSE, { value: 55 })] });
    h.toPlugin(setup, { type: 'rescan' });
    await h.waitFor(() => has(h.svg(a), '55'), 6000, 'rescan');
  });
});

scenario('side screen key draws and never joins a main key', async () => {
  const s = sourceEnv([MOUSE]);
  await withHost({ env: s.env }, async (h) => {
    h.addKey('setup', { column: 4, row: 2 });
    const main = h.addKey('example', { column: 3, row: 2 });
    const side = h.addKey('example', { column: 5, row: 0 });
    await h.waitFor(() => has(h.svg(side), '42') && has(h.svg(main), '42'), 6000);
    assert.ok(has(h.svg(side), 'Mouse') && has(h.svg(main), 'Mouse'), 'both are groups of one, both show the name');
    checkImage(h.images.get(side));
  });
});

scenario('settings late or missing: waiting picture first, defaults after 2.5 s', async () => {
  await withHost({ globalsDelayMs: 800, globals: { source: 'demo', poll: 10, setupSeen: false } }, async (h) => {
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => h.svg(a), 4000, 'first picture');
    assert.strictEqual(texts(h.svg(a)).length, 0, 'waiting picture has no text');
    checkImage(h.images.get(a));
    await h.waitFor(() => has(h.svg(a), 'Setup key'), 6000, 'real picture after settings');
  });
  await withHost({ globals: null }, async (h) => {
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => /Saved settings did not arrive/.test(h.log()), 6000, 'defaults used');
    await h.waitFor(() => has(h.svg(a), 'Setup key'), 4000, 'notice with default settings');
  });
});

scenario('host closes the connection: plugin logs it and exits', async () => {
  const s = sourceEnv([MOUSE]);
  await withHost({ env: s.env }, async (h) => {
    h.addKey('setup', { column: 4, row: 2 });
    const a = h.addKey('example', { column: 0, row: 0 });
    await h.waitFor(() => has(h.svg(a), '42'), 6000);
    h.sock.close();
    await h.waitFor(() => h.exited, 6000, 'plugin exits');
    assert.ok(/Host closed connection/.test(h.log()));
  });
});

scenario('no "%" glyph and no text under 19 px in any picture of a full deck; writes preview', async () => {
  const s = sourceEnv([MOUSE, { id: 'b', name: 'Keyboard', value: 8, charging: false }, { id: 'c', name: 'Headset', value: 100, charging: true }]);
  await withHost({ env: s.env }, async (h) => {
    // at(col, row): a key by the plugin's own numbering (col 0-4, row 0-2; reading order = row, then col).
    // The host reports a different numbering, so convert back: index = (4 - col) * 3 + row, column = index % 5, row = floor(index / 5).
    const at = (col, row) => { const i = (4 - col) * 3 + row; return { column: i % 5, row: Math.floor(i / 5) }; };
    const keys = {
      setup: h.addKey('setup', at(4, 2)),
      a: h.addKey('example', at(0, 0), { item: 'a' }),            // a + b + c are one joined group:
      b: h.addKey('example', at(1, 0), { item: 'a' }),            // reading order a (Value), b (Status), c (blank: no third role)
      c: h.addKey('example', at(0, 1), { item: 'b' }),
      d: h.addKey('example', at(3, 0), { item: 'c' }),            // charging, alone
      e: h.addKey('example', at(2, 1), { item: 'a', showName: false }),
      f: h.addKey('example', at(3, 2), { item: 'a', showIcon: false, join: false }),
      g: h.addKey('example', at(1, 2), { item: 'zzz' }),          // item that does not exist
      side: h.addKey('example', { column: 5, row: 0 }, { item: 'c' })
    };
    await h.waitFor(() => Object.values(keys).every((c) => h.images.get(c)), 8000, 'all keys drawn');
    await h.sleep(1200);
    h.allImages.forEach((rec) => {
      assert.ok(!texts(rec.svg).some((t) => t.indexOf('%') >= 0), 'a "%" glyph was drawn');
      checkImage(rec, { blank: !rec.svg || texts(rec.svg).length === 0 && !/<circle|<rect x/.test(rec.svg) });
    });
    // preview image of the whole deck (the plugin's own numbering, col 0-4 across, row 0-2 down, plus the side column)
    const { Resvg, initWasm } = require('@resvg/resvg-wasm');
    try { await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))); } catch (e) { /* already started */ }
    const cell = 150, pad = 12;
    const pos = { setup: [4, 2], a: [0, 0], b: [1, 0], c: [0, 1], d: [3, 0], e: [2, 1], f: [3, 2], g: [1, 2], side: [5, 0] };
    let body = '<rect width="100%" height="100%" fill="rgb(10,11,13)"/>';
    for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) body += '<rect x="' + (pad + c * cell) + '" y="' + (pad + r * cell) + '" width="144" height="144" rx="10" fill="rgb(30,32,36)"/>';
    Object.keys(pos).forEach((k) => { body += '<image x="' + (pad + pos[k][0] * cell) + '" y="' + (pad + pos[k][1] * cell) + '" width="144" height="144" href="' + h.images.get(keys[k]).dataUrl + '"/>'; });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (pad * 2 + cell * 6) + '" height="' + (pad * 2 + cell * 3) + '">' + body + '</svg>';
    fs.writeFileSync(path.join(outDir, 'deck-preview.png'), new Resvg(svg).render().asPng());
  });
});

scenario('settings panel in headless Chromium', async () => { await require('./panel-test').run({ pkgDir, id: ID, outDir }); });
scenario('installer under PowerShell 7: install, update, uninstall keeps data', async () => { await require('./installer-test').run({ pkgDir, id: ID }); });

// ---- runner ----------------------------------------------------------------------
(async () => {
  const only = process.argv[2];
  let failed = 0, ran = 0;
  const t0 = Date.now();
  for (const s of scenarios) {
    if (only && s.name.indexOf(only) < 0) continue;
    ran++;
    const t = Date.now();
    try { await s.fn(); console.log('PASS  ' + s.name + '  (' + ((Date.now() - t) / 1000).toFixed(1) + ' s)'); }
    catch (e) { failed++; console.log('FAIL  ' + s.name + '\n      ' + String(e && e.message || e).split('\n').join('\n      ')); }
  }
  if (ran === 0) { console.log('No scenario matches "' + only + '"'); process.exit(1); }
  console.log('\n' + (failed ? failed + ' FAILED' : 'All passed') + ' in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  process.exit(failed ? 1 : 0);
})();
