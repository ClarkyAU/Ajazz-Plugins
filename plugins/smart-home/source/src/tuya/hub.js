'use strict';
// Keeps track of all devices: the device list from the cloud (cached in
// devices.json so the plugin works without the cloud), where each device is
// on the network, the live LAN connections, and the cloud fallback.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { TuyaDevice } = require('./device');
const { TuyaCloud, REGIONS } = require('./cloud');
const { Discovery } = require('./discovery');
const model = require('./model');

const CLOUD_POLL_MS = 20000;
const POWER_POLL_MS = 8000;
const HISTORY_MAX = 180;

class Hub extends EventEmitter {
  constructor({ dir, log = () => {} }) {
    super();
    this.dir = dir;
    this.log = log;
    this.cachePath = path.join(dir, 'devices.json');
    this.devices = new Map(); // id -> entry
    this.creds = { accessId: '', accessSecret: '', region: 'auto' };
    this.cloud = null;
    this.account = { state: 'none', message: 'Not set up yet', region: null, refreshedAt: 0 };
    this.discovery = new Discovery({ log });
    this.discovery.on('found', (f) => this.onFound(f));
    this.wanted = new Map(); // id -> { power: bool }
    this.refreshing = null;
    this.lastAuthRefresh = 0;
    this.scanTimer = null;
    this.scanning = false;
    this.loadCache();
  }

  // ------------------------------------------------------------ cache

  loadCache() {
    try {
      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      for (const d of data.devices || []) this.addEntry(d, { ip: d.ip, version: d.version });
      if (data.region) this.account.region = data.region;
      this.account.refreshedAt = data.refreshedAt || 0;
      this.log(`loaded ${this.devices.size} devices from devices.json`);
    } catch (_) {
      // no cache yet
    }
  }

  saveCache() {
    const devices = [...this.devices.values()].map((e) => ({ ...e.info, ip: e.ip || '', version: e.version || '' }));
    const data = { savedAt: Date.now(), refreshedAt: this.account.refreshedAt, region: this.account.region, devices };
    try {
      const tmp = this.cachePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
      fs.renameSync(tmp, this.cachePath);
    } catch (e) {
      this.log('could not save devices.json: ' + e.message);
    }
  }

  addEntry(info, extra = {}) {
    let e = this.devices.get(info.id);
    if (!e) {
      e = { info, dps: {}, ip: '', version: '', conn: null, link: 'offline', cloudOnline: null, history: [], lastCloudPoll: 0 };
      this.devices.set(info.id, e);
    }
    e.info = info;
    if (extra.ip) e.ip = extra.ip;
    if (extra.version) e.version = extra.version;
    if (extra.online !== undefined) e.cloudOnline = extra.online;
    if (e.conn) e.conn.update({ ip: e.ip, version: e.version, key: info.key });
    return e;
  }

  // ------------------------------------------------------------ account / cloud

  setCredentials(c) {
    const next = {
      accessId: String(c.accessId || '').trim(),
      accessSecret: String(c.accessSecret || '').trim(),
      region: c.region in REGIONS ? c.region : 'auto',
    };
    const changed = JSON.stringify(next) !== JSON.stringify(this.creds);
    this.creds = next;
    if (!changed) return;
    this.cloud = next.accessId && next.accessSecret
      ? new TuyaCloud({ ...next, log: this.log })
      : null;
    if (this.cloud && this.account.region && next.region === 'auto') this.cloud.activeRegion = this.account.region;
    if (!this.cloud) {
      this.setAccount(this.devices.size ? 'cached' : 'none', this.devices.size ? 'Using saved device list' : 'Not set up yet');
      return;
    }
    this.refresh().catch(() => {});
  }

  setAccount(state, message, kind = '') {
    this.account.state = state;
    this.account.message = message;
    this.account.kind = kind;
    for (const e of this.devices.values()) this.updateLink(e);
    this.emit('account', this.account);
  }

  /** Fetch the device list (names, local keys, data points) from the cloud. */
  refresh() {
    if (this.refreshing) return this.refreshing;
    if (!this.cloud) {
      this.setAccount('none', 'Enter your Access ID and Access Secret first.');
      return Promise.resolve(false);
    }
    this.setAccount('working', 'Connecting to the Tuya cloud…');
    this.refreshing = (async () => {
      try {
        const region = await this.cloud.connect();
        if (region) this.account.region = region;
        const list = await this.cloud.listDevices();
        const seen = new Set();
        for (const raw of list) {
          if (raw.sub) continue; // Zigbee/BLE sub-devices need a hub; not supported locally
          let spec = null;
          try {
            spec = await this.cloud.specifications(raw.id);
          } catch (e) {
            this.log(`no data point list for ${raw.name}: ${e.message}`);
          }
          const old = this.devices.get(raw.id);
          const info = model.describe(raw, spec);
          if (!spec && old) info.cloudCodes = old.info.cloudCodes;
          this.addEntry(info, { online: raw.online });
          seen.add(raw.id);
          const e = this.devices.get(raw.id);
          // the cloud's view of the state, until the LAN connection reports
          if (!Object.keys(e.dps).length && Array.isArray(raw.status)) Object.assign(e.dps, model.cloudStatusToDps(info, raw.status));
        }
        for (const id of [...this.devices.keys()]) {
          if (!seen.has(id)) {
            const e = this.devices.get(id);
            if (e.conn) e.conn.stop();
            this.devices.delete(id);
          }
        }
        this.account.refreshedAt = Date.now();
        this.saveCache();
        const n = this.devices.size;
        const where = REGIONS[this.account.region] ? ` · ${REGIONS[this.account.region].name}` : '';
        this.setAccount('ok', n ? `Found ${n} device${n === 1 ? '' : 's'}${where}` : `Signed in, but no devices found${where}. Link the Smart Life app to the project (Devices > Link Tuya App Account).`);
        this.log(`cloud refresh: ${n} devices`, [...this.devices.values()].map((x) => `${x.info.name} (${x.info.kind}, ${x.info.category})`));
        this.emit('devices');
        this.applyWanted();
        return true;
      } catch (e) {
        this.log('cloud refresh failed: ' + (e.stack || e.message));
        const msg = this.devices.size ? `${e.message} Using saved device list.` : e.message;
        this.setAccount(e.kind === 'expired' ? 'expired' : 'error', msg, e.kind || 'api');
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // ------------------------------------------------------------ LAN

  onFound({ id, ip, version }) {
    const e = this.devices.get(id);
    if (!e) return;
    const changed = e.ip !== ip || (version && e.version !== version);
    e.ip = ip;
    if (version) e.version = version;
    if (changed) this.saveCache();
    if (e.conn) e.conn.update({ ip, version });
    else if (this.wanted.has(id)) this.connect(e);
  }

  /** Tell the hub which devices are on keys (id -> {power}). */
  setWanted(map) {
    this.wanted = map;
    this.applyWanted();
  }

  applyWanted() {
    if (this.wanted.size) this.discovery.start();
    for (const [id, e] of this.devices) {
      if (this.wanted.has(id)) {
        if (!e.conn) this.connect(e);
      } else if (e.conn) {
        e.conn.stop();
        e.conn.removeAllListeners();
        e.conn = null;
        this.updateLink(e);
      }
    }
    this.scheduleScan();
  }

  connect(e) {
    const id = e.info.id;
    if (!e.info.key) {
      this.updateLink(e);
      return;
    }
    const conn = new TuyaDevice({ id, key: e.info.key, ip: e.ip, version: e.version, log: this.log });
    e.conn = conn;
    conn.on('state', () => this.updateLink(e));
    conn.on('version', (v) => { e.version = v; this.saveCache(); });
    conn.on('dps', (changed) => this.onDps(e, changed));
    conn.on('authError', () => {
      // Local key probably changed (device re-paired): get fresh keys.
      if (this.cloud && Date.now() - this.lastAuthRefresh > 5 * 60000) {
        this.lastAuthRefresh = Date.now();
        this.log(`${e.info.name}: key rejected, refreshing device list`);
        this.refresh().catch(() => {});
      }
    });
    conn.start();
    this.updateLink(e);
  }

  /** local = talking to it on the home network, cloud = via Tuya's cloud. */
  updateLink(e) {
    let link;
    if (!e.info.key) link = 'nokey';
    else if (e.conn && e.conn.state === 'connected') link = 'local';
    else if (this.cloud && this.account.state === 'ok' && e.cloudOnline !== false) link = 'cloud';
    else if (!e.ip) link = 'searching';
    else if (e.conn && e.conn.state === 'connecting' && !e.everConnected) link = 'connecting';
    else link = 'offline';
    if (link === 'local' && e.link !== 'local') this.log(`${e.info.name}: connected on home network (${e.ip}, v${e.version || e.conn.version})`);
    if (link === 'local') e.everConnected = true;
    this.setLink(e, link);
  }

  setLink(e, link) {
    if (e.link === link) return;
    e.link = link;
    this.emit('update', e.info.id);
  }

  onDps(e, changed) {
    Object.assign(e.dps, changed);
    if (e.info.power && changed[e.info.power.dp] !== undefined) this.recordPower(e);
    this.emit('update', e.info.id);
  }

  recordPower(e) {
    const w = model.powerWatts(e.info, e.dps);
    if (w === null) return;
    const now = Date.now();
    const last = e.history[e.history.length - 1];
    if (last && now - last.t < 1500) last.w = w;
    else e.history.push({ t: now, w });
    while (e.history.length > HISTORY_MAX) e.history.shift();
  }

  /** If a wanted device hasn't been found by broadcast, scan the network once in a while. */
  scheduleScan() {
    clearTimeout(this.scanTimer);
    const missing = [...this.wanted.keys()].filter((id) => { const e = this.devices.get(id); return e && e.info.key && !e.ip; });
    if (!missing.length) return;
    this.scanTimer = setTimeout(() => this.scanForMissing().catch((err) => this.log('scan error ' + err.message)), 15000);
  }

  async scanForMissing() {
    if (this.scanning) return;
    const missing = [...this.wanted.keys()].map((id) => this.devices.get(id)).filter((e) => e && e.info.key && !e.ip);
    if (!missing.length) return;
    this.scanning = true;
    try {
      const taken = new Set([...this.devices.values()].map((e) => e.ip).filter(Boolean));
      const hosts = (await this.discovery.scan()).filter((h) => !taken.has(h));
      for (const host of hosts) {
        for (const e of missing) {
          if (e.ip) continue;
          const ok = await probe(e, host, this.log);
          if (ok) {
            this.log(`found ${e.info.name} at ${host} by network scan (v${ok})`);
            this.onFound({ id: e.info.id, ip: host, version: ok });
            break;
          }
        }
      }
    } finally {
      this.scanning = false;
      // try again later if something is still missing
      const still = [...this.wanted.keys()].some((id) => { const e = this.devices.get(id); return e && e.info.key && !e.ip; });
      if (still) this.scanTimer = setTimeout(() => this.scanForMissing().catch(() => {}), 5 * 60000);
    }
  }

  // ------------------------------------------------------------ control

  async set(id, dps) {
    const e = this.devices.get(id);
    if (!e) return false;
    // optimistic: show the change straight away
    const before = { ...e.dps };
    Object.assign(e.dps, dps);
    this.emit('update', id);
    let ok = false;
    if (e.conn && e.conn.state === 'connected') ok = await e.conn.set(dps);
    if (!ok && this.cloud && this.account.state !== 'expired') {
      try {
        const cmds = model.dpsToCloudCommands(e.info, dps);
        if (cmds.length) {
          await this.cloud.command(id, cmds);
          ok = true;
        }
      } catch (err) {
        this.log(`cloud command for ${e.info.name} failed: ${err.message}`);
      }
    }
    if (!ok) {
      // put it back and say it didn't work
      for (const k of Object.keys(dps)) e.dps[k] = before[k];
      this.emit('update', id);
      this.emit('failed', id);
    }
    return ok;
  }

  /** Called every few seconds: power readings and cloud fallback polling. */
  async tick() {
    const now = Date.now();
    for (const [id, opts] of this.wanted) {
      const e = this.devices.get(id);
      if (!e) continue;
      if (e.conn && e.conn.state === 'connected') {
        if (opts.power && e.info.power && now - (e.lastPowerAsk || 0) > POWER_POLL_MS) {
          e.lastPowerAsk = now;
          e.conn.requestDps([e.info.power.dp]);
          this.recordPower(e);
        }
        continue;
      }
      if (this.cloud && this.account.state === 'ok' && now - e.lastCloudPoll > CLOUD_POLL_MS) {
        e.lastCloudPoll = now;
        try {
          const st = await this.cloud.status(id);
          e.cloudOnline = true;
          this.onDps(e, model.cloudStatusToDps(e.info, st));
        } catch (err) {
          this.log(`cloud status for ${e.info.name} failed: ${err.message}`);
          if (/offline/i.test(err.message)) e.cloudOnline = false;
        }
        this.updateLink(e);
      }
    }
  }

  /** Summary for the settings panel. */
  listForPanel() {
    return [...this.devices.values()].map((e) => ({
      id: e.info.id,
      name: e.info.name,
      kind: e.info.kind,
      product: e.info.product,
      switches: e.info.switches.map((s) => ({ dp: s.dp, label: s.label })),
      hasPower: !!e.info.power,
      isLight: !!e.info.light,
      dimmable: !!(e.info.light && (e.info.light.brightDp || e.info.light.colourDp)),
      link: e.link,
      ip: e.ip,
      version: e.version,
      noKey: !e.info.key,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  stop() {
    this.discovery.stop();
    clearTimeout(this.scanTimer);
    for (const e of this.devices.values()) if (e.conn) e.conn.stop();
  }
}

/** Try to talk to `host` as device `e`. Resolves the protocol version, or null. */
function probe(e, host, log) {
  return new Promise((resolve) => {
    const d = new TuyaDevice({ id: e.info.id, key: e.info.key, ip: host, version: e.version, log: () => {} });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      d.stop();
      resolve(v);
    };
    d.on('dps', () => finish(d.version || null));
    d.on('authError', () => { if (e.version) finish(null); });
    const timer = setTimeout(() => finish(null), e.version ? 7000 : 16000);
    d.start();
  });
}

module.exports = { Hub };
