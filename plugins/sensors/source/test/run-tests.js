"use strict";
// End-to-end tests: runs the built plugin against the fake Ajazz host with a fake
// collector, checks every key image against the renderer quirks, checks the
// settings-panel data, and writes deck previews to test/out/.

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { FakeHost, sleep } = require("./fake-host");
const { checkImage } = require("./check-svg");
const { writePreview } = require("./preview");
const { realPosition, reportedPosition, buildGroups } = require("../src/layout");
const { parseLine, FULL } = require("../src/nvidia");
const { Store, pickSensor, CPU_TEMP_PREFS } = require("../src/store");
const { resample } = require("../src/render");
const { startFakeLhm } = require("./fake-lhm");
const { parseTree, parseLog, csvSplit } = require("../src/lhm");
const os = require("os");
// A fake LibreHardwareMonitor log file, written the way its Logger writes it.
function startFakeLog(dir) {
  const ids = ["/amdcpu/0/temperature/2", "/amdcpu/0/power/0", "/lpc/nct6798d/0/fan/1", "/lpc/nct6798d/0/voltage/0", "/gpu-amd/0/temperature/0"];
  const names = ["Core (Tctl/Tdie)", "Package", "Fan #2", "Vcore", "GPU Core"];
  const d = new Date();
  const file = path.join(dir, `LibreHardwareMonitorLog-${d.toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, "," + ids.join(",") + "\r\n" + "Time," + names.map((n) => `"${n}"`).join(",") + "\r\n");
  const row = () => {
    const t = Date.now() / 1000;
    const v = [55 + 10 * Math.sin(t / 7), 48 + 20 * Math.sin(t / 5), 950 + 120 * Math.sin(t / 9), 1.2 + 0.1 * Math.sin(t), 52];
    fs.appendFileSync(file, new Date().toLocaleString("en-US") + "," + v.map((x) => String(x)).join(",") + "\r\n");
  };
  row();
  const timer = setInterval(row, 1000);
  return { file, stop: () => clearInterval(timer) };
}
const net = require("net");
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

let failures = 0;
const results = [];
function ok(name, cond, detail) {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "\n      " + detail : ""}`);
  if (!cond) failures++;
}

// ------------------------------------------------------------------ unit checks
function unitTests() {
  // key positions: the hardware order quirk, both directions
  let roundTrip = true;
  for (let col = 0; col < 6; col++)
    for (let row = 0; row < 3; row++) {
      const p = realPosition(reportedPosition(col, row));
      if (p.col !== col || p.row !== row) roundTrip = false;
    }
  ok("key position mapping round-trips for all 18 keys", roundTrip);
  ok("reported {column:2,row:0} is real column 5 row 3 (as seen in the TrueNAS log)", JSON.stringify(realPosition({ column: 2, row: 0 })) === JSON.stringify({ col: 4, row: 2 }));
  ok("side screen is reported normally", JSON.stringify(realPosition({ column: 5, row: 1 })) === JSON.stringify({ col: 5, row: 1 }));

  // grouping never joins the main keys and the side screen
  const g = buildGroups([
    { context: "a", device: "d", col: 4, row: 0, joinKey: "cpu" },
    { context: "b", device: "d", col: 5, row: 0, joinKey: "cpu" },
  ]);
  ok("main keys and side screen never join", g.length === 2);

  // nvidia-smi output parsing
  const d = parseLine("00000000:0A:00.0, 45, 30.12, 200.00, [N/A], 210, 405", FULL);
  ok("nvidia-smi line parses (bus, temp, power, N/A fan)", d && d.bus === 10 && d.temp === 45 && d.power === 30.12 && d.fanPct === null && d.memClock === 405);

  // CPU temperature sensor picking
  const m = new Map();
  const add = (id, hw, name, type, v) => m.set(id, { id, hw, name, type, v });
  add("hwi:1", "ASUS PRIME B550 (Nuvoton NCT6798D)", "CPU", "temp", 41);
  add("hwi:2", "CPU [#0]: AMD Ryzen 5 5600X: Enhanced", "CPU (Tctl/Tdie)", "temp", 63);
  add("hwi:3", "GPU [#0]: NVIDIA GeForce RTX 3070", "GPU Temperature", "temp", 55);
  ok("CPU temperature prefers HWiNFO's Tctl/Tdie over the motherboard CPU reading", pickSensor(m, "temp", CPU_TEMP_PREFS, "cpu").id === "hwi:2");
  const m2 = new Map();
  m2.set("lhm:/intelcpu/0/temperature/10", { id: "lhm:/intelcpu/0/temperature/10", hw: "Intel Core i7-12700K", name: "Core Max", type: "temp", v: 70 });
  m2.set("lhm:/intelcpu/0/temperature/11", { id: "lhm:/intelcpu/0/temperature/11", hw: "Intel Core i7-12700K", name: "CPU Package", type: "temp", v: 72 });
  ok("CPU temperature picks LibreHardwareMonitor's CPU Package", pickSensor(m2, "temp", CPU_TEMP_PREFS, "cpu").name === "CPU Package");
  const m3 = new Map();
  m3.set("amd:cpu-temp", { id: "amd:cpu-temp", hw: "CPU (AMD driver)", name: "CPU Temperature", type: "temp", v: 55 });
  ok("CPU temperature from the AMD graphics driver is used when nothing better is running", (pickSensor(m3, "temp", CPU_TEMP_PREFS, "cpu") || {}).id === "amd:cpu-temp");
  m3.set("hwi:2", { id: "hwi:2", hw: "CPU [#0]: AMD Ryzen 5 5600X: Enhanced", name: "CPU (Tctl/Tdie)", type: "temp", v: 63 });
  ok("HWiNFO's CPU reading wins over the AMD driver's", pickSensor(m3, "temp", CPU_TEMP_PREFS, "cpu").id === "hwi:2");

  // LibreHardwareMonitor web server tree
  const lr = parseTree(require("./fake-lhm").tree());
  const tctl = lr.find((r) => r.id === "lhm:/amdcpu/0/temperature/2");
  ok("LibreHardwareMonitor data.json is read (CPU Tctl under the CPU)", tctl && tctl.hw === "AMD Ryzen 7 5700X" && tctl.type === "temp" && tctl.v > 0, JSON.stringify(tctl));
  ok("LibreHardwareMonitor sub-hardware names are kept (fan under the Nuvoton chip)", lr.some((r) => r.type === "fan" && r.hw === "Nuvoton NCT6798D"));

  // LibreHardwareMonitor log file
  ok("log CSV split keeps quoted commas", JSON.stringify(csvSplit('Time,"Fan, front","CPU"')) === JSON.stringify(["Time", "Fan, front", "CPU"]));
  const lg = parseLog(",/amdcpu/0/temperature/2,/lpc/nct6798d/0/fan/1,/nvme/0/load/30", 'Time,"Core (Tctl/Tdie)","Fan #2","Used Space"', "10/19/2026 13:40:01,61.25,1012,");
  ok("log line is read (temperature, fan; empty value skipped)", lg.length === 2 && lg[0].type === "temp" && lg[0].v === 61.25 && lg[0].hw === "CPU" && lg[1].type === "fan" && /Motherboard/.test(lg[1].hw), JSON.stringify(lg));
  ok("log and web server give the same sensor ids (Sensor keys keep working when switching)", lg[0].id === "lhm:/amdcpu/0/temperature/2" && tctl.id === lg[0].id);

  // history resampling
  const r = resample([1, 1, 3, 3, NaN, NaN], 3);
  ok("graph resampling averages buckets and keeps gaps", r[0] === 1 && r[1] === 3 && Number.isNaN(r[2]));

  // store: drive letters map to physical disks; "All" sums
  const s = new Store();
  s.add({ cpu: { load: 10, cores: [10] }, mem: { total: 100, avail: 40 }, disks: [{ id: "0 C:", act: 5, rd: 10, wr: 1 }, { id: "1 D: E:", act: 50, rd: 20, wr: 2 }, { id: "_Total", act: 1, rd: 30, wr: 3 }], vols: [], nets: [], sys: {} });
  ok("drive E: maps to physical disk '1 D: E:'", s.diskFor("E:").id === "1 D: E:");
  const all = s.diskFor("*");
  ok("All drives: busiest activity, summed speeds", all.act === 50 && all.rd === 30 && all.wr === 3);
}

// ------------------------------------------------------------------ scenarios
const row = (action, r, cols, settings) => cols.map((c) => ({ action, col: c, row: r, settings: typeof settings === "function" ? settings(c) : settings || {} }));

const SCENARIOS = [
  {
    name: "1-automatic-rows",
    title: "Automatic layouts: one row per key type (desktop, NVIDIA + HWiNFO)",
    profile: "desktop",
    keys: [...row("cpu", 0, [0, 1, 2, 3, 4]), ...row("gpu", 1, [0, 1, 2, 3, 4]), ...row("network", 2, [0, 1]), ...row("disk", 2, [2, 3, 4]), ...row("system", 0, [5]), ...row("system", 1, [5]), ...row("system", 2, [5])],
    expect: { "0,0": "load", "1,0": "temp", "2,0": "clock", "3,0": "graph", "4,0": "graph", "0,1": "load", "1,1": "temp", "2,1": "vram", "0,2": "down", "1,2": "up", "2,2": "activity", "3,2": "read", "4,2": "graph", "5,0": "summary", "5,1": "uptime", "5,2": "graph" },
  },
  {
    name: "2-blocks-laptop",
    title: "Blocks: CPU 3x3, memory 2x2, network row (laptop, AMD + Intel graphics, battery)",
    profile: "laptop",
    keys: [
      ...row("cpu", 0, [0, 1, 2]),
      ...row("cpu", 1, [0, 1, 2]),
      ...row("cpu", 2, [0, 1, 2]),
      ...row("memory", 0, [3, 4]),
      ...row("memory", 1, [3, 4]),
      ...row("network", 2, [3, 4]),
      { action: "system", col: 5, row: 0, settings: { show: "battery" } },
      { action: "gpu", col: 5, row: 1, settings: { show: "temp" } },
      { action: "disk", col: 5, row: 2, settings: { show: "space" } },
    ],
    expect: { "0,0": "load", "1,0": "temp", "2,0": "clock", "0,1": "graph", "0,2": "cores", "3,0": "used", "4,0": "amount", "3,1": "graph", "5,0": "battery", "5,1": "temp", "5,2": "space" },
  },
  {
    name: "3-every-choice",
    title: "Chosen per key: GPU details, disks, network, apps, sensors",
    profile: "desktop",
    keys: [
      { action: "gpu", col: 0, row: 0, settings: { show: "power" } },
      { action: "gpu", col: 1, row: 0, settings: { show: "fan" } },
      { action: "gpu", col: 2, row: 0, settings: { show: "clock" } },
      { action: "gpu", col: 3, row: 0, settings: { show: "vram", gpu: "00000000_0000E1A2" } },
      { action: "gpu", col: 4, row: 0, settings: { show: "temp", tempUnit: "F" } },
      { action: "disk", col: 0, row: 1, settings: { show: "free", drive: "D:" } },
      { action: "disk", col: 1, row: 1, settings: { show: "rw" } },
      { action: "disk", col: 2, row: 1, settings: { show: "write", drive: "*" } },
      { action: "network", col: 3, row: 1, settings: { show: "link" } },
      { action: "network", col: 4, row: 1, settings: { show: "ip" } },
      { action: "cpu", col: 0, row: 2, settings: { show: "top" } },
      { action: "memory", col: 1, row: 2, settings: { show: "top" } },
      { action: "sensor", col: 2, row: 2, settings: { sensor: "hwi:E0001-0-3000000" } },
      { action: "sensor", col: 3, row: 2, settings: { sensor: "hwi:E0001-0-2000003" } },
      { action: "sensor", col: 4, row: 2, settings: { sensor: "hwi:F0000300-0-7000000", join: false } },
      { action: "cpu", col: 5, row: 0, settings: { show: "power" } },
      { action: "cpu", col: 5, row: 1, settings: { show: "cores" } },
      { action: "memory", col: 5, row: 2, settings: { show: "commit" } },
    ],
    expect: { "0,0": "power", "1,0": "fan", "3,0": "vram", "1,1": "rw", "0,2": "top", "2,2": "value", "3,2": "graph", "4,2": "value", "5,1": "cores" },
    pi: [2, 2],
  },
  {
    name: "4-graphs",
    title: "Wide graphs: 5-key CPU cores, 4-key network graph, 3-key GPU graph, sensor graph",
    profile: "desktop",
    keys: [
      ...row("cpu", 0, [0, 1, 2, 3, 4], { show: "cores" }),
      { action: "network", col: 0, row: 1, settings: { show: "both" } },
      ...row("network", 1, [1, 2, 3, 4], { show: "graph", graphTime: "60" }),
      ...row("gpu", 2, [0, 1, 2], { show: "graph" }),
      ...row("sensor", 2, [3, 4], { show: "graph", sensor: "hwi:F0000300-0-1000000", label: "CPU" }),
      ...row("system", 0, [5]),
      { action: "system", col: 5, row: 1, settings: { show: "procs" } },
      { action: "system", col: 5, row: 2, settings: { show: "battery" } },
    ],
    expect: { "0,0": "cores", "4,0": "cores", "0,1": "both", "1,1": "graph", "0,2": "graph", "3,2": "graph", "5,2": "battery" },
  },
  {
    name: "5-no-sensors-nvidia-smi",
    title: "Older PC: no sensor app, NVIDIA readings through nvidia-smi",
    profile: "bare",
    keys: [...row("cpu", 0, [0, 1, 2, 3, 4], (c) => ({ show: ["load", "temp", "power", "clock", "graph"][c] })), ...row("gpu", 1, [0, 1, 2, 3, 4], (c) => ({ show: ["load", "temp", "power", "fan", "clock"][c] })), ...row("sensor", 2, [0]), ...row("disk", 2, [1, 2], (c) => ({ show: c === 1 ? "space" : "free", drive: "F:" })), ...row("memory", 2, [3, 4])],
    expect: { "1,0": "temp", "0,2": "value", "3,2": "used" },
    pi: [0, 0],
  },
  {
    name: "7-setup-lhm",
    title: "Setup key: LibreHardwareMonitor connected (your Ryzen 7 5700X + RX 9070 XT)",
    profile: "ryzen",
    env: { FAKE_APPS: JSON.stringify({ lhm: true }) },
    before: async (sc) => {
      sc.server = await startFakeLhm(0);
      sc.globals = { source: "auto", lhmPort: sc.server.address().port };
    },
    after: async (sc) => sc.server.close(),
    keys: [
      ...row("cpu", 0, [0, 1, 2, 3, 4]),
      ...row("gpu", 1, [0, 1, 2], (c) => ({ show: ["load", "temp", "hot"][c] })),
      ...row("sensor", 1, [3, 4], (c) => ({ sensor: "lhm:/lpc/nct6798d/0/fan/1", label: c === 3 ? "CPU fan" : "" })),
      ...row("memory", 2, [0, 1]),
      ...row("network", 2, [2, 3, 4]),
      { action: "setup", col: 5, row: 0 },
      { action: "cpu", col: 5, row: 1, settings: { show: "temp" } },
      { action: "cpu", col: 5, row: 2, settings: { show: "power" } },
    ],
    expect: { "0,0": "load", "1,0": "temp", "2,0": "clock", "3,0": "graph", "5,0": "status", "5,1": "temp", "3,1": "value", "4,1": "graph" },
    pi: [5, 0],
    waitMs: 6000,
  },
  {
    name: "8-setup-install",
    title: "Setup key: LibreHardwareMonitor not set up, then installed from the settings panel",
    profile: "ryzen",
    before: async (sc) => {
      sc.port = await freePort();
      sc.globals = { source: "lhm", lhmPort: sc.port };
    },
    during: async (host, sc) => {
      const setupCtx = host.contextAt(5, 0);
      sc.textBefore = host.textOf(setupCtx);
      sc.tempBefore = host.textOf(host.contextAt(0, 0));
      host.openPI(setupCtx);
      await sleep(600);
      host.toPlugin(setupCtx, { type: "lhm-install" });
      await sleep(400);
      sc.textDuring = host.textOf(setupCtx);
      await sleep(1500);
      sc.server = await startFakeLhm(sc.port); // "LibreHardwareMonitor started"
      await sleep(4500);
      sc.textAfter = host.textOf(setupCtx);
      sc.tempAfter = host.textOf(host.contextAt(0, 0));
    },
    after: async (sc) => sc.server && sc.server.close(),
    keys: [{ action: "cpu", col: 0, row: 0, settings: { show: "temp" } }, { action: "sensor", col: 1, row: 0 }, { action: "setup", col: 5, row: 0 }],
    expect: {},
    waitMs: 3500,
  },
  {
    name: "9-no-setup-key",
    title: "No Setup key yet: keys that need a sensor app say so",
    profile: "ryzen",
    keys: [{ action: "cpu", col: 0, row: 0, settings: { show: "temp" } }, { action: "cpu", col: 1, row: 0, settings: { show: "power" } }, { action: "sensor", col: 2, row: 0 }],
    expect: {},
    waitMs: 3500,
  },
  {
    name: "10-setup-lhm-log",
    title: "Setup key: LibreHardwareMonitor read through its log file, then switched to the web server",
    profile: "ryzen",
    before: async (sc) => {
      sc.dir = fs.mkdtempSync(path.join(os.tmpdir(), "lhm-"));
      fs.writeFileSync(path.join(sc.dir, "LibreHardwareMonitor.config"), '<?xml version="1.0" encoding="utf-8"?><configuration><appSettings><add key="logSensorsMenuItem" value="true" /><add key="runWebServerMenuItem" value="false" /></appSettings></configuration>');
      sc.fake = startFakeLog(sc.dir);
      sc.env = { SYSVITALS_LHM_DIR: sc.dir, SYSVITALS_LHM_INSTALLED: "1", FAKE_APPS: JSON.stringify({ lhm: true }) };
      sc.port = await freePort();
      sc.globals = { source: "lhm", lhmMode: "log", lhmPort: sc.port };
    },
    during: async (host, sc) => {
      const setupCtx = host.contextAt(5, 0);
      sc.textLog = host.textOf(setupCtx);
      sc.tempLog = host.textOf(host.contextAt(0, 0));
      host.openPI(setupCtx);
      await sleep(800);
      sc.stLog = host.piMessages.filter((p) => p.type === "state").pop();
      // switch to the web server: the panel saves the global setting, then Apply
      const g = { source: "lhm", lhmMode: "web", lhmPort: sc.port };
      host.send({ event: "didReceiveGlobalSettings", payload: { settings: g } });
      await sleep(600);
      sc.stSwitched = host.piMessages.filter((p) => p.type === "state").pop();
      host.toPlugin(setupCtx, { type: "lhm-apply" });
      await sleep(1500);
      sc.server = await startFakeLhm(sc.port);
      await sleep(4000);
      sc.textWeb = host.textOf(setupCtx);
    },
    after: async (sc) => {
      sc.fake.stop();
      if (sc.server) sc.server.close();
    },
    keys: [{ action: "cpu", col: 0, row: 0, settings: { show: "temp" } }, { action: "sensor", col: 1, row: 0, settings: { sensor: "lhm:/lpc/nct6798d/0/fan/1" } }, { action: "setup", col: 5, row: 0 }],
    expect: {},
    waitMs: 4000,
  },
  {
    name: "6-collector-fails",
    title: "Collector cannot start: keys say so",
    profile: "crash",
    keys: [...row("cpu", 0, [0, 1]), ...row("gpu", 1, [0])],
    expect: {},
    waitMs: 3500,
  },
];

async function runScenario(sc) {
  if (sc.before) await sc.before(sc);
  const host = new FakeHost({ profile: sc.profile, env: sc.env || {}, globals: sc.globals || {} });
  await host.start();
  host.place(sc.keys);
  await sleep(sc.waitMs || 4500);
  if (sc.during) await sc.during(host, sc);
  if (sc.pi) {
    const ctx = host.contextAt(sc.pi[0], sc.pi[1]);
    host.openPI(ctx);
    await sleep(800);
  }
  // let the graphs fill a little more
  await sleep(500);
  await host.stop();
  if (sc.after) await sc.after(sc);

  const logText = fs.readFileSync(path.join(__dirname, "..", "dist", "com.clarkyau.sysvitals.sdPlugin", "plugin.log"), "utf8");

  // every key got an image
  const missing = [...host.keys.keys()].filter((c) => !host.images.has(c));
  ok(`${sc.name}: every key has an image`, missing.length === 0, missing.join(", "));

  // quirk checks on every image ever sent (not just the last)
  const problems = [];
  let count = 0;
  for (const ev of host.events) {
    if (ev.event !== "setImage") continue;
    count++;
    const k = host.keys.get(ev.context) || {};
    for (const p of checkImage(ev.payload.image, { label: `${k.action} @ col ${k.col + 1} row ${k.row + 1}` })) problems.push(p);
  }
  const uniq = [...new Set(problems)];
  ok(`${sc.name}: all ${count} key images pass the quirk checks`, uniq.length === 0, uniq.slice(0, 12).join("\n      "));

  // roles chosen for keys (logged by the fake collector's needs + via images is hard; check the log)
  writePreview(path.join(OUT, `${sc.name}.png`), host.keys, host.images, sc.title);

  // roles: use the plugin's debug dump in the log
  const roleLines = logText.split("\n").filter((l) => l.includes("Roles:"));
  const lastRoles = roleLines.length ? JSON.parse(roleLines[roleLines.length - 1].split("Roles: ")[1]) : {};
  for (const [pos, want] of Object.entries(sc.expect)) {
    const [c, r] = pos.split(",").map(Number);
    const ctx = host.contextAt(c, r);
    ok(`${sc.name}: key at col ${c + 1} row ${r + 1} shows "${want}"`, lastRoles[ctx] === want, `got "${lastRoles[ctx]}"`);
  }
  return { host, logText };
}

async function main() {
  unitTests();
  const logFile = path.join(__dirname, "..", "dist", "com.clarkyau.sysvitals.sdPlugin", "plugin.log");
  for (const sc of SCENARIOS) {
    try {
      fs.unlinkSync(logFile);
    } catch (_) {}
    const { host, logText } = await runScenario(sc);
    fs.copyFileSync(logFile, path.join(OUT, `${sc.name}.log`));
    if (sc.name === "1-automatic-rows") {
      ok("collector was asked for GPU + sensors, not busiest apps", /fake collector got: need gpu=1 top=0 sensors=1/.test(logText));
      ok("no errors in the plugin log", !/\[ERROR\]/.test(logText), (logText.match(/.*\[ERROR\].*/g) || []).join("\n      "));
    }
    if (sc.name === "3-every-choice") {
      ok("busiest-app readings were switched on for the Top keys", /need gpu=1 top=1 sensors=1/.test(logText));
      const st = host.piMessages.filter((p) => p.type === "state").pop();
      ok("settings panel gets the GPU list", st && st.gpus.length === 2 && st.gpus[0].name.includes("RTX"), JSON.stringify(st && st.gpus));
      ok("settings panel gets the sensor list", st && st.sensors.length >= 10 && st.sensorSource === "HWiNFO", st && st.sensorSource);
      ok("settings panel gets drives and adapters", st && st.drives.length === 3 && st.adapters.length === 3);
      ok("Automatic adapter skips the virtual WSL adapter", st && st.autoAdapter === "{A1}", st && st.autoAdapter);
      ok("no errors in the plugin log", !/\[ERROR\]/.test(logText), (logText.match(/.*\[ERROR\].*/g) || []).join("\n      "));
    }
    if (sc.name === "5-no-sensors-nvidia-smi") {
      ok("nvidia-smi fallback started when the driver library is missing", /Using nvidia-smi/.test(logText));
      const st = host.piMessages.filter((p) => p.type === "state").pop();
      ok("GPU temperature arrives through nvidia-smi", st && st.gpus[0].hasTemp === true, JSON.stringify(st && st.gpus));
      ok("settings panel says CPU temperature is not available", st && st.cpuTemp === null);
    }
    if (sc.name === "7-setup-lhm") {
      const t = host.textOf(host.contextAt(5, 0));
      ok("Setup key shows LibreHardwareMonitor connected", /Connected/.test(t) && /LibreHWM/.test(t) && /sensors/.test(t), t);
      ok("CPU temperature comes from LibreHardwareMonitor", /TEMP/.test(host.textOf(host.contextAt(5, 1))) && !/Setup/.test(host.textOf(host.contextAt(5, 1))), host.textOf(host.contextAt(5, 1)));
      ok("CPU power comes from LibreHardwareMonitor", /POWER/.test(host.textOf(host.contextAt(5, 2))), host.textOf(host.contextAt(5, 2)));
      ok("web server used, so the slower WMI route is switched off", /need gpu=1 top=0 sensors=1 hwinfo=1 wmi=0/.test(logText), (logText.match(/fake collector got: .*/g) || []).join(" / "));
      const st = host.piMessages.filter((p) => p.type === "state").pop();
      ok("Setup settings panel gets the LibreHardwareMonitor status", st && st.setup && st.setup.lhm.connected === true && st.setup.active === "lhm", JSON.stringify(st && st.setup));
    }
    if (sc.name === "8-setup-install") {
      ok("before install: Setup key says not set up", /Not set up/.test(sc.textBefore) && /LibreHWM/.test(sc.textBefore), sc.textBefore);
      ok("before install: CPU temperature key says Finish the Setup key", /Finish the/.test(sc.tempBefore) && /Setup key/.test(sc.tempBefore), sc.tempBefore);
      ok("during install: Setup key shows progress", /Installing/.test(sc.textDuring), sc.textDuring);
      ok("install asks Windows for permission (RunAs) and reports success", /asking Windows for permission/.test(logText) && /installed and started/.test(logText), (logText.match(/.*LibreHardwareMonitor.*/g) || []).join("\n      "));
      ok("after install: Setup key shows connected", /Connected/.test(sc.textAfter), sc.textAfter);
      ok("after install: CPU temperature shows a value", /TEMP/.test(sc.tempAfter), sc.tempAfter);
    }
    if (sc.name === "10-setup-lhm-log") {
      ok("log file: Setup key shows connected (log)", /Connected/.test(sc.textLog) && /via log file/.test(sc.textLog), sc.textLog);
      ok("log file: CPU temperature shows a value", /TEMP/.test(sc.tempLog) && !/Setup/.test(sc.tempLog), sc.tempLog);
      ok("log file: settings panel reports the log mode and LibreHardwareMonitor's own setting", sc.stLog && sc.stLog.setup.lhm.mode === "log" && sc.stLog.setup.lhm.config && sc.stLog.setup.lhm.config.log === true, JSON.stringify(sc.stLog && sc.stLog.setup.lhm));
      ok("switching to web server shows the mismatch (so the panel offers Apply)", sc.stSwitched && sc.stSwitched.setup.lhm.mode === "web" && sc.stSwitched.setup.lhm.config.web === false, JSON.stringify(sc.stSwitched && sc.stSwitched.setup.lhm));
      ok("Apply asks Windows for permission with the new setting", /Switching LibreHardwareMonitor to its web setting/.test(logText) && /settings applied and restarted/.test(logText), (logText.match(/.*LibreHardwareMonitor.*/g) || []).join("\n      "));
      ok("after Apply: connected through the web server", /Connected/.test(sc.textWeb) && /sensors/.test(sc.textWeb), sc.textWeb);
    }
    if (sc.name === "9-no-setup-key") {
      const t = host.textOf(host.contextAt(0, 0));
      ok("without a Setup key, the CPU temperature key says Add the Setup key", /Add the/.test(t) && /Setup/.test(t), t);
      ok("without a Setup key, the Sensor key says Add the Setup key", /Add the/.test(host.textOf(host.contextAt(2, 0))), host.textOf(host.contextAt(2, 0)));
    }
    if (sc.name === "6-collector-fails") {
      ok("collector failure is logged", /Collector failed to compile/.test(logText) && /Collector stopped \(code 3\)/.test(logText));
    }
  }
  console.log(results.join("\n"));
  console.log(`\n${results.length - failures} passed, ${failures} failed. Previews in ${path.relative(process.cwd(), OUT)}/`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
