'use strict';
// TrueNAS 25.x client: JSON-RPC 2.0 over a secure WebSocket (wss://host/api/current).
// API keys are only ever sent over wss:// — TrueNAS revokes keys used over plain ws://.

const WebSocket = require('ws');
const { EventEmitter } = require('events');

const HISTORY = 60; // samples kept for graphs (~2 min at 2 s)

function normalizeHost(input) {
  let h = String(input || '').trim();
  h = h.replace(/^(https?|wss?):\/\//i, '');
  h = h.replace(/\/.*$/, '');
  return h;
}

class TrueNAS extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.cfg = { host: '', apiKey: '', allowSelfSigned: true };
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.status = 'unconfigured'; // unconfigured | connecting | connected | error | auth
    this.statusText = 'Open the settings';
    this.retryMs = 2000;
    this.timers = [];
    this.reconnectTimer = null;
    this.gen = 0;
    this.data = this.emptyData();
  }

  emptyData() {
    return {
      info: null,
      cpu: null, cpuTemp: null, cores: [],
      mem: null, arc: null,
      ifaces: {}, ifaceNames: [],
      pools: [], alerts: [], apps: [],
      hist: { cpu: [], ram: [], temp: [], down: {}, up: {} },
      lastRealtime: 0,
      updatedAt: 0,
    };
  }

  configure(cfg) {
    const next = {
      host: normalizeHost(cfg.host),
      apiKey: String(cfg.apiKey || '').trim(),
      allowSelfSigned: cfg.allowSelfSigned !== false,
    };
    const same = next.host === this.cfg.host && next.apiKey === this.cfg.apiKey &&
      next.allowSelfSigned === this.cfg.allowSelfSigned;
    this.cfg = next;
    if (same && (this.status === 'connected' || this.status === 'connecting')) return;
    this.restart();
  }

  get baseUrl() { return this.cfg.host ? `https://${this.cfg.host}` : ''; }

  setStatus(status, text) {
    if (this.status === status && this.statusText === text) return;
    this.status = status;
    this.statusText = text;
    this.log.info(`TrueNAS status: ${status} - ${text}`);
    this.emit('status');
    this.emit('update');
  }

  restart() {
    this.stop();
    this.data = this.emptyData();
    if (!this.cfg.host || !this.cfg.apiKey) {
      this.setStatus('unconfigured', !this.cfg.host ? 'Add your TrueNAS address' : 'Add your API key');
      return;
    }
    this.retryMs = 2000;
    this.connect();
  }

  stop() {
    this.gen++;
    clearTimeout(this.reconnectTimer);
    this.timers.forEach(clearInterval);
    this.timers = [];
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Disconnected')); }
    this.pending.clear();
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.on('error', () => {}); this.ws.terminate(); } catch (_) {}
      this.ws = null;
    }
  }

  scheduleReconnect() {
    const gen = this.gen;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => { if (gen === this.gen) this.connect(); }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  connect() {
    this.stop();
    const gen = this.gen;
    const url = `wss://${this.cfg.host}/api/current`;
    this.setStatus('connecting', 'Connecting…');
    this.log.info(`Connecting to ${url}`);
    let ws;
    try {
      ws = new WebSocket(url, {
        rejectUnauthorized: !this.cfg.allowSelfSigned,
        handshakeTimeout: 10000,
        maxPayload: 64 * 1024 * 1024,
      });
    } catch (e) {
      this.setStatus('error', 'Check the address');
      this.log.error('Bad address', e.message);
      return;
    }
    this.ws = ws;
    ws.on('open', () => { if (gen === this.gen) this.onOpen(gen); });
    ws.on('message', (buf) => { if (gen === this.gen) this.onMessage(buf); });
    ws.on('error', (err) => {
      if (gen !== this.gen) return;
      this.log.warn('Connection error:', err.code || '', err.message);
      const m = String(err.code || err.message || '');
      if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(m)) this.lastError = 'Certificate not trusted';
      else if (/ENOTFOUND|EAI_AGAIN/i.test(m)) this.lastError = 'Address not found';
      else if (/ECONNREFUSED/i.test(m)) this.lastError = 'Connection refused';
      else if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timed out/i.test(m)) this.lastError = "Can't reach TrueNAS";
      else if (/Unexpected server response: (301|302|404)/.test(m)) this.lastError = 'Needs TrueNAS 25.04+';
      else this.lastError = "Can't reach TrueNAS";
    });
    ws.on('close', () => {
      if (gen !== this.gen) return;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Disconnected')); }
      this.pending.clear();
      this.timers.forEach(clearInterval);
      this.timers = [];
      if (this.status === 'auth') return; // wait for new settings
      this.setStatus('error', this.lastError || 'Connection lost');
      this.lastError = null;
      this.scheduleReconnect();
    });
  }

  call(method, params = [], timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('Not connected'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  onMessage(buf) {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const reason = msg.error.data?.reason || msg.error.message || 'Error';
        const e = new Error(reason);
        e.code = msg.error.code;
        e.errname = msg.error.data?.errname;
        p.reject(e);
      } else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'collection_update' && msg.params) {
      const ev = msg.params;
      if (ev.collection && ev.collection.startsWith('reporting.realtime') && ev.fields) this.onRealtime(ev.fields);
    } else if (msg.method === 'notify_unsubscribed') {
      this.log.warn('Unsubscribed:', JSON.stringify(msg.params).slice(0, 300));
    }
  }

  async onOpen(gen) {
    try {
      const ok = await this.call('auth.login_with_api_key', [this.cfg.apiKey]);
      if (gen !== this.gen) return;
      if (!ok) {
        this.setStatus('auth', 'API key rejected');
        try { this.ws.close(); } catch (_) {}
        return;
      }
    } catch (e) {
      if (gen !== this.gen) return;
      this.log.error('Login failed:', e.message);
      this.setStatus('auth', /revoked|expired/i.test(e.message) ? 'API key revoked' : 'API key rejected');
      try { this.ws.close(); } catch (_) {}
      return;
    }
    this.retryMs = 2000;
    this.setStatus('connected', 'Connected');
    try {
      await this.call('core.subscribe', ['reporting.realtime']);
    } catch (e) {
      this.log.warn('Live stats unavailable:', e.message);
    }
    const poll = (fn, ms) => {
      const run = () => { if (gen === this.gen) fn().catch((e) => this.log.warn(e.message)); };
      run();
      this.timers.push(setInterval(run, ms));
    };
    poll(() => this.refreshInfo(), 60000);
    poll(() => this.refreshPools(), 15000);
    poll(() => this.refreshAlerts(), 10000);
    poll(() => this.refreshApps(), 5000);
  }

  async refreshInfo() {
    const info = await this.call('system.info');
    this.data.info = info;
    this.data.infoAt = Date.now();
    this.changed();
  }

  async refreshPools() {
    const pools = await this.call('pool.query');
    this.data.pools = (pools || []).map((p) => ({
      name: p.name,
      status: p.status,
      healthy: p.healthy !== false && (p.status === 'ONLINE'),
      warning: !!p.warning,
      size: Number(p.size) || 0,
      allocated: Number(p.allocated) || 0,
      free: Number(p.free) || 0,
      scan: p.scan ? { state: p.scan.state, function: p.scan.function, percentage: p.scan.percentage } : null,
    })).sort((a, b) => (a.healthy - b.healthy) || (b.size - a.size) || a.name.localeCompare(b.name));
    this.data.poolsLoaded = true;
    this.changed();
  }

  async refreshAlerts() {
    const alerts = await this.call('alert.list');
    const rank = { CRITICAL: 5, ALERT: 5, EMERGENCY: 5, ERROR: 4, WARNING: 3, NOTICE: 2, INFO: 1 };
    this.data.alerts = (alerts || [])
      .filter((a) => !a.dismissed)
      .map((a) => ({
        id: a.uuid || a.id,
        level: String(a.level || 'INFO').toUpperCase(),
        rank: rank[String(a.level || 'INFO').toUpperCase()] || 1,
        text: String(a.formatted || a.text || a.klass || 'Alert').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        klass: a.klass,
      }))
      .sort((a, b) => b.rank - a.rank);
    this.data.alertsLoaded = true;
    this.changed();
  }

  async refreshApps() {
    const apps = await this.call('app.query', [[], { select: ['name', 'id', 'state', 'metadata', 'upgrade_available', 'portals'] }])
      .catch(() => this.call('app.query'));
    this.data.apps = (apps || []).map((a) => ({
      name: a.name,
      id: a.id || a.name,
      title: a.metadata?.title || a.name,
      icon: a.metadata?.icon || '',
      state: a.state,
      upgrade: !!a.upgrade_available,
      portal: a.portals ? Object.values(a.portals)[0] : '',
    })).sort((a, b) => a.name.localeCompare(b.name));
    this.data.appsLoaded = true;
    this.changed();
  }

  onRealtime(f) {
    const d = this.data;
    const now = Date.now();
    if (f.cpu) {
      const agg = f.cpu.cpu || f.cpu.average || {};
      d.cpu = num(agg.usage);
      const temps = Object.entries(f.cpu).filter(([k]) => k !== 'cpu').map(([, v]) => num(v?.temp)).filter((t) => t != null && t > 0);
      d.cpuTemp = num(agg.temp) || (temps.length ? Math.max(...temps) : null);
      d.cores = Object.entries(f.cpu).filter(([k]) => /^cpu\d+$/.test(k)).map(([, v]) => num(v?.usage) || 0);
    }
    if (f.memory) {
      const total = num(f.memory.physical_memory_total);
      const avail = num(f.memory.physical_memory_available);
      if (total) d.mem = { total, used: Math.max(0, total - (avail || 0)), arc: num(f.memory.arc_size) || 0 };
    }
    if (f.memory || f.zfs) {
      d.arc = {
        size: num(f.memory?.arc_size) || 0,
        hit: num(f.zfs?.demand_data_hit_percentage),
      };
    }
    if (f.interfaces) {
      d.ifaces = {};
      for (const [name, v] of Object.entries(f.interfaces)) {
        d.ifaces[name] = {
          up: v.link_state === 'LINK_STATE_UP',
          speed: num(v.speed),
          rx: num(v.received_bytes_rate) || 0,
          tx: num(v.sent_bytes_rate) || 0,
        };
      }
      d.ifaceNames = Object.keys(d.ifaces).sort();
      const all = { rx: 0, tx: 0 };
      for (const [name, v] of Object.entries(d.ifaces)) {
        push(d.hist.down, name, v.rx);
        push(d.hist.up, name, v.tx);
        all.rx += v.rx; all.tx += v.tx;
      }
      push(d.hist.down, '*', all.rx);
      push(d.hist.up, '*', all.tx);
    }
    if (d.cpu != null) pushArr(d.hist.cpu, d.cpu);
    if (d.mem) pushArr(d.hist.ram, (d.mem.used / d.mem.total) * 100);
    if (d.cpuTemp != null) pushArr(d.hist.temp, d.cpuTemp);
    d.lastRealtime = now;
    this.changed();
  }

  changed() {
    this.data.updatedAt = Date.now();
    this.emit('update');
  }

  async startApp(name) { return this.call('app.start', [name], 30000); }
  async stopApp(name) { return this.call('app.stop', [name], 30000); }
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function pushArr(arr, v) { arr.push(v); if (arr.length > HISTORY) arr.shift(); }
function push(map, key, v) { (map[key] = map[key] || []); pushArr(map[key], v); }

module.exports = { TrueNAS, normalizeHost };
