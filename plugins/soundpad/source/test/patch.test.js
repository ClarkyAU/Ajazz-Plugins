'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startHost } = require('./tools/host');
const { resolveSound } = require('../src/index.js');

const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-list.json'), 'utf8')).CategoryAndSounds.sounds;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
let n = 0;
function listFile(sounds) { const f = path.join(tmp, 'list' + (n++) + '.json'); fs.writeFileSync(f, JSON.stringify(sounds)); return f; }
const ctx = 'CTX1';
const key = (settings, event = 'keyDown', action = 'com.hotspot.soundpadplay', c = ctx) =>
  ({ event, action, context: c, device: 'D1', payload: { settings, coordinates: { column: 1, row: 1 }, state: 0, isInMultiAction: false } });
// Move every sound by inserting a new one at the top (what adding a sound in Soundpad does).
const shifted = (sounds, by = 1) => [{ category: 'My Sounds', index: 1, name: 'brand-new' }].concat(sounds.map(s => Object.assign({}, s, { index: s.index + by })));
const idxOf = (sounds, name) => sounds.find(s => s.name === name).index;

test('registration reaches the software unchanged', async () => {
  const h = await startHost({ FAKE_LIST: listFile(real) });
  const r = h.msgs[0];
  assert.deepStrictEqual(r, { event: 'registerPlugin', uuid: 'UUID123' });
  await h.close();
});

test('a moved sound plays the right one and the key is corrected', async () => {
  const now = shifted(real, 3);
  const h = await startHost({ FAKE_LIST: listFile(now) });
  const s = { CategorySelect: 'Random', SoundIndexInput: '44', SoundSelect: 'hello-there' };
  assert.strictEqual(idxOf(real, 'hello-there'), 44);
  h.send(key(s));
  await h.waitFor(m => m.event === 'logMessage');
  assert.deepStrictEqual(h.plays(), ['DoPlaySound(47)']);
  const saved = h.msgs.find(m => m.event === 'setSettings');
  assert.strictEqual(saved.context, ctx);
  assert.strictEqual(saved.payload.SoundIndexInput, '47');
  assert.strictEqual(saved.payload.SoundSelect, 'hello-there');
  assert.strictEqual(saved.payload.CategorySelect, 'Random');
  assert.ok(!h.msgs.some(m => m.event === 'sendToPropertyInspector'), 'our own list request is not shown to the software');
  await h.close();
});

test('an unmoved sound plays as before', async () => {
  const h = await startHost({ FAKE_LIST: listFile(real) });
  h.send(key({ CategorySelect: 'Random', SoundIndexInput: '44', SoundSelect: 'hello-there', PatchName: 'hello-there', PatchIndex: '44', PatchRank: 0 }));
  await h.waitFor(m => m.event === 'logMessage');
  assert.deepStrictEqual(h.plays(), ['DoPlaySound(44)']);
  assert.ok(!h.msgs.some(m => m.event === 'setSettings'), 'nothing to save');
  await h.close();
});

test('works when the program uses its remembered settings instead of the press', async () => {
  const h = await startHost({ FAKE_LIST: listFile(shifted(real, 2)), FAKE_MODE: 'cache' });
  const s = { CategorySelect: 'Cartoons', SoundIndexInput: '38', SoundSelect: 'big-surprise' };
  h.send(key(s, 'willAppear'));
  h.send(key(s));
  await h.waitFor(m => m.event === 'logMessage');
  assert.deepStrictEqual(h.plays(), ['DoPlaySound(' + (idxOf(real, 'big-surprise') + 2) + ')']);
  await h.close();
});

test('a sound removed from Soundpad shows a warning instead of playing a wrong sound', async () => {
  const h = await startHost({ FAKE_LIST: listFile(real.filter(s => s.name !== 'hello-there')) });
  h.send(key({ CategorySelect: 'Random', SoundIndexInput: '44', SoundSelect: 'hello-there' }));
  await h.waitFor(m => m.event === 'showAlert');
  await new Promise(r => setTimeout(r, 200));
  assert.deepStrictEqual(h.plays(), []);
  await h.close();
});

test('if the list never arrives, the press still plays the saved number', async () => {
  const h = await startHost({ FAKE_LIST: listFile(real), FAKE_MODE: 'silent', SP_PATCH_LIST_TIMEOUT_MS: '300' });
  h.send(key({ CategorySelect: 'Random', SoundIndexInput: '44', SoundSelect: 'hello-there' }));
  await h.waitFor(m => m.event === 'logMessage');
  assert.deepStrictEqual(h.plays(), ['DoPlaySound(44)']);
  await h.close();
});

test('press and release stay in order (Push-to-Play)', async () => {
  const h = await startHost({ FAKE_LIST: listFile(shifted(real)) });
  const s = { SoundIndexInput: '44', SoundSelect: 'hello-there', PTPModeCheck: true };
  h.send(key(s)); h.send(key(s, 'keyUp'));
  await h.waitFor(m => m.event === 'logMessage' && m.payload.message === 'keyUp');
  assert.deepStrictEqual(h.plays(), ['DoPlaySound(45)', 'keyUp']);
  await h.close();
});

test('other keys (Stop, Random...) pass straight through', async () => {
  const h = await startHost({ FAKE_LIST: listFile(real), FAKE_MODE: 'silent' });
  const t0 = Date.now();
  h.send(key({}, 'keyDown', 'com.hotspot.soundpadstop'));
  await h.waitFor(m => m.event === 'logMessage');
  assert.ok(Date.now() - t0 < 500, 'no waiting');
  assert.deepStrictEqual(h.plays(), ['other:com.hotspot.soundpadstop']);
  await h.close();
});

test('the settings panel Refresh still works', async () => {
  const h = await startHost({ FAKE_LIST: listFile(real) });
  h.send({ event: 'sendToPlugin', action: 'com.hotspot.soundpadplay', context: ctx, payload: { refresh: true } });
  const m = await h.waitFor(m => m.event === 'sendToPropertyInspector');
  assert.strictEqual(m.payload.CategoryAndSounds.sounds.length, real.length);
  await h.close();
});

test('stops (and stops the program) when the software closes', async () => {
  const h = await startHost({ FAKE_LIST: listFile(real) });
  const t0 = Date.now();
  await h.close();
  assert.ok(Date.now() - t0 < 3000);
});

test('same-name copies: remembers which copy, even when a same-named copy slides into its place', async () => {
  // Sample list: "board-clip" three times (29, 30, 31) in Movies.
  const dups = real.filter(s => s.name === 'board-clip').map(s => s.index).sort((a, b) => a - b);
  assert.deepStrictEqual(dups, [29, 30, 31]);
  let s = { CategorySelect: 'Movies', SoundIndexInput: '30', SoundSelect: 'board-clip' };
  let r = resolveSound(real, s);
  assert.deepStrictEqual([r.index, r.rank], [30, 1]);
  s = Object.assign({}, s, { SoundIndexInput: '30', PatchName: s.SoundSelect, PatchIndex: '30', PatchRank: 1 });
  // A sound is added above: copies are now 30, 31, 32. Saved "30" is now copy 1, but the key means copy 2.
  r = resolveSound(shifted(real), s);
  assert.strictEqual(r.index, 31);
  // The user picks a different copy by typing an index in the panel: that wins.
  r = resolveSound(shifted(real), Object.assign({}, s, { SoundIndexInput: '32' }));
  assert.deepStrictEqual([r.index, r.rank], [32, 2]);
});

test('same-name copies end to end', async () => {
  const h = await startHost({ FAKE_LIST: listFile(shifted(real)) });
  h.send(key({ CategorySelect: 'Movies', SoundIndexInput: '30', SoundSelect: 'board-clip', PatchName: 'board-clip', PatchIndex: '30', PatchRank: 1 }));
  await h.waitFor(m => m.event === 'logMessage');
  assert.deepStrictEqual(h.plays(), ['DoPlaySound(31)']);
  await h.close();
});

test('keys whose saved category is stale still find the sound by name', () => {
  // Seen in the log: CategorySelect "Cartoons" with a sound from another category selected.
  const r = resolveSound(real, { CategorySelect: 'Cartoons', SoundIndexInput: '12', SoundSelect: 'book-drop' });
  assert.strictEqual(r.index, idxOf(real, 'book-drop'));
});

test('every key setting (shaped like the real log) resolves to a sound of the same name', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'sample-settings.txt'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  let ok = 0, missing = 0;
  for (const s of lines) {
    const r = resolveSound(real, s);
    if (!r) continue;
    if (r.missing) { missing++; continue; }
    assert.ok(real.some(x => x.index === r.index && x.name === s.SoundSelect));
    ok++;
  }
  console.log('sample settings: ' + ok + ' resolved, ' + missing + ' no longer in Soundpad');
  assert.ok(ok > 10);
});
