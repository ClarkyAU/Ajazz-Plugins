"use strict";
// Runs the Windows collector (built-in Windows PowerShell + Vitals.cs) and turns
// its JSON lines into events. Restarts it if it stops.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");
const { EventEmitter } = require("events");

const SCRIPT = require("./native/vitals.ps1");
const CSHARP = require("./native/Vitals.cs");

function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  // A 32-bit Node on 64-bit Windows would get the 32-bit PowerShell from System32.
  const sys = process.arch === "ia32" && process.env.PROCESSOR_ARCHITEW6432 ? "Sysnative" : "System32";
  const p = path.join(root, sys, "WindowsPowerShell", "v1.0", "powershell.exe");
  return fs.existsSync(p) ? p : "powershell.exe";
}

function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch (_) {}
  fs.writeFileSync(file, content, "utf8");
}

class Collector extends EventEmitter {
  constructor(log, pluginDir) {
    super();
    this.log = log;
    this.pluginDir = pluginDir;
    this.proc = null;
    this.stopping = false;
    this.restarts = 0;
    this.needs = { gpu: true, top: false, sensors: false, hwinfo: true, wmi: true };
    this.sentNeeds = "";
    this.lastSampleAt = 0;
    this.startedAt = 0;
    this.status = "starting"; // starting | running | error
    this.statusText = "Starting\u2026";
    this.stderrCount = 0;
  }

  command() {
    // Tests point this at a fake collector: SYSVITALS_COLLECTOR='["node","fake.js"]'
    if (process.env.SYSVITALS_COLLECTOR) {
      const parts = JSON.parse(process.env.SYSVITALS_COLLECTOR);
      return { cmd: parts[0], args: parts.slice(1).concat(["-ParentPid", String(process.pid)]) };
    }
    const dir = path.join(this.pluginDir, "runtime");
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, "vitals.ps1");
    // PowerShell 5.1 reads scripts without a BOM as the ANSI code page; add one.
    writeIfChanged(script, "\uFEFF" + SCRIPT);
    writeIfChanged(path.join(dir, "Vitals.cs"), CSHARP);
    return {
      cmd: powershellPath(),
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-ParentPid", String(process.pid), "-CacheDir", dir],
    };
  }

  start() {
    if (this.proc || this.stopping) return;
    let spec;
    try {
      spec = this.command();
    } catch (e) {
      this.setStatus("error", "Can't start");
      this.log.error("Could not prepare the collector", e);
      return this.retryLater();
    }
    this.log.info(`Starting collector: ${path.basename(spec.cmd)}`);
    this.startedAt = Date.now();
    let proc;
    try {
      proc = spawn(spec.cmd, spec.args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      this.log.error("Could not start PowerShell", e);
      this.setStatus("error", "Can't start");
      return this.retryLater();
    }
    this.proc = proc;
    this.sentNeeds = "";
    proc.on("error", (e) => {
      this.log.error("Collector error", e.message);
    });
    proc.stdin.on("error", () => {});
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (line) => this.onLine(line));
    const rle = readline.createInterface({ input: proc.stderr });
    rle.on("line", (line) => {
      if (!line.trim()) return;
      if (++this.stderrCount <= 40) this.log.warn("Collector:", line.slice(0, 500));
    });
    proc.on("exit", (code, signal) => {
      this.proc = null;
      if (this.stopping) return;
      this.log.warn(`Collector stopped (code ${code}${signal ? ", " + signal : ""})`);
      this.setStatus("error", code === 3 ? "Collector failed" : "Restarting\u2026");
      this.retryLater();
    });
    this.sendNeeds();
  }

  retryLater() {
    if (this.stopping) return;
    const ran = Date.now() - this.startedAt;
    if (ran > 60000) this.restarts = 0;
    const wait = [2000, 5000, 15000, 30000, 60000][Math.min(this.restarts, 4)];
    this.restarts++;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.start(), wait);
  }

  setStatus(status, text) {
    if (this.status === status && this.statusText === text) return;
    this.status = status;
    this.statusText = text;
    this.emit("status");
  }

  onLine(line) {
    line = line.trim();
    if (!line || line[0] !== "{") return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      if (++this.stderrCount <= 40) this.log.warn("Collector sent unreadable data:", line.slice(0, 200));
      return;
    }
    if (msg.type === "log") {
      const fn = msg.level === "error" ? "error" : msg.level === "warn" ? "warn" : "info";
      this.log[fn]("Collector:", String(msg.msg || "").slice(0, 800));
    } else if (msg.type === "info") {
      this.emit("info", msg);
    } else if (msg.type === "sample") {
      this.lastSampleAt = Date.now();
      if (this.status !== "running") {
        this.restarts = 0;
        this.setStatus("running", "");
      }
      this.emit("sample", msg);
    }
  }

  setNeeds(needs) {
    this.needs = { ...this.needs, ...needs };
    this.sendNeeds();
  }

  sendNeeds() {
    const n = this.needs;
    const line = `need gpu=${n.gpu ? 1 : 0} top=${n.top ? 1 : 0} sensors=${n.sensors ? 1 : 0} hwinfo=${n.hwinfo ? 1 : 0} wmi=${n.wmi ? 1 : 0}`;
    if (line === this.sentNeeds || !this.proc) return;
    this.sentNeeds = line;
    try {
      this.proc.stdin.write(line + "\n");
    } catch (_) {}
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    const p = this.proc;
    if (!p) return;
    try {
      p.stdin.write("quit\n");
      p.stdin.end();
    } catch (_) {}
    setTimeout(() => {
      try {
        p.kill();
      } catch (_) {}
    }, 800).unref();
  }
}

module.exports = { Collector, powershellPath };
