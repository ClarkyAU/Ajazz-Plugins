// Writes manifest.json and en.json for the plugin.
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '../plugin/com.clarkyau.nowplaying.sdPlugin');
const ID = 'com.clarkyau.nowplaying';
const pkg = require('../package.json');

const actions = [
  ['art', 'Album Art', 'The album cover. Neighbouring Album Art keys share one big picture.'],
  ['info', 'Track Info', 'Title, artist, album or player. Keys side by side work as one display, and long names scroll across them.'],
  ['time', 'Time', 'Time left or time played in the song.'],
  ['progress', 'Progress Bar', 'How far through the song. Neighbouring Progress Bar keys share one bar.'],
  ['playpause', 'Play / Pause', 'Play or pause the music.'],
  ['prev', 'Previous Track', 'Go back a track.'],
  ['next', 'Next Track', 'Skip to the next track.'],
  ['voldown', 'Volume Down', 'Turn the Windows volume down.'],
  ['volup', 'Volume Up', 'Turn the Windows volume up.'],
  ['mute', 'Mute', 'Mute or unmute Windows sound.']
];

const manifest = {
  SDKVersion: 1,
  Author: 'clarkyau',
  Name: 'Now Playing',
  Description: 'Album art, track info, time and progress across your keys, plus media controls. Works with Spotify, browsers and any player in the Windows volume popup - no sign-in.',
  Icon: 'static/plugin.png',
  Category: 'Now Playing',
  CategoryIcon: 'static/plugin.png',
  CodePathWin: 'plugin/index.js',
  Version: pkg.version,
  URL: '',
  OS: [{ Platform: 'windows', MinimumVersion: '10' }],
  Software: { MinimumVersion: '3.10.188.226' },
  Nodejs: { Version: '20' },
  Actions: actions.map(([id, name, tip]) => ({
    UUID: `${ID}.${id}`,
    Name: name,
    Tooltip: tip,
    Icon: `static/${id}.png`,
    States: [{ Image: `static/${id}.png`, TitleAlignment: 'bottom', FontSize: '10', ShowTitle: false }],
    Controllers: ['Keypad', 'Information'],
    Settings: {},
    DisableAutomaticStates: true,
    SupportedInMultiActions: false,
    UserTitleEnabled: false,
    VisibleInActionsList: true,
    PropertyInspectorPath: 'propertyInspector/index.html'
  }))
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const en = { Name: manifest.Name, Description: manifest.Description, Category: manifest.Category };
for (const [id, name, tip] of actions) en[`${ID}.${id}`] = { Name: name, Tooltip: tip };
fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(en, null, 2));
console.log('Wrote manifest.json and en.json');
