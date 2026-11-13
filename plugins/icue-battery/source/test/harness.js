'use strict';
// A fake Ajazz host: speaks the Stream Dock (Elgato-style) WebSocket protocol to the real built plugin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build', 'com.clarkyau.icuebattery.sdPlugin');
const NODE = process.env.NODE20 || process.execPath;
const ID = 'com.clarkyau.icuebattery';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// real position -> the hardware-order position the deck reports
function reported(col, row) {
  if (col >= 5) return { column: col, row };
  const idx = (4 - col) * 3 + row;
  return { column: idx % 5, row: Math.floor(idx / 5) };
}

function decode(url) {
  const prefix = 'data:image/svg+xml;charset=utf8,';
  if (!url.startsWith(prefix)) throw new Error('image is not an unencoded svg data URL');
  return url.slice(prefix.length);
}

async function start(opts) {
  opts = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icuebattery-test-'));
  const pluginDir = path.join(dir, ID + '.sdPlugin');
  fs.cpSync(BUILD, pluginDir, { recursive: true });
  const stateFile = path.join(dir, 'helper-state.json');
  if (opts.helperState) fs.writeFileSync(stateFile, JSON.stringify(opts.helperState));
  if (opts.lastKnown) {
    fs.mkdirSync(path.join(pluginDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'data', 'last.json'), JSON.stringify({ devices: opts.lastKnown }));
  }

  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;
  const host = { images: new Map(), history: [], received: [], pi: [], globals: opts.globals || {}, sockets: [], exited: false };
  let conn = null;
  const registered = new Promise((resolve) => {
    wss.on('connection', (sock) => {
      conn = sock;
      sock.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        host.received.push(msg);
        if (msg.event === 'registerPlugin') resolve();
        else if (msg.event === 'setImage') { const im = { svg: decode(msg.payload.image), url: msg.payload.image, at: Date.now(), ctx: msg.context }; host.images.set(msg.context, im); host.history.push(im); }
        else if (msg.event === 'getGlobalSettings') sock.send(JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: host.globals } }));
        else if (msg.event === 'setGlobalSettings') host.globals = msg.payload;
        else if (msg.event === 'sendToPropertyInspector') host.pi.push(msg);
      });
    });
  });

  const helperCmd = JSON.stringify({ cmd: NODE, args: [path.join(__dirname, 'fake-helper.js'), stateFile] });
  const child = spawn(NODE, [path.join(pluginDir, 'plugin', 'index.js'), '-port', String(port), '-pluginUUID', 'PLUGINUUID', '-registerEvent', 'registerPlugin',
    '-info', JSON.stringify({ application: { version: '3.10.200' }, devices: [{ id: 'deck1', name: 'AKP153E', size: { columns: 6, rows: 3 } }] })],
  { env: Object.assign({}, process.env, { ICUEBATTERY_HELPER_CMD: helperCmd }), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', () => { host.exited = true; });
  await registered;

  const api = {
    host, dir, pluginDir, stderr: () => stderr,
    log: () => { try { return fs.readFileSync(path.join(pluginDir, 'plugin.log'), 'utf8'); } catch (e) { return ''; } },
    setState(state) { fs.writeFileSync(stateFile, JSON.stringify(state)); },
    send(msg) { conn.send(JSON.stringify(msg)); },
    // keys: [{ ctx, action: 'headset'|'setup', col, row, settings }]
    appear(list) {
      list.forEach((k) => {
        api.send({
          event: 'willAppear', action: ID + '.' + (k.action || 'headset'), context: k.ctx, device: 'deck1',
          payload: { controller: k.col >= 5 ? 'Information' : 'Keypad', coordinates: reported(k.col, k.row), isInMultiAction: false, settings: k.settings || {}, state: 0 },
        });
      });
    },
    disappear(ctx) { api.send({ event: 'willDisappear', action: ID + '.headset', context: ctx, device: 'deck1', payload: {} }); },
    press(ctx, action) { api.send({ event: 'keyDown', action: ID + '.' + (action || 'headset'), context: ctx, device: 'deck1', payload: {} }); },
    setSettings(ctx, settings) { api.send({ event: 'didReceiveSettings', action: ID + '.headset', context: ctx, device: 'deck1', payload: { settings } }); },
    async settle(ms) { await sleep(ms == null ? 500 : ms); },
    svg: (ctx) => (host.images.get(ctx) || {}).svg,
    async stop() {
      try { conn.close(); } catch (e) { /* ignore */ }
      await sleep(2300);
      try { child.kill(); } catch (e) { /* ignore */ }
      wss.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return api;
}

module.exports = { start, reported, sleep, decode };
