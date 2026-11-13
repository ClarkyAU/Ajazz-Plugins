'use strict';
// Handover for the old plugin folder (dev.smarthome.tuya.sdPlugin).
// This replaces the old plugin's code for one start of the Stream Dock
// software: it reads the old plugin's saved settings from the software and
// passes them to the new plugin (com.clarkyau.smarthome) in
// import-settings.json, copies the saved device list, and shows "Moved" on
// any old key. The new plugin then removes this old folder.

const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const OLD_DIR = process.env.SMARTHOME_OLD_DIR || path.resolve(__dirname, '..');
const NEW_DIR = path.join(path.dirname(OLD_DIR), 'com.clarkyau.smarthome.sdPlugin');
const LOG = path.join(OLD_DIR, 'handover.log');

function log(msg) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch (_) {}
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (/^-{1,2}[A-Za-z]/.test(argv[i])) { out[argv[i].replace(/^-+/, '')] = argv[i + 1]; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);

// Grey "moved" picture for any key still pointing at the old plugin.
const MOVED = 'data:image/svg+xml;charset=utf8,<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">'
  + '<rect x="0" y="0" width="144" height="144" fill="rgb(14,14,18)"/>'
  + '<text x="72" y="70" font-family="Arial" font-size="24" font-weight="bold" text-anchor="middle" fill="rgb(238,238,242)">Moved</text>'
  + '<text x="72" y="100" font-family="Arial" font-size="20" text-anchor="middle" fill="rgb(150,150,162)">Restart app</text></svg>';

let done = false;
function handOver(settings) {
  if (done) return;
  done = true;
  const s = settings && typeof settings === 'object' ? settings : {};
  try {
    if (!fs.existsSync(NEW_DIR)) { log('new plugin not installed, nothing to do'); return; }
    const data = {
      from: 'dev.smarthome.tuya',
      accessId: typeof s.accessId === 'string' ? s.accessId : '',
      accessSecret: typeof s.accessSecret === 'string' ? s.accessSecret : '',
      region: typeof s.region === 'string' ? s.region : 'auto',
      keyLayout: typeof s.keyLayout === 'string' ? s.keyLayout : 'auto',
      look: { onColor: s.onColor, style: s.style, showNames: s.showNames, showPower: s.showPower },
    };
    const tmp = path.join(NEW_DIR, 'import-settings.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, path.join(NEW_DIR, 'import-settings.json'));
    const oldList = path.join(OLD_DIR, 'devices.json');
    const newList = path.join(NEW_DIR, 'devices.json');
    if (fs.existsSync(oldList) && !fs.existsSync(newList)) fs.copyFileSync(oldList, newList);
    log(`handed over: account details ${data.accessId && data.accessSecret ? 'found' : 'not set'}, device list ${fs.existsSync(oldList) ? 'copied' : 'none'}`);
  } catch (e) {
    log('handover failed: ' + e.message);
  }
}

ws.on('open', () => {
  ws.send(JSON.stringify({ event: args.registerEvent || 'registerPlugin', uuid: args.pluginUUID }));
  ws.send(JSON.stringify({ event: 'getGlobalSettings', context: args.pluginUUID }));
  log('started');
});
ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
  if (msg.event === 'didReceiveGlobalSettings') handOver(msg.payload && msg.payload.settings);
  if (msg.event === 'willAppear') ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { image: MOVED, target: 0 } }));
});
ws.on('close', () => process.exit(0));
ws.on('error', () => {});
// If the software never answers, still pass on the device list.
setTimeout(() => { if (!done) handOver({}); }, 15000);
