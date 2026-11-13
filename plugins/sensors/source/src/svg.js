"use strict";
// SVG drawing helpers for 144x144 key images.
// Rules from the Ajazz renderer: no "#" or "%" anywhere, no url(#id), rgb() colours only,
// and spaces at the start/end of a text run are stripped (so we position runs ourselves).

const FONT = "Segoe UI, Inter, Arial, sans-serif";

const C = {
  bg: "rgb(11,12,15)",
  panel: "rgb(21,23,28)",
  track: "rgb(36,39,46)",
  grid: "rgb(30,33,39)",
  line: "rgb(54,58,67)",
  text: "rgb(238,240,244)",
  muted: "rgb(140,147,160)",
  dim: "rgb(84,90,101)",
  cpu: "rgb(96,165,250)",
  mem: "rgb(167,139,250)",
  disk: "rgb(232,121,249)",
  down: "rgb(56,189,248)",
  up: "rgb(251,146,60)",
  sys: "rgb(45,212,191)",
  sensor: "rgb(250,204,21)",
  nvidia: "rgb(118,185,0)",
  amd: "rgb(255,96,96)",
  intel: "rgb(64,156,255)",
  gpu: "rgb(45,212,191)",
  good: "rgb(74,222,128)",
  warn: "rgb(251,191,36)",
  bad: "rgb(248,81,73)",
  power: "rgb(250,204,21)",
  fan: "rgb(103,232,249)",
  volt: "rgb(196,181,253)",
};

function r(n) {
  return Math.round(n * 10) / 10;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/#/g, "＃")
    .replace(/%/g, "％")
    .trim();
}

// Approximate Segoe UI advance widths (em units).
function textWidth(str, size, bold) {
  let w = 0;
  for (const ch of String(str)) {
    if (/[ilI.,:;'|!]/.test(ch)) w += 0.28;
    else if (/[fjrt()\[\]]/.test(ch)) w += 0.36;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-Z]/.test(ch)) w += 0.64;
    else if (/[0-9]/.test(ch)) w += 0.6;
    else if (ch === " ") w += 0.27;
    else if (ch === "°") w += 0.4;
    else if (ch === "…") w += 0.8;
    else if (ch.charCodeAt(0) > 11904) w += 1;
    else w += 0.53;
  }
  return w * size * (bold ? 1.06 : 1);
}

function fit(str, size, maxWidth, bold) {
  str = String(str == null ? "" : str).trim();
  if (textWidth(str, size, bold) <= maxWidth) return str;
  const chars = Array.from(str);
  while (chars.length > 1 && textWidth(chars.join("") + "…", size, bold) > maxWidth) chars.pop();
  return chars.join("").trimEnd() + "…";
}

function fitSize(str, size, maxWidth, bold, min = 19) {
  let s = size;
  while (s > min && textWidth(str, s, bold) > maxWidth) s -= 1;
  return s;
}

function text(x, y, str, { size = 22, fill = C.text, weight = 600, anchor = "start", opacity } = {}) {
  const s = esc(str);
  if (!s) return "";
  const op = opacity != null ? ` fill-opacity="${opacity}"` : "";
  return `<text x="${r(x)}" y="${r(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${op} text-anchor="${anchor}">${s}</text>`;
}

// Percent sign drawn as shapes (a "%" character would blank the key).
function pctGlyph(x, y, size, color) {
  const s = size;
  const sw = Math.max(1.6, s * 0.085);
  const rad = s * 0.115;
  return `<g fill="none" stroke="${color}" stroke-width="${r(sw)}" stroke-linecap="round"><circle cx="${r(x + s * 0.16)}" cy="${r(y - s * 0.56)}" r="${r(rad)}"/><circle cx="${r(x + s * 0.48)}" cy="${r(y - s * 0.15)}" r="${r(rad)}"/><line x1="${r(x + s * 0.52)}" y1="${r(y - s * 0.71)}" x2="${r(x + s * 0.12)}" y2="${r(y)}"/></g>`;
}
const PCT_W = 0.66;

// A row of differently styled text runs, measured and placed one by one.
function rich(x, y, segs, { anchor = "start", size = 22, fill = C.text, weight = 600 } = {}) {
  const parts = segs
    .filter((p) => p && p.t !== "" && p.t != null)
    .map((p) => ({ t: String(p.t), size: p.size || size, fill: p.fill || fill, weight: p.weight || weight, gap: p.gap || 0 }));
  const width = (p) => (p.t === "%" ? p.size * PCT_W : textWidth(p.t, p.size, p.weight >= 600));
  const total = parts.reduce((a, p) => a + width(p) + p.gap, 0);
  let cx = anchor === "middle" ? x - total / 2 : anchor === "end" ? x - total : x;
  let out = "";
  for (const p of parts) {
    cx += p.gap;
    if (p.t === "%") out += pctGlyph(cx + p.size * 0.04, y, p.size, p.fill);
    else {
      const lead = p.t.length - p.t.trimStart().length;
      const body = p.t.trim();
      const lx = cx + textWidth(" ".repeat(lead), p.size);
      if (body) out += `<text x="${r(lx)}" y="${r(y)}" font-family="${FONT}" font-size="${p.size}" font-weight="${p.weight}" fill="${p.fill}">${esc(body)}</text>`;
    }
    cx += width(p);
  }
  return out;
}

function richWidth(segs, size = 22, weight = 600) {
  return segs.filter(Boolean).reduce((a, p) => {
    const s = p.size || size;
    const wgt = p.weight || weight;
    return a + (p.gap || 0) + (p.t === "%" ? s * PCT_W : textWidth(p.t, s, wgt >= 600));
  }, 0);
}

function rect(x, y, w, h, fill, { rx = 0, opacity, stroke, sw } = {}) {
  const op = opacity != null ? ` fill-opacity="${opacity}"` : "";
  const st = stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : "";
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(0, w))}" height="${r(Math.max(0, h))}" rx="${rx}" ry="${rx}" fill="${fill}"${op}${st}/>`;
}

function circle(cx, cy, rad, fill, { opacity, stroke, sw } = {}) {
  const op = opacity != null ? ` fill-opacity="${opacity}"` : "";
  const st = stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : "";
  return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="${fill}"${op}${st}/>`;
}

function line(x1, y1, x2, y2, stroke, sw = 2, opacity) {
  const op = opacity != null ? ` stroke-opacity="${opacity}"` : "";
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${op}/>`;
}

// Segmented meter: the "vitals" bar used under big numbers.
function meter(x, y, w, h, frac, color, { segs = 10, gap = 3, track = C.track } = {}) {
  frac = Math.max(0, Math.min(1, Number(frac) || 0));
  const sw = (w - gap * (segs - 1)) / segs;
  const lit = frac * segs;
  let out = "";
  for (let i = 0; i < segs; i++) {
    const sx = x + i * (sw + gap);
    out += rect(sx, y, sw, h, track, { rx: 2 });
    const part = Math.max(0, Math.min(1, lit - i));
    if (part > 0.04) out += rect(sx, y, sw * part, h, color, { rx: 2 });
  }
  return out;
}

function bar(x, y, w, h, frac, color, { track = C.track } = {}) {
  frac = Math.max(0, Math.min(1, Number(frac) || 0));
  const rx = Math.min(h / 2, 4);
  let out = rect(x, y, w, h, track, { rx });
  if (frac > 0.005) out += rect(x, y, Math.max(h, w * frac), h, color, { rx });
  return out;
}

// Area + line chart. values may contain null/NaN gaps (drawn as breaks).
function spark(x, y, w, h, values, color, { max, min = 0, fillOpacity = 0.18, sw = 3 } = {}) {
  const n = values ? values.length : 0;
  if (n < 2) return "";
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return "";
  const top = max != null ? max : Math.max(...finite, 1e-9);
  const span = Math.max(1e-9, top - min);
  let out = "";
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const pts = run.map(([px, py]) => `${r(px)},${r(py)}`).join(" ");
      const area = `${r(run[0][0])},${r(y + h)} ${pts} ${r(run[run.length - 1][0])},${r(y + h)}`;
      if (fillOpacity > 0) out += `<polygon points="${area}" fill="${color}" fill-opacity="${fillOpacity}"/>`;
      out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
    } else if (run.length === 1) {
      out += circle(run[0][0], run[0][1], sw / 2 + 0.5, color);
    }
    run = [];
  };
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return flush();
    const px = x + (w * i) / (n - 1);
    const fv = Math.max(0, Math.min(1, (v - min) / span));
    run.push([px, y + h - fv * h]);
  });
  flush();
  return out;
}

// Line icons on a 24 grid (stroke only), one consistent style.
const ICONS = {
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  gpu: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="15" cy="12" r="3.2"/><path d="M6 10h4M6 14h4M5 18v3M9 18v3"/>',
  ram: '<rect x="2" y="6" width="20" height="11" rx="2"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3M5 17v3M19 17v3"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="12" cy="11" r="4"/><path d="M12 11h.01M7 17h3"/>',
  down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  net: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.7 4 6 4 9.5s-1.4 6.8-4 9.5c-2.6-2.7-4-6-4-9.5s1.4-6.8 4-9.5z"/>',
  link: '<path d="M7 3h10v7a5 5 0 0 1-10 0V3zM12 15v6M9 3v3M15 3v3"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10.5v3"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c-1-4 0-7.5 3-7.5 2.5 0 3 3-1 6.5M14 12c4-1 7.5 0 7.5 3 0 2.5-3 3-6.5-1M12 14c1 4 0 7.5-3 7.5-2.5 0-3-3 1-6.5M10 12c-4 1-7.5 0-7.5-3 0-2.5 3-3 6.5 1"/>',
  gauge: '<path d="M3.5 17a9 9 0 1 1 17 0"/><path d="M12 13l4.5-5"/><circle cx="12" cy="13" r="1.4"/>',
  thermo: '<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/><path d="M11.5 10v7"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-6.8 0-3.7-2.6-6-4.2-8.7-.5 2.2-1.6 3.4-2.8 4C12.3 7.6 10.9 4.4 8 2c.3 3.5-3 6.4-3 11.2C5 19.2 8 22 12 22z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  bars: '<path d="M5 20V10M10 20V4M15 20v-8M20 20V7"/>',
  pulse: '<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  sensor: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17"/>',
  volt: '<path d="M4 4l8 16 8-16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17.2h.01"/>',
  off: '<circle cx="12" cy="12" r="9.5"/><path d="M5.5 5.5l13 13"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  stack: '<rect x="3" y="3" width="18" height="6" rx="1.5"/><rect x="3" y="15" width="18" height="6" rx="1.5"/><path d="M7 6h.01M7 18h.01"/>',
};

function icon(name, x, y, size, color, sw = 2) {
  const body = ICONS[name];
  if (!body) return "";
  const s = size / 24;
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${Math.round(s * 1000) / 1000})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}

const LABEL = 22;

// Key header: icon + upper-case label on the left, optional extra on the right.
// The icon is dropped when the label would not fit next to it.
function header(x, y, label, iconName, color, right, rightColor) {
  let out = "";
  let rw = 0;
  if (right) {
    const segs = typeof right === "string" ? [{ t: right }] : right;
    rw = richWidth(segs, LABEL, 700) + 6;
    out += rich(x + 134, y + 31, segs, { anchor: "end", size: LABEL, fill: rightColor || C.muted, weight: 700 });
  }
  const lab = String(label || "").toUpperCase();
  let lx = x + 10;
  if (iconName && textWidth(lab, LABEL, true) <= x + 134 - rw - (x + 40)) {
    out += icon(iconName, x + 9, y + 12, 23, color, 2.4);
    lx = x + 39;
  }
  out += text(lx, y + 31, fit(lab, LABEL, x + 134 - rw - lx, true), { size: LABEL, fill: C.muted, weight: 700 });
  return out;
}

function wrapSvg(content, w = 144, h = 144, ox = 0, oy = 0) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    rect(0, 0, w, h, C.bg) +
    (ox || oy ? `<g transform="translate(${-ox} ${-oy})">${content}</g>` : content) +
    "</svg>"
  );
}

function toDataUrl(svg) {
  return "data:image/svg+xml;charset=utf8," + svg.replace(/#/g, "").replace(/%/g, "");
}

// ---------------------------------------------------------------- colours from content
function mix(a, b, t) {
  const pa = a.match(/\d+/g).map(Number);
  const pb = b.match(/\d+/g).map(Number);
  t = Math.max(0, Math.min(1, t));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

// Green when cool, amber when warm, red when hot.
function tempColor(c, { warm = 70, hot = 88 } = {}) {
  if (c == null || !Number.isFinite(c)) return C.dim;
  const cool = warm - 25;
  if (c <= cool) return C.good;
  if (c <= warm) return mix(C.good, C.warn, (c - cool) / (warm - cool));
  return mix(C.warn, C.bad, (c - warm) / (hot - warm));
}

function usageColor(frac, base) {
  if (frac >= 0.92) return C.bad;
  if (frac >= 0.8) return C.warn;
  return base;
}

// ---------------------------------------------------------------- number formatting
function fmtBytes(n, digits) {
  n = Number(n) || 0;
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (Math.abs(n) >= 1000 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const d = digits != null ? digits : n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2;
  return { value: trimZeros(n.toFixed(d)), unit: units[i] };
}

function fmtRate(bytesPerSec, bits) {
  let n = Number(bytesPerSec) || 0;
  if (bits) {
    n *= 8;
    const units = ["b/s", "Kb/s", "Mb/s", "Gb/s"];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) {
      n /= 1000;
      i++;
    }
    return { value: n.toFixed(n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2), unit: units[i] };
  }
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return { value: n.toFixed(n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2), unit: units[i] };
}

function trimZeros(s) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

function fmtTemp(c, unit) {
  if (c == null || !Number.isFinite(c)) return null;
  if (unit === "F") return { value: String(Math.round((c * 9) / 5 + 32)), unit: "°F", short: Math.round((c * 9) / 5 + 32) + "°" };
  return { value: String(Math.round(c)), unit: "°C", short: Math.round(c) + "°" };
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return { value: String(d), unit: "d", extra: `${h}h ${m}m` };
  if (h > 0) return { value: String(h), unit: "h", extra: `${m} min` };
  return { value: String(m), unit: "min", extra: "" };
}

function fmtMhz(mhz) {
  if (mhz == null || !Number.isFinite(mhz)) return null;
  if (mhz >= 1000) return { value: (mhz / 1000).toFixed(2), unit: "GHz" };
  return { value: String(Math.round(mhz)), unit: "MHz" };
}

module.exports = {
  C,
  FONT,
  LABEL,
  r,
  esc,
  text,
  rich,
  richWidth,
  pctGlyph,
  textWidth,
  fit,
  fitSize,
  rect,
  circle,
  line,
  meter,
  bar,
  spark,
  icon,
  ICONS,
  header,
  wrapSvg,
  toDataUrl,
  mix,
  tempColor,
  usageColor,
  fmtBytes,
  fmtRate,
  fmtTemp,
  fmtDuration,
  fmtMhz,
  trimZeros,
};
