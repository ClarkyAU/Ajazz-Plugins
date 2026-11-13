// Mouse Info — battery and details for your wireless mouse on the Ajazz AKP153E.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { MiceState } = require('./mice');
const { readCore, profileFor } = require('./core');
const { realPosition, computeLayout } = require('./layout');
const R = require('./render');

const VERSION = '1.3.0';
const ROOT = path.join(__dirname, '..');
const LOG = path.join(ROOT, 'plugin.log');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'mice.json');
const ID = 'com.clarkyau.mouseinfo';
const A_SETUP = ID + '.setup', A_MOUSE = ID + '.mouse';

// ---------------------------------------------------------------- log
function log(level, msg) {
  const line = new Date().toISOString() + ' [' + level + '] ' + msg + '\n';
  try {
    const st = fs.statSync(LOG);
    if (st.size > 2 * 1024 * 1024) fs.renameSync(LOG, LOG + '.old');
  } catch (e) { }
  try { fs.appendFileSync(LOG, line); } catch (e) { }
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (/^-/.test(argv[i])) o[argv[i].replace(/^-+/, '')] = argv[i + 1];
  return o;
}

// ---------------------------------------------------------------- state
function loadSaved() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return null; }
}
const mice = new MiceState(loadSaved());
let globals = { source: 'auto', mouseId: 'auto' };
const keys = new Map(); // context -> {context, action, device, coords, pos, settings}
let layout = new Map();
let ws = null;
let helperStatus = 'starting'; // starting | ok | error
let searchingUntil = 0;
let rawLogged = 0;
const now = () => Date.now();

function readGlobals(g) {
  g = g || {};
  globals = {
    source: ['auto', 'glorious', 'bluetooth'].includes(g.source) ? g.source : 'auto',
    mouseId: typeof g.mouseId === 'string' && g.mouseId ? g.mouseId : 'auto',
  };
}
function selectedMouse() { return mice.selected(globals.source, globals.mouseId); }
let core = null;
function refreshCore() {
  let c = null;
  try { c = readCore(); } catch (e) { log('WARN', 'Could not read Glorious Core profiles: ' + e.message); }
  if (c !== core) {
    core = c;
    const m = selectedMouse(), p = profileFor(m, core);
    log('INFO', 'Glorious Core profiles: ' + (core ? [...core.entries()].map(([id, v]) => id + ' current ' + v.current + ' of ' + v.profiles.length).join(', ') : 'not found') + (p ? ' -> showing profile ' + p.num + (p.dpi ? ' (' + p.dpi + ' DPI)' : '') : ''));
    return true;
  }
  return false;
}

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!mice.dirty) return;
    mice.dirty = false;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(mice.toJSON()));
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { log('WARN', 'Could not save history: ' + e.message); }
  }, 30e3);
}

// ---------------------------------------------------------------- drawing
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
const lastImage = new Map();
function setImage(ctx, svg) {
  const url = R.dataUrl(svg);
  if (lastImage.get(ctx) === url) return;
  lastImage.set(ctx, url);
  send({ event: 'setImage', context: ctx, payload: { image: url, target: 0 } });
}

function imageFor(k, t) {
  const m = selectedMouse();
  if (k.action === A_SETUP) {
    const status = t < searchingUntil ? 'searching' : helperStatus === 'error' ? 'error' : 'ok';
    return R.setupKey(m, status);
  }
  const L = layout.get(k.context) || { role: 'battery' };
  const s = k.settings || {};
  switch (L.role) {
    case 'connection': return R.connectionKey(m, s);
    case 'profile': return R.profileKey(m, profileFor(m, core), s);
    default: return R.batteryKey(m, s);
  }
}

function relayout() {
  const list = [...keys.values()].filter(k => k.action === A_MOUSE);
  layout = computeLayout(list);
  const desc = list.map(k => k.pos.col + ',' + k.pos.row + '=' + (layout.get(k.context) || {}).role).join(' ');
  log('INFO', 'Layout: ' + (desc || '(no mouse keys)'));
}
function paintAll() {
  const t = now();
  for (const k of keys.values()) {
    try { setImage(k.context, imageFor(k, t)); } catch (e) { log('ERROR', 'Draw failed: ' + (e.stack || e)); }
  }
}

// ---------------------------------------------------------------- settings panel
function panelState() {
  const m = selectedMouse();
  const t = now();
  return {
    type: 'state',
    version: VERSION,
    global: globals,
    helper: helperStatus,
    selected: m ? m.id : null,
    core: !!core,
    profile: profileFor(m, core),
    mice: mice.list().map(x => ({
      id: x.id, name: x.name, short: x.short, source: x.source, conn: x.conn, present: !!x.present,
      level: x.level, charging: !!x.charging, ageMin: x.levelAt ? Math.round((t - x.levelAt) / 60e3) : null,
    })),
  };
}
const openPanels = new Map(); // context -> action
function updatePanels() {
  if (!openPanels.size) return;
  const st = panelState();
  for (const [ctx, action] of openPanels) {
    const L = layout.get(ctx);
    send({ event: 'sendToPropertyInspector', action, context: ctx, payload: Object.assign({}, st, { role: L ? L.role : null, auto: L ? L.auto : null, groupSize: L ? L.group.length : 1 }) });
  }
}

// ---------------------------------------------------------------- listener helper
let helper = null, helperBuf = '', helperRestarts = 0, helperTimer = null;
function startHelper() {
  if (helper) return;
  const fake = process.env.MOUSEINFO_FAKE_LISTENER;
  let cmd, args;
  if (fake) { cmd = process.execPath; args = [fake]; }
  else {
    cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'runtime', 'listener.ps1')];
  }
  log('INFO', 'Starting listener: ' + path.basename(cmd));
  let p;
  try { p = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { onHelperExit('spawn failed: ' + e.message); return; }
  helper = p; helperBuf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', d => {
    helperBuf += d;
    let i;
    while ((i = helperBuf.indexOf('\n')) >= 0) {
      const line = helperBuf.slice(0, i).trim(); helperBuf = helperBuf.slice(i + 1);
      if (line) onHelperLine(line);
    }
  });
  p.stderr.setEncoding('utf8');
  p.stderr.on('data', d => log('WARN', 'Listener stderr: ' + String(d).trim().slice(0, 500)));
  p.on('error', e => { if (helper === p) onHelperExit('error: ' + e.message); });
  p.on('exit', code => { if (helper === p) onHelperExit('exit code ' + code); });
}
let shuttingDown = false;
function onHelperExit(why) {
  helper = null;
  if (shuttingDown) return;
  helperStatus = 'error';
  log('WARN', 'Listener stopped (' + why + ')');
  paintAll(); updatePanels();
  const wait = Math.min(60e3, 2e3 * Math.pow(2, Math.min(helperRestarts++, 5)));
  clearTimeout(helperTimer);
  helperTimer = setTimeout(startHelper, wait);
}
function toHelper(cmd) { try { if (helper) helper.stdin.write(cmd + '\n'); } catch (e) { } }

function onHelperLine(line) {
  let ev; try { ev = JSON.parse(line); } catch (e) { log('WARN', 'Listener said: ' + line.slice(0, 300)); return; }
  const t = now();
  switch (ev.type) {
    case 'log': log(String(ev.level || 'info').toUpperCase(), 'Listener: ' + ev.msg); break;
    case 'ready': helperStatus = 'ok'; helperRestarts = 0; log('INFO', 'Listener running'); break;
    case 'devices':
      log('INFO', 'Glorious mice found: ' + (ev.list.map(d => d.model + ' ' + d.conn + ' ' + d.pid).join(', ') || 'none'));
      mice.setGloriousDevices(ev.list, t);
      break;
    case 'report': {
      const r = mice.gloriousReport(ev, t);
      if (r && r.level != null) log('INFO', 'Battery ' + ev.model + ' (' + ev.conn + ', ' + ev.src + '): ' + r.level + (r.charging ? ' charging' : '') + ' [' + ev.hex + ']');
      else if (r && r.profile != null) log('INFO', 'Profile switched on ' + ev.model + ' (' + ev.conn + ', ' + ev.src + '): ' + r.profile + ' [' + ev.hex + ']');
      else if (rawLogged++ < 200) log('INFO', 'Message from ' + ev.model + ' (' + ev.conn + ', ' + ev.src + '): ' + ev.hex);
      break;
    }
        case 'bt': {
      mice.setBluetooth(ev.list, t);
      if (ev.list.length) log('INFO', 'Bluetooth batteries: ' + ev.list.map(d => d.name + ' ' + d.level).join(', '));
      break;
    }
    default: log('INFO', 'Listener event: ' + line.slice(0, 300));
  }
  saveSoon();
  paintAll();
  updatePanels();
}

// ---------------------------------------------------------------- Ajazz events
function onMessage(raw) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  const p = m.payload || {};
  switch (m.event) {
    case 'willAppear': {
      if (m.action !== A_SETUP && m.action !== A_MOUSE) return;
      const pos = realPosition(p.coordinates);
      keys.set(m.context, { context: m.context, action: m.action, device: m.device, coords: p.coordinates, pos, settings: p.settings || {} });
      log('INFO', 'Key added: ' + (m.action === A_SETUP ? 'setup' : 'mouse') + ' at column ' + pos.col + ', row ' + pos.row + ' (reported ' + JSON.stringify(p.coordinates) + ')');
      relayout(); lastImage.delete(m.context); paintAll();
      break;
    }
    case 'willDisappear':
      keys.delete(m.context); lastImage.delete(m.context); openPanels.delete(m.context);
      relayout(); paintAll();
      break;
    case 'didReceiveSettings': {
      const k = keys.get(m.context);
      if (k) { k.settings = p.settings || {}; log('INFO', 'Key settings: ' + JSON.stringify(k.settings)); relayout(); paintAll(); }
      break;
    }
    case 'didReceiveGlobalSettings':
      readGlobals(p.settings); log('INFO', 'Setup: ' + JSON.stringify(globals)); paintAll(); updatePanels();
      break;
    case 'keyDown': {
      const k = keys.get(m.context);
      if (!k) return;
      if (k.action === A_SETUP) {
        searchingUntil = now() + 2500; toHelper('rescan');
        if (!helper) { clearTimeout(helperTimer); helperRestarts = 0; startHelper(); }
        paintAll(); setTimeout(paintAll, 2600);
      } else { refreshCore(); paintAll(); }
      break;
    }
    case 'propertyInspectorDidAppear':
      openPanels.set(m.context, m.action); updatePanels();
      break;
    case 'propertyInspectorDidDisappear':
      openPanels.delete(m.context);
      break;
    case 'sendToPlugin': {
      const k = keys.get(m.context);
      if (p.type === 'hello') { openPanels.set(m.context, m.action); updatePanels(); }
      else if (p.type === 'settings' && k) { k.settings = p.settings || {}; relayout(); paintAll(); }
      else if (p.type === 'global') { readGlobals(p.settings); log('INFO', 'Setup: ' + JSON.stringify(globals)); paintAll(); updatePanels(); }
      else if (p.type === 'rescan') { searchingUntil = now() + 2500; toHelper('rescan'); paintAll(); setTimeout(paintAll, 2600); }
      break;
    }
  }
}

function cleanupOldFiles() {
  // The 0.1 probe build copied Glorious Core's code here for diagnosis; it is not needed any more.
  for (const f of ['diag', 'runtime/hidprobe.ps1', 'static/setup-key.png', 'static/setup.png']) {
    try { fs.rmSync(path.join(ROOT, f), { recursive: true, force: true }); } catch (e) { }
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  log('INFO', 'Starting Mouse Info ' + VERSION + '. Node ' + process.version + '. Folder ' + ROOT);
  try { const info = JSON.parse(a.info || '{}'); log('INFO', 'Host ' + (info.application && info.application.version) + ', devices ' + JSON.stringify((info.devices || []).map(d => d.name + ' ' + JSON.stringify(d.size)))); } catch (e) { }
  cleanupOldFiles();
  ws = new WebSocket('ws://127.0.0.1:' + a.port);
  ws.on('open', () => {
    send({ event: a.registerEvent, uuid: a.pluginUUID });
    send({ event: 'getGlobalSettings', context: a.pluginUUID });
    log('INFO', 'Registered with Stream Dock');
  });
  ws.on('message', onMessage);
  ws.on('close', () => { log('INFO', 'Stream Dock closed the connection, exiting'); shutdown(); });
  ws.on('error', e => log('ERROR', 'WebSocket: ' + e.message));
  refreshCore();
  startHelper();
  setInterval(() => { if (refreshCore()) { paintAll(); updatePanels(); } }, 3000); // Glorious Core profile changes
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (helper) { helper.stdin.end('quit\n'); } } catch (e) { }
  try {
    if (mice.dirty) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(mice.toJSON())); }
  } catch (e) { }
  setTimeout(() => process.exit(0), 300);
}

process.on('uncaughtException', e => log('ERROR', 'Uncaught: ' + (e && e.stack || e)));
process.on('SIGTERM', shutdown);
if (require.main === module) main();
module.exports = { onMessage, onHelperLine, imageFor, keys, mice };
