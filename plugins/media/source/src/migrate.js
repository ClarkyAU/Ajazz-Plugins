'use strict';
// Moves keys from earlier versions to the current actions inside a Stream Dock
// profile manifest, keeping each key's place and turning old settings into
// each key's own settings:
//   v1  dev.nowplaying.deck.*              -> art / info / buttons
//   v2  com.clarkyau.nowplaying.display    -> art / info / time / progress
// Used by tools/migrate-profile.js and the tests; installer/install.ps1 does
// the same steps in PowerShell.

const { ID, OLD_ID, fromV1, fromV2 } = require('./settings');

const NAMES = {
  art: 'Album Art', info: 'Track Info', time: 'Time', progress: 'Progress Bar',
  playpause: 'Play / Pause', prev: 'Previous Track', next: 'Next Track',
  voldown: 'Volume Down', volup: 'Volume Up', mute: 'Mute'
};

// The v1 plugin logged its settings each time they changed; the last line wins.
function oldSettingsFromLog(logText) {
  let found = null;
  for (const line of String(logText || '').split(/\r?\n/)) {
    const m = / settings (\{.*\})\s*$/.exec(line);
    if (m) { try { found = JSON.parse(m[1]); } catch (_) { /* skip */ } }
  }
  return found;
}

// v1Settings: the old shared settings (or null). Automatic v2 keys become Album Art.
function migrateProfile(manifest, v1Settings) {
  const out = JSON.parse(JSON.stringify(manifest));
  const moved = [];
  for (const [pos, a] of Object.entries(out.Actions || {})) {
    if (!a || typeof a.UUID !== 'string') continue;
    let conv = null, from = null;
    if (a.UUID.startsWith(OLD_ID + '.')) {
      from = a.UUID.slice(OLD_ID.length + 1);
      conv = fromV1(from, v1Settings || {});
    } else if (a.UUID === `${ID}.display`) {
      from = `display (${(a.Settings && a.Settings.show) || 'auto'})`;
      conv = fromV2(a.Settings, null);
    }
    if (!conv) continue;
    a.UUID = `${ID}.${conv.action}`;
    a.Name = NAMES[conv.action];
    a.Settings = conv.settings;
    a.State = 0;
    a.States = [{ Image: `static/${conv.action}.png`, TitleAlignment: 'bottom', FontSize: '10', ShowTitle: false }];
    moved.push({ pos, from, to: conv.action });
  }
  return { manifest: out, moved };
}

module.exports = { migrateProfile, oldSettingsFromLog, NAMES };
