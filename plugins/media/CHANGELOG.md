# Changelog

Newest first.

## 2.0.0 - 2026-10-24

Rebuilt to the project rules under the new ID `com.clarkyau.nowplaying`, after "settings are mixed across keys" and "text scrolling across keys doesn't work" feedback.

- One action per key type: Album Art, Track Info, Time, Progress Bar and six button keys. Each key's panel shows only its own options.
- Album Art on its own keys, with neighbouring keys sharing one big picture, or Stand alone for the whole cover.
- Track Info keys side by side form one strip: names that fit sit still, longer names scroll across all the keys together with a pause at the start. Speed is slow, normal, fast or off.
- Time key (left or played) and Progress Bar keys that share one bar.
- All keys drawn as PNG with the Barlow font (resvg), so spacing is exact.
- "Use on all keys" button for a matching look.
- Installer moves keys and settings from `dev.nowplaying.deck` and from the earlier single "Now Playing" key, keeps a backup of the original page, and removes the old plugin only when no page still uses it.
- Test kit: fake host with AKP153E key order, fake player, panel test in Chromium, installer test under PowerShell 7.

Known gaps:
- Real-deck behaviour of this version (scrolling, side screen, cover art from each app) not yet confirmed; the migrated Music page used default settings for keys that had none.
- Installed on the author's PC on 24 Oct 2026. The plugin log after the restart had not been read when this was pushed.

## 1.x - Oct 2026 (as `dev.nowplaying.deck` and the single "Now Playing" key)

First builds, made and installed as they grew; there were no separate releases.

- Album art across several keys, title and artist across several keys, and control buttons, using Windows' media controls with no sign-in.
- Stylish line-icon buttons, scrolling text, stacked or one-line title and artist, and a settings panel.
- Installer made one click (`install.bat`).
- Found and fixed along the way: spaces missing in text (the software drops spaces at the edges of text pieces; fixed by drawing PNG), art and text landing on the wrong keys (key positions arrive in hardware order), a scrolling pause that froze the text, and a cover-art read error in PowerShell (fixed with reflection and a DataReader fallback).
