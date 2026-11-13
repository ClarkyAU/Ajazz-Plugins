// Bundles src/ (with ws, jpeg-js, pngjs and the resvg loader) into the single
// file the Stream Dock software runs: plugin/com.clarkyau.nowplaying.sdPlugin/plugin/index.js
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['bufferutil', 'utf-8-validate'],
  outfile: path.join(root, 'plugin/com.clarkyau.nowplaying.sdPlugin/plugin/index.js'),
  logLevel: 'warning'
});
console.log('Built plugin/com.clarkyau.nowplaying.sdPlugin/plugin/index.js');
