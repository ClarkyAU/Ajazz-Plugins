'use strict';
// One-off helper used when the plugin was renamed from com.homelab.truenas to
// com.clarkyau.truenas. It temporarily replaces plugin/index.js in the OLD plugin
// folder. On the next start of the Ajazz software it asks the software for the old
// connection settings (address + API key), writes them to import-settings.json in
// the NEW plugin folder (the new plugin imports and deletes that file), and shows
// "Moved" on any old keys still on the deck.
// Build: npx esbuild tools/migrate-from-homelab/helper.js --bundle --platform=node --target=node20 --outfile=<old folder>/plugin/index.js
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const OLD_DIR = path.resolve(__dirname, '..');
const NEW_DIR = path.join(path.dirname(OLD_DIR), 'com.clarkyau.truenas.sdPlugin');
const LOG = path.join(OLD_DIR, 'plugin.log');
const log = (m) => { try { fs.appendFileSync(LOG, `${new Date().toISOString()} [MIGRATE] ${m}\n`); } catch (_) {} };
const arg = (n) => { const i = process.argv.indexOf('-' + n); return i >= 0 ? process.argv[i + 1] : undefined; };

const uuid = arg('pluginUUID');
const ws = new WebSocket(`ws://127.0.0.1:${arg('port')}`);
ws.on('open', () => {
  ws.send(JSON.stringify({ event: arg('registerEvent') || 'registerPlugin', uuid }));
  ws.send(JSON.stringify({ event: 'getGlobalSettings', context: uuid }));
  log('Migration helper started');
});
ws.on('close', () => process.exit(0));
ws.on('error', (e) => log('Connection error: ' + e.message));
ws.on('message', (buf) => {
  let msg; try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
  if (msg.event === 'didReceiveGlobalSettings') {
    const s = (msg.payload && msg.payload.settings) || {};
    if (!s.host && !s.apiKey) { log('No saved connection settings to move'); return; }
    if (!fs.existsSync(NEW_DIR)) { log('New plugin folder not found: ' + NEW_DIR); return; }
    const out = { host: s.host || '', apiKey: s.apiKey || '', allowSelfSigned: s.allowSelfSigned !== false };
    try {
      fs.writeFileSync(path.join(NEW_DIR, 'import-settings.json'), JSON.stringify(out));
      log(`Handed connection settings to the new plugin (host=${out.host}, apiKey=${out.apiKey ? 'set' : 'missing'})`);
    } catch (e) { log('Could not write handover file: ' + e.message); }
  } else if (msg.event === 'willAppear') {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="rgb(14,16,20)"/>' +
      '<text x="72" y="66" font-family="Segoe UI, Arial" font-size="24" font-weight="700" fill="rgb(236,239,244)" text-anchor="middle">Moved</text>' +
      '<text x="72" y="96" font-family="Segoe UI, Arial" font-size="20" font-weight="600" fill="rgb(142,150,163)" text-anchor="middle">Restart needed</text></svg>';
    ws.send(JSON.stringify({ event: 'setImage', context: msg.context, payload: { image: 'data:image/svg+xml;charset=utf8,' + svg, target: 0 } }));
  }
});
