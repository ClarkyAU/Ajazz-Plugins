"use strict";
// Keeps the latest readings plus up to 10 minutes of history for graphs.

const HIST = 600; // samples (one per second)

class Ring {
  constructor(n = HIST) {
    this.a = new Float64Array(n).fill(NaN);
    this.i = 0;
    this.n = n;
  }
  push(v) {
    this.a[this.i] = Number.isFinite(v) ? v : NaN;
    this.i = (this.i + 1) % this.n;
  }
  // last `count` values, oldest first
  last(count) {
    count = Math.max(2, Math.min(this.n, count));
    const out = new Array(count);
    for (let k = 0; k < count; k++) out[k] = this.a[(this.i - count + k + this.n * 2) % this.n];
    return out;
  }
}

const fin = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// ------------------------------------------------------------------ sensor picking
const CPUISH = /\b(cpu|processor|ryzen|threadripper|epyc|core i\d|core ultra|xeon|intel core|amd cpu|intelcpu|amdcpu|celeron|pentium|athlon|snapdragon)\b/i;
const GPUISH = /\b(gpu|radeon|geforce|rtx|gtx|arc|nvidia|graphics)\b/i;
const CPU_TEMP_PREFS = [
  /^cpu package$/i,
  /^package$/i,
  /^cpu \(tctl\/tdie\)$/i,
  /^core \(tctl\/tdie\)$/i,
  /tctl\/tdie|^tdie$|^tctl$/i,
  /^cpu die \(average\)$/i,
  /^core max$/i,
  /^core average$/i,
  /^cpu( temperature)?$/i,
  /^cpu cores?$/i,
  /cpu/i,
];
const CPU_POWER_PREFS = [/^cpu package power$/i, /^package$/i, /^cpu package$/i, /^cpu ppt$/i, /^package power$/i, /^cpu power$/i, /package/i, /cpu/i];

function pickSensor(sensors, type, prefs, wantHw) {
  let best = null;
  let bestScore = Infinity;
  for (const s of sensors.values()) {
    if (s.type !== type || !Number.isFinite(s.v)) continue;
    const hw = s.hw || "";
    const cpuHw = CPUISH.test(hw) && !GPUISH.test(hw);
    if (wantHw === "cpu" && !cpuHw && !/^cpu/i.test(s.name)) continue;
    if (GPUISH.test(hw) || /gpu/i.test(s.name)) continue;
    const idx = prefs.findIndex((re) => re.test(s.name));
    if (idx < 0) continue;
    // prefer HWiNFO's CPU sensor over motherboard "CPU" readings, and the first CPU
    const score = idx * 10 + (cpuHw ? 0 : 5) + (/#1|\/1\//.test(hw + s.id) ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function sourceName(id) {
  if (!id) return "";
  if (id.startsWith("hwi:")) return "HWiNFO";
  if (id.startsWith("lhm:")) return "LibreHardwareMonitor";
  if (id.startsWith("ohm:")) return "OpenHardwareMonitor";
  if (id.startsWith("amd:")) return "AMD driver";
  return "";
}

// ------------------------------------------------------------------ store
class Store {
  constructor() {
    this.info = null;
    this.cur = { cpu: {}, mem: {}, gpus: [], disks: [], vols: [], nets: [], sys: {}, bat: null, top: null };
    this.samples = 0;
    this.hist = new Map();
    this.sensors = new Map(); // id -> {id,hw,name,type,unit,v,seen}
    this.sensorsSeen = 0;
    this.cpuTemp = null; // { c, src, id }
    this.cpuPower = null;
    this.nvidia = null; // NvidiaSmi fallback
    this.source = "auto"; // Setup key: auto | lhm | hwinfo | none
    this.apps = { lhm: false, hwinfo: false, ohm: false }; // sensor apps running
  }

  // Which readings the Setup key's choice allows. Built-in ones (AMD driver) always count.
  allowed(id) {
    const src = String(id).split(":")[0];
    if (src === "amd") return true;
    if (this.source === "none") return false;
    if (this.source === "lhm") return src === "lhm";
    if (this.source === "hwinfo") return src === "hwi";
    return true;
  }

  // Readings from LibreHardwareMonitor's web server (merged with the collector's).
  addLhm(list) {
    const now = Date.now();
    for (const r of list) this.sensors.set(r.id, { ...r, seen: now });
    this.sensorsSeen = now;
  }

  ring(key) {
    let h = this.hist.get(key);
    if (!h) {
      h = new Ring();
      this.hist.set(key, h);
    }
    return h;
  }
  series(key, count) {
    const h = this.hist.get(key);
    return h ? h.last(count) : new Array(Math.max(2, count)).fill(NaN);
  }

  setInfo(info) {
    this.info = info;
  }

  gpuInfo(id) {
    return (this.info && this.info.gpus.find((g) => g.id === id)) || null;
  }

  add(s) {
    this.samples++;
    const cur = this.cur;
    if (s.cpu && s.cpu.load != null) cur.cpu = s.cpu;
    if (s.mem) cur.mem = s.mem;
    if (s.gpus) cur.gpus = s.gpus;
    if (s.disks && s.disks.length) cur.disks = s.disks;
    if (s.vols) cur.vols = s.vols;
    if (s.nets) cur.nets = s.nets;
    if (s.sys) cur.sys = { ...cur.sys, ...s.sys, therm: s.sys.therm || cur.sys.therm };
    if ("bat" in s) cur.bat = s.bat;
    if (s.top) cur.top = s.top;
    if (s.apps) this.apps = s.apps;
    cur.at = Date.now();

    if (s.sensors) {
      const now = Date.now();
      for (const r of s.sensors) this.sensors.set(r.id, { ...r, seen: now });
      for (const [id, r] of this.sensors) if (now - r.seen > 15000) this.sensors.delete(id);
      this.sensorsSeen = now;
    }

    this.mergeNvidiaSmi();
    this.derive();
    this.record();
  }

  mergeNvidiaSmi() {
    if (!this.nvidia || !this.info) return;
    for (const g of this.cur.gpus) {
      const gi = this.gpuInfo(g.id);
      if (!gi || gi.vendor !== "nvidia") continue;
      const d = this.nvidia.get(gi.bus) || (this.info.gpus.filter((x) => x.vendor === "nvidia").length === 1 ? this.nvidia.any() : null);
      if (!d) continue;
      if (d.temp != null) {
        g.temp = d.temp;
        g.src = "nvidia";
      }
      if (d.power != null) g.power = d.power;
      if (d.powerLimit != null) g.powerLimit = d.powerLimit;
      if (d.power != null && d.powerLimit) g.powerPct = (d.power / d.powerLimit) * 100;
      if (d.fanPct != null) g.fanPct = d.fanPct;
      if (d.clock != null) g.clock = d.clock;
      if (d.memClock != null) g.memClock = d.memClock;
    }
  }

  derive() {
    // CPU temperature: a hardware-monitor app if one is running, else the driver of an
    // AMD APU, else an ACPI thermal zone that actually changes.
    let t = null;
    const usable = this.usableSensors();
    const s = pickSensor(usable, "temp", CPU_TEMP_PREFS, "cpu");
    if (s && s.v > 0 && s.v < 130) t = { c: s.v, src: sourceName(s.id), id: s.id };
    if (!t) {
      const live = (this.cur.sys.therm || []).filter((z) => z.live && z.c > 15 && z.c < 115);
      if (live.length) {
        const z = live.reduce((a, b) => (b.c > a.c ? b : a));
        t = { c: z.c, src: "Windows", id: "therm:" + z.id };
      }
    }
    this.cpuTemp = t;
    const p = pickSensor(usable, "power", CPU_POWER_PREFS, "cpu");
    this.cpuPower = p && p.v >= 0 && p.v < 1000 ? { w: p.v, src: sourceName(p.id), id: p.id } : null;
  }

  memPct() {
    const m = this.cur.mem;
    return m && m.total ? ((m.total - m.avail) / m.total) * 100 : null;
  }

  // GPU memory: dedicated for cards, shared for integrated graphics.
  gpuMem(g) {
    const gi = this.gpuInfo(g.id) || {};
    const integrated = gi.integrated || !(gi.dedTotal > 1.1 * 1073741824);
    const used = integrated ? fin(g.shr) : fin(g.ded);
    let total = integrated ? fin(gi.shrTotal) : fin(gi.dedTotal);
    if (integrated && used != null && fin(g.ded) != null) {
      // integrated: include the small carve-out
      return { used: used + g.ded, total: (total || 0) + (fin(gi.dedTotal) || 0) || null, integrated };
    }
    return { used, total, integrated };
  }

  record() {
    const c = this.cur;
    this.ring("cpu").push(fin(c.cpu.load));
    this.ring("cpuTemp").push(this.cpuTemp ? this.cpuTemp.c : NaN);
    this.ring("cpuPower").push(this.cpuPower ? this.cpuPower.w : NaN);
    this.ring("mem").push(this.memPct());
    let gpuMax = NaN;
    for (const g of c.gpus) {
      this.ring("gpu:" + g.id).push(fin(g.util));
      const m = this.gpuMem(g);
      this.ring("vram:" + g.id).push(m.used != null && m.total ? (m.used / m.total) * 100 : NaN);
      this.ring("gtemp:" + g.id).push(fin(g.temp));
      this.ring("gpower:" + g.id).push(fin(g.power));
      if (Number.isFinite(g.util) && !(g.util <= gpuMax)) gpuMax = g.util;
    }
    this.ring("gpu:auto").push(this.autoGpu() ? fin(this.autoGpu().util) : gpuMax);
    let act = NaN;
    let rd = 0;
    let wr = 0;
    for (const d of c.disks) {
      if (d.id === "_Total") continue;
      this.ring(`disk:${d.id}:act`).push(fin(d.act));
      this.ring(`disk:${d.id}:rd`).push(fin(d.rd));
      this.ring(`disk:${d.id}:wr`).push(fin(d.wr));
      if (Number.isFinite(d.act) && !(d.act <= act)) act = d.act;
      rd += fin(d.rd) || 0;
      wr += fin(d.wr) || 0;
    }
    this.ring("disk:*:act").push(act);
    this.ring("disk:*:rd").push(rd);
    this.ring("disk:*:wr").push(wr);
    let rx = 0;
    let tx = 0;
    for (const n of c.nets) {
      this.ring(`net:${n.id}:rx`).push(fin(n.rx));
      this.ring(`net:${n.id}:tx`).push(fin(n.tx));
      if (n.up && !n.virt) {
        rx += fin(n.rx) || 0;
        tx += fin(n.tx) || 0;
      }
    }
    this.ring("net:*:rx").push(rx);
    this.ring("net:*:tx").push(tx);
    for (const sn of this.sensors.values()) this.ring("sensor:" + sn.id).push(fin(sn.v));
  }

  // ---------------------------------------------------------------- lookups used by keys
  gpuList() {
    const live = new Map(this.cur.gpus.map((g) => [g.id, g]));
    return ((this.info && this.info.gpus) || []).map((gi) => ({ ...gi, ...(live.get(gi.id) || {}) }));
  }

  // Automatic GPU: the dedicated card with the most memory, else the first one.
  autoGpu() {
    const list = this.gpuList();
    if (!list.length) return null;
    const ded = list.filter((g) => !g.integrated);
    const pool = ded.length ? ded : list;
    return pool.reduce((a, b) => ((b.dedTotal || 0) > (a.dedTotal || 0) ? b : a));
  }

  gpu(id) {
    const list = this.gpuList();
    if (id) {
      const g = list.find((x) => x.id === id);
      if (g) return g;
    }
    return this.autoGpu();
  }

  gpuLabel(g) {
    if (!g) return "GPU";
    const list = this.gpuList();
    if (list.length > 1 && g.integrated && list.some((x) => !x.integrated)) return "iGPU";
    return "GPU";
  }

  // Drive letter -> physical disk counters. Automatic = the Windows drive.
  driveId(sel) {
    if (sel === "*") return "*";
    if (sel) return sel.toUpperCase();
    return (process.env.SystemDrive || "C:").toUpperCase();
  }
  diskFor(sel) {
    const id = this.driveId(sel);
    if (id === "*") {
      const list = this.cur.disks.filter((d) => d.id !== "_Total");
      if (!list.length) return null;
      return {
        id: "*",
        act: Math.max(...list.map((d) => fin(d.act) || 0)),
        rd: list.reduce((a, d) => a + (fin(d.rd) || 0), 0),
        wr: list.reduce((a, d) => a + (fin(d.wr) || 0), 0),
      };
    }
    const letter = id.replace(/\\$/, "");
    return this.cur.disks.find((d) => d.id !== "_Total" && d.id.toUpperCase().split(/\s+/).includes(letter)) || null;
  }
  volFor(sel) {
    const id = this.driveId(sel);
    if (id === "*") {
      const list = this.cur.vols.filter((v) => v.kind === "Fixed");
      if (!list.length) return null;
      return { id: "*", label: "All drives", total: list.reduce((a, v) => a + v.total, 0), free: list.reduce((a, v) => a + v.free, 0) };
    }
    return this.cur.vols.find((v) => v.id.toUpperCase() === id) || null;
  }
  drives() {
    return this.cur.vols.map((v) => ({ id: v.id, label: v.label, kind: v.kind, total: v.total }));
  }

  // Automatic adapter: the connected, non-virtual adapter with a gateway and the most traffic.
  autoNet() {
    const list = this.cur.nets.filter((n) => n.up);
    if (!list.length) return null;
    const score = (n) => (n.gw ? 4 : 0) + (n.virt ? 0 : 2) + (n.kind === "Wireless80211" || n.kind === "Ethernet" || /Ethernet/.test(n.kind) ? 1 : 0);
    let best = null;
    for (const n of list) {
      if (!best) best = n;
      else {
        const a = score(n);
        const b = score(best);
        const traffic = (x) => (this.series(`net:${x.id}:rx`, 30).reduce((s, v) => s + (v || 0), 0) || 0);
        if (a > b || (a === b && traffic(n) > traffic(best))) best = n;
      }
    }
    return best;
  }
  netFor(sel) {
    if (sel === "*") {
      const list = this.cur.nets.filter((n) => n.up && !n.virt);
      return {
        id: "*",
        name: "All adapters",
        up: list.length > 0,
        rx: list.reduce((a, n) => a + (fin(n.rx) || 0), 0),
        tx: list.reduce((a, n) => a + (fin(n.tx) || 0), 0),
        speed: Math.max(0, ...list.map((n) => (n.speed > 0 && n.speed < 4e11 ? n.speed : 0))),
        ip: (list.find((n) => n.gw && n.ip) || list[0] || {}).ip || "",
      };
    }
    if (sel) {
      const n = this.cur.nets.find((x) => x.id === sel);
      if (n) return n;
      return { id: sel, name: "Adapter", up: false, rx: 0, tx: 0, missing: true };
    }
    return this.autoNet();
  }
  adapters() {
    return this.cur.nets.map((n) => ({ id: n.id, name: n.name, desc: n.desc, up: n.up, virt: n.virt }));
  }

  usableSensors() {
    const m = new Map();
    for (const [id, s] of this.sensors) if (this.allowed(id) && Date.now() - s.seen < 15000) m.set(id, s);
    return m;
  }
  sensorList() {
    return [...this.usableSensors().values()].map((s) => ({ id: s.id, hw: s.hw, name: s.name, type: s.type, unit: s.unit, src: sourceName(s.id) }));
  }
  sensor(id) {
    const s = this.sensors.get(id);
    return s && this.allowed(id) && Date.now() - s.seen < 15000 ? s : null;
  }
  sensorSource() {
    const names = new Set([...this.usableSensors().keys()].map(sourceName).filter(Boolean));
    return [...names].join(" + ");
  }
  countFrom(prefix) {
    let n = 0;
    for (const [id, s] of this.sensors) if (id.startsWith(prefix) && Date.now() - s.seen < 15000) n++;
    return n;
  }
}

module.exports = { Store, Ring, HIST, pickSensor, CPU_TEMP_PREFS, sourceName };
