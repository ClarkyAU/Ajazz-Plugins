"use strict";
// A fake Ajazz / Stream Dock host: starts the built plugin exactly like the real
// software (-port -pluginUUID -registerEvent -info), places keys using the
// AKP153E's hardware-order coordinates, and records every image the plugin sends.

const path = require("path");
const { spawn } = require("child_process");
const { WebSocketServer } = require("ws");
const { reportedPosition } = require("../src/layout");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN = path.join(ROOT, "dist", "com.clarkyau.sysvitals.sdPlugin", "plugin", "index.js");
const NODE = process.env.NODE20 || process.execPath;
const DEVICE = "0123456789abcdef0123456789abcdef"; // made-up device id

class FakeHost {
  constructor({ profile = "desktop", env = {}, globals = {} } = {}) {
    this.profile = profile;
    this.env = env;
    this.globals = globals; // the plugin's global settings (Setup key)
    this.images = new Map(); // context -> data url
    this.keys = new Map(); // context -> {action, col, row, settings}
    this.piMessages = [];
    this.events = [];
    this.logLines = [];
  }

  async start() {
    this.wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((res) => this.wss.on("listening", res));
    const port = this.wss.address().port;
    this.connected = new Promise((res) => {
      this.wss.on("connection", (ws) => {
        ws.on("message", (buf) => {
          const msg = JSON.parse(buf.toString());
          if (msg.event === "registerPlugin") {
            this.ws = ws;
            res();
          }
          this.onMessage(msg);
        });
      });
    });
    const info = {
      application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.22631", version: "3.10.200.0" },
      plugin: { uuid: "com.clarkyau.sysvitals", version: "1.0.0" },
      devices: [{ id: DEVICE, name: "AKP153E_TESTDECK", size: { columns: 6, rows: 3 }, type: 0 }],
    };
    const env = {
      ...process.env,
      SYSVITALS_COLLECTOR: JSON.stringify([NODE, path.join(__dirname, "fake-collector.js"), this.profile]),
      SYSVITALS_NVIDIA_SMI: path.join(__dirname, "fake-nvidia-smi"),
      SYSVITALS_INSTALL_SHELL: path.join(__dirname, "fake-install-shell"),
      PATH: path.dirname(NODE) + path.delimiter + process.env.PATH,
      ...this.env,
    };
    this.proc = spawn(NODE, [PLUGIN, "-port", String(port), "-pluginUUID", "com.clarkyau.sysvitals", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], { env, stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stderr.on("data", (d) => this.logLines.push("STDERR " + d));
    await this.connected;
  }

  onMessage(msg) {
    this.events.push(msg);
    if (msg.event === "getGlobalSettings") this.send({ event: "didReceiveGlobalSettings", payload: { settings: this.globals } });
    if (msg.event === "setGlobalSettings") this.globals = msg.payload;
    if (msg.event === "setImage") this.images.set(msg.context, msg.payload.image);
    if (msg.event === "sendToPropertyInspector") this.piMessages.push(msg.payload);
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  // keys: [{action, col, row, settings}] with real (on-screen) columns 0-4 and side screen 5
  place(keys) {
    let n = 0;
    for (const k of keys) {
      const context = `ctx${++n}_${k.action}_${k.col}_${k.row}`;
      this.keys.set(context, k);
      this.send({
        event: "willAppear",
        action: `com.clarkyau.sysvitals.${k.action}`,
        context,
        device: DEVICE,
        payload: { coordinates: reportedPosition(k.col, k.row), settings: k.settings || {}, isInMultiAction: false, controller: "Keypad" },
      });
    }
  }

  openPI(context) {
    const k = this.keys.get(context);
    this.send({ event: "propertyInspectorDidAppear", action: `com.clarkyau.sysvitals.${k.action}`, context, device: DEVICE });
  }

  changeSettings(context, settings) {
    const k = this.keys.get(context);
    k.settings = settings;
    this.send({ event: "didReceiveSettings", action: `com.clarkyau.sysvitals.${k.action}`, context, device: DEVICE, payload: { settings, coordinates: reportedPosition(k.col, k.row) } });
  }

  toPlugin(context, payload) {
    const k = this.keys.get(context);
    this.send({ event: "sendToPlugin", action: `com.clarkyau.sysvitals.${k.action}`, context, payload });
  }

  textOf(context) {
    const img = this.images.get(context) || "";
    return (img.match(/<text\b[^>]*>.*?<\/text>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(" | ");
  }

  press(context) {
    const k = this.keys.get(context);
    const base = { action: `com.clarkyau.sysvitals.${k.action}`, context, device: DEVICE, payload: { settings: k.settings || {}, coordinates: reportedPosition(k.col, k.row) } };
    this.send({ ...base, event: "keyDown" });
    this.send({ ...base, event: "keyUp" });
  }

  contextAt(col, row) {
    for (const [c, k] of this.keys) if (k.col === col && k.row === row) return c;
    return null;
  }

  async stop() {
    try {
      this.ws.close();
    } catch (_) {}
    await new Promise((res) => {
      if (!this.proc || this.proc.exitCode != null) return res();
      const t = setTimeout(() => {
        this.proc.kill("SIGKILL");
        res();
      }, 3000);
      this.proc.on("exit", () => {
        clearTimeout(t);
        res();
      });
    });
    this.wss.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { FakeHost, sleep, PLUGIN, DEVICE };
