'use strict';
// Draws every key as an SVG, then turns it into a 144 x 144 PNG with resvg.
// Rules: dark keys, line icons, colour from content, numbers 50-52 px, labels 22 px,
// nothing under 19 px, "%" drawn as shapes (never as a font glyph).
const { Resvg, initWasm } = require('@resvg/resvg-wasm');
const assets = require('./assets');
const { drawIcon } = require('./icons');

const W = 144;
const MIN_SIZE = 19;
const FONT = 'Inter';
const C = {
  bg: 'rgb(22,24,28)',
  bgLow: 'rgb(96,22,22)',
  text: 'rgb(232,235,240)',
  muted: 'rgb(154,162,174)',
  track: 'rgb(52,56,64)',
  good: 'rgb(74,222,128)',
  warn: 'rgb(251,191,36)',
  bad: 'rgb(248,81,73)',
  info: 'rgb(125,200,255)',
  off: 'rgb(110,118,130)'
};

// ---- engine ---------------------------------------------------------------
let initPromise = null;
let ready = false;
function init() {
  if (!initPromise) initPromise = initWasm(assets.wasm).then(() => { ready = true; });
  return initPromise;
}
function isReady() { return ready; }
function fontOptions() {
  return { fontBuffers: [assets.fontSemiBold, assets.fontBold], loadSystemFonts: false, defaultFontFamily: FONT };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- text -----------------------------------------------------------------
const widthCache = new Map();
function textWidth(str, size, weight) {
  const k = size + '|' + weight + '|' + str;
  if (widthCache.has(k)) return widthCache.get(k);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><text x="0" y="120" font-family="' + FONT +
    '" font-size="' + size + '" font-weight="' + weight + '">' + esc(str) + '</text></svg>';
  const box = new Resvg(svg, { font: fontOptions() }).getBBox();
  const w = box ? box.width : 0;
  widthCache.set(k, w);
  return w;
}

// Text that always fits maxWidth: step the size down to 19, then cut with an ellipsis.
function fitText(str, o) {
  const weight = o.weight || 700;
  const maxWidth = o.maxWidth || 136;
  const min = o.min || MIN_SIZE;
  let s = String(str == null ? '' : str);
  let size = o.size;
  while (size > min && textWidth(s, size, weight) > maxWidth) size -= 1;
  if (textWidth(s, size, weight) > maxWidth) {
    while (s.length > 1 && textWidth(s + '…', size, weight) > maxWidth) s = s.slice(0, -1);
    s += '…';
  }
  return text(s, { x: o.x, y: o.y, size, fill: o.fill, anchor: o.anchor, weight });
}

function text(str, o) {
  const s = String(str == null ? '' : str);
  if (s.indexOf('%') >= 0) throw new Error('Never draw "%" as text, use percentSign()');
  if (o.size < MIN_SIZE) throw new Error('Text under ' + MIN_SIZE + ' px: ' + s);
  return '<text x="' + o.x + '" y="' + o.y + '" font-family="' + FONT + '" font-size="' + o.size + '" font-weight="' +
    (o.weight || 700) + '" fill="' + o.fill + '" text-anchor="' + (o.anchor || 'middle') + '">' + esc(s) + '</text>';
}

// "%" built from two circles and a slash. Width 26, height h, baseline y.
function percentSign(x, y, h, color) {
  const w = 26, r = 5.4, top = y - h + 3;
  return '<g fill="none" stroke="' + color + '" stroke-width="3.6" stroke-linecap="round">' +
    '<circle cx="' + (x + 7.5).toFixed(1) + '" cy="' + (top + 7.5).toFixed(1) + '" r="' + r + '"/>' +
    '<circle cx="' + (x + w - 7.5).toFixed(1) + '" cy="' + (y - 7.5).toFixed(1) + '" r="' + r + '"/>' +
    '<path d="M' + (x + w - 3).toFixed(1) + ' ' + (top + 1).toFixed(1) + 'L' + (x + 3).toFixed(1) + ' ' + (y - 1).toFixed(1) + '"/></g>';
}

function wrap(body, bg) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">' +
    '<rect id="bg" width="144" height="144" fill="' + (bg || C.bg) + '"/>' + body + '</svg>';
}

function toPng(svg) {
  return Buffer.from(new Resvg(svg, { font: fontOptions(), fitTo: { mode: 'width', value: W } }).render().asPng());
}
function toDataUrl(svg) {
  return 'data:image/png;base64,' + toPng(svg).toString('base64');
}

// For tests: everything drawn except the background, measured, plus the smallest font used.
function inspect(svg) {
  const noBg = svg.replace(/<rect id="bg"[^>]*\/>/, '');
  const box = new Resvg(noBg, { font: fontOptions() }).getBBox();
  const sizes = [];
  svg.replace(/font-size="([\d.]+)"/g, (m, n) => { sizes.push(parseFloat(n)); return m; });
  return { box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null, minFont: sizes.length ? Math.min.apply(null, sizes) : null };
}

// ---- keys -----------------------------------------------------------------
function levelColor(level, low) {
  if (low > 0 && level <= low) return C.bad;
  if (level <= Math.max(low + 15, 40)) return C.warn;
  return C.good;
}

// m: {present, value, charging, name, showName, showIcon, low, blink, frame}
function valueKey(m) {
  const has = typeof m.value === 'number';
  const level = has ? Math.max(0, Math.min(100, Math.round(m.value))) : 0;
  const charging = !!(m.present && m.charging);
  const accent = !m.present ? C.off : charging ? C.info : has ? levelColor(level, m.low) : C.off;
  const isLow = !charging && m.present && has && m.low > 0 && level <= m.low;
  const bg = isLow && m.blink ? C.bgLow : C.bg;

  const showIcon = m.showIcon !== false;
  const showName = m.showName !== false;
  const shift = showName ? 0 : 6;
  const numY = (showIcon ? 98 : 90) + shift;
  const barY = (showIcon ? 107 : 99) + shift;

  let body = '';
  if (showIcon) {
    body += drawIcon('gauge', 49, 8, 46, accent);
    if (charging) body += drawIcon('bolt', 101, 10, 34, C.warn);
  }
  if (has) {
    const digits = String(level);
    const numW = textWidth(digits, 50, 700);
    const pctW = 26, gap = 5;
    const start = (W - (numW + gap + pctW)) / 2;
    body += text(digits, { x: (start + numW).toFixed(1), y: numY, size: 50, fill: accent, anchor: 'end' });
    body += percentSign(start + numW + gap, numY, 40, accent);
    body += '<rect x="22" y="' + barY + '" width="100" height="8" rx="4" fill="' + C.track + '"/>';
    const shown = charging ? level + (100 - level) * ((m.frame || 0) % 6) / 5 : level;
    if (shown > 0) body += '<rect x="22" y="' + barY + '" width="' + Math.max(8, Math.round(shown)) + '" height="8" rx="4" fill="' + accent + '"/>';
  } else {
    body += text('–', { x: 72, y: numY, size: 50, fill: C.off });
  }
  if (showName) {
    const label = !m.present ? 'Not found' : charging ? 'Charging' : (m.name || '');
    body += fitText(label, { x: 72, y: 136, size: 22, fill: !m.present ? C.warn : charging ? C.info : C.muted, weight: 600 });
  }
  return wrap(body, bg);
}

// m: {present, word, ok, label}
function statusKey(m) {
  const col = !m.present ? C.off : m.ok ? C.good : C.bad;
  let body = drawIcon('link', 49, 8, 46, col);
  body += fitText(m.present ? m.word : '–', { x: 72, y: 100, size: 50, fill: col, maxWidth: 130, min: 36 });
  body += fitText(m.present ? m.label : 'Not found', { x: 72, y: 136, size: 22, fill: m.present ? C.muted : C.warn, weight: 600 });
  return wrap(body);
}

function blankKey() { return wrap(''); }

function noticeKey(lines) {
  let body = drawIcon('plug', 49, 8, 46, C.warn);
  body += fitText(lines[0], { x: 72, y: 90, size: 26, fill: C.text });
  body += fitText(lines[1], { x: 72, y: 122, size: 26, fill: C.text });
  return wrap(body);
}

// Waiting picture: three dots, no text, so it can be drawn before settings arrive.
function waitingKey() {
  const dots = [52, 72, 92].map((x) => '<circle cx="' + x + '" cy="72" r="5" fill="' + C.off + '"/>').join('');
  return wrap(dots);
}

// s: {status: ok|nosource|connecting, sourceName}
function setupKey(s) {
  if (s.status === 'ok') {
    let body = drawIcon('plug', 49, 8, 46, C.good);
    body += fitText('Connected', { x: 72, y: 96, size: 24, fill: C.good });
    body += fitText(s.sourceName || '', { x: 72, y: 132, size: 22, fill: C.muted, weight: 600 });
    return wrap(body);
  }
  if (s.status === 'nosource') {
    let body = drawIcon('plug', 49, 8, 46, C.bad);
    body += fitText('No source', { x: 72, y: 96, size: 26, fill: C.bad });
    body += fitText('Press to retry', { x: 72, y: 132, size: 22, fill: C.muted, weight: 600 });
    return wrap(body);
  }
  let body = drawIcon('plug', 49, 8, 46, C.off);
  body += fitText('Starting', { x: 72, y: 104, size: 26, fill: C.muted });
  return wrap(body);
}

module.exports = {
  init, isReady, toPng, toDataUrl, inspect, textWidth, fitText, text, percentSign,
  valueKey, statusKey, blankKey, noticeKey, waitingKey, setupKey, esc, wrap, C, W
};
