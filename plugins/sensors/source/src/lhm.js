"use strict";
// LibreHardwareMonitor support. Two ways to read it, chosen on the Setup key:
//   web  - its built-in web server (this PC only): http://127.0.0.1:<port>/data.json
//   log  - its sensor log file (CSV) in its folder, newest line every 2 seconds
// Also installs / reconfigures / starts it (Windows asks for permission once).

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

// data.json "Type" -> our type and unit
const TYPE = {
  Temperature: ["temp", "\u00B0C"],
  Fan: ["fan", "RPM"],
  Voltage: ["volt", "V"],
  Power: ["power", "W"],
  Clock: ["clock", "MHz"],
  Load: ["usage", "%"],
  Control: ["usage", "%"],
  Level: ["usage", "%"],
  Current: ["current", "A"],
  Frequency: ["clock", "Hz"],
  Throughput: ["rate", "B/s"],
  Data: ["data", "GB"],
  SmallData: ["smalldata", "MB"],
  Energy: ["energy", "mWh"],
  Noise: ["noise", "dBA"],
  Humidity: ["usage", "%"],
  Flow: ["flow", "L/h"],
  Factor: ["other", ""],
  TimeSpan: ["other", "s"],
};
// sensor id path segment (e.g. /amdcpu/0/temperature/2) -> data.json Type
const SEGMENT = {
  temperature: "Temperature", fan: "Fan", voltage: "Voltage", power: "Power", clock: "Clock", load: "Load",
  control: "Control", level: "Level", current: "Current", frequency: "Frequency", throughput: "Throughput",
  data: "Data", smalldata: "SmallData", energy: "Energy", noise: "Noise", humidity: "Humidity", flow: "Flow",
  factor: "Factor", timespan: "TimeSpan",
};

// Walks the data.json tree into flat readings.
function parseTree(root) {
  const out = [];
  const walk = (node, hw) => {
    if (!node || typeof node !== "object") return;
    if (node.HardwareId) hw = node.Text || hw;
    if (node.SensorId && node.Type) {
      let v = node.RawValue;
      if (typeof v !== "number") v = parseFloat(String(node.Value || "").replace(",", "."));
      if (Number.isFinite(v)) {
        const [type, unit] = TYPE[node.Type] || ["other", ""];
        out.push({ id: "lhm:" + node.SensorId, hw: hw || "", name: node.Text || "", type, unit, v });
      }
    }
    for (const c of node.Children || []) walk(c, hw);
  };
  walk(root, "");
  return out;
}

// One CSV line, respecting quotes.
function csvSplit(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// The log file has no hardware names, so name the hardware from its id.
function hwFromId(id) {
  const p = String(id).split("/").filter(Boolean);
  const kind = (p[0] || "").toLowerCase();
  if (/cpu$/.test(kind)) return "CPU";
  if (/^gpu/.test(kind)) return "GPU";
  if (kind === "lpc" || kind === "motherboard") return p[1] ? `Motherboard (${p[1].toUpperCase()})` : "Motherboard";
  if (kind === "ram" || kind === "vram") return "Memory";
  if (/^(nvme|hdd|ssd|storage)/.test(kind)) return `Drive ${p[1] || ""}`.trim();
  if (kind === "nic") return "Network";
  if (kind === "battery") return "Battery";
  if (kind === "psu") return "Power supply";
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Other";
}

// Header lines + last line of a LibreHardwareMonitor log -> readings.
function parseLog(idLine, nameLine, lastLine) {
  const ids = csvSplit(idLine).slice(1);
  const names = csvSplit(nameLine).slice(1);
  const vals = csvSplit(lastLine).slice(1);
  const out = [];
  ids.forEach((id, i) => {
    const v = parseFloat(vals[i]);
    if (!id || !Number.isFinite(v)) return;
    const seg = (String(id).split("/").filter(Boolean).slice(-2)[0] || "").toLowerCase();
    const [type, unit] = TYPE[SEGMENT[seg]] || ["other", ""];
    out.push({ id: "lhm:" + id, hw: hwFromId(id), name: names[i] || id, type, unit, v });
  });
  return out;
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

class Lhm extends EventEmitter {
  constructor(log, pluginDir) {
    super();
    this.log = log;
    this.pluginDir = pluginDir;
    this.port = 8085;
    this.mode = "web"; // web | log
    this.wanted = false;
    this.connected = false; // readings arriving through the chosen way
    this.readings = [];
    this.lastError = "";
    this.installing = null; // { step, done, error, what }
    this.installEndedAt = 0;
    this.timer = null;
    this.busy = false;
    this.logFile = null; // { name, ids, names }
    this.programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files";
    this.host = process.env.SYSVITALS_LHM_HOST || "127.0.0.1";
  }

  get dir() {
    return process.env.SYSVITALS_LHM_DIR || path.join(this.programFiles, "LibreHardwareMonitor");
  }
  get exePath() {
    return path.join(this.dir, "LibreHardwareMonitor.exe");
  }
  get installed() {
    if (process.env.SYSVITALS_LHM_INSTALLED) return process.env.SYSVITALS_LHM_INSTALLED === "1";
    try {
      return fs.existsSync(this.exePath);
    } catch (_) {
      return false;
    }
  }
  // Web server / log settings in its config file (readable without admin rights).
  get config() {
    try {
      const xml = fs.readFileSync(path.join(this.dir, "LibreHardwareMonitor.config"), "utf8");
      const get = (k) => (new RegExp(`key="${k}"\\s+value="([^"]*)"`).exec(xml) || [])[1];
      return { web: get("runWebServerMenuItem") === "true", log: get("logSensorsMenuItem") === "true", port: Number(get("listenerPort") || 8085) };
    } catch (_) {
      return null;
    }
  }

  configure({ port, mode, wanted }) {
    const p = Number(port) > 0 && Number(port) < 65536 ? Math.round(Number(port)) : 8085;
    const m = mode === "log" ? "log" : "web";
    const changed = p !== this.port || m !== this.mode;
    this.port = p;
    this.mode = m;
    if (changed) {
      this.logFile = null;
      this.setConnected(false);
    }
    if (wanted !== this.wanted || (changed && wanted)) {
      this.wanted = wanted;
      clearInterval(this.timer);
      this.timer = null;
      if (wanted) {
        this.poll();
        this.timer = setInterval(() => this.poll(), 2000);
      } else {
        this.setConnected(false);
        this.readings = [];
      }
    }
  }

  setConnected(ok, why) {
    if (ok === this.connected) return;
    this.connected = ok;
    const how = this.mode === "log" ? "log file" : `web server on port ${this.port}`;
    if (ok) this.log.info(`LibreHardwareMonitor connected through its ${how} (${this.readings.length} readings)`);
    else if (why) this.log.info(`LibreHardwareMonitor ${how}: ${why}`);
    this.emit("status");
  }

  fail(why) {
    this.lastError = why;
    this.setConnected(false, why);
  }
  ok(list) {
    this.readings = list;
    this.lastError = "";
    this.setConnected(true);
    this.emit("readings", list);
  }

  poll() {
    if (this.mode === "log") return this.pollLog();
    if (this.busy) return;
    this.busy = true;
    const req = http.get({ host: this.host, port: this.port, path: "/data.json", timeout: 1500, headers: { Accept: "application/json" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        this.busy = false;
        return this.fail(res.statusCode === 401 ? "the web server asks for a password" : `HTTP ${res.statusCode}`);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        this.busy = false;
        try {
          this.ok(parseTree(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        } catch (e) {
          this.fail("unreadable data: " + e.message);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) => {
      this.busy = false;
      this.fail(e.code === "ECONNREFUSED" ? "not running or web server off" : e.message);
    });
  }

  // Reads the newest line of the newest log file (only its last few KB).
  pollLog() {
    let files;
    try {
      files = fs.readdirSync(this.dir).filter((f) => /^LibreHardwareMonitorLog-.*\.csv$/i.test(f));
    } catch (_) {
      return this.fail("its folder was not found");
    }
    if (!files.length) return this.fail("no log file yet (logging off?)");
    let newest = null;
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(this.dir, f));
        if (!newest || st.mtimeMs > newest.mtime) newest = { name: f, mtime: st.mtimeMs, size: st.size };
      } catch (_) {}
    }
    if (!newest) return this.fail("log file unreadable");
    if (Date.now() - newest.mtime > 15000) return this.fail("log file not updating (not running?)");
    const file = path.join(this.dir, newest.name);
    let fd;
    try {
      fd = fs.openSync(file, "r");
      if (!this.logFile || this.logFile.name !== newest.name) {
        const head = Buffer.alloc(Math.min(newest.size, 512 * 1024));
        const n = fs.readSync(fd, head, 0, head.length, 0);
        const lines = head.slice(0, n).toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
        if (lines.length < 3) return this.fail("log file has no readings yet");
        this.logFile = { name: newest.name, idLine: lines[0], nameLine: lines[1] };
      }
      const len = Math.min(newest.size, 64 * 1024);
      const tail = Buffer.alloc(len);
      const n = fs.readSync(fd, tail, 0, len, newest.size - len);
      const lines = tail.slice(0, n).toString("utf8").split(/\r?\n/).filter((l) => l.trim());
      const last = lines[lines.length - 1];
      if (!last || last.startsWith(",") || last.startsWith("Time,")) return this.fail("log file has no readings yet");
      this.ok(parseLog(this.logFile.idLine, this.logFile.nameLine, last));
    } catch (e) {
      this.fail("log file unreadable: " + e.message);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  // Start the installed copy. Its startup task runs it with admin rights without a prompt.
  start() {
    this.log.info("Starting LibreHardwareMonitor");
    const p = spawn("schtasks.exe", ["/Run", "/TN", "LibreHardwareMonitor"], { windowsHide: true, stdio: "ignore" });
    p.on("error", () => this.startExe());
    p.on("exit", (code) => {
      if (code !== 0) this.startExe();
    });
  }
  startExe() {
    if (!this.installed) return;
    try {
      const p = spawn("cmd.exe", ["/c", "start", "", this.exePath], { detached: true, windowsHide: true, stdio: "ignore" });
      p.on("error", (e) => this.log.warn("Could not start LibreHardwareMonitor", e.message));
      p.unref();
    } catch (e) {
      this.log.warn("Could not start LibreHardwareMonitor", e.message);
    }
  }

  // Install / update (configOnly=false), or only switch it to the chosen way of
  // sharing readings (configOnly=true). Both need Windows' permission once.
  install(configOnly) {
    if (this.installing && !this.installing.done) return;
    const what = configOnly ? "apply" : "install";
    const dir = path.join(this.pluginDir, "runtime");
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, "install-lhm.ps1");
    const statusFile = path.join(dir, "install-lhm.status.json");
    fs.writeFileSync(script, "\uFEFF" + require("./native/install-lhm.ps1"), "utf8");
    try {
      fs.unlinkSync(statusFile);
    } catch (_) {}
    const user = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : "";
    const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const inner = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `"${script}"`, "-Port", String(this.port), "-Mode", this.mode, "-StatusFile", `"${statusFile}"`];
    if (user) inner.push("-User", `"${user}"`);
    if (configOnly) inner.push("-ConfigOnly");
    const cmd = `Start-Process -FilePath ${psQuote(ps)} -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @(${inner.map(psQuote).join(",")})`;
    this.installing = { step: "Waiting for Windows permission", done: false, error: "", what };
    this.emit("status");
    this.log.info(`${configOnly ? "Switching LibreHardwareMonitor to its " + this.mode + " setting" : "Installing LibreHardwareMonitor (" + this.mode + ")"} (asking Windows for permission)`);
    let errText = "";
    const proc = spawn(process.env.SYSVITALS_INSTALL_SHELL || ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    proc.stderr.on("data", (d) => (errText += d));
    proc.on("error", (e) => (errText += e.message));
    const read = () => {
      try {
        const st = JSON.parse(fs.readFileSync(statusFile, "utf8").replace(/^\uFEFF/, ""));
        if (st.step !== this.installing.step || st.done !== this.installing.done) {
          this.installing = { step: st.step, done: !!st.done, error: st.error || "", what };
          this.emit("status");
        }
      } catch (_) {}
    };
    const watch = setInterval(read, 500);
    proc.on("exit", (code) => {
      clearInterval(watch);
      read();
      this.installEndedAt = Date.now();
      if (!this.installing.done) {
        const cancelled = /cancel/i.test(errText);
        this.installing = { step: "Failed", done: true, what, error: cancelled ? "Windows permission was not given" : (errText.trim().split("\n")[0] || `stopped (code ${code})`).slice(0, 200) };
      }
      if (this.installing.error) this.log.warn(`LibreHardwareMonitor ${what} failed:`, this.installing.error);
      else this.log.info(configOnly ? "LibreHardwareMonitor settings applied and restarted" : "LibreHardwareMonitor installed and started");
      this.logFile = null;
      this.emit("status");
      setTimeout(() => this.poll(), 3000);
      setTimeout(() => this.poll(), 8000);
    });
  }
}

module.exports = { Lhm, parseTree, parseLog, csvSplit, hwFromId };
