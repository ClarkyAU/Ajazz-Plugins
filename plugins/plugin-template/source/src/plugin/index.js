'use strict';
/* global __PLUGIN_ID__, __PLUGIN_NAME__, __VERSION__ */
// Main entry. Talks to the Ajazz Stream Dock software over a local WebSocket.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const log = require('./log');
const { realPosition, groupKeys } = require('./layout');
const render = require('./render');
const source = require('./source');

const PLUGIN_ID = __PLUGIN_ID__;
const PLUGIN_NAME = __PLUGIN_NAME__;
const VERSION = __VERSION__;
const ACTION_EXAMPLE = PLUGIN_ID + '.example';
const ACTION_SETUP = PLUGIN_ID + '.setup';
const DEBUG = !!process.env.PLUGIN_DEBUG_SVG; // tests: include text measurements with setImage

// ---- start-up arguments from the host --------------------------------------
const argv = process.argv.slice(2);
function arg(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const port = arg('-port');
const pluginUUID = arg('-pluginUUID'); // changes on every run: store things by PLUGIN_ID, not by this
const registerEvent = arg('-registerEvent');
let hostInfo = {};
try { hostInfo = JSON.parse(arg('-info') || '{}'); } catch (e) { /* ignore */ }

log.info('Starting ' + PLUGIN_NAME + ' ' + VERSION + '. Node ' + process.version + '. Folder ' + log.dir);
log.info('Host ' + ((hostInfo.application && hostInfo.application.version) || '?') + ', devices ' +
  JSON.stringify((hostInfo.devices || []).map((d) => d.name + ' ' + JSON.stringify(d.size))));

// ---- state -------------------------------------------------------------------
const keys = new Map();           // context -> key
const inspectors = new Map();     // context -> action (settings panel open)
let groups = new Map();           // context -> {index, size}
let globals = { source: 'demo', poll: 10, setupSeen: false };
let globalsLoaded = false;
let shuttingDown = false;
let tick = 0;
let blink = false;
let ws = null;

let src = { status: 'connecting', note: '', items: [] }; // latest answer from the source
let srcName = '';
let lastItemsSig = '';

// Last readings are kept in the plugin folder so a key can show "Not found" with the old value.
const dataDir = path.join(log.dir, 'data');
const lastFile = path.join(dataDir, 'last.json');
const lastKnown = new Map(); // id -> {id, name, value, source}
try {
  (JSON.parse(fs.readFileSync(lastFile, 'utf8')).items || []).forEach((d) => lastKnown.set(d.id, d));
} catch (e) { /* first run */ }
let saveTimer = null;
function saveLast() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(lastFile, JSON.stringify({ items: Array.from(lastKnown.values()) }));
    } catch (e) { log.warn('Could not save last readings: ' + e.message); }
  }, 2000);
}

function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

// ---- items -------------------------------------------------------------------
// Remembered readings only count for the source they came from.
function remembered() { return Array.from(lastKnown.values()).filter((d) => d.source === globals.source); }
function currentItem(id) {
  const live = src.items.find((i) => i.id === id);
  if (live) return { id: live.id, name: live.name, value: live.value, charging: !!live.charging, present: true };
  const old = remembered().find((d) => d.id === id);
  if (old) return { id: old.id, name: old.name, value: old.value, charging: false, present: false };
  return null;
}
function autoItemId() {
  const live = src.items.find((i) => typeof i.value === 'number') || src.items[0];
  if (live) return live.id;
  const old = remembered()[0];
  return old ? old.id : null;
}
function itemForKey(key) {
  const want = key.settings.item && key.settings.item !== 'default' ? key.settings.item : null;
  const id = want || autoItemId();
  return id ? currentItem(id) : null;
}
function allItems() {
  const list = src.items.map((i) => ({ id: i.id, name: i.name, value: i.value, present: true }));
  remembered().forEach((d) => { if (!list.some((x) => x.id === d.id)) list.push({ id: d.id, name: d.name, value: d.value, present: false }); });
  return list;
}

// ---- what each key shows -------------------------------------------------------
function setupStatus() {
  if (src.status === 'ok') return { status: 'ok', sourceName: srcName };
  if (src.status === 'connecting') return { status: 'connecting' };
  return { status: 'nosource' };
}
const STATUS_TEXT = {
  ok: 'Connected',
  connecting: 'Connecting…',
  nosource: 'Cannot reach the source. Check it, then press the Setup key to try again.'
};
function roleFor(key) {
  const shows = key.settings.shows;
  if (shows && shows !== 'auto') return shows;
  const g = groups.get(key.context) || { index: 0, size: 1 };
  return ['value', 'status'][g.index] || 'blank';
}
function lowLevel(key) {
  const v = key.settings.low;
  if (v === 'off') return 0;
  const n = parseInt(v || '20', 10);
  return isNaN(n) ? 20 : n;
}
function svgFor(key) {
  if (!globalsLoaded) return render.waitingKey();
  if (key.action === ACTION_SETUP) return render.setupKey(setupStatus());
  const hasSetupKey = Array.from(keys.values()).some((k) => k.action === ACTION_SETUP);
  if (!globals.setupSeen && !hasSetupKey) return render.noticeKey(['Add the', 'Setup key']);
  if (src.status === 'connecting') return render.waitingKey();
  if (src.status !== 'ok') return render.noticeKey(['Finish the', 'Setup key']);

  const item = itemForKey(key);
  const role = roleFor(key);
  const g = groups.get(key.context) || { index: 0, size: 1 };
  const present = !!(item && item.present);
  if (role === 'value') {
    return render.valueKey({
      present,
      value: item ? item.value : null,
      charging: !!(item && item.charging),
      name: item ? item.name : '',
      showName: key.settings.showName !== false && g.index === 0, // only one key of a joined group shows the name
      showIcon: key.settings.showIcon !== false,
      low: lowLevel(key),
      blink,
      frame: tick
    });
  }
  if (role === 'status') {
    const low = lowLevel(key);
    const ok = !!(item && (item.value == null || low === 0 || item.value > low));
    return render.statusKey({ present, ok, word: ok ? 'OK' : 'LOW', label: 'Status' });
  }
  return render.blankKey();
}
function drawKey(key) {
  if (shuttingDown || !render.isReady()) return;
  let svg;
  try { svg = svgFor(key); } catch (e) { log.error('Draw failed: ' + e.stack); return; }
  if (!svg || svg === key.lastSvg) return;
  key.lastSvg = svg;
  const payload = { image: render.toDataUrl(svg), target: 0, state: 0 };
  if (DEBUG) { payload.svg = svg; payload.inspect = render.inspect(svg); }
  send({ event: 'setImage', context: key.context, payload });
}
function recompute() {
  groups = groupKeys(Array.from(keys.values()).filter((k) => k.action === ACTION_EXAMPLE).map((k) => ({
    context: k.context, device: k.deck, col: k.col, row: k.row, side: k.side, join: k.settings.join
  })));
}
function redrawAll() {
  recompute();
  keys.forEach(drawKey);
  keys.forEach(pushState);
}

// ---- settings panel (property inspector) ------------------------------------------
function pushState(key) {
  if (!inspectors.has(key.context)) return;
  const item = itemForKey(key);
  const g = groups.get(key.context) || { index: 0, size: 1 };
  const st = setupStatus();
  send({
    event: 'sendToPropertyInspector',
    action: key.action,
    context: key.context,
    payload: {
      type: 'state',
      global: globals,
      role: key.action === ACTION_EXAMPLE ? roleFor(key) : null,
      groupSize: g.size,
      status: st.status,
      statusText: STATUS_TEXT[st.status],
      note: src.note,
      sources: source.list(),
      items: allItems(),
      current: item,
      version: VERSION
    }
  });
}

// ---- source -------------------------------------------------------------------------
function onSource(state) {
  src = { status: state.status === 'ok' ? 'ok' : 'nosource', note: state.note || '', items: state.items || [] };
  srcName = reader.sourceName();
  src.items.forEach((i) => {
    if (typeof i.value === 'number') lastKnown.set(i.id, { id: i.id, name: i.name, value: i.value, source: reader.sourceId() });
  });
  const sig = src.status + '|' + src.items.map((i) => i.id + ':' + i.name).join(',');
  if (sig !== lastItemsSig) { // log changes only
    lastItemsSig = sig;
    log.info('Source ' + srcName + ': ' + src.status + ', items [' + src.items.map((i) => i.name).join(', ') + ']');
  }
  saveLast();
  redrawAll();
}
const reader = source.create(onSource, log);

let sourceStarted = false;
function startSource() { if (!sourceStarted) { sourceStarted = true; reader.start(); } }
function setGlobals(g) {
  g = g || {};
  const before = globals.source;
  globals = {
    source: g.source || 'demo',
    setupSeen: !!g.setupSeen,
    poll: [5, 10, 30, 60].indexOf(g.poll) >= 0 ? g.poll : 10
  };
  if (globals.source !== before) src = { status: 'connecting', note: '', items: [] }; // old source's items must not linger
  reader.setPoll(globals.poll);
  reader.setSource(globals.source);
}
function saveGlobals() { send({ event: 'setGlobalSettings', context: pluginUUID, payload: globals }); }

// ---- messages from the host -----------------------------------------------------------
function onMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  const p = msg.payload || {};
  switch (msg.event) {
    case 'willAppear': {
      const pos = realPosition(p.coordinates);
      keys.set(msg.context, {
        context: msg.context, action: msg.action, deck: msg.device || '',
        col: pos.col, row: pos.row, side: pos.side, settings: p.settings || {}, lastSvg: null
      });
      log.info('Key added: ' + (msg.action === ACTION_SETUP ? 'setup' : 'example') + ' at column ' + pos.col + ', row ' + pos.row);
      if (msg.action === ACTION_SETUP && !globals.setupSeen) { globals.setupSeen = true; saveGlobals(); }
      redrawAll(); // draws a waiting picture until the saved settings arrive
      break;
    }
    case 'willDisappear':
      keys.delete(msg.context);
      inspectors.delete(msg.context);
      recompute();
      break;
    case 'didReceiveSettings': {
      const key = keys.get(msg.context);
      if (key) { key.settings = p.settings || {}; redrawAll(); }
      break;
    }
    case 'didReceiveGlobalSettings':
      setGlobals(p.settings);
      globalsLoaded = true;
      startSource();
      redrawAll();
      break;
    case 'keyDown': {
      const key = keys.get(msg.context);
      if (key && key.action === ACTION_SETUP) { log.info('Setup key pressed: searching again'); reader.rescan(); }
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
      else if (p.type === 'settings') { key.settings = p.settings || {}; redrawAll(); }
      else if (p.type === 'global') { setGlobals(Object.assign({}, p.settings, { setupSeen: true })); redrawAll(); }
      else if (p.type === 'rescan') reader.rescan();
      break;
    }
    default:
      break;
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true; // blocks any further redraw
  reader.stop();
  setTimeout(() => process.exit(0), 1800);
}

function connect() {
  if (!port || !pluginUUID || !registerEvent) {
    log.error('Not started by the Ajazz software (missing -port / -pluginUUID / -registerEvent).');
    process.exit(1);
  }
  ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.on('open', () => {
    send({ event: registerEvent, uuid: pluginUUID });
    send({ event: 'getGlobalSettings', context: pluginUUID });
    setTimeout(() => { // never wait for saved settings forever
      if (!globalsLoaded) { globalsLoaded = true; log.warn('Saved settings did not arrive, using defaults'); startSource(); redrawAll(); }
    }, 2500);
    log.info('Registered with Stream Dock');
  });
  ws.on('message', (d) => { try { onMessage(String(d)); } catch (e) { log.error('Message failed: ' + e.stack); } });
  ws.on('close', () => { log.info('Host closed connection, exiting'); shutdown(); });
  ws.on('error', (e) => log.error('Socket error: ' + e.message));
}

setInterval(() => { tick++; if (tick % 2 === 0) blink = !blink; keys.forEach(drawKey); }, 500);
setInterval(() => keys.forEach(pushState), 3000);
process.on('uncaughtException', (e) => log.error('Uncaught: ' + e.stack));
process.on('unhandledRejection', (e) => log.error('Unhandled: ' + ((e && e.stack) || e)));

render.init().then(() => { log.info('Drawing engine ready'); redrawAll(); }, (e) => log.error('Drawing engine failed: ' + e.stack));
connect();
