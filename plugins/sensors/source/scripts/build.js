"use strict";
// Builds dist/com.clarkyau.sysvitals.sdPlugin: bundles the plugin into one
// plugin/index.js (with the Windows collector embedded), writes the manifest,
// settings panel and icons.

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const { Resvg } = require("@resvg/resvg-js");

const ROOT = path.resolve(__dirname, "..");
const ID = "com.clarkyau.sysvitals";
const OUT = path.join(ROOT, "dist", ID + ".sdPlugin");
const pkg = require(path.join(ROOT, "package.json"));
const S = require(path.join(ROOT, "src", "svg.js"));

const ACTIONS = [
  ["setup", "Setup", "Choose and set up the sensor app (LibreHardwareMonitor or HWiNFO) and see if it is working", "sliders", S.C.sys],
  ["cpu", "CPU", "CPU load, temperature, clock speed, cores and busiest app", "cpu", S.C.cpu],
  ["memory", "Memory", "Memory used, free, committed and biggest app", "ram", S.C.mem],
  ["gpu", "GPU", "Graphics card load, temperature, video memory, power, fan and clock (NVIDIA, AMD, Intel)", "gpu", S.C.nvidia],
  ["disk", "Disk", "Drive activity, read and write speed, space used and free", "disk", S.C.disk],
  ["network", "Network", "Download and upload speed, adapter, link speed and IP address", "net", S.C.down],
  ["system", "System", "Overview, uptime, battery and number of processes", "monitor", S.C.sys],
  ["sensor", "Sensor", "Any reading from HWiNFO or LibreHardwareMonitor: temperatures, fans, voltages", "sensor", S.C.sensor],
];

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true, defaultFontFamily: "Inter" } }).render().asPng();
}

function iconSvg(name, color, size, { bg = null, label = null } = {}) {
  let body = "";
  if (bg) body += `<rect x="0" y="0" width="144" height="144" rx="${bg === "round" ? 28 : 0}" fill="${S.C.bg}"/>`;
  if (label) {
    body += S.icon(name, 40, 22, 64, color, 2.2);
    body += S.text(72, 122, label.toUpperCase(), { size: 22, fill: S.C.muted, weight: 700, anchor: "middle" });
  } else body += S.icon(name, 24, 24, 96, color, 2.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144">${body}</svg>`;
}

function pluginIconSvg() {
  // a heartbeat line over a chip: "vitals"
  const pulse = '<path d="M14 80h26l12-30 18 56 14-40 10 14h36" fill="none" stroke="rgb(45,212,191)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="30" fill="rgb(18,20,25)"/><rect x="30" y="30" width="84" height="84" rx="14" fill="none" stroke="rgb(54,58,67)" stroke-width="6"/>${pulse}</svg>`;
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "plugin"), { recursive: true });
  fs.mkdirSync(path.join(OUT, "pi"), { recursive: true });
  fs.mkdirSync(path.join(OUT, "static", "actions"), { recursive: true });
  fs.mkdirSync(path.join(OUT, "static", "keys"), { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "index.js")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: path.join(OUT, "plugin", "index.js"),
    loader: { ".ps1": "text", ".cs": "text" },
    external: ["bufferutil", "utf-8-validate"],
    legalComments: "none",
    logLevel: "warning",
  });

  fs.copyFileSync(path.join(ROOT, "template", "pi", "index.html"), path.join(OUT, "pi", "index.html"));

  const manifest = {
    Actions: ACTIONS.map(([id, name, tip]) => ({
      UUID: `${ID}.${id}`,
      Name: name,
      Tooltip: tip,
      Icon: `static/actions/${id}.png`,
      PropertyInspectorPath: "pi/index.html",
      DisableAutomaticStates: true,
      UserTitleEnabled: false,
      SupportedInMultiActions: false,
      Controllers: ["Keypad", "Information"],
      Settings: {},
      States: [{ Image: `static/keys/${id}.png`, TitleAlignment: "bottom", FontSize: "10", ShowTitle: false }],
    })),
    SDKVersion: 1,
    Author: "clarkyau",
    Name: "System Vitals",
    Description: "Live CPU, memory, GPU (NVIDIA, AMD, Intel), disk, network and sensor readings for this PC.",
    Icon: "static/plugin.png",
    Category: "System Vitals",
    CategoryIcon: "static/category.png",
    CodePathWin: "plugin/index.js",
    Version: pkg.version,
    URL: "https://github.com/clarkyau",
    OS: [{ Platform: "windows", MinimumVersion: "10" }],
    Software: { MinimumVersion: "3.10.188.226" },
    Nodejs: { Version: "20" },
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const en = { Name: manifest.Name, Description: manifest.Description, Category: manifest.Category };
  for (const [id, name, tip] of ACTIONS) en[`${ID}.${id}`] = { Name: name, Tooltip: tip };
  en.Localization = {};
  fs.writeFileSync(path.join(OUT, "en.json"), JSON.stringify(en, null, 2) + "\n");

  for (const [id, name, , iconName, color] of ACTIONS) {
    fs.writeFileSync(path.join(OUT, "static", "actions", `${id}.png`), png(iconSvg(iconName, color, 72), 72));
    fs.writeFileSync(path.join(OUT, "static", "keys", `${id}.png`), png(iconSvg(iconName, color, 144, { bg: "square", label: name }), 144));
  }
  fs.writeFileSync(path.join(OUT, "static", "plugin.png"), png(pluginIconSvg(), 144));
  fs.writeFileSync(path.join(OUT, "static", "category.png"), png(pluginIconSvg(), 56));

  // Windows files get CRLF line endings; install.ps1 gets a BOM so PowerShell 5.1 reads it as UTF-8.
  const crlf = (t) => t.replace(/\r?\n/g, "\r\n");
  for (const f of ["install.bat", "uninstall.bat"]) fs.writeFileSync(path.join(ROOT, "dist", f), crlf(fs.readFileSync(path.join(ROOT, "scripts", f), "utf8")));
  fs.writeFileSync(path.join(ROOT, "dist", "install.ps1"), "\uFEFF" + crlf(fs.readFileSync(path.join(ROOT, "scripts", "install.ps1"), "utf8")));
  fs.writeFileSync(path.join(ROOT, "dist", "README.txt"), crlf(fs.readFileSync(path.join(ROOT, "scripts", "README-install.txt"), "utf8")));

  const size = fs.statSync(path.join(OUT, "plugin", "index.js")).size;
  console.log(`Built ${path.relative(ROOT, OUT)} (plugin/index.js ${Math.round(size / 1024)} KB, v${pkg.version})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
