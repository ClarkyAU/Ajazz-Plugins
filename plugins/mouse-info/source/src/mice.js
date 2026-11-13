// Turns listener events into a list of mice with battery, connection and profile.
'use strict';

const CONN_LABEL = { receiver: 'Wireless', cable: 'Cable', bluetooth: 'Bluetooth' };

// Glorious "MouseV2" family: PID prefix -> Glorious Core productId.
const CORE_PRODUCT = { '821': 'ModelI2Wireless', '822': 'ModelO2Wireless', '824': 'ModelD2Wireless', '826': 'ModelO2MiniWireless' };

// Parse a Glorious report (hex string, report id first).
//   06 FB level charging  -> battery
//   06 F6 n               -> profile switch, n = 0-based (Model O 2 / D 2 / O 2 Mini)
//   04 F1 n (n 1..3)      -> profile switch, n = 1-based (Model I 2, consumer channel)
function parseGloriousReport(hex) {
  if (typeof hex !== 'string' || hex.length < 6) return null;
  const b = Buffer.from(hex, 'hex');
  if (b[0] === 0x06 && b[1] === 0xfb && b.length >= 4 && b[2] <= 100) return { level: b[2], charging: b[3] !== 0 };
  if (b[0] === 0x06 && b[1] === 0xf6 && b[2] <= 7) return { profile: b[2] + 1 };
  if (b[0] === 0x04 && b[1] === 0xf1 && b[2] >= 1 && b[2] <= 8) return { profile: b[2] };
  return null;
}

const BT_MOUSE_NAME = /mouse|mice|\bmx\b|model [oid]|viper|deathadder|basilisk|pulsefire|g\s?(30[0-9]|50[0-9]|70[0-9]|90[0-9]|pro)|logi|razer|glorious|zowie|pulsar|lamzu|vaxee|finalmouse|endgame/i;

class MiceState {
  constructor(saved) {
    saved = saved || {};
    this.mice = new Map();
    for (const [id, m] of Object.entries(saved.mice || {})) {
      this.mice.set(id, Object.assign({ levelAt: m.updated || 0 }, m, { present: false, conns: [], charging: false }));
    }
    this.dirty = false;
  }

  _mouse(id, init) {
    let m = this.mice.get(id);
    if (!m) { m = Object.assign({ id, level: null, levelAt: 0, charging: false, present: false, conns: [] }, init); this.mice.set(id, m); }
    return m;
  }

  // listener {type:'devices', list:[{pid, model, conn}]}
  setGloriousDevices(list, now) {
    const byId = new Map();
    for (const d of list || []) {
      if (!d || !d.pid || !d.model) continue;
      const fam = d.pid.slice(0, 3).toUpperCase();
      const id = 'glorious:' + fam;
      if (!byId.has(id)) byId.set(id, { model: d.model, fam, conns: [] });
      byId.get(id).conns.push(d.conn);
    }
    for (const m of this.mice.values()) {
      if (m.source === 'glorious' && !byId.has(m.id) && m.present) { m.present = false; m.conns = []; m.charging = false; this.dirty = true; }
    }
    for (const [id, info] of byId) {
      const m = this._mouse(id, { source: 'glorious' });
      m.source = 'glorious'; m.short = info.model; m.name = 'Glorious ' + info.model; m.coreProduct = CORE_PRODUCT[info.fam];
      m.present = true; m.conns = info.conns;
      const conn = pickConn(info.conns);
      // On the cable the mouse charges but reports nothing at all (confirmed on a Model I 2, and it does
      // not answer Glorious Core's battery request either), so charging is inferred.
      if (conn === 'cable' && m.conn !== 'cable') { m.cableSince = now; m.charging = true; }
      if (conn !== 'cable' && m.conn === 'cable') m.charging = false;
      m.conn = conn;
      this.dirty = true;
    }
  }

  // listener {type:'report', pid, model, conn, hex}
  gloriousReport(ev, now) {
    const r = parseGloriousReport(ev.hex);
    if (!r) return null;
    const fam = String(ev.pid).slice(0, 3).toUpperCase();
    const m = this._mouse('glorious:' + fam, { source: 'glorious', name: 'Glorious ' + ev.model, short: ev.model, coreProduct: CORE_PRODUCT[fam] });
    m.present = true;
    if (r.level != null) {
      m.level = r.level; m.levelAt = now;
      m.charging = r.charging || m.conn === 'cable';
    }
    if (r.profile != null) { m.liveProfile = r.profile; m.liveProfileAt = now; }
    this.dirty = true;
    return Object.assign({ id: m.id }, r);
  }

  // listener {type:'bt', list:[{id, name, level}]}
  setBluetooth(list, now) {
    const ids = new Set();
    for (const d of list || []) {
      if (!d || !d.id || typeof d.level !== 'number') continue;
      const id = 'bt:' + d.id;
      ids.add(id);
      const m = this._mouse(id, { source: 'bluetooth' });
      m.source = 'bluetooth'; m.name = d.name; m.short = d.name; m.conn = 'bluetooth'; m.conns = ['bluetooth'];
      m.present = true; m.looksLikeMouse = BT_MOUSE_NAME.test(d.name || '');
      if (m.level !== d.level) this.dirty = true;
      m.level = Math.max(0, Math.min(100, d.level)); m.levelAt = now;
    }
    for (const m of this.mice.values()) {
      if (m.source === 'bluetooth' && !ids.has(m.id) && m.present) { m.present = false; m.conns = []; this.dirty = true; }
    }
  }

  list() { return [...this.mice.values()]; }

  // Which mouse the keys show. source: auto|glorious|bluetooth, mouseId: auto|<id>
  selected(source, mouseId) {
    const all = this.list().filter(m => source === 'glorious' ? m.source === 'glorious' : source === 'bluetooth' ? m.source === 'bluetooth' : true);
    if (mouseId && mouseId !== 'auto') return all.find(m => m.id === mouseId) || null;
    const bt = all.filter(x => x.source === 'bluetooth');
    const cands = all.filter(m => m.source === 'glorious' || m.looksLikeMouse || bt.length === 1);
    const rank = m => (m.present ? 0 : 10) + (m.source === 'glorious' ? 0 : m.looksLikeMouse ? 1 : 3);
    cands.sort((a, b) => rank(a) - rank(b) || (b.levelAt || 0) - (a.levelAt || 0));
    return cands[0] || null;
  }

  toJSON() {
    const mice = {};
    for (const [id, m] of this.mice) mice[id] = { id, source: m.source, name: m.name, short: m.short, conn: m.conn, level: m.level, levelAt: m.levelAt, coreProduct: m.coreProduct, looksLikeMouse: m.looksLikeMouse };
    return { version: 2, mice };
  }
}

function pickConn(conns) {
  for (const c of ['cable', 'receiver', 'bluetooth']) if (conns.includes(c)) return c;
  return conns[0] || null;
}

module.exports = { MiceState, parseGloriousReport, CONN_LABEL, CORE_PRODUCT, pickConn };
