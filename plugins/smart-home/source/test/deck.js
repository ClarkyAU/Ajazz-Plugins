'use strict';
// Draws a picture of the AKP153E (5x3 keys) from key images, for previews.
const fs = require('fs');
const path = require('path');
const raster = require('../src/raster');

raster.init(path.join(__dirname, '..', 'src', 'assets'));

/**
 * keys: Map "col,row" -> image (svg string or data URL)
 * opts: { cols, rows, title, caption }
 */
async function deckPng(keys, file, opts = {}) {
  await raster.init(path.join(__dirname, '..', 'src', 'assets'));
  // AKP153E: 5x3 main keys plus a 3-key side screen (column 5).
  const cols = opts.cols || 6, rows = opts.rows || 3;
  const K = 144, G = 28, P = 36, SIDE = 56;
  const top = opts.title ? 64 : P;
  const xOf = (c) => P + c * (K + G) + (c >= 5 ? SIDE : 0);
  const W = xOf(cols - 1) + K + P;
  const H = top + P + rows * K + (rows - 1) * G + (opts.caption ? 40 : 0);
  let body = `<rect width="${W}" height="${H}" rx="28" fill="rgb(28,28,32)"/>`;
  if (opts.title) body += `<text x="${P}" y="44" font-family="${raster.FONT}" font-size="24" font-weight="600" fill="rgb(220,220,228)">${raster.esc(opts.title)}</text>`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = xOf(c), y = top + r * (K + G);
      const img = keys.get(`${c},${r}`);
      body += `<rect x="${x - 3}" y="${y - 3}" width="${K + 6}" height="${K + 6}" rx="14" fill="rgb(8,8,10)"/>`;
      if (img) {
        const url = img.startsWith('data:') ? img : 'data:image/png;base64,' + raster.toPng(img).toString('base64');
        body += `<image x="${x}" y="${y}" width="${K}" height="${K}" href="${url}"/>`;
      } else {
        body += `<rect x="${x}" y="${y}" width="${K}" height="${K}" rx="10" fill="rgb(20,20,24)"/>`;
      }
    }
  }
  if (cols > 5) body += `<rect x="${xOf(5) - SIDE / 2 - G / 2 - 2}" y="${top - 6}" width="4" height="${rows * K + (rows - 1) * G + 12}" rx="2" fill="rgb(44,44,50)"/>`;
  if (opts.caption) body += `<text x="${P}" y="${H - 22}" font-family="${raster.FONT}" font-size="20" font-weight="500" fill="rgb(150,150,160)">${raster.esc(opts.caption)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">${body}</svg>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, raster.toPng(svg, W));
  return file;
}

module.exports = { deckPng };
