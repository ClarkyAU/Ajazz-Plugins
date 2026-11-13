'use strict';
// Builds the installable plugin folder:
//   dist/com.clarkyau.smarthome.sdPlugin/
//     manifest.json, en.json, README.txt
//     plugin/index.js      (everything bundled with esbuild)
//     plugin/assets/       (renderer + fonts)
//     propertyInspector/   (settings panel)
//     static/              (action icons, drawn by the plugin's own renderer)
// plus install.bat / uninstall.bat next to it.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DEF = require('../plugin-files/actions');
const UUID = DEF.id;
const OUT = path.join(ROOT, 'dist', `${UUID}.sdPlugin`);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function writeManifest() {
  const actions = DEF.actions.map((a) => ({
    UUID: `${DEF.id}.${a.key}`,
    Name: a.name,
    Tooltip: a.tooltip,
    Icon: `static/${a.key}.png`,
    States: [{ Image: `static/${a.key}.png`, TitleAlignment: 'bottom', FontSize: '10', ShowTitle: false }],
    Controllers: [],
    Settings: {},
    DisableAutomaticStates: true,
    SupportedInMultiActions: false,
    UserTitleEnabled: false,
    VisibleInActionsList: true,
    PropertyInspectorPath: 'propertyInspector/index.html',
  }));
  const manifest = {
    Actions: actions,
    SDKVersion: 1,
    Author: 'clarkyau',
    Name: DEF.name,
    Icon: 'static/plugin.png',
    CodePathWin: 'plugin/index.js',
    Description: DEF.description,
    Category: DEF.name,
    CategoryIcon: 'static/plugin.png',
    Version: DEF.version,
    URL: 'https://iot.tuya.com/',
    OS: [{ Platform: 'windows', MinimumVersion: '10' }],
    Software: { MinimumVersion: '3.10.188.226' },
    Nodejs: { Version: '20' },
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const en = { Name: DEF.name, Description: DEF.description, Category: DEF.name };
  for (const a of DEF.actions) en[`${DEF.id}.${a.key}`] = { Name: a.name, Tooltip: a.tooltip };
  fs.writeFileSync(path.join(OUT, 'en.json'), JSON.stringify(en, null, 2));
}

async function main() {
  fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'plugin'), { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'index.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: path.join(OUT, 'plugin', 'index.js'),
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'warning',
    legalComments: 'inline',
  });

  // The handover code for the old plugin folder (see src/bridge.js)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'bridge.js')],
    bundle: true, platform: 'node', target: 'node20', format: 'cjs',
    outfile: path.join(OUT, 'plugin', 'bridge.js'),
    external: ['bufferutil', 'utf-8-validate'], logLevel: 'warning',
  });

  copyDir(path.join(ROOT, 'src', 'assets'), path.join(OUT, 'plugin', 'assets'));
  copyDir(path.join(ROOT, 'propertyInspector'), path.join(OUT, 'propertyInspector'));
  fs.copyFileSync(path.join(ROOT, 'plugin-files', 'README.txt'), path.join(OUT, 'README.txt'));
  writeManifest();
  for (const f of ['install.bat', 'install.ps1', 'uninstall.bat', 'uninstall.ps1']) {
    fs.copyFileSync(path.join(ROOT, 'installer', f), path.join(ROOT, 'dist', f));
  }

  // Action icons
  const { makeIcons } = require('./make-icons');
  await makeIcons(path.join(OUT, 'static'));

  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  console.log(`Built ${manifest.Name} ${manifest.Version} -> ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
