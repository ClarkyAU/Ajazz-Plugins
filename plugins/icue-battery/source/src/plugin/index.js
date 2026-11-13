'use strict';
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const log = require('./log');
const { realPosition, groupKeys } = require('./layout');
const render = require('./render');
const { kindName } = require('./icons');
const helperHost = require('./helperHost');

const PLUGIN_ID = 'com.clarkyau.icuebattery';
const ACTION_HEADSET = PLUGIN_ID + '.headset';
const ACTION_SETUP = PLUGIN_ID + '.setup';
const VERSION = '1.0.0';

// ---- start-up arguments ---------------------------------------------------------------------
const argv = process.argv.slice(2);
function arg(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const port = arg('-port');
const pluginUUID = arg('-pluginUUID');
const registerEvent = arg('-registerEvent');
let hostInfo = {};
try { hostInfo = JSON.parse(arg('-info') || '{}'); } catch (e) { /* ignore */ }

log.info('Starting iCUE Battery ' + VERSION + '. Node ' + process.version + '. Folder ' + log.dir);
log.info('Host ' + ((hostInfo.application && hostInfo.application.version) || '?') + ', devices ' +
  JSON.stringify((hostInfo.devices || []).map((d) => d.name + ' ' + JSON.stringify(d.size))));

// ---- state ----------------------------------------------------------------------------------
const keys = new Map();        // context -> key
let globals = { device: 'auto', setupSeen: false, poll: 10 };
let globalsLoaded = false;
const hs = { session: 0, icue: '', sdk: '', hid: null, hidSeen: 0, devices: [], helperRunning: false, gotState: false, since: Date.now() };
const loggedDevices = new Map();
const batteryShown = new Map(); // device id -> did iCUE report a battery value last time
const missingSince = new Map(); // device id -> when its battery reading disappeared (the headset does this while charging)
const CHARGING_AFTER_MS = 3000;
let tick = 0;
const lastKnown = new Map();   // device id -> { id, model, kind, props }
let blink = false;
let groups = new Map();
let ws = null;

const dataDir = path.join(log.dir, 'data');
const lastFile = path.join(dataDir, 'last.json');
try {
  const saved = JSON.parse(fs.readFileSync(lastFile, 'utf8'));
  (saved.devices || []).forEach((d) => lastKnown.set(d.id, d));
} catch (e) { /* first run */ }
let saveTimer = null;
function saveLast() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(lastFile, JSON.stringify({ devices: Array.from(lastKnown.values()) }));
    } catch (e) { log.warn('Could not save last readings: ' + e.message); }
  }, 2000);
}

function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

// ---- receiver (charging) data ---------------------------------------------------------------
// The helper reads the headset's charging flag from its USB receiver every few seconds. Data counts
// as fresh while its time stamp is recent; otherwise we fall back to guessing from iCUE's missing battery value.
function hidFresh() {
  const h = hs.hid;
  if (!h || !h.ok || !h.t) return false;
  return Date.now() / 1000 - h.t <= globals.poll * 3 + 10;
}
let lastHidLog = '';
function noteHid() {
  const h = hs.hid;
  const sig = h ? (h.ok ? 'ok ' + h.pid : 'no: ' + h.note) : 'none';
  if (sig !== lastHidLog) { lastHidLog = sig; log.info('Receiver data: ' + (h && h.ok ? 'reading from receiver ' + h.pid : (h ? h.note : 'none yet'))); }
}

// ---- iCUE tray icon text ---------------------------------------------------------------------
// iCUE's notification-area icon says "<model> Battery Status <High|Medium|Low|Charging ...>" and changes the moment the cable goes in or out
// (the USB receiver needs up to 40 s more). Needs iCUE's "Enable Battery Gauge in Notification Area". Returns the status text or null.
function trayStatus(model) {
  if (!model || !hs.tray || !hs.tray.length) return null;
  const m = String(model).toLowerCase();
  for (const raw of hs.tray) {
    const t = String(raw);
    const low = t.toLowerCase();
    if (low.indexOf(m) < 0) continue;
    const at = low.lastIndexOf('battery status');
    if (at < 0) continue;
    return t.slice(at + 'battery status'.length).trim();
  }
  return null;
}

// ---- devices --------------------------------------------------------------------------------
const trayEverSeen = new Set();   // devices whose tray icon text we have seen (so iCUE's tray gauge is switched on)
const trayEmptySince = new Map(); // device id -> when the tray text disappeared while iCUE had no battery value
function currentDevice(id) {
  const found = hs.devices.find((d) => d.id === id);
  // iCUE's tray text disappears the moment the headset is switched off. Once we have seen it, no text AND no battery value for 3 s means off.
  if (found) {
    if (trayStatus(found.model) != null) { trayEverSeen.add(id); trayEmptySince.delete(id); }
    else if (trayEverSeen.has(id) && found.props.battery == null) { if (!trayEmptySince.has(id)) trayEmptySince.set(id, Date.now()); }
    else trayEmptySince.delete(id);
  }
  const trayOff = found && trayEmptySince.has(id) && Date.now() - trayEmptySince.get(id) >= 3000;
  // iCUE says the device is disconnected (headset off): treat as not found. But iCUE does not always send "connected" again when the
  // headset comes back, so a live battery reading proves it is there.
  const live = found && !trayOff && (found.connected !== false || found.props.battery != null) ? found : null;
  if (live) {
    const old = lastKnown.get(id);
    const lastBattery = old && old.props ? old.props.battery : undefined;
    const since = missingSince.get(id);
    // The guess is only for PCs with no receiver at all (the helper says so). A receiver that is slow, stale or reports the headset as
    // not answering means "unknown / off", never "charging": an off headset also has no battery value.
    const noReceiver = !!(hs.hid && hs.hid.t > 0 && !hs.hid.pid && /not found|scan failed/.test(hs.hid.note || ''));
    const guess = noReceiver && since != null && lastBattery != null && Date.now() - since >= CHARGING_AFTER_MS;
    const hid = live.kind === 8 && hidFresh() ? hs.hid : null;
    // The tray icon text is the quickest and is iCUE's own word: it wins over the receiver.
    const tray = trayStatus(live.model);
    const charging = tray != null ? /^charging/i.test(tray) : (hid ? hid.charging === true : guess);
    // level: the receiver's reading while charging (iCUE gives none then), otherwise iCUE's own number
    let level = live.props.battery;
    if (charging) level = hid ? Math.round(hid.battery) : lastBattery;
    else if (level == null && hid) level = Math.round(hid.battery);
    return { id: live.id, model: live.model, kind: live.kind, props: live.props, present: true, charging, lastBattery, level, viaReceiver: !!hid };
  }
  const old = lastKnown.get(id);
  if (old) return { id: old.id, model: old.model, kind: old.kind, props: old.props || {}, present: false };
  return null;
}

function autoDeviceId() {
  const live = hs.devices.filter((d) => d.props && d.props.battery != null);
  const pick = live.find((d) => d.kind === 8) || live[0] || hs.devices.find((d) => d.kind === 8);
  if (pick) return pick.id;
  const old = Array.from(lastKnown.values());
  const o = old.find((d) => d.kind === 8 && d.props && d.props.battery != null) || old.find((d) => d.props && d.props.battery != null);
  return o ? o.id : null;
}

function deviceForKey(key) {
  const want = key.settings.device && key.settings.device !== 'default' ? key.settings.device : globals.device;
  const id = want && want !== 'auto' ? want : autoDeviceId();
  return id ? currentDevice(id) : null;
}

function allDevices() {
  const list = hs.devices.map((d) => ({ id: d.id, name: d.model, kind: d.kind, battery: d.props.battery, present: true }));
  lastKnown.forEach((d) => {
    if (!list.some((x) => x.id === d.id)) list.push({ id: d.id, name: d.model, kind: d.kind, battery: d.props && d.props.battery, present: false });
  });
  return list;
}

// ---- status shown on the Setup key ------------------------------------------------------------
function setupStatus() {
  const notConnectedFor = Date.now() - hs.since;
  if (!hs.helperRunning && !hs.gotState) return { status: 'helper' };
  if (!hs.gotState) return { status: 'connecting' };
  if (hs.session === 6) {
    const id = autoDeviceId();
    const dev = id ? currentDevice(id) : null;
    if (dev && dev.present) return { status: 'ok', model: dev.model, kind: dev.kind };
    return { status: 'nodevice' };
  }
  if (hs.session === 2 || notConnectedFor < 6000) return { status: 'connecting' };
  return { status: 'sdk' };
}

const STATUS_TEXT = {
  ok: 'Connected to iCUE',
  nodevice: 'Connected to iCUE, but no device found. Turn your headset on.',
  sdk: 'Cannot reach iCUE. Open iCUE and turn on Settings > Software and Games > Enable SDK.',
  connecting: 'Connecting to iCUE…',
  helper: 'The helper that talks to iCUE is not running. Press the Setup key to try again.',
};

// ---- roles ----------------------------------------------------------------------------------

function availableRoles(dev) {
  const p = (dev && dev.props) || {};
  const roles = ['battery'];
  if (p.mic != null) roles.push('mic');
  roles.push('connection');
  return roles;
}

function roleFor(key, dev) {
  const shows = key.settings.shows;
  if (shows && shows !== 'auto') return shows;
  const g = groups.get(key.context) || { index: 0, size: 1 };
  const roles = availableRoles(dev);
  return roles[g.index] || 'blank';
}

function lowLevel(key) {
  const v = key.settings.low;
  if (v === 'off') return 0;
  const n = parseInt(v || '20', 10);
  return isNaN(n) ? 20 : n;
}

// ---- drawing --------------------------------------------------------------------------------
function svgFor(key) {
  if (key.action === ACTION_SETUP) return render.setupKey(setupStatus());
  if (!globalsLoaded) return null; // wait for the saved settings so we never flash a wrong message
  if (!globals.setupSeen && !Array.from(keys.values()).some((k) => k.action === ACTION_SETUP)) return render.noticeKey(['Add the', 'Setup key']);
  if (hs.session !== 6) return render.noticeKey(['Finish the', 'Setup key']);
  const dev = deviceForKey(key);
  const role = roleFor(key, dev);
  const m = {
    present: !!(dev && dev.present),
    model: dev ? dev.model : '',
    kind: dev ? dev.kind : 8,
    props: dev ? dev.props : {},
    level: dev ? (dev.level != null ? dev.level : (dev.props ? dev.props.battery : undefined)) : undefined,
    charging: !!(dev && dev.charging),
    frame: tick,
    low: lowLevel(key),
    blink,
  };
  return render.roleKey(role, m);
}

function drawKey(key) {
  let svg;
  try { svg = svgFor(key); } catch (e) { log.error('Draw failed: ' + e.stack); return; }
  if (!svg || svg === key.lastSvg) return;
  key.lastSvg = svg;
  send({ event: 'setImage', context: key.context, payload: { image: render.toDataUrl(svg), target: 0, state: 0 } });
}

function recompute() {
  const list = Array.from(keys.values()).filter((k) => k.action === ACTION_HEADSET).map((k) => ({
    context: k.context, device: k.deck, col: k.col, row: k.row, side: k.side, join: k.settings.join,
  }));
  groups = groupKeys(list);
}

function redrawAll() {
  recompute();
  keys.forEach(drawKey);
  keys.forEach(pushState);
}

// ---- property inspector ---------------------------------------------------------------------
const inspectors = new Map(); // context -> action (panels that are open)

function pushState(key) {
  if (!inspectors.has(key.context)) return;
  const dev = deviceForKey(key);
  const role = key.action === ACTION_HEADSET ? roleFor(key, dev) : null;
  const g = groups.get(key.context) || { index: 0, size: 1 };
  const st = setupStatus();
  send({
    event: 'sendToPropertyInspector', action: key.action, context: key.context,
    payload: {
      type: 'state', global: globals, role, groupSize: g.size,
      status: st.status, statusText: STATUS_TEXT[st.status], icue: hs.icue, session: hs.session,
      devices: allDevices(), roles: dev ? availableRoles(dev) : ['battery', 'connection'],
      current: dev ? { id: dev.id, name: dev.model, kind: dev.kind, present: dev.present, charging: !!dev.charging, battery: dev.level != null ? dev.level : dev.props.battery, viaReceiver: !!dev.viaReceiver } : null,
      receiver: { ok: !!(hs.hid && hs.hid.ok && hidFresh()), note: hs.hid ? hs.hid.note : 'waiting', pid: hs.hid ? hs.hid.pid : '' },
      version: VERSION,
    },
  });
}

// ---- helper events --------------------------------------------------------------------------
function onState(msg) {
  hs.gotState = true;
  if (msg.session !== hs.session) { log.info('iCUE session state ' + msg.session + ', iCUE ' + (msg.icue || '?')); hs.session = msg.session; hs.since = Date.now(); }
  hs.icue = msg.icue || ''; hs.sdk = msg.sdk || '';
  hs.hid = msg.hid || null;
  hs.tray = Array.isArray(msg.tray) ? msg.tray : [];
  noteHid();
  hs.devices = (msg.devices || []).map((d) => ({ id: d.id, model: d.model, kind: d.kind, supported: d.supported, props: d.props || {}, connected: d.connected }));
  hs.devices.forEach((d) => {
    const sig = JSON.stringify([d.model, d.supported, d.props]); // logs every change, so we can see what happens when the charger is plugged in
    if (loggedDevices.get(d.id) !== sig) {
      loggedDevices.set(d.id, sig);
      log.info('Device ' + d.model + ' (type ' + d.kind + '): iCUE offers properties [' + (d.supported || []).join(',') + '], readable now: ' + JSON.stringify(d.props));
    }
    const hasData = Object.keys(d.props).length > 0;
    // iCUE's battery value appearing or vanishing is the first sign of the cable going in or out (or the headset switching on/off):
    // have the receiver checked at once.
    const hasBattery = d.props.battery != null;
    if (d.kind === 8 && batteryShown.has(d.id) && batteryShown.get(d.id) !== hasBattery) { log.info('Battery value ' + (hasBattery ? 'appeared' : 'vanished') + ': checking the receiver now'); helper.recheck(); }
    batteryShown.set(d.id, hasBattery);
    if (d.props.battery == null) { if (!missingSince.has(d.id)) missingSince.set(d.id, Date.now()); } else missingSince.delete(d.id);
    if (hasData) {
      const old = lastKnown.get(d.id);
      // keep the last battery level while the headset is charging and reports none
      lastKnown.set(d.id, { id: d.id, model: d.model, kind: d.kind, props: Object.assign({}, old && old.props, d.props) });
    }
  });
  loggedDevices.forEach((sig, id) => {
    if (!hs.devices.some((d) => d.id === id)) { loggedDevices.delete(id); missingSince.delete(id); log.info('Device gone: ' + id); }
  });
  saveLast();
  redrawAll();
}

function onHelperStatus(status) {
  hs.helperRunning = status === 'running';
  if (status === 'stopped') { hs.gotState = false; hs.session = 0; hs.since = Date.now(); }
  redrawAll();
}

const helper = helperHost.create(onState, onHelperStatus);

// ---- messages from the Ajazz software ---------------------------------------------------------
function applySettings(key, settings) {
  key.settings = settings || {};
  redrawAll();
}

function setGlobals(g) {
  globals = { device: (g && g.device) || 'auto', setupSeen: !!(g && g.setupSeen), poll: [5, 10, 30, 60].indexOf(g && g.poll) >= 0 ? g.poll : 10 };
  helper.setPoll(globals.poll);
}

function saveGlobals() {
  send({ event: 'setGlobalSettings', context: pluginUUID, payload: globals });
}

function onMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  const p = msg.payload || {};
  switch (msg.event) {
    case 'willAppear': {
      const pos = realPosition(p.coordinates);
      const key = {
        context: msg.context, action: msg.action, deck: msg.device || '', col: pos.col, row: pos.row, side: pos.side,
        settings: p.settings || {}, lastSvg: null,
      };
      keys.set(msg.context, key);
      log.info('Key added: ' + (msg.action === ACTION_SETUP ? 'setup' : 'headset') + ' at column ' + pos.col + ', row ' + pos.row +
        ' (reported ' + JSON.stringify(p.coordinates) + ')');
      if (msg.action === ACTION_SETUP && !globals.setupSeen) { globals.setupSeen = true; saveGlobals(); }
      redrawAll();
      break;
    }
    case 'willDisappear':
      keys.delete(msg.context);
      inspectors.delete(msg.context);
      recompute();
      break;
    case 'didReceiveSettings': {
      const key = keys.get(msg.context);
      if (key) applySettings(key, p.settings);
      break;
    }
    case 'didReceiveGlobalSettings':
      setGlobals(p.settings);
      globalsLoaded = true;
      redrawAll();
      break;
    case 'keyDown': {
      const key = keys.get(msg.context);
      if (key && key.action === ACTION_SETUP) { log.info('Setup key pressed: searching again'); helper.rescan(); }
      break;
    }
    case 'propertyInspectorDidAppear': {
      const key = keys.get(msg.context);
      if (key) { inspectors.set(msg.context, msg.action); pushState(key); }
      break;
    }
    case 'propertyInspectorDidDisappear':
      inspectors.delete(msg.context);
      break;
    case 'sendToPlugin': {
      const key = keys.get(msg.context);
      if (!key) break;
      if (p.type === 'hello') { inspectors.set(msg.context, msg.action); pushState(key); }
      else if (p.type === 'settings') applySettings(key, p.settings);
      else if (p.type === 'global') { setGlobals(Object.assign({}, p.settings, { setupSeen: true })); redrawAll(); }
      else if (p.type === 'rescan') helper.rescan();
      break;
    }
    default:
      break;
  }
}

// ---- go -------------------------------------------------------------------------------------
function connect() {
  if (!port || !pluginUUID || !registerEvent) {
    log.error('Not started by the Ajazz software (missing -port / -pluginUUID / -registerEvent).');
    process.exit(1);
  }
  ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.on('open', () => {
    send({ event: registerEvent, uuid: pluginUUID });
    send({ event: 'getGlobalSettings', context: pluginUUID });
    setTimeout(() => { if (!globalsLoaded) { globalsLoaded = true; log.warn('Saved settings did not arrive, using defaults'); redrawAll(); } }, 2500);
    log.info('Registered with Stream Dock');
    helper.start();
  });
  ws.on('message', (d) => { try { onMessage(String(d)); } catch (e) { log.error('Message failed: ' + e.stack); } });
  ws.on('close', () => { log.info('Host closed connection, exiting'); helper.stop(); setTimeout(() => process.exit(0), 1800); });
  ws.on('error', (e) => log.error('Socket error: ' + e.message));
}

setInterval(() => { tick++; if (tick % 2 === 0) blink = !blink; keys.forEach(drawKey); }, 500); // drawKey only sends a picture when it changed
setInterval(() => keys.forEach(pushState), 3000);
process.on('uncaughtException', (e) => log.error('Uncaught: ' + e.stack));
process.on('unhandledRejection', (e) => log.error('Unhandled: ' + (e && e.stack || e)));
connect();
