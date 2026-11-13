// Reads the active profile, DPI and polling rate that Glorious Core saved (read-only).
// %APPDATA%\Glorious Core\datastore\Devices.json + DeviceProfiles.json
'use strict';
const fs = require('fs');
const path = require('path');

function coreDir() {
  return process.env.MOUSEINFO_CORE_DIR || path.join(process.env.APPDATA || '', 'Glorious Core', 'datastore');
}

let cache = { key: '', data: null };
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); }

// Returns Map productId -> {profiles:[{num, name, dpi, dpiColor, polling, wirelessPolling}], current, updated}
function readCore() {
  const dir = coreDir();
  const fd = path.join(dir, 'Devices.json'), fp = path.join(dir, 'DeviceProfiles.json');
  let key;
  try { const a = fs.statSync(fd), b = fs.statSync(fp); key = a.mtimeMs + ':' + b.mtimeMs + ':' + a.size + ':' + b.size; }
  catch (e) { cache = { key: '', data: null }; return null; }
  if (key === cache.key) return cache.data;
  let devices, profiles;
  try { devices = readJson(fd); profiles = readJson(fp); }
  catch (e) { return cache.data; } // Core may be writing; keep the last good copy
  const byId = new Map((profiles.profiles || []).map(p => [p.id, p]));
  const out = new Map();
  for (const inst of devices.deviceInstances || []) {
    const ids = inst.iterableProfileIds && inst.iterableProfileIds.length ? inst.iterableProfileIds : [];
    const list = ids.map((id, i) => describe(byId.get(id), i));
    const curIndex = ids.indexOf(inst.currentDeviceProfileId);
    out.set(inst.productId, {
      profiles: list,
      current: curIndex >= 0 ? curIndex + 1 : (byId.get(inst.currentDeviceProfileId) ? byId.get(inst.currentDeviceProfileId).order + 1 : null),
      updated: Math.max(fs.statSync(fd).mtimeMs, fs.statSync(fp).mtimeMs),
    });
  }
  cache = { key, data: out };
  return out;
}

function describe(p, i) {
  const r = (p && p.mousePerformanceRecord) || {};
  const stages = Array.isArray(r.DpiStage) ? r.DpiStage : [];
  const st = stages[r.dpiSelectIndex] || stages.find(s => s && s.isDefault) || null;
  return {
    num: i + 1,
    name: p && p.name ? String(p.name) : 'Profile ' + (i + 1),
    dpi: st && st.value ? st.value : null,
    dpiColor: st && st.color ? hexToRgb(st.color) : null,
    polling: r.pollingrate || null,
    wirelessPolling: r.wirelessPollingRate || r.pollingrate || null,
  };
}

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 'rgb(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ')';
}

// Profile info for one mouse. The mouse's own switch message wins if it is newer than Core's files.
function profileFor(mouse, core) {
  if (!mouse || mouse.source !== 'glorious') return null;
  const c = core && mouse.coreProduct ? core.get(mouse.coreProduct) : null;
  let num = c ? c.current : null;
  if (mouse.liveProfile && (!c || !c.updated || mouse.liveProfileAt > c.updated)) num = mouse.liveProfile;
  if (num == null) return null;
  const p = c && c.profiles[num - 1];
  return Object.assign({ num, name: 'Profile ' + num, dpi: null, dpiColor: null, polling: null, wirelessPolling: null }, p || {}, { num, fromCore: !!c });
}

module.exports = { readCore, profileFor, hexToRgb, coreDir };
