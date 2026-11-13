"use strict";
// Checks one key image against the Ajazz renderer quirks and the readability rules.
// Text is measured with a real font (Inter, which is a little wider than Segoe UI,
// so the check errs on the safe side).

const { Resvg } = require("@resvg/resvg-js");

const fs = require("fs");
// Load just Inter (fast); fall back to system fonts when it is not installed.
const INTER = ["Regular", "SemiBold", "Bold"].map((w) => `/usr/share/fonts/opentype/inter/Inter-${w}.otf`).filter((f) => fs.existsSync(f));
const FONT_OPTS = { font: INTER.length ? { loadSystemFonts: false, fontFiles: INTER, defaultFontFamily: "Inter" } : { loadSystemFonts: true, defaultFontFamily: "Inter" } };
const measureCache = new Map();

function measure(textEl) {
  if (measureCache.has(textEl)) return measureCache.get(textEl);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="400" viewBox="-1000 -200 2000 400">${textEl}</svg>`;
  let box = null;
  try {
    const bb = new Resvg(svg, FONT_OPTS).getBBox();
    if (bb) box = { x: bb.x - 1000, y: bb.y - 200, w: bb.width, h: bb.height };
  } catch (_) {}
  measureCache.set(textEl, box);
  return box;
}

function unescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// returns a list of problems (empty = fine)
function checkImage(url, { label = "" } = {}) {
  const problems = [];
  const bad = (m) => problems.push(`${label}: ${m}`);
  const prefix = "data:image/svg+xml;charset=utf8,";
  if (!url.startsWith(prefix)) {
    bad("not an SVG data URL");
    return problems;
  }
  if (url.includes("#")) bad('contains "#" (key would go blank)');
  if (url.includes("%")) bad('contains "%" (key would go blank)');
  const svg = url.slice(prefix.length);
  if (!svg.startsWith("<svg")) bad("SVG must follow the prefix directly (not encoded)");
  if (/url\(/.test(svg)) bad("uses url(...) (gradients/filters are not supported)");
  if (/<(linearGradient|radialGradient|filter|mask|clipPath|image)\b/.test(svg)) bad("uses an unsupported element");
  if (/fill="#|stroke="#/.test(svg)) bad("hex colour");
  if (!/width="144" height="144"/.test(svg)) bad("image is not 144x144");
  if (/<tspan[^>]*>\s|\s<\/tspan>/.test(svg)) bad("a tspan starts or ends with whitespace (stripped by the renderer)");
  if (/<text[^>]*>\s|\s<\/text>/.test(svg)) bad("a text starts or ends with whitespace (stripped by the renderer)");

  // render must succeed
  try {
    new Resvg(svg, FONT_OPTS).render();
  } catch (e) {
    bad("SVG does not render: " + e.message);
    return problems;
  }

  // the group offset of this key inside a joined display
  let ox = 0;
  let oy = 0;
  const g = /<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)">/.exec(svg);
  if (g && svg.indexOf(g[0]) < 200) {
    ox = -Number(g[1]);
    oy = -Number(g[2]);
  }
  const texts = svg.match(/<text\b[^>]*>.*?<\/text>/g) || [];
  for (const t of texts) {
    const size = Number((/font-size="([\d.]+)"/.exec(t) || [])[1]);
    const content = unescape(t.replace(/<[^>]+>/g, ""));
    for (const m of t.matchAll(/font-size="([\d.]+)"/g)) if (Number(m[1]) < 19) bad(`text "${content}" has ${m[1]}px text (minimum 19px)`);
    const box = measure(t);
    if (!box) continue;
    // in key coordinates
    const x1 = box.x - ox;
    const x2 = x1 + box.w;
    const y1 = box.y - oy;
    const y2 = y1 + box.h;
    const visible = x2 > 0 && x1 < 144 && y2 > 0 && y1 < 144;
    if (!visible) continue; // belongs to a neighbouring key of the same display
    const tol = 1.5;
    if (x1 < -tol || x2 > 144 + tol || y1 < -tol || y2 > 144 + tol) {
      bad(`text "${content}" (${size}px) runs outside its key: x ${x1.toFixed(1)}..${x2.toFixed(1)}, y ${y1.toFixed(1)}..${y2.toFixed(1)}`);
    }
  }
  return problems;
}

module.exports = { checkImage };
