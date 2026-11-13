// Key images as SVG data URLs (144 x 144). Rules for the Ajazz renderer:
// no "#" or "%" anywhere, rgb() colours only, no url(#id) gradients/filters,
// text at least 19 px and always inside one key.
'use strict';

const { CONN_LABEL } = require('./mice');

const S = 144, GAP = 28, STEP = S + GAP;
const C = {
  bg: 'rgb(18,20,26)', bgLow: 'rgb(58,18,20)', text: 'rgb(236,239,244)', muted: 'rgb(150,158,172)',
  dim: 'rgb(92,98,110)', grid: 'rgb(44,48,58)', green: 'rgb(74,222,128)', amber: 'rgb(251,191,36)',
  red: 'rgb(248,81,73)', blue: 'rgb(96,165,250)', icon: 'rgb(125,200,255)',
};
const FONT = 'Segoe UI, Arial, sans-serif';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/#/g, '＃').replace(/%/g, '%');
}
function text(x, y, size, content, fill, opts) {
  opts = opts || {};
  return '<text x="' + x + '" y="' + y + '" font-family="' + FONT + '" font-size="' + size + '"' +
    (opts.weight ? ' font-weight="' + opts.weight + '"' : '') + ' fill="' + fill + '" text-anchor="' + (opts.anchor || 'middle') + '">' +
    content + '</text>';
}
// Rough text width (Segoe UI-like proportions), used to shorten labels so they stay inside a key.
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of String(s)) {
    if (/[0-9]/.test(ch)) w += bold ? 0.6 : 0.56;
    else if (/[il.,:;'|!]/.test(ch)) w += 0.27;
    else if (ch === 'W') w += 0.98;
    else if (ch === 'M') w += 0.86;
    else if (/[mw]/.test(ch)) w += 0.84;
    else if (/[A-Z]/.test(ch)) w += 0.64;
    else if (ch === ' ') w += 0.27;
    else if (ch === '%' || ch === '…') w += 0.9;
    else w += 0.52;
  }
  return w * size * (bold ? 1.06 : 1);
}
function fit(s, size, max, bold) {
  s = String(s || '');
  if (textWidth(s, size, bold) <= max) return s;
  while (s.length > 1 && textWidth(s + '…', size, bold) > max) s = s.slice(0, -1).replace(/\s+$/, '');
  return s + '…';
}
// Try the given font sizes (largest first) before shortening the text.
function fitSize(s, sizes, max, bold) {
  for (const z of sizes) if (textWidth(s, z, bold) <= max) return { text: String(s || ''), size: z };
  const z = sizes[sizes.length - 1];
  return { text: fit(s, z, max, bold), size: z };
}
function svg(body, vx, vy, bg) {
  vx = vx || 0; vy = vy || 0;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="' + vx + ' ' + vy + ' 144 144">' +
    '<rect x="' + vx + '" y="' + vy + '" width="144" height="144" fill="' + (bg || C.bg) + '"/>' + body + '</svg>';
}
function dataUrl(s) { return 'data:image/svg+xml;charset=utf8,' + s; }

function lowLimit(settings) {
  const v = settings && settings.low;
  if (v === 'off') return null;
  const n = parseInt(v, 10);
  return isFinite(n) ? n : 20;
}
function levelColor(level, low) {
  if (level == null) return C.dim;
  if (low != null && level <= low) return C.red;
  if (level <= Math.max(40, (low || 0) + 20)) return C.amber;
  return C.green;
}
// Shared status line for a mouse.
function statusLabel(m, low) {
  if (!m) return 'No mouse';
  if (!m.present) return 'Not found';
  if (m.charging) return m.level != null && m.level >= 100 ? 'Full' : 'Charging';
  if (m.level == null) return 'Waiting';
  if (low != null && m.level <= low) return 'Low battery';
  return 'Battery';
}
// The level is "old" when the mouse went on the cable after its last report (it does not report while charging).
function levelIsOld(m) { return !!(m && m.conn === 'cable' && m.cableSince && (m.levelAt || 0) < m.cableSince); }

// ---------------------------------------------------------------- icons (line style)
function batteryIcon(x, y, w, h, level, color, charging) {
  const fillW = level == null ? 0 : Math.max(level > 0 ? 3 : 0, Math.round((w - 12) * level / 100));
  let s = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" fill="none" stroke="' + color + '" stroke-width="4"/>' +
    '<rect x="' + (x + w + 2) + '" y="' + (y + h / 2 - 7) + '" width="6" height="14" rx="2" fill="' + color + '"/>';
  if (fillW > 0) s += '<rect x="' + (x + 6) + '" y="' + (y + 6) + '" width="' + fillW + '" height="' + (h - 12) + '" rx="3" fill="' + color + '"/>';
  if (charging) s += bolt(x + w / 2, y + h / 2, h * 0.95, C.text, C.bg);
  return s;
}
function bolt(cx, cy, size, fill, stroke) {
  const k = size / 30;
  const pts = [[3, -15], [-9, 2], [-1, 2], [-4, 15], [9, -3], [1, -3]].map(p => (cx + p[0] * k).toFixed(1) + ',' + (cy + p[1] * k).toFixed(1)).join(' ');
  return '<polygon points="' + pts + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.5" stroke-linejoin="round"/>';
}
function mouseIcon(x, y, w, h, color, sw) {
  const r = w / 2;
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + (sw || 4) + '"/>' +
    '<line x1="' + (x + r) + '" y1="' + (y + h * 0.14) + '" x2="' + (x + r) + '" y2="' + (y + h * 0.3) + '" stroke="' + color + '" stroke-width="' + (sw || 4) + '" stroke-linecap="round"/>';
}
function connIcon(conn, cx, cy, color) {
  if (conn === 'bluetooth') {
    const p = (a) => a.map(q => (cx + q[0]) + ',' + (cy + q[1])).join(' ');
    return '<polyline points="' + p([[-13, -12], [13, 12], [0, 25], [0, -25], [13, -12], [-13, 12]]) + '" fill="none" stroke="' + color + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  if (conn === 'cable') {
    return '<rect x="' + (cx - 14) + '" y="' + (cy - 26) + '" width="28" height="30" rx="5" fill="none" stroke="' + color + '" stroke-width="4"/>' +
      '<line x1="' + (cx - 6) + '" y1="' + (cy - 36) + '" x2="' + (cx - 6) + '" y2="' + (cy - 26) + '" stroke="' + color + '" stroke-width="4" stroke-linecap="round"/>' +
      '<line x1="' + (cx + 6) + '" y1="' + (cy - 36) + '" x2="' + (cx + 6) + '" y2="' + (cy - 26) + '" stroke="' + color + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M ' + cx + ' ' + (cy + 4) + ' L ' + cx + ' ' + (cy + 16) + ' Q ' + cx + ' ' + (cy + 28) + ' ' + (cx - 12) + ' ' + (cy + 28) + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round"/>';
  }
  if (conn === 'receiver') {
    return '<rect x="' + (cx - 13) + '" y="' + (cy - 10) + '" width="26" height="38" rx="5" fill="none" stroke="' + color + '" stroke-width="4"/>' +
      '<rect x="' + (cx - 9) + '" y="' + (cy - 26) + '" width="18" height="16" rx="2" fill="none" stroke="' + color + '" stroke-width="4"/>' +
      '<path d="M ' + (cx + 20) + ' ' + (cy - 22) + ' A 14 14 0 0 1 ' + (cx + 20) + ' ' + (cy + 2) + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M ' + (cx + 28) + ' ' + (cy - 30) + ' A 24 24 0 0 1 ' + (cx + 28) + ' ' + (cy + 10) + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round"/>';
  }
  return mouseIcon(cx - 14, cy - 24, 28, 48, color);
}

// Percent sign drawn as shapes (works with any font). x = left edge, y = baseline.
function percentShape(x, y, size, color) {
  const w = size * 0.62, h = size * 0.7, r = size * 0.13, sw = Math.max(2.5, size * 0.09);
  const top = y - h;
  return '<circle cx="' + (x + r + sw / 2).toFixed(1) + '" cy="' + (top + r + sw / 2).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(1) + '"/>' +
    '<circle cx="' + (x + w - r - sw / 2).toFixed(1) + '" cy="' + (y - r - sw / 2).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(1) + '"/>' +
    '<line x1="' + (x + w - sw).toFixed(1) + '" y1="' + top.toFixed(1) + '" x2="' + (x + sw).toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + color + '" stroke-width="' + sw.toFixed(1) + '" stroke-linecap="round"/>';
}
// Big number with a smaller unit after it, centred as one line. unit '%' is drawn as shapes.
function bigNumber(y, num, unit, color, numSize, unitSize) {
  numSize = numSize || 52; unitSize = unitSize || 26;
  if (!unit) return text(72, y, numSize, esc(num), color, { weight: 700 });
  if (unit === '%') {
    const nw = textWidth(num, numSize, true), gap = numSize * 0.06, pw = unitSize * 0.62;
    const x0 = 72 - (nw + gap + pw) / 2;
    return text((x0 + nw).toFixed(1), y, numSize, esc(num), color, { weight: 700, anchor: 'end' }) + percentShape(x0 + nw + gap, y, unitSize, color);
  }
  return '<text x="72" y="' + y + '" font-family="' + FONT + '" fill="' + color + '" text-anchor="middle" font-weight="700">' +
    '<tspan font-size="' + numSize + '">' + esc(num) + '</tspan><tspan font-size="' + unitSize + '" dx="3">' + esc(unit) + '</tspan></text>';
}

// ---------------------------------------------------------------- key types
function batteryKey(m, settings) {
  const low = lowLimit(settings);
  const level = m ? m.level : null;
  const gone = !m || !m.present;
  const charging = !!(m && m.present && m.charging);
  if (m && m.present && levelIsOld(m)) {
    // On the cable the mouse reports nothing, so there is no current level to show.
    let b = batteryIcon(37, 16, 62, 34, null, C.blue, true);
    b += text(72, 98, 30, 'Charging', C.text, { weight: 700 });
    b += text(72, 134, 22, 'On cable', C.muted);
    return svg(b);
  }
  const col = gone ? C.dim : levelColor(level, low);
  const isLow = !gone && !charging && level != null && low != null && level <= low;
  let b = batteryIcon(37, 16, 62, 34, level, col, charging);
  b += bigNumber(106, level == null ? '--' : String(level), level == null ? '' : '%', level == null ? C.dim : (gone ? C.muted : (isLow ? C.red : C.text)));
  b += text(72, 134, 22, esc(statusLabel(m, low)), isLow ? C.red : charging ? C.blue : C.muted);
  return svg(b, 0, 0, isLow ? C.bgLow : C.bg);
}

function connectionKey(m) {
  const conn = m && m.present ? m.conn : null;
  const col = conn ? C.icon : C.dim;
  let b = connIcon(conn, 72, 44, col);
  b += text(72, 104, 24, esc(conn ? CONN_LABEL[conn] || conn : (m ? 'Not found' : 'No mouse')), conn ? C.text : C.muted, { weight: 600 });
  const line2 = conn === 'cable' ? 'Charging' : (m ? m.short : 'Mouse Info');
  const nm = fitSize(line2, [20, 19], 134);
  b += text(72, 132, nm.size, esc(nm.text), conn === 'cable' ? C.blue : C.muted);
  return svg(b);
}

// profile = {num, name, dpi, dpiColor, polling, wirelessPolling} or null
function profileKey(m, profile, settings) {
  const detail = (settings && settings.detail) || 'dpi';
  let b = text(72, 32, 22, 'Profile', C.muted);
  if (!profile) {
    b += bigNumber(96, '--', '', C.dim);
    const why = !m ? 'No mouse' : m.source !== 'glorious' ? 'Not available' : 'Open Core';
    b += text(72, 132, 20, why, C.muted);
    return svg(b);
  }
  const col = profile.dpiColor || C.text;
  b += '<rect x="44" y="46" width="56" height="58" rx="12" fill="none" stroke="' + col + '" stroke-width="4"/>';
  b += bigNumber(94, String(profile.num), '', C.text, 46);
  let line = '';
  if (detail === 'dpi' && profile.dpi) line = profile.dpi + ' DPI';
  else if (detail === 'polling') {
    const hz = m && m.conn === 'receiver' ? profile.wirelessPolling : profile.polling;
    if (hz) line = hz + ' Hz';
  }
  if (line) b += text(72, 134, 22, esc(line), C.text);
  return svg(b);
}

function setupKey(m, status) {
  let b = '';
  const ok = m && m.present;
  const col = status === 'searching' ? C.icon : ok ? C.green : C.red;
  b += mouseIcon(56, 10, 32, 52, ok ? C.icon : C.muted);
  b += '<circle cx="98" cy="54" r="9" fill="' + col + '"/>';
  let l1, l2;
  if (status === 'searching') { l1 = 'Searching'; l2 = 'for mice'; }
  else if (status === 'error') { l1 = 'Helper'; l2 = 'not running'; }
  else if (!m) { l1 = 'No mouse'; l2 = 'found'; }
  else {
    l1 = m.short;
    l2 = m.present ? (CONN_LABEL[m.conn] || 'Connected') : 'Not found';
  }
  const f1 = fitSize(l1, [22, 21, 20, 19], 136, true), f2 = fitSize(l2, [20, 19], 136);
  b += text(72, 98, f1.size, esc(f1.text), C.text, { weight: 600 });
  b += text(72, 126, f2.size, esc(f2.text), status === 'error' || (m && !m.present) ? C.red : C.muted);
  return svg(b);
}

module.exports = {
  fitSize, batteryKey, connectionKey, profileKey, setupKey, dataUrl, esc, fit, textWidth,
  lowLimit, levelColor, statusLabel, levelIsOld, C, S, GAP,
};
