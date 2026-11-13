'use strict';
// Key pictures (144 x 144 SVG). Rules from the Ajazz quirks: no "#" or "%" anywhere in the
// data URL, rgb() colours only, no gradients/filters, text >= 19 px, main text about 34-50 px.

const BG = 'rgb(24,26,31)';
const LINE = 'rgb(232,235,240)';
const MUTED = 'rgb(154,162,174)';
const GOOD = 'rgb(74,222,128)';
const WARN = 'rgb(251,191,36)';
const BAD = 'rgb(248,81,73)';
const FONT = 'Segoe UI, Arial, sans-serif';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/#/g, '＃').replace(/%/g, '％');
}

// Line icon: steering wheel
function wheelIcon(cx, cy, r, color) {
  const hub = r * 0.28;
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${hub}" fill="none" stroke="${color}" stroke-width="4"/>`,
    `<line x1="${cx - r}" y1="${cy}" x2="${cx - hub}" y2="${cy}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`,
    `<line x1="${cx + hub}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`,
    `<line x1="${cx}" y1="${cy + hub}" x2="${cx}" y2="${cy + r}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`,
  ].join('');
}

function key({ color, word, wordSize, sub }) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">',
    `<rect width="144" height="144" fill="${BG}"/>`,
    wheelIcon(72, 36, 22, color),
    `<text x="72" y="96" text-anchor="middle" font-family="${FONT}" font-size="${wordSize || 34}" font-weight="700" fill="${color}">${esc(word)}</text>`,
    sub ? `<text x="72" y="126" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${MUTED}">${esc(sub)}</text>` : '',
    '</svg>',
  ].join('');
  return svg;
}

function render(state) {
  switch (state.state) {
    case 'found': return key({ color: GOOD, word: 'Linked', sub: 'port ' + state.port });
    case 'noserver': return key({ color: WARN, word: 'No link', sub: 'Pit House' });
    case 'nopithouse': return key({ color: WARN, word: 'Closed', sub: 'Pit House' });
    case 'busy': return key({ color: WARN, word: 'Working', wordSize: 28, sub: 'wait 10 s' });
    case 'work': return key({ color: GOOD, word: 'Work', sub: 'Moza R5' });
    case 'standby': return key({ color: WARN, word: 'Standby', wordSize: 30, sub: 'Moza R5' });
    case 'done': return key({ color: GOOD, word: 'Done', sub: 'see log' });
    case 'error': return key({ color: BAD, word: 'Error', sub: 'see log' });
    default: return key({ color: MUTED, word: 'Moza R5', wordSize: 28, sub: 'press' });
  }
}

function toDataUrl(svg) { return 'data:image/svg+xml;charset=utf8,' + svg; }

module.exports = { render, toDataUrl, esc };
