'use strict';
// Tuya local (LAN) protocol: message framing and encryption for
// protocol versions 3.3, 3.4 and 3.5.
//
//   3.3  55AA frames, CRC32, payload AES-128-ECB with the device's local key
//   3.4  55AA frames, HMAC-SHA256, session key negotiated first, AES-ECB
//   3.5  6699 frames, AES-128-GCM, session key negotiated first
//
// Written from the public protocol descriptions (tinytuya / tuyapi) and
// checked against tinytuya in test/protocol.test.js.

const crypto = require('crypto');

const CMD = {
  SESS_KEY_NEG_START: 0x03,
  SESS_KEY_NEG_RESP: 0x04,
  SESS_KEY_NEG_FINISH: 0x05,
  CONTROL: 0x07,
  STATUS: 0x08,
  HEART_BEAT: 0x09,
  DP_QUERY: 0x0a,
  CONTROL_NEW: 0x0d,
  DP_QUERY_NEW: 0x10,
  UPDATEDPS: 0x12,
  BOARDCAST_LPV34: 0x23,
  REQ_DEVINFO: 0x25,
  LAN_EXT_STREAM: 0x40,
};

// Commands that never carry the "3.x" version header.
const NO_HEADER = new Set([
  CMD.DP_QUERY, CMD.DP_QUERY_NEW, CMD.UPDATEDPS, CMD.HEART_BEAT,
  CMD.SESS_KEY_NEG_START, CMD.SESS_KEY_NEG_RESP, CMD.SESS_KEY_NEG_FINISH, CMD.LAN_EXT_STREAM,
]);

const PREFIX_55AA = 0x000055aa;
const SUFFIX_55AA = 0x0000aa55;
const PREFIX_6699 = 0x00006699;
const SUFFIX_6699 = 0x00009966;

// Key used for the devices' UDP broadcasts (same for every device).
const UDP_KEY = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();

const versionHeader = (version) => Buffer.concat([Buffer.from(String(version)), Buffer.alloc(12)]);

// ---------------------------------------------------------------- crypto

function ecbEncrypt(key, data, pad = true) {
  const c = crypto.createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(pad);
  return Buffer.concat([c.update(data), c.final()]);
}

function ecbDecrypt(key, data) {
  const d = crypto.createDecipheriv('aes-128-ecb', key, null);
  d.setAutoPadding(false);
  const raw = Buffer.concat([d.update(data), d.final()]);
  // Tuya pads with PKCS#7, but be forgiving like the reference libraries.
  const n = raw.length ? raw[raw.length - 1] : 0;
  return n >= 1 && n <= 16 && n <= raw.length ? raw.subarray(0, raw.length - n) : raw;
}

function gcmEncrypt(key, iv, plain, aad) {
  const c = crypto.createCipheriv('aes-128-gcm', key, iv);
  if (aad) c.setAAD(aad);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return { enc, tag: c.getAuthTag() };
}

function gcmDecrypt(key, iv, enc, aad, tag) {
  const d = crypto.createDecipheriv('aes-128-gcm', key, iv);
  if (aad) d.setAAD(aad);
  if (tag) {
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]);
  }
  return d.update(enc); // no tag: decrypt without checking
}

const hmacSha256 = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// CRC32 (IEEE), same as zlib.crc32.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- framing

/**
 * Build one frame.
 *   seq, cmd: numbers
 *   payload:  already-encrypted payload for 55AA (incl. retcode if any);
 *             plaintext for 6699 (it is encrypted here)
 *   opts.hmacKey: 55AA uses HMAC-SHA256 instead of CRC32 (3.4)
 *   opts.gcmKey:  build a 6699 frame (3.5), encrypted with this key
 *   opts.iv:      12-byte IV for 6699 (random if omitted)
 */
function packFrame(seq, cmd, payload, opts = {}) {
  if (opts.gcmKey) {
    const iv = opts.iv || crypto.randomBytes(12);
    const header = Buffer.alloc(18);
    header.writeUInt32BE(PREFIX_6699, 0);
    header.writeUInt16BE(0, 4);
    header.writeUInt32BE(seq >>> 0, 6);
    header.writeUInt32BE(cmd, 10);
    header.writeUInt32BE(12 + payload.length + 16, 14);
    const { enc, tag } = gcmEncrypt(opts.gcmKey, iv, payload, header.subarray(4));
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(SUFFIX_6699, 0);
    return Buffer.concat([header, iv, enc, tag, tail]);
  }
  const endLen = opts.hmacKey ? 36 : 8;
  const header = Buffer.alloc(16);
  header.writeUInt32BE(PREFIX_55AA, 0);
  header.writeUInt32BE(seq >>> 0, 4);
  header.writeUInt32BE(cmd, 8);
  header.writeUInt32BE(payload.length + endLen, 12);
  const body = Buffer.concat([header, payload]);
  let check;
  if (opts.hmacKey) {
    check = hmacSha256(opts.hmacKey, body);
  } else {
    check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(body), 0);
  }
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(SUFFIX_55AA, 0);
  return Buffer.concat([body, check, tail]);
}

/**
 * Pull complete frames out of a stream buffer.
 * Returns { frames: [{prefix, seq, cmd, raw}], rest }.
 */
function splitFrames(buf) {
  const frames = [];
  let off = 0;
  for (;;) {
    // find the next prefix
    let p = -1;
    for (let i = off; i + 4 <= buf.length; i++) {
      const v = buf.readUInt32BE(i);
      if (v === PREFIX_55AA || v === PREFIX_6699) { p = i; break; }
    }
    if (p < 0) {
      // keep the last 3 bytes in case a prefix is split across chunks
      return { frames, rest: buf.subarray(Math.max(off, buf.length - 3)) };
    }
    off = p;
    const prefix = buf.readUInt32BE(off);
    const headerLen = prefix === PREFIX_6699 ? 18 : 16;
    if (buf.length - off < headerLen) return { frames, rest: buf.subarray(off) };
    const len = buf.readUInt32BE(off + headerLen - 4);
    if (len > 0x100000) { off += 4; continue; } // garbage, resync
    const total = prefix === PREFIX_6699 ? headerLen + len + 4 : headerLen + len;
    if (buf.length - off < total) return { frames, rest: buf.subarray(off) };
    const raw = buf.subarray(off, off + total);
    const seq = prefix === PREFIX_6699 ? raw.readUInt32BE(6) : raw.readUInt32BE(4);
    const cmd = prefix === PREFIX_6699 ? raw.readUInt32BE(10) : raw.readUInt32BE(8);
    frames.push({ prefix, seq, cmd, raw: Buffer.from(raw) });
    off += total;
  }
}

/**
 * Open one frame received from a device.
 *   key: the key to check/decrypt with (local key or session key)
 *   hmac: true for 3.4 (HMAC trailer)
 * Returns { seq, cmd, retcode, payload, ok } where payload is the
 * still-encrypted body for 55AA (minus retcode), or plaintext for 6699.
 * `retcode` is set when `withRetcode` (frames sent by a device).
 */
function unpackFrame(frame, { key, hmac = false, withRetcode = true } = {}) {
  const raw = frame.raw;
  if (frame.prefix === PREFIX_6699) {
    const header = raw.subarray(0, 18);
    const iv = raw.subarray(18, 30);
    const tag = raw.subarray(raw.length - 20, raw.length - 4);
    const enc = raw.subarray(30, raw.length - 20);
    let plain;
    let ok = true;
    try {
      plain = gcmDecrypt(key, iv, enc, header.subarray(4), tag);
    } catch (_) {
      ok = false;
      plain = Buffer.alloc(0);
    }
    let retcode = null;
    // A 4-byte return code (0 or 1) comes first in frames sent by a device.
    if (withRetcode && plain.length >= 4 && (plain.readUInt32BE(0) & 0xffffff00) === 0) {
      retcode = plain.readUInt32BE(0);
      plain = plain.subarray(4);
    }
    return { seq: frame.seq, cmd: frame.cmd, retcode, payload: plain, ok };
  }
  const endLen = hmac ? 36 : 8;
  const body = raw.subarray(0, raw.length - endLen);
  const check = raw.subarray(raw.length - endLen, raw.length - 4);
  let ok;
  if (hmac) ok = key ? hmacSha256(key, body).equals(check) : false;
  else ok = crc32(body) === check.readUInt32BE(0);
  let payload = raw.subarray(16, raw.length - endLen);
  let retcode = null;
  if (withRetcode && payload.length >= 4 && (payload.readUInt32BE(0) & 0xffffff00) === 0) {
    retcode = payload.readUInt32BE(0);
    payload = payload.subarray(4);
  }
  return { seq: frame.seq, cmd: frame.cmd, retcode, payload: Buffer.from(payload), ok };
}

// ---------------------------------------------------------------- UDP

/** Decode a device's UDP broadcast into its JSON info, or null. */
function decodeBroadcast(msg) {
  let text = null;
  try {
    if (msg.length >= 4 && (msg.readUInt32BE(0) === PREFIX_55AA || msg.readUInt32BE(0) === PREFIX_6699)) {
      const { frames } = splitFrames(msg);
      if (!frames.length) return null;
      const f = frames[0];
      if (f.prefix === PREFIX_6699) {
        text = unpackFrame(f, { key: UDP_KEY, withRetcode: true }).payload.toString('utf8');
      } else {
        const p = unpackFrame(f, { withRetcode: true }).payload;
        if (p[0] === 0x7b) text = p.toString('utf8');
        else text = ecbDecrypt(UDP_KEY, p.subarray(0, p.length - (p.length % 16))).toString('utf8');
      }
    } else {
      text = ecbDecrypt(UDP_KEY, msg.subarray(0, msg.length - (msg.length % 16))).toString('utf8');
    }
  } catch (_) {
    return null;
  }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch (_) {
    return null;
  }
}

/** The packet that asks 3.5 devices to announce themselves (UDP port 7000). */
function discoveryRequest(localIp) {
  const body = Buffer.from(JSON.stringify({ from: 'app', ip: localIp }));
  return packFrame(0, CMD.REQ_DEVINFO, body, { gcmKey: UDP_KEY });
}

module.exports = {
  CMD, NO_HEADER, PREFIX_55AA, PREFIX_6699, UDP_KEY,
  versionHeader, ecbEncrypt, ecbDecrypt, gcmEncrypt, gcmDecrypt, hmacSha256, crc32,
  packFrame, splitFrames, unpackFrame, decodeBroadcast, discoveryRequest,
};
