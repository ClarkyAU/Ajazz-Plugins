// Draws the action-list icons (static/*.png) with the plugin's own renderer.
const fs = require('fs');
const path = require('path');
const raster = require('../src/raster');
const render = require('../src/render');
const dir = path.resolve(__dirname, '../plugin/com.clarkyau.nowplaying.sdPlugin');
(async () => {
  for (const f of fs.readdirSync(path.join(dir, 'static'))) fs.unlinkSync(path.join(dir, 'static', f));
  await raster.init(path.join(dir, 'plugin/assets'));
  for (const name of ['plugin', 'art', 'info', 'time', 'progress', 'playpause', 'prev', 'next', 'voldown', 'volup', 'mute']) {
    fs.writeFileSync(path.join(dir, 'static', `${name}.png`), raster.toPng(render.actionIcon(name)));
  }
  console.log('Wrote static/*.png');
})();
