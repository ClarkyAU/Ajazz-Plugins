// Pretend media.ps1 for tests. Settings come from environment variables:
//   FAKE_STATUS (playing|paused|none), FAKE_TITLE, FAKE_ARTIST, FAKE_ALBUM, FAKE_APP,
//   FAKE_DURATION, FAKE_POSITION (seconds), FAKE_ART (file, or "none"),
//   FAKE_COMMANDS (file that receives every command the plugin sends)
const fs = require('fs');
const path = require('path');
const env = process.env;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const status = env.FAKE_STATUS || 'playing';
let state = status === 'none'
  ? { type: 'state', status: 'none', title: '', artist: '', album: '', app: '', duration: 0, position: 0, updated: 0 }
  : {
    type: 'state', status,
    title: env.FAKE_TITLE ?? 'Wilt', artist: env.FAKE_ARTIST ?? 'Spiritbox', album: env.FAKE_ALBUM ?? 'Rotoscope',
    app: env.FAKE_APP ?? 'Spotify.exe',
    duration: Number(env.FAKE_DURATION ?? 231), position: Number(env.FAKE_POSITION ?? 74), updated: Date.now()
  };
out(state);
if (status !== 'none' && env.FAKE_ART !== 'none') {
  const file = env.FAKE_ART || path.join(__dirname, 'fixtures', 'art.jpg');
  setTimeout(() => out({ type: 'art', key: 'x', mime: 'image/jpeg', data: fs.readFileSync(file).toString('base64') }), 80);
}
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const cmd = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (env.FAKE_COMMANDS) fs.appendFileSync(env.FAKE_COMMANDS, cmd + '\n');
    if (cmd === 'playpause' && state.status !== 'none') {
      state = { ...state, status: state.status === 'playing' ? 'paused' : 'playing', updated: Date.now() };
      out(state);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
