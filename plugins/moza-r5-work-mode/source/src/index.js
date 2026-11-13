'use strict';
// Moza Base plugin for the Ajazz Stream Dock software.
// One key shows the base's Work/Standby mode and toggles it. Optionally follows the cockpit smart plug:
// plug on -> base to Work, Pit House started; plug off -> Pit House closed, base to Standby.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const keys = require('./keys');
const frames = require('./frames');
const serial = require('./serial');
const { Watcher } = require('./cockpit');

const PLUGIN_DIR = path.resolve(__dirname, '..');
const LOG_FILE = path.join(PLUGIN_DIR, 'plugin.log');
const SETTINGS_FILE = path.join(PLUGIN_DIR, 'settings.json');
const LAST_FILE = path.join(PLUGIN_DIR, 'serial-last.json');
const VERSION = require('../package.json').version;

try { if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (_) { /* ignore */ }
function writeLog(level, args) {
  const text = args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] ${text}\n`); } catch (_) { /* ignore */ }
}
const log = { info: (...a) => writeLog('INFO', a), warn: (...a) => writeLog('WARN', a), error: (...a) => writeLog('ERROR', a) };
process.on('uncaughtException', (e) => log.error('Uncaught:', e));
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e));

function arg(name) { const i = process.argv.indexOf('-' + name); return i >= 0 ? process.argv[i + 1] : undefined; }
const port = arg('port');
const pluginUUID = arg('pluginUUID');
const registerEvent = arg('registerEvent') || 'registerPlugin';
let hostInfo = {};
try { hostInfo = JSON.parse(arg('info') || '{}'); } catch (_) { /* ignore */ }
log.info(`Moza Base ${VERSION} starting. Host: ${(hostInfo.application && hostInfo.application.version) || '?'} Node ${process.version}`);

// ---- settings (saved by the settings panel, applied live) ----
const DEFAULTS = { follow: true, plugName: 'Cockpit' };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch (_) { /* first run */ }
function saveSettings() { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { log.warn('Could not save settings', e.message); } }

// ---- state ----
const contexts = new Map(); // context -> { action }
const lastImage = new Map();
let piContext = null;
let piAction = null;
let mode = 'unknown'; // 'work' | 'standby' | 'unknown'
try { const j = JSON.parse(fs.readFileSync(LAST_FILE, 'utf8')); if (j.ok && j.after === 1) mode = 'standby'; else if (j.ok && j.after === 0) mode = 'work'; } catch (_) { /* none */ }
let busy = false;
let error = null;
let lastAction = '';
let pending = null; // latest wanted target while busy: 0 work, 1 standby
let plug = { state: 'unknown' };

function keyState() {
  if (busy) return { state: 'busy' };
  if (error) return { state: 'error', error };
  return { state: mode };
}

const sd = new WebSocket(`ws://127.0.0.1:${port}`);
function send(obj) { if (sd.readyState === WebSocket.OPEN) sd.send(JSON.stringify(obj)); }
function setKey(context) {
  const url = keys.toDataUrl(keys.render(keyState()));
  if (lastImage.get(context) === url) return;
  lastImage.set(context, url);
  send({ event: 'setImage', context, payload: { image: url, target: 0 } });
}
function sendPi() {
  if (!piContext) return;
  send({ event: 'sendToPropertyInspector', action: piAction, context: piContext, payload: { type: 'state', version: VERSION, mode, busy, error, lastAction, plug, settings } });
}
function renderAll() { for (const c of contexts.keys()) setKey(c); sendPi(); }

// ---- changing the mode ----
// target: null = flip whatever the base is in; 0 = Work; 1 = Standby. relaunch: start Pit House afterwards.
async function changeMode({ target, relaunch, why }) {
  if (busy) { if (target !== null) pending = { target, relaunch, why }; return; }
  busy = true; error = null; renderAll();
  const t = { get: frames.getWorkMode(), setTo0: frames.setWorkMode(0), setTo1: frames.setWorkMode(1) };
  log.info(`[mode] ${why}: closing Pit House, ${target === null ? 'toggling' : target === 1 ? 'setting Standby' : 'setting Work'}${relaunch ? ', then starting Pit House' : ', leaving it closed'}`);
  const r = await serial.run([], { waitMs: 400, relaunch, toggle: t, target });
  log.info(`[mode] result: ${JSON.stringify({ ok: r.ok, before: r.before, after: r.after, error: r.error })}`);
  try { fs.writeFileSync(LAST_FILE, JSON.stringify(r, null, 2)); } catch (_) { /* ignore */ }
  busy = false;
  if (!r.ok) error = r.error || 'failed';
  else if (r.after === 1) { mode = 'standby'; lastAction = `${why}: Standby`; }
  else if (r.after === 0) { mode = 'work'; lastAction = `${why}: Work`; }
  else error = 'mode unclear';
  if (target !== null && r.ok && r.after !== target) error = 'base did not take the new mode';
  renderAll();
  if (pending) { const p = pending; pending = null; changeMode(p); }
}

// ---- cockpit plug ----
const watcher = new Watcher({
  pluginDir: PLUGIN_DIR,
  getName: () => settings.plugName,
  log,
  port: process.env.MOZA_TEST_PLUG_PORT ? Number(process.env.MOZA_TEST_PLUG_PORT) : undefined,
  intervalMs: process.env.MOZA_TEST_POLL_MS ? Number(process.env.MOZA_TEST_POLL_MS) : 3000,
  onStatus: (s) => { plug = s; sendPi(); },
  onChange: (cur) => {
    if (!settings.follow) { log.info('[plug] changed but "follow the plug" is off; nothing done'); return; }
    if (cur === 'on') changeMode({ target: 0, relaunch: true, why: 'Cockpit on' });
    else changeMode({ target: 1, relaunch: false, why: 'Cockpit off' });
  },
});

sd.on('open', () => { send({ event: registerEvent, uuid: pluginUUID }); log.info('Registered with Stream Dock'); watcher.start(); });
sd.on('close', () => { log.info('Stream Dock closed the connection; exiting'); process.exit(0); });
sd.on('error', (e) => log.error('Stream Dock connection error', e.message));
sd.on('message', (buf) => {
  let msg; try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
  try { handle(msg); } catch (e) { log.error('Event failed', msg.event, e); }
});

function handle(msg) {
  switch (msg.event) {
    case 'willAppear': contexts.set(msg.context, { action: msg.action }); setKey(msg.context); break;
    case 'willDisappear': contexts.delete(msg.context); lastImage.delete(msg.context); break;
    case 'keyDown': changeMode({ target: null, relaunch: true, why: 'Key press' }); break;
    case 'propertyInspectorDidAppear': piContext = msg.context; piAction = msg.action; sendPi(); break;
    case 'propertyInspectorDidDisappear': if (piContext === msg.context) piContext = null; break;
    case 'sendToPlugin': {
      const p = msg.payload || {};
      piContext = msg.context; piAction = msg.action;
      if (p.cmd === 'settings') {
        if (typeof p.follow === 'boolean') settings.follow = p.follow;
        if (typeof p.plugName === 'string' && p.plugName.trim()) { if (p.plugName.trim() !== settings.plugName) { settings.plugName = p.plugName.trim(); watcher.reset(); } }
        saveSettings();
        log.info(`[settings] follow=${settings.follow} plug="${settings.plugName}"`);
      }
      sendPi();
      break;
    }
    default: break;
  }
}
