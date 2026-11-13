'use strict';
// Finds Tuya devices on the home network.
//  1. Listens for the UDP broadcasts devices send every few seconds
//     (port 6666/6667 for 3.1-3.4, port 7000 for 3.5).
//  2. Asks 3.5 devices to announce themselves.
//  3. If a device still isn't found (e.g. Windows Firewall blocks the
//     broadcasts), scans the local network for the Tuya port 6668.

const dgram = require('dgram');
const net = require('net');
const os = require('os');
const { EventEmitter } = require('events');
const P = require('./protocol');

class Discovery extends EventEmitter {
  constructor({ log = () => {} } = {}) {
    super();
    this.log = log;
    this.sockets = [];
    this.timer = null;
    this.started = 0;
    this.seen = new Map(); // id -> {ip, version, at}
  }

  start() {
    if (this.started) return;
    this.started = Date.now();
    for (const port of [6666, 6667, 7000]) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
      s.on('error', (e) => {
        this.log(`discovery: can't listen on UDP ${port}: ${e.code || e.message}`);
        try { s.close(); } catch (_) {}
      });
      try {
        s.bind(port, () => { try { s.setBroadcast(true); } catch (_) {} });
        this.sockets.push(s);
      } catch (e) {
        this.log(`discovery: bind ${port} failed: ${e.message}`);
      }
    }
    this.sendRequests();
    const tick = () => {
      this.sendRequests();
      const fast = Date.now() - this.started < 120000;
      this.timer = setTimeout(tick, fast ? 6000 : 60000);
    };
    this.timer = setTimeout(tick, 6000);
  }

  stop() {
    clearTimeout(this.timer);
    for (const s of this.sockets) { try { s.close(); } catch (_) {} }
    this.sockets = [];
    this.started = 0;
  }

  onMessage(msg, rinfo) {
    const info = P.decodeBroadcast(msg);
    if (!info || info.from === 'app') return;
    const id = info.gwId || info.devId || info.id;
    if (!id) return;
    const ip = info.ip || rinfo.address;
    const version = info.version ? String(info.version) : '';
    const prev = this.seen.get(id);
    this.seen.set(id, { ip, version, at: Date.now() });
    if (!prev || prev.ip !== ip || prev.version !== version) {
      this.log(`discovery: ${id} at ${ip} (v${version || '?'})`);
      this.emit('found', { id, ip, version });
    }
  }

  sendRequests() {
    const sock = this.sockets.find((s) => { try { return !!s.address(); } catch (_) { return false; } });
    if (!sock) return;
    for (const iface of localNetworks()) {
      try { sock.send(P.discoveryRequest(iface.address), 7000, iface.broadcast); } catch (_) {}
    }
  }

  /** Scan the local /24 networks for anything listening on TCP 6668. */
  async scan() {
    const hosts = process.env.TUYA_SCAN_HOSTS
      ? process.env.TUYA_SCAN_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)
      : localNetworks().flatMap((n) => n.hosts);
    const open = [];
    const queue = hosts.slice();
    const worker = async () => {
      while (queue.length) {
        const h = queue.shift();
        if (await portOpen(h, 6668, 700)) open.push(h);
      }
    };
    await Promise.all(Array.from({ length: 48 }, worker));
    this.log(`discovery: network scan found port 6668 open on ${open.length ? open.join(', ') : 'nothing'}`);
    return open;
  }
}

function portOpen(host, port, timeout) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

/** Local IPv4 networks: address, broadcast and the /24 host list. */
function localNetworks() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      const parts = a.address.split('.').map(Number);
      const mask = (a.netmask || '255.255.255.0').split('.').map(Number);
      const bcast = parts.map((p, i) => (p | (~mask[i] & 255))).join('.');
      const base = parts.slice(0, 3).join('.');
      const hosts = [];
      for (let i = 1; i < 255; i++) if (i !== parts[3]) hosts.push(`${base}.${i}`);
      out.push({ address: a.address, broadcast: bcast, hosts });
    }
  }
  return out;
}

module.exports = { Discovery, localNetworks };
