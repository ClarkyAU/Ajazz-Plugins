'use strict';
// Tuya cloud (IoT platform) client, used to fetch the device list with each
// device's local key, and as a fallback for control when a device can't be
// reached on the home network.
//
// Request signing follows Tuya's documented "new signature" scheme (same as
// Tuya's own tuya-connector-python); checked in test/cloud.test.js.

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const REGIONS = {
  eu: { name: 'Central Europe', host: 'https://openapi.tuyaeu.com' },
  weu: { name: 'Western Europe', host: 'https://openapi-weaz.tuyaeu.com' },
  us: { name: 'Western America', host: 'https://openapi.tuyaus.com' },
  ueaz: { name: 'Eastern America', host: 'https://openapi-ueaz.tuyaus.com' },
  sg: { name: 'Singapore', host: 'https://openapi-sg.iotbing.com' },
  in: { name: 'India', host: 'https://openapi.tuyain.com' },
  cn: { name: 'China', host: 'https://openapi.tuyacn.com' },
};
// Order tried when the data centre is set to "Auto" (Australian accounts are
// served from Central Europe, so that goes first).
const AUTO_ORDER = ['eu', 'weu', 'us', 'ueaz', 'sg', 'in', 'cn'];

const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

class CloudError extends Error {
  constructor(message, code, kind) {
    super(message);
    this.code = code;
    this.kind = kind || 'api'; // api | auth | network | expired | permission | region
  }
}

/** Plain-language text for Tuya's error codes. */
function explain(code, msg) {
  const c = Number(code);
  if (c === 1004 || c === 1005 || c === 2017) return { kind: 'auth', text: 'Access ID or Access Secret is wrong.' };
  if (c === 1010 || c === 1011) return { kind: 'auth', text: 'Sign-in expired, trying again.' };
  if (c === 28841002 || c === 28841101 || /expired/i.test(msg || '')) {
    return { kind: 'expired', text: 'Your free Tuya cloud trial has run out. Extend it at iot.tuya.com (Cloud > My Services > IoT Core).' };
  }
  if (c === 1106 || c === 28841105) return { kind: 'permission', text: 'No permission. Check the Smart Life app is linked to the project (Devices > Link Tuya App Account).' };
  if (c === 1114 || /invalid/i.test(msg || '') && /client/i.test(msg || '')) return { kind: 'region', text: 'Not found in this data centre.' };
  return { kind: 'api', text: msg ? `Tuya cloud: ${msg}` : `Tuya cloud error ${code}` };
}

class TuyaCloud {
  constructor({ accessId, accessSecret, region = 'auto', log = () => {}, baseUrl = process.env.TUYA_CLOUD_BASE }) {
    this.accessId = String(accessId || '').trim();
    this.accessSecret = String(accessSecret || '').trim();
    this.region = region in REGIONS ? region : 'auto';
    this.activeRegion = this.region === 'auto' ? null : this.region;
    // Tests only: a local fake cloud. Real requests always go over https.
    this.baseUrl = baseUrl && /^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/.test(baseUrl) ? baseUrl : null;
    this.log = log;
    this.token = null;
    this.tokenExpires = 0;
  }

  get host() {
    if (this.baseUrl) return this.baseUrl;
    return REGIONS[this.activeRegion || 'eu'].host;
  }

  sign(method, pathWithQuery, body, t, withToken) {
    const stringToSign = [method, sha256hex(body || ''), '', pathWithQuery].join('\n');
    const msg = this.accessId + (withToken ? this.token : '') + t + stringToSign;
    return crypto.createHmac('sha256', this.accessSecret).update(msg, 'utf8').digest('hex').toUpperCase();
  }

  static buildPath(path, query) {
    if (!query) return path;
    const keys = Object.keys(query).filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== '').sort();
    if (!keys.length) return path;
    return path + '?' + keys.map((k) => `${k}=${query[k]}`).join('&');
  }

  rawRequest(method, path, query, bodyObj, withToken) {
    const full = TuyaCloud.buildPath(path, query);
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const t = String(Date.now());
    const headers = {
      client_id: this.accessId,
      sign: this.sign(method, full, body, t, withToken),
      t,
      sign_method: 'HMAC-SHA256',
      lang: 'en',
    };
    if (withToken) headers.access_token = this.token;
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const url = new URL(full, this.host);
    const lib = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers, timeout: 15000 }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          let json;
          try { json = JSON.parse(data); } catch (_) {
            return reject(new CloudError(`Unexpected reply from Tuya (HTTP ${res.statusCode})`, res.statusCode, 'network'));
          }
          resolve(json);
        });
      });
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', (e) => reject(new CloudError(`Can't reach the Tuya cloud (${e.code || e.message})`, 0, 'network')));
      if (body) req.write(body);
      req.end();
    });
  }

  async getToken() {
    const res = await this.rawRequest('GET', '/v1.0/token', { grant_type: 1 }, null, false);
    if (!res.success) {
      const e = explain(res.code, res.msg);
      throw new CloudError(e.text, res.code, e.kind);
    }
    this.token = res.result.access_token;
    this.tokenExpires = Date.now() + (Number(res.result.expire_time || res.result.expire || 3600) - 120) * 1000;
    this.uid = res.result.uid;
  }

  /** Sign in, trying each data centre in turn when set to Auto. */
  async connect() {
    if (!this.accessId || !this.accessSecret) throw new CloudError('Enter your Access ID and Access Secret.', 0, 'auth');
    if (this.region !== 'auto' || this.baseUrl) {
      await this.getToken();
      return this.activeRegion;
    }
    let lastErr = null;
    for (const r of this.activeRegion ? [this.activeRegion, ...AUTO_ORDER.filter((x) => x !== this.activeRegion)] : AUTO_ORDER) {
      this.activeRegion = r;
      try {
        await this.getToken();
        return r;
      } catch (e) {
        lastErr = e;
        if (e.kind === 'network') throw e;
        this.log(`cloud: ${REGIONS[r].name} said: ${e.message}`);
      }
    }
    throw lastErr || new CloudError('Could not sign in to the Tuya cloud.', 0, 'auth');
  }

  async request(method, path, query, body) {
    if (!this.token || Date.now() > this.tokenExpires) await this.connect();
    let res = await this.rawRequest(method, path, query, body, true);
    if (!res.success && (res.code === 1010 || res.code === 1011)) {
      await this.connect();
      res = await this.rawRequest(method, path, query, body, true);
    }
    if (!res.success) {
      const e = explain(res.code, res.msg);
      throw new CloudError(e.text, res.code, e.kind);
    }
    return res.result;
  }

  /** All devices of the linked app account(s), with local keys. */
  async listDevices() {
    const all = new Map();
    const uids = new Set();
    let rowKey = '';
    for (let page = 0; page < 20; page++) {
      const r = await this.request('GET', '/v1.0/iot-01/associated-users/devices', { size: 50, last_row_key: rowKey });
      for (const d of (r && r.devices) || []) {
        all.set(d.id, d);
        if (d.uid) uids.add(d.uid);
      }
      if (!r || !r.has_more || !r.last_row_key) break;
      rowKey = r.last_row_key;
    }
    // Some accounts only return local keys from the per-user list.
    if ([...all.values()].some((d) => !d.local_key)) {
      for (const uid of uids) {
        let key = '';
        for (let page = 0; page < 20; page++) {
          let r;
          try {
            r = await this.request('GET', '/v1.3/iot-03/devices', { page_size: 75, source_type: 'tuyaUser', source_id: uid, last_row_key: key });
          } catch (e) {
            this.log('cloud: per-user device list failed: ' + e.message);
            break;
          }
          for (const d of (r && r.list) || []) all.set(d.id, { ...(all.get(d.id) || {}), ...d });
          if (!r || !r.has_more || !r.last_row_key) break;
          key = r.last_row_key;
        }
      }
    }
    for (const d of all.values()) {
      if (d.local_key) continue;
      try {
        const info = await this.request('GET', `/v1.0/devices/${d.id}`);
        if (info && info.local_key) d.local_key = info.local_key;
      } catch (e) {
        this.log(`cloud: no details for ${d.id}: ${e.message}`);
      }
    }
    return [...all.values()];
  }

  /** Data point list: [{dp_id, code, type, values}] */
  async specifications(id) {
    const r = await this.request('GET', `/v1.1/devices/${id}/specifications`);
    const out = new Map();
    for (const item of [...((r && r.status) || []), ...((r && r.functions) || [])]) {
      if (item.dp_id === undefined || out.has(String(item.dp_id))) continue;
      let values = item.values;
      try { values = JSON.parse(item.values); } catch (_) {}
      out.set(String(item.dp_id), { code: item.code, type: item.type, values });
    }
    return Object.fromEntries(out);
  }

  async status(id) {
    return this.request('GET', `/v1.0/iot-03/devices/${id}/status`);
  }

  async command(id, commands) {
    return this.request('POST', `/v1.0/iot-03/devices/${id}/commands`, null, { commands });
  }
}

module.exports = { TuyaCloud, CloudError, REGIONS, AUTO_ORDER };
