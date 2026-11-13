// Moves old dev.nowplaying.deck keys in one profile manifest to this plugin.
//   node tools/migrate-profile.js <profile manifest.json> <old nowplaying.log> <output.json>
const fs = require('fs');
const { migrateProfile, oldSettingsFromLog } = require('../src/migrate');
const [input, logFile, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: migrate-profile.js <manifest.json> <old nowplaying.log> <output.json>'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^﻿/, ''));
const old = logFile && fs.existsSync(logFile) ? oldSettingsFromLog(fs.readFileSync(logFile, 'utf8')) : null;
const { manifest: out, moved } = migrateProfile(manifest, old || {});
fs.writeFileSync(output, JSON.stringify(out, null, 4)); // UTF-8, no byte-order mark
console.log(`moved ${moved.length} key(s) using ${old ? 'the old settings' : 'default settings'}`);
for (const m of moved) console.log(`  ${m.pos}: ${m.from} -> ${m.to}`);
