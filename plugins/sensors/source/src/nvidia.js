"use strict";
// Fallback for NVIDIA cards when the collector could not use the driver library
// directly: streams readings from nvidia-smi, which ships with every NVIDIA driver.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

const FULL = ["pci.bus_id", "temperature.gpu", "power.draw", "power.limit", "fan.speed", "clocks.gr", "clocks.mem"];
const BASIC = ["pci.bus_id", "temperature.gpu", "power.draw", "fan.speed", "clocks.gr"];

function findNvidiaSmi() {
  if (process.env.SYSVITALS_NVIDIA_SMI) return process.env.SYSVITALS_NVIDIA_SMI;
  const root = process.env.SystemRoot || "C:\\Windows";
  const pf = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files";
  const list = [path.join(root, "System32", "nvidia-smi.exe"), path.join(pf, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")];
  for (const p of list) if (fs.existsSync(p)) return p;
  try {
    const repo = path.join(root, "System32", "DriverStore", "FileRepository");
    for (const d of fs.readdirSync(repo)) {
      if (!/^nv/i.test(d)) continue;
      const p = path.join(repo, d, "nvidia-smi.exe");
      if (fs.existsSync(p)) return p;
    }
  } catch (_) {}
  return null;
}

function num(s) {
  const v = parseFloat(String(s).trim());
  return Number.isFinite(v) ? v : null;
}

// "00000000:01:00.0, 45, 30.12, 200.00, 30, 210, 405"
function parseLine(line, fields) {
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length < fields.length) return null;
  const o = {};
  fields.forEach((f, i) => (o[f] = parts[i]));
  const m = /^[0-9a-f]+:([0-9a-f]+):/i.exec(o["pci.bus_id"] || "");
  if (!m) return null;
  return {
    bus: parseInt(m[1], 16),
    temp: num(o["temperature.gpu"]),
    power: num(o["power.draw"]),
    powerLimit: num(o["power.limit"]),
    fanPct: num(o["fan.speed"]),
    clock: num(o["clocks.gr"]),
    memClock: num(o["clocks.mem"]),
    at: Date.now(),
  };
}

class NvidiaSmi {
  constructor(log) {
    this.log = log;
    this.exe = undefined;
    this.proc = null;
    this.fields = FULL;
    this.byBus = new Map();
    this.wanted = false;
    this.failures = 0;
  }

  setWanted(on) {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) this.start();
    else this.stop();
  }

  start() {
    if (this.proc || !this.wanted) return;
    if (this.exe === undefined) {
      this.exe = findNvidiaSmi();
      this.log.info(this.exe ? `Using nvidia-smi for NVIDIA readings: ${this.exe}` : "nvidia-smi not found");
    }
    if (!this.exe) return;
    const fields = this.fields;
    const proc = spawn(this.exe, [`--query-gpu=${fields.join(",")}`, "--format=csv,noheader,nounits", "-lms", "1000"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.proc = proc;
    let gotData = false;
    let errText = "";
    proc.on("error", (e) => this.log.warn("nvidia-smi failed to start", e.message));
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      const d = parseLine(line, fields);
      if (d) {
        gotData = true;
        this.failures = 0;
        this.byBus.set(d.bus, d);
      } else if (/not a valid field|invalid/i.test(line)) errText += line;
    });
    readline.createInterface({ input: proc.stderr }).on("line", (l) => (errText += l + " "));
    proc.on("exit", (code) => {
      this.proc = null;
      if (!this.wanted) return;
      if (!gotData && this.fields === FULL) {
        this.fields = BASIC;
        this.log.info("nvidia-smi: retrying with fewer fields", errText.slice(0, 200));
      } else {
        this.failures++;
        if (errText) this.log.warn("nvidia-smi stopped:", errText.slice(0, 300));
      }
      if (this.failures > 5) return;
      setTimeout(() => this.start(), Math.min(60000, 2000 * (this.failures + 1))).unref();
    });
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch (_) {}
      this.proc = null;
    }
  }

  get(bus) {
    const d = this.byBus.get(bus);
    return d && Date.now() - d.at < 5000 ? d : null;
  }
  any() {
    for (const d of this.byBus.values()) if (Date.now() - d.at < 5000) return d;
    return null;
  }
}

module.exports = { NvidiaSmi, parseLine, FULL };
