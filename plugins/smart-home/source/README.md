# Smart Home plugin for the Ajazz AKP153E (Stream Dock software)

Plugin ID `com.clarkyau.smarthome` · author clarkyau · version 2.0.0

Controls Tuya-based Wi-Fi devices (Smart Life app, Arlec Grid Connect,
Brilliant, Mirabella, …) from Ajazz / Stream Dock keys. Devices are reached
directly on the home network (Tuya LAN protocol 3.3, 3.4 and 3.5); the Tuya
cloud is only used to fetch the device list and local keys, and as a fallback.

## Build

Development only (users need nothing; the Ajazz software ships Node 20.8.1).
`npm install` also fetches Node 20.8.1 as a dev dependency, and the npm
scripts run on it.

```
npm install
npm run build      # -> dist/ (installable plugin + install.bat/uninstall.bat)
npm test           # every test, on Node 20.8.1
npm run package    # -> release/SmartHome-<ver>.zip and SmartHome-<ver>-source.zip
```

`plugin/index.js` is one esbuild bundle. Key images are drawn as SVG and
rasterised to PNG with resvg (WebAssembly) and the bundled Barlow Semi
Condensed fonts — the same approach as the Bambu Monitor plugin — so none of
the Ajazz SVG renderer quirks apply and previews match the hardware exactly.

## Tests

```
pip install tinytuya tuya-connector-python   # Python 3, used by the simulators
npm test
```

| Test | What it checks |
| --- | --- |
| `test/protocol.test.js` | LAN code vs simulated devices built on **tinytuya's** own framing/crypto (3.3, 3.4, 3.5, version auto-detect, wrong key, UDP discovery). The simulator itself is checked by running tinytuya's client against it. |
| `test/cloud.test.js` | Cloud sign-in, device list, local keys, data point mapping; every request's signature verified by **Tuya's tuya-connector-python**. |
| `test/e2e.test.js` | The built plugin run by a fake Ajazz host (`test/fake-host.js`: AKP153E hardware-order coordinates, 6x3 deck with the side screen) against simulated devices + fake cloud: Setup key flow and messages, automatic and chosen "Shows", joining / standing alone, shared slider and graph, main keys vs side screen, presses, changes made elsewhere, network-scan fallback, restart without cloud, no secrets in the log. Writes whole-deck pictures to `test/previews/`. |
| `test/image-check.js` | Run on **every** image the plugin sends: PNG valid and 144x144 and not blank; SVG data URLs free of `#`, `%`, `url(` and tspan edge spaces; no text under 19 px; every piece of text inside its own key. |
| `test/migration.test.js` | Moving over from `dev.smarthome.tuya`: the old folder's handover code passes the saved account details on; the new plugin imports them, upgrades old key settings (incl. old colour/style), keeps the device list and removes the old folder. |

## Layout

```
src/index.js            host connection, Setup key, keys, groups/"Shows", settings, migration
src/bridge.js           handover code that replaces the old plugin's code for one start
src/render.js           key designs (SVG)
src/raster.js           SVG -> PNG (resvg wasm + fonts)
src/tuya/protocol.js    frames + encryption (55AA/6699, ECB/GCM, HMAC, CRC)
src/tuya/device.js      one persistent LAN connection per device
src/tuya/discovery.js   UDP broadcasts, 3.5 discovery request, port-6668 scan
src/tuya/cloud.js       Tuya OpenAPI (signed requests)
src/tuya/model.js       device kind, outlets, power meter, light values
src/tuya/hub.js         device list cache (devices.json), connections, fallback
propertyInspector/      settings panel
plugin-files/           manifest.json, en.json, README.txt
installer/              install.bat/.ps1, uninstall.bat/.ps1
scripts/                build, icons, package
test/                   tests, fake host, simulators (test/sim)
```

## Settings

- Global (saved by the Ajazz software, entered only on the **Setup** key):
  Access ID, Access Secret, data centre, key positions.
- Per key: device, outlet, Shows, Join with neighbouring keys, name on key,
  icon, colour, glow/flat, press action (Power Use).
- `devices.json` in the plugin folder caches the device list and local keys so
  the keys work without the cloud; the installer keeps it on updates.

## Layout rules

- Groups: neighbouring keys on one row, same side of the deck (main keys vs
  side screen), same action and device (and outlet), both set to join.
- Automatic "Shows": Switch = icon, name…, watts (3+ keys, meter);
  Light = icon, name…, level; Brightness = level, slider…; Power Use = watts,
  graph…; Setup = status, devices.
- Neighbouring keys with the same Name / Slider / Graph display share it. The
  gap between keys counts as 28 px of hidden picture. Text never crosses a key.

## Moving over from dev.smarthome.tuya

`install.ps1` (with the software closed) renames the old action IDs in the
profile files (`dev.smarthome.tuya.*` -> `com.clarkyau.smarthome.*`, copies
kept in `migration-backup`), copies `devices.json`, and swaps the old
plugin's code for `plugin/bridge.js`. On the next start the bridge reads the
old saved settings from the software and writes `import-settings.json` into
the new folder; the new plugin imports them and deletes the old folder.

## Notes

- AKP153E keys are reported in hardware order; `toPhysical()` converts them
  (index = row*5+col; col = 4 - floor(index/3); row = index % 3).
- Many Tuya devices accept only one local connection at a time; the phone app
  falls back to the cloud while the plugin is connected. Google Home is
  unaffected (it uses the cloud).
- The free Tuya IoT Core trial expires after a while; the keys keep working
  from `devices.json`, only "Refresh devices" needs it.

## Credits

- Protocol details: [tinytuya](https://github.com/jasonacox/tinytuya) (MIT),
  [tuyapi](https://github.com/codetheweb/tuyapi) (MIT).
- [resvg](https://github.com/RazrFalcon/resvg) / @resvg/resvg-wasm (MPL-2.0).
- Barlow Semi Condensed font (SIL OFL 1.1, see `src/assets/Barlow-OFL.txt`).
- [ws](https://github.com/websockets/ws) (MIT).
- Node.js 20.8.1 for tests via the `node` npm package (MIT).
