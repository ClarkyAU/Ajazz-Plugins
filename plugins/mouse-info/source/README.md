# Mouse Info — Ajazz AKP153E / Stream Dock plugin

Battery, connection and profile for a wireless mouse, on the Ajazz "Stream Dock AJAZZ Global" software.
ID `com.clarkyau.mouseinfo`, author clarkyau. Version 1.3.0.

## Supported mice
- **Glorious Model I 2 Wireless** (tested on real hardware), and the same-family Model O 2, D 2 and
  O 2 Mini Wireless (same messages per Glorious Core's code; untested).
- **Any Bluetooth mouse** that reports its battery to Windows (tested against a fake only).

## Keys
- **Mouse** — the "Shows" setting picks **Battery**, **Connection** or **Profile**. Automatic picks from
  the key's place among joined neighbours (Battery, Connection, Profile in reading order).
  "Join with neighbouring keys" can be switched off per key. Battery has a per-key low-battery warning;
  Profile has a per-key "Under the number" (DPI, polling rate or nothing).
- **Setup** (optional) — shows the mouse and connection; press to search again. Its settings panel chooses
  where the battery comes from (Automatic / Glorious / Bluetooth) and which mouse.

## How it works
- `runtime/listener.ps1` compiles `runtime/Listener.cs` with built-in Windows PowerShell 5.1 (cached DLL)
  and prints JSON lines. It **only listens**: it opens the Glorious vendor input channel (usage page
  FF00/FF00) and consumer channel (000C/0001) for reading, side by side with Glorious Core. It never
  sends the mouse anything.
- Battery: the mouse sends `06 FB <level> <charging>` about every 2 minutes while wireless.
  On the USB cable it sends nothing (and does not answer Glorious Core's battery request — tested in 1.2),
  so the keys show **Charging** while it is plugged in.
- Profile, DPI and polling rate: read from Glorious Core's saved settings
  (`%APPDATA%\Glorious Core\datastore\Devices.json`, `DeviceProfiles.json`). Profile switches made with
  the button on the mouse are not reported by the Model I 2, so the key follows Glorious Core's app.
- Bluetooth: Windows' `DEVPKEY_Bluetooth_Battery`, checked every minute.

## Install
Run `install.bat` from the install zip. It closes the Ajazz software, copies the plugin into
`%APPDATA%\HotSpot\StreamDock\plugins`, keeps saved data, and starts the software again.
`uninstall.bat` removes it.

## Build and test (Linux or Windows, Node 20)
```
npm install
node tools/build.js          # build/com.clarkyau.mouseinfo.sdPlugin
node tools/build.js --zip    # + dist/MouseInfo-<version>-install.zip and -source.zip
NODE20=/path/to/node20 node test/run-tests.js
```
The tests run the built plugin on Node 20 against a fake Ajazz host (`test/run-tests.js`) and a fake
listener (`test/fake-listener.js`) with fake Glorious Core files (`test/fixtures/core`). Every key image is
checked for the AKP153E quirks (no `#`/`%`, rgb() colours only, no url()/gradients, 144x144, text ≥ 19 px,
no edge spaces in tspans, text measured to stay inside its key). Deck previews go to `test/out/`.
`tools/check-cs.ps1` compiles Listener.cs as C# 5 with Roslyn (needs PowerShell 7) — the level Windows
PowerShell 5.1 accepts.

## Files
- `src/` plugin (bundled into one `plugin/index.js` with esbuild): `index.js` host connection and keys,
  `mice.js` mouse state and message parsing, `core.js` Glorious Core profiles, `layout.js` positions and
  joining, `render.js` key images.
- `runtime/` Windows listener. `pi/` settings panel. `installer/` install/uninstall scripts.
- `tools/` build, icons, C# check. `test/` tests, fakes, fixtures.
