'use strict';
// Draws a whole-deck preview (5 x 3 keys + side screen) from the images the fake host collected.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { fontOpts } = require('./checks');

// keys: [{ col, row, svg }]; title: caption
function deckPng(keys, title, file) {
  const K = 144, GAP = 20, PAD = 30, TOP = 56;
  const cols = 6, rows = 3;
  const width = PAD * 2 + cols * K + (cols - 1) * GAP + 14, height = TOP + PAD + rows * K + (rows - 1) * GAP;
  let body = '<rect width="' + width + '" height="' + height + '" fill="rgb(40,42,48)"/>';
  body += '<text x="' + PAD + '" y="38" font-family="Inter" font-size="22" font-weight="600" fill="rgb(232,235,240)">' + title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>';
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const x = PAD + c * (K + GAP) + (c === 5 ? 14 : 0), y = TOP + r * (K + GAP);
    body += '<rect x="' + x + '" y="' + y + '" width="' + K + '" height="' + K + '" rx="10" fill="rgb(14,15,18)"/>';
  }
  keys.forEach((k) => {
    const x = PAD + k.col * (K + GAP) + (k.col === 5 ? 14 : 0), y = TOP + k.row * (K + GAP);
    const inner = k.svg.replace('<svg ', '<svg x="' + x + '" y="' + y + '" ');
    body += inner;
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' + body + '</svg>';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, new Resvg(svg, fontOpts).render().asPng());
}

module.exports = { deckPng };
