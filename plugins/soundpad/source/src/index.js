// Soundpad "right sound" patch for the Ajazz Stream Dock store plugin (com.hotspot.soundpad).
//
// The store plugin (SoundpadPlugin.exe, closed source) plays a key's sound by its POSITION
// number in Soundpad's list. Adding, removing or sorting sounds in Soundpad shifts those
// numbers, so keys play the wrong sound until "Refresh" is pressed in each key's settings.
//
// This helper sits between the Ajazz software and SoundpadPlugin.exe and passes every message
// through unchanged, except a "Play Sound" key press: just before it, the helper asks the exe
// for Soundpad's current list (the same "refresh" the settings panel uses), finds the key's
// sound by NAME, and corrects the saved position number if it moved. Then the press goes on.
// If anything goes wrong the press goes through exactly as before.

'use strict';
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PLAY_ACTION = 'com.hotspot.soundpadplay';
const LIST_TIMEOUT_MS = Number(process.env.SP_PATCH_LIST_TIMEOUT_MS || 1500);
const PLUGIN_DIR = path.resolve(__dirname, '..');
const LOG_FILE = path.join(__dirname, 'patch.log');
const VERSION = '1.0.0';

// ---------- log ----------
function log(...parts) {
  const line = new Date().toISOString() + ' ' + parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ') + '\n';
  try {
    try { if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (_) {}
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
  if (process.env.SP_PATCH_ECHO) process.stdout.write(line);
}

// ---------- arguments from the Ajazz software ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-') && i + 1 < argv.length) { out[argv[i].replace(/^-+/, '')] = argv[i + 1]; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// ---------- pure logic: pick the right Soundpad position for a key ----------
// list: [{category, index, name}], settings: the key's saved settings.
// Returns { index, rank, reason } or { missing: true } or null (leave the key alone).
function resolveSound(list, settings) {
  const name = settings && settings.SoundSelect;
  if (!name || !Array.isArray(list) || list.length === 0) return null;
  const stored = parseInt(settings.SoundIndexInput, 10);
  let candidates = list.filter(s => s.name === name);
  if (candidates.length === 0) return { missing: true };
  // Several sounds with the same name: prefer the key's category if that narrows it down.
  if (candidates.length > 1 && settings.CategorySelect) {
    const inCat = candidates.filter(s => s.category === settings.CategorySelect);
    if (inCat.length > 0) candidates = inCat;
  }
  const idx = candidates.map(s => Number(s.index)).sort((a, b) => a - b);
  if (idx.length === 1) return { index: idx[0], rank: 0, reason: 'unique name' };

  // Same name more than once. Remember WHICH copy (1st, 2nd...) the key means.
  const changedByUser = settings.PatchName !== name || String(settings.PatchIndex) !== String(settings.SoundIndexInput);
  const rank = Number(settings.PatchRank);
  if (!changedByUser && Number.isInteger(rank) && rank >= 0 && rank < idx.length) {
    return { index: idx[rank], rank, reason: 'same name, remembered copy ' + (rank + 1) };
  }
  if (idx.includes(stored)) return { index: stored, rank: idx.indexOf(stored), reason: 'same name, kept saved copy' };
  return { index: idx[0], rank: 0, reason: 'same name, first copy' };
}

// ---------- the bridge ----------
function start() {
  const port = args.port, uuid = args.pluginUUID, registerEvent = args.registerEvent, info = args.info;
  log('starting patch', VERSION, { node: process.version, port, folder: PLUGIN_DIR });
  if (!port) { log('no -port given, exiting'); process.exit(1); }

  let upstream = null;          // connection to the Ajazz software
  let child = null;             // SoundpadPlugin.exe
  let exeSocket = null;         // its connection to us
  const toUpstream = [];        // queued until the Ajazz connection is open
  let pendingList = null;       // { resolve, timer } while we wait for the sound list
  let chain = Promise.resolve(); // keeps Ajazz -> exe messages in their original order
  let shuttingDown = false;

  function sendUp(obj) {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (upstream && upstream.readyState === WebSocket.OPEN) upstream.send(text); else toUpstream.push(text);
  }
  function sendExe(obj) {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (exeSocket && exeSocket.readyState === WebSocket.OPEN) exeSocket.send(text);
  }
  function quit(why) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('stopping:', why);
    try { if (child && child.exitCode === null) child.kill(); } catch (_) {}
    setTimeout(() => process.exit(0), 300);
  }

  function askForList(msg) {
    return new Promise(resolve => {
      if (pendingList) { clearTimeout(pendingList.timer); pendingList.resolve(null); }
      const timer = setTimeout(() => { pendingList = null; resolve(null); }, LIST_TIMEOUT_MS);
      pendingList = { resolve: list => { clearTimeout(timer); pendingList = null; resolve(list); }, timer };
      sendExe({ event: 'sendToPlugin', action: msg.action, context: msg.context, payload: { refresh: true } });
    });
  }

  async function fixKeyDown(msg) {
    const settings = (msg.payload && msg.payload.settings) || {};
    if (!settings.SoundSelect) return true; // nothing to look up by
    const t0 = Date.now();
    const list = await askForList(msg);
    if (!list) { log('no sound list from the plugin in time; playing saved number', settings.SoundIndexInput); return true; }
    const r = resolveSound(list, settings);
    if (!r) return true;
    if (r.missing) {
      log('sound not in Soundpad any more:', settings.SoundSelect, '- not playing a wrong one');
      sendUp({ event: 'showAlert', context: msg.context });
      return false;
    }
    const old = String(settings.SoundIndexInput || '');
    const fixed = Object.assign({}, settings, {
      SoundIndexInput: String(r.index), PatchName: settings.SoundSelect, PatchIndex: String(r.index), PatchRank: r.rank,
    });
    const changed = old !== String(r.index) || settings.PatchName !== fixed.PatchName ||
      String(settings.PatchIndex) !== fixed.PatchIndex || Number(settings.PatchRank) !== r.rank;
    if (changed) {
      if (old !== String(r.index)) log('fixed', JSON.stringify(settings.SoundSelect), 'from', old || '(none)', 'to', r.index, '(' + r.reason + ')', (Date.now() - t0) + 'ms');
      sendUp({ event: 'setSettings', context: msg.context, payload: fixed });
      sendExe({ event: 'didReceiveSettings', action: msg.action, context: msg.context, device: msg.device,
        payload: Object.assign({}, msg.payload, { settings: fixed }) });
      msg.payload = Object.assign({}, msg.payload, { settings: fixed });
    }
    return true;
  }

  function fromAjazz(text) {
    let msg = null;
    try { msg = JSON.parse(text); } catch (_) {}
    if (!msg || msg.event !== 'keyDown' || msg.action !== PLAY_ACTION) {
      chain = chain.then(() => sendExe(text));
      return;
    }
    chain = chain.then(async () => {
      let forward = true;
      try { forward = await fixKeyDown(msg); } catch (e) { log('lookup failed, playing saved number:', String(e && e.stack || e)); forward = true; msg = JSON.parse(text); }
      if (forward) sendExe(msg);
    });
  }

  function fromExe(text, isFirst) {
    if (isFirst) { connectUpstream(text); return; }
    if (pendingList) {
      try {
        const m = JSON.parse(text);
        let pl = m && m.payload;
        if (typeof pl === 'string') { try { pl = JSON.parse(pl); } catch (_) {} }
        const cs = pl && pl.CategoryAndSounds;
        if (cs && Array.isArray(cs.sounds)) { pendingList.resolve(cs.sounds); return; } // our own request: keep it to ourselves
      } catch (_) {}
    }
    sendUp(text);
  }

  function connectUpstream(registration) {
    upstream = new WebSocket('ws://127.0.0.1:' + port);
    upstream.on('open', () => {
      upstream.send(registration);
      while (toUpstream.length) upstream.send(toUpstream.shift());
      log('connected to the Stream Dock software');
    });
    upstream.on('message', data => fromAjazz(data.toString()));
    upstream.on('close', () => quit('Stream Dock software closed the connection'));
    upstream.on('error', e => log('Stream Dock connection error:', String(e.message || e)));
  }

  // Local server the real plugin connects to instead of the Ajazz software.
  const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  server.on('listening', () => {
    const localPort = server.address().port;
    const exe = process.env.SP_PATCH_EXE || path.join(PLUGIN_DIR, 'SoundpadPlugin.exe');
    const exeArgs = (process.env.SP_PATCH_EXE_ARGS ? JSON.parse(process.env.SP_PATCH_EXE_ARGS) : [])
      .concat(['-port', String(localPort), '-pluginUUID', uuid, '-registerEvent', registerEvent, '-info', info]);
    const launch = () => {
      child = spawn(exe, exeArgs, { cwd: PLUGIN_DIR, windowsHide: true, stdio: 'ignore' });
      child.on('error', e => { log('could not start the plugin program:', String(e.message || e)); quit('plugin program failed to start'); });
      child.on('exit', code => { log('plugin program exited', code); quit('plugin program exited'); });
      log('started plugin program, local port', localPort);
    };
    // A copy left over from an earlier session would also talk to Soundpad; close it first.
    if (process.platform === 'win32' && !process.env.SP_PATCH_EXE) {
      execFile('taskkill', ['/F', '/IM', 'SoundpadPlugin.exe'], { windowsHide: true }, () => launch());
    } else launch();
  });
  server.on('connection', sock => {
    if (exeSocket) { log('extra connection from plugin program ignored'); sock.close(); return; }
    exeSocket = sock;
    let first = true;
    sock.on('message', data => { const t = data.toString(); fromExe(t, first); first = false; });
    sock.on('close', () => quit('plugin program disconnected'));
  });
  server.on('error', e => { log('local server error:', String(e.message || e)); quit('local server error'); });

  process.on('uncaughtException', e => log('unexpected error:', String(e && e.stack || e)));
}

module.exports = { resolveSound, parseArgs, start };
