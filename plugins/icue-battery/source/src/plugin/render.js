'use strict';
const { drawIcon, iconForKind, kindName } = require('./icons');

// Key images are 144 x 144 SVG data URLs. Rules (all confirmed on the real deck):
//  - no "#" or "%" anywhere (colours are rgb(), text uses full-width look-alikes)
//  - no gradients with url(#id), no filters
//  - the renderer trims spaces at the edges of a <tspan>, so we use plain <text> elements
const W = 144;
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
  off: 'rgb(110,118,130)',
};
const FONT = "'Segoe UI', 'Inter', Arial, sans-serif";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/#/g, '＃').replace(/%/g, '％');
}

function text(str, o) {
  // o: x, y, size, fill, weight, anchor
  return '<text x="' + o.x + '" y="' + o.y + '" font-family="' + FONT + '" font-size="' + o.size +
    '" font-weight="' + (o.weight || 700) + '" fill="' + o.fill + '" text-anchor="' + (o.anchor || 'middle') + '">' + esc(str) + '</text>';
}

function wrap(body, bg) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">' +
    '<rect width="144" height="144" fill="' + (bg || C.bg) + '"/>' + body + '</svg>';
}

function toDataUrl(svg) {
  return 'data:image/svg+xml;charset=utf8,' + svg;
}

// Short name that fits one line at 22 px: "HS80 MAX WIRELESS" -> "HS80 MAX"
function shortName(model, kind) {
  let words = String(model || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const drop = /^(WIRELESS|RGB|GAMING|HEADSET|DONGLE|MOUSE|KEYBOARD|CORSAIR)$/i;
  const kept = words.filter((w) => !drop.test(w));
  if (kept.length) words = kept;
  let s = words.join(' ');
  while (s.length > 11 && words.length > 1) { words.pop(); s = words.join(' '); }
  if (s.length > 11) s = s.slice(0, 10) + '…';
  return s || kindName(kind);
}

// The percent sign is drawn from shapes (two rings and a slash) so no "%" ever appears in the image.
function percentSign(x, y, h, color) {
  // 26 px wide, h tall; two rings and a slash
  const w = 26, r = 5.4, top = y - h + 3;
  return '<g fill="none" stroke="' + color + '" stroke-width="3.6" stroke-linecap="round">' +
    '<circle cx="' + (x + 7.5).toFixed(1) + '" cy="' + (top + 7.5).toFixed(1) + '" r="' + r + '"/>' +
    '<circle cx="' + (x + w - 7.5).toFixed(1) + '" cy="' + (y - 7.5).toFixed(1) + '" r="' + r + '"/>' +
    '<path d="M' + (x + w - 3).toFixed(1) + ' ' + (top + 1).toFixed(1) + 'L' + (x + 3).toFixed(1) + ' ' + (y - 1).toFixed(1) + '"/></g>';
}

// Width of a bold digit string at 50 px (Inter Bold digits are about 0.62 em; measured in the tests).
const DIGIT_W = 31;

function levelColor(level, low) {
  if (level <= low) return C.bad;
  if (level <= Math.max(low + 15, 40)) return C.warn;
  return C.good;
}

// ---- keys -------------------------------------------------------------------------------------

// m: { present, level, low, blink, model, kind, charging, frame }
function batteryKey(m) {
  const present = m.present;
  const has = typeof m.level === 'number';
  const level = has ? Math.max(0, Math.min(100, Math.round(m.level))) : 0;
  const charging = present && m.charging;
  const accent = !has ? (charging ? C.info : C.off) : (charging ? C.info : (present ? levelColor(level, m.low) : C.off));
  const isLow = !charging && present && has && m.low > 0 && level <= m.low;
  const bg = isLow && m.blink ? C.bgLow : C.bg;
  let body = drawIcon(iconForKind(m.kind), 49, 8, 46, present ? accent : C.off);
  if (charging) body += drawIcon('bolt', 101, 10, 34, C.warn);
  if (has) {
    const digits = String(level);
    const numW = digits.length * DIGIT_W;
    const pctW = 26;
    const gap = 5;
    const start = (W - (numW + gap + pctW)) / 2;
    body += text(digits, { x: (start + numW).toFixed(1), y: 98, size: 50, fill: accent, anchor: 'end' });
    body += percentSign(start + numW + gap, 98, 40, accent);
    body += '<rect x="22" y="107" width="100" height="8" rx="4" fill="' + C.track + '"/>';
    // while charging the bar fills up from the last known level to full, over and over
    const shown = charging ? level + (100 - level) * ((m.frame || 0) % 6) / 5 : level;
    if (shown > 0) body += '<rect x="22" y="107" width="' + Math.max(8, Math.round(shown)) + '" height="8" rx="4" fill="' + accent + '"/>';
  } else {
    body += text('–', { x: 72, y: 98, size: 50, fill: C.off });
  }
  if (charging && !has) body += '<rect x="22" y="107" width="' + Math.round(8 + 92 * ((m.frame || 0) % 6) / 5) + '" height="8" rx="4" fill="' + C.info + '"/>';
  const label = !present ? 'Not found' : (charging ? 'Charging' : shortName(m.model, m.kind));
  body += text(label, { x: 72, y: 136, size: 22, fill: !present ? C.warn : (charging ? C.info : C.muted), weight: 600 });
  return wrap(body, bg);
}

// A state key: icon, one big word, label underneath.
function stateKey(m) {
  // m: { icon, word, color, label, present }
  const col = m.present === false ? C.off : m.color;
  const size = m.word.length > 3 ? 36 : 50;
  let body = drawIcon(m.icon, 49, 8, 46, col);
  body += text(m.word, { x: 72, y: 100, size: size, fill: col });
  body += text(m.present === false ? 'Not found' : m.label, { x: 72, y: 136, size: 22, fill: m.present === false ? C.warn : C.muted, weight: 600 });
  return wrap(body);
}

function roleKey(role, m) {
  const p = m.props || {};
  const present = m.present;
  if (role === 'battery') return batteryKey(m);
  if (role === 'mic') {
    const on = p.mic === true;
    return stateKey({ icon: on ? 'mic' : 'micMuted', word: p.mic == null ? '–' : (on ? 'ON' : 'MUTED'), color: on ? C.good : C.bad, label: 'Mic', present });
  }
  if (role === 'connection') {
    return stateKey({ icon: 'link', word: present ? 'ON' : 'OFF', color: present ? C.good : C.bad, label: 'Connected', present: true });
  }
  return wrap('');
}

// Shown on every key until the Setup key is added / working.
function noticeKey(lines) {
  let body = drawIcon('plug', 49, 8, 46, C.warn);
  body += text(lines[0], { x: 72, y: 90, size: 26, fill: C.text });
  body += text(lines[1], { x: 72, y: 122, size: 26, fill: C.text });
  return wrap(body);
}

// s: { status: 'ok'|'nodevice'|'sdk'|'connecting'|'helper', model, kind }
function setupKey(s) {
  if (s.status === 'ok') {
    let body = drawIcon('plug', 49, 8, 46, C.good);
    body += text('Connected', { x: 72, y: 96, size: 24, fill: C.good });
    body += text(shortName(s.model, s.kind), { x: 72, y: 132, size: 22, fill: C.muted, weight: 600 });
    return wrap(body);
  }
  if (s.status === 'nodevice') {
    let body = drawIcon('plug', 49, 8, 46, C.warn);
    body += text('No device', { x: 72, y: 96, size: 26, fill: C.warn });
    body += text('Turn it on', { x: 72, y: 132, size: 22, fill: C.muted, weight: 600 });
    return wrap(body);
  }
  if (s.status === 'sdk') {
    let body = drawIcon('plug', 49, 8, 46, C.bad);
    body += text('Turn on', { x: 72, y: 92, size: 28, fill: C.bad });
    body += text('iCUE SDK', { x: 72, y: 124, size: 28, fill: C.bad });
    return wrap(body);
  }
  if (s.status === 'helper') {
    let body = drawIcon('plug', 49, 8, 46, C.bad);
    body += text('Helper', { x: 72, y: 92, size: 28, fill: C.bad });
    body += text('stopped', { x: 72, y: 124, size: 28, fill: C.bad });
    return wrap(body);
  }
  let body = drawIcon('plug', 49, 8, 46, C.off);
  body += text('Starting', { x: 72, y: 104, size: 26, fill: C.muted });
  return wrap(body);
}

module.exports = { toDataUrl, batteryKey, roleKey, noticeKey, setupKey, shortName, esc, C, DIGIT_W };
