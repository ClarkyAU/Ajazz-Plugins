'use strict';
// A fake Ajazz Stream Dock host: starts the built plugin, answers like the real software, records what the plugin sends.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const png = require('./png');

const NODE = process.env.NODE20 || process.execPath;
let counter = 0;

class FakeHost {
  // opts: {pkgDir, id, env, globals (object | null = never answer), globalsDelayMs, deck}
  constructor(opts) {
    this.opts = opts;
    this.id = opts.id;
    this.globals = opts.globals === undefined ? { source: 'file', poll: 10, setupSeen: true } : opts.globals;
    this.env = Object.assign({ PLUGIN_DEBUG_SVG: '1', PLUGIN_POLL_MS: '250' }, opts.env || {});
    this.deck = opts.deck || 'DECK-1';
    this.images = new Map();      // context -> latest {png, svg, inspect, count}
    this.allImages = [];          // every setImage, in order
    this.messages = [];           // every message from the plugin
    this.keys = new Map();        // context -> {action, settings}
    this.exited = false;
    this.exitCode = null;
    this.out = '';
  }

  async start() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
    this.pluginDir = path.join(this.dir, this.id + '.sdPlugin');
    fs.cpSync(path.join(this.opts.pkgDir, this.id + '.sdPlugin'), this.pluginDir, { recursive: true });
    this.wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => this.wss.on('listening', r));
    this.port = this.wss.address().port;
    this.wss.on('connection', (sock) => {
      this.sock = sock;
      sock.on('message', (d) => this.onMessage(String(d)));
    });
    const info = { application: { version: '3.10.188.226', platform: 'windows' }, devices: [{ id: this.deck, name: 'AKP153E', size: { columns: 6, rows: 3 }, type: 7 }] };
    this.child = spawn(NODE, [path.join(this.pluginDir, 'plugin/index.js'), '-port', String(this.port), '-pluginUUID', 'FAKE-UUID-' + (++counter), '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)],
      { cwd: path.join(this.pluginDir, 'plugin'), env: Object.assign({}, process.env, this.env) });
    this.child.stdout.on('data', (d) => { this.out += d; });
    this.child.stderr.on('data', (d) => { this.out += d; });
    this.child.on('exit', (code) => { this.exited = true; this.exitCode = code; });
    await this.waitFor(() => this.sock && this.messages.some((m) => m.event === 'registerPlugin'), 8000, 'plugin registers');
  }

  onMessage(raw) {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    this.messages.push(msg);
    const p = msg.payload || {};
    if (msg.event === 'getGlobalSettings' && this.globals !== null) {
      const send = () => this.send({ event: 'didReceiveGlobalSettings', payload: { settings: this.globals } });
      if (this.opts.globalsDelayMs) setTimeout(send, this.opts.globalsDelayMs); else send();
    } else if (msg.event === 'setGlobalSettings') {
      this.globals = p;
    } else if (msg.event === 'setSettings') {
      const k = this.keys.get(msg.context); if (k) k.settings = p;
    } else if (msg.event === 'setImage') {
      const m = /^data:image\/png;base64,(.*)$/.exec(p.image || '');
      const rec = { context: msg.context, png: m ? Buffer.from(m[1], 'base64') : null, dataUrl: p.image, svg: p.svg, inspect: p.inspect, at: Date.now() };
      const old = this.images.get(msg.context);
      rec.count = old ? old.count + 1 : 1;
      this.images.set(msg.context, rec);
      this.allImages.push(rec);
    }
  }

  send(obj) { if (this.sock && this.sock.readyState === 1) this.sock.send(JSON.stringify(obj)); }

  // coords are the host's {column,row}. column 5 = side screen.
  addKey(action, coords, settings) {
    const context = 'ctx-' + (++counter);
    this.keys.set(context, { action: this.id + '.' + action, settings: settings || {} });
    this.send({ event: 'willAppear', action: this.id + '.' + action, context, device: this.deck,
      payload: { settings: settings || {}, coordinates: coords, controller: 'Keypad', state: 0, isInMultiAction: false } });
    return context;
  }
  removeKey(context) { const k = this.keys.get(context); this.send({ event: 'willDisappear', action: k.action, context, device: this.deck, payload: {} }); this.keys.delete(context); }
  changeSettings(context, settings) { const k = this.keys.get(context); k.settings = settings; this.send({ event: 'didReceiveSettings', action: k.action, context, device: this.deck, payload: { settings } }); }
  press(context) { const k = this.keys.get(context); this.send({ event: 'keyDown', action: k.action, context, device: this.deck, payload: {} }); this.send({ event: 'keyUp', action: k.action, context, device: this.deck, payload: {} }); }
  openPanel(context) { const k = this.keys.get(context); this.send({ event: 'propertyInspectorDidAppear', action: k.action, context, device: this.deck }); }
  toPlugin(context, payload) { const k = this.keys.get(context); this.send({ event: 'sendToPlugin', action: k.action, context, payload }); }

  svg(context) { const i = this.images.get(context); return i ? i.svg : null; }
  lastState(context) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.event === 'sendToPropertyInspector' && m.context === context && m.payload && m.payload.type === 'state') return m.payload;
    }
    return null;
  }
  log() { try { return fs.readFileSync(path.join(this.pluginDir, 'plugin.log'), 'utf8'); } catch (e) { return ''; } }

  async waitFor(fn, ms, what) {
    const end = Date.now() + (ms || 6000);
    while (Date.now() < end) {
      let ok = false;
      try { ok = fn(); } catch (e) { ok = false; }
      if (ok) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('Timed out waiting for: ' + (what || fn.toString()) + '\n--- plugin log ---\n' + this.log() + '\n--- output ---\n' + this.out);
  }
  async sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }

  async stop() {
    if (this.child && !this.exited) { try { this.child.kill(); } catch (e) { /* ignore */ } }
    try { this.wss.close(); } catch (e) { /* ignore */ }
    if (this.sock) { try { this.sock.terminate(); } catch (e) { /* ignore */ } }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

module.exports = { FakeHost, png };
