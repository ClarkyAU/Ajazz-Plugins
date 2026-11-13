'use strict';
// Draws the picker icons (static/*.png) from the same line icons the keys use.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { drawIcon } = require('../src/plugin/icons');

function png(size, iconName, color, file) {
  const pad = size * 0.2;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<rect width="' + size + '" height="' + size + '" rx="' + (size * 0.18) + '" fill="rgb(22,24,28)"/>' +
    drawIcon(iconName, pad, pad, size - pad * 2, color) + '</svg>';
  const out = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
}
const root = path.join(__dirname, '..', 'static');
const blue = 'rgb(125,200,255)', green = 'rgb(74,222,128)';
png(72, 'headset', blue, path.join(root, 'actions', 'headset.png'));
png(144, 'headset', blue, path.join(root, 'keys', 'headset.png'));
png(72, 'plug', green, path.join(root, 'actions', 'setup.png'));
png(144, 'plug', green, path.join(root, 'keys', 'setup.png'));
png(56, 'headset', blue, path.join(root, 'category.png'));
png(144, 'headset', blue, path.join(root, 'plugin.png'));
console.log('icons written');
