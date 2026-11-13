'use strict';
// Opens the real settings page (pi/index.html) in headless Chromium and talks to it like the Ajazz software does.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { WebSocketServer } = require('ws');

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Chromium not found. Set CHROME=/path/to/chrome');
}

async function run(o) {
  const page = path.join(o.pkgDir, o.id + '.sdPlugin', 'pi', 'index.html');
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;
  const got = [];
  let sock = null, settings = {}, globals = { source: 'demo', poll: 10, setupSeen: true };
  const items = [{ id: 'a', name: 'Mouse', value: 42, present: true }, { id: 'b', name: 'Keyboard', value: 8, present: true }];
  const stateFor = (role) => ({ type: 'state', global: globals, role, groupSize: 2, status: 'ok', statusText: 'Connected', note: 'Made-up numbers.',
    sources: [{ id: 'demo', name: 'Demo (built in)' }, { id: 'file', name: 'Test file' }], items, current: items[0], version: '1.0.0' });
  const send = (obj) => sock && sock.readyState === 1 && sock.send(JSON.stringify(obj));
  let role = 'value';
  wss.on('connection', (s) => {
    sock = s;
    s.on('message', (d) => {
      const m = JSON.parse(String(d)); got.push(m);
      if (m.event === 'getSettings') send({ event: 'didReceiveSettings', payload: { settings } });
      if (m.event === 'getGlobalSettings') send({ event: 'didReceiveGlobalSettings', payload: { settings: globals } });
      if (m.event === 'sendToPlugin' && m.payload.type === 'hello') send({ event: 'sendToPropertyInspector', payload: stateFor(role) });
    });
  });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const wait = async (fn, what, ms) => { const end = Date.now() + (ms || 4000); while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 40)); } throw new Error('Timed out: ' + what); };
  try {
    async function open(action, setts) {
      got.length = 0; settings = setts || {};
      const p = await browser.newPage();
      await p.setViewport({ width: 320, height: 640 });
      const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await p.goto('file://' + page);
      await p.evaluate((port, action, settings) => {
        window.connectElgatoStreamDeckSocket(port, 'PI-UUID', 'registerPropertyInspector', '{}', JSON.stringify({ action, payload: { settings } }));
      }, port, action, settings);
      p.errors = errors;
      return p;
    }
    const vis = (p, id) => p.evaluate((id) => !document.getElementById(id).classList.contains('hidden'), id);
    const val = (p, id) => p.evaluate((id) => { const e = document.getElementById(id); return e.type === 'checkbox' ? e.checked : e.value; }, id);
    const lastOf = (ev) => { for (let i = got.length - 1; i >= 0; i--) if (got[i].event === ev) return got[i].payload; return null; };

    // ---- a normal key: only its own options ----
    let p = await open('com.clarkyau.starter.example', {});
    await wait(async () => (await p.evaluate(() => document.getElementById('statusText').textContent)) === 'Connected', 'status text');
    assert.ok(await vis(p, 'sec-key')); assert.ok(!(await vis(p, 'sec-setup')), 'Setup options are not shown on a normal key');
    assert.strictEqual(await val(p, 'shows'), 'auto');
    assert.strictEqual(await val(p, 'join'), true);
    assert.ok(/Value/.test(await p.evaluate(() => document.getElementById('showsHint').textContent)), 'Automatic hint names Value');
    assert.ok(await vis(p, 'sec-display') && await vis(p, 'sec-low'));
    assert.deepStrictEqual(await p.evaluate(() => Array.from(document.getElementById('item').options).map((x) => x.textContent)), ['Automatic', 'Mouse', 'Keyboard']);
    await p.screenshot({ path: path.join(o.outDir, 'panel-key.png') });
    await p.select('#shows', 'status');
    await wait(async () => lastOf('setSettings') && lastOf('setSettings').shows === 'status', 'setSettings shows=status');
    assert.ok(got.some((m) => m.event === 'sendToPlugin' && m.payload.type === 'settings' && m.payload.settings.shows === 'status'), 'plugin told too');
    assert.ok(!(await vis(p, 'sec-display')), 'Display options hidden when the key shows Status');
    await p.select('#shows', 'value');
    await p.click('#showName');
    await wait(async () => lastOf('setSettings') && lastOf('setSettings').showName === false, 'showName off saved');
    await p.click('#join');
    await wait(async () => lastOf('setSettings').join === false, 'join off saved');
    await p.select('#item', 'b');
    await wait(async () => lastOf('setSettings').item === 'b', 'item saved');
    await p.select('#shows', 'auto');
    await wait(async () => lastOf('setSettings').shows === undefined, 'Automatic removes the shows setting');

    // ---- an open control must never be rebuilt by the 3-second state updates ----
    await p.focus('#item');
    await p.evaluate(() => { document.getElementById('item').options[0].marker = 'same'; });
    items.push({ id: 'c', name: 'Headset', value: 90, present: true });
    send({ event: 'sendToPropertyInspector', payload: stateFor('value') });
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(await p.evaluate(() => document.getElementById('item').options[0].marker), 'same', 'focused select was rebuilt');
    await p.evaluate(() => document.getElementById('item').blur());
    send({ event: 'sendToPropertyInspector', payload: stateFor('value') });
    await wait(async () => (await p.evaluate(() => document.getElementById('item').options.length)) === 4, 'new item appears once the select is closed');
    assert.deepStrictEqual(p.errors, [], 'page errors: ' + p.errors.join('; '));
    await p.close();

    // ---- the Setup key: all the source options ----
    p = await open('com.clarkyau.starter.setup', {});
    await wait(async () => (await p.evaluate(() => document.getElementById('found').textContent)).indexOf('Mouse') >= 0, 'found table');
    assert.ok(await vis(p, 'sec-setup')); assert.ok(!(await vis(p, 'sec-key')));
    assert.deepStrictEqual(await p.evaluate(() => Array.from(document.getElementById('source').options).map((x) => x.value)), ['demo', 'file']);
    assert.strictEqual(await val(p, 'poll'), '10');
    await p.screenshot({ path: path.join(o.outDir, 'panel-setup.png') });
    await p.select('#poll', '30');
    await wait(async () => lastOf('setGlobalSettings') && lastOf('setGlobalSettings').poll === 30, 'poll saved as a global setting');
    await p.select('#source', 'file');
    await wait(async () => lastOf('setGlobalSettings').source === 'file', 'source saved');
    await p.click('#rescan');
    await wait(async () => got.some((m) => m.event === 'sendToPlugin' && m.payload.type === 'rescan'), 'search again sent');
    assert.deepStrictEqual(p.errors, [], 'page errors: ' + p.errors.join('; '));
    await p.close();
  } finally {
    await browser.close();
    wss.close();
  }
}

module.exports = { run };
