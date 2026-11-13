'use strict';
// Downloads app icons, shrinks them to key size and picks an accent colour from them.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');

const SIZE = 64;

class AppIcons {
  constructor(cacheDir, log, onReady) {
    this.dir = cacheDir;
    this.log = log;
    this.onReady = onReady;
    this.mem = new Map(); // url -> { png: base64|null, color: 'rgb(..)'|null } | 'loading'
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (_) {}
  }

  get(url) {
    if (!url) return null;
    const hit = this.mem.get(url);
    if (hit && hit !== 'loading') return hit;
    if (!hit) this.load(url);
    return null;
  }

  async load(url) {
    this.mem.set(url, 'loading');
    const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
    const file = path.join(this.dir, key + '.json');
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.mem.set(url, cached);
      this.onReady();
      return;
    } catch (_) {}
    let result = { png: null, color: null };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        result = processPng(buf);
      } else if (/<svg/i.test(buf.slice(0, 2048).toString('utf8'))) {
        result = { png: null, color: colorFromSvg(buf.toString('utf8')) };
      }
    } catch (e) {
      this.log.warn(`Icon download failed (${url}): ${e.message}`);
      // retry later
      setTimeout(() => this.mem.delete(url), 5 * 60 * 1000);
      this.mem.set(url, result);
      this.onReady();
      return;
    }
    this.mem.set(url, result);
    try { fs.writeFileSync(file, JSON.stringify(result)); } catch (_) {}
    this.onReady();
  }
}

function processPng(buf) {
  const src = PNG.sync.read(buf);
  // Fit inside SIZE x SIZE, box-filter downscale, transparent padding.
  const scale = Math.min(SIZE / src.width, SIZE / src.height, 1);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new PNG({ width: SIZE, height: SIZE });
  out.data.fill(0);
  const ox = Math.floor((SIZE - w) / 2), oy = Math.floor((SIZE - h) / 2);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y / scale), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / scale));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / scale), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < Math.min(sy1, src.height); sy++) {
        for (let sx = sx0; sx < Math.min(sx1, src.width); sx++) {
          const i = (sy * src.width + sx) * 4;
          const al = src.data[i + 3];
          r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al; a += al; n++;
        }
      }
      const o = ((oy + y) * SIZE + (ox + x)) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a); out.data[o + 1] = Math.round(g / a); out.data[o + 2] = Math.round(b / a);
      }
      out.data[o + 3] = n ? Math.round(a / n) : 0;
    }
  }
  return { png: PNG.sync.write(out).toString('base64'), color: dominantColor(out.data) };
}

// Pick a vivid representative colour, weighted by saturation and opacity.
function dominantColor(data) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 160) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.25 || max < 50) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(key) || { r: 0, g: 0, b: 0, w: 0 };
    const wgt = sat * sat;
    e.r += r * wgt; e.g += g * wgt; e.b += b * wgt; e.w += wgt;
    buckets.set(key, e);
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
  if (!best || best.w < 2) return null;
  return tune(best.r / best.w, best.g / best.w, best.b / best.w);
}

function colorFromSvg(svg) {
  const hexes = [...svg.matchAll(/(?:fill|stop-color|stroke)\s*[:=]\s*["']?\s*#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => m[1]);
  let best = null, bestSat = 0.25;
  for (let h of hexes) {
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > bestSat && max > 60) { best = [r, g, b]; bestSat = sat; }
  }
  return best ? tune(...best) : null;
}

// Keep accents readable on a dark key: lightness 55-68%, decent saturation.
function tune(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(0.68, Math.max(0.55, l));
  s = Math.min(0.9, Math.max(0.5, s));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return `rgb(${Math.round(f(h + 1 / 3) * 255)},${Math.round(f(h) * 255)},${Math.round(f(h - 1 / 3) * 255)})`;
}

module.exports = { AppIcons, processPng, dominantColor, tune };
