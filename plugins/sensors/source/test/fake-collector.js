#!/usr/bin/env node
"use strict";
// Stands in for the Windows collector (vitals.ps1 + Vitals.cs) in tests.
// Prints the same JSON lines, with readings from one of a few made-up PCs.
// Usage: node fake-collector.js <profile> [-ParentPid n]

const readline = require("readline");

const profile = process.argv[2] || "desktop";
const GB = 1073741824;
const t0 = Date.now();
let backfill = 0; // seconds of pretend history, so previews show full graphs
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const wave = (period, lo, hi, phase = 0) => {
  const t = (Date.now() - t0) / 1000 - backfill;
  return lo + ((Math.sin((t / period) * 2 * Math.PI + phase) + 1) / 2) * (hi - lo);
};

const PROFILES = {
  desktop: {
    cpu: { name: "AMD Ryzen 7 7800X3D 8-Core Processor", vendor: "amd", threads: 16, baseMhz: 4200 },
    gpus: [
      { id: "00000000_0000D3E8", name: "NVIDIA GeForce RTX 4070 SUPER", vendor: "nvidia", bus: 1, integrated: false, dedTotal: 12 * GB, shrTotal: 32 * GB },
      { id: "00000000_0000E1A2", name: "AMD Radeon(TM) Graphics", vendor: "amd", bus: 16, integrated: true, dedTotal: 0.5 * GB, shrTotal: 32 * GB },
    ],
    mem: 64 * GB,
    sources: { pdh: true, kmt: true, nvml: "ok", adl: "ok" },
    battery: false,
    sensors: "hwinfo",
    nets: [
      { id: "{A1}", name: "Ethernet", desc: "Realtek PCIe 2.5GbE Family Controller", kind: "Ethernet", up: true, speed: 2.5e9, ip: "192.0.2.24", gw: true, virt: false, base: [6e6, 4e5] },
      { id: "{B2}", name: "vEthernet (WSL)", desc: "Hyper-V Virtual Ethernet Adapter", kind: "Ethernet", up: true, speed: 1e10, ip: "198.51.100.1", gw: false, virt: true, base: [2e3, 1e3] },
      { id: "{C3}", name: "Wi-Fi", desc: "Intel(R) Wi-Fi 6E AX211 160MHz", kind: "Wireless80211", up: false, speed: -1, ip: "", gw: false, virt: false, base: [0, 0] },
    ],
    disks: ["0 C:", "1 D: E:"],
    vols: [
      { id: "C:", label: "Windows", kind: "Fixed", total: 1.86 * 1024 * GB, free: 0.62 * 1024 * GB },
      { id: "D:", label: "Games", kind: "Fixed", total: 3.64 * 1024 * GB, free: 0.31 * 1024 * GB },
      { id: "E:", label: "Backup", kind: "Fixed", total: 0.93 * 1024 * GB, free: 0.7 * 1024 * GB },
    ],
  },
  laptop: {
    cpu: { name: "Intel(R) Core(TM) Ultra 7 155H", vendor: "intel", threads: 22, baseMhz: 3000 },
    gpus: [
      { id: "00000000_00011F40", name: "AMD Radeon RX 7600S", vendor: "amd", bus: 3, integrated: false, dedTotal: 8 * GB, shrTotal: 16 * GB },
      { id: "00000000_00010A10", name: "Intel(R) Arc(TM) Graphics", vendor: "intel", bus: 0, integrated: true, dedTotal: 0.125 * GB, shrTotal: 16 * GB },
    ],
    mem: 32 * GB,
    sources: { pdh: true, kmt: true, nvml: "not tried", adl: "ok" },
    battery: true,
    sensors: null,
    therm: true,
    nets: [{ id: "{W1}", name: "Wi-Fi", desc: "Intel(R) Wi-Fi 7 BE200 320MHz", kind: "Wireless80211", up: true, speed: 2.88e9, ip: "192.0.2.157", gw: true, virt: false, base: [2.5e7, 1.2e6] }],
    disks: ["0 C:"],
    vols: [{ id: "C:", label: "", kind: "Fixed", total: 0.93 * 1024 * GB, free: 0.08 * 1024 * GB }],
  },
  ryzen: {
    cpu: { name: "AMD Ryzen 7 5700X 8-Core Processor", vendor: "amd", threads: 16, baseMhz: 3400 },
    gpus: [{ id: "00000000_0000B2C4", name: "AMD Radeon RX 9070 XT", vendor: "amd", bus: 45, integrated: false, dedTotal: 16189 * 1048576, shrTotal: 32 * GB }],
    mem: 32 * GB,
    sources: { pdh: true, kmt: true, nvml: "not tried", adl: "ok" },
    battery: false,
    sensors: null,
    nets: [{ id: "{R1}", name: "Ethernet", desc: "Realtek PCIe GbE Family Controller", kind: "Ethernet", up: true, speed: 1e9, ip: "192.0.2.30", gw: true, virt: false, base: [3e6, 2e5] }],
    disks: ["0 C:"],
    vols: [{ id: "C:", label: "", kind: "Fixed", total: 0.93 * 1024 * GB, free: 0.41 * 1024 * GB }],
  },
  bare: {
    cpu: { name: "Intel(R) Core(TM) i5-9400F CPU @ 2.90GHz", vendor: "intel", threads: 6, baseMhz: 2904 },
    gpus: [{ id: "00000000_0000A001", name: "NVIDIA GeForce GTX 1060 6GB", vendor: "nvidia", bus: 1, integrated: false, dedTotal: 6 * GB, shrTotal: 8 * GB }],
    mem: 16 * GB,
    sources: { pdh: true, kmt: true, nvml: "missing", adl: "not tried" },
    battery: false,
    sensors: null,
    nets: [{ id: "{E1}", name: "Ethernet 2", desc: "Intel(R) Ethernet Connection (7) I219-V", kind: "Ethernet", up: true, speed: 1e9, ip: "192.0.2.50", gw: true, virt: false, base: [1.2e5, 3e4] }],
    disks: ["0 C:", "1 D:"],
    vols: [
      { id: "C:", label: "", kind: "Fixed", total: 0.46 * 1024 * GB, free: 0.11 * 1024 * GB },
      { id: "D:", label: "Data", kind: "Fixed", total: 1.82 * 1024 * GB, free: 1.1 * 1024 * GB },
      { id: "F:", label: "USB", kind: "Removable", total: 58 * GB, free: 21 * GB },
    ],
  },
};

if (profile === "crash") {
  out({ type: "log", level: "error", msg: "Collector failed to compile: test crash" });
  process.exit(3);
}

const P = PROFILES[profile] || PROFILES.desktop;
let needs = { gpu: true, top: false, sensors: false };

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  line = line.trim();
  if (line === "quit") process.exit(0);
  if (line.startsWith("need")) {
    for (const kv of line.split(" ").slice(1)) {
      const [k, v] = kv.split("=");
      needs[k] = v === "1";
    }
    out({ type: "log", level: "info", msg: "fake collector got: " + line });
  }
});
process.stdin.on("end", () => process.exit(0));

out({ type: "log", level: "info", msg: `Collector ready in 812 ms (fake ${profile})` });
out({ type: "info", cpu: P.cpu, gpus: P.gpus, memTotal: P.mem, sources: P.sources, os: "Microsoft Windows NT 10.0.22631.0", x64: true });

function hwinfoSensors() {
  const cpuHw = "CPU [#0]: AMD Ryzen 7 7800X3D: Enhanced";
  return [
    { id: "hwi:F0000300-0-1000000", hw: cpuHw, name: "CPU (Tctl/Tdie)", type: "temp", unit: "°C", v: wave(23, 58, 81) },
    { id: "hwi:F0000300-0-1000001", hw: cpuHw, name: "CPU Die (average)", type: "temp", unit: "°C", v: wave(23, 55, 77) },
    { id: "hwi:F0000300-0-7000000", hw: cpuHw, name: "CPU Package Power", type: "power", unit: "W", v: wave(17, 38, 92) },
    { id: "hwi:F0000300-0-6000000", hw: cpuHw, name: "Core 0 Clock (perf #1/1)", type: "clock", unit: "MHz", v: wave(9, 4400, 5050) },
    { id: "hwi:E0001-0-3000000", hw: "ASUS ROG STRIX B650E-F (Nuvoton NCT6799D)", name: "CPU", type: "fan", unit: "RPM", v: wave(29, 880, 1350) },
    { id: "hwi:E0001-0-3000001", hw: "ASUS ROG STRIX B650E-F (Nuvoton NCT6799D)", name: "Chassis 1", type: "fan", unit: "RPM", v: wave(41, 620, 700) },
    { id: "hwi:E0001-0-1000002", hw: "ASUS ROG STRIX B650E-F (Nuvoton NCT6799D)", name: "Motherboard", type: "temp", unit: "°C", v: wave(60, 36, 39) },
    { id: "hwi:E0001-0-2000003", hw: "ASUS ROG STRIX B650E-F (Nuvoton NCT6799D)", name: "Vcore", type: "volt", unit: "V", v: wave(7, 1.05, 1.27) },
    { id: "hwi:F0000400-0-1000004", hw: "GPU [#0]: NVIDIA GeForce RTX 4070 SUPER", name: "GPU Hot Spot Temperature", type: "temp", unit: "°C", v: wave(19, 61, 79) },
    { id: "hwi:F0000500-0-7000005", hw: "S.M.A.R.T.: Samsung SSD 990 PRO 2TB", name: "Drive Temperature", type: "temp", unit: "°C", v: wave(90, 41, 47) },
    { id: "hwi:F0000600-0-7000006", hw: "System: ASUS", name: "Physical Memory Load", type: "usage", unit: "%", v: wave(70, 38, 44) },
  ];
}

let tick = 0;
function sample() {
  tick++;
  const th = P.cpu.threads;
  const load = wave(11, 6, 74);
  const cores = Array.from({ length: th }, (_, i) => Math.max(0, Math.min(100, load + Math.sin(tick / 3 + i) * 22 + (i % 5) * 4)));
  const s = { type: "sample", ms: Date.now() - t0 };
  s.cpu = { load, cores, perf: 108, mhz: P.cpu.baseMhz * wave(13, 0.9, 1.22) };
  s.mem = { total: P.mem, avail: P.mem * wave(37, 0.35, 0.62), commitLimit: P.mem * 1.25, commit: P.mem * wave(31, 0.45, 0.7) };
  if (needs.gpu) {
    s.gpus = P.gpus.map((g, i) => {
      const util = i === 0 ? wave(8, 4, 97) : wave(15, 1, 18);
      const o = { id: g.id, util, ded: g.integrated ? 0.4 * GB : g.dedTotal * wave(25, 0.25, 0.71), shr: wave(30, 0.2, 1.4) * GB, src: "" };
      if (g.vendor === "nvidia" && P.sources.nvml === "ok") Object.assign(o, { temp: wave(19, 44, 71), power: wave(8, 18, 205), powerLimit: 220, powerPct: null, fanPct: wave(19, 0, 58), clock: wave(8, 210, 2790), memClock: 10501, src: "nvidia" });
      if (g.vendor === "nvidia" && P.sources.nvml !== "ok") Object.assign(o, { fan: 1450, src: "" }); // Windows data only (no temperature on this old driver)
      if (g.vendor === "amd" && !g.integrated) Object.assign(o, { temp: wave(19, 52, 86), hot: wave(19, 64, 101), power: wave(8, 9, 98), fan: wave(19, 0, 2900), fanPct: wave(19, 0, 61), clock: wave(8, 400, 2650), memClock: 2250, src: "amd" });
      if (g.vendor === "amd" && g.integrated) Object.assign(o, { temp: wave(19, 44, 58), src: "amd" });
      if (g.vendor === "intel") Object.assign(o, { temp: wave(19, 47, 66), src: "windows" });
      return o;
    });
  }
  s.disks = P.disks.map((id, i) => ({ id, act: i === 0 ? wave(6, 0, 64) : wave(14, 0, 12), rd: i === 0 ? wave(6, 0, 420e6) : wave(14, 0, 9e6), wr: i === 0 ? wave(5, 0, 85e6) : wave(9, 0, 2e6) }));
  s.disks.push({ id: "_Total", act: 10, rd: 1, wr: 1 });
  s.vols = P.vols;
  s.nets = P.nets.map((n, i) => ({ id: n.id, name: n.name, desc: n.desc, kind: n.kind, up: n.up, speed: n.speed, ip: n.ip, gw: n.gw, virt: n.virt, rx: n.up ? n.base[0] * wave(7, 0.05, 1.6, i) : 0, tx: n.up ? n.base[1] * wave(5, 0.1, 1.9, i) : 0 }));
  s.sys = { up: 3 * 86400 + 4 * 3600 + 720 + tick, procs: 287 + (tick % 7), threads: 4123 + (tick % 31) };
  if (P.therm) s.sys.therm = [{ id: "\\_TZ.TZ00", c: wave(17, 51, 73), live: true }, { id: "\\_TZ.TZ01", c: 27.8, live: false }];
  else s.sys.therm = [{ id: "\\_TZ.THRM", c: 27.8, live: false }];
  s.bat = P.battery ? { pct: 64, ac: false, charging: false, secs: 2 * 3600 + 25 * 60 } : null;
  if (needs.top) {
    s.top = {
      cpu: [["chrome", 12.4], ["obs64", 6.1], ["dwm", 2.2]],
      mem: [["chrome", 3.4 * GB], ["vmmemWSL", 2.1 * GB], ["Code", 1.2 * GB]],
    };
  }
  if (needs.sensors && P.sensors === "amd") s.sensors = [{ id: "amd:cpu-temp", hw: "CPU (AMD driver)", name: "CPU Temperature", type: "temp", unit: "\u00B0C", v: wave(17, 48, 66) }];
  else if (needs.sensors && P.sensors === "hwinfo") s.sensors = hwinfoSensors();
  else if (needs.sensors) s.sensors = [];
  if (needs.sensors) s.apps = JSON.parse(process.env.FAKE_APPS || "{}");
  out(s);
}

const interval = Number(process.env.FAKE_INTERVAL || 200);
// two and a half minutes of history straight away, one sample per pretend second
for (backfill = 150; backfill > 0; backfill--) sample();
setInterval(sample, interval);
sample();
