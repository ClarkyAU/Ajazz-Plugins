'use strict';
// Runs media.ps1 (built-in Windows PowerShell) and keeps the current track:
// title, artist, album, player, play state, position/length and album art.

const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const EMPTY = { status: 'none', title: '', artist: '', album: '', app: '', duration: 0, position: 0, updated: 0 };

class Media extends EventEmitter {
  constructor({ dir, log }) {
    super();
    this.dir = dir;
    this.log = log;
    this.proc = null;
    this.buffer = '';
    this.restartDelay = 2000;
    this.stopping = false;
    this.state = { ...EMPTY };
    this.receivedAt = Date.now();
    this.art = null;      // { href, width, height }
    this.accent = null;   // [r,g,b] from the art, or null
    this.artVersion = 0;
  }

  start() {
    let cmd = 'powershell.exe';
    let args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.dir, 'media.ps1')];
    if (process.env.NOWPLAYING_FAKE_HELPER) { // tests: a pretend media source
      cmd = process.execPath;
      args = [process.env.NOWPLAYING_FAKE_HELPER];
    }
    const startedAt = Date.now();
    const proc = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => this.log('helper stderr: ' + chunk.trim().slice(0, 400)));
    proc.stdin.on('error', () => {});
    proc.on('error', (e) => this.log('media helper failed to start: ' + e.message));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      if (this.stopping) return;
      this.restartDelay = Date.now() - startedAt > 60000 ? 2000 : Math.min(this.restartDelay * 2, 30000);
      this.log(`media helper stopped (code ${code}), restarting in ${this.restartDelay / 1000}s`);
      setTimeout(() => this.start(), this.restartDelay);
    });
    this.log('media helper started');
  }

  onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const lineText = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!lineText) continue;
      let msg;
      try { msg = JSON.parse(lineText); } catch (_) { this.log('helper sent: ' + lineText.slice(0, 200)); continue; }
      try { this.onMessage(msg); } catch (e) { this.log('media message error: ' + (e.stack || e)); }
    }
  }

  onMessage(msg) {
    if (msg.type === 'state') {
      const prev = this.state;
      const next = {
        status: msg.status || 'none',
        title: msg.title || '', artist: msg.artist || '', album: msg.album || '', app: msg.app || '',
        duration: Number(msg.duration) || 0, position: Number(msg.position) || 0, updated: Number(msg.updated) || 0
      };
      const trackChanged = next.title !== prev.title || next.artist !== prev.artist || next.app !== prev.app;
      this.state = next;
      this.receivedAt = Date.now();
      if (next.status === 'none' && prev.status !== 'none') this.setArt(null);
      this.emit('state', { trackChanged });
    } else if (msg.type === 'art') {
      let buf = null;
      if (msg.data) { try { buf = Buffer.from(msg.data, 'base64'); } catch (_) { buf = null; } }
      this.setArt(buf);
    } else if (msg.type === 'error') {
      this.log('helper: ' + msg.message);
    }
  }

  setArt(buf) {
    this.art = null;
    this.accent = null;
    if (buf && buf.length) {
      try {
        const img = decodeImage(buf);
        if (img) {
          this.accent = accentFromImage(img);
          this.art = artHref(buf, img);
        } else {
          this.log('album art is in a format the plugin cannot read');
        }
      } catch (e) {
        this.log('could not read the album art: ' + e.message);
      }
    }
    this.artVersion++;
    this.emit('art');
  }

  // Position now, counting on from the last report while playing.
  timeline() {
    const s = this.state;
    if (!(s.duration > 0)) return { known: false, position: 0, duration: 0, status: s.status };
    let pos = s.position;
    if (s.status === 'playing') {
      const since = s.updated > 0 ? Date.now() - s.updated : Date.now() - this.receivedAt;
      if (since > 0 && since < 6 * 3600 * 1000) pos += since / 1000;
    }
    return { known: true, position: Math.min(Math.max(pos, 0), s.duration), duration: s.duration, status: s.status };
  }

  command(cmd) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(cmd + '\n');
  }

  stop() {
    this.stopping = true;
    if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch (_) { /* ignore */ } }
  }
}

// ---------------------------------------------------------------------------
// Album art helpers
// ---------------------------------------------------------------------------
function decodeImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: img.width, height: img.height, data: img.data, mime: 'image/jpeg' };
  }
  if (buf.length > 8 && buf.toString('latin1', 1, 4) === 'PNG') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data, mime: 'image/png' };
  }
  return null;
}

// The art as a data URL for drawing. Very large covers are shrunk first so
// every key draws quickly.
function artHref(buf, img) {
  const MAX = 640;
  if (img.width <= MAX && img.height <= MAX) {
    return { href: `data:${img.mime};base64,${buf.toString('base64')}`, width: img.width, height: img.height };
  }
  const scale = MAX / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const out = new PNG({ width: w, height: h });
  const step = 1 / scale;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      const sx0 = Math.floor(x * step), sy0 = Math.floor(y * step);
      const sx1 = Math.min(img.width, Math.floor((x + 1) * step)), sy1 = Math.min(img.height, Math.floor((y + 1) * step));
      for (let sy = sy0; sy < Math.max(sy1, sy0 + 1); sy++) {
        for (let sx = sx0; sx < Math.max(sx1, sx0 + 1); sx++) {
          const i = (sy * img.width + sx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  const png = PNG.sync.write(out, { colorType: 2, inputHasAlpha: true });
  return { href: `data:image/png;base64,${png.toString('base64')}`, width: w, height: h };
}

// A vivid colour from the art (its most colourful hue, brightened for dark keys).
// Returns null for black-and-white art.
function accentFromImage(img) {
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 48));
  let total = 0;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i] / 255, g = img.data[i + 1] / 255, b = img.data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const weight = sat * sat * max;
      if (weight < 0.02) continue;
      let h;
      if (max === min) h = 0;
      else if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      const bin = bins[Math.floor((h / 6) * 24) % 24];
      bin.w += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
      total += weight;
    }
  }
  if (total < 1) return null;
  let best = -1, bestW = 0;
  for (let i = 0; i < 24; i++) {
    const w = bins[i].w + 0.5 * (bins[(i + 23) % 24].w + bins[(i + 1) % 24].w);
    if (w > bestW) { bestW = w; best = i; }
  }
  const bin = bins[best];
  let c = [bin.r / bin.w, bin.g / bin.w, bin.b / bin.w];
  const max = Math.max(...c), min = Math.min(...c);
  const sat = max === 0 ? 0 : (max - min) / max;
  const target = Math.min(0.85, Math.max(0.45, sat));
  c = c.map((v) => (max === min ? 0.9 : 0.9 * (1 - target * (max - v) / (max - min))));
  return c.map((v) => Math.round(v * 255));
}

function prettyApp(app) {
  if (!app) return '';
  const a = String(app);
  const known = [
    [/spotify/i, 'Spotify'], [/applemusic|apple music|itunes/i, 'Apple Music'], [/zunemusic|mediaplayer/i, 'Media Player'],
    [/chrome/i, 'Chrome'], [/msedge|edge/i, 'Edge'], [/firefox/i, 'Firefox'], [/opera/i, 'Opera'], [/brave/i, 'Brave'],
    [/vlc/i, 'VLC'], [/foobar/i, 'foobar2000'], [/musicbee/i, 'MusicBee'], [/tidal/i, 'TIDAL'], [/deezer/i, 'Deezer'],
    [/amazon/i, 'Amazon Music'], [/youtube/i, 'YouTube Music'], [/plex/i, 'Plex'], [/winamp/i, 'Winamp'], [/aimp/i, 'AIMP']
  ];
  for (const [re, name] of known) if (re.test(a)) return name;
  let name = a.split('!').pop().replace(/\.exe$/i, '');
  if (name.includes('_')) name = name.split('_')[0];
  if (name.includes('.')) name = name.split('.').pop();
  return name;
}

module.exports = { Media, decodeImage, accentFromImage, prettyApp, EMPTY };
