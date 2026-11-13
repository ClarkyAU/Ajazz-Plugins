'use strict';
// Read-only Tuya local (protocol 3.3) status check for one plug. Opens a short TCP connection to port 6668,
// asks for the status, closes. The local key is only used to decrypt and is never logged.
const net = require('net');
const crypto = require('crypto');

const CMD = { CONTROL_NEW: 13, DP_QUERY: 10 };
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function ecb(key, data, enc) {
  const c = (enc ? crypto.createCipheriv : crypto.createDecipheriv)('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  c.setAutoPadding(true);
  return Buffer.concat([c.update(data), c.final()]);
}
function pack(seq, cmd, payload) {
  const head = Buffer.alloc(16);
  head.writeUInt32BE(0x000055aa, 0); head.writeUInt32BE(seq, 4); head.writeUInt32BE(cmd, 8); head.writeUInt32BE(payload.length + 8, 12);
  const body = Buffer.concat([head, payload]);
  const tail = Buffer.alloc(8); tail.writeUInt32BE(crc32(body), 0); tail.writeUInt32BE(0x0000aa55, 4);
  return Buffer.concat([body, tail]);
}
function splitFrames(buf) {
  const frames = []; let off = 0;
  while (buf.length - off >= 24) {
    if (buf.readUInt32BE(off) !== 0x000055aa) { off++; continue; }
    const len = buf.readUInt32BE(off + 12);
    if (len > 65536) { off++; continue; }
    if (buf.length - off < 16 + len) break;
    frames.push({ cmd: buf.readUInt32BE(off + 8), payload: buf.slice(off + 16, off + 16 + len - 8) });
    off += 16 + len;
  }
  return { frames, rest: buf.slice(off) };
}
// Turn a reply payload into JSON (or a short text) following the 3.3 rules.
function decode(payload, key) {
  let d = payload;
  if (d.length >= 4 && (d.readUInt32BE(0) & 0xffffff00) === 0) d = d.slice(4); // return code
  if (d.length >= 15 && d.slice(0, 3).toString() === '3.3') d = d.slice(15);
  if (d[0] !== 123) {
    const printable = /^[\x20-\x7e]+$/.test(d.toString('latin1'));
    if (d.length % 16 === 0 || !printable) {
      try { d = ecb(key, d.slice(0, d.length - (d.length % 16)), false); } catch (_) { return null; }
    }
  }
  const text = d.toString('utf8');
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) { /* fall through */ } }
  return { __text: text.replace(/[^\x20-\x7e]/g, '') };
}

// dev = { id, key, ip, version }.  Resolves { ok, on, power, error }.
function readPlug(dev, { timeoutMs = 4000, port = 6668, switchDp = '1', powerDp = null } = {}) {
  return new Promise((resolve) => {
    if (!dev || !dev.ip || !dev.key || !dev.id) return resolve({ ok: false, error: 'plug details missing' });
    if (dev.version && String(dev.version) !== '3.3') return resolve({ ok: false, error: 'plug protocol ' + dev.version + ' not supported yet' });
    let done = false; let buf = Buffer.alloc(0); let seq = 1; let asked22 = false;
    const sock = net.connect({ host: dev.ip, port });
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (_) { /* ignore */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: 'plug did not answer' }), timeoutMs);
    const query = () => {
      const t = String(Math.floor(Date.now() / 1000));
      const j = JSON.stringify({ gwId: dev.id, devId: dev.id, uid: dev.id, t });
      sock.write(pack(seq++, CMD.DP_QUERY, ecb(dev.key, Buffer.from(j), true)));
    };
    sock.on('connect', query);
    sock.on('error', (e) => finish({ ok: false, error: 'cannot connect: ' + (e.code || e.message) }));
    sock.on('close', () => finish({ ok: false, error: 'plug closed the connection' }));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = splitFrames(buf); buf = rest;
      for (const f of frames) {
        const j = decode(f.payload, dev.key);
        if (!j) continue;
        if (j.__text) {
          if (/data unvalid/i.test(j.__text) && !asked22) { // older 22-character device ids ask differently
            asked22 = true;
            const t = String(Math.floor(Date.now() / 1000));
            const dps = {}; dps[switchDp] = null;
            const enc = ecb(dev.key, Buffer.from(JSON.stringify({ devId: dev.id, uid: dev.id, t, dps })), true);
            sock.write(pack(seq++, CMD.CONTROL_NEW, Buffer.concat([Buffer.from('3.3'), Buffer.alloc(12), enc])));
          }
          continue;
        }
        const dps = j.dps || (j.data && j.data.dps);
        if (dps && Object.prototype.hasOwnProperty.call(dps, switchDp)) {
          const r = { ok: true, on: dps[switchDp] === true };
          if (powerDp && dps[powerDp] != null) r.power = dps[powerDp];
          return finish(r);
        }
      }
    });
  });
}

module.exports = { readPlug, pack, splitFrames, decode, ecb };
