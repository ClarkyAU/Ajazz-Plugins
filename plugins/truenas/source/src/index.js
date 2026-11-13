'use strict';
// TrueNAS for Ajazz Stream Dock - plugin entry point.

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { TrueNAS } = require('./truenas');
const { AppIcons } = require('./appicons');
const { realPosition, buildGroups } = require('./layout');
const R = require('./render');
const S = require('./svg');

const UUID_PREFIX = 'com.clarkyau.truenas.';
const PLUGIN_DIR = path.resolve(__dirname, '..');
// Global settings hold only the TrueNAS connection (set on the Setup key).
const DEFAULT_GLOBAL = { host: '', apiKey: '', allowSelfSigned: true };

// ---------------------------------------------------------------- logging
const LOG_FILE = path.join(PLUGIN_DIR, 'plugin.log');
function writeLog(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ')}\n`;
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch (_) {}
  try { fs.appendFileSync(LOG_FILE, redact(line)); } catch (_) {}
  if (process.env.TRUENAS_PLUGIN_STDOUT) process.stdout.write(line);
}
function safeJson(v) { try { return v instanceof Error ? v.stack || v.message : JSON.stringify(v); } catch (_) { return String(v); } }
let secret = '';
function redact(s) { return secret && secret.length > 6 ? s.split(secret).join('***') : s; }
const log = {
  info: (...a) => writeLog('INFO', a),
  warn: (...a) => writeLog('WARN', a),
  error: (...a) => writeLog('ERROR', a),
};
process.on('uncaughtException', (e) => log.error('Uncaught:', e));
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e));

// ---------------------------------------------------------------- args
function arg(name) {
  const i = process.argv.indexOf('-' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const port = arg('port');
const pluginUUID = arg('pluginUUID');
const registerEvent = arg('registerEvent') || 'registerPlugin';
let hostInfo = {};
try { hostInfo = JSON.parse(arg('info') || '{}'); } catch (_) {}
log.info(`Starting. Plugin folder: ${PLUGIN_DIR}. Host: ${hostInfo.application?.version || '?'} Node ${process.version}`);

// ---------------------------------------------------------------- state
const keys = new Map(); // context -> { action, device, col, row, settings, solo }
const lastImage = new Map();
const transient = new Map(); // app context -> { state, until, target }
const keyDownAt = new Map();
let globalSettings = { ...DEFAULT_GLOBAL };
let gotGlobal = false;
let piContext = null, piAction = null;

const nas = new TrueNAS(log);
const icons = new AppIcons(path.join(PLUGIN_DIR, 'cache'), log, () => scheduleRender());

// ---------------------------------------------------------------- host connection
const sd = new WebSocket(`ws://127.0.0.1:${port}`);
function send(obj) {
  if (sd.readyState === WebSocket.OPEN) sd.send(JSON.stringify(obj));
}
sd.on('open', () => {
  send({ event: registerEvent, uuid: pluginUUID });
  send({ event: 'getGlobalSettings', context: pluginUUID });
  log.info('Registered with Stream Dock');
});
sd.on('close', () => { log.info('Stream Dock closed the connection; exiting'); process.exit(0); });
sd.on('error', (e) => log.error('Stream Dock connection error', e.message));
sd.on('message', (buf) => {
  let msg;
  try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
  try { handle(msg); } catch (e) { log.error('Event failed', msg.event, e); }
});

function actionName(uuid) { return String(uuid || '').startsWith(UUID_PREFIX) ? uuid.slice(UUID_PREFIX.length) : String(uuid || '').split('.').pop(); }

function handle(msg) {
  const { event, context, payload = {} } = msg;
  switch (event) {
    case 'didReceiveGlobalSettings':
      applyGlobal(payload.settings || {});
      if (!globalSettings.host && !globalSettings.apiKey) watchForImport();
      break;
    case 'willAppear': {
      const pos = realPosition(payload.coordinates);
      keys.set(context, {
        action: actionName(msg.action),
        device: msg.device || '',
        col: pos.col, row: pos.row,
        settings: payload.settings || {},
        solo: !!payload.isInMultiAction,
      });
      lastImage.delete(context);
      send({ event: 'setTitle', context, payload: { title: '', target: 0 } });
      log.info(`Key added: ${actionName(msg.action)} at column ${pos.col + 1}, row ${pos.row + 1} (reported ${JSON.stringify(payload.coordinates)})`);
      scheduleRender(true);
      break;
    }
    case 'willDisappear':
      keys.delete(context);
      lastImage.delete(context);
      transient.delete(context);
      scheduleRender(true);
      break;
    case 'didReceiveSettings':
      if (keys.has(context)) {
        keys.get(context).settings = payload.settings || {};
        log.info(`Key settings (${keys.get(context).action}): ${JSON.stringify(payload.settings || {})}`);
      }
      scheduleRender(true);
      break;
    case 'keyDown':
      keyDownAt.set(context, Date.now());
      break;
    case 'keyUp':
      onPress(context, Date.now() - (keyDownAt.get(context) || Date.now()));
      break;
    case 'propertyInspectorDidAppear':
      piContext = context; piAction = msg.action;
      sendPiState();
      break;
    case 'propertyInspectorDidDisappear':
      if (piContext === context) piContext = null;
      break;
    case 'sendToPlugin':
      onPiMessage(context, msg.action, payload);
      break;
    default:
      break;
  }
}

function applyGlobal(s) {
  globalSettings = { ...DEFAULT_GLOBAL, ...s };
  gotGlobal = true;
  secret = globalSettings.apiKey || '';
  log.info(`Connection settings: host=${globalSettings.host || '(none)'} apiKey=${globalSettings.apiKey ? 'set' : 'missing'} selfSigned=${globalSettings.allowSelfSigned}`);
  nas.configure(globalSettings);
  scheduleRender(true);
  sendPiState();
}

// ---------------------------------------------------------------- moving settings from an older copy
// When the plugin was renamed, a one-off helper in the old copy writes its connection
// settings to import-settings.json in this folder. Pick them up once, save them as
// our own global settings, then delete the file (it holds the API key).
const IMPORT_FILE = path.join(PLUGIN_DIR, 'import-settings.json');
let importTimer = null;
function watchForImport() {
  if (importTimer) return;
  let tries = 0;
  const check = () => {
    if (globalSettings.host || globalSettings.apiKey || ++tries > 90) { clearInterval(importTimer); importTimer = null; return; }
    let data = null;
    try { data = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8')); } catch (_) { return; }
    try { fs.unlinkSync(IMPORT_FILE); } catch (_) {}
    clearInterval(importTimer); importTimer = null;
    const s = { ...DEFAULT_GLOBAL };
    if (typeof data.host === 'string') s.host = data.host;
    if (typeof data.apiKey === 'string') s.apiKey = data.apiKey;
    if (typeof data.allowSelfSigned === 'boolean') s.allowSelfSigned = data.allowSelfSigned;
    if (!s.host && !s.apiKey) return;
    log.info('Imported connection settings from the previous version of the plugin');
    send({ event: 'setGlobalSettings', context: pluginUUID, payload: s });
    applyGlobal(s);
  };
  check();
  if (!globalSettings.host && !globalSettings.apiKey) importTimer = setInterval(check, 2000);
}

function onPiMessage(context, action, p) {
  if (!p || typeof p !== 'object') return;
  if (p.type === 'global' && p.settings) {
    applyGlobal(p.settings);
  } else if (p.type === 'settings' && keys.has(context)) {
    keys.get(context).settings = p.settings || {};
    scheduleRender(true);
  } else if (p.type === 'reconnect') {
    nas.restart();
  } else if (p.type === 'hello') {
    piContext = context; piAction = action;
  }
  sendPiState();
}

function sendPiState() {
  if (!piContext) return;
  const d = nas.data;
  send({
    event: 'sendToPropertyInspector',
    action: piAction,
    context: piContext,
    payload: {
      type: 'state',
      status: nas.status,
      statusText: nas.statusText,
      hostname: d.info?.hostname || '',
      version: d.info?.version || '',
      pools: d.pools.map((p) => p.name),
      apps: d.apps.map((a) => ({ name: a.name, title: a.title })),
      ifaces: d.ifaceNames,
      global: { ...globalSettings, apiKey: globalSettings.apiKey ? '••••' : '' },
      hasKey: !!globalSettings.apiKey,
    },
  });
}

nas.on('status', () => sendPiState());
let piTimer = null;
nas.on('update', () => {
  scheduleRender();
  if (!piTimer) piTimer = setTimeout(() => { piTimer = null; sendPiState(); }, 3000);
});

// ---------------------------------------------------------------- presses
function openNas(pagePath) {
  if (!nas.baseUrl) return;
  send({ event: 'openUrl', payload: { url: nas.baseUrl + pagePath } });
}

function onPress(context, heldMs) {
  const k = keys.get(context);
  if (!k) return;
  if (nas.status !== 'connected') {
    if (nas.status === 'error' || nas.status === 'auth') nas.restart();
    return;
  }
  if (k.action === 'setup') return openNas('/ui/dashboard');
  switch (k.action) {
    case 'setup': return openNas('/ui/dashboard');
    case 'system': return openNas('/ui/dashboard');
    case 'network': return openNas('/ui/network');
    case 'storage': return openNas('/ui/storage');
    case 'alerts': return openNas('/ui/dashboard');
    case 'app': return pressApp(context, heldMs);
    default: return undefined;
  }
}

const appForKey = new Map(); // context -> app name currently shown

function pressApp(context, heldMs) {
  const name = appForKey.get(context);
  const app = nas.data.apps.find((a) => a.name === name);
  if (!app) return;
  if (heldMs >= 700) {
    // long press: open the app's web page
    let url = app.portal || '';
    if (url) url = url.replace(/\/\/(0\.0\.0\.0|localhost|127\.0\.0\.1)(?=[:/]|$)/, '//' + nas.cfg.host.replace(/:\d+$/, ''));
    send({ event: 'openUrl', payload: { url: url || `${nas.baseUrl}/ui/apps/installed` } });
    return;
  }
  const t = transient.get(context);
  if (t && (t.state === 'starting' || t.state === 'stopping') && t.until > Date.now()) return;
  if (app.state === 'RUNNING') {
    if (t && t.state === 'confirm' && t.until > Date.now()) {
      setTransient(context, 'stopping', 90000, 'STOPPED');
      log.info(`Stopping app ${app.name}`);
      nas.stopApp(app.name).then(() => setTimeout(() => nas.refreshApps().catch(() => {}), 1500))
        .catch((e) => appFailed(context, app, e));
    } else {
      setTransient(context, 'confirm', 3000);
    }
  } else if (app.state === 'STOPPED' || app.state === 'CRASHED') {
    setTransient(context, 'starting', 120000, 'RUNNING');
    log.info(`Starting app ${app.name}`);
    nas.startApp(app.name).then(() => setTimeout(() => nas.refreshApps().catch(() => {}), 1500))
      .catch((e) => appFailed(context, app, e));
  }
}

function appFailed(context, app, e) {
  log.error(`App action failed for ${app.name}: ${e.message}`);
  setTransient(context, 'failed', 3000);
  send({ event: 'showAlert', context });
}

function setTransient(context, state, ms, target) {
  transient.set(context, { state, until: Date.now() + ms, target });
  scheduleRender(true);
  setTimeout(() => scheduleRender(true), ms + 50);
}

function transientFor(context, app) {
  const t = transient.get(context);
  if (!t) return null;
  if (t.until < Date.now() || (t.target && app && app.state === t.target)) {
    transient.delete(context);
    return null;
  }
  return t.state;
}

// ---------------------------------------------------------------- rendering
let renderTimer = null, lastRender = 0;
function scheduleRender(soon) {
  if (renderTimer) {
    if (!soon) return;
    clearTimeout(renderTimer);
  }
  const wait = soon ? 30 : Math.max(0, 900 - (Date.now() - lastRender));
  renderTimer = setTimeout(() => { renderTimer = null; lastRender = Date.now(); renderAll(); }, wait);
}
setInterval(() => scheduleRender(), 30000); // keep uptime fresh

function joinKey(k) { return k.action; }

function renderAll() {
  const byAction = new Map();
  for (const [context, k] of keys) {
    const list = byAction.get(k.action) || [];
    list.push({ context, device: k.device, col: k.col, row: k.row, joinKey: joinKey(k), solo: k.action === 'setup' || k.solo || k.settings.join === false });
    byAction.set(k.action, list);
  }
  for (const [action, list] of byAction) {
    for (const grp of buildGroups(list)) {
      try { renderGroup(action, grp); } catch (e) { log.error(`Render failed (${action})`, e); }
    }
  }
}

function ready(action, d) {
  if (action === 'system' || action === 'network') return d.lastRealtime > 0;
  if (action === 'storage') return !!d.poolsLoaded;
  if (action === 'alerts') return !!d.alertsLoaded;
  if (action === 'app') return !!d.appsLoaded;
  return true;
}

// What a data key says while there is no connection.
function notConnectedText() {
  if (!gotGlobal) return ['connecting', 'Starting\u2026'];
  if (nas.status === 'unconfigured') {
    const hasSetup = [...keys.values()].some((k) => k.action === 'setup');
    return ['unconfigured', hasSetup ? 'Finish the Setup key' : 'Add the Setup key'];
  }
  return [nas.status, nas.statusText];
}

function renderGroup(action, grp) {
  const d = nas.data;
  if (action === 'setup') {
    for (const k of grp.keys) setKey(k.context, S.wrapSvg(R.setupCell(gotGlobal ? nas.status : 'connecting', nas.statusText, d.info, !!globalSettings.host)));
    return;
  }
  if (action === 'app') return renderApps(grp, d);
  grp.cells = grp.keys.map((k) => ({ ...k, settings: keys.get(k.context)?.settings || {} }));
  let content;
  if (nas.status !== 'connected') {
    const [st, msg] = notConnectedText();
    content = R.statusKeys(grp.w, grp.h, st, msg);
  } else if (!ready(action, d)) {
    content = R.statusKeys(grp.w, grp.h, 'waiting', 'Loading…');
  } else {
    switch (action) {
      case 'system': content = R.renderSystem(grp, d); break;
      case 'network': content = R.renderNetwork(grp, d); break;
      case 'storage': content = R.renderStorage(grp, d); break;
      case 'alerts': content = R.renderAlerts(grp, d); break;
      default: content = R.statusKeys(grp.w, grp.h, 'error', 'Unknown key');
    }
  }
  for (const k of grp.keys) setKey(k.context, S.wrapSvg(content, 144, 144, k.dx * R.PITCH, k.dy * R.PITCH));
}

function renderApps(grp, d) {
  if (nas.status !== 'connected' || !d.appsLoaded) {
    const content = nas.status !== 'connected'
      ? R.statusKeys(grp.w, grp.h, ...notConnectedText())
      : R.statusKeys(grp.w, grp.h, 'waiting', 'Loading\u2026');
    for (const k of grp.keys) setKey(k.context, S.wrapSvg(content, 144, 144, k.dx * R.PITCH, k.dy * R.PITCH));
    return;
  }
  // Keys with a chosen app show it; "Automatic" keys fill in with the remaining
  // apps (running ones first), in reading order across the joined keys.
  const pinned = new Set(grp.keys.map((k) => keys.get(k.context)?.settings.app).filter(Boolean));
  const pool = d.apps.filter((a) => !pinned.has(a.name))
    .sort((a, b) => (b.state === 'RUNNING') - (a.state === 'RUNNING') || a.name.localeCompare(b.name));
  const ordered = [...grp.keys].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  for (const k of ordered) {
    const s = keys.get(k.context)?.settings || {};
    const app = s.app ? d.apps.find((a) => a.name === s.app) : pool.shift();
    appForKey.set(k.context, app ? app.name : null);
    const iconData = app ? icons.get(app.icon) : null;
    const content = s.app && !app
      ? R.statusKeys(1, 1, 'waiting', `"${s.app}" not found`)
      : R.appCell(app, 0, 0, iconData, transientFor(k.context, app));
    setKey(k.context, S.wrapSvg(content));
  }
}

function setKey(context, svg) {
  const url = S.toDataUrl(svg);
  if (lastImage.get(context) === url) return;
  lastImage.set(context, url);
  send({ event: 'setImage', context, payload: { image: url, target: 0 } });
}
