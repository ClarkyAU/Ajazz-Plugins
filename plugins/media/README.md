# Media (Now Playing)

A plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E (5 x 3 keys plus the side screen). It shows what is playing on your PC: album art, title and artist, time, a progress bar and media buttons. It reads Windows' own media controls, so it works with Spotify, web browsers, Apple Music and any player that shows in the Windows volume popup. **No sign-in and nothing to install.**

- **Plugin ID:** `com.clarkyau.nowplaying`
- **Version:** 2.0.0 (24 Oct 2026)
- **Needs:** Windows 10 or newer and the Ajazz software 3.10.188.226 or newer. It runs on the Node 20 inside the Ajazz software and the PowerShell that comes with Windows.

The plugin only reads what is playing and sends play/pause, next, previous, volume and mute presses.

## Keys and settings

All settings are in the Ajazz settings panel and apply as you change them. Each key's panel only shows options for that kind of key.

| Key | What it shows | Settings |
|---|---|---|
| Album Art | The cover. Neighbouring keys share one big picture; a standalone key shows the whole cover. | Join / Stand alone, what pressing does |
| Track Info | Title, artist, album or player. Keys side by side act as one display; long names scroll across all of them together. | Shows (Automatic by default), Join / Stand alone, text size, scroll speed or off, title and artist colours, background, what pressing does |
| Time | Time left or time played | Left or played, colour, background, what pressing does |
| Progress Bar | A bar; neighbouring keys share one bar | Join / Stand alone, background, what pressing does |
| Play/Pause, Previous, Next, Volume Down, Volume Up, Mute | Line-icon buttons | Glow or Flat, colour from the album art or your own colour |

- **Use on all keys** copies a key's look to every key of the same kind (the six buttons count as one kind).
- **Advanced:** key positions, only if things land on the wrong keys.
- The main keys and the side screen never join. Text stays inside one key except on a Track Info strip, where long names may scroll across the keys (approved by the owner).
- Colour is taken from the album art; text is drawn as PNG so spacing is exact.
- There is no account, so no Setup key is needed.

Example layout:

```
[Prev ][Play ][Vol+ ][Art  ][Art  ]
[  -  ][Next ][Vol- ][Art  ][Art  ]
[Info ][Info ][Time ][Bar  ][Bar  ]
```

## Install

Use the **build zip** in `releases/` (`com.clarkyau.nowplaying-2.0.0.zip`).

1. Extract the zip (right-click, Extract All).
2. Double-click `install.bat`. It closes the Ajazz software, installs the plugin and starts the software again.
3. Drag the Now Playing keys onto your deck.

Running `install.bat` again later updates the plugin and keeps your keys and settings. `uninstall.bat` removes the plugin and keeps your settings. If the old `dev.nowplaying.deck` plugin is installed, the installer moves its keys and settings over and removes it.

(`install.bat` and `uninstall.bat` in this folder are copies for reference; they need `install.ps1`, which is inside the build zip.)

## Tested and not tested

Tested (fake Ajazz host and fake player, Node 20.8.1, all passing on 13 Nov 2026):
- Layout and settings rules, seven whole-deck scenarios with preview images, and a check of every key picture (144 x 144, no text under 19 px, text never leaves its key except on a Track Info strip).
- Settings panel in headless Chromium.
- The real `install.ps1` under PowerShell 7 on Linux against copies of real pages, including moving keys from the old plugin.

Only your hardware can confirm:
- How smooth the scrolling across the Track Info keys looks on the real keys.
- Cover art and track details from each music app.
- The side screen behaviour.
- The converted Music page after the install (the plugin log was not read after the last restart).

## Source

`source/` has the full source, build and package scripts, the fake host and the tests. To build: `npm install`, then `npm run build`; `npm test` builds and runs the tests; `npm run package` makes the two zips. The built `index.js` and `node_modules` are not committed.
