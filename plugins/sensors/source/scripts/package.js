"use strict";
// Makes the two zips: the ready-to-install build and the source.
//   dist/SystemVitals-<version>.zip         install.bat, uninstall.bat, install.ps1, README.txt, the .sdPlugin folder
//   dist/SystemVitals-<version>-source.zip  everything needed to build and test

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const { version } = require(path.join(ROOT, "package.json"));
const ID = "com.clarkyau.sysvitals.sdPlugin";

const build = path.join(DIST, `SystemVitals-${version}.zip`);
const source = path.join(DIST, `SystemVitals-${version}-source.zip`);
for (const f of [build, source]) fs.rmSync(f, { force: true });

// never ship a log or the compiled collector cache from a test run
fs.rmSync(path.join(DIST, ID, "plugin.log"), { force: true });
fs.rmSync(path.join(DIST, ID, "plugin.log.1"), { force: true });
fs.rmSync(path.join(DIST, ID, "runtime"), { recursive: true, force: true });

execFileSync("zip", ["-qr", build, ID, "install.bat", "uninstall.bat", "install.ps1", "README.txt"], { cwd: DIST });

const srcFiles = ["README.md", "package.json", "package-lock.json", ".gitignore", "src", "template", "scripts", "test/run-tests.js", "test/fake-host.js", "test/fake-collector.js", "test/fake-nvidia-smi", "test/fake-lhm.js", "test/fake-install-shell", "test/check-svg.js", "test/preview.js", "test/check-collector.ps1"].filter((f) => fs.existsSync(path.join(ROOT, f)));
execFileSync("zip", ["-qr", source, ...srcFiles], { cwd: ROOT });

for (const f of [build, source]) console.log(`${path.relative(ROOT, f)}  ${Math.round(fs.statSync(f).size / 1024)} KB`);
