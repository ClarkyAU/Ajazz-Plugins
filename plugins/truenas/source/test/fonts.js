'use strict';
// Font options for the preview renderer (resvg). Loading every system font is slow,
// so we pick a few files: Segoe UI on Windows (what the Ajazz software uses),
// otherwise Inter, which has similar proportions.
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  ['C:\\Windows\\Fonts', ['segoeui.ttf', 'seguisb.ttf', 'segoeuib.ttf', 'seguisym.ttf'], 'Segoe UI'],
  ['/usr/share/fonts/opentype/inter', ['Inter-Regular.otf', 'Inter-Medium.otf', 'Inter-SemiBold.otf', 'Inter-Bold.otf'], 'Inter'],
  ['/usr/share/fonts/truetype/dejavu', ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'], 'DejaVu Sans'],
];

let cached = null;
function fontOptions() {
  if (cached) return cached;
  for (const [dir, files, family] of CANDIDATES) {
    const found = files.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
    if (found.length) {
      // a symbol font so arrows/ellipsis/degree signs always render
      const extra = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].filter((f) => fs.existsSync(f) && !found.includes(f));
      cached = { loadSystemFonts: false, fontFiles: [...found, ...extra], defaultFontFamily: family, sansSerifFamily: family };
      return cached;
    }
  }
  cached = { loadSystemFonts: true };
  return cached;
}

module.exports = { fontOptions };
