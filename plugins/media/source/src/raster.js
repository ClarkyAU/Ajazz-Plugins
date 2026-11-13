'use strict';
// Turns SVG into PNG with resvg (WebAssembly) and the bundled Barlow Semi
// Condensed font. Drawing the key images ourselves means:
//   - text can be measured exactly (so it always fits inside one key),
//   - the Stream Dock software's SVG quirks ("#", "%", tspan spaces) never apply,
//   - every PC shows the same font.

const fs = require('fs');
const path = require('path');
const { initWasm, Resvg } = require('@resvg/resvg-wasm');

const FONT = 'Barlow Semi Condensed';
let ready = null;
let fonts = [];

function init(assetDir) {
  if (!ready) {
    fonts = fs.readdirSync(assetDir)
      .filter((f) => f.endsWith('.ttf'))
      .map((f) => new Uint8Array(fs.readFileSync(path.join(assetDir, f))));
    ready = initWasm(fs.readFileSync(path.join(assetDir, 'resvg.wasm')));
  }
  return ready;
}

const opts = (width) => ({
  fitTo: { mode: 'width', value: width },
  font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: FONT },
  shapeRendering: 2,
  textRendering: 1,
  imageRendering: 0
});

function toPng(svg, width = 144) {
  const r = new Resvg(svg, opts(width));
  const img = r.render();
  const png = Buffer.from(img.asPng());
  if (img.free) img.free();
  if (r.free) r.free();
  return png;
}

const toDataUrl = (svg, width = 144) => `data:image/png;base64,${toPng(svg, width).toString('base64')}`;

const widthCache = new Map();
// Exact rendered width of a line of text, in pixels.
function textWidth(text, size, weight = 600) {
  const key = `${weight}|${size}|${text}`;
  if (widthCache.has(key)) return widthCache.get(key);
  let w = 0;
  if (String(text).trim()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="200">` +
      `<text x="0" y="150" font-family="${FONT}" font-size="${size}" font-weight="${weight}" xml:space="preserve">${esc(text)}</text></svg>`;
    try {
      const r = new Resvg(svg, opts(6000));
      const box = r.getBBox();
      w = box ? box.width : 0;
      if (box && box.free) box.free();
      if (r.free) r.free();
    } catch (_) {
      w = String(text).length * size * 0.5;
    }
  } else {
    w = String(text).length * size * 0.22;
  }
  if (widthCache.size > 5000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

function esc(s) {
  return String(s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { init, toPng, toDataUrl, textWidth, esc, FONT };
