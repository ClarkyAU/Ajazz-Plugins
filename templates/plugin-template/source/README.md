# Ajazz Stream Dock plugin template

A small, working plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x, AKP153E: 5 x 3 keys + side screen).
It is built the way all `com.clarkyau.*` plugins are built, so a new plugin starts with the rules already in place.

## Start a new plugin

    node tools/new-plugin.js mouseinfo "Mouse Info"     # makes ../mouseinfo with id com.clarkyau.mouseinfo
    cd ../mouseinfo && npm install
    node tools/build.js        # build/pkg = the plugin folder + install.bat, uninstall.bat, install.ps1
    node test/run-tests.js     # tests run the BUILT plugin
    node tools/build.js --zip  # out/<Name>-<version>-build.zip and -source.zip

Use Node 20.8.1 (the same as the Ajazz software): `NODE20=/path/to/node node test/run-tests.js`.
PowerShell 7 is needed for the installer test (`PWSH=/path/to/pwsh`), Chromium for the panel test (`CHROME=/path/to/chrome`).

## What you get

| Part | Where | What it does |
|---|---|---|
| Two keys | `src/manifest.json` | **Example** (a value key, joins with neighbours) and **Setup** (status of the outside source). |
| Main program | `src/plugin/index.js` | Talks to the Ajazz software, keeps key state, draws, answers the settings panel. |
| Source | `src/plugin/source.js` | **Replace the demo here.** One `read()` returns `{status, note, items[{id,name,value,charging}]}`. Read only. |
| Drawing | `src/plugin/render.js` | SVG to 144 x 144 PNG with resvg and the Inter font. Text always fits (22 -> 19 px, then "..."); "%" is drawn as shapes. |
| Layout | `src/plugin/layout.js` | Key positions and joining. Main keys and the side screen never join. |
| Settings panel | `src/pi/index.html` | Setup panel (source, check interval, found list, search again) and key panel (only that key's options). |
| Installer | `src/installer/` | `install.ps1` (-PluginsDir -NoRestart -Yes -Uninstall), `install.bat`, `uninstall.bat`. Uninstall keeps the `data` folder. |
| Tests | `test/` | Fake Ajazz host, 15 scenarios, settings panel in headless Chromium, installer under PowerShell 7, deck preview in `test/out/deck-preview.png`. |

## Rules built in (from the project instructions)

- Settings live in the Ajazz settings panel, saved live. Nothing is edited by hand.
- Anything outside the plugin belongs on the **Setup** key. Other keys say "Add the Setup key" or "Finish the Setup key".
- Per-key options only show on that key's panel. Keys can opt out of joining. In a joined group only one key shows the name.
- Every part of a key can be switched off (icon, name, warning level).
- Dark keys, line icons, colour from content. Numbers 50 px, labels 22 px, nothing under 19 px.
- The plugin only reads. Log changes only; never log secrets.
- Settings that arrive late show a waiting picture; if they never arrive the plugin starts with defaults after 2.5 s.

## What to change for a real plugin

1. `source.js`: replace the demo reader (USB, a local app, a PowerShell helper...). Keep the shape of `read()`.
2. `manifest.json`, `en.json`: rename the keys; keep the `.setup` key. `index.js`: roles and `svgFor()`.
3. `render.js` / `icons.js`: your key pictures. Keep the helpers (`fitText`, `percentSign`, `inspect`).
4. `pi/index.html`: the options of your keys. Keep the "do not rebuild an open control" helpers (`setOptions`, `setValue`).
5. `tools/make-icons.js`: the static pictures in the Ajazz key list.
6. `install.ps1`: `$OldIds` if the plugin was renamed.

## Checked here, and not

Checked in the tests: start-up, late/missing settings, drawing sizes and text fit, joining and the one-name rule, per-key switches,
source trouble and "Not found", the panel messages, the panel page in a real browser, install / update / uninstall under PowerShell 7.

Needs the real deck (the template cannot prove these): the Ajazz software loading the plugin, how keys look on the screen,
the reading order of joined keys on your deck (the numbering in `layout.js` is copied from an earlier working plugin), the
installer under Windows PowerShell 5.1 (it only avoids features 5.1 lacks), and anything that touches a real device.

The Inter font (SIL Open Font License) comes from the `@expo-google-fonts/inter` dev package and is packed into `plugin/index.js`.
