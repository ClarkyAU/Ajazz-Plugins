'use strict';
// Automatic checks every key image must pass (the quirks of the real AKP153E / Ajazz software).
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const fontFiles = ['Inter-Regular.otf', 'Inter-SemiBold.otf', 'Inter-Bold.otf'].map((f) => path.join('/usr/share/fonts/opentype/inter', f)).filter((f) => fs.existsSync(f));
const fontOpts = { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' } };

function textElements(svg) {
  const out = [];
  const re = /<text\b([^>]*)>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = {};
    m[1].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
    out.push({ attrs, content: m[2], raw: m[0] });
  }
  return out;
}

function measure(t) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">' + t.raw.replace(/ x="[^"]*"/, ' x="200"') + '</svg>';
  const r = new Resvg(svg, fontOpts);
  const b = r.getBBox();
  return b ? { width: b.width, left: b.x, right: b.x + b.width } : { width: 0, left: 200, right: 200 };
}

function checkImage(name, url) {
  const problems = [];
  const prefix = 'data:image/svg+xml;charset=utf8,';
  if (typeof url !== 'string' || !url.startsWith(prefix)) { return ['not an unencoded svg data URL']; }
  const svg = url.slice(prefix.length);
  if (/[#%]/.test(url)) problems.push('contains # or % (key would go blank)');
  if (/url\(/.test(svg)) problems.push('uses url(#id)');
  if (/<filter|<linearGradient|<radialGradient/.test(svg)) problems.push('uses gradient or filter');
  if (/<tspan/.test(svg)) problems.push('uses tspan');
  if (!/width="144" height="144"/.test(svg)) problems.push('not 144 x 144');
  if (/&nbsp;| /.test(svg)) problems.push('non-breaking space');
  textElements(svg).forEach((t) => {
    const size = parseFloat(t.attrs['font-size']);
    if (!(size >= 19)) problems.push('text "' + t.content + '" is ' + size + ' px (min 19)');
    if (/^\s|\s$/.test(t.content)) problems.push('text "' + t.content + '" has edge space');
    const m = measure(t);
    const cx = parseFloat(t.attrs.x);
    // measured with x moved to 200: translate back
    const left = cx + (m.left - 200), right = cx + (m.right - 200);
    if (left < 4 || right > 140) problems.push('text "' + t.content + '" runs outside the key (' + left.toFixed(0) + '..' + right.toFixed(0) + ')');
  });
  try { new Resvg(svg, fontOpts).render(); } catch (e) { problems.push('does not render: ' + e.message); }
  return problems.map((p) => name + ': ' + p);
}

module.exports = { checkImage, textElements, measure, fontOpts };
