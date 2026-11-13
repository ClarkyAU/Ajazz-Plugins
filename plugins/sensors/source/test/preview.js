"use strict";
// Draws the whole AKP153E (5x3 keys + 3-key side screen) with the key images the
// plugin sent, so layouts can be checked by eye.

const fs = require("fs");
const { Resvg } = require("@resvg/resvg-js");

const K = 144;
const GAP = 28;
const PAD = 36;
const SIDE_GAP = 56;

function keyXY(col, row) {
  const x = PAD + col * (K + GAP) + (col >= 5 ? SIDE_GAP - GAP : 0);
  return { x, y: PAD + 44 + row * (K + GAP) };
}

function deckSvg(keys, images, title) {
  const W = keyXY(5, 0).x + K + PAD;
  const H = keyXY(0, 2).y + K + PAD;
  let body = `<rect width="${W}" height="${H}" rx="26" fill="rgb(28,29,32)"/>`;
  body += `<text x="${PAD}" y="${PAD + 14}" font-family="Inter" font-size="20" font-weight="700" fill="rgb(150,155,165)">${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
  const side = keyXY(5, 0);
  body += `<rect x="${side.x - 10}" y="${side.y - 10}" width="${K + 20}" height="${3 * K + 2 * GAP + 20}" rx="14" fill="rgb(18,19,21)"/>`;
  const taken = new Map();
  for (const [ctx, k] of keys) taken.set(`${k.col},${k.row}`, ctx);
  let defs = "";
  let n = 0;
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 3; row++) {
      const { x, y } = keyXY(col, row);
      const ctx = taken.get(`${col},${row}`);
      const img = ctx && images.get(ctx);
      if (!img) {
        body += `<rect x="${x}" y="${y}" width="${K}" height="${K}" rx="16" fill="rgb(40,41,45)"/>`;
        continue;
      }
      const svg = img.slice("data:image/svg+xml;charset=utf8,".length);
      const id = `k${++n}`;
      defs += `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${K}" height="${K}" rx="16"/></clipPath>`;
      const inner = svg.replace(/^<svg[^>]*>/, `<svg x="${x}" y="${y}" width="${K}" height="${K}" viewBox="0 0 ${K} ${K}">`);
      body += `<g clip-path="url(#${id})">${inner}</g>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
}

function writePreview(file, keys, images, title) {
  const svg = deckSvg(keys, images, title);
  const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Inter" }, fitTo: { mode: "zoom", value: 1 } }).render().asPng();
  fs.writeFileSync(file, png);
}

module.exports = { writePreview, deckSvg };
