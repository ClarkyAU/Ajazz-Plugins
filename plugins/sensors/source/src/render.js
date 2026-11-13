"use strict";
// Draws every key. A group is a rectangle of neighbouring keys of the same action;
// each key in it gets a role (what it shows), from its "Shows" setting or from its
// position. Neighbouring keys with the same spanning role (graph, cores) share one
// graphic. Text is always placed inside a single key.

const S = require("./svg");
const { buildGroups } = require("./layout");
const { C, text, rich, fit, fitSize, rect, circle, meter, spark, icon, header, textWidth } = S;

const K = 144;
const GAP = 28; // part of a key-width hidden under the gap between keys
const PITCH = K + GAP;
const BIG = 52;
const SUB = 20;

// What each key type can show. The first entry is used for a single key on its own.
const ACTIONS = {
  cpu: { shows: ["load", "temp", "clock", "power", "cores", "graph", "top"], order: ["load", "temp", "clock", "power", "top"], span: ["graph", "cores"] },
  memory: { shows: ["used", "amount", "avail", "commit", "graph", "top"], order: ["used", "amount", "commit", "top"], span: ["graph"] },
  gpu: { shows: ["load", "temp", "hot", "vram", "power", "fan", "clock", "graph"], order: ["load", "temp", "vram", "power", "clock", "fan", "hot"], span: ["graph"] },
  disk: { shows: ["activity", "read", "write", "rw", "space", "free", "graph"], order: ["activity", "read", "write", "space", "free"], span: ["graph"] },
  network: { shows: ["both", "down", "up", "link", "ip", "graph"], order: ["down", "up", "link", "ip"], span: ["graph"] },
  system: { shows: ["summary", "uptime", "battery", "procs", "graph"], order: ["summary", "uptime", "battery", "procs"], span: ["graph"] },
  sensor: { shows: ["value", "graph"], order: ["value"], span: ["graph"] },
  setup: { shows: ["status"], order: ["status"], span: [] },
};

function groupSize(w, h) {
  return { W: w * K + (w - 1) * GAP, H: h * K + (h - 1) * GAP };
}

const fin = (v) => v != null && Number.isFinite(Number(v));
const pct = (v) => (fin(v) ? String(Math.round(v)) : "--");

// ------------------------------------------------------------------ building blocks
function bigValue(x, y, value, unit, { fill = C.text, size = BIG, unitSize, maxW = 130 } = {}) {
  const u = unit || "";
  const ratio = (unitSize || Math.round(size * 0.5)) / size;
  let s = size;
  const segs = (sz) => [{ t: String(value), size: sz, weight: 700 }, u ? { t: u, size: Math.max(19, Math.round(sz * ratio)), gap: 3, weight: 600 } : null];
  while (s > 30 && S.richWidth(segs(s)) > maxW) s -= 2;
  const parts = segs(s);
  if (u && u !== "%") {
    // One text element with a tspan for the unit: the renderer measures it, so the
    // gap stays the same whatever the font.
    const us = parts[1].size;
    return `<text x="${S.r(x)}" y="${S.r(y)}" font-family="${S.FONT}" font-size="${s}" font-weight="700" fill="${fill}" text-anchor="middle">${S.esc(value)}<tspan dx="3" font-size="${us}" font-weight="600" fill="${C.muted}">${S.esc(u)}</tspan></text>`;
  }
  if (parts[1]) parts[1].fill = C.muted;
  return rich(x, y, parts, { anchor: "middle", fill });
}

// header + big number + (meter | sub text | mini graph)
function stat(x, y, o) {
  let out = header(x, y, o.label, o.icon, o.accent, o.right, o.rightColor);
  const hasMeter = o.meter != null;
  const hasSub = !!o.sub;
  const hasSpark = o.spark && o.spark.length > 1;
  let vy = 98;
  if (hasMeter && hasSub) vy = 84;
  else if (hasSub && hasSpark) vy = 84;
  else if (hasSub) vy = 92;
  else if (hasSpark) vy = 92;
  out += bigValue(x + 72, y + vy, o.value, o.unit, { fill: o.valueColor || C.text });
  if (hasMeter) {
    const my = hasSub ? y + 96 : y + 112;
    out += meter(x + 14, my, 116, hasSub ? 11 : 15, o.meter, o.meterColor || o.accent);
  }
  if (hasSub) out += text(x + 72, y + (hasSpark ? 112 : 132), fit(o.sub, SUB, 134, true), { size: SUB, fill: o.subColor || C.muted, weight: 600, anchor: "middle" });
  if (hasSpark && !hasMeter) {
    const top = hasSub ? y + 118 : y + 108;
    out += spark(x + 10, top, 124, y + 136 - top, o.spark, o.sparkColor || o.accent, { max: o.sparkMax, fillOpacity: 0.22, sw: 2.5 });
  }
  return out;
}

function wrapWords(str, size, width, maxLines, bold) {
  const words = String(str || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  let i = 0;
  for (; i < words.length; i++) {
    const t = cur ? cur + " " + words[i] : words[i];
    if (textWidth(t, size, bold) <= width) {
      cur = t;
      continue;
    }
    if (cur) lines.push(cur);
    if (lines.length >= maxLines) {
      cur = "";
      break;
    }
    cur = textWidth(words[i], size, bold) > width ? fit(words[i], size, width, bold) : words[i];
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (i < words.length && lines.length) lines[lines.length - 1] = fit(lines[lines.length - 1] + " " + words.slice(i).join(" "), size, width, bold);
  return lines;
}

// A key with an icon and a short message (no data, no sensor, ...).
function message(x, y, iconName, color, title, sub) {
  let out = icon(iconName, x + 50, y + 14, 44, color, 2.2);
  const lines = wrapWords(title, 21, 132, sub ? 1 : 2, true);
  const y0 = sub ? 88 : lines.length > 1 ? 86 : 98;
  lines.forEach((l, i) => (out += text(x + 72, y + y0 + i * 25, l, { size: 21, weight: 700, anchor: "middle" })));
  if (sub) out += text(x + 72, y + 118, fit(sub, SUB, 134, true), { size: SUB, fill: C.muted, weight: 600, anchor: "middle" });
  return out;
}

function statusKeys(w, h, kind, msg, sub) {
  const colors = { starting: C.cpu, error: C.warn };
  const icons = { starting: "refresh", error: "warn" };
  let out = "";
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      const x = dx * PITCH;
      const y = dy * PITCH;
      if (dx === 0 && dy === 0) out += message(x, y, icons[kind] || "pulse", colors[kind] || C.cpu, msg, sub);
      else out += icon("pulse", x + 50, y + 50, 44, C.track, 2.2);
    }
  return out;
}

// Downsample to at most n points (bucket averages, NaN-aware).
function resample(values, n) {
  if (values.length <= n) return values;
  const out = [];
  const step = values.length / n;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.floor(i * step); k < Math.floor((i + 1) * step); k++) {
      const v = values[k];
      if (Number.isFinite(v)) {
        sum += v;
        cnt++;
      }
    }
    out.push(cnt ? sum / cnt : NaN);
  }
  return out;
}

function graphTime(settings) {
  const t = Number(settings && settings.graphTime);
  return [60, 120, 300, 600].includes(t) ? t : 120;
}

function series(ctx, key, settings, width) {
  const secs = graphTime(settings);
  return resample(ctx.store.series(key, secs), Math.max(12, Math.round(width / 4)));
}

function sparkFor(ctx, key) {
  return resample(ctx.store.series(key, 60), 30);
}

function tempUnit(settings) {
  return settings && settings.tempUnit === "F" ? "F" : "C";
}

// ------------------------------------------------------------------ CPU
function cpuCell(role, x, y, ctx, st) {
  const s = ctx.store;
  const cpu = s.cur.cpu || {};
  const t = s.cpuTemp;
  const tf = t ? S.fmtTemp(t.c, tempUnit(st)) : null;
  switch (role) {
    case "load": {
      const f = fin(cpu.load) ? cpu.load / 100 : 0;
      const col = S.usageColor(f, C.cpu);
      return stat(x, y, { label: "CPU", icon: "cpu", accent: C.cpu, right: tf ? tf.short : "", rightColor: t ? S.tempColor(t.c) : C.muted, value: pct(cpu.load), unit: "%", valueColor: col === C.cpu ? C.text : col, meter: f, meterColor: col });
    }
    case "temp": {
      if (!t) return needSetup(x, y, "thermo", ctx);
      return stat(x, y, { label: "TEMP", icon: "cpu", accent: C.cpu, value: tf.value, unit: tf.unit, valueColor: t.c >= 80 ? S.tempColor(t.c) : C.text, meter: t.c / 100, meterColor: S.tempColor(t.c) });
    }
    case "clock": {
      const m = S.fmtMhz(cpu.mhz);
      if (!m) return message(x, y, "gauge", C.dim, "No clock", "speed yet");
      const base = S.fmtMhz(s.info && s.info.cpu && s.info.cpu.baseMhz);
      return stat(x, y, { label: "CLOCK", icon: "cpu", accent: C.cpu, value: m.value, unit: m.unit, sub: base ? `Base ${Number(base.value).toFixed(1)} ${base.unit}` : "", spark: sparkFor(ctx, "cpu"), sparkMax: 100 });
    }
    case "power": {
      const p = s.cpuPower;
      if (!p) return needSetup(x, y, "bolt", ctx);
      return stat(x, y, { label: "POWER", icon: "cpu", accent: C.power, value: String(Math.round(p.w)), unit: "W", spark: sparkFor(ctx, "cpuPower"), sparkColor: C.power });
    }
    case "top":
      return topCell(x, y, ctx, "cpu");
    default:
      return "";
  }
}

const APP_NAMES = {
  msedge: "Edge", chrome: "Chrome", firefox: "Firefox", explorer: "Explorer", svchost: "Services", dwm: "Desktop", MsMpEng: "Defender",
  System: "System", Registry: "Registry", "Memory Compression": "Memory comp.", steam: "Steam", steamwebhelper: "Steam", discord: "Discord",
  Code: "VS Code", spotify: "Spotify", Spotify: "Spotify", obs64: "OBS", powershell: "PowerShell", node: "Node", Teams: "Teams", "ms-teams": "Teams",
  OUTLOOK: "Outlook", WINWORD: "Word", EXCEL: "Excel", POWERPNT: "PowerPoint", vmmem: "Virtual machine", vmmemWSL: "WSL", Taskmgr: "Task Manager",
  SearchHost: "Search", StartMenuExperienceHost: "Start menu", audiodg: "Audio", csrss: "Windows", "Stream Dock AJAZZ Global": "Stream Dock",
};
function appName(n) {
  if (APP_NAMES[n]) return APP_NAMES[n];
  const lower = Object.keys(APP_NAMES).find((k) => k.toLowerCase() === String(n).toLowerCase());
  if (lower) return APP_NAMES[lower];
  return String(n).charAt(0).toUpperCase() + String(n).slice(1);
}

function topCell(x, y, ctx, kind) {
  const top = ctx.store.cur.top;
  const list = top && top[kind];
  const accent = kind === "cpu" ? C.cpu : C.mem;
  let out = header(x, y, "TOP", kind === "cpu" ? "cpu" : "ram", accent);
  if (!list || !list.length) return out + text(x + 72, y + 96, "Loading…", { size: 21, fill: C.muted, weight: 600, anchor: "middle" });
  const [name, v] = list[0];
  const label = appName(name);
  const ns = fitSize(label, 28, 130, true, 19);
  out += text(x + 72, y + 78, fit(label, ns, 132, true), { size: ns, weight: 700, anchor: "middle" });
  if (kind === "cpu") out += bigValue(x + 72, y + 128, String(Math.round(v)), "%", { size: 42 });
  else {
    const b = S.fmtBytes(v);
    out += bigValue(x + 72, y + 128, b.value, b.unit, { size: 42 });
  }
  return out;
}

// Per-core load bars spread over every key of the region.
function coresRegion(reg, ctx) {
  const cores = (ctx.store.cur.cpu && ctx.store.cur.cpu.cores) || [];
  const cells = [];
  for (let dy = 0; dy < reg.h; dy++) for (let dx = 0; dx < reg.w; dx++) cells.push({ x: reg.x + dx * PITCH, y: reg.y + dy * PITCH });
  if (!cores.length) return message(cells[0].x, cells[0].y, "bars", C.dim, "Loading…");
  // spread the cores evenly so no key is left empty
  const from = (k) => Math.floor((k * cores.length) / cells.length);
  let out = "";
  cells.forEach((c, k) => {
    const sub = cores.slice(from(k), from(k + 1));
    if (k === 0) {
      // right side: the busiest core
      out += header(c.x, c.y, "CORES", "cpu", C.cpu, [{ t: pct(Math.max(...cores)), weight: 700 }, { t: "%", fill: C.muted, size: 20 }], C.text);
    } else if (sub.length) {
      const a = from(k) + 1;
      const b = from(k) + sub.length;
      out += text(c.x + 12, c.y + 31, a === b ? `CORE ${a}` : `${a}–${b}`, { size: SUB, fill: C.muted, weight: 700 });
    }
    if (!sub.length) return;
    const n = sub.length;
    const gap = n > 24 ? 1.2 : n > 12 ? 2 : 4;
    const bw = (124 - gap * (n - 1)) / n;
    const top = c.y + 44;
    const hgt = 90;
    sub.forEach((v, i) => {
      const bx = c.x + 10 + i * (bw + gap);
      const f = Math.max(0, Math.min(1, (v || 0) / 100));
      out += rect(bx, top, bw, hgt, C.track, { rx: Math.min(2, bw / 2) });
      if (f > 0.01) out += rect(bx, top + hgt * (1 - f), bw, hgt * f, S.usageColor(f, C.cpu), { rx: Math.min(2, bw / 2) });
    });
  });
  return out;
}

// ------------------------------------------------------------------ memory
function memCell(role, x, y, ctx) {
  const m = ctx.store.cur.mem || {};
  if (!m.total) return message(x, y, "ram", C.dim, "Loading…");
  const used = m.total - m.avail;
  const f = used / m.total;
  const tot = S.fmtBytes(m.total, 0);
  switch (role) {
    case "used": {
      const col = S.usageColor(f, C.mem);
      return stat(x, y, { label: "RAM", icon: "ram", accent: C.mem, right: `${tot.value} ${tot.unit}`, value: pct(f * 100), unit: "%", valueColor: col === C.mem ? C.text : col, meter: f, meterColor: col });
    }
    case "amount": {
      const u = S.fmtBytes(used, used >= 10 * 1073741824 ? 1 : 2);
      return stat(x, y, { label: "USED", icon: "ram", accent: C.mem, value: u.value, unit: u.unit, sub: `of ${tot.value} ${tot.unit}`, meter: f, meterColor: S.usageColor(f, C.mem) });
    }
    case "avail": {
      const a = S.fmtBytes(m.avail, m.avail >= 10 * 1073741824 ? 1 : 2);
      return stat(x, y, { label: "FREE", icon: "ram", accent: C.mem, value: a.value, unit: a.unit, sub: `of ${tot.value} ${tot.unit}`, meter: 1 - f, meterColor: C.mem });
    }
    case "commit": {
      const cf = m.commitLimit ? m.commit / m.commitLimit : 0;
      const c1 = S.fmtBytes(m.commit, 0);
      const c2 = S.fmtBytes(m.commitLimit, 0);
      return stat(x, y, { label: "COMMIT", icon: "ram", accent: C.mem, value: pct(cf * 100), unit: "%", sub: `${c1.value} / ${c2.value} ${c2.unit}`, meter: cf, meterColor: S.usageColor(cf, C.mem) });
    }
    case "top":
      return topCell(x, y, ctx, "mem");
    default:
      return "";
  }
}

// ------------------------------------------------------------------ GPU
function gpuAccent(g) {
  return (g && C[g.vendor]) || C.gpu;
}

function gpuCell(role, x, y, ctx, st) {
  const s = ctx.store;
  const g = s.gpu(st.gpu);
  if (!g) return message(x, y, "gpu", C.dim, s.info ? "No GPU found" : "Loading…");
  const acc = gpuAccent(g);
  const label = s.gpuLabel(g);
  const unit = tempUnit(st);
  const tf = S.fmtTemp(g.temp, unit);
  const noSensor = (what) => message(x, y, "gpu", C.dim, `No ${what}`, "from this GPU");
  switch (role) {
    case "load": {
      const f = fin(g.util) ? g.util / 100 : 0;
      const col = S.usageColor(f, acc);
      return stat(x, y, { label, icon: "gpu", accent: acc, right: tf ? tf.short : "", rightColor: S.tempColor(g.temp, { warm: 75, hot: 90 }), value: pct(g.util), unit: "%", valueColor: col === acc ? C.text : col, meter: f, meterColor: col });
    }
    case "temp": {
      if (!tf) return noSensor("temperature");
      const col = S.tempColor(g.temp, { warm: 75, hot: 90 });
      return stat(x, y, { label: "TEMP", icon: "gpu", accent: acc, right: label === "iGPU" ? "iGPU" : "", value: tf.value, unit: tf.unit, valueColor: g.temp >= 83 ? col : C.text, meter: g.temp / 100, meterColor: col });
    }
    case "hot": {
      const hf = S.fmtTemp(g.hot, unit);
      if (!hf) return noSensor("hot spot");
      const col = S.tempColor(g.hot, { warm: 85, hot: 100 });
      return stat(x, y, { label: "HOT SPOT", icon: "gpu", accent: acc, value: hf.value, unit: hf.unit, valueColor: g.hot >= 95 ? col : C.text, meter: g.hot / 110, meterColor: col });
    }
    case "vram": {
      const m = s.gpuMem(g);
      if (!fin(m.used)) return noSensor("memory data");
      const u = S.fmtBytes(m.used, m.used >= 10 * 1073741824 ? 1 : 2);
      const t = m.total ? S.fmtBytes(m.total, 0) : null;
      const f = m.total ? m.used / m.total : null;
      return stat(x, y, { label: m.integrated ? "SHARED" : "VRAM", icon: "gpu", accent: acc, value: u.value, unit: u.unit, sub: t ? `of ${t.value} ${t.unit}` : "", meter: f, meterColor: S.usageColor(f || 0, acc) });
    }
    case "power": {
      if (!fin(g.power) && !fin(g.powerPct)) return noSensor("power data");
      if (!fin(g.power)) return stat(x, y, { label: "POWER", icon: "gpu", accent: C.power, value: pct(g.powerPct), unit: "%", meter: g.powerPct / 100, meterColor: C.power, sub: "of max" });
      const lim = fin(g.powerLimit) ? g.powerLimit : null;
      return stat(x, y, { label: "POWER", icon: "gpu", accent: C.power, value: String(Math.round(g.power)), unit: "W", sub: lim ? `of ${Math.round(lim)} W` : "", meter: lim ? g.power / lim : null, meterColor: C.power, spark: lim ? null : sparkFor(ctx, "gpower:" + g.id), sparkColor: C.power });
    }
    case "fan": {
      if (fin(g.fan) && g.fan > 0) return stat(x, y, { label: "FAN", icon: "gpu", accent: C.fan, value: String(Math.round(g.fan)), unit: "rpm", meter: fin(g.fanPct) ? g.fanPct / 100 : null, meterColor: C.fan, sub: fin(g.fanPct) ? "" : "" });
      if (fin(g.fanPct)) return stat(x, y, { label: "FAN", icon: "gpu", accent: C.fan, value: pct(g.fanPct), unit: "%", meter: g.fanPct / 100, meterColor: C.fan });
      if (fin(g.fan)) return stat(x, y, { label: "FAN", icon: "gpu", accent: C.fan, value: "0", unit: "rpm", sub: "Fans stopped" });
      return noSensor("fan data");
    }
    case "clock": {
      const m = S.fmtMhz(g.clock);
      if (!m) return noSensor("clock data");
      const mm = S.fmtMhz(g.memClock);
      return stat(x, y, { label: "CLOCK", icon: "gpu", accent: acc, value: m.value, unit: m.unit, sub: mm ? `Mem ${mm.unit === "GHz" ? Number(mm.value).toFixed(1) : mm.value} ${mm.unit}` : "" });
    }
    default:
      return "";
  }
}

// ------------------------------------------------------------------ disks
function driveTag(sel, store) {
  const id = store.driveId(sel);
  return id === "*" ? "ALL" : id;
}

function rateValue(x, y, label, iconName, col, bytes, bits, sparkVals, right) {
  const rr = S.fmtRate(bytes, bits);
  return stat(x, y, { label, icon: iconName, accent: col, right, value: rr.value, unit: "", sub: rr.unit, spark: sparkVals, sparkColor: col });
}

function compactRates(x, y, a, b, sparkA, sparkB, bits) {
  const ra = S.fmtRate(a, bits);
  const rb = S.fmtRate(b, bits);
  const row = (yy, ic, col, rr) => {
    let o = icon(ic, x + 6, y + yy - 25, 26, col, 3);
    const vs = fitSize(rr.value, 36, 54, true, 24);
    o += rich(x + 38, y + yy, [{ t: rr.value, size: vs, weight: 700 }, { t: rr.unit, size: 19, fill: C.muted, gap: 3 }], { size: 36 });
    return o;
  };
  let out = row(40, "down", C.down, ra) + row(84, "up", C.up, rb);
  const peak = Math.max(1, ...sparkA.filter(Number.isFinite), ...sparkB.filter(Number.isFinite)) * 1.1;
  out += spark(x + 8, y + 98, 128, 38, sparkA, C.down, { max: peak, sw: 2.5, fillOpacity: 0.25 });
  out += spark(x + 8, y + 98, 128, 38, sparkB, C.up, { max: peak, sw: 2.2, fillOpacity: 0.06 });
  return out;
}

function diskCell(role, x, y, ctx, st) {
  const s = ctx.store;
  const tag = driveTag(st.drive, s);
  const bits = st.diskUnits === "bits";
  const key = (k) => `disk:${tag === "ALL" ? "*" : (s.diskFor(st.drive) || {}).id}:${k}`;
  if (role === "space" || role === "free") {
    const v = s.volFor(st.drive);
    if (!v) return message(x, y, "disk", C.dim, s.samples ? "Drive not found" : "Loading…", s.samples ? tag : "");
    const f = v.total ? (v.total - v.free) / v.total : 0;
    if (role === "space") {
      const col = S.usageColor(f, C.disk);
      return stat(x, y, { label: "SPACE", icon: "disk", accent: C.disk, right: tag, value: pct(f * 100), unit: "%", valueColor: col === C.disk ? C.text : col, meter: f, meterColor: col });
    }
    const fr = S.fmtBytes(v.free);
    const tt = S.fmtBytes(v.total, 0);
    return stat(x, y, { label: "FREE", icon: "disk", accent: C.disk, right: tag, value: fr.value, unit: fr.unit, sub: `of ${tt.value} ${tt.unit}`, meter: 1 - f, meterColor: S.usageColor(f, C.disk) });
  }
  const d = s.diskFor(st.drive);
  if (!d) return message(x, y, "disk", C.dim, s.samples ? "Disk not found" : "Loading…", s.samples ? tag : "");
  switch (role) {
    case "activity": {
      const f = fin(d.act) ? d.act / 100 : 0;
      return stat(x, y, { label: "DISK", icon: "disk", accent: C.disk, right: tag, value: pct(d.act), unit: "%", meter: f, meterColor: S.usageColor(f, C.disk) });
    }
    case "read":
      return rateValue(x, y, "READ", "disk", C.down, d.rd, bits, sparkFor(ctx, key("rd")), tag);
    case "write":
      return rateValue(x, y, "WRITE", "disk", C.up, d.wr, bits, sparkFor(ctx, key("wr")), tag);
    case "rw":
      return compactRates(x, y, d.rd, d.wr, sparkFor(ctx, key("rd")), sparkFor(ctx, key("wr")), bits);
    default:
      return "";
  }
}

// ------------------------------------------------------------------ network
function netCell(role, x, y, ctx, st) {
  const s = ctx.store;
  const n = s.netFor(st.adapter);
  const bits = st.netUnits !== "bytes";
  if (!n) return message(x, y, "net", C.dim, s.samples ? "Not connected" : "Loading…");
  const key = (k) => `net:${n.id}:${k}`;
  switch (role) {
    case "down":
      return rateValue(x, y, "DOWN", "down", C.down, n.rx, bits, sparkFor(ctx, key("rx")));
    case "up":
      return rateValue(x, y, "UP", "up", C.up, n.tx, bits, sparkFor(ctx, key("tx")));
    case "both":
      return compactRates(x, y, n.rx, n.tx, sparkFor(ctx, key("rx")), sparkFor(ctx, key("tx")), bits);
    case "link": {
      let out = header(x, y, "LINK", "link", C.down);
      const name = n.name || "Adapter";
      const ns = fitSize(name, 28, 130, true, 19);
      out += text(x + 72, y + 84, fit(name, ns, 132, true), { size: ns, weight: 700, anchor: "middle" });
      const sp = n.speed > 0 && n.speed < 4e11 ? n.speed : 0;
      const spT = sp >= 1e9 ? `${S.trimZeros((sp / 1e9).toFixed(1))} Gb/s` : sp > 0 ? `${Math.round(sp / 1e6)} Mb/s` : "Connected";
      const t = n.up ? spT : "Disconnected";
      const tw = textWidth(t, SUB, true);
      out += circle(x + 72 - tw / 2 - 6, y + 121, 5.5, n.up ? C.good : C.bad);
      out += text(x + 72 + 7, y + 128, fit(t, SUB, 118, true), { size: SUB, fill: C.muted, weight: 600, anchor: "middle" });
      return out;
    }
    case "ip": {
      let out = header(x, y, "IP", "pin", C.down);
      const ip = n.ip || "";
      if (!ip) return out + text(x + 72, y + 96, n.up ? "No IPv4" : "Disconnected", { size: 21, fill: C.muted, weight: 600, anchor: "middle" });
      const parts = ip.split(".");
      const l1 = parts.slice(0, 2).join(".") + ".";
      const l2 = parts.slice(2).join(".");
      const size = Math.min(fitSize(l1, 34, 128, true, 20), fitSize(l2, 34, 128, true, 20));
      out += text(x + 72, y + 84, l1, { size, weight: 700, anchor: "middle" });
      out += text(x + 72, y + 84 + size + 6, l2, { size, weight: 700, anchor: "middle" });
      return out;
    }
    default:
      return "";
  }
}

// ------------------------------------------------------------------ system
function systemCell(role, x, y, ctx, st) {
  const s = ctx.store;
  switch (role) {
    case "summary": {
      const g = s.autoGpu();
      const rows = [["CPU", s.cur.cpu && s.cur.cpu.load, C.cpu], ["RAM", s.memPct(), C.mem]];
      if (g) rows.push([s.gpuLabel(g), g.util, gpuAccent(g)]);
      else {
        const d = s.diskFor("");
        rows.push(["DISK", d && d.act, C.disk]);
      }
      let out = "";
      rows.forEach(([lab, v, col], i) => {
        const by = y + 8 + i * 44;
        const f = fin(v) ? v / 100 : 0;
        out += text(x + 12, by + 22, lab, { size: SUB, fill: C.muted, weight: 700 });
        out += rich(x + 132, by + 22, [{ t: pct(v), weight: 700 }, { t: "%", fill: C.muted, size: 19 }], { anchor: "end", size: 22 });
        out += S.bar(x + 12, by + 29, 120, 7, f, S.usageColor(f, col));
      });
      return out;
    }
    case "uptime": {
      const u = S.fmtDuration(s.cur.sys && s.cur.sys.up ? s.cur.sys.up + (Date.now() - s.cur.at) / 1000 : 0);
      return stat(x, y, { label: "UPTIME", icon: "clock", accent: C.sys, value: u.value, unit: u.unit, sub: u.extra || "since start" });
    }
    case "battery": {
      const b = s.cur.bat;
      if (!b) return message(x, y, "plug", C.dim, s.samples ? "No battery" : "Loading…", s.samples ? "Mains power" : "");
      const f = b.pct / 100;
      const col = b.pct <= 15 ? C.bad : b.pct <= 30 ? C.warn : C.good;
      let sub = b.charging ? "Charging" : b.ac ? "Plugged in" : "On battery";
      if (!b.ac && fin(b.secs) && b.secs > 0) {
        const d = S.fmtDuration(b.secs);
        sub = d.unit === "min" ? `${d.value} min left` : `${Math.floor(b.secs / 3600)}h ${Math.floor((b.secs % 3600) / 60)}m left`;
      }
      return stat(x, y, { label: "BATTERY", icon: "battery", accent: col, value: pct(b.pct), unit: "%", meter: f, meterColor: col, sub });
    }
    case "procs": {
      const sys = s.cur.sys || {};
      return stat(x, y, { label: "PROCS", icon: "layers", accent: C.sys, value: fin(sys.procs) ? String(Math.round(sys.procs)) : "--", unit: "", sub: fin(sys.threads) ? `${Math.round(sys.threads).toLocaleString("en-US")} threads` : "" });
    }
    default:
      return "";
  }
}

// ------------------------------------------------------------------ sensor (HWiNFO / LibreHardwareMonitor)
const SENSOR_ICON = { temp: "thermo", fan: "fan", volt: "volt", power: "bolt", clock: "gauge", usage: "bars", current: "bolt" };
const SENSOR_COLOR = { temp: C.good, fan: C.fan, volt: C.volt, power: C.power, clock: C.cpu, usage: C.sys, current: C.power };

function sensorValue(sn, st) {
  const u = sn.unit || "";
  if (sn.type === "temp" || /°C|^C$/.test(u)) {
    const t = S.fmtTemp(sn.v, tempUnit(st));
    return { value: t.value, unit: t.unit };
  }
  const v = Number(sn.v);
  const abs = Math.abs(v);
  const d = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const unit = u;
  if (sn.type === "clock" && /MHz/i.test(u) && abs >= 1000) return { value: (v / 1000).toFixed(2), unit: "GHz" };
  return { value: S.trimZeros(v.toFixed(sn.type === "fan" ? 0 : d)), unit };
}

function sensorCell(role, x, y, ctx, st) {
  const s = ctx.store;
  if (!st.sensor) {
    if (!s.usableSensors().size) return needSetup(x, y, "sensor", ctx);
    return message(x, y, "sensor", C.sensor, "Pick sensor", "in settings");
  }
  const sn = s.sensor(st.sensor);
  if (!sn) return s.usableSensors().size ? message(x, y, "sensor", C.dim, "Sensor gone", "See settings") : needSetup(x, y, "sensor", ctx);
  const v = sensorValue(sn, st);
  const col = sn.type === "temp" ? S.tempColor(sn.v) : SENSOR_COLOR[sn.type] || C.sensor;
  const isPct = sn.unit === "%";
  const label = st.label || sn.name;
  return stat(x, y, {
    label,
    icon: SENSOR_ICON[sn.type] || "sensor",
    accent: col,
    value: v.value,
    unit: v.unit,
    valueColor: sn.type === "temp" && sn.v >= 80 ? col : C.text,
    meter: sn.type === "temp" ? sn.v / 100 : isPct ? sn.v / 100 : null,
    meterColor: col,
    sub: sn.hw ? shortHw(sn.hw) : "",
    spark: sn.type === "temp" || isPct ? null : sparkFor(ctx, "sensor:" + sn.id),
    sparkColor: col,
  });
}

function shortHw(hw) {
  return String(hw)
    .replace(/^(CPU|GPU|Memory|Drive|S\.M\.A\.R\.T\.)\s*\[#\d+\]:\s*/i, "")
    .replace(/:\s*(DTS|Enhanced|Performance Limit Reasons|C-State Residency)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------------ graphs
function legend(x, y, color, label, value, unit, iconName) {
  let size = 22;
  let segs;
  for (;;) {
    segs = [{ t: label ? label + " " : "", fill: C.muted, size: Math.max(19, size - 2), weight: 700 }, { t: value, weight: 700, size }, unit ? { t: unit, fill: C.muted, size: Math.max(19, size - 3), gap: unit === "%" ? 1 : 3 } : null].filter(Boolean);
    if (S.richWidth(segs) <= 106 || size <= 19) break;
    size--;
  }
  let out = iconName ? icon(iconName, x + 8, y + 12, 22, color, 3) : circle(x + 18, y + 24, 6.5, color);
  out += rich(x + 32, y + 32, segs, { size });
  return out;
}

function graphRegion(action, reg, ctx) {
  const st = reg.settings || {};
  const s = ctx.store;
  const W = reg.W;
  let lines = []; // [values, color, fillOpacity, max, sw]
  let legends = []; // [color, label, value, unit, icon]
  switch (action) {
    case "cpu": {
      lines.push([series(ctx, "cpu", st, W), C.cpu, 0.25, 100]);
      legends.push([C.cpu, "CPU", pct(s.cur.cpu && s.cur.cpu.load), "%"]);
      if (s.cpuTemp) {
        const tf = S.fmtTemp(s.cpuTemp.c, tempUnit(st));
        lines.push([series(ctx, "cpuTemp", st, W), C.warn, 0, 100, 2.5]);
        legends.push([C.warn, "TEMP", tf.value, tf.unit]);
      }
      break;
    }
    case "memory": {
      const m = s.cur.mem || {};
      lines.push([series(ctx, "mem", st, W), C.mem, 0.25, 100]);
      legends.push([C.mem, "RAM", pct(s.memPct()), "%"]);
      if (m.total) {
        const u = S.fmtBytes(m.total - m.avail, 1);
        legends.push([C.mem, "", u.value, u.unit]);
      }
      break;
    }
    case "gpu": {
      const g = s.gpu(st.gpu);
      if (!g) return message(reg.x, reg.y, "gpu", C.dim, s.info ? "No GPU found" : "Loading…");
      const acc = gpuAccent(g);
      lines.push([series(ctx, "vram:" + g.id, st, W), C.mem, 0, 100, 2.5]);
      lines.push([series(ctx, "gpu:" + g.id, st, W), acc, 0.25, 100]);
      legends.push([acc, s.gpuLabel(g), pct(g.util), "%"]);
      const m = s.gpuMem(g);
      legends.push([C.mem, m.integrated ? "MEM" : "VRAM", m.total ? pct((m.used / m.total) * 100) : "--", "%"]);
      break;
    }
    case "disk": {
      const d = s.diskFor(st.drive);
      const id = s.driveId(st.drive) === "*" ? "*" : d && d.id;
      const bits = st.diskUnits === "bits";
      const rd = series(ctx, `disk:${id}:rd`, st, W);
      const wr = series(ctx, `disk:${id}:wr`, st, W);
      const peak = Math.max(1024 * 1024, ...rd.filter(Number.isFinite), ...wr.filter(Number.isFinite)) * 1.1;
      lines.push([rd, C.down, 0.25, peak], [wr, C.up, 0.08, peak, 2.5]);
      const r1 = S.fmtRate(d ? d.rd : 0, bits);
      const r2 = S.fmtRate(d ? d.wr : 0, bits);
      legends.push([C.down, "R", r1.value, r1.unit], [C.up, "W", r2.value, r2.unit]);
      break;
    }
    case "network": {
      const n = s.netFor(st.adapter);
      const id = n ? n.id : "*";
      const bits = st.netUnits !== "bytes";
      const rx = series(ctx, `net:${id}:rx`, st, W);
      const tx = series(ctx, `net:${id}:tx`, st, W);
      const peak = Math.max(16 * 1024, ...rx.filter(Number.isFinite), ...tx.filter(Number.isFinite)) * 1.1;
      lines.push([rx, C.down, 0.25, peak], [tx, C.up, 0.08, peak, 2.5]);
      const a = S.fmtRate(n ? n.rx : 0, bits);
      const b = S.fmtRate(n ? n.tx : 0, bits);
      legends.push([C.down, "", a.value, a.unit, "down"], [C.up, "", b.value, b.unit, "up"]);
      break;
    }
    case "system": {
      const g = s.autoGpu();
      lines.push([series(ctx, "mem", st, W), C.mem, 0, 100, 2.5]);
      if (g) lines.push([series(ctx, "gpu:" + g.id, st, W), gpuAccent(g), 0, 100, 2.5]);
      lines.push([series(ctx, "cpu", st, W), C.cpu, 0.2, 100]);
      legends.push([C.cpu, "CPU", pct(s.cur.cpu && s.cur.cpu.load), "%"], [C.mem, "RAM", pct(s.memPct()), "%"]);
      if (g) legends.push([gpuAccent(g), s.gpuLabel(g), pct(g.util), "%"]);
      break;
    }
    case "sensor": {
      const sn = st.sensor ? s.sensor(st.sensor) : null;
      if (!sn) return sensorCell("value", reg.x, reg.y, ctx, st);
      const col = sn.type === "temp" ? S.tempColor(sn.v) : SENSOR_COLOR[sn.type] || C.sensor;
      const vals = series(ctx, "sensor:" + sn.id, st, W);
      const isPct = sn.unit === "%";
      const fv = vals.filter(Number.isFinite);
      const max = isPct ? 100 : sn.type === "temp" ? Math.max(100, ...fv) : Math.max(1e-6, ...fv) * 1.15;
      const min = isPct || sn.type === "temp" ? 0 : Math.min(0, ...fv);
      lines.push([vals, col, 0.22, max, 3, min]);
      const v = sensorValue(sn, st);
      legends.push([col, "", v.value, v.unit, SENSOR_ICON[sn.type] || "sensor"]);
      if (reg.w >= 2) legends.push([C.muted, "", fit(st.label || sn.name, 20, 100, true), ""]);
      break;
    }
    default:
      break;
  }

  // legends: one per key along the top row, stacked when there are more legends than keys
  let out = "";
  const perRow = Math.max(1, reg.w);
  // a one-key-high graph keeps most of its height for the lines
  const maxRows = reg.h === 1 && reg.w > 1 ? 1 : 2;
  legends = legends.slice(0, perRow * maxRows);
  const rows = Math.ceil(legends.length / perRow);
  legends.forEach((lg, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    out += legend(reg.x + col * PITCH, reg.y + row * 30, ...lg);
  });
  const top = reg.y + 10 + rows * 30 + 6;
  const bottom = reg.y + reg.H - 10;
  const gx = reg.x + 10;
  const gw = reg.W - 20;
  const gh = Math.max(20, bottom - top);
  out += rect(gx, top + gh, gw, 2, C.line);
  out += rect(gx, top + gh / 2, gw, 1, C.grid);
  for (const [vals, color, fo, max, sw, min] of lines) out += spark(gx, top, gw, gh, vals, color, { max, min: min || 0, fillOpacity: fo, sw: sw || 3.5 });
  return out;
}

// ------------------------------------------------------------------ role assignment
function available(action, role, ctx, st) {
  const s = ctx.store;
  if (action === "cpu") {
    if (role === "temp") return !!s.cpuTemp;
    if (role === "power") return !!s.cpuPower;
    if (role === "clock") return fin(s.cur.cpu && s.cur.cpu.mhz);
  }
  if (action === "gpu") {
    const g = s.gpu(st.gpu);
    if (!g) return role === "load";
    if (role === "temp") return fin(g.temp);
    if (role === "hot") return fin(g.hot);
    if (role === "power") return fin(g.power) || fin(g.powerPct);
    if (role === "fan") return fin(g.fan) || fin(g.fanPct);
    if (role === "clock") return fin(g.clock);
  }
  if (action === "system" && role === "battery") return !!s.cur.bat;
  return true;
}

function autoRoles(action, grp, ctx) {
  const def = ACTIONS[action];
  const anchor = grp.cells[0].settings || {};
  const order = def.order.filter((r) => available(action, r, ctx, anchor));
  const { w, h } = grp;
  const roles = new Map();
  const set = (c, role) => roles.set(c.context, role);
  if (w === 1 && h === 1) {
    set(grp.cells[0], def.shows[0]);
    return roles;
  }
  if (w === 1 || h === 1) {
    const n = w * h;
    const slots = n >= 5 ? 3 : n >= 3 ? 2 : n;
    const line = [...grp.cells].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
    line.forEach((c, i) => set(c, i < slots && order[i] ? order[i] : "graph"));
    return roles;
  }
  for (const c of grp.cells) {
    if (c.dy === 0) set(c, order[c.dx] || "graph");
    else if (action === "cpu" && h >= 3 && c.dy === h - 1) set(c, "cores");
    else set(c, "graph");
  }
  return roles;
}

function assignRoles(action, grp, ctx) {
  const def = ACTIONS[action];
  const auto = autoRoles(action, grp, ctx);
  return grp.cells.map((c) => {
    const want = c.settings && c.settings.show;
    const role = want && def.shows.includes(want) ? want : auto.get(c.context);
    return { ...c, role, x: c.dx * PITCH, y: c.dy * PITCH };
  });
}

// Neighbouring cells with the same spanning role share one graphic.
function spanRegions(cells, role) {
  const g = cells.filter((c) => c.role === role);
  const regions = buildGroups(g.map((c) => ({ context: c.context, device: "g", col: c.dx, row: c.dy, joinKey: role })));
  const byCtx = new Map(g.map((c) => [c.context, c]));
  return regions.map((rg) => {
    const first = byCtx.get(rg.anchor);
    return { w: rg.w, h: rg.h, x: first.dx * PITCH, y: first.dy * PITCH, settings: first.settings || {}, ...groupSize(rg.w, rg.h) };
  });
}

// A key that needs a sensor app: point the user at the Setup key.
function needSetup(x, y, iconName, ctx) {
  const st = ctx.setup || {};
  if (st.source === "none") return message(x, y, iconName, C.dim, "No sensor", "Built-in only");
  if (!st.hasKey) return message(x, y, iconName, C.sensor, "Add the Setup key");
  return message(x, y, iconName, C.sensor, "Finish the Setup key");
}

// The Setup key: which sensor service is used and whether it is working.
function setupCell(role, x, y, ctx) {
  const st = ctx.setup || {};
  const colors = { ok: C.good, warn: C.warn, busy: C.cpu, off: C.muted, bad: C.bad };
  const col = colors[st.level] || C.muted;
  let out = header(x, y, "SETUP", "sliders", col);
  const word = st.word || "Starting\u2026";
  const ws = fitSize(word, 24, 112, true, 19);
  const tw = Math.min(112, textWidth(word, ws, true));
  out += circle(x + 72 - tw / 2 - 8, y + 76, 6, col);
  out += text(x + 72 + 7, y + 84, fit(word, ws, 116, true), { size: ws, weight: 700, anchor: "middle" });
  if (st.name) {
    const ns = fitSize(st.name, 22, 132, true, 19);
    out += text(x + 72, y + 110, fit(st.name, ns, 132, true), { size: ns, weight: 700, fill: C.text, anchor: "middle" });
  }
  if (st.detail) out += text(x + 72, y + 134, fit(st.detail, SUB, 134, true), { size: SUB, weight: 600, fill: C.muted, anchor: "middle" });
  return out;
}

const CELL = { setup: setupCell, cpu: cpuCell, memory: memCell, gpu: gpuCell, disk: diskCell, network: netCell, system: systemCell, sensor: sensorCell };

// Returns { content, roles } for one group.
function renderGroup(action, grp, ctx) {
  const def = ACTIONS[action];
  if (!def) return { content: statusKeys(grp.w, grp.h, "error", "Unknown key"), roles: [] };
  const cells = assignRoles(action, grp, ctx);
  let out = "";
  for (const c of cells) {
    if (def.span.includes(c.role)) continue;
    out += CELL[action](c.role, c.x, c.y, ctx, c.settings || {});
  }
  for (const role of def.span) {
    for (const reg of spanRegions(cells, role)) out += role === "cores" ? coresRegion(reg, ctx) : graphRegion(action, reg, ctx);
  }
  return { content: out, roles: cells.map((c) => c.role) };
}

module.exports = { ACTIONS, K, GAP, PITCH, renderGroup, statusKeys, message, assignRoles, resample, appName, shortHw, sensorValue };
