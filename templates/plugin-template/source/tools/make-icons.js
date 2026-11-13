'use strict';
// Draws the picture files the manifest points at (plugin, category, action and default key images).
// Same look as the keys: dark square, line icon. Change the icon names to suit your plugin.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-wasm');
const { initWasm } = require('@resvg/resvg-wasm');

const ICONS = {
  gauge: '<path d="M6 34a18 18 0 1 1 36 0"/><path d="M24 34l8-11"/><circle cx="24" cy="34" r="2"/>',
  plug: '<path d="M16 4v10M32 4v10"/><path d="M10 14h28v8a14 14 0 0 1-28 0z"/><path d="M24 36v8"/>'
};

function svg(name, size, color) {
  const pad = Math.round(size * 0.14);
  const inner = size - pad * 2;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<rect width="' + size + '" height="' + size + '" rx="' + Math.round(size * 0.16) + '" fill="rgb(22,24,28)"/>' +
    '<g transform="translate(' + pad + ' ' + pad + ') scale(' + (inner / 48) + ')" fill="none" stroke="' + color +
    '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</g></svg>';
}

async function make(plugDir) {
  try { await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))); } catch (e) { /* already started */ }
  const files = [
    ['static/plugin.png', 'gauge', 256, 'rgb(125,200,255)'],
    ['static/category.png', 'gauge', 56, 'rgb(125,200,255)'],
    ['static/actions/example.png', 'gauge', 40, 'rgb(232,235,240)'],
    ['static/actions/setup.png', 'plug', 40, 'rgb(232,235,240)'],
    ['static/keys/example.png', 'gauge', 144, 'rgb(74,222,128)'],
    ['static/keys/setup.png', 'plug', 144, 'rgb(251,191,36)']
  ];
  files.forEach((f) => {
    const out = path.join(plugDir, f[0]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, new Resvg(svg(f[1], f[2], f[3])).render().asPng());
  });
}

module.exports = { make };
