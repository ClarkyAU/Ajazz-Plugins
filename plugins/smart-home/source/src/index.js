'use strict';
// Smart Home plugin for the Ajazz / Stream Dock software (com.clarkyau.smarthome).
// Controls Tuya-based Wi-Fi devices (Smart Life, Arlec Grid Connect and
// similar brands) directly over the home network, with the Tuya cloud as a
// fallback. The account details live only on the Setup key.

const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const raster = require('./raster');
const render = require('./render');
const model = require('./tuya/model');
const { Hub } = require('./tuya/hub');
const { REGIONS } = require('./tuya/cloud');

const ID = 'com.clarkyau.smarthome';
const OLD_ID = 'dev.smarthome.tuya';
const PLUGIN_DIR = process.env.SMARTHOME_PLUGIN_DIR || path.resolve(__dirname, '..');
const ASSET_DIR = fs.existsSync(path.join(__dirname, 'assets')) ? path.join(__dirname, 'assets') : path.join(PLUGIN_DIR, 'plugin', 'assets');
const OLD_DIR = path.join(path.dirname(PLUGIN_DIR), `${OLD_ID}.sdPlugin`);
const S = render.S;

// ------------------------------------------------------------------ log
// Never log settings objects: they hold the Access ID / Secret.

const LOG_PATH = path.join(PLUGIN_DIR, 'plugin.log');
function log(...parts) {
  try {
    try { if (fs.statSync(LOG_PATH).size > 1024 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.old'); } catch (_) {}
    const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch (_) {}
}
process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack ? e.stack : String(e)));
process.on('unhandledRejection', (e) => log('unhandledRejection', e && e.stack ? e.stack : String(e)));

// ------------------------------------------------------------------ settings

const DEFAULT_GLOBALS = { accessId: '', accessSecret: '', region: 'auto', keyLayout: 'auto', legacyLook: null };
let G = { ...DEFAULT_GLOBALS };

function cleanGlobals(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { ...DEFAULT_GLOBALS };
  if (typeof src.accessId === 'string') out.accessId = src.accessId.trim();
  if (typeof src.accessSecret === 'string') out.accessSecret = src.accessSecret.trim();
  if (src.region === 'auto' || src.region in REGIONS) out.region = src.region;
  if (['auto', 'akp153', 'standard'].includes(src.keyLayout)) out.keyLayout = src.keyLayout;
  if (src.legacyLook && typeof src.legacyLook === 'object') out.legacyLook = src.legacyLook;
  return out;
}
const hasCreds = () => !!(G.accessId && G.accessSecret);

function parseColor(v) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ACTIONS = ['setup', 'switch', 'light', 'brightness', 'power'];
const SHOWS = {
  setup: ['auto', 'status', 'devices'],
  switch: ['auto', 'button', 'icon', 'name', 'state', 'watts'],
  light: ['auto', 'button', 'icon', 'name', 'state', 'level'],
  brightness: ['auto', 'slider', 'level', 'name'],
  power: ['auto', 'watts', 'graph', 'name', 'state'],
};
const ICONS = ['auto', 'power', 'plug', 'switch', 'bulb', 'fan'];

function cleanKeySettings(action, s) {
  const src = s && typeof s === 'object' ? s : {};
  return {
    v: 2,
    deviceId: typeof src.deviceId === 'string' ? src.deviceId : '',
    dp: typeof src.dp === 'string' ? src.dp : '',
    show: (SHOWS[action] || ['auto']).includes(src.show) ? src.show : 'auto',
    join: src.join !== false,
    label: typeof src.label === 'string' ? src.label.slice(0, 60) : '',
    icon: ICONS.includes(src.icon) ? src.icon : 'auto',
    color: parseColor(src.color) ? src.color : '',
    style: src.style === 'flat' ? 'flat' : 'glow',
    press: src.press === 'toggle' ? 'toggle' : 'none',
  };
}

/** Keys saved by the old plugin (no "v": 2) pick up its look settings. */
function upgradeKeySettings(action, s) {
  const out = cleanKeySettings(action, s);
  const look = G.legacyLook || {};
  if (look.style === 'flat') out.style = 'flat';
  if (!out.color && look.onColor && parseColor(look.onColor) && look.onColor.toLowerCase() !== '#ffb448') out.color = look.onColor;
  if (look.showNames === 'off' && (action === 'switch' || action === 'light')) out.show = 'icon';
  return out;
}

// ------------------------------------------------------------------ host connection

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (/^-{1,2}[A-Za-z]/.test(argv[i])) {
      out[argv[i].replace(/^-+/, '')] = argv[i + 1];
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const PORT = args.port || process.argv[3];
const PLUGIN_UUID = args.pluginUUID || process.argv[5];
const REGISTER_EVENT = args.registerEvent || process.argv[7] || 'registerPlugin';
log('starting', { port: PORT, node: process.version, folder: PLUGIN_DIR });

const deviceInfo = new Map();
try {
  const info = JSON.parse(args.info || process.argv[9] || '{}');
  for (const d of info.devices || []) deviceInfo.set(String(d.id), d);
  log('decks', (info.devices || []).map((d) => `${d.name} ${d.size ? d.size.columns + 'x' + d.size.rows : ''}`));
} catch (e) {
  log('could not read deck info', String(e));
}

// The AKP153 family reports main-key positions in hardware order; the side
// screen (column 5) is reported normally.
function usesHardwareOrder(device) {
  if (G.keyLayout === 'akp153') return true;
  if (G.keyLayout === 'standard') return false;
  const d = deviceInfo.get(String(device));
  if (!d) return true;
  const t = `${d.name || ''} ${d.type || ''} ${d.model || ''} ${device}`;
  if (/153|293|HSV/i.test(t)) return true;
  const size = d.size || {};
  return (size.columns === 5 || size.columns === 6) && size.rows === 3;
}
function toPhysical(device, column, row) {
  if (column < 0 || column > 4 || row < 0 || row > 2 || !usesHardwareOrder(device)) return { col: column, row };
  const index = row * 5 + column;
  return { col: 4 - Math.floor(index / 3), row: index % 3 };
}
const zoneOf = (col) => (col >= 5 ? 'side' : 'main');

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
ws.on('open', () => {
  ws.send(JSON.stringify({ event: REGISTER_EVENT, uuid: PLUGIN_UUID }));
  ws.send(JSON.stringify({ event: 'getGlobalSettings', context: PLUGIN_UUID }));
  log('registered with the Stream Dock software');
});
ws.on('close', () => { log('software closed the connection, exiting'); shutdown(); });
ws.on('error', (e) => log('websocket error', String(e)));
ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
  try { handleHostEvent(msg); } catch (e) { log('event error', msg.event, e.stack || String(e)); }
});
function send(obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ------------------------------------------------------------------ state

const keys = new Map(); // context -> { action, device, col, row, reportedCol, reportedRow, settings }
let piContext = null;
let piAction = null;
let globalsLoaded = false;

const hub = new Hub({ dir: PLUGIN_DIR, log });
hub.on('update', () => scheduleRender());
hub.on('devices', () => { updateWanted(); scheduleRender(); sendPanelState(); });
hub.on('account', () => { sendPanelState(); scheduleRender(); });
hub.on('failed', (id) => { failedUntil.set(id, Date.now() + 1600); scheduleRender(); setTimeout(scheduleRender, 1700); });

function actionOf(uuid) {
  const a = String(uuid || '').split('.').pop();
  return ACTIONS.includes(a) ? a : null;
}

function handleHostEvent(msg) {
  const { event, context } = msg;
  switch (event) {
    case 'willAppear': {
      const action = actionOf(msg.action);
      if (!action) return;
      const c = (msg.payload && msg.payload.coordinates) || { column: 0, row: 0 };
      const device = msg.device || 'default';
      const pos = toPhysical(device, c.column | 0, c.row | 0);
      const raw = (msg.payload && msg.payload.settings) || {};
      let settings = cleanKeySettings(action, raw);
      if (raw.v !== 2) {
        settings = upgradeKeySettings(action, raw);
        send({ event: 'setSettings', context, payload: settings });
      }
      keys.set(context, { action, device, col: pos.col, row: pos.row, reportedCol: c.column | 0, reportedRow: c.row | 0, settings, legacyRaw: raw.v !== 2 ? raw : null });
      log(`key ${action} at column ${pos.col + 1}, row ${pos.row + 1} (reported ${c.column},${c.row})${settings.deviceId ? '' : ' no device yet'}`);
      lastSvg.delete(context);
      updateWanted();
      scheduleRender();
      if (action === 'setup') sendPanelState();
      break;
    }
    case 'willDisappear':
      keys.delete(context);
      lastSvg.delete(context);
      updateWanted();
      scheduleRender();
      break;
    case 'didReceiveSettings': {
      const k = keys.get(context);
      if (!k) return;
      k.settings = cleanKeySettings(k.action, msg.payload && msg.payload.settings);
      k.legacyRaw = null;
      lastSvg.delete(context);
      updateWanted();
      scheduleRender();
      break;
    }
    case 'keyDown':
      onKeyDown(context);
      break;
    case 'didReceiveGlobalSettings':
      applyGlobals(msg.payload && msg.payload.settings);
      if (!globalsLoaded) { globalsLoaded = true; watchForImport(); }
      break;
    case 'propertyInspectorDidAppear':
      piContext = context;
      piAction = msg.action;
      sendPanelState();
      break;
    case 'propertyInspectorDidDisappear':
      if (piContext === context) piContext = null;
      break;
    case 'sendToPlugin':
      onPanelMessage(msg);
      break;
    case 'deviceDidConnect':
      if (msg.device && msg.deviceInfo) deviceInfo.set(String(msg.device), msg.deviceInfo);
      if (msg.device && msg.payload && msg.payload.deviceInfo) deviceInfo.set(String(msg.device), msg.payload.deviceInfo);
      relayout();
      lastSvg.clear();
      scheduleRender();
      break;
    case 'systemDidWakeUp':
      lastSvg.clear();
      for (const e of hub.devices.values()) if (e.conn) e.conn.restart('computer woke up');
      scheduleRender();
      break;
    default:
      break;
  }
}

function relayout() {
  for (const k of keys.values()) {
    const pos = toPhysical(k.device, k.reportedCol, k.reportedRow);
    k.col = pos.col;
    k.row = pos.row;
  }
}

function applyGlobals(input) {
  const next = cleanGlobals(input);
  const layoutChanged = next.keyLayout !== G.keyLayout;
  G = next;
  if (layoutChanged) relayout();
  hub.setCredentials({ accessId: G.accessId, accessSecret: G.accessSecret, region: G.region });
  log(`account details: ${hasCreds() ? 'saved' : 'not set'}, data centre ${G.region}`);
  lastSvg.clear();
  updateWanted();
  scheduleRender();
  sendPanelState();
}

function saveGlobals() {
  send({ event: 'setGlobalSettings', context: PLUGIN_UUID, payload: G });
}

// ------------------------------------------------------------------ moving over from the old plugin

const IMPORT_FILE = path.join(PLUGIN_DIR, 'import-settings.json');

// The old plugin (dev.smarthome.tuya) hands its saved account details over in
// import-settings.json when it starts; pick them up, then remove the old plugin.
function watchForImport() {
  copyOldDeviceList();
  let tries = 0;
  const check = () => {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8')); } catch (_) { data = null; }
    if (data) {
      try { fs.unlinkSync(IMPORT_FILE); } catch (_) {}
      if (!hasCreds() && typeof data.accessId === 'string' && typeof data.accessSecret === 'string') {
        G = cleanGlobals({ ...G, accessId: data.accessId, accessSecret: data.accessSecret, region: data.region, keyLayout: data.keyLayout || G.keyLayout, legacyLook: data.look || null });
        saveGlobals();
        applyGlobals(G);
        log('imported the account details from the previous version of the plugin');
        reapplyLegacyLook();
      } else if (data.look && !G.legacyLook) {
        G.legacyLook = data.look;
        saveGlobals();
        reapplyLegacyLook();
      }
      removeOldPlugin();
      return true;
    }
    if (hasCreds() && fs.existsSync(path.join(OLD_DIR, 'MOVED.txt'))) { removeOldPlugin(); return true; }
    return false;
  };
  if (check()) return;
  if (!fs.existsSync(OLD_DIR)) return;
  const timer = setInterval(() => {
    if (check() || ++tries > 90) clearInterval(timer);
  }, 2000);
}

// Keys moved over from the old plugin appeared before its look settings
// arrived: give them the old colour/style now.
function reapplyLegacyLook() {
  for (const [context, k] of keys) {
    if (!k.legacyRaw) continue;
    k.settings = upgradeKeySettings(k.action, k.legacyRaw);
    k.legacyRaw = null;
    send({ event: 'setSettings', context, payload: k.settings });
  }
  lastSvg.clear();
  scheduleRender();
}

function copyOldDeviceList() {
  const mine = path.join(PLUGIN_DIR, 'devices.json');
  const old = path.join(OLD_DIR, 'devices.json');
  try {
    if (!fs.existsSync(mine) && fs.existsSync(old)) {
      fs.copyFileSync(old, mine);
      hub.loadCache();
      log('copied the saved device list from the previous version of the plugin');
      updateWanted();
      scheduleRender();
    }
  } catch (e) {
    log('could not copy the old device list: ' + e.message);
  }
}

function removeOldPlugin() {
  try {
    const man = JSON.parse(fs.readFileSync(path.join(OLD_DIR, 'manifest.json'), 'utf8'));
    if (!JSON.stringify(man.Actions || []).includes(OLD_ID)) return;
    copyOldDeviceList();
    fs.rmSync(OLD_DIR, { recursive: true, force: true });
    log('removed the previous version of the plugin');
  } catch (e) {
    if (e.code !== 'ENOENT') log('could not remove the previous version yet: ' + e.message);
  }
}

// ------------------------------------------------------------------ keys and devices

function updateWanted() {
  const want = new Map();
  for (const k of keys.values()) {
    const id = k.settings.deviceId;
    if (!id || k.action === 'setup') continue;
    const cur = want.get(id) || { power: false };
    if (k.action === 'power' || k.action === 'switch') cur.power = true;
    want.set(id, cur);
  }
  hub.setWanted(want);
}

const pressedUntil = new Map(); // context -> time
const failedUntil = new Map(); // deviceId -> time

function switchDp(k, e) {
  const info = e.info;
  if (k.settings.dp && info.switches.some((s) => s.dp === k.settings.dp)) return k.settings.dp;
  if ((k.action === 'light' || k.action === 'brightness') && info.light && info.light.switchDp) return info.light.switchDp;
  return (info.switches[0] && info.switches[0].dp) || '1';
}

function onKeyDown(context) {
  const k = keys.get(context);
  if (!k) return;
  pressedUntil.set(context, Date.now() + 180);
  scheduleRender();
  setTimeout(scheduleRender, 220);

  if (k.action === 'setup') {
    if (!hasCreds()) send({ event: 'openUrl', payload: { url: 'https://iot.tuya.com/' } });
    else hub.refresh().catch(() => {});
    return;
  }
  const e = hub.devices.get(k.settings.deviceId);
  if (!e) return;
  const id = e.info.id;
  const placed = layout().find((p) => p.context === context);
  const show = placed ? placed.show : 'button';

  if (k.action === 'switch' || k.action === 'light' || (k.action === 'power' && k.settings.press === 'toggle')
      || (k.action === 'brightness' && show === 'name')) {
    const dp = switchDp(k, e);
    hub.set(id, { [dp]: !(e.dps[dp] === true) });
    return;
  }
  if (k.action === 'brightness') {
    const ls = model.lightState(e.info, e.dps) || { on: false, pct: 0 };
    let target;
    if (show === 'slider' && placed.segment) {
      target = Math.round(((placed.segment.index + 1) / placed.segment.size) * 100);
    } else if (!ls.on) {
      const sw = e.info.light && e.info.light.switchDp;
      if (sw) { hub.set(id, { [sw]: true }); return; }
      target = ls.pct || 50;
    } else {
      target = [25, 50, 75, 100].find((s) => s > (ls.pct || 0) + 3) || 25;
    }
    const dps = model.brightnessDps(e.info, e.dps, target);
    if (Object.keys(dps).length) hub.set(id, dps);
  }
}

// ------------------------------------------------------------------ settings panel

function setupVisible() {
  return [...keys.values()].some((k) => k.action === 'setup');
}

function sendPanelState() {
  if (!piContext) return;
  send({
    event: 'sendToPropertyInspector',
    action: piAction,
    context: piContext,
    payload: {
      type: 'state',
      account: {
        state: hub.account.state,
        message: hub.account.message,
        region: hub.account.region,
        regionName: REGIONS[hub.account.region] ? REGIONS[hub.account.region].name : '',
      },
      hasCreds: hasCreds(),
      setupVisible: setupVisible(),
      devices: hub.listForPanel(),
    },
  });
}

function onPanelMessage(msg) {
  const p = msg.payload || {};
  if (msg.context && keys.has(msg.context)) { piContext = msg.context; piAction = msg.action; }
  switch (p.type) {
    case 'hello':
      sendPanelState();
      break;
    case 'refresh':
      hub.refresh().then(() => sendPanelState());
      break;
    case 'globals':
      // Only the Setup key's panel sends these.
      applyGlobals({ ...G, ...p.settings, legacyLook: G.legacyLook });
      break;
    case 'openUrl':
      if (/^https:\/\//.test(p.url || '')) send({ event: 'openUrl', payload: { url: p.url } });
      break;
    case 'identify': {
      const e = hub.devices.get(p.deviceId);
      if (!e) return;
      const dp = (e.info.light && e.info.light.switchDp) || (e.info.switches[0] && e.info.switches[0].dp);
      if (!dp) return;
      const was = e.dps[dp] === true;
      hub.set(e.info.id, { [dp]: !was }).then(() => setTimeout(() => hub.set(e.info.id, { [dp]: was }), 1200));
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------------ layout

function statusOf(e) {
  switch (e.link) {
    case 'local':
    case 'cloud': return 'ok';
    case 'nokey': return 'nokey';
    case 'searching': return 'searching';
    case 'connecting': return 'connecting';
    default: return 'offline';
  }
}

function iconFor(k, e) {
  if (k.settings.icon !== 'auto') return k.settings.icon;
  if (k.action === 'light') return 'bulb';
  switch (e.info.kind) {
    case 'plug': return 'plug';
    case 'light': return 'bulb';
    case 'fan': return 'fan';
    case 'switch': return 'switch';
    default: return 'power';
  }
}

/** Group key: neighbouring keys with the same value join up. */
function groupId(k) {
  if (k.action === 'setup') return `${k.device}|${k.row}|${zoneOf(k.col)}|setup`;
  const e = hub.devices.get(k.settings.deviceId);
  const dp = e && k.action !== 'brightness' ? switchDp(k, e) : '';
  return `${k.device}|${k.row}|${zoneOf(k.col)}|${k.action}|${k.settings.deviceId}|${dp}`;
}

/** What a key shows when set to Automatic, from its place in its group. */
function autoShow(action, i, n, e) {
  const meter = !!(e && e.info.power);
  const dimmable = !!(e && e.info.light && (e.info.light.brightDp || e.info.light.colourDp));
  switch (action) {
    case 'setup': return i === 0 ? 'status' : 'devices';
    case 'switch': return n === 1 || i === 0 ? 'button' : meter && n >= 3 && i === n - 1 ? 'watts' : 'name';
    case 'light': return n === 1 || i === 0 ? 'button' : dimmable && n >= 3 && i === n - 1 ? 'level' : 'name';
    case 'brightness': return n === 1 || i === 0 ? 'level' : 'slider';
    case 'power': return n === 1 || i === 0 ? 'watts' : 'graph';
    default: return 'button';
  }
}

/** A chosen display the device can't do falls back to something it can. */
function validShow(action, show, e) {
  const meter = !!(e && e.info.power);
  const dimmable = !!(e && e.info.light && (e.info.light.brightDp || e.info.light.colourDp));
  if ((show === 'watts' || show === 'graph') && !meter) return action === 'power' ? 'none' : 'state';
  if (show === 'level' && action === 'light' && !dimmable) return 'state';
  if ((show === 'level' || show === 'slider') && action === 'brightness' && !dimmable) return 'none';
  return show;
}

/**
 * Works out every key's display: groups of neighbouring keys (same row,
 * same side of the deck, same action and device, both set to join), what
 * each key shows, and which keys share one spanning graphic or one name.
 * Returns [{ context, k, e, show, group, segment: {id, index, size} }].
 */
function layout() {
  const byGroup = new Map();
  for (const [context, k] of keys) {
    const id = groupId(k);
    if (!byGroup.has(id)) byGroup.set(id, []);
    byGroup.get(id).push({ context, k });
  }
  const out = [];
  let gseq = 0;
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.k.col - b.k.col);
    // split into runs of touching keys that are allowed to join
    const runs = [];
    for (const item of list) {
      const run = runs[runs.length - 1];
      const prev = run && run[run.length - 1];
      const joinable = prev && item.k.col === prev.k.col + 1 && prev.k.settings.join && item.k.settings.join
        && (item.k.action === 'setup' || item.k.settings.deviceId);
      if (joinable) run.push(item);
      else runs.push([item]);
    }
    for (const run of runs) {
      const gid = ++gseq;
      const n = run.length;
      const placed = run.map((item, i) => {
        const e = hub.devices.get(item.k.settings.deviceId) || null;
        let show = item.k.settings.show === 'auto' ? autoShow(item.k.action, i, n, e) : item.k.settings.show;
        if (item.k.action !== 'setup') show = validShow(item.k.action, show, e);
        return { context: item.context, k: item.k, e, show, group: gid };
      });
      // keys next to each other with the same name/slider/graph display share it
      let seg = null;
      placed.forEach((p, i) => {
        const shareable = p.show === 'name' || p.show === 'slider' || p.show === 'graph';
        if (shareable && seg && seg.show === p.show && placed[i - 1].show === p.show) {
          seg.members.push(p);
        } else {
          seg = { show: p.show, members: [p], id: `${gid}.${i}` };
        }
        p.seg = seg;
      });
      const named = placed.some((p) => p.show === 'name');
      for (const p of placed) {
        p.named = named && p.show !== 'name';
        p.segment = { id: p.seg.id, index: p.seg.members.indexOf(p), size: p.seg.members.length, members: p.seg.members };
        delete p.seg;
        out.push(p);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ drawing

function notReadyLines(k) {
  if (!hub.devices.size) {
    if (!hasCreds()) return setupVisible() ? ['Finish the', 'Setup key'] : ['Add the', 'Setup key'];
    if (hub.account.state === 'working') return ['Connecting', 'to Tuya'];
    if (hub.account.state === 'error' || hub.account.state === 'expired') return ['Check the', 'Setup key'];
    return ['No devices', 'Check Setup key'];
  }
  if (!k.settings.deviceId) return ['Pick a device', 'in key settings'];
  return ['Device gone', 'Pick another'];
}

function keyColour(p) {
  const k = p.k, e = p.e;
  const custom = parseColor(k.settings.color);
  if (custom) return custom;
  if (e && e.info.light && (k.action === 'light' || k.action === 'brightness' || iconFor(k, e) === 'bulb')) {
    const ls = model.lightState(e.info, e.dps);
    if (ls) return ls.rgb;
  }
  return render.AMBER;
}

function setupDraw(p, now) {
  const a = hub.account;
  const n = hub.devices.size;
  const pressed = (pressedUntil.get(p.context) || 0) > now;
  if (p.show === 'devices') {
    const local = [...hub.devices.values()].filter((e) => e.link === 'local').length;
    return render.drawKey({ show: 'devices', count: n, sub: n ? `${local} on Wi-Fi` : 'none yet', style: p.k.settings.style, pressed });
  }
  let line1, line2, color, glow = false;
  if (!hasCreds()) {
    if (n) { line1 = 'Saved list'; line2 = 'Press: sign in'; color = render.AMBER; }
    else { line1 = 'Set up'; line2 = 'Press: open Tuya'; color = render.MUTED; }
  } else if (a.state === 'working') {
    line1 = 'Connecting'; line2 = 'Tuya cloud'; color = render.AMBER;
  } else if (a.state === 'ok') {
    line1 = 'Connected'; line2 = `${n} device${n === 1 ? '' : 's'}`; color = render.GREEN; glow = true;
  } else if (a.state === 'expired') {
    line1 = 'Trial ended'; line2 = n ? 'Keys still work' : 'Extend at Tuya'; color = render.RED;
  } else if (a.state === 'error') {
    const kind = a.kind || '';
    line1 = kind === 'auth' ? 'Wrong details' : kind === 'network' ? 'No internet' : kind === 'permission' ? 'No permission' : kind === 'region' ? 'Wrong region' : 'Cloud error';
    line2 = 'Press to retry'; color = render.RED;
  } else {
    line1 = n ? 'Saved list' : 'Set up'; line2 = 'Press to connect'; color = render.MUTED;
  }
  return render.drawKey({ show: 'status', line1, line2, statusColor: color, line1Color: color === render.MUTED ? render.TEXT : color, statusGlow: glow, style: p.k.settings.style, pressed });
}

function deviceDraw(p, now) {
  const k = p.k, e = p.e;
  const info = e.info;
  const color = keyColour(p);
  const status = statusOf(e);
  const name = k.settings.label || info.name;
  const dp = switchDp(k, e);
  const ls = info.light ? model.lightState(info, e.dps) : null;
  const on = k.action === 'brightness' || (k.action === 'light' && ls) ? (ls ? ls.on : e.dps[dp] === true) : e.dps[dp] === true;
  const base = {
    name, status, color, style: k.settings.style, on,
    icon: iconFor(k, e),
    pct: ls ? ls.pct : null,
    watts: model.powerWatts(info, e.dps),
    pressed: (pressedUntil.get(p.context) || 0) > now,
    failed: (failedUntil.get(info.id) || 0) > now,
  };
  if (p.show === 'none') return render.drawKey({ show: 'message', lines: k.action === 'power' ? ['No power', 'meter'] : ['Not dimmable', 'Pick another'] });
  // In a group that already shows the name, the other keys don't repeat it.
  if (p.named) base.name = p.show === 'button' ? (on ? 'On' : 'Off') : '';
  return render.drawKey({ ...base, show: p.show });
}

/** Draw every key. Returns Map context -> svg. */
function drawAll() {
  const now = Date.now();
  const out = new Map();
  const doneSegments = new Set();
  for (const p of layout()) {
    if (p.k.action === 'setup') { out.set(p.context, setupDraw(p, now)); continue; }
    if (!p.e || !p.k.settings.deviceId) { out.set(p.context, render.drawKey({ show: 'message', lines: notReadyLines(p.k) })); continue; }
    if (p.segment.size > 1 || ['name', 'slider', 'graph'].includes(p.show)) {
      if (doneSegments.has(p.segment.id)) continue;
      doneSegments.add(p.segment.id);
      const first = p.segment.members[0];
      const e = first.e;
      const info = e.info;
      const ls = info.light ? model.lightState(info, e.dps) : null;
      const dp = switchDp(first.k, e);
      const d = {
        name: first.k.settings.label || info.name,
        status: statusOf(e),
        color: keyColour(first),
        style: first.k.settings.style,
        on: ls && first.k.action !== 'switch' ? ls.on : e.dps[dp] === true,
        pct: ls ? ls.pct : 0,
        history: e.history,
        now,
        keys: p.segment.members.map((m) => ({
          pressed: (pressedUntil.get(m.context) || 0) > now,
          failed: (failedUntil.get(info.id) || 0) > now,
        })),
      };
      const m = p.segment.size;
      let images;
      if (p.show === 'name') images = render.drawNames(m, d);
      else if (p.show === 'slider') images = render.drawSlider(m, d);
      else if (p.show === 'graph') images = render.drawGraph(m, d);
      else images = p.segment.members.map((x) => deviceDraw(x, now));
      p.segment.members.forEach((x, i) => out.set(x.context, images[i]));
      continue;
    }
    out.set(p.context, deviceDraw(p, now));
  }
  return out;
}

const lastSvg = new Map();
let renderTimer = null;
let ready = false;

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (!ready) return;
    try { renderAll(); } catch (e) { log('render error', e.stack || String(e)); }
  }, 30);
}

function renderAll() {
  for (const [context, svg] of drawAll()) {
    if (!svg || lastSvg.get(context) === svg) continue;
    lastSvg.set(context, svg);
    const payload = { image: raster.toDataUrl(svg), target: 0 };
    if (process.env.SMARTHOME_TEST_SVG) payload.svg = svg; // tests check the drawing
    send({ event: 'setImage', context, payload });
  }
}

// ------------------------------------------------------------------ start

raster.init(ASSET_DIR).then(() => {
  ready = true;
  scheduleRender();
}).catch((e) => log('renderer failed to start', e.stack || String(e)));

const tickTimer = setInterval(() => {
  hub.tick().catch((e) => log('tick error', e.message));
  if ([...keys.values()].some((k) => k.action === 'power' || k.settings.show === 'graph' || k.settings.show === 'watts')) scheduleRender();
}, 2000);

function shutdown() {
  clearInterval(tickTimer);
  hub.stop();
  setTimeout(() => process.exit(0), 200);
}

module.exports = { cleanGlobals, cleanKeySettings, ID };
