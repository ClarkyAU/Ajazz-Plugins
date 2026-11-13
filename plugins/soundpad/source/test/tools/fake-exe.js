// Stands in for SoundpadPlugin.exe, behaving the way its log shows:
// registers, answers {refresh:true} with the CategoryAndSounds list, and on keyDown
// "plays" DoPlaySound(<SoundIndexInput>), reported back as a logMessage.
'use strict';
const WebSocket = require('ws');
const fs = require('fs');
const a = {}; const v = process.argv.slice(2);
for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^-+/, '')] = v[i + 1];
const listFile = process.env.FAKE_LIST;
const mode = process.env.FAKE_MODE || 'payload'; // payload | cache | silent
const cache = {};
const ws = new WebSocket('ws://127.0.0.1:' + a.port);
ws.on('open', () => ws.send(JSON.stringify({ event: a.registerEvent, uuid: a.pluginUUID })));
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.payload && m.payload.settings) {
    if (m.event === 'didReceiveSettings' || m.event === 'willAppear') cache[m.context] = m.payload.settings;
  }
  if (m.event === 'sendToPlugin' && m.payload && m.payload.refresh) {
    if (mode === 'silent') return;
    const sounds = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    ws.send(JSON.stringify({ event: 'sendToPropertyInspector', action: m.action, context: m.context,
      payload: { CategoryAndSounds: { categories: [...new Set(sounds.map(s => s.category))], sounds } } }));
  }
  if (m.event === 'keyDown' || m.event === 'keyUp') {
    const s = mode === 'cache' ? (cache[m.context] || m.payload.settings) : m.payload.settings;
    const msg = m.event === 'keyDown' ? (m.action === 'com.hotspot.soundpadplay' ? 'DoPlaySound(' + s.SoundIndexInput + ')' : 'other:' + m.action) : 'keyUp';
    ws.send(JSON.stringify({ event: 'logMessage', payload: { message: msg } }));
  }
});
ws.on('close', () => process.exit(0));
