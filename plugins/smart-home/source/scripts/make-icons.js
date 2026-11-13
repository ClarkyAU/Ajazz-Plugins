'use strict';
// Draws the action icons with the plugin's own renderer.
const fs = require('fs');
const path = require('path');
const raster = require('../src/raster');
const render = require('../src/render');

async function makeIcons(dir) {
  await raster.init(path.join(__dirname, '..', 'src', 'assets'));
  fs.mkdirSync(dir, { recursive: true });
  for (const kind of ['setup', 'switch', 'light', 'brightness', 'power', 'plugin']) {
    fs.writeFileSync(path.join(dir, `${kind}.png`), raster.toPng(render.actionIcon(kind), 144));
  }
}

module.exports = { makeIcons };

if (require.main === module) makeIcons(process.argv[2] || path.join(__dirname, '..', 'static')).then(() => console.log('icons done'));
