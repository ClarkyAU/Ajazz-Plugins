'use strict';
// One persistent LAN connection to a Tuya device (protocol 3.3 / 3.4 / 3.5).
// Keeps the connection open with heartbeats, reports every status change the
// device pushes (including changes made from Google Home or the phone app),
// and sends on/off/brightness commands.

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const P = require('./protocol');

const PORT = 6668;
const HEARTBEAT_MS = 10000;
const DEAD_MS = 32000; // nothing heard for this long -> reconnect
const VERSIONS = ['3.3', '3.4', '3.5'];

class TuyaDevice extends EventEmitter {
  /**
   * @param {object} o
   *   id, key (local key, 16 chars), ip, version ('3.3'|'3.4'|'3.5'|'' for auto)
   *   log(fn), port
   */
  constructor(o) {
    super();
    this.id = o.id;
    this.localKey = Buffer.from(String(o.key || ''), 'latin1');
    this.ip = o.ip || '';
    this.port = o.port || PORT;
    this.version = VERSIONS.includes(String(o.version)) ? String(o.version) : '';
    this.tryIndex = 0;
    this.log = o.log || (() => {});
    this.devType = String(o.id || '').length === 22 ? 'device22' : 'default';
    this.dps = {};
    this.state = 'idle'; // idle | connecting | connected | waiting
    this.wanted = false;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.seq = 1;
    this.sessionKey = null;
    this.timers = {};
    this.backoff = 2000;
    this.failures = 0;
    this.pending = []; // { resolve, timer }
    this.negotiation = null;
  }

  get usableVersion() {
    return this.version || VERSIONS[this.tryIndex % VERSIONS.length];
  }

  /** Change IP / version / key (e.g. after discovery or a cloud refresh). */
  update({ ip, version, key }) {
    let changed = false;
    if (ip && ip !== this.ip) { this.ip = ip; changed = true; }
    if (version && VERSIONS.includes(String(version)) && String(version) !== this.version) {
      this.version = String(version); changed = true;
    }
    if (key && key !== this.localKey.toString('latin1')) {
      this.localKey = Buffer.from(String(key), 'latin1'); changed = true;
    }
    if (changed && this.wanted) this.restart('details changed');
  }

  start() {
    this.wanted = true;
    if (this.state === 'idle') this.connect();
  }

  stop() {
    this.wanted = false;
    this.teardown();
    this.setState('idle');
  }

  restart(why) {
    this.log(`[${this.id}] reconnecting (${why})`);
    this.teardown();
    this.setState('idle');
    if (this.wanted) this.connect();
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  // ------------------------------------------------------------ connection

  connect() {
    if (!this.ip || this.localKey.length !== 16) {
      this.setState('waiting');
      return;
    }
    this.teardown();
    this.setState('connecting');
    const version = this.usableVersion;
    this.sessionKey = null;
    this.buffer = Buffer.alloc(0);
    this.seq = 1;
    const sock = net.connect({ host: this.ip, port: this.port });
    this.socket = sock;
    sock.setNoDelay(true);
    sock.setTimeout(8000);
    sock.on('connect', () => {
      sock.setTimeout(0);
      this.lastHeard = Date.now();
      if (version !== '3.3') this.negotiate();
      else if (this.version) this.onReady();
      else this.probe33();
    });
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('timeout', () => { this.log(`[${this.id}] connect timeout ${this.ip}`); sock.destroy(); });
    sock.on('error', (e) => this.log(`[${this.id}] socket error: ${e.code || e.message}`));
    sock.on('close', () => {
      if (this.socket !== sock) return;
      this.socket = null;
      this.onLost();
    });
  }

  onLost() {
    const wasConnected = this.state === 'connected';
    this.clearTimers();
    this.failPending();
    this.setState('idle');
    if (!this.wanted) return;
    if (wasConnected) {
      this.failures = 0;
      this.backoff = 1000;
    } else {
      this.failures++;
      // Version not known: try the next one.
      if (!this.version) this.tryIndex++;
      this.backoff = Math.min(this.backoff * 2, 30000);
    }
    this.timers.retry = setTimeout(() => { if (this.wanted) this.connect(); }, this.backoff);
  }

  teardown() {
    this.clearTimers();
    this.failPending();
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      try { s.destroy(); } catch (_) {}
    }
  }

  clearTimers() {
    for (const t of Object.values(this.timers)) { clearTimeout(t); clearInterval(t); }
    this.timers = {};
  }

  failPending() {
    const list = this.pending;
    this.pending = [];
    for (const p of list) { clearTimeout(p.timer); p.resolve(false); }
  }

  // Version unknown and trying 3.3: a TCP connection proves nothing, so only
  // accept 3.3 once the device answers a status query we can decrypt.
  probe33() {
    this.probing = true;
    this.query();
    this.timers.probe = setTimeout(() => {
      this.log(`[${this.id}] no 3.3 reply, trying another version`);
      if (this.socket) this.socket.destroy();
    }, 4000);
  }

  onReady() {
    this.probing = false;
    clearTimeout(this.timers.probe);
    this.failures = 0;
    this.backoff = 2000;
    if (!this.version) {
      this.version = this.usableVersion;
      this.emit('version', this.version);
    }
    this.setState('connected');
    this.query();
    this.timers.heartbeat = setInterval(() => {
      if (Date.now() - this.lastHeard > DEAD_MS) {
        this.restart('no reply from device');
        return;
      }
      this.sendCommand(P.CMD.HEART_BEAT, { gwId: this.id, devId: this.id });
    }, HEARTBEAT_MS);
  }

  // ------------------------------------------------------------ session key (3.4 / 3.5)

  negotiate() {
    const nonce = crypto.randomBytes(16);
    this.negotiation = { nonce };
    this.writeRaw(P.CMD.SESS_KEY_NEG_START, nonce, this.localKey);
    this.timers.negotiate = setTimeout(() => {
      this.log(`[${this.id}] no answer to key negotiation (v${this.usableVersion})`);
      if (this.version) this.emit('authError', 'no answer (wrong key?)');
      if (this.socket) this.socket.destroy();
    }, 5000);
  }

  onNegotiationReply(frame) {
    const v = this.usableVersion;
    const { nonce } = this.negotiation;
    let body;
    if (v === '3.5') {
      const u = P.unpackFrame(frame, { key: this.localKey, withRetcode: false });
      if (!u.ok) return this.negotiationFailed('reply did not decrypt');
      body = u.payload;
    } else {
      const u = P.unpackFrame(frame, { key: this.localKey, hmac: true, withRetcode: false });
      if (!u.ok) return this.negotiationFailed('reply failed its check');
      // skip the 4-byte return code, then decrypt
      const enc = u.payload.length % 16 === 4 ? u.payload.subarray(4) : u.payload;
      try { body = P.ecbDecrypt(this.localKey, enc); } catch (_) { return this.negotiationFailed('reply did not decrypt'); }
    }
    const expect = P.hmacSha256(this.localKey, nonce);
    let remote = null;
    for (const off of [0, 4]) {
      if (body.length >= off + 48 && body.subarray(off + 16, off + 48).equals(expect)) {
        remote = body.subarray(off, off + 16);
        break;
      }
    }
    if (!remote) return this.negotiationFailed('wrong key or version');
    clearTimeout(this.timers.negotiate);
    const answer = P.hmacSha256(this.localKey, remote);
    this.writeRaw(P.CMD.SESS_KEY_NEG_FINISH, answer, this.localKey);
    const mixed = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) mixed[i] = nonce[i] ^ remote[i];
    if (v === '3.5') this.sessionKey = P.gcmEncrypt(this.localKey, nonce.subarray(0, 12), mixed).enc;
    else this.sessionKey = P.ecbEncrypt(this.localKey, mixed, false);
    this.negotiation = null;
    this.onReady();
  }

  negotiationFailed(why) {
    this.log(`[${this.id}] key negotiation failed (v${this.usableVersion}): ${why}`);
    this.emit('authError', why);
    if (this.socket) this.socket.destroy();
  }

  // ------------------------------------------------------------ sending

  /** Encrypt + frame a message for the current protocol version. */
  writeRaw(cmd, payload, key) {
    if (!this.socket) return false;
    const v = this.usableVersion;
    let frame;
    if (v === '3.5') {
      frame = P.packFrame(this.seq++, cmd, payload, { gcmKey: key });
    } else if (v === '3.4') {
      frame = P.packFrame(this.seq++, cmd, P.ecbEncrypt(key, payload), { hmacKey: key });
    } else {
      frame = P.packFrame(this.seq++, cmd, payload);
    }
    try {
      this.socket.write(frame);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Send a JSON command, adding the version header and encryption. */
  sendCommand(cmd, json) {
    const v = this.usableVersion;
    let payload = Buffer.from(JSON.stringify(json), 'utf8');
    if (v === '3.3') {
      payload = P.ecbEncrypt(this.localKey, payload);
      if (!P.NO_HEADER.has(cmd)) payload = Buffer.concat([P.versionHeader(v), payload]);
      return this.writeRaw(cmd, payload);
    }
    if (!this.sessionKey) return false;
    if (!P.NO_HEADER.has(cmd)) payload = Buffer.concat([P.versionHeader(v), payload]);
    return this.writeRaw(cmd, payload, this.sessionKey);
  }

  query() {
    const v = this.usableVersion;
    const t = Math.floor(Date.now() / 1000);
    if (v !== '3.3') return this.sendCommand(P.CMD.DP_QUERY_NEW, {});
    if (this.devType === 'device22') {
      const dps = {};
      for (const k of Object.keys(this.dps).length ? Object.keys(this.dps) : ['1']) dps[k] = null;
      return this.sendCommand(P.CMD.CONTROL_NEW, { devId: this.id, uid: this.id, t: String(t), dps });
    }
    return this.sendCommand(P.CMD.DP_QUERY, { gwId: this.id, devId: this.id, uid: this.id, t: String(t) });
  }

  /** Ask the device to report fresh values (e.g. power readings 18,19,20). */
  requestDps(dpIds) {
    if (this.state !== 'connected' || !dpIds || !dpIds.length) return false;
    return this.sendCommand(P.CMD.UPDATEDPS, { dpId: dpIds.map(Number) });
  }

  /** Change data points, e.g. { "1": true }. Resolves true when the device accepts it. */
  set(dps) {
    return new Promise((resolve) => {
      if (this.state !== 'connected') return resolve(false);
      const v = this.usableVersion;
      const t = Math.floor(Date.now() / 1000);
      const ok = v === '3.3'
        ? this.sendCommand(P.CMD.CONTROL, { devId: this.id, uid: this.id, t: String(t), dps })
        : this.sendCommand(P.CMD.CONTROL_NEW, { protocol: 5, t, data: { dps } });
      if (!ok) return resolve(false);
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        this.pending = this.pending.filter((p) => p !== entry);
        resolve(false);
      }, 4000);
      this.pending.push(entry);
    });
  }

  settlePending(ok) {
    const p = this.pending.shift();
    if (p) { clearTimeout(p.timer); p.resolve(ok); }
  }

  // ------------------------------------------------------------ receiving

  onData(chunk) {
    this.lastHeard = Date.now();
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { frames, rest } = P.splitFrames(this.buffer);
    this.buffer = rest;
    for (const f of frames) {
      try {
        this.onFrame(f);
      } catch (e) {
        this.log(`[${this.id}] bad frame: ${e.stack || e}`);
      }
    }
  }

  onFrame(frame) {
    if (this.negotiation) {
      if (frame.cmd === P.CMD.SESS_KEY_NEG_RESP) this.onNegotiationReply(frame);
      return;
    }
    const v = this.usableVersion;
    let msg;
    if (v === '3.5') msg = P.unpackFrame(frame, { key: this.sessionKey });
    else if (v === '3.4') msg = P.unpackFrame(frame, { key: this.sessionKey, hmac: true });
    else msg = P.unpackFrame(frame, {});
    if (!msg.ok) {
      this.log(`[${this.id}] dropped a frame that failed its check (cmd ${frame.cmd})`);
      return;
    }
    if (frame.cmd === P.CMD.HEART_BEAT) return;

    const json = this.decodePayload(msg.payload);
    if (this.probing) {
      if (json && !json.__text) this.onReady();
      else return;
    }
    if (frame.cmd === P.CMD.CONTROL || frame.cmd === P.CMD.CONTROL_NEW) {
      this.settlePending(msg.retcode === 0 || msg.retcode === null);
    }
    if (!json) return;
    if (json.__text) {
      if (/data unvalid/i.test(json.__text) && v === '3.3' && this.devType !== 'device22') {
        this.log(`[${this.id}] switching to device22 mode`);
        this.devType = 'device22';
        this.query();
      }
      return;
    }
    const dps = (json.dps) || (json.data && json.data.dps);
    if (dps && typeof dps === 'object') {
      const changed = {};
      for (const [k, val] of Object.entries(dps)) {
        if (this.dps[k] !== val) changed[k] = val;
        this.dps[k] = val;
      }
      if (frame.cmd === P.CMD.STATUS) this.settlePending(true);
      this.emit('dps', changed, this.dps);
    }
  }

  decodePayload(payload) {
    if (!payload || !payload.length) return null;
    const v = this.usableVersion;
    let data = payload;
    if (v === '3.4') {
      try { data = P.ecbDecrypt(this.sessionKey, data.subarray(0, data.length - (data.length % 16))); } catch (_) { return null; }
    }
    const vb = Buffer.from(v);
    if (data.length >= 15 && data.subarray(0, 3).equals(vb)) data = data.subarray(15);
    if (v === '3.3' && data[0] !== 0x7b) {
      const printable = /^[\x20-\x7e]+$/.test(data.toString('latin1'));
      if (data.length % 16 === 0 || !printable) {
        try { data = P.ecbDecrypt(this.localKey, data.subarray(0, data.length - (data.length % 16))); } catch (_) { return null; }
      }
    }
    const text = data.toString('utf8');
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {}
    }
    return { __text: text.replace(/[^\x20-\x7e]/g, '') };
  }
}

module.exports = { TuyaDevice, VERSIONS };
