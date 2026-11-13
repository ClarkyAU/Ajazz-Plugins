'use strict';
// A pretend Ajazz Stream Dock host. It starts the built plugin exactly like the
// real software does (-port -pluginUUID -registerEvent -info), places keys using
// the AKP153E's hardware-order coordinates, records every image the plugin sends,
// checks them against the renderer's known quirks and draws deck previews.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { Resvg } = require('@resvg/resvg-js');
const { fontOptions } = require('./fonts');

const PREFIX = 'com.clarkyau.truenas.';

// real (as seen) position -> what the AKP153E reports
function hardwareCoords(col, row) {
  if (col >= 5) return { column: col, row };
  const index = (4 - col) * 3 + row;
  return { column: index % 5, row: Math.floor(index / 5) };
}

class FakeHost {
  constructor({ pluginDir, globalSettings = {}, nodeBin = process.execPath, verbose = false }) {
    this.pluginDir = pluginDir;
    this.globalSettings = globalSettings;
    this.nodeBin = nodeBin;
    this.verbose = verbose;
    this.images = new Map();
    this.keys = new Map();
    this.events = [];
    this.problems = [];
    this.piMessages = [];
    this.openedUrls = [];
    this.alerts = [];
    this.n = 0;
  }

  async start() {
    this.wss = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => this.wss.on('listening', r));
    const port = this.wss.address().port;
    this.pluginUUID = 'PLUGIN-' + Math.random().toString(36).slice(2);
    const registered = new Promise((resolve) => {
      this.wss.on('connection', (ws) => {
        ws.on('message', (buf) => {
          const msg = JSON.parse(buf.toString());
          this.events.push(msg);
          if (this.verbose) console.log('plugin ->', msg.event, msg.context || '');
          if (msg.event === 'registerPlugin') { this.ws = ws; resolve(); }
          this.onPluginMessage(msg);
        });
      });
    });
    const info = { application: { font: 'Segoe UI', language: 'en', platform: 'windows', version: '3.10.200' }, plugin: { uuid: 'com.clarkyau.truenas', version: '1.0.0' }, devices: [{ id: 'DEV1', name: 'AKP153E', size: { columns: 5, rows: 3 }, type: 0 }] };
    this.proc = spawn(this.nodeBin, [path.join(this.pluginDir, 'plugin', 'index.js'), '-port', String(port), '-pluginUUID', this.pluginUUID, '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)], { cwd: path.join(this.pluginDir, 'plugin'), stdio: ['ignore', 'pipe', 'pipe'] });
    this.stderr = '';
    this.proc.stderr.on('data', (d) => { this.stderr += d; });
    this.proc.stdout.on('data', (d) => { if (this.verbose) process.stdout.write(d); });
    await Promise.race([registered, wait(8000).then(() => { throw new Error('Plugin did not register. ' + this.stderr); })]);
  }

  onPluginMessage(msg) {
    switch (msg.event) {
      case 'getGlobalSettings':
        this.send({ event: 'didReceiveGlobalSettings', payload: { settings: this.globalSettings } });
        break;
      case 'setGlobalSettings':
        this.globalSettings = msg.payload;
        break;
      case 'setImage': {
        const img = msg.payload && msg.payload.image;
        this.images.set(msg.context, img);
        this.check(msg.context, img);
        break;
      }
      case 'openUrl': this.openedUrls.push(msg.payload.url); break;
      case 'showAlert': this.alerts.push(msg.context); break;
      case 'sendToPropertyInspector': this.piMessages.push(msg.payload); break;
      default: break;
    }
  }

  check(context, img) {
    const k = this.keys.get(context);
    const where = k ? `${k.action}@${k.col},${k.row}` : context;
    const bad = (why) => this.problems.push(`${where}: ${why}`);
    if (typeof img !== 'string' || !img.startsWith('data:image/svg+xml;charset=utf8,<svg')) return bad('not an SVG data URL');
    const svg = img.slice('data:image/svg+xml;charset=utf8,'.length);
    if (img.includes('#')) bad('contains "#"');
    if (img.includes('%')) bad('contains "%" (breaks the image in the Ajazz software)');
    const small = [...svg.matchAll(/<text[^>]*font-size="(\d+)"/g)].map((m) => +m[1]).filter((n) => n < 17);
    if (small.length) bad(`text smaller than 17px (${small.join(',')}) is hard to read on the keys`);
    if (/url\(/.test(svg)) bad('uses url() references');
    if (!/width="144" height="144"/.test(svg)) bad('not 144x144');
    if (/<tspan/.test(svg)) bad('uses tspan');
    if (/<text[^>]*>\s/.test(svg) || /\s<\/text>/.test(svg)) bad('text starts/ends with whitespace');
    if (/ /.test(svg)) bad('non-breaking space');
    try { new Resvg(svg, { font: fontOptions() }); } catch (e) { bad('SVG does not parse: ' + e.message); }
  }

  send(obj) { this.ws.send(JSON.stringify(obj)); }

  // key: { action, col, row, settings }
  addKey({ action, col, row, settings = {}, device = 'DEV1' }) {
    const context = `CTX${++this.n}`;
    this.keys.set(context, { action, col, row, settings, device });
    this.send({ event: 'willAppear', action: PREFIX + action, context, device, payload: { settings, coordinates: hardwareCoords(col, row), isInMultiAction: false } });
    return context;
  }

  removeKey(context) {
    const k = this.keys.get(context);
    this.keys.delete(context);
    this.images.delete(context);
    this.send({ event: 'willDisappear', action: PREFIX + k.action, context, device: k.device, payload: { settings: k.settings, coordinates: hardwareCoords(k.col, k.row) } });
  }

  clearKeys() { for (const c of [...this.keys.keys()]) this.removeKey(c); }

  press(context, holdMs = 80) {
    const k = this.keys.get(context);
    const base = { action: PREFIX + k.action, context, device: k.device, payload: { settings: k.settings, coordinates: hardwareCoords(k.col, k.row) } };
    this.send({ ...base, event: 'keyDown' });
    return wait(holdMs).then(() => this.send({ ...base, event: 'keyUp' }));
  }

  openPI(context) {
    const k = this.keys.get(context);
    this.send({ event: 'propertyInspectorDidAppear', action: PREFIX + k.action, context, device: k.device });
  }

  setGlobal(settings) {
    this.globalSettings = settings;
    this.send({ event: 'didReceiveGlobalSettings', payload: { settings } });
  }

  stop() {
    try { this.proc.kill(); } catch (_) {}
    try { this.wss.close(); } catch (_) {}
  }

  keyPng(context) {
    const img = this.images.get(context);
    if (!img) return null;
    const svg = img.slice(img.indexOf(',') + 1);
    return new Resvg(svg, { fitTo: { mode: 'width', value: 144 }, font: fontOptions() }).render().asPng();
  }

  // Draw the whole AKP153E (5x3 keys + side screen) as one image.
  preview(file, title) {
    const KEY = 144, GAP = 16, PAD = 28, SIDE_GAP = 44, TOP = title ? 54 : PAD;
    const W = PAD * 2 + 5 * KEY + 4 * GAP + SIDE_GAP + KEY;
    const H = TOP + PAD + 3 * KEY + 2 * GAP;
    let body = `<rect width="${W}" height="${H}" rx="26" fill="rgb(28,29,32)"/>`;
    if (title) body += `<text x="${PAD}" y="36" font-family="Inter" font-size="19" font-weight="700" fill="rgb(200,204,210)">${title.replace(/&/g, '&amp;')}</text>`;
    body += `<defs><clipPath id="k"><rect width="${KEY}" height="${KEY}" rx="12"/></clipPath></defs>`;
    const pos = (col, row) => ({ x: PAD + col * (KEY + GAP) + (col >= 5 ? SIDE_GAP - GAP : 0), y: TOP + row * (KEY + GAP) });
    // empty slots
    for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) {
      const p = pos(c, r);
      body += `<rect x="${p.x}" y="${p.y}" width="${KEY}" height="${KEY}" rx="12" fill="rgb(40,42,46)"/>`;
    }
    const side = pos(5, 0);
    body += `<rect x="${side.x - 8}" y="${side.y - 8}" width="${KEY + 16}" height="${3 * KEY + 2 * GAP + 16}" rx="16" fill="none" stroke="rgb(60,62,68)" stroke-width="2"/>`;
    for (const [context, k] of this.keys) {
      const png = this.keyPng(context);
      if (!png) continue;
      const p = pos(k.col, k.row);
      body += `<g transform="translate(${p.x} ${p.y})" clip-path="url(#k)"><image width="${KEY}" height="${KEY}" href="data:image/png;base64,${png.toString('base64')}"/></g>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
    fs.writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: fontOptions() }).render().asPng());
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Copy the built plugin to a temp folder so tests never touch the build output.
function tempPluginCopy(buildDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'truenas-plugin-'));
  fs.cpSync(buildDir, dir, { recursive: true });
  return dir;
}

module.exports = { FakeHost, hardwareCoords, wait, tempPluginCopy };
