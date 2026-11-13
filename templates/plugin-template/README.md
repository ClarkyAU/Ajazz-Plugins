# Plugin Template (Starter Plugin)

A small, working plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E (5 x 3 keys plus the side screen).
It is the starting point for every new `com.clarkyau.*` plugin, so a new plugin begins with the drawing, settings panel, installer and tests already done.

- **Plugin ID:** `com.clarkyau.starter`
- **Version:** 1.0.0 (24 Oct 2026)
- **Needs:** Ajazz Stream Dock 3.10.188.226 or newer on Windows 10 or newer. It runs on the Node 20 that comes with the Ajazz software.

On its own it only shows made-up numbers, so you can see the keys work. The real work is replacing the demo reader with your own.

## Keys and settings

All settings are in the Ajazz settings panel and save as you change them. Nothing is edited by hand.

**Example key** (shows a value with a bar, an icon and a name)
- Shows: Automatic (default), Value or Status
- Join with neighbouring keys: on or off
- Item: Automatic or pick one
- Show the icon: on or off
- Show the name: on or off
- Low warning: Off, 10, 15, 20, 25 or 30 percent (the key goes red and flashes at or below it)

Keys next to each other join up: the first one shows the value, the next shows the status. Only one key in a joined group shows the name. The side screen never joins a main key.

**Setup key** (shows Connected or No source; press it to search again)
- Source: where the numbers come from (only "Demo (built in)" in this template)
- Check every: 5, 10, 30 or 60 seconds
- A list of what was found, a Search again button, and the version

Other keys say "Add the Setup key" or "Finish the Setup key" until the Setup key is on the deck and working.
The plugin only reads. It never changes anything on your devices.

## Install (plain steps)

1. Download `releases/com.clarkyau.starter-1.0.0.zip` and unzip the whole thing.
2. Double-click `install.bat` inside it and answer Y.
3. Restart the Stream Dock software: tray icon, Quit, then open it again.
4. Drag the Starter Plugin keys onto your deck. Add the Setup key first.

To remove it, double-click `uninstall.bat`. Your saved settings stay.

The `install.bat` and `uninstall.bat` in this folder are copies of the ones inside the zip. They only work when they sit next to `install.ps1` and the plugin folder, so use the ones from the unzipped release.

## Start a new plugin from this

1. Unzip `releases/com.clarkyau.starter-1.0.0-source.zip` (or use the `source/` folder) and run `npm install`.
2. Run `node tools/new-plugin.js <shortname> "<Display Name>"`. It makes a renamed copy with the ID `com.clarkyau.<shortname>`.
3. In the new folder run `npm install`, `node tools/build.js`, then `node test/run-tests.js`.
4. Replace the demo reader in `src/plugin/source.js` with the real one.

Tools used: Node 20.8.1 (set `NODE20=` for the tests), PowerShell 7 (`PWSH=`) for the installer test, Chromium (`CHROME=`) for the settings panel test.

## What is tested, and what needs the real deck

Tested (all 15 tests pass, also on a renamed copy):
- start-up, and settings that arrive late or never
- drawing: text always fits, nothing under 19 px, nothing leaves the key, "%" drawn as shapes
- joining, the one-name rule, the side screen, per-key display switches
- source trouble and "Not found" (the last value is kept)
- the settings panel messages, and the panel page in headless Chromium
- install, update and uninstall under PowerShell 7 (uninstall keeps saved data)
- the tests were also shown to fail when the code was broken on purpose

Needs your hardware:
- the Ajazz software loading the plugin
- how the keys look on the real screen
- the reading order of joined keys on your deck (the key numbering is copied from an earlier working plugin)
- the installer under Windows PowerShell 5.1
- anything that touches a real device (the template has none)

## Files

- `CHANGELOG.md` version history
- `NOTES.md` decisions, lessons and known issues
- `source/` full source (no node_modules, no built plugin)
- `releases/` the installable build zip and the source zip

The Inter font (SIL Open Font License) comes from the `@expo-google-fonts/inter` package and is packed into the built plugin.
