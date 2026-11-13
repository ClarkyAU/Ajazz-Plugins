'use strict';
// Pretends to be the Stream Dock software: starts the plugin on Node 20,
// places keys, answers settings requests, presses keys and records every
// image the plugin sends.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugin', 'com.clarkyau.nowplaying.sdPlugin');
const ID = 'com.clarkyau.nowplaying';
const DEVICE = '58dbee7a577d76c19a4d16da2f85672e';
const DECKS = [{ id: DEVICE, name: 'AKP153E', size: { columns: 6, rows: 3 }, type: 0 }];

function node20() {
  const local = path.join(ROOT, 'node_modules', 'node-linux-x64', 'bin', 'node');
  if (process.env.NODE20) return process.env.NODE20;
  if (fs.existsSync(local)) return local;
  return process.execPath;
}

// What the AKP153E reports for a key at a visible (column, row).
function reported(col, row) {
  if (col >= 5) return { column: col, row };
  const index = (4 - col) * 3 + row;
  return { column: index % 5, row: Math.floor(index / 5) };
}

/**
 * keys: [{ action, col, row, settings, raw }]   (raw: col/row already as reported)
 * events: [{ at, keyDown: index } | { at, settings: index, value }]
 */
function runScenario({ name, keys, globals = {}, env = {}, snapshots = [1500], events = [], oldPlugin = false, oldKeysOnPage = false }) {
  return new Promise((resolve, reject) => {
    // <work>/StreamDock/plugins/<this plugin> and <work>/StreamDock/profiles, like the real folders
    const work = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `np-${name}-`)), 'StreamDock', 'plugins');
    fs.mkdirSync(work, { recursive: true });
    const pluginDir = path.join(work, `${ID}.sdPlugin`);
    fs.mkdirSync(pluginDir);
    const profiles = path.join(path.dirname(work), 'profiles', 'TEST.sdProfile');
    fs.mkdirSync(profiles, { recursive: true });
    fs.writeFileSync(path.join(profiles, 'manifest.json'), JSON.stringify({ Actions: { '0,0': { UUID: oldKeysOnPage ? 'dev.nowplaying.deck.art' : `${ID}.display` } } }, null, 4));
    if (oldPlugin) {
      const old = path.join(work, 'dev.nowplaying.deck.sdPlugin');
      fs.mkdirSync(old);
      fs.writeFileSync(path.join(old, 'manifest.json'), JSON.stringify({ Actions: [{ UUID: 'dev.nowplaying.deck.art' }] }));
    }
    const tracePath = path.join(work, 'trace.jsonl');
    const commandsPath = path.join(work, 'commands.txt');
    const images = new Map();
    const sent = [];
    const contexts = keys.map((_, i) => `ctx${i}`);
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = wss.address().port;
      const child = spawn(node20(), [
        path.join(PLUGIN, 'plugin', 'index.js'),
        '-port', String(port), '-pluginUUID', 'PLUGINUUID', '-registerEvent', 'registerPlugin',
        '-info', JSON.stringify({ application: { language: 'en', version: '3.10.188.226' }, devices: DECKS })
      ], {
        env: {
          ...process.env, ...env,
          NOWPLAYING_PLUGIN_DIR: pluginDir,
          NOWPLAYING_FAKE_HELPER: path.join(__dirname, 'fake-media.js'),
          NOWPLAYING_TRACE: tracePath,
          FAKE_COMMANDS: commandsPath
        },
        stdio: ['ignore', 'ignore', 'pipe']
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      const snaps = [];
      let sock = null;
      wss.on('connection', (ws) => {
        sock = ws;
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          sent.push(msg);
          if (msg.event === 'registerPlugin') {
            keys.forEach((k, i) => {
              const c = k.raw ? { column: k.col, row: k.row } : reported(k.col, k.row);
              ws.send(JSON.stringify({
                action: `${ID}.${k.action}`, event: 'willAppear', context: contexts[i], device: DEVICE,
                payload: { settings: k.settings || {}, coordinates: c, controller: c.column >= 5 ? 'Information' : 'Keypad', isInMultiAction: false }
              }));
            });
          } else if (msg.event === 'getGlobalSettings') {
            ws.send(JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: globals } }));
          } else if (msg.event === 'setImage') {
            images.set(msg.context, msg.payload.image);
          }
        });
      });
      for (const e of events) {
        setTimeout(() => {
          if (!sock) return;
          if (e.keyDown !== undefined) {
            sock.send(JSON.stringify({ action: `${ID}.${keys[e.keyDown].action}`, event: 'keyDown', context: contexts[e.keyDown], device: DEVICE, payload: {} }));
          } else if (e.settings !== undefined) {
            sock.send(JSON.stringify({ action: `${ID}.${keys[e.settings].action}`, event: 'sendToPlugin', context: contexts[e.settings], payload: { type: 'settings', settings: e.value } }));
          } else if (e.applyAll !== undefined) {
            sock.send(JSON.stringify({ action: `${ID}.${keys[e.applyAll].action}`, event: 'sendToPlugin', context: contexts[e.applyAll], payload: { type: 'applyAll', settings: { style: 'flat', color: 'custom', customColor: '#ff5ca8' } } }));
          } else if (e.panel !== undefined) {
            sock.send(JSON.stringify({ action: `${ID}.${keys[e.panel].action}`, event: 'propertyInspectorDidAppear', context: contexts[e.panel], device: DEVICE }));
          }
        }, e.at);
      }
      const last = Math.max(...snapshots);
      snapshots.forEach((t) => setTimeout(() => {
        snaps.push({ t, images: keys.map((_, i) => images.get(contexts[i]) || null) });
        if (t === last) {
          child.kill();
          wss.close();
          const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
          resolve({
            name, keys, snapshots: snaps, sent,
            traces: read(tracePath).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
            commands: read(commandsPath).split('\n').filter(Boolean),
            log: read(path.join(pluginDir, 'plugin.log')),
            oldPluginRemoved: oldPlugin ? !fs.existsSync(path.join(work, 'dev.nowplaying.deck.sdPlugin')) : null,
            stderr
          });
        }
      }, t));
      child.on('error', reject);
    });
  });
}

module.exports = { runScenario, reported, node20, DEVICE };
