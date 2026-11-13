'use strict';
// Checks every key image against the Ajazz quirks and the readability rules:
//  - PNG: valid, 144 x 144, not blank
//  - SVG data URLs: no "#" or "%", no url(#…) gradients/filters, no
//    whitespace at the edge of a <tspan> (the software strips it)
//  - drawing (sent along in tests): no text under 19 px, and every piece of
//    text sits fully inside its own key
const path = require('path');
const { PNG } = require('pngjs');
const raster = require('../src/raster');

raster.init(path.join(__dirname, '..', 'src', 'assets'));

function checkDataUrl(url) {
  const problems = [];
  if (typeof url !== 'string') return ['image is not a string'];
  if (url.startsWith('data:image/png;base64,')) {
    try {
      const png = PNG.sync.read(Buffer.from(url.slice(22), 'base64'));
      if (png.width !== 144 || png.height !== 144) problems.push(`PNG is ${png.width}x${png.height}, not 144x144`);
      let min = 255, max = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        const v = png.data[i] + png.data[i + 1] + png.data[i + 2];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min < 30) problems.push('PNG is blank');
    } catch (e) {
      problems.push('PNG does not decode: ' + e.message);
    }
  } else if (url.startsWith('data:image/svg+xml')) {
    const body = url.slice(url.indexOf(',') + 1);
    if (body.includes('#')) problems.push('SVG data URL contains "#"');
    if (body.includes('%')) problems.push('SVG data URL contains "%"');
    if (/url\(/.test(body)) problems.push('SVG uses url(...)');
    const tspans = body.match(/<tspan[^>]*>([^<]*)<\/tspan>/g) || [];
    for (const t of tspans) {
      const inner = t.replace(/^<tspan[^>]*>/, '').replace(/<\/tspan>$/, '');
      if (/^[\s ]|[\s ]$/.test(inner)) problems.push(`tspan has edge whitespace: "${inner}"`);
    }
  } else {
    problems.push('not a PNG or SVG data URL');
  }
  return problems;
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Check the drawing behind a key image. */
function checkSvg(svg) {
  const problems = [];
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  const x0 = vb ? Number(vb[1]) : 0;
  const re = /<text([^>]*)>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const tag = m[1];
    const str = unescape(m[2]);
    const size = Number(attr(tag, 'font-size'));
    const x = Number(attr(tag, 'x'));
    const y = Number(attr(tag, 'y'));
    const weight = Number(attr(tag, 'font-weight')) || 400;
    const anchor = attr(tag, 'text-anchor') || 'start';
    if (!(size >= 19)) problems.push(`text "${str}" is ${size}px (min 19)`);
    const w = raster.textWidth(str, size, weight);
    const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    const right = left + w;
    // Text belonging to another key's window is fine (it is off-screen here)
    // only if it sits fully inside THAT key. Find the key it starts in.
    const keyIndex = Math.floor((left + 14) / 172);
    const kx = keyIndex * 172;
    if (left < kx - 0.5 || right > kx + 144.5) problems.push(`text "${str}" crosses a key edge (${left.toFixed(1)}..${right.toFixed(1)} vs key ${kx}..${kx + 144})`);
    if (y - size * 0.78 < -0.5 || y + size * 0.22 > 144.5) problems.push(`text "${str}" runs off the top/bottom (y ${y}, ${size}px)`);
    void x0;
  }
  return problems;
}

module.exports = { checkDataUrl, checkSvg };
