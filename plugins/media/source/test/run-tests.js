'use strict';
// Runs every test and writes whole-deck previews to test/out/.
//   node test/run-tests.js            (after "npm run build")
// The plugin itself runs on Node 20 (the Stream Dock software's version).

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PNG } = require('pngjs');
const { runScenario, node20 } = require('./mock-host');
const layout = require('../src/layout');
const { fromV1, fromV2, cleanKeySettings } = require('../src/settings');
const { migrateProfile, oldSettingsFromLog } = require('../src/migrate');
const raster = require('../src/raster');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (msg) => console.log('  ok   ' + msg);
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
function check(cond, msg) { if (cond) ok(msg); else fail(msg); }

// ---------------------------------------------------------------------------
// Quirk checks for every image the plugin sent
// ---------------------------------------------------------------------------
function checkImage(image, where) {
  const problems = [];
  if (typeof image !== 'string') return ['no image'];
  if (image.startsWith('data:image/png;base64,')) {
    try {
      const png = PNG.sync.read(Buffer.from(image.slice(22), 'base64'));
      if (png.width !== 144 || png.height !== 144) problems.push(`PNG is ${png.width}x${png.height}, not 144x144`);
    } catch (e) { problems.push('PNG does not decode: ' + e.message); }
  } else if (image.startsWith('data:image/svg+xml;charset=utf8,')) {
    const svg = image.slice(image.indexOf(',') + 1);
    if (svg.includes('#')) problems.push('"#" in SVG data URL');
    if (svg.includes('%')) problems.push('"%" in SVG data URL');
    if (/<tspan[^>]*>\s|\s<\/tspan>/.test(svg)) problems.push('space at the edge of a tspan');
  } else {
    problems.push('not a PNG or SVG data URL');
  }
  return problems.map((p) => `${where}: ${p}`);
}

function checkTexts(entry, where) {
  const problems = [];
  for (const t of entry.texts || []) {
    if (t.size < 19) problems.push(`${where}: text "${t.value}" is ${t.size}px (min 19)`);
    if (!t.scrolling && (t.x0 < -0.5 || t.x1 > 144.5)) problems.push(`${where}: text "${t.value}" runs off the key (${t.x0.toFixed(1)}..${t.x1.toFixed(1)})`);
    if (t.strip && entry.action !== 'info') problems.push(`${where}: only Track Info may scroll across keys`);
  }
  if (entry.action === 'time') {
    const big = Math.max(...entry.texts.map((t) => t.size));
    if (big < 38) problems.push(`${where}: time number only ${big}px`);
  }
  return problems;
}

function quirkCheck(res) {
  const problems = [];
  for (const m of res.sent) {
    if (m.event === 'setImage') problems.push(...checkImage(m.payload.image, `${res.name} ${m.context}`));
  }
  for (const t of res.traces) problems.push(...checkTexts(t, `${res.name} ${t.context} (${t.resolved || t.action})`));
  const images = res.sent.filter((m) => m.event === 'setImage').length;
  if (problems.length) problems.slice(0, 12).forEach(fail);
  else ok(`${res.name}: all ${images} images and ${res.traces.reduce((n, t) => n + (t.texts || []).length, 0)} text pieces pass the quirk checks`);
  if (res.stderr.trim()) fail(`${res.name}: plugin printed errors: ${res.stderr.slice(0, 300)}`);
  if (/uncaughtException|draw error|render error|unhandledRejection/.test(res.log)) fail(`${res.name}: errors in plugin.log:\n${res.log.split('\n').filter((l) => /Exception|error/.test(l)).slice(0, 5).join('\n')}`);
}

// ---------------------------------------------------------------------------
// Whole-deck preview (main keys + side screen), drawn with the same renderer
// ---------------------------------------------------------------------------
async function preview(res, snapIndex, file, title, others = []) {
  await raster.init(path.join(ROOT, 'plugin/com.clarkyau.nowplaying.sdPlugin/plugin/assets'));
  const S = 144, G = 28, M = 36, SIDE = 70, TOP = 64;
  const W = M * 2 + 5 * S + 4 * G + SIDE + S, H = TOP + 3 * S + 2 * G + M;
  const posOf = (k) => {
    let col = k.col, row = k.row;
    if (k.raw && col < 5) { const i = row * 5 + col; col = 4 - Math.floor(i / 3); row = i % 3; }
    return { col, row };
  };
  const xy = ({ col, row }) => ({ x: col >= 5 ? M + 5 * S + 4 * G + SIDE : M + col * (S + G), y: TOP + row * (S + G) });
  let body = `<rect width="${W}" height="${H}" fill="rgb(38,38,44)"/>` +
    `<text x="${M}" y="40" font-family="Barlow Semi Condensed" font-size="26" font-weight="600" fill="rgb(235,235,240)">${raster.esc(title)}</text>` +
    `<rect x="${M + 5 * S + 4 * G + SIDE - 14}" y="${TOP - 14}" width="${S + 28}" height="${3 * S + 2 * G + 28}" rx="22" fill="rgb(24,24,28)"/>`;
  // empty key slots
  for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) {
    const p = xy({ col: c, row: r });
    body += `<rect x="${p.x}" y="${p.y}" width="${S}" height="${S}" rx="16" fill="rgb(52,52,58)"/>`;
  }
  const imgs = res.snapshots[snapIndex].images;
  res.keys.forEach((k, i) => {
    const p = xy(posOf(k));
    if (!imgs[i]) return;
    body += `<clipPath id="c${i}"><rect x="${p.x}" y="${p.y}" width="${S}" height="${S}" rx="16"/></clipPath>` +
      `<image x="${p.x}" y="${p.y}" width="${S}" height="${S}" href="${imgs[i]}" clip-path="url(#c${i})"/>`;
  });
  for (const o of others) { // keys belonging to other plugins
    const p = xy(posOf(o));
    body += `<rect x="${p.x}" y="${p.y}" width="${S}" height="${S}" rx="16" fill="rgb(70,70,78)"/>` +
      `<text x="${p.x + S / 2}" y="${p.y + S / 2 + 8}" text-anchor="middle" font-family="Barlow Semi Condensed" font-size="22" font-weight="600" fill="rgb(190,190,200)">${raster.esc(o.label)}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  fs.writeFileSync(path.join(OUT, file), raster.toPng(svg, W));
  return file;
}

// ---------------------------------------------------------------------------
// Unit checks
// ---------------------------------------------------------------------------
function units() {
  console.log('Layout and settings');
  const mk = (list) => list.map(([action, c, r, s = {}]) => ({ action, col: c, row: r, device: 'd', settings: { join: true, show: 'auto', ...s } }));
  const find = (keys, c, r) => keys.find((k) => k.col === c && k.row === r);
  // album art keys share one picture; stand-alone keys get their own
  let keys = mk([['art', 0, 0], ['art', 1, 0], ['art', 0, 1], ['art', 1, 1], ['art', 3, 0, { join: false }], ['art', 4, 0]]);
  layout.resolveAll(keys);
  check(find(keys, 0, 0).span === find(keys, 1, 1).span && find(keys, 0, 0).span.cols === 2, 'neighbouring Album Art keys share one picture');
  check(find(keys, 3, 0).span !== find(keys, 4, 0).span && find(keys, 3, 0).span.cols === 1, '"Stand alone" Album Art shows the whole cover');
  // track info: one row = title + artist strip; two rows = title row, artist row
  keys = mk([['info', 2, 2], ['info', 3, 2], ['info', 4, 2]]); layout.resolveAll(keys);
  check(keys.every((k) => k.resolved === 'titleartist' && k.strip.keys.length === 3), 'a row of Track Info keys shows title + artist across all of them');
  keys = mk([['info', 3, 0], ['info', 4, 0], ['info', 3, 1], ['info', 4, 1]]); layout.resolveAll(keys);
  check(find(keys, 3, 0).resolved === 'title' && find(keys, 4, 1).resolved === 'artist' && find(keys, 3, 0).strip.keys.length === 2,
    'two rows of Track Info: title row above artist row');
  // choosing what a key shows splits a strip
  keys = mk([['info', 0, 2], ['info', 1, 2, { show: 'album' }], ['info', 2, 2]]); layout.resolveAll(keys);
  check(find(keys, 0, 2).strip !== find(keys, 2, 2).strip && find(keys, 1, 2).resolved === 'album', 'a key set to show something else stands on its own');
  // progress bars along a row; side screen never joins main keys
  keys = mk([['progress', 2, 2], ['progress', 3, 2], ['progress', 4, 2]]); layout.resolveAll(keys);
  check(keys[0].span === keys[2].span && keys[0].span.cols === 3, 'neighbouring Progress Bar keys share one bar');
  keys = mk([['info', 4, 0], ['info', 5, 0]]); layout.resolveAll(keys);
  check(keys[0].group !== keys[1].group, 'main keys and the side screen never join');
  // conversions
  const old = { textStyle: 'stacked', textSize: 'large', scrollSpeed: 'normal', titleColor: '#ffffff', artistColor: '#b4b4c0', textBackground: 'tinted', artGap: 20, artPress: 'none', controlColor: 'art', customColor: '#7888ff', controlStyle: 'glow', keyLayout: 'auto' };
  const c1 = fromV1('combined', old), a1 = fromV1('art', old), p1 = fromV1('playpause', old);
  check(c1.action === 'info' && c1.settings.size === 'large' && c1.settings.background === 'tinted' && a1.action === 'art' && a1.settings.press === 'none' && p1.settings.style === 'glow',
    'v1 settings become per-key settings');
  check(fromV2({ show: 'auto' }).action === 'art' && fromV2({ show: 'progress', background: 'tinted' }).settings.background === 'tinted' &&
    fromV2({ show: 'titleartist' }).settings.show === 'titleartist' && fromV2({ show: 'time' }).action === 'time', 'v2 keys become Album Art / Track Info / Time / Progress Bar');
  check(cleanKeySettings('info', { show: 'bogus', size: 'huge' }).show === 'auto', 'bad settings fall back to defaults');
  check(JSON.stringify(oldSettingsFromLog('x\n2026 settings ' + JSON.stringify(old) + '\n')) === JSON.stringify(old), 'reads v1 settings from the v1 log');
  const v2 = require('./fixtures/music-profile-v2.json');
  const mig = migrateProfile(v2, null);
  const uu = Object.values(mig.manifest.Actions).map((a) => a.UUID);
  check(mig.moved.length === 9 && !uu.includes('com.clarkyau.nowplaying.display') && uu.filter((u) => u.endsWith('.art')).length === 4 &&
    mig.manifest.Actions['2,2'].UUID === 'com.hotspot.streamdock.profile.rotate', 'the current Music page converts (4 art, 2 info, time, 2 progress; other keys untouched)');
}

// ---------------------------------------------------------------------------
// Deck scenarios
// ---------------------------------------------------------------------------
const OTHERS = [{ col: 2, row: 2, raw: true, label: 'Scene Shift' }, { col: 5, row: 0, raw: true, label: 'World Time' }, { col: 5, row: 1, raw: true, label: 'Info board' }];

// Keys of a converted profile, as the deck reports them.
function profileKeys(manifest) {
  const keys = [];
  for (const [pos, a] of Object.entries(manifest.Actions)) {
    if (!a.UUID.startsWith('com.clarkyau.nowplaying.')) continue;
    const [c, r] = pos.split(',').map(Number);
    keys.push({ action: a.UUID.split('.').pop(), col: c, row: r, raw: true, settings: a.Settings });
  }
  return keys;
}

async function scenarios() {
  const previews = [];
  console.log(`Deck scenarios (plugin on ${require('child_process').execFileSync(node20(), ['-v']).toString().trim()})`);
  const music = profileKeys(migrateProfile(require('./fixtures/music-profile-v2.json'), null).manifest);

  // 1. Your Music page after the update - short names sit still on one key
  let res = await runScenario({ name: 'music-page', keys: music, snapshots: [1800], env: { FAKE_TITLE: 'Wilt', FAKE_ARTIST: 'Spiritbox' } });
  quirkCheck(res);
  check(/1,3=strip:titleartist 2,3=strip:titleartist/.test(res.log), 'Music page: the two Track Info keys work as one title + artist display');
  const infoIdx = music.map((k, i) => (k.action === 'info' ? i : -1)).filter((i) => i >= 0);
  previews.push(await preview(res, 0, '1-music-page.png', 'Your Music page after the update - short names sit on one key', OTHERS));

  // 2. Long names scroll across both Track Info keys, together
  res = await runScenario({ name: 'music-long', keys: music, snapshots: [1500, 3800, 5200],
    env: { FAKE_TITLE: 'Everything In Its Right Place', FAKE_ARTIST: 'Darkest Hour Fading Absence', FAKE_ART: path.join(__dirname, 'fixtures', 'art2.jpg') } });
  quirkCheck(res);
  const moved = infoIdx.every((i) => res.snapshots[0].images[i] !== res.snapshots[1].images[i] && res.snapshots[1].images[i] !== res.snapshots[2].images[i]);
  check(moved, 'long title and artist scroll across both Track Info keys');
  const spans = res.traces.filter((t) => t.action === 'info' && (t.texts || []).some((x) => x.strip));
  check(spans.length > 0, 'the scrolling text is drawn as one strip across the keys');
  previews.push(await preview(res, 1, '2-music-page-scrolling.png', 'Long names scroll across both Track Info keys (snapshot mid-scroll)', OTHERS));
  previews.push(await preview(res, 2, '2b-music-page-scrolling-later.png', 'A moment later', OTHERS));

  // 3. Big art + two rows of Track Info (title row, artist row) + buttons
  const big = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) big.push({ action: 'art', col: c, row: r });
  for (let r = 0; r < 2; r++) for (let c = 2; c < 5; c++) big.push({ action: 'info', col: c, row: r, settings: { size: 'large' } });
  ['prev', 'playpause', 'next'].forEach((a, c) => big.push({ action: a, col: c, row: 2 }));
  big.push({ action: 'time', col: 3, row: 2 }, { action: 'progress', col: 4, row: 2 });
  big.push({ action: 'art', col: 5, row: 0 }, { action: 'info', col: 5, row: 1, settings: { show: 'title' } }, { action: 'info', col: 5, row: 2, settings: { show: 'artist' } });
  res = await runScenario({ name: 'big-art', keys: big, snapshots: [1800], env: { FAKE_TITLE: 'Burn The Mortal Down', FAKE_ARTIST: 'Spiritbox', FAKE_ALBUM: 'Eternal Blue' } });
  quirkCheck(res);
  previews.push(await preview(res, 0, '3-big-art-title-and-artist-rows.png', 'Album Art 2x2, a title row and an artist row, buttons, time, side screen'));

  // 4. Separate Album Art keys, chosen Shows, a shared progress bar, button looks
  const sep = [
    { action: 'art', col: 0, row: 0, settings: { join: false } }, { action: 'art', col: 1, row: 0, settings: { join: false } },
    { action: 'info', col: 2, row: 0, settings: { show: 'album' } }, { action: 'info', col: 3, row: 0, settings: { show: 'player' } },
    { action: 'time', col: 4, row: 0, settings: { time: 'elapsed', background: 'tinted' } },
    { action: 'info', col: 0, row: 1, settings: { show: 'line' } }, { action: 'info', col: 1, row: 1, settings: { show: 'line' } }, { action: 'info', col: 2, row: 1, settings: { show: 'line' } },
    { action: 'progress', col: 3, row: 1 }, { action: 'progress', col: 4, row: 1 },
    { action: 'voldown', col: 0, row: 2 }, { action: 'volup', col: 1, row: 2 }, { action: 'mute', col: 2, row: 2 },
    { action: 'prev', col: 3, row: 2, settings: { style: 'flat' } }, { action: 'next', col: 4, row: 2, settings: { style: 'flat', color: 'custom', customColor: '#ff5ca8' } }
  ];
  res = await runScenario({ name: 'separate', keys: sep, snapshots: [1200, 3000],
    events: [{ at: 900, keyDown: 14 }, { at: 1000, panel: 2 }, { at: 1500, applyAll: 14 }] });
  quirkCheck(res);
  check(res.commands.includes('next'), 'Next Track button sends next');
  check(res.sent.some((m) => m.event === 'sendToPropertyInspector' && m.payload.resolved === 'album'), 'the settings panel is told what the key shows');
  const copied = res.sent.filter((m) => m.event === 'setSettings' && m.payload.style === 'flat' && m.payload.color === 'custom').map((m) => m.context);
  check(new Set(copied).size === 5, '"Use on all keys" gives every button the same look');
  previews.push(await preview(res, 0, '4-separate-keys.png', 'Separate Album Art keys, album, player, one-line title strip, shared progress bar'));
  previews.push(await preview(res, 1, '4b-same-look-on-all-buttons.png', 'After "Use on all keys" on the Next Track button'));

  // 5. Nothing playing
  res = await runScenario({ name: 'nothing-playing', keys: music, snapshots: [1500], env: { FAKE_STATUS: 'none' } });
  quirkCheck(res);
  previews.push(await preview(res, 0, '5-nothing-playing.png', 'Nothing playing', OTHERS));

  // 6. Old version folder: removed only when no page uses it
  res = await runScenario({ name: 'old-removed', keys: music.slice(0, 2), snapshots: [6200], oldPlugin: true });
  check(res.oldPluginRemoved === true, 'previous version (dev.nowplaying.deck) is removed once no page uses it');
  res = await runScenario({ name: 'old-kept', keys: music.slice(0, 2), snapshots: [6200], oldPlugin: true, oldKeysOnPage: true });
  check(res.oldPluginRemoved === false && /still has keys/.test(res.log), 'previous version is kept while a page still uses its keys');
  return previews;
}

(async () => {
  units();
  const previews = await scenarios();
  console.log(`\nPreviews in test/out: ${previews.join(', ')}`);
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
