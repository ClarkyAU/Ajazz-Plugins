'use strict';
// Key designs. Each function returns the SVG for ONE key (144 x 144).
// Graphics that span keys (graph, brightness slider) are drawn once on a
// wide canvas and each key shows its own window of it, with 28 px per gap
// treated as hidden under the bezel. Text never crosses from one key to
// the next: every piece of text is measured and kept inside its key.
//
// Text sizes: big values ~50 px, labels 22 px, nothing below 19 px.

const { textWidth, esc, FONT } = require('./raster');

const S = 144;
const GAP = 28;
const MIN_TEXT = 19;
const BG = [14, 14, 18];
const TEXT = [238, 238, 242];
const MUTED = [150, 150, 162];
const DIM = [96, 96, 108];
const RED = [255, 104, 104];
const GREEN = [95, 211, 141];
const AMBER = [255, 180, 72];

const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const f1 = (n) => Number(n).toFixed(1);

let gradId = 0;

// ---------------------------------------------------------------- basics

function svgDoc(body, x0 = 0, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="${f1(x0)} 0 ${S} ${S}">`
    + (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>';
}

function text(x, y, str, size, color, { weight = 600, anchor = 'middle' } = {}) {
  return `<text x="${f1(x)}" y="${f1(y)}" font-family="${FONT}" font-size="${Math.max(MIN_TEXT, size)}" font-weight="${weight}" text-anchor="${anchor}" fill="${rgb(color)}">${esc(str)}</text>`;
}

/** Fit text into maxW: one line if possible, else two lines, else shortened. */
function fitText(str, maxW, sizes = [22, 21, 20, 19], weight = 600, allowTwo = true) {
  str = String(str || '').trim();
  sizes = sizes.filter((s) => s >= MIN_TEXT);
  for (const size of sizes) if (textWidth(str, size, weight) <= maxW) return { lines: [str], size };
  const words = str.split(/\s+/);
  if (allowTwo && words.length > 1) {
    for (const size of sizes) {
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' ');
        const b = words.slice(i).join(' ');
        const w = Math.max(textWidth(a, size, weight), textWidth(b, size, weight));
        if (w <= maxW && (!best || w < best.w)) best = { lines: [a, b], w };
      }
      if (best) return { lines: best.lines, size };
    }
  }
  const size = sizes[sizes.length - 1];
  let cut = str;
  while (cut.length > 1 && textWidth(cut + '…', size, weight) > maxW) cut = cut.slice(0, -1);
  return { lines: [cut.trimEnd() + '…'], size };
}

/**
 * Spread words over n keys so no word sits across a gap.
 * Returns { size, keys: [[line, line?], ...] } (one entry per key).
 */
function spreadWords(str, n, sizes = [44, 40, 36, 32, 28, 26, 24, 22], maxW = 124, weight = 600) {
  const words = String(str || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: sizes[0], keys: Array.from({ length: n }, () => []) };
  for (const perKey of [1, 2]) {
    for (const size of sizes) {
      if (perKey === 2 && size > 30) continue;
      const lines = [];
      let cur = '';
      let fail = false;
      for (const w of words) {
        if (textWidth(w, size, weight) > maxW) { fail = true; break; }
        const tryLine = cur ? `${cur} ${w}` : w;
        if (textWidth(tryLine, size, weight) <= maxW) cur = tryLine;
        else { lines.push(cur); cur = w; }
      }
      if (fail) continue;
      if (cur) lines.push(cur);
      if (lines.length > n * perKey) continue;
      const used = Math.ceil(lines.length / perKey);
      const offset = Math.floor((n - used) / 2);
      const keys = Array.from({ length: n }, () => []);
      lines.forEach((ln, i) => keys[offset + Math.floor(i / perKey)].push(ln));
      return { size, keys };
    }
  }
  // too long: shorten into the available keys at the smallest size
  const size = 22;
  const keys = Array.from({ length: n }, () => []);
  let i = 0;
  for (let k = 0; k < n && i < words.length; k++) {
    for (let line = 0; line < 2 && i < words.length; line++) {
      let cur = '';
      while (i < words.length) {
        const next = cur ? `${cur} ${words[i]}` : words[i];
        if (textWidth(next, size, weight) > maxW && cur) break;
        cur = next;
        i++;
      }
      keys[k].push(cur);
    }
  }
  const last = keys[n - 1];
  if (i < words.length || last.some((l) => textWidth(l, size, weight) > maxW)) {
    let s = last[last.length - 1] || '';
    while (s.length > 1 && textWidth(s + '…', size, weight) > maxW) s = s.slice(0, -1);
    last[last.length - 1] = s + '…';
    for (const k of keys) for (let j = 0; j < k.length; j++) {
      while (k[j].length > 1 && textWidth(k[j], size, weight) > maxW) k[j] = k[j].slice(0, -2) + '…';
    }
  }
  return { size, keys };
}

/** Dark key background with an optional glow in `color`. */
function backdrop(W, { color, glow = 0, cx = W / 2, cy = 62, r = 80, style = 'glow' } = {}) {
  let s = `<rect x="0" y="0" width="${f1(W)}" height="${S}" fill="${rgb(BG)}"/>`;
  let defs = '';
  if (color && glow > 0 && style !== 'flat') {
    const id = `g${++gradId}`;
    defs += `<radialGradient id="${id}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" gradientUnits="userSpaceOnUse">`
      + `<stop offset="0" stop-color="${rgb(color)}" stop-opacity="${(0.40 * glow).toFixed(3)}"/>`
      + `<stop offset="0.55" stop-color="${rgb(color)}" stop-opacity="${(0.13 * glow).toFixed(3)}"/>`
      + `<stop offset="1" stop-color="${rgb(color)}" stop-opacity="0"/></radialGradient>`;
    s += `<rect x="0" y="0" width="${f1(W)}" height="${S}" fill="${rgb(color)}" fill-opacity="${(0.05 * glow).toFixed(3)}"/>`;
    s += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="url(#${id})"/>`;
  } else if (color && glow > 0) {
    s += `<rect x="0" y="0" width="${f1(W)}" height="${S}" fill="${rgb(color)}" fill-opacity="${(0.13 * glow).toFixed(3)}"/>`;
  }
  return { body: s, defs };
}

/** Outline ring for presses / errors. */
function ring(color, strong = true) {
  return `<rect x="6" y="6" width="132" height="132" rx="24" fill="none" stroke="${rgb(color)}" stroke-opacity="${strong ? 0.9 : 0.35}" stroke-width="${strong ? 3.5 : 2}"/>`;
}

function overlay(k) {
  if (k.failed) return ring(RED);
  if (k.pressed) return ring(k.color || AMBER);
  return '';
}

// ---------------------------------------------------------------- line icons
// Each icon is centred on (cx, cy) with size r (about half its height).
// Same stroke weight everywhere; "on" adds the colour and a soft fill.

const SW = 0.16; // stroke width as a share of r

function iconPower(cx, cy, r, col) {
  const p = (a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
  const [x1, y1] = p(38), [x2, y2] = p(322);
  return `<path d="M${f1(x1)} ${f1(y1)} A${f1(r)} ${f1(r)} 0 1 1 ${f1(x2)} ${f1(y2)}" fill="none" stroke="${rgb(col)}" stroke-width="${f1(r * SW * 1.2)}" stroke-linecap="round"/>`
    + `<line x1="${f1(cx)}" y1="${f1(cy - r * 1.1)}" x2="${f1(cx)}" y2="${f1(cy - r * 0.2)}" stroke="${rgb(col)}" stroke-width="${f1(r * SW * 1.2)}" stroke-linecap="round"/>`;
}

// Australian power point: angled active/neutral slots and a vertical earth.
function iconPlug(cx, cy, r, col, on) {
  let s = `<rect x="${f1(cx - r)}" y="${f1(cy - r)}" width="${f1(2 * r)}" height="${f1(2 * r)}" rx="${f1(r * 0.38)}" fill="${rgb(col)}" fill-opacity="${on ? 0.16 : 0}" stroke="${rgb(col)}" stroke-width="${f1(r * SW)}"/>`;
  const slot = (x1, y1, x2, y2) => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${rgb(col)}" stroke-width="${f1(r * 0.17)}" stroke-linecap="round"/>`;
  s += slot(cx - r * 0.24, cy - r * 0.46, cx - r * 0.5, cy - r * 0.02);
  s += slot(cx + r * 0.24, cy - r * 0.46, cx + r * 0.5, cy - r * 0.02);
  s += slot(cx, cy + r * 0.22, cx, cy + r * 0.56);
  return s;
}

function iconBulb(cx, cy, r, col, on, level = 1) {
  const sw = r * SW;
  const by = cy - r * 0.22;
  const br = r * 0.66;
  const nx = r * 0.32;
  const ny = cy + r * 0.42;
  const a = Math.asin(nx / br);
  const sx = cx - br * Math.sin(a), sy = by + br * Math.cos(a);
  const ex = cx + br * Math.sin(a);
  const d = `M${f1(sx)} ${f1(sy)} L${f1(cx - nx)} ${f1(ny)} L${f1(cx + nx)} ${f1(ny)} L${f1(ex)} ${f1(sy)} A${f1(br)} ${f1(br)} 0 1 0 ${f1(sx)} ${f1(sy)} Z`;
  let s = `<path d="${d}" fill="${rgb(col)}" fill-opacity="${on ? (0.25 + 0.45 * level).toFixed(2) : 0}" stroke="${rgb(col)}" stroke-width="${f1(sw)}" stroke-linejoin="round"/>`;
  s += `<line x1="${f1(cx - nx * 0.95)}" y1="${f1(ny + r * 0.26)}" x2="${f1(cx + nx * 0.95)}" y2="${f1(ny + r * 0.26)}" stroke="${rgb(col)}" stroke-width="${f1(sw)}" stroke-linecap="round"/>`;
  s += `<line x1="${f1(cx - nx * 0.6)}" y1="${f1(ny + r * 0.52)}" x2="${f1(cx + nx * 0.6)}" y2="${f1(ny + r * 0.52)}" stroke="${rgb(col)}" stroke-width="${f1(sw)}" stroke-linecap="round"/>`;
  return s;
}

// Wall switch plate with a rocker that shows on/off.
function iconSwitch(cx, cy, r, col, on) {
  const sw = r * SW;
  let s = `<rect x="${f1(cx - r * 0.72)}" y="${f1(cy - r)}" width="${f1(r * 1.44)}" height="${f1(2 * r)}" rx="${f1(r * 0.28)}" fill="${rgb(col)}" fill-opacity="${on ? 0.12 : 0}" stroke="${rgb(col)}" stroke-width="${f1(sw)}"/>`;
  const w = r * 0.62, h = r * 1.2;
  s += `<rect x="${f1(cx - w / 2)}" y="${f1(cy - h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="${f1(r * 0.14)}" fill="none" stroke="${rgb(col)}" stroke-width="${f1(sw * 0.8)}"/>`;
  const fy = on ? cy - h / 2 : cy;
  s += `<rect x="${f1(cx - w / 2)}" y="${f1(fy)}" width="${f1(w)}" height="${f1(h / 2)}" rx="${f1(r * 0.14)}" fill="${rgb(col)}"/>`;
  return s;
}

function iconFan(cx, cy, r, col, on) {
  let s = '';
  for (let i = 0; i < 3; i++) {
    s += `<ellipse cx="${f1(cx)}" cy="${f1(cy - r * 0.52)}" rx="${f1(r * 0.3)}" ry="${f1(r * 0.5)}" transform="rotate(${i * 120} ${f1(cx)} ${f1(cy)})" fill="${rgb(col)}" fill-opacity="${on ? 0.22 : 0}" stroke="${rgb(col)}" stroke-width="${f1(r * SW * 0.85)}"/>`;
  }
  s += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 0.16)}" fill="${rgb(col)}"/>`;
  return s;
}

function iconBolt(cx, cy, r, col) {
  const p = [[0.12, -1], [-0.55, 0.12], [-0.02, 0.12], [-0.14, 1], [0.55, -0.16], [0.02, -0.16]];
  return `<polygon points="${p.map(([x, y]) => `${f1(cx + x * r)},${f1(cy + y * r)}`).join(' ')}" fill="${rgb(col)}" fill-opacity="0.18" stroke="${rgb(col)}" stroke-width="${f1(r * SW * 0.9)}" stroke-linejoin="round"/>`;
}

// House with a signal arc: the Setup key.
function iconHome(cx, cy, r, col) {
  const sw = r * SW;
  const pts = [[-0.95, -0.05], [0, -0.92], [0.95, -0.05]];
  let s = `<polyline points="${pts.map(([x, y]) => `${f1(cx + x * r)},${f1(cy + y * r)}`).join(' ')}" fill="none" stroke="${rgb(col)}" stroke-width="${f1(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="M${f1(cx - r * 0.72)} ${f1(cy - r * 0.2)} L${f1(cx - r * 0.72)} ${f1(cy + r * 0.92)} L${f1(cx + r * 0.72)} ${f1(cy + r * 0.92)} L${f1(cx + r * 0.72)} ${f1(cy - r * 0.2)}" fill="none" stroke="${rgb(col)}" stroke-width="${f1(sw)}" stroke-linejoin="round"/>`;
  const wy = cy + r * 0.62;
  for (const k of [0.22, 0.48]) {
    const rr = r * k;
    s += `<path d="M${f1(cx - rr * 0.8)} ${f1(wy - rr * 0.6)} A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(cx + rr * 0.8)} ${f1(wy - rr * 0.6)}" fill="none" stroke="${rgb(col)}" stroke-width="${f1(sw * 0.8)}" stroke-linecap="round"/>`;
  }
  s += `<circle cx="${f1(cx)}" cy="${f1(wy)}" r="${f1(r * 0.08)}" fill="${rgb(col)}"/>`;
  return s;
}

function icon(name, cx, cy, r, col, on, level) {
  switch (name) {
    case 'plug': return iconPlug(cx, cy, r, col, on);
    case 'bulb': return iconBulb(cx, cy, r, col, on, level);
    case 'switch': return iconSwitch(cx, cy, r, col, on);
    case 'fan': return iconFan(cx, cy, r, col, on);
    case 'bolt': return iconBolt(cx, cy, r, col);
    case 'home': return iconHome(cx, cy, r, col);
    default: return iconPower(cx, cy, r, col);
  }
}

// ---------------------------------------------------------------- helpers

/** Short status for devices that aren't working right now. */
function statusText(status) {
  switch (status) {
    case 'offline': return { text: 'Offline', color: RED };
    case 'searching': return { text: 'Looking…', color: MUTED };
    case 'connecting': return { text: 'Connecting', color: MUTED };
    case 'nokey': return { text: 'No key', color: RED };
    default: return null;
  }
}

function formatWatts(w) {
  if (w === null || w === undefined || !Number.isFinite(w)) return '–';
  if (w >= 1000) return (w / 1000).toFixed(w >= 10000 ? 1 : 2) + 'k';
  if (w >= 100) return String(Math.round(w));
  return w.toFixed(1).replace(/\.0$/, '');
}

/** One or two centred lines ending at baseline `bottom`. */
function labelLines(fit, bottom, color, weight = 600) {
  const lh = fit.size * 1.05;
  return fit.lines.map((ln, i) => text(72, bottom - (fit.lines.length - 1 - i) * lh, ln, fit.size, color, { weight })).join('');
}

/** Label on top, big value in the middle, a sub-label underneath. */
function valueLayout({ label, value, sub, valueColor, labelColor = MUTED, subColor = MUTED, bar }) {
  let s = '';
  if (label) s += labelLines(fitText(label, 128, [22, 21, 20, 19], 600, false), 34, labelColor);
  const vf = fitText(value, 128, [54, 52, 50, 46, 42, 38], 700, false);
  s += text(72, label ? 94 : 84, vf.lines[0], vf.size, valueColor, { weight: 700 });
  if (bar) s += bar;
  else if (sub) s += labelLines(fitText(sub, 128, [22, 21, 20, 19], 600, false), label ? 128 : 120, subColor);
  return s;
}

function miniBar(pct, color) {
  const x = 22, w = 100, y = 112, h = 12;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="rgb(46,46,56)"/>`;
  if (pct > 0) s += `<rect x="${x}" y="${y}" width="${f1(Math.max(h, (w * pct) / 100))}" height="${h}" rx="${h / 2}" fill="${rgb(color)}"/>`;
  return s;
}

// ---------------------------------------------------------------- single keys

/**
 * k = {
 *   show: 'button'|'icon'|'state'|'watts'|'level'|'message'|'status'|'devices',
 *   icon, on, name, color, style, status, pct, watts, pressed, failed, ...
 * }
 */
function drawKey(k) {
  const col = k.color || AMBER;
  const st = statusText(k.status);
  const on = !!k.on && !st;
  const level = k.pct ? k.pct / 100 : 1;
  const iconCol = on ? col : st ? DIM : [140, 140, 152];
  let body = '';
  let defs = '';
  const bg = (glow, cy = 62) => {
    const b = backdrop(S, { color: col, glow, cy, style: k.style });
    body += b.body;
    defs += b.defs;
  };

  switch (k.show) {
    case 'button': {
      bg(on ? 0.45 + 0.55 * level : 0, 54);
      const label = st ? st.text : k.name || '';
      const fit = fitText(label, 128);
      const two = fit.lines.length > 1;
      body += icon(k.icon, 72, two ? 44 : 54, two ? 24 : 28, iconCol, on, level);
      body += labelLines(fit, 128, st ? st.color : on ? TEXT : MUTED);
      break;
    }
    case 'icon': {
      bg(on ? 0.45 + 0.55 * level : 0, st ? 56 : 72);
      if (st) {
        body += icon(k.icon, 72, 54, 28, iconCol, on, level);
        body += labelLines(fitText(st.text, 128), 128, st.color);
      } else {
        body += icon(k.icon, 72, 72, 38, iconCol, on, level);
      }
      break;
    }
    case 'state': {
      bg(on ? 0.6 : 0, 80);
      body += valueLayout({
        label: k.name,
        value: st ? '–' : on ? 'ON' : 'OFF',
        valueColor: st ? DIM : on ? mix(col, TEXT, 0.25) : MUTED,
        sub: st ? st.text : null,
        subColor: st ? st.color : MUTED,
      });
      break;
    }
    case 'watts': {
      const active = !st && k.watts !== null && k.watts !== undefined && k.watts > 0.5;
      bg(active ? 0.55 : 0, 80);
      body += valueLayout({
        label: k.name,
        value: st ? '–' : formatWatts(k.watts),
        valueColor: active ? TEXT : MUTED,
        sub: st ? st.text : 'watts',
        subColor: st ? st.color : active ? mix(col, TEXT, 0.4) : MUTED,
      });
      break;
    }
    case 'level': {
      const pct = on ? Math.round(k.pct || 0) : 0;
      bg(on ? 0.25 + 0.6 * level : 0, 80);
      body += valueLayout({
        label: k.name,
        value: st ? '–' : on ? `${pct}%` : 'Off',
        valueColor: on ? TEXT : MUTED,
        sub: st ? st.text : null,
        subColor: st ? st.color : MUTED,
        bar: st ? null : miniBar(pct, col),
      });
      break;
    }
    case 'status': {
      // Setup key: connection status
      const c = k.statusColor || MUTED;
      const b = backdrop(S, { color: c, glow: k.statusGlow ? 0.5 : 0, cy: 50, style: k.style });
      body += b.body;
      defs += b.defs;
      body += icon('home', 72, 48, 26, c, true);
      const l1 = fitText(k.line1 || '', 128, [22, 21, 20, 19], 700, false);
      body += text(72, 106, l1.lines[0], l1.size, k.line1Color || TEXT, { weight: 700 });
      if (k.line2) {
        const l2 = fitText(k.line2, 128, [20, 19], 600, false);
        body += text(72, 130, l2.lines[0], l2.size, MUTED, { weight: 600 });
      }
      break;
    }
    case 'devices': {
      bg(0);
      body += valueLayout({ label: 'Devices', value: String(k.count ?? 0), valueColor: TEXT, sub: k.sub || '' });
      break;
    }
    case 'message':
    default: {
      bg(0);
      body += icon('home', 72, 46, 24, DIM, false);
      const lines = (k.lines || []).slice(0, 2);
      if (lines[0]) body += labelLines(fitText(lines[0], 128, [22, 21, 20, 19], 700, false), 104, TEXT, 700);
      if (lines[1]) body += labelLines(fitText(lines[1], 128, [20, 19], 600, false), 128, MUTED);
      break;
    }
  }
  body += overlay({ ...k, color: k.show === 'status' ? k.statusColor || MUTED : col });
  return svgDoc(body, 0, defs);
}

// ---------------------------------------------------------------- name across keys

/** Name spread over n keys (words never cross a gap). Returns n SVGs. */
function drawNames(n, d) {
  const col = d.color || AMBER;
  const st = statusText(d.status);
  const on = !!d.on && !st;
  const spread = spreadWords(d.name || '', n);
  return spread.keys.map((lines, i) => {
    const b = backdrop(S, { color: col, glow: on ? 0.35 : 0, cy: 72, r: 96, style: d.style });
    let body = b.body;
    const lh = spread.size * 1.05;
    let y = 72 + spread.size * 0.36 - ((lines.length - 1) * lh) / 2;
    for (const ln of lines) {
      body += text(72, y, ln, spread.size, on ? TEXT : st ? DIM : MUTED, { weight: 600 });
      y += lh;
    }
    body += overlay({ ...(d.keys ? d.keys[i] : d), color: col });
    return svgDoc(body, 0, b.defs);
  });
}

// ---------------------------------------------------------------- spanning graphics

function spanWidth(m) {
  return m * S + (m - 1) * GAP;
}

/**
 * Brightness slider over m keys. Each key jumps to its level when pressed,
 * so each key shows its own target level as a label.
 */
function drawSlider(m, d) {
  const col = d.color || AMBER;
  const st = statusText(d.status);
  const on = !!d.on && !st;
  const pct = on ? Math.max(0, Math.min(100, d.pct || 0)) : 0;
  const W = spanWidth(m);
  const b = backdrop(W, { color: col, glow: on ? 0.25 + 0.55 * (pct / 100) : 0, cx: W / 2, cy: 60, r: Math.max(100, W * 0.45), style: d.style });
  let shared = b.body;
  const x0 = 18, x1 = W - 18, y = 48, h = 26;
  shared += `<rect x="${x0}" y="${y}" width="${f1(x1 - x0)}" height="${h}" rx="${h / 2}" fill="rgb(46,46,56)"/>`;
  if (pct > 0) {
    const w = Math.max(h, ((x1 - x0) * pct) / 100);
    shared += `<rect x="${x0}" y="${y}" width="${f1(w)}" height="${h}" rx="${h / 2}" fill="${rgb(col)}"/>`;
    shared += `<rect x="${x0}" y="${y}" width="${f1(w)}" height="${h / 2}" rx="${h / 4}" fill="rgb(255,255,255)" fill-opacity="0.12"/>`;
  }
  const out = [];
  for (let i = 0; i < m; i++) {
    const kx = i * (S + GAP);
    const target = Math.round(((i + 1) / m) * 100);
    const active = on && Math.abs(pct - target) < 100 / m / 2 + 0.5;
    let own = '';
    const label = st ? (i === 0 ? st.text : '') : `${target}%`;
    if (label) {
      const fit = fitText(label, 128, [26, 24, 22, 20], 700, false);
      own += text(kx + 72, 118, fit.lines[0], fit.size, st ? st.color : active ? mix(col, TEXT, 0.45) : MUTED, { weight: active ? 700 : 600 });
    }
    const k = (d.keys && d.keys[i]) || {};
    if (k.failed) own += `<g transform="translate(${kx} 0)">${ring(RED)}</g>`;
    else if (k.pressed) own += `<g transform="translate(${kx} 0)">${ring(col)}</g>`;
    out.push(svgDoc(shared + own, kx, b.defs));
  }
  return out;
}

/** Power graph over m keys (last few minutes of readings). */
function drawGraph(m, d) {
  const col = d.color || AMBER;
  const st = statusText(d.status);
  const W = spanWidth(m);
  const b = backdrop(W, { style: d.style });
  let shared = b.body;
  const gx0 = 12, gx1 = W - 12, gy0 = 44, gy1 = 126;
  const hist = (d.history || []).filter((p) => Number.isFinite(p.w));
  const now = d.now || Date.now();
  const span = 150000 * m; // 2.5 minutes per key
  const pts = hist.filter((p) => p.t >= now - span);
  const peak = Math.max(0, ...pts.map((p) => p.w));
  const max = Math.max(10, peak) * 1.12;
  shared += `<line x1="${gx0}" y1="${gy1}" x2="${f1(gx1)}" y2="${gy1}" stroke="rgb(52,52,62)" stroke-width="2"/>`;
  if (pts.length >= 2) {
    const X = (t) => gx0 + ((t - (now - span)) / span) * (gx1 - gx0);
    const Y = (v) => gy1 - (v / max) * (gy1 - gy0);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.t))} ${f1(Y(p.w))}`).join(' ');
    const area = `${line} L${f1(X(pts[pts.length - 1].t))} ${gy1} L${f1(X(pts[0].t))} ${gy1} Z`;
    shared += `<path d="${area}" fill="${rgb(col)}" fill-opacity="0.2"/>`;
    shared += `<path d="${line}" fill="none" stroke="${rgb(col)}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pts[pts.length - 1];
    shared += `<circle cx="${f1(X(last.t))}" cy="${f1(Y(last.w))}" r="5" fill="${rgb(col)}"/>`;
  }
  const out = [];
  for (let i = 0; i < m; i++) {
    const kx = i * (S + GAP);
    let own = '';
    // one short label, inside a single key
    if (i === 0) {
      const label = st ? st.text : pts.length >= 2 ? `Peak ${formatWatts(peak)} W` : 'Graph starting';
      const fit = fitText(label, 124, [22, 21, 20, 19], 600, false);
      own += text(kx + 72, 30, fit.lines[0], fit.size, st ? st.color : MUTED);
    }
    const k = (d.keys && d.keys[i]) || {};
    if (k.failed) own += `<g transform="translate(${kx} 0)">${ring(RED)}</g>`;
    else if (k.pressed) own += `<g transform="translate(${kx} 0)">${ring(col)}</g>`;
    out.push(svgDoc(shared + own, kx, b.defs));
  }
  return out;
}

// ---------------------------------------------------------------- action list icons

function actionIcon(kind) {
  const col = AMBER;
  const b = backdrop(S, { color: col, glow: 0.8, cy: 72 });
  let body = b.body;
  if (kind === 'switch') body += iconPower(72, 76, 34, col);
  else if (kind === 'light') body += iconBulb(72, 74, 42, [255, 196, 110], true, 0.8);
  else if (kind === 'brightness') {
    body += `<rect x="20" y="58" width="104" height="22" rx="11" fill="rgb(46,46,56)"/><rect x="20" y="58" width="68" height="22" rx="11" fill="${rgb(col)}"/>`;
    body += text(72, 118, '60%', 30, TEXT, { weight: 700 });
  } else if (kind === 'power') {
    body += iconBolt(72, 62, 34, col);
    body += text(72, 126, 'W', 30, TEXT, { weight: 700 });
  } else if (kind === 'setup') {
    body += iconHome(72, 70, 40, col);
  } else {
    body += iconPlug(72, 72, 40, col, true);
  }
  return svgDoc(body, 0, b.defs);
}

module.exports = {
  drawKey, drawNames, drawSlider, drawGraph, actionIcon, spreadWords, fitText, formatWatts,
  S, GAP, MIN_TEXT, AMBER, GREEN, RED, MUTED, TEXT,
};
