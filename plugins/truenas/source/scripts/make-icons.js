'use strict';
// Renders the plugin's static PNG icons (action list icons and default key images)
// from the same line-icon set the keys use. Run: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { fontOptions } = require('../test/fonts');
const S = require('../src/svg');

const OUT = path.join(__dirname, '..', 'assets', 'static');
fs.mkdirSync(path.join(OUT, 'actions'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'keys'), { recursive: true });

const ACTIONS = {
  setup: ['server', S.C.brand, 'Setup'],
  system: ['cpu', S.C.cpu, 'System'],
  network: ['net', S.C.down, 'Network'],
  storage: ['db', S.C.good, 'Storage'],
  alerts: ['bell', S.C.warn, 'Alerts'],
  app: ['box', S.C.ram, 'App'],
};

function png(svg, width, file) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: fontOptions() });
  fs.writeFileSync(file, r.render().asPng());
}

for (const [name, [ic, col, label]] of Object.entries(ACTIONS)) {
  // list icon: icon only, transparent
  png(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">${S.icon(ic, 12, 12, 48, col, 2.2)}</svg>`, 72, path.join(OUT, 'actions', name + '.png'));
  // default key image
  const key = S.rect(0, 0, 144, 144, S.C.bg) + S.icon(ic, 44, 26, 56, col, 2) +
    S.text(72, 116, label, { size: 18, fill: S.C.text, weight: 700, anchor: 'middle' }) +
    S.text(72, 136, 'TrueNAS', { size: 12, fill: S.C.muted, weight: 600, anchor: 'middle' });
  png(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${key}</svg>`, 144, path.join(OUT, 'keys', name + '.png'));
}
const plug = S.rect(0, 0, 144, 144, S.C.bg, { rx: 28 }) + S.icon('server', 30, 30, 84, S.C.brand, 2);
png(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${plug}</svg>`, 144, path.join(OUT, 'plugin.png'));
png(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">${S.icon('server', 6, 6, 44, 'rgb(230,233,238)', 2.2)}</svg>`, 56, path.join(OUT, 'category.png'));
console.log('icons written to', OUT);
