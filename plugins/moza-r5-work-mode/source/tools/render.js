'use strict';
// SVG -> PNG helpers for icons, previews and tests (Inter fonts only, like the earlier plugins' tests).
const { Resvg } = require('@resvg/resvg-js');
const FONTS = ['/usr/share/fonts/opentype/inter/Inter-Regular.otf', '/usr/share/fonts/opentype/inter/Inter-Bold.otf'];
function opts(extra) {
  return { font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }, ...(extra || {}) };
}
function toPng(svg, width) {
  const r = new Resvg(svg, opts(width ? { fitTo: { mode: 'width', value: width } } : {}));
  return r.render().asPng();
}
// Bounding box of just the text/graphics (background rect removed) to check things stay inside a key.
function contentBox(svg) {
  const stripped = svg.replace(/<rect[^>]*\/>/, '');
  const r = new Resvg(stripped, opts());
  return r.getBBox();
}
module.exports = { toPng, contentBox };
