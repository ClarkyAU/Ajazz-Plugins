'use strict';
// A stand-in for the Ajazz / Stream Dock software: runs the built plugin the
// same way (node index.js -port -pluginUUID -registerEvent -info), speaks the
// same WebSocket protocol, places keys like an AKP153E (hardware-order
// coordinates) and records every image the plugin sends.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer } = require('ws');

const { checkDataUrl, checkSvg } = require('./image-check');

const PLUGIN = path.join(__dirname, '..', 'dist', 'com.clarkyau.smarthome.sdPlugin', 'plugin', 'index.js');
const PREFIX = 'com.clarkyau.smarthome.';

/** Physical (col,row) on the AKP153E -> what the software reports.
 *  Main keys are reported in hardware order; the side screen (column 5) normally. */
function reported(col, row) {
  if (col >= 5) return { column: col, row };
  const index = (4 - col) * 3 + row;
  return { column: index % 5, row: Math.floor(index / 5) };
}

class FakeHost {
  constructor({ globals = {}, env = {}, pluginDir, script = PLUGIN, prefix = PREFIX } = {}) {
    this.script = script;
    this.prefix = prefix;
    this.globals = globals;
    this.problems = []; // image check failures
    this.svgs = new Map(); // context -> last drawing
    this.env = env;
    this.pluginDir = pluginDir || fs.mkdtempSync(path.join(os.tmpdir(), 'smarthome-plugin-'));
    this.images = new Map(); // context -> data URL
    this.imageCount = new Map();
    this.settings = new Map(); // context -> per-key settings
    this.keys = new Map(); // context -> {action, col, row}
    this.toPI = [];
    this.events = [];
    this.openUrls = [];
  }

  async start() {
    this.wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => this.wss.on('listening', r));
    const port = this.wss.address().port;
    this.connected = new Promise((resolve) => {
      this.wss.on('connection', (sock) => {
        sock.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          this.onMessage(sock, msg, resolve);
        });
      });
    });
    const info = { application: { version: '3.10.188.226' }, devices: [{ id: 'DECK1', name: 'AKP153E', type: 0, size: { columns: 6, rows: 3 } }] };
    this.proc = spawn(process.execPath, [this.script, '-port', String(port), '-pluginUUID', 'PLUGINUUID', '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)], {
      env: { ...process.env, SMARTHOME_PLUGIN_DIR: this.pluginDir, SMARTHOME_TEST_SVG: '1', ...this.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc.stderr.on('data', (d) => process.stderr.write('[plugin] ' + d));
    this.proc.stdout.on('data', (d) => process.stdout.write('[plugin] ' + d));
    await this.connected;
  }

  onMessage(sock, msg, onRegister) {
    this.events.push(msg);
    switch (msg.event) {
      case 'registerPlugin':
        this.plugin = sock;
        onRegister();
        break;
      case 'registerPropertyInspector':
        break;
      case 'getGlobalSettings':
        sock.send(JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: this.globals } }));
        break;
      case 'setGlobalSettings':
        this.globals = msg.payload;
        break;
      case 'setImage': {
        const where = this.keys.get(msg.context);
        const label = where ? `${where.action}@${where.col},${where.row}` : msg.context;
        for (const p of checkDataUrl(msg.payload.image)) this.problems.push(`${label}: ${p}`);
        if (msg.payload.svg) {
          this.svgs.set(msg.context, msg.payload.svg);
          for (const p of checkSvg(msg.payload.svg)) this.problems.push(`${label}: ${p}`);
        }
        this.images.set(msg.context, msg.payload.image);
        this.imageCount.set(msg.context, (this.imageCount.get(msg.context) || 0) + 1);
        break;
      }
      case 'setSettings':
        this.settings.set(msg.context, msg.payload);
        break;
      case 'sendToPropertyInspector':
        this.toPI.push(msg.payload);
        break;
      case 'openUrl':
        this.openUrls.push(msg.payload.url);
        break;
      default:
        break;
    }
  }

  send(obj) { this.plugin.send(JSON.stringify(obj)); }

  /** Put a key on the deck at physical position (col,row). */
  addKey(context, action, col, row, settings = {}) {
    this.keys.set(context, { action, col, row });
    this.settings.set(context, settings);
    this.send({
      event: 'willAppear', action: this.prefix + action, context, device: 'DECK1',
      payload: { settings, coordinates: reported(col, row), isInMultiAction: false },
    });
  }

  removeKey(context) {
    const k = this.keys.get(context);
    this.keys.delete(context);
    this.images.delete(context);
    this.send({ event: 'willDisappear', action: this.prefix + k.action, context, device: 'DECK1', payload: { settings: {}, coordinates: reported(k.col, k.row) } });
  }

  press(context) {
    const k = this.keys.get(context);
    this.send({ event: 'keyDown', action: this.prefix + k.action, context, device: 'DECK1', payload: { settings: this.settings.get(context), coordinates: reported(k.col, k.row) } });
    this.send({ event: 'keyUp', action: this.prefix + k.action, context, device: 'DECK1', payload: { settings: this.settings.get(context), coordinates: reported(k.col, k.row) } });
  }

  /** Change a key's settings the way the settings panel does. */
  setKeySettings(context, settings) {
    const k = this.keys.get(context);
    this.settings.set(context, settings);
    this.send({ event: 'didReceiveSettings', action: this.prefix + k.action, context, device: 'DECK1', payload: { settings, coordinates: reported(k.col, k.row) } });
  }

  openPanel(context) {
    const k = this.keys.get(context);
    this.send({ event: 'propertyInspectorDidAppear', action: this.prefix + k.action, context, device: 'DECK1' });
  }

  fromPanel(context, payload) {
    const k = this.keys.get(context);
    this.send({ event: 'sendToPlugin', action: this.prefix + k.action, context, payload });
  }

  setGlobals(settings) {
    this.globals = settings;
    this.send({ event: 'didReceiveGlobalSettings', payload: { settings } });
  }

  /** Map "col,row" -> image for the deck picture. */
  deckImages() {
    const m = new Map();
    for (const [ctx, k] of this.keys) if (this.images.has(ctx)) m.set(`${k.col},${k.row}`, this.images.get(ctx));
    return m;
  }

  log() {
    try { return fs.readFileSync(path.join(this.pluginDir, 'plugin.log'), 'utf8'); } catch (_) { return ''; }
  }

  /** Text drawn on a key (from the drawing sent in tests). */
  textOf(context) {
    const svg = this.svgs.get(context) || '';
    return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
  }

  async stop() {
    try { this.plugin.close(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
    try { this.proc.kill(); } catch (_) {}
    this.wss.close();
  }
}

module.exports = { FakeHost, reported, PREFIX };
