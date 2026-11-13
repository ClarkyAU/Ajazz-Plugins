"use strict";
// System Vitals - Ajazz / Stream Dock plugin entry point.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { realPosition, buildGroups } = require("./layout");
const { Collector } = require("./collector");
const { NvidiaSmi } = require("./nvidia");
const { Store } = require("./store");
const { Lhm } = require("./lhm");
const R = require("./render");
const S = require("./svg");

const UUID_PREFIX = "com.clarkyau.sysvitals.";
const PLUGIN_DIR = path.resolve(__dirname, "..");
const LOG_FILE = path.join(PLUGIN_DIR, "plugin.log");

// ------------------------------------------------------------------ logging
function writeLog(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ")}\n`;
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + ".1");
  } catch (_) {}
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
  if (process.env.SYSVITALS_STDOUT) process.stdout.write(line);
}
function safeJson(v) {
  try {
    return v instanceof Error ? v.stack || v.message : JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}
const log = {
  info: (...a) => writeLog("INFO", a),
  warn: (...a) => writeLog("WARN", a),
  error: (...a) => writeLog("ERROR", a),
};
process.on("uncaughtException", (e) => log.error("Uncaught:", e));
process.on("unhandledRejection", (e) => log.error("Unhandled rejection:", e));

function arg(name) {
  const i = process.argv.indexOf("-" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const port = arg("port");
const pluginUUID = arg("pluginUUID");
const registerEvent = arg("registerEvent") || "registerPlugin";
let hostInfo = {};
try {
  hostInfo = JSON.parse(arg("info") || "{}");
} catch (_) {}
log.info(`Starting. Plugin folder: ${PLUGIN_DIR}. Host: ${(hostInfo.application && hostInfo.application.version) || "?"} Node ${process.version}`);

// ------------------------------------------------------------------ state
const keys = new Map(); // context -> { action, device, col, row, settings, solo }
const lastImage = new Map();
const roleOf = new Map(); // context -> role shown right now
let piContext = null;
let piAction = null;

const store = new Store();
const collector = new Collector(log, PLUGIN_DIR);
const nvsmi = new NvidiaSmi(log);
store.nvidia = nvsmi;
const lhm = new Lhm(log, PLUGIN_DIR);

// Setup key settings, shared by all keys (saved as global settings)
const DEFAULT_GLOBAL = { source: "auto", lhmPort: 8085, lhmMode: "web" };
let globalSettings = { ...DEFAULT_GLOBAL };
let gotGlobal = false;
function applyGlobal(s) {
  globalSettings = { ...DEFAULT_GLOBAL, ...(s || {}) };
  if (!["auto", "lhm", "hwinfo", "none"].includes(globalSettings.source)) globalSettings.source = "auto";
  if (!["web", "log"].includes(globalSettings.lhmMode)) globalSettings.lhmMode = "web";
  gotGlobal = true;
  store.source = globalSettings.source;
  log.info(`Sensor source: ${globalSettings.source}, LibreHardwareMonitor through its ${globalSettings.lhmMode === "log" ? "log file" : "web server (port " + globalSettings.lhmPort + ")"}`);
  updateNeeds();
  scheduleRender(true);
  sendPiState();
}
lhm.on("readings", (list) => {
  store.addLhm(list);
});
lhm.on("status", () => {
  updateNeeds();
  scheduleRender(true);
  sendPiState();
});

collector.on("info", (info) => {
  const first = !store.info;
  store.setInfo(info);
  if (first || info.gpus.length !== (store.lastGpuCount || 0)) {
    log.info(`PC: ${info.cpu.name || "CPU"} (${info.cpu.threads} threads), ${(info.gpus || []).map((g) => g.name).join(", ") || "no GPU listed"}, ${info.os}`);
  }
  store.lastGpuCount = info.gpus.length;
  updateNvidiaFallback();
  sendPiState();
});
collector.on("sample", (s) => {
  store.add(s);
  scheduleRender();
});
collector.on("status", () => scheduleRender(true));

// nvidia-smi is only used when the collector could not open the NVIDIA driver library.
function updateNvidiaFallback() {
  const info = store.info;
  const hasNv = info && info.gpus.some((g) => g.vendor === "nvidia");
  const nvmlOk = info && info.sources && info.sources.nvml === "ok";
  const tried = info && info.sources && info.sources.nvml !== "not tried";
  nvsmi.setWanted(!!(hasNv && tried && !nvmlOk && collector.needs.gpu));
}

// ------------------------------------------------------------------ Stream Dock connection
const sd = new WebSocket(`ws://127.0.0.1:${port}`);
function send(obj) {
  if (sd.readyState === WebSocket.OPEN) sd.send(JSON.stringify(obj));
}
sd.on("open", () => {
  send({ event: registerEvent, uuid: pluginUUID });
  send({ event: "getGlobalSettings", context: pluginUUID });
  log.info("Registered with Stream Dock");
  collector.start();
});
sd.on("close", () => {
  log.info("Stream Dock closed the connection; exiting");
  shutdown();
});
sd.on("error", (e) => log.error("Stream Dock connection error", e.message));
sd.on("message", (buf) => {
  let msg;
  try {
    msg = JSON.parse(buf.toString());
  } catch (_) {
    return;
  }
  try {
    handle(msg);
  } catch (e) {
    log.error("Event failed", msg.event, e);
  }
});

function shutdown() {
  collector.stop();
  nvsmi.setWanted(false);
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  try {
    if (collector.proc) collector.proc.kill();
  } catch (_) {}
  nvsmi.stop();
});

function actionName(uuid) {
  const u = String(uuid || "");
  return u.startsWith(UUID_PREFIX) ? u.slice(UUID_PREFIX.length) : u.split(".").pop();
}

function handle(msg) {
  const { event, context, payload = {} } = msg;
  switch (event) {
    case "didReceiveGlobalSettings":
      applyGlobal(payload.settings || {});
      break;
    case "willAppear": {
      const pos = realPosition(payload.coordinates);
      keys.set(context, {
        action: actionName(msg.action),
        device: msg.device || "",
        col: pos.col,
        row: pos.row,
        settings: payload.settings || {},
        solo: !!payload.isInMultiAction,
      });
      lastImage.delete(context);
      send({ event: "setTitle", context, payload: { title: "", target: 0 } });
      log.info(`Key added: ${actionName(msg.action)} at column ${pos.col + 1}, row ${pos.row + 1} (reported ${JSON.stringify(payload.coordinates)})`);
      scheduleRender(true);
      break;
    }
    case "willDisappear":
      keys.delete(context);
      lastImage.delete(context);
      roleOf.delete(context);
      scheduleRender(true);
      break;
    case "didReceiveSettings":
      if (keys.has(context)) {
        keys.get(context).settings = payload.settings || {};
        log.info(`Key settings (${keys.get(context).action}): ${JSON.stringify(payload.settings || {})}`);
      }
      scheduleRender(true);
      break;
    case "keyUp":
      onPress(context);
      break;
    case "propertyInspectorDidAppear":
      piContext = context;
      piAction = msg.action;
      sendPiState();
      updateNeeds();
      break;
    case "propertyInspectorDidDisappear":
      if (piContext === context) piContext = null;
      updateNeeds();
      break;
    case "sendToPlugin":
      onPiMessage(context, msg.action, payload);
      break;
    case "systemDidWakeUp":
      scheduleRender(true);
      break;
    default:
      break;
  }
}

function onPiMessage(context, action, p) {
  if (!p || typeof p !== "object") return;
  if (p.type === "settings" && keys.has(context)) {
    keys.get(context).settings = p.settings || {};
    scheduleRender(true);
  } else if (p.type === "global" && p.settings) {
    applyGlobal(p.settings);
  } else if (p.type === "lhm-install") {
    lhm.install(false);
  } else if (p.type === "lhm-apply") {
    lhm.install(true);
  } else if (p.type === "lhm-start") {
    lhm.start();
  } else if (p.type === "open" && /^https:\/\//.test(p.url || "")) {
    send({ event: "openUrl", payload: { url: p.url } });
  } else if (p.type === "retry") {
    lhm.poll();
  } else if (p.type === "hello") {
    piContext = context;
    piAction = action;
    updateNeeds();
  }
  sendPiState();
}

// What the settings panel needs to fill its lists and explain where readings come from.
function sendPiState() {
  if (!piContext) return;
  const info = store.info || {};
  const gpus = store.gpuList().map((g) => ({
    id: g.id,
    name: g.name,
    vendor: g.vendor,
    integrated: !!g.integrated,
    tempSrc: g.src || "",
    hasTemp: Number.isFinite(g.temp),
  }));
  send({
    event: "sendToPropertyInspector",
    action: piAction,
    context: piContext,
    payload: {
      type: "state",
      ready: store.samples > 0,
      status: collector.status,
      statusText: collector.statusText,
      cpu: info.cpu || null,
      cpuTemp: store.cpuTemp ? { src: store.cpuTemp.src } : null,
      sensorSource: store.sensorSource(),
      gpus,
      autoGpu: (store.autoGpu() || {}).id || "",
      drives: store.drives(),
      systemDrive: store.driveId(""),
      adapters: store.adapters(),
      autoAdapter: (store.autoNet() || {}).id || "",
      sensors: store.sensorList(),
      hasBattery: !!store.cur.bat,
      setup: setupState(),
      global: globalSettings,
    },
  });
}
setInterval(() => {
  if (piContext) sendPiState();
}, 3000);

// ------------------------------------------------------------------ key presses
const DEFAULT_PRESS = { cpu: "taskmgr", memory: "taskmgr", gpu: "taskmgr", disk: "taskmgr", network: "taskmgr", system: "taskmgr", sensor: "none" };

function openTarget(target, args = []) {
  try {
    const p = spawn("cmd.exe", ["/c", "start", "", target, ...args], { detached: true, windowsHide: true, stdio: "ignore" });
    p.on("error", (e) => log.warn("Could not open", target, e.message));
    p.unref();
  } catch (e) {
    log.warn("Could not open", target, e.message);
  }
}

function onPress(context) {
  const k = keys.get(context);
  if (!k) return;
  if (k.action === "setup") return pressSetup();
  const press = k.settings.press || DEFAULT_PRESS[k.action] || "none";
  const role = roleOf.get(context);
  switch (press) {
    case "taskmgr":
      return openTarget("taskmgr.exe");
    case "resmon":
      return openTarget("resmon.exe");
    case "drive": {
      const id = store.driveId(k.settings.drive);
      return openTarget("explorer.exe", [id === "*" ? "shell:MyComputerFolder" : id + "\\"]);
    }
    case "netsettings":
      return openTarget("ms-settings:network-status");
    case "power":
      return openTarget(role === "battery" ? "ms-settings:batterysaver" : "ms-settings:powersleep");
    case "none":
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ rendering
let renderTimer = null;
let lastRender = 0;
function scheduleRender(soon) {
  if (renderTimer) {
    if (!soon) return;
    clearTimeout(renderTimer);
  }
  const wait = soon ? 30 : Math.max(0, 250 - (Date.now() - lastRender));
  renderTimer = setTimeout(() => {
    renderTimer = null;
    lastRender = Date.now();
    renderAll();
  }, wait);
}

// Redraw at least every 5 s (uptime, stale data) even without new samples.
setInterval(() => scheduleRender(), 5000);

function renderAll() {
  const byAction = new Map();
  for (const [context, k] of keys) {
    const list = byAction.get(k.action) || [];
    list.push({ context, device: k.device, col: k.col, row: k.row, joinKey: k.action, solo: k.solo || k.settings.join === false || k.action === "setup" });
    byAction.set(k.action, list);
  }
  const ready = collector.status === "running" || store.samples > 0;
  const stale = store.cur.at && Date.now() - store.cur.at > 15000;
  const ctx = { store, setup: setupState() };
  for (const [action, list] of byAction) {
    for (const grp of buildGroups(list)) {
      try {
        grp.cells = grp.keys.map((g) => ({ ...g, settings: (keys.get(g.context) || {}).settings || {} }));
        let content;
        if (action !== "setup" && (!ready || (stale && collector.status !== "running"))) {
          const err = collector.status === "error";
          content = R.statusKeys(grp.w, grp.h, err ? "error" : "starting", err ? collector.statusText || "Not reading" : "Starting…", err ? "See plugin log" : "");
          for (const c of grp.keys) roleOf.delete(c.context);
        } else {
          const res = R.renderGroup(action, grp, ctx);
          content = res.content;
          grp.cells.forEach((c, i) => roleOf.set(c.context, res.roles[i]));
        }
        for (const k of grp.keys) setKey(k.context, S.wrapSvg(content, 144, 144, k.dx * R.PITCH, k.dy * R.PITCH));
      } catch (e) {
        log.error(`Render failed (${action})`, e);
      }
    }
  }
  logLayout();
  updateNeeds();
}

// Logs what each key shows whenever that changes (handy when reading plugin.log).
let lastLayout = "";
function logLayout() {
  const obj = {};
  for (const c of keys.keys()) obj[c] = roleOf.get(c) || "";
  const json = JSON.stringify(obj);
  if (json === lastLayout) return;
  lastLayout = json;
  const human = [...keys.entries()]
    .sort((a, b) => a[1].row - b[1].row || a[1].col - b[1].col)
    .map(([c, k]) => `${k.action}@${k.col + 1},${k.row + 1}=${roleOf.get(c) || "-"}`)
    .join(" ");
  log.info(`Layout: ${human}`);
  log.info(`Roles: ${json}`);
}

// Only ask the collector for what the visible keys (or an open settings panel) use.
function updateNeeds() {
  let gpu = false;
  let top = false;
  let sensors = false;
  for (const [context, k] of keys) {
    const role = roleOf.get(context);
    if (k.action === "gpu" || k.action === "system") gpu = true;
    if (role === "top") top = true;
    if (k.action === "cpu" || k.action === "sensor" || k.action === "setup") sensors = true;
  }
  if (piContext && keys.has(piContext)) {
    const a = keys.get(piContext).action;
    if (a === "sensor" || a === "cpu" || a === "setup") sensors = true;
    if (a === "gpu") gpu = true;
  }
  // Which sensor apps to read, from the Setup key's choice. LibreHardwareMonitor is read
  // through its web server; its WMI interface is only a fallback when that is off.
  const src = globalSettings.source;
  const useLhm = sensors && (src === "auto" || src === "lhm");
  lhm.configure({ port: globalSettings.lhmPort, mode: globalSettings.lhmMode, wanted: useLhm });
  const hwinfo = src === "auto" || src === "hwinfo";
  const wmi = useLhm && !lhm.connected; // only older LibreHardwareMonitor versions offer WMI
  collector.setNeeds({ gpu, top, sensors, hwinfo, wmi });
  updateNvidiaFallback();
}

// ------------------------------------------------------------------ Setup key
const SHORT = { lhm: "LibreHWM", hwinfo: "HWiNFO", ohm: "OpenHWM", amd: "AMD driver", windows: "Windows" };

// What the Setup key and its settings panel show.
function setupState() {
  const src = globalSettings.source;
  const apps = store.apps || {};
  const lhmCount = store.countFrom("lhm:");
  const hwiCount = store.countFrom("hwi:");
  const ohmCount = store.countFrom("ohm:");
  const amdCount = store.countFrom("amd:");
  const lhmInstalled = lhm.installed;
  const base = {
    source: src,
    hasKey: [...keys.values()].some((k) => k.action === "setup"),
    lhm: { installed: lhmInstalled, path: lhm.exePath, running: !!apps.lhm, connected: lhm.connected, mode: lhm.mode, config: lhmInstalled ? lhm.config : null, count: lhmCount, port: lhm.port, error: lhm.lastError, installing: lhm.installing },
    hwinfo: { running: !!apps.hwinfo, count: hwiCount },
    ohm: { running: !!apps.ohm, count: ohmCount },
    amd: { count: amdCount },
    cpuTemp: store.cpuTemp ? store.cpuTemp.src : "",
  };
  const st = (level, word, name, detail, active) => ({ ...base, level, word, name, detail, active: active || "" });
  const ins = lhm.installing;
  if (ins && !ins.done) return st("busy", ins.what === "apply" ? "Applying" : "Installing", "LibreHWM", ins.step);
  if (ins && ins.done && ins.error && Date.now() - (lhm.installEndedAt || 0) < 60000) return st("bad", ins.what === "apply" ? "Not applied" : "Install failed", "LibreHWM", ins.error);
  if (!gotGlobal || !collector.lastSampleAt) return st("busy", "Starting\u2026", "", "");
  const n = (c) => `${c} sensor${c === 1 ? "" : "s"}`;
  const lhmOk = lhm.connected || lhmCount > 0;
  if (src === "none") {
    if (amdCount) return st("ok", "Built-in", SHORT.amd, "No apps used", "amd");
    return st("off", "Built-in", "No apps used", "No CPU temp");
  }
  if (src === "lhm" || (src === "auto" && (lhmOk || (!hwiCount && !ohmCount)))) {
    if (lhmOk) return st("ok", "Connected", SHORT.lhm, lhm.connected ? (lhm.mode === "log" ? "via log file" : n(lhmCount)) : n(lhmCount) + " (WMI)", "lhm");
    if (src === "auto" && hwiCount) return st("ok", "Connected", SHORT.hwinfo, n(hwiCount), "hwinfo");
    if (apps.lhm) return st("warn", lhm.mode === "log" ? "Not logging" : "No web server", SHORT.lhm, "See settings");
    if (lhmInstalled) return st("warn", "Not running", SHORT.lhm, "Press to start");
    if (src === "auto" && apps.hwinfo) return st("warn", "Not sharing", SHORT.hwinfo, "See settings");
    return st(src === "auto" ? "off" : "warn", "Not set up", src === "auto" ? "No sensor app" : SHORT.lhm, "See settings");
  }
  if (src === "hwinfo" || (src === "auto" && hwiCount)) {
    if (hwiCount) return st("ok", "Connected", SHORT.hwinfo, n(hwiCount), "hwinfo");
    if (apps.hwinfo) return st("warn", "Not sharing", SHORT.hwinfo, "See settings");
    return st("warn", "Not running", SHORT.hwinfo, "Start HWiNFO");
  }
  if (ohmCount) return st("ok", "Connected", SHORT.ohm, n(ohmCount), "ohm");
  return st("off", "Not set up", "No sensor app", "See settings");
}

// Pressing the Setup key starts the chosen app, or opens LibreHardwareMonitor's page.
function pressSetup() {
  const st = setupState();
  if (st.active === "lhm" && lhm.connected && lhm.mode === "web") return send({ event: "openUrl", payload: { url: `http://127.0.0.1:${lhm.port}/` } });
  if ((st.source === "auto" || st.source === "lhm") && st.lhm.installed && !st.lhm.running) return lhm.start();
  lhm.poll();
  scheduleRender(true);
}

function setKey(context, svg) {
  const url = S.toDataUrl(svg);
  if (lastImage.get(context) === url) return;
  lastImage.set(context, url);
  send({ event: "setImage", context, payload: { image: url, target: 0 } });
}
