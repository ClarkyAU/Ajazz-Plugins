'use strict';
// Draws each action. A renderer receives a group of w x h keys and returns SVG
// content in group coordinates; index.js slices it per key. Each key is 144 x 144
// and neighbouring keys are PITCH apart: the 28 px between them stands for the
// physical gap, so graphs line up across keys. Text always stays inside one key.
//
// Sizes follow the Now Playing plugin, which reads well on the real keys:
// big numbers ~50 px, labels 22 px, small lines 20 px. Nothing smaller than 19 px.

const S = require('./svg');
const { buildGroups } = require('./layout');
const { C, text, valueUnit, rich, fit, fitSize, rect, circle, bar, spark, icon, header } = S;

const K = 144;
const GAP = 28;
const PITCH = K + GAP;
const BIG = 52;   // main number
const SUB = 20;   // small line under a number

function groupSize(w, h) { return { W: w * K + (w - 1) * GAP, H: h * K + (h - 1) * GAP }; }

function cells(w, h) {
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ dx, dy, x: dx * PITCH, y: dy * PITCH });
  return out;
}

function wrap(str, size, width, maxLines, bold) {
  const words = String(str || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i];
    const t = cur ? cur + ' ' + word : word;
    if (S.textWidth(t, size, bold) <= width) { cur = t; continue; }
    if (cur) lines.push(cur);
    if (lines.length >= maxLines) { cur = ''; break; }
    cur = S.textWidth(word, size, bold) > width ? fit(word, size, width, bold) : word;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (i < words.length && lines.length) {
    lines[lines.length - 1] = fit(lines[lines.length - 1] + ' ' + words.slice(i).join(' ') + ' …', size, width, bold);
  }
  return lines;
}

function lines(x, y, list, size, opts, lh) {
  return list.map((l, i) => text(x, y + i * (lh || Math.round(size * 1.2)), l, { size, ...opts })).join('');
}

// big number (+ unit, which may be '%') centred in a key
function bigValue(x, y, value, unit, { fill = C.text, size = BIG, unitSize, maxW = 128 } = {}) {
  const u = unit || '';
  unitSize = unitSize || Math.round(size * 0.5);
  let s = size;
  while (s > 26 && S.richWidth([{ t: String(value), size: s, weight: 700 }, u ? { t: u, size: Math.round(s * unitSize / size), gap: 3 } : { t: '' }]) > maxW) s -= 2;
  const us = Math.round(s * unitSize / size);
  return valueUnit(x, y, value, u, { size: s, unitSize: us, fill, anchor: 'middle' });
}

// ---------------------------------------------------------------- status
function statusKeys(w, h, status, statusText) {
  const icons = { unconfigured: 'sliders', auth: 'lock', error: 'plug', connecting: 'refresh', waiting: 'refresh' };
  const colors = { unconfigured: C.brand, auth: C.bad, error: C.warn, connecting: C.brand, waiting: C.brand };
  const col = colors[status] || C.brand;
  let out = '';
  for (const c of cells(w, h)) {
    if (c.dx === 0 && c.dy === 0) {
      out += icon(icons[status] || 'server', c.x + 48, c.y + 10, 48, col, 2.2);
      const ls = wrap(statusText || '', 21, 134, 3, true);
      const y0 = ls.length >= 3 ? 86 : 98;
      out += lines(c.x + 72, c.y + y0, ls, 21, { fill: C.text, weight: 700, anchor: 'middle' }, 24);
    } else {
      out += icon('server', c.x + 52, c.y + 52, 40, C.track, 2);
    }
  }
  return out;
}

// ---------------------------------------------------------------- system
function pctText(v) { return v == null ? '--' : String(Math.round(v)); }

function sysCell(kind, x, y, d, g, compact) {
  const info = d.info || {};
  const memPct = d.mem ? (d.mem.used / d.mem.total) * 100 : null;
  let out = '';
  switch (kind) {
    case 'cpu': {
      const frac = d.cpu == null ? 0 : d.cpu / 100;
      const col = S.usageColor(frac, C.cpu);
      if (compact) {
        const t = S.fmtTemp(d.cpuTemp, g.tempUnit);
        out += header(x, y, 'CPU', 'cpu', C.cpu, t ? t.value + '°' : '', S.tempColor(d.cpuTemp));
        out += bigValue(x + 72, y + 90, pctText(d.cpu), '%', { fill: col === C.cpu ? C.text : col });
        out += bar(x + 14, y + 102, 116, 10, frac, col);
        out += rich(x + 72, y + 136, [{ t: 'RAM ', fill: C.muted }, { t: pctText(memPct), weight: 700 }, { t: '%', fill: C.muted }], { anchor: 'middle', size: SUB });
      } else {
        out += header(x, y, 'CPU', 'cpu', C.cpu);
        out += bigValue(x + 72, y + 98, pctText(d.cpu), '%', { fill: col === C.cpu ? C.text : col });
        out += bar(x + 14, y + 116, 116, 14, frac, col);
      }
      break;
    }
    case 'ram': {
      const frac = memPct == null ? 0 : memPct / 100;
      const col = S.usageColor(frac, C.ram);
      out += header(x, y, 'RAM', 'ram', C.ram);
      out += bigValue(x + 72, y + 98, pctText(memPct), '%', { fill: col === C.ram ? C.text : col });
      out += bar(x + 14, y + 116, 116, 14, frac, col);
      break;
    }
    case 'temp': {
      const t = S.fmtTemp(d.cpuTemp, g.tempUnit);
      const col = S.tempColor(d.cpuTemp);
      out += header(x, y, 'Temp', 'temp', col);
      out += bigValue(x + 72, y + 98, t ? t.value : '--', t ? t.unit : '', { fill: d.cpuTemp >= 68 ? col : C.text });
      out += bar(x + 14, y + 116, 116, 14, d.cpuTemp == null ? 0 : Math.min(1, d.cpuTemp / 100), col);
      break;
    }
    case 'arc': {
      const a = d.arc || {};
      const sz = S.fmtBytes(a.size || 0);
      out += header(x, y, 'ZFS ARC', 'layers', C.arc);
      out += bigValue(x + 72, y + 92, sz.value, '', {});
      out += text(x + 72, y + 128, `${sz.unit} cache`, { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
      break;
    }
    case 'uptime': {
      const u = S.fmtUptime(info.uptime_seconds != null ? info.uptime_seconds + (Date.now() - (d.infoAt || Date.now())) / 1000 : 0);
      out += header(x, y, 'Uptime', 'clock', C.brand);
      const unit = u.unit === 'days' || u.unit === 'day' ? 'd' : u.unit === 'min' ? 'm' : u.unit;
      out += bigValue(x + 72, y + 92, u.value, unit, {});
      if (u.extra) out += text(x + 72, y + 128, u.extra, { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
      break;
    }
    default: break;
  }
  return out;
}

// ---------------------------------------------------------------- roles
// Each key in a group has a role (what it shows). A key's own "Show" setting wins;
// "Automatic" keys get a role from their position. Neighbouring "graph" keys are
// merged into rectangles and draw one graph across them.

const SHOW = {
  system: ['compact', 'cpu', 'ram', 'temp', 'arc', 'uptime', 'graph'],
  network: ['compact', 'down', 'up', 'port', 'graph'],
  storage: ['usage', 'free', 'health', 'summary'],
  alerts: ['count', 'alert'],
};

// grp.cells: [{ context, dx, dy, settings }] ; autoRole(cell, grp) -> role
function assignRoles(action, grp, autoRole) {
  const cellsSorted = [...grp.cells].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  for (const c of cellsSorted) {
    const want = c.settings && c.settings.show;
    c.role = want && SHOW[action].includes(want) ? want : autoRole(c, grp);
    c.x = c.dx * PITCH;
    c.y = c.dy * PITCH;
  }
  return cellsSorted;
}

// Merge neighbouring graph cells into rectangles.
function graphRegions(cells) {
  const g = cells.filter((c) => c.role === 'graph');
  const regions = buildGroups(g.map((c) => ({ context: c.context, device: 'g', col: c.dx, row: c.dy, joinKey: 'graph' })));
  const byCtx = new Map(g.map((c) => [c.context, c]));
  return regions.map((r) => {
    const first = byCtx.get(r.anchor);
    return { dx: first.dx, dy: first.dy, w: r.w, h: r.h, x: first.dx * PITCH, y: first.dy * PITCH, cell: first, ...groupSize(r.w, r.h) };
  });
}

function blankCell(x, y, iconName) { return icon(iconName, x + 52, y + 52, 40, C.track, 2); }

// ---------------------------------------------------------------- system
function renderSystem(grp, d) {
  const { w, h } = grp;
  const order = ['cpu', 'ram', 'temp', 'arc', 'uptime'];
  const cells = assignRoles('system', grp, (c) => {
    if (w === 1 && h === 1) return 'compact';
    if (w === 1 || h === 1) return order[(c.dx + c.dy) % order.length];
    return c.dy === 0 ? order[c.dx % order.length] : 'graph';
  });
  let out = '';
  for (const c of cells) {
    if (c.role === 'graph') continue;
    out += sysCell(c.role === 'compact' ? 'cpu' : c.role, c.x, c.y, d, c.settings || {}, c.role === 'compact');
  }
  for (const r of graphRegions(cells)) {
    const memPct = d.mem ? (d.mem.used / d.mem.total) * 100 : null;
    let top;
    if (r.w >= 2) {
      out += legendItem(r.x, r.y, 'CPU', C.cpu, pctText(d.cpu), true);
      out += legendItem(r.x + PITCH, r.y, 'RAM', C.ram, pctText(memPct), true);
      top = r.y + 48;
    } else {
      out += legendItem(r.x, r.y, 'CPU', C.cpu, pctText(d.cpu), true);
      out += legendItem(r.x, r.y + 30, 'RAM', C.ram, pctText(memPct), true);
      top = r.y + 76;
    }
    const bottom = r.y + r.H - 10;
    out += graphArea(r.x + 10, top, r.W - 20, Math.max(20, bottom - top), [
      [padHist(d.hist.ram), C.ram, 0.10],
      [padHist(d.hist.cpu), C.cpu, 0.25],
    ], 100);
  }
  return out;
}

function legendItem(x, y, label, col, val, isPct) {
  return circle(x + 18, y + 26, 7, col) +
    rich(x + 32, y + 34, [{ t: label + ' ', fill: C.muted }, { t: val, weight: 700 }, isPct ? { t: '%', fill: C.muted } : null].filter(Boolean), { size: 22, weight: 700 });
}

function graphArea(x, y, w, h, series, max) {
  let out = rect(x, y + h, w, 2, C.line);
  out += rect(x, y + h / 2, w, 1, C.track);
  for (const [vals, col, fo] of series) out += spark(x, y, w, h, vals, col, { max, fillOpacity: fo, sw: 3.5 });
  return out;
}

function padHist(arr) {
  if (!arr || arr.length === 0) return [];
  if (arr.length === 1) return [arr[0], arr[0]];
  return arr;
}

// ---------------------------------------------------------------- network
function netSeries(d, iface) {
  const key = iface && d.ifaces[iface] ? iface : '*';
  const down = d.hist.down[key] || [];
  const up = d.hist.up[key] || [];
  let cur;
  if (key === '*') {
    cur = { rx: 0, tx: 0 };
    for (const v of Object.values(d.ifaces)) { cur.rx += v.rx; cur.tx += v.tx; }
  } else cur = d.ifaces[key];
  return { key, down, up, cur: cur || { rx: 0, tx: 0 } };
}

function rateCell(x, y, label, iconName, col, bytes, bits) {
  const r = S.fmtRate(bytes, bits);
  let out = header(x, y, label, iconName, col);
  out += bigValue(x + 72, y + 92, r.value, '', {});
  out += text(x + 72, y + 128, r.unit, { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
  return out;
}

function portCell(x, y, s, d) {
  const label = s.key === '*' ? 'All ports' : s.key;
  let out = header(x, y, 'Port', 'net', C.brand);
  const ns = fitSize(label, 28, 128, true, 19);
  out += text(x + 72, y + 86, fit(label, ns, 130, true), { size: ns, weight: 700, anchor: 'middle' });
  const ifs = s.key === '*' ? Object.values(d.ifaces) : [d.ifaces[s.key]].filter(Boolean);
  const up = ifs.some((i) => i.up);
  const speed = Math.max(0, ...ifs.map((i) => i.speed || 0));
  const sp = speed >= 1000 ? `${Math.round(speed / 100) / 10} Gb/s` : speed > 0 ? `${speed} Mb/s` : '';
  const txt = up ? (sp || 'Link up') : 'Link down';
  const tw = S.textWidth(txt, SUB, true);
  out += circle(x + 72 - tw / 2 - 6, y + 121, 5.5, up ? C.good : C.bad);
  out += text(x + 72 + 7, y + 128, txt, { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
  return out;
}

function netGraph(x, y, w, h, s) {
  const peak = Math.max(1, ...s.down, ...s.up);
  return spark(x, y, w, h, padHist(s.down), C.down, { max: peak * 1.1, sw: 3.5, fillOpacity: 0.25 }) +
    spark(x, y, w, h, padHist(s.up), C.up, { max: peak * 1.1, sw: 3, fillOpacity: 0.08 });
}

function netCompact(x, y, s, bits) {
  const rx = S.fmtRate(s.cur.rx, bits), tx = S.fmtRate(s.cur.tx, bits);
  const row = (yy, ic, col, r) => icon(ic, x + 4, y + yy - 26, 28, col, 3.2) +
    rich(x + 36, y + yy, [{ t: r.value, size: fitSize(r.value, 36, 62, true, 24), weight: 700 }, { t: r.unit, size: 17, fill: C.muted, gap: 3 }], { size: 36 });
  return row(42, 'down', C.down, rx) + row(88, 'up', C.up, tx) + netGraph(x + 6, y + 100, 132, 38, s);
}

function renderNetwork(grp, d) {
  const { w, h } = grp;
  const cells = assignRoles('network', grp, (c) => {
    if (w === 1 && h === 1) return 'compact';
    if (w === 1) return ['down', 'up'][c.dy] || 'graph';
    if (c.dy === 0) return ['down', 'up'][c.dx] || 'graph';
    return 'graph';
  });
  let out = '';
  for (const c of cells) {
    const st = c.settings || {};
    const s = netSeries(d, st.iface);
    const bits = st.netUnits !== 'bytes';
    if (c.role === 'compact') out += netCompact(c.x, c.y, s, bits);
    else if (c.role === 'down') out += rateCell(c.x, c.y, 'Down', 'down', C.down, s.cur.rx, bits);
    else if (c.role === 'up') out += rateCell(c.x, c.y, 'Up', 'up', C.up, s.cur.tx, bits);
    else if (c.role === 'port') out += portCell(c.x, c.y, s, d);
  }
  for (const r of graphRegions(cells)) {
    const s = netSeries(d, (r.cell.settings || {}).iface);
    out += rect(r.x + 8, r.y + r.H - 12, r.W - 16, 2, C.line);
    out += netGraph(r.x + 8, r.y + 14, r.W - 16, r.H - 28, s);
  }
  return out;
}

// ---------------------------------------------------------------- storage
function poolColor(p) {
  if (!p.healthy || p.status !== 'ONLINE') return /DEGRADED/.test(p.status) ? C.warn : C.bad;
  return null;
}

function scanText(p) {
  if (!p.scan || p.scan.state !== 'SCANNING') return null;
  return [{ t: p.scan.function === 'RESILVER' ? 'Resilver ' : 'Scrub ' }, { t: String(Math.round(p.scan.percentage || 0)), weight: 700 }, { t: '%' }];
}

function poolCompact(p, x, y) {
  const frac = p.size ? p.allocated / p.size : 0;
  const hc = poolColor(p);
  const col = hc || S.usageColor(frac, C.good);
  let out = header(x, y, p.name, 'db', col);
  out += bigValue(x + 72, y + 88, String(Math.round(frac * 100)), '%', { fill: hc || (col === C.good ? C.text : col) });
  out += bar(x + 14, y + 100, 116, 12, frac, col);
  const scan = scanText(p);
  if (scan) out += rich(x + 72, y + 136, scan, { anchor: 'middle', size: SUB, fill: C.warn });
  else if (hc) out += text(x + 72, y + 136, p.status, { size: SUB, fill: hc, weight: 700, anchor: 'middle' });
  else {
    const free = S.fmtBytes(p.free);
    out += text(x + 72, y + 136, `${free.value} ${free.unit} free`, { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
  }
  return out;
}

function poolDetail(p, x, y) {
  const free = S.fmtBytes(p.free), size = S.fmtBytes(p.size);
  const lbl = `${p.name} free`;
  let out = header(x, y, S.textWidth(lbl.toUpperCase(), S.LABEL, true) <= 124 ? lbl : 'Free', null, C.muted);
  out += bigValue(x + 72, y + 92, free.value, '', {});
  out += text(x + 72, y + 128, `${free.unit} of ${size.value} ${size.unit}`, { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
  return out;
}

function poolHealth(p, x, y) {
  const hc = poolColor(p);
  const col = hc || C.good;
  let out = header(x, y, p.name, null, C.muted);
  out += icon(hc ? 'warn' : 'check', x + 44, y + 42, 56, col, 2.4);
  const scan = scanText(p);
  if (scan) out += rich(x + 72, y + 132, scan, { anchor: 'middle', size: SUB, fill: C.warn });
  else out += text(x + 72, y + 132, hc ? p.status : 'Healthy', { size: 21, fill: col, weight: 700, anchor: 'middle' });
  return out;
}

function poolSummary(pools, x, y) {
  const total = pools.reduce((a, p) => a + p.size, 0);
  const free = pools.reduce((a, p) => a + p.free, 0);
  const bad = pools.filter((p) => poolColor(p));
  const f = S.fmtBytes(free);
  let out = header(x, y, `${pools.length} pool${pools.length === 1 ? '' : 's'}`, 'db', bad.length ? C.warn : C.good);
  out += bigValue(x + 72, y + 88, f.value, '', {});
  out += bar(x + 14, y + 100, 116, 12, total ? 1 - free / total : 0, C.good);
  out += text(x + 72, y + 136, bad.length ? `${bad.length} problem${bad.length === 1 ? '' : 's'}` : `${f.unit} free`, { size: SUB, fill: bad.length ? C.warn : C.muted, weight: 600, anchor: 'middle' });
  return out;
}

function renderStorage(grp, d) {
  const pools = d.pools;
  const find = (name) => pools.find((p) => p.name === name);
  const anySet = grp.cells.some((c) => c.settings && c.settings.pool);
  // Automatic: with no pool chosen anywhere, one pool per key then a summary.
  // With a pool chosen, each row shows usage | free | health for that pool.
  const cells = assignRoles('storage', grp, (c) => {
    if (anySet) return ['usage', 'free', 'health'][c.dx] || 'none';
    const i = c.dy * grp.w + c.dx;
    if (i < pools.length) return 'usage';
    if (pools.length === 1) return ['usage', 'free', 'health'][i] || 'none';
    return i === pools.length ? 'summary' : 'none';
  });
  let out = '';
  let autoIdx = 0;
  const rowPool = new Map();
  const groupPool = (grp.cells.find((c) => c.settings && c.settings.pool && find(c.settings.pool)) || {}).settings;
  for (const c of cells) {
    const want = c.settings && c.settings.pool;
    let p = want ? find(want) : null;
    if (want && !p) { out += statusKeys(1, 1, 'waiting', `Pool ${want} not found`).replace(/^/, `<g transform="translate(${c.x} ${c.y})">`) + '</g>'; continue; }
    if (!p && c.role === 'usage') p = (anySet ? rowPool.get(c.dy) || (groupPool && find(groupPool.pool)) : pools[autoIdx++]) || null;
    if (!p) p = rowPool.get(c.dy) || (groupPool && find(groupPool.pool)) || pools[0];
    if (p) rowPool.set(c.dy, rowPool.get(c.dy) || p);
    if (!pools.length) { out += c === cells[0] ? statusKeys(1, 1, 'waiting', 'No pools') : ''; continue; }
    if (c.role === 'usage') out += poolCompact(p, c.x, c.y);
    else if (c.role === 'free') out += poolDetail(p, c.x, c.y);
    else if (c.role === 'health') out += poolHealth(p, c.x, c.y);
    else if (c.role === 'summary') out += poolSummary(pools, c.x, c.y);
    else out += blankCell(c.x, c.y, 'db');
  }
  return out;
}

// ---------------------------------------------------------------- alerts
const LEVEL = {
  CRITICAL: ['Critical', C.bad], ALERT: ['Critical', C.bad], EMERGENCY: ['Critical', C.bad], ERROR: ['Error', C.bad],
  WARNING: ['Warning', C.warn], NOTICE: ['Notice', C.info], INFO: ['Info', C.info],
};

function alertSummary(alerts, x, y) {
  let out = '';
  if (!alerts.length) {
    out += header(x, y, 'Alerts', 'bell', C.good);
    out += icon('check', x + 42, y + 44, 60, C.good, 2.4);
    return out;
  }
  const top = LEVEL[alerts[0].level] || LEVEL.INFO;
  out += header(x, y, 'Alerts', 'bell', top[1]);
  out += text(x + 72, y + 106, String(alerts.length), { size: alerts.length > 99 ? 56 : 70, fill: top[1], weight: 700, anchor: 'middle' });
  const nTop = alerts.filter((a) => a.rank === alerts[0].rank).length;
  out += text(x + 72, y + 136, `${nTop} ${top[0].toLowerCase()}`, { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
  return out;
}

function alertCell(a, x, y, more) {
  const lv = LEVEL[a.level] || LEVEL.INFO;
  let out = rect(x, y + 10, 5, 124, lv[1], { rx: 2.5 });
  out += text(x + 14, y + 32, lv[0].toUpperCase(), { size: 21, fill: lv[1], weight: 700 });
  const ls = wrap(a.text, 19, 124, more ? 3 : 4, true);
  out += lines(x + 14, y + 60, ls, 19, { fill: C.text, weight: 600 }, 23);
  if (more) out += text(x + 136, y + 138, `+${more} more`, { size: 19, fill: C.muted, weight: 700, anchor: 'end' });
  return out;
}

function renderAlerts(grp, d) {
  const alerts = d.alerts;
  let first = true;
  const cells = assignRoles('alerts', grp, () => { const r = first ? 'count' : 'alert'; first = false; return r; });
  const alertCells = cells.filter((c) => c.role === 'alert');
  let out = '';
  let i = 0;
  for (const c of cells) {
    if (c.role === 'count') { out += alertSummary(alerts, c.x, c.y); continue; }
    const idx = i++;
    const isLast = c === alertCells[alertCells.length - 1];
    if (idx < alerts.length) {
      const more = isLast ? alerts.length - idx - 1 : 0;
      out += alertCell(alerts[idx], c.x, c.y, more > 0 ? more : 0);
    } else if (idx === 0) {
      out += text(c.x + 72, c.y + 68, 'All', { size: 26, fill: C.good, weight: 700, anchor: 'middle' });
      out += text(c.x + 72, c.y + 98, 'clear', { size: 26, fill: C.good, weight: 700, anchor: 'middle' });
    } else {
      out += blankCell(c.x, c.y, 'bell');
    }
  }
  return out;
}

// ---------------------------------------------------------------- setup key
function setupCell(status, statusText, info, hasHost) {
  const colors = { connected: C.good, connecting: C.brand, error: C.warn, auth: C.bad, unconfigured: C.brand };
  const col = colors[status] || C.brand;
  let out = icon(status === 'connected' ? 'server' : status === 'unconfigured' ? 'sliders' : status === 'auth' ? 'lock' : 'plug', 46, 8, 52, col, 2.2);
  if (status === 'connected') {
    out += circle(104, 16, 8, C.good, { stroke: C.bg, sw: 3 });
    const name = (info && info.hostname) || 'TrueNAS';
    const ns = fitSize(name, 24, 134, true, 18);
    out += text(72, 98, fit(name, ns, 136, true), { size: ns, weight: 700, anchor: 'middle' });
    const ver = String((info && info.version) || '').replace(/^TrueNAS-?(SCALE-)?/i, '');
    out += text(72, 128, fit(ver || 'Connected', SUB, 134, true), { size: SUB, fill: C.muted, weight: 600, anchor: 'middle' });
  } else {
    const msg = status === 'unconfigured' ? (hasHost ? 'Add API key' : 'Set up here') : statusText;
    const ls = wrap(msg || '', 21, 134, 2, true);
    out += lines(72, ls.length > 1 ? 98 : 110, ls, 21, { fill: C.text, weight: 700, anchor: 'middle' }, 25);
  }
  return out;
}

// ---------------------------------------------------------------- apps
const STATE = {
  RUNNING: ['Running', C.good], STOPPED: ['Stopped', C.dim], DEPLOYING: ['Starting', C.warn],
  STOPPING: ['Stopping', C.warn], CRASHED: ['Crashed', C.bad],
};

function appCell(app, x, y, iconData, transient) {
  let out = '';
  if (!app) {
    out += icon('box', x + 44, y + 16, 56, C.dim, 2);
    out += text(x + 72, y + 112, 'No app', { size: 22, fill: C.muted, weight: 700, anchor: 'middle' });
    return out;
  }
  const accent = (iconData && iconData.color) || C.brand;
  const st = STATE[app.state] || [app.state || 'Unknown', C.dim];
  const running = app.state === 'RUNNING';
  out += rect(x + 32, y + 4, 80, 80, accent, { rx: 20, opacity: running ? 0.22 : 0.1 });
  if (!iconData || !iconData.png) {
    const letter = (app.title || app.name || '?').trim().charAt(0).toUpperCase();
    out += text(x + 72, y + 62, letter, { size: 46, fill: accent, weight: 700, anchor: 'middle', opacity: running ? 1 : 0.5 });
  } else {
    out += `<image x="${x + 40}" y="${y + 12}" width="64" height="64" xlink:href="data:image/png;base64,${iconData.png}"/>`;
    if (!running) out += rect(x + 32, y + 4, 80, 80, C.bg, { rx: 20, opacity: 0.55 });
  }
  if (app.upgrade) out += circle(x + 110, y + 8, 8, C.warn, { stroke: C.bg, sw: 3 });
  const name = app.title || app.name;
  const ns = fitSize(name, 22, 134, true, 17);
  out += text(x + 72, y + 108, fit(name, ns, 136, true), { size: ns, fill: running ? C.text : C.muted, weight: 700, anchor: 'middle' });
  let label = st[0], col = st[1];
  if (transient === 'confirm') { label = 'Stop?'; col = C.bad; }
  else if (transient === 'starting') { label = 'Starting'; col = C.warn; }
  else if (transient === 'stopping') { label = 'Stopping'; col = C.warn; }
  else if (transient === 'failed') { label = 'Failed'; col = C.bad; }
  const lw = S.textWidth(label, SUB, true);
  out += circle(x + 72 - lw / 2 - 6, y + 130, 5.5, col);
  out += text(x + 72 + 7, y + 137, label, { size: SUB, fill: col === C.dim ? C.muted : col, weight: 700, anchor: 'middle' });
  return out;
}

module.exports = {
  K, GAP, PITCH, SHOW, cells, statusKeys, renderSystem, renderNetwork, renderStorage, renderAlerts, appCell, setupCell, wrap,
};
