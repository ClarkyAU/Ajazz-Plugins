'use strict';
/*
 * Now Playing (com.clarkyau.nowplaying) - plugin for the Ajazz AKP153E,
 * running inside the Stream Dock software's own Node.js.
 *
 * Actions:
 *   Now Playing   - album art, title, artist, album, player, time, progress.
 *                   Neighbouring keys join into one display; each key has a
 *                   "Shows" choice (Automatic picks from its position).
 *   Play / Pause, Previous, Next, Volume Down, Volume Up, Mute.
 *
 * Track info comes from Windows' own media controls (media.ps1), so it works
 * with Spotify, browsers, Apple Music etc. without any sign-in.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const raster = require('./raster');
const render = require('./render');
const layout = require('./layout');
const { Media, prettyApp } = require('./media');
const {
  ID, OLD_ID, CONTROLS, DISPLAYS, ACTIONS, LOOK_KEYS,
  cleanKeySettings, cleanGlobals, parseColor
} = require('./settings');

const PLUGIN_DIR = process.env.NOWPLAYING_PLUGIN_DIR || path.resolve(__dirname, '..');
const ASSET_DIR = fs.existsSync(path.join(__dirname, 'assets')) ? path.join(__dirname, 'assets') : path.join(PLUGIN_DIR, 'plugin', 'assets');
const HELPER_DIR = fs.existsSync(path.join(__dirname, 'media.ps1')) ? __dirname : path.join(PLUGIN_DIR, 'plugin');
const OLD_DIR = path.join(path.dirname(PLUGIN_DIR), `${OLD_ID}.sdPlugin`);
const DEFAULT_ACCENT = [120, 136, 255];

// ---------------------------------------------------------------------------
// Log (plugin.log in the plugin folder, kept under ~1 MB)
// ---------------------------------------------------------------------------
const LOG_PATH = path.join(PLUGIN_DIR, 'plugin.log');
function log(...parts) {
  try {
    try { if (fs.statSync(LOG_PATH).size > 1024 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.old'); } catch (_) { /* none yet */ }
    const lineText = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${lineText}\n`);
  } catch (_) { /* logging must never break the plugin */ }
}
process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack ? e.stack : String(e)));
process.on('unhandledRejection', (e) => log('unhandledRejection', e && e.stack ? e.stack : String(e)));

// Test hook: every image is also written here with what's on it.
const TRACE = process.env.NOWPLAYING_TRACE || null;
function trace(entry) {
  if (TRACE) { try { fs.appendFileSync(TRACE, JSON.stringify(entry) + '\n'); } catch (_) { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// Start-up arguments and deck details
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (/^-{1,2}[A-Za-z]/.test(argv[i])) { out[argv[i].replace(/^-+/, '')] = argv[i + 1]; i++; }
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
} catch (e) { log('could not read deck info: ' + e.message); }

let G = cleanGlobals({});

// The AKP153 family reports keys in hardware order: index = row*5 + column,
// running down each column from the top right. The side screen (column 5) is
// reported normally.
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

// ---------------------------------------------------------------------------
// Connection to the Stream Dock software
// ---------------------------------------------------------------------------
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
ws.on('open', () => {
  ws.send(JSON.stringify({ event: REGISTER_EVENT, uuid: PLUGIN_UUID }));
  ws.send(JSON.stringify({ event: 'getGlobalSettings', context: PLUGIN_UUID }));
  log('registered with the Stream Dock software');
});
ws.on('close', () => { log('software closed the connection, exiting'); shutdown(); });
ws.on('error', (e) => log('websocket error: ' + e.message));
ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
  try { handleHostEvent(msg); } catch (e) { log('event error', msg.event, e.stack || String(e)); }
});
function send(obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
const keys = new Map();     // context -> key
const lastSvg = new Map();  // context -> last SVG drawn (skip unchanged images)
let piContext = null;

const actionOf = (uuid) => {
  const a = String(uuid || '');
  if (!a.startsWith(ID + '.')) return null;
  const name = a.slice(ID.length + 1);
  return ACTIONS.includes(name) ? name : null;
};

function handleHostEvent(msg) {
  const { event, context } = msg;
  switch (event) {
    case 'willAppear': {
      const action = actionOf(msg.action);
      if (!action) return;
      const p = msg.payload || {};
      const c = p.coordinates || { column: 0, row: 0 };
      const device = msg.device || 'default';
      const pos = toPhysical(device, c.column | 0, c.row | 0);
      const settings = cleanKeySettings(action, p.settings);
      keys.set(context, {
        context, action, device, settings,
        reportedCol: c.column | 0, reportedRow: c.row | 0, col: pos.col, row: pos.row,
        resolved: null, span: null
      });
      lastSvg.delete(context);
      log(`key ${action} at column ${pos.col + 1}, row ${pos.row + 1}${pos.col >= 5 ? ' (side screen)' : ''} (reported ${c.column},${c.row})`);
      // Save cleaned settings so the panel always sees the full set.
      if (JSON.stringify(p.settings || {}) !== JSON.stringify(settings)) send({ event: 'setSettings', context, payload: settings });
      scheduleRender();
      break;
    }
    case 'willDisappear':
      keys.delete(context);
      lastSvg.delete(context);
      scrollingKeys.delete(context);
      scheduleRender();
      break;
    case 'keyDown':
      onKeyDown(context);
      break;
    case 'didReceiveSettings': {
      const k = keys.get(context);
      if (k) { k.settings = cleanKeySettings(k.action, msg.payload && msg.payload.settings); lastSvg.delete(context); scheduleRender(); }
      break;
    }
    case 'didReceiveGlobalSettings':
      applyGlobals(msg.payload && msg.payload.settings);
      break;
    case 'sendToPlugin': {
      const p = msg.payload || {};
      const k = keys.get(context);
      if (p.type === 'settings' && k) {
        k.settings = cleanKeySettings(k.action, p.settings);
        scheduleRender();
      } else if (p.type === 'applyAll' && k) {
        applyToAll(k, p.settings || {});
      } else if (p.type === 'globals') {
        applyGlobals(p.settings);
        send({ event: 'setGlobalSettings', context: PLUGIN_UUID, payload: G });
      }
      break;
    }
    case 'propertyInspectorDidAppear':
      piContext = context;
      sendPanelState();
      break;
    case 'propertyInspectorDidDisappear':
      if (piContext === context) piContext = null;
      break;
    case 'deviceDidConnect':
      if (msg.device && msg.deviceInfo) deviceInfo.set(String(msg.device), msg.deviceInfo);
      // falls through
    case 'systemDidWakeUp':
      lastSvg.clear();
      scheduleRender();
      break;
    default:
      break;
  }
}

function applyGlobals(input) {
  const next = cleanGlobals(input);
  if (JSON.stringify(next) === JSON.stringify(G)) return;
  G = next;
  for (const k of keys.values()) {
    const pos = toPhysical(k.device, k.reportedCol, k.reportedRow);
    k.col = pos.col; k.row = pos.row;
  }
  log('key positions: ' + G.keyLayout);
  lastSvg.clear();
  scheduleRender();
}

// "Use on all ... keys": copies this key's look (not what it shows or joining)
// to every key of the same kind; all six buttons count as one kind.
function applyToAll(k, settings) {
  const sameKind = (o) => (CONTROLS.includes(k.action) ? CONTROLS.includes(o.action) : o.action === k.action);
  let n = 0;
  for (const o of keys.values()) {
    if (!sameKind(o)) continue;
    const merged = { ...o.settings };
    for (const key of LOOK_KEYS) if (key in merged && settings[key] !== undefined) merged[key] = settings[key];
    o.settings = cleanKeySettings(o.action, merged);
    send({ event: 'setSettings', context: o.context, payload: o.settings });
    lastSvg.delete(o.context);
    n++;
  }
  log(`copied the look to ${n} ${CONTROLS.includes(k.action) ? 'button' : k.action} key(s)`);
  scheduleRender();
}

// Tells an open settings panel what its key is showing right now.
function sendPanelState() {
  const k = piContext && keys.get(piContext);
  if (!k) return;
  const groupSize = DISPLAYS.includes(k.action) ? [...keys.values()].filter((o) => o.group === k.group && o.action === k.action).length : 1;
  const sameKind = [...keys.values()].filter((o) => (CONTROLS.includes(k.action) ? CONTROLS.includes(o.action) : o.action === k.action)).length;
  send({
    event: 'sendToPropertyInspector', action: `${ID}.${k.action}`, context: k.context,
    payload: { type: 'state', resolved: k.resolved, groupSize, stripSize: k.strip ? k.strip.keys.length : 1, sameKind, side: k.col >= 5, globals: G }
  });
}

// ---------------------------------------------------------------------------
// Pressing keys
// ---------------------------------------------------------------------------
const pressedUntil = new Map();
function onKeyDown(context) {
  const k = keys.get(context);
  if (!k) return;
  if (DISPLAYS.includes(k.action)) {
    if (k.settings.press === 'playpause') togglePlayPause();
    else if (k.settings.press === 'next') media.command('next');
    return;
  }
  pressedUntil.set(context, Date.now() + 180);
  lastSvg.delete(context);
  scheduleRender();
  setTimeout(() => { pressedUntil.delete(context); scheduleRender(); }, 220);
  if (k.action === 'playpause') togglePlayPause();
  else media.command(k.action);
}

function togglePlayPause() {
  media.command('playpause');
  // Flip the icon straight away; the real state follows a moment later.
  const s = media.state;
  if (s.status === 'playing') s.status = 'paused';
  else if (s.status !== 'none') s.status = 'playing';
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Scrolling: every scrolling line on the deck moves on one shared clock, so
// lines start together, pause together and repeat together.
// ---------------------------------------------------------------------------
const SPEED = { slow: 40, normal: 70, fast: 120 }; // pixels per second
const HOLD_MS = 1800;
const scrollingKeys = new Map(); // context -> longest scroll time (ms) on that key
let cycle = { start: Date.now(), length: HOLD_MS, fresh: true };

// A new song: hold still, then scroll. (The length of the first pass is filled
// in once the keys have been drawn and we know how far the text has to move.)
function restartScroll() { cycle = { start: Date.now(), length: HOLD_MS, fresh: true }; }

function offsetFn(k, durations) {
  const speed = SPEED[k.settings.scroll] || 0;
  return (id, loop) => {
    if (!speed) return 0;
    durations.push((loop / speed) * 1000);
    const t = Date.now() - cycle.start - HOLD_MS;
    if (t <= 0) return 0;
    const off = (t * speed) / 1000;
    return off >= loop ? 0 : off;
  };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function accentNow() { return media.accent || DEFAULT_ACCENT; }

function textFor(show) {
  const s = media.state;
  const none = s.status === 'none';
  switch (show) {
    case 'title': return none ? { text: 'Nothing playing', muted: true } : { text: s.title || 'Unknown title' };
    case 'artist': return none ? { text: '–', muted: true } : { text: s.artist || s.album || prettyApp(s.app) || 'Unknown artist' };
    case 'album': return none || !s.album ? { text: '–', muted: true } : { text: s.album };
    case 'player': return none ? { text: '–', muted: true } : { text: prettyApp(s.app) || 'Unknown' };
    default: return { text: '' };
  }
}

const MUTED = [138, 138, 150];

// What a Track Info strip (several keys side by side) shows.
function stripLines(show, L) {
  const st = media.state;
  const tc = parseColor(L.titleColor), ac = parseColor(L.artistColor);
  const [s1, s2] = render.STRIP_SIZES.stacked[L.size] || render.STRIP_SIZES.stacked.medium;
  const one = render.STRIP_SIZES.single[L.size] || 50;
  if (st.status === 'none') return [{ size: s1, segs: [{ text: 'Nothing playing', color: MUTED, weight: 600 }] }];
  const title = st.title || 'Unknown title';
  const artist = st.artist || st.album || prettyApp(st.app) || '';
  const T = (text, size) => ({ size, segs: [{ text, color: tc, weight: 700 }] });
  const A = (text, size, weight = 500) => ({ size, segs: [{ text, color: ac, weight }] });
  switch (show) {
    case 'title': return [T(title, one)];
    case 'artist': return [A(artist || 'Unknown artist', one)];
    case 'album': return [A(st.album || '–', one)];
    case 'player': return [A(prettyApp(st.app) || 'Unknown', one, 600)];
    case 'line': {
      const size = Math.round(one * 0.9);
      return [{ size, segs: artist ? [{ text: title, color: tc, weight: 700 }, { text: '  –  ', color: ac, weight: 500 }, { text: artist, color: ac, weight: 500 }] : [{ text: title, color: tc, weight: 700 }] }];
    }
    default: return artist ? [T(title, s1), A(artist, s2)] : [T(title, one)];
  }
}

function buildKey(k) {
  const st = k.settings;
  const accent = accentNow();
  if (CONTROLS.includes(k.action)) {
    const custom = parseColor(st.customColor) || DEFAULT_ACCENT;
    return render.controlKey(k.action, {
      accent: st.color === 'custom' ? custom : accent,
      style: st.style, status: media.state.status, pressed: (pressedUntil.get(k.context) || 0) > Date.now()
    });
  }
  const look = (L) => ({
    size: L.size, background: L.background, accent,
    titleColor: parseColor(L.titleColor), artistColor: parseColor(L.artistColor), time: L.time
  });
  const durations = [];
  let out;
  switch (k.action) {
    case 'art':
      out = render.artTile(media.art, k.span, k, { accent });
      break;
    case 'progress':
      out = render.progressTile(media.timeline(), k.span, k, look(k.span ? k.span.leader.settings : st));
      break;
    case 'time':
      out = render.timeKey(media.timeline(), look(st));
      break;
    default: { // Track Info
      const strip = k.strip;
      const n = strip ? strip.keys.length : 1;
      const L = strip ? strip.leader.settings : st; // a strip uses its left key's look
      const base = look(L);
      const lead = strip ? strip.leader : k;
      if (n > 1) {
        const res = render.stripKeys(n, stripLines(k.resolved, L), { ...base, offsetFor: offsetFn(lead, durations) });
        out = res.keys[strip.keys.indexOf(k)];
      } else if (k.resolved === 'titleartist' || k.resolved === 'line' || k.resolved === 'auto') {
        const none = media.state.status === 'none';
        const t = textFor('title'), a = none ? { text: '' } : textFor('artist');
        out = render.titleArtistKey(t.text, a.text, { ...base, titleColor: t.muted ? MUTED : base.titleColor, offsetFor: offsetFn(k, durations) });
      } else {
        const t = textFor(k.resolved);
        const color = t.muted ? MUTED : k.resolved === 'title' ? base.titleColor : base.artistColor;
        out = render.textKey(k.resolved, t.text, { ...base, color, offsetFor: offsetFn(k, durations) });
      }
    }
  }
  if (durations.length) scrollingKeys.set(k.context, Math.max(...durations));
  else scrollingKeys.delete(k.context);
  return out;
}

function drawKey(k) {
  let out;
  try { out = buildKey(k); } catch (e) { log('draw error', k.action, k.resolved, e.stack || String(e)); return; }
  if (lastSvg.get(k.context) === out.svg) return;
  lastSvg.set(k.context, out.svg);
  let image;
  try { image = raster.toDataUrl(out.svg); } catch (e) { log('render error', k.action, k.resolved, e.message); return; }
  send({ event: 'setImage', context: k.context, payload: { image, target: 0 } });
  trace({ context: k.context, action: k.action, resolved: k.resolved, col: k.col, row: k.row, texts: out.texts, image });
}

let resolvedSummary = '';
function resolveLayout() {
  const display = [...keys.values()].filter((k) => DISPLAYS.includes(k.action));
  layout.resolveAll(display);
  const summary = display.slice().sort((a, b) => a.col - b.col || a.row - b.row)
    .map((k) => `${k.col + 1},${k.row + 1}=${k.action === 'info' ? (k.strip && k.strip.keys.length > 1 ? 'strip:' : '') + k.resolved : k.action}`).join(' ');
  if (summary !== resolvedSummary) {
    resolvedSummary = summary;
    if (summary) log('layout: ' + summary);
    sendPanelState();
  }
}

let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (!ready) return;
    resolveLayout();
    for (const k of keys.values()) drawKey(k);
  }, 30);
}

// Scrolling frames (only the keys that scroll) and the shared clock.
const FRAME_MS = 160;
const frameTimer = setInterval(() => {
  if (!ready || !scrollingKeys.size) return;
  const now = Date.now();
  if (now >= cycle.start + cycle.length) {
    const longest = HOLD_MS + Math.max(0, ...scrollingKeys.values()) + 200;
    if (cycle.fresh) cycle = { start: cycle.start, length: longest, fresh: false }; // keep going, no second pause
    else cycle = { start: now, length: longest, fresh: false };
  }
  if (now < cycle.start + HOLD_MS - FRAME_MS) return; // holding still
  for (const context of [...scrollingKeys.keys()]) {
    const k = keys.get(context);
    if (k) drawKey(k);
  }
}, FRAME_MS);

// Time and progress move once a second while playing.
const clockTimer = setInterval(() => {
  if (!ready || media.state.status !== 'playing') return;
  for (const k of keys.values()) {
    if (k.action === 'time' || k.action === 'progress') drawKey(k);
  }
}, 1000);

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
const media = new Media({ dir: HELPER_DIR, log });
media.on('state', ({ trackChanged }) => {
  if (trackChanged) { restartScroll(); log(`now: ${media.state.status} - ${prettyApp(media.state.app) || 'no player'}`); }
  scheduleRender();
});
media.on('art', () => scheduleRender());

// ---------------------------------------------------------------------------
// Remove the previous version (dev.nowplaying.deck) once its keys have moved
// ---------------------------------------------------------------------------
// True while any profile page still has keys of the previous version (they
// haven't been moved yet - install.bat does that), so it must not be removed.
function oldKeysRemain() {
  const profiles = path.join(path.dirname(path.dirname(PLUGIN_DIR)), 'profiles');
  let found = false;
  const walk = (dir, depth) => {
    if (found || depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'manifest.json') {
        try { if (fs.readFileSync(p, 'utf8').includes(`"${OLD_ID}.`)) { found = true; return; } } catch (_) { /* skip */ }
      }
    }
  };
  walk(profiles, 0);
  return found;
}

function removeOldPlugin(attempt = 0) {
  if (!fs.existsSync(OLD_DIR)) return;
  try {
    const man = JSON.parse(fs.readFileSync(path.join(OLD_DIR, 'manifest.json'), 'utf8'));
    if (!JSON.stringify(man.Actions || []).includes(OLD_ID)) return;
    if (oldKeysRemain()) {
      log('the previous version (dev.nowplaying.deck) still has keys on a profile page, so it is kept; run install.bat to move them');
      return;
    }
    fs.rmSync(OLD_DIR, { recursive: true, force: true });
    log('removed the previous version of the plugin (dev.nowplaying.deck)');
  } catch (e) {
    if (e.code === 'ENOENT') return;
    if (attempt < 20) setTimeout(() => removeOldPlugin(attempt + 1), 10000);
    else log('could not remove the previous version: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
let ready = false;
raster.init(ASSET_DIR).then(() => {
  ready = true;
  scheduleRender();
}).catch((e) => log('could not start the renderer: ' + (e.stack || e)));
media.start();
setTimeout(() => removeOldPlugin(), 5000);

function shutdown() {
  clearInterval(frameTimer);
  clearInterval(clockTimer);
  media.stop();
  setTimeout(() => process.exit(0), 200);
}
