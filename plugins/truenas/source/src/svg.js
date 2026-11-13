'use strict';
// Drawing helpers for key images.
// Rules for the Ajazz renderer: no "#" anywhere (colours as rgb()), no url(#id)
// gradients/filters, and no spaces at the start/end of a text run.

const FONT = "Segoe UI, Inter, Arial, sans-serif";

const C = {
  bg: 'rgb(14,16,20)',
  panel: 'rgb(24,27,33)',
  track: 'rgb(38,42,50)',
  line: 'rgb(48,53,62)',
  text: 'rgb(236,239,244)',
  muted: 'rgb(142,150,163)',
  dim: 'rgb(86,92,103)',
  brand: 'rgb(0,149,213)',
  cpu: 'rgb(92,168,255)',
  ram: 'rgb(172,132,255)',
  arc: 'rgb(56,198,206)',
  down: 'rgb(72,196,255)',
  up: 'rgb(255,152,82)',
  good: 'rgb(64,204,138)',
  warn: 'rgb(255,186,64)',
  bad: 'rgb(255,86,86)',
  info: 'rgb(92,168,255)',
};

// Safe text for the SVG: XML-escape and remove characters the host chokes on.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/#/g, '＃') // full-width number sign: "#" would cut the data URL
    .replace(/%/g, '％') // "%" breaks the data URL too (draw it with pctGlyph instead)
    .trim();
}

// A percent sign drawn as shapes (a real "%" character breaks the image).
// x = left edge, y = text baseline, size = font size it should match.
function pctGlyph(x, y, size, color) {
  const s = size;
  const sw = Math.max(1.5, s * 0.085);
  const rad = s * 0.115;
  return `<g fill="none" stroke="${color}" stroke-width="${r(sw)}" stroke-linecap="round">` +
    `<circle cx="${r(x + s * 0.16)}" cy="${r(y - s * 0.56)}" r="${r(rad)}"/>` +
    `<circle cx="${r(x + s * 0.48)}" cy="${r(y - s * 0.15)}" r="${r(rad)}"/>` +
    `<line x1="${r(x + s * 0.52)}" y1="${r(y - s * 0.71)}" x2="${r(x + s * 0.12)}" y2="${r(y)}"/></g>`;
}
const PCT_W = 0.66;

// A line made of several styled pieces, e.g. [{t:'RAM '}, {t:'64', weight:700}, {t:'%'}].
// A piece that is exactly '%' is drawn with pctGlyph.
function rich(x, y, segs, { anchor = 'start', size = 20, fill = C.text, weight = 600 } = {}) {
  const parts = segs.filter((p) => p && p.t !== '' && p.t != null).map((p) => ({
    t: String(p.t), size: p.size || size, fill: p.fill || fill, weight: p.weight || weight, gap: p.gap || 0,
  }));
  const width = (p) => (p.t === '%' ? p.size * PCT_W : textWidth(p.t, p.size, p.weight >= 600));
  const total = parts.reduce((a, p) => a + width(p) + p.gap, 0);
  let cx = anchor === 'middle' ? x - total / 2 : anchor === 'end' ? x - total : x;
  let out = '';
  for (const p of parts) {
    cx += p.gap;
    if (p.t === '%') out += pctGlyph(cx + p.size * 0.04, y, p.size, p.fill);
    else {
      // keep edge spaces from being stripped by the renderer: move them into the position
      const lead = p.t.length - p.t.trimStart().length;
      const body = p.t.trim();
      const lx = cx + textWidth(' '.repeat(lead), p.size);
      if (body) out += `<text x="${r(lx)}" y="${r(y)}" font-family="${FONT}" font-size="${p.size}" font-weight="${p.weight}" fill="${p.fill}">${esc(body)}</text>`;
    }
    cx += width(p);
  }
  return out;
}
function richWidth(segs, size = 20, weight = 600) {
  return segs.reduce((a, p) => {
    const s = p.size || size, wgt = p.weight || weight;
    return a + (p.gap || 0) + (p.t === '%' ? s * PCT_W : textWidth(p.t, s, wgt >= 600));
  }, 0);
}

// Rough text width for Segoe UI (good enough for fitting).
function textWidth(str, size, bold) {
  let w = 0;
  for (const ch of String(str)) {
    if (/[ilI.,:;'|!]/.test(ch)) w += 0.28;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-Z]/.test(ch)) w += 0.64;
    else if (/[0-9]/.test(ch)) w += 0.6;
    else if (ch === ' ') w += 0.27;
    else if (ch.charCodeAt(0) > 0x2e80) w += 1.0;
    else w += 0.53;
  }
  return w * size * (bold ? 1.06 : 1);
}

// Shorten text with an ellipsis so it fits maxWidth.
function fit(str, size, maxWidth, bold) {
  str = String(str == null ? '' : str).trim();
  if (textWidth(str, size, bold) <= maxWidth) return str;
  const chars = Array.from(str);
  while (chars.length > 1 && textWidth(chars.join('') + '…', size, bold) > maxWidth) chars.pop();
  return chars.join('').trimEnd() + '…';
}

// Largest font size (<= size) at which str fits maxWidth (down to min).
function fitSize(str, size, maxWidth, bold, min = 10) {
  let s = size;
  while (s > min && textWidth(str, s, bold) > maxWidth) s -= 1;
  return s;
}

function text(x, y, str, { size = 16, fill = C.text, weight = 400, anchor = 'start', opacity } = {}) {
  const s = esc(str);
  if (!s) return '';
  const op = opacity != null ? ` fill-opacity="${opacity}"` : '';
  return `<text x="${r(x)}" y="${r(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${op} text-anchor="${anchor}">${s}</text>`;
}

// Value with a smaller unit after it, e.g. "45" + "%". Drawn as two text runs.
function valueUnit(x, y, value, unit, { size = 34, unitSize, fill = C.text, unitFill = C.muted, anchor = 'middle', weight = 700 } = {}) {
  unitSize = unitSize || Math.round(size * 0.5);
  const u = String(unit || '');
  return rich(x, y, [
    { t: String(value), size, fill, weight },
    u ? { t: u, size: unitSize, fill: unitFill, weight: 600, gap: Math.max(2, size * 0.05) } : null,
  ], { anchor });
}

function r(n) { return Math.round(n * 10) / 10; }

function rect(x, y, w, h, fill, { rx = 0, opacity, stroke, sw } = {}) {
  const op = opacity != null ? ` fill-opacity="${opacity}"` : '';
  const st = stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : '';
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(0, w))}" height="${r(Math.max(0, h))}" rx="${rx}" ry="${rx}" fill="${fill}"${op}${st}/>`;
}

function circle(cx, cy, rad, fill, { opacity, stroke, sw } = {}) {
  const op = opacity != null ? ` fill-opacity="${opacity}"` : '';
  const st = stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : '';
  return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="${fill}"${op}${st}/>`;
}

function line(x1, y1, x2, y2, stroke, sw = 2, opacity) {
  const op = opacity != null ? ` stroke-opacity="${opacity}"` : '';
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${op}/>`;
}

// Arc path from angle a0 to a1 (degrees, 0 = top, clockwise).
function arcPath(cx, cy, rad, a0, a1) {
  const p = (a) => {
    const t = (a - 90) * Math.PI / 180;
    return [cx + rad * Math.cos(t), cy + rad * Math.sin(t)];
  };
  if (a1 - a0 >= 359.9) a1 = a0 + 359.9;
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${r(x0)} ${r(y0)} A${r(rad)} ${r(rad)} 0 ${large} 1 ${r(x1)} ${r(y1)}`;
}

// Gauge ring: 270° sweep starting bottom-left.
function ring(cx, cy, rad, frac, color, { sw = 10, track = C.track } = {}) {
  frac = Math.max(0, Math.min(1, Number(frac) || 0));
  const start = -135, sweep = 270;
  let out = `<path d="${arcPath(cx, cy, rad, start, start + sweep)}" fill="none" stroke="${track}" stroke-width="${sw}" stroke-linecap="round"/>`;
  if (frac > 0.005) {
    out += `<path d="${arcPath(cx, cy, rad, start, start + sweep * frac)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  return out;
}

// Horizontal bar.
function bar(x, y, w, h, frac, color, { track = C.track } = {}) {
  frac = Math.max(0, Math.min(1, Number(frac) || 0));
  const rx = Math.min(h / 2, 6);
  let out = rect(x, y, w, h, track, { rx });
  if (frac > 0.003) out += rect(x, y, Math.max(h, w * frac), h, color, { rx });
  return out;
}

// Sparkline with soft fill. values: array of numbers; max: scale top.
function spark(x, y, w, h, values, color, { max, fillOpacity = 0.18, sw = 3, min = 0 } = {}) {
  if (!values || values.length < 2) return '';
  const top = max != null ? max : Math.max(...values, 1e-9);
  const span = Math.max(1e-9, top - min);
  const n = values.length;
  const pts = values.map((v, i) => {
    const px = x + (w * i) / (n - 1);
    const fv = Math.max(0, Math.min(1, ((Number(v) || 0) - min) / span));
    const py = y + h - fv * h;
    return `${r(px)},${r(py)}`;
  });
  const area = `${r(x)},${r(y + h)} ${pts.join(' ')} ${r(x + w)},${r(y + h)}`;
  return `<polygon points="${area}" fill="${color}" fill-opacity="${fillOpacity}"/>` +
    `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

// Line icons drawn on a 24-unit grid (consistent 2-unit stroke).
const ICONS = {
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  ram: '<rect x="2" y="6" width="20" height="11" rx="2"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3M5 17v3M19 17v3"/>',
  temp: '<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/><path d="M11.5 10v7"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>',
  server: '<rect x="2.5" y="3" width="19" height="7.5" rx="2"/><rect x="2.5" y="13.5" width="19" height="7.5" rx="2"/><path d="M6.5 6.8h.01M6.5 17.2h.01"/>',
  db: '<ellipse cx="12" cy="5" rx="8.5" ry="3"/><path d="M20.5 12c0 1.7-3.8 3-8.5 3s-8.5-1.3-8.5-3"/><path d="M3.5 5v14c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5"/>',
  down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  net: '<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>',
  bell: '<path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  check: '<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17.2h.01"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2v10"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
};

function icon(name, x, y, size, color, sw = 2) {
  const body = ICONS[name];
  if (!body) return '';
  const s = size / 24;
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s * 1000) / 1000})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}

// Small label row at the top of a cell: icon + caps label (+ optional right text).
// Label row at the top of a key: icon + caps label (+ optional right-hand text).
// right may be a string or rich() pieces.
const LABEL = 22;
function header(x, y, label, iconName, color, right, rightColor) {
  let out = '';
  let lx = x + 12;
  if (iconName) { out += icon(iconName, x + 10, y + 11, 24, color, 2.4); lx = x + 40; }
  let rw = 0;
  if (right) {
    const segs = typeof right === 'string' ? [{ t: right }] : right;
    rw = richWidth(segs, LABEL, 700) + 6;
    out += rich(x + 136, y + 33, segs, { anchor: 'end', size: LABEL, fill: rightColor || C.muted, weight: 700 });
  }
  out += text(lx, y + 33, fit(String(label).toUpperCase(), LABEL, x + 136 - rw - lx, true), { size: LABEL, fill: C.muted, weight: 700 });
  return out;
}

function wrapSvg(content, w = 144, h = 144, ox = 0, oy = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    rect(0, 0, w, h, C.bg) +
    (ox || oy ? `<g transform="translate(${-ox} ${-oy})">${content}</g>` : content) +
    '</svg>';
}

function toDataUrl(svg) {
  // Raw (not encoded) SVG, the format the Stream Dock software expects.
  // A "#" here would end the URL early, so make absolutely sure there is none.
  return 'data:image/svg+xml;charset=utf8,' + svg.replace(/#/g, '');
}

// ---- formatting ----
function fmtBytes(n, digits) {
  n = Number(n) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1024; i++; }
  const d = digits != null ? digits : (n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2);
  return { value: n.toFixed(d), unit: units[i] };
}

function fmtRate(bytesPerSec, bits) {
  let n = Number(bytesPerSec) || 0;
  if (bits) {
    n *= 8;
    const units = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s'];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return { value: n.toFixed(n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2), unit: units[i] };
  }
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1024; i++; }
  return { value: n.toFixed(n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2), unit: units[i] };
}

function fmtUptime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return { value: String(d), unit: d === 1 ? 'day' : 'days', extra: `${h}h ${m}m` };
  if (h > 0) return { value: String(h), unit: 'h', extra: `${m}m` };
  return { value: String(m), unit: 'min', extra: '' };
}

function fmtTemp(c, unit) {
  if (c == null || isNaN(c)) return null;
  if (unit === 'F') return { value: String(Math.round(c * 9 / 5 + 32)), unit: '°F' };
  return { value: String(Math.round(c)), unit: '°C' };
}

function tempColor(c) {
  if (c == null) return C.dim;
  if (c >= 80) return C.bad;
  if (c >= 68) return C.warn;
  return C.good;
}

function usageColor(frac, base) {
  if (frac >= 0.9) return C.bad;
  if (frac >= 0.8) return C.warn;
  return base;
}

module.exports = {
  C, FONT, LABEL, esc, text, valueUnit, rich, richWidth, pctGlyph, textWidth, fit, fitSize, rect, circle, line, ring, bar, spark,
  icon, header, wrapSvg, toDataUrl, arcPath,
  fmtBytes, fmtRate, fmtUptime, fmtTemp, tempColor, usageColor,
};
