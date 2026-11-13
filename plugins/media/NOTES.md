# Media plugin (Windows now-playing / controls) — decisions & findings

Moved here from plugin-lessons.md on 2026-10-24. Add decisions as we make them.

## Reading what is playing (no install needed)
- Windows GlobalSystemMediaTransportControlsSessionManager gives title, artist, album, app, play state, timeline and cover.
- WinRT from PowerShell is untyped: use reflection for AsTask / GetResults. Fallback for the cover: DataReader.
- Position updates are sparse: extrapolate between reports and correct when a new one arrives.

## Controls
- Play/pause/next/previous go through the media session.
- Volume and mute use keybd_event.

## Cover colour
- Shrink the cover to about 640 px, count pixels in hue bins, use the strongest bin.

## Now Playing 2.0.0 (com.clarkyau.nowplaying) decisions
- One action per key type (Album Art, Track Info, Time, Progress Bar, six buttons); the panel shows only that type's options. Owner complained when settings were mixed.
- Track Info strip: neighbouring Track Info keys on a row form one strip. Fits one key → still text; too long → shrink to about 80 %, then scroll across all keys with faded edges. One shared clock, speeds 40/70/120 px/s, 1.8 s hold. This is the owner-approved exception to "text stays in one key" (said in chat, 2026-10-24).
- All keys are drawn as PNG with resvg and the Barlow Semi Condensed font; the SVG route lost spaces (tspan edge whitespace is stripped).
- Album Art and Progress Bar share one picture across neighbouring keys, treating 28 px between keys as hidden.
- No account, so no Setup key.
- Migration: the installer converts pages that use `dev.nowplaying.deck.*` or `com.clarkyau.nowplaying.display` keys, backs up the page in the plugin's `migration-backup` folder, and removes the old plugin only when no page still uses it. Node (`src/migrate.js`) and PowerShell (`install.ps1`) versions must stay identical; a test compares them.
- Installed on the PC 2026-10-24 by writing files straight into the plugin folder and the Music page manifest.

## Known issues / not yet confirmed on hardware
- Scrolling across the two Track Info keys, side screen, cover art from each app.
- The plugin log after the first restart was not read.
- Migrated keys used default settings where the old plugin had none saved (v1 settings were meant to be read from its log; log was "none").

## On GitHub
On GitHub: plugins/media/, v2.0.0, 2026-11-13
