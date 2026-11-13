# Plugin lessons (general, all plugins)

[HW] = confirmed on a real PC. Plugin-specific facts live in `plugins/<name>/NOTES.md`.
To start a new plugin, use `templates/plugin-template/`.

## Deploy
- A commit to the PC can write a stale copy. Stage each update in a new folder, verify size and sha1, recommit if it missed.
- PNGs may be re-encoded in transit: compare pixels. Other files: compare sha1.
- Install path: `%APPDATA%\HotSpot\StreamDock\plugins\<id>.sdPlugin`. Restart the Ajazz software from the tray, and only after the installed file is verified.
- Admin elevation is only needed for things in Program Files.
- Decide the ID `com.clarkyau.<name>` before the first install.
- Folder listings cap at 2000 entries.

## Debug
- Plugin log first, then `%APPDATA%\HotSpot\StreamDock\logs\log-<date>.txt`. Logs are UTC.
- Log changes only. For intermittent problems add counters first, plus a 10-minute summary line.
- Action that isn't logged: read the state back after each action, then compare.

## Windows, USB, serial, network
PowerShell 5.1 and C#
- PS5.1 `Add-Type` treats warnings as errors: use `-IgnoreWarnings` [HW, CS0675].
- Check C# against `LanguageVersion.CSharp5` (no `$""` strings, no `?.`, no `=>` members).
- `[Console]::In.ReadLineAsync` blocks. Use `StreamReader(OpenStandardInput())` and poll.
- A helper must exit when stdin closes or its parent is gone.
- Spawn by full path: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File`. Use Sysnative if Node is 32-bit. Add a BOM when writing a .ps1 at runtime.
- .ps1 and C# files: ASCII, CRLF. JSON with InvariantCulture.
- Node cannot call a DLL: use a PowerShell helper and cache the compiled result by source hash.
- Elevation: `Start-Process -Verb RunAs -Wait` plus a status file.
- Installers: check `Get-AuthenticodeSignature` = Valid. Download from `releases/latest/download/<asset>`.
- Stop-Process: strict name match. Never stop Ajazz or node.
- When relaunching an app, start the main exe, not the one in `bin\`.
- Scripts that also run under PS7 on Linux (tests): normalise path separators before comparing.

USB HID
- Find the device by usage page / usage. Open only the collection you need. Read on a thread into a queue. Match header bytes.
- Vendor FF00/000C collections can be read beside the vendor app. Mouse and keyboard collections are exclusive.
- Error 1167 = device gone: rescan every 3-5 s. Wireless devices are slow (about a 24 s heartbeat). Ids change when the cable is plugged in.

Serial
- Ports are exclusive: close the vendor app, use the port, relaunch the app in a finally block. Find the port by USB VID. Do it all in one PowerShell run.

Network
- LAN UDP: use reuseAddr. Fallback: /24 TCP scan.
- Secrets only over https (http only to 127.0.0.1 in tests). Self-signed certificate toggle on the Setup key, default on.
- Tuya 3.3 over TCP 6668: frame = `000055aa | seq | cmd | len | payload | crc32 | 0000aa55`, AES-128-ECB with PKCS7. Status = cmd 10. 22-character ids use cmd 13 with dps `{"1":null}`. Poll about every 3 s. Never log the key.

Acting on a device state safely
- The first reading is only a starting point. Act only after about 3 matching readings (about 9 s). If the device is unreachable, do nothing.
- Destructive key: first press shows "Stop?", a second press within 3 s confirms.

## Vendor reverse engineering
- No shell on the PC: ship a probe build that runs read-only diagnostics and saves results in its own folder.
- Look at command databases and open-source projects first.
- Writes to a device: screenshot the vendor UI first, send only values you've seen, have a restore plan, read back, log before and after. An ack is not proof of state.

## Ajazz internals (Stream Dock AJAZZ Global 3.10.188.226, Node 20.8.1)
- `pluginUUID` changes on every run: store things by plugin ID. At start the plugin knows of no keys on the deck.
- `willAppear` can arrive before `didReceiveGlobalSettings`: draw a waiting picture, then redraw. Start reading the outside source only after saved settings arrive (or after a 2.5 s timeout).
- Manifest: `Controllers []` with `ShowTitle false` = action works on the main keys and the side screen.
- Settings panel: `setSettings` + `sendToPlugin`. The plugin sends state about every 3 s, so never rebuild open controls.
- `setImage` is dropped while any plugin has a full-screen image active, until `exitFullScreen`. A page change re-sends all images.
- Pages live in `profiles\<ID>.sdProfile\manifest.json`. Keys are "col,row" in hardware order. Editing while Ajazz runs is OK: commit with expectedMtimeMs and keep the backups.
- Global settings are tied to the plugin ID, so a new ID loses them.
- Key numbering: the host reports {column,row} in reading order (index = row*5 + column). `layout.js` converts to the plugin's own numbering.

## Rename / migrate
- Back up the manifest. Text-replace old ID with new ID (a JSON library reformats the file).
- Convert only pages that contain old keys.
- Global settings: read them with the old plugin, write `import-settings.json` in the new folder. The new plugin imports it when its own settings are empty, then deletes the file at once (it holds the key). Never log the key.
- Old folder busy (EBUSY): leave a `MOVED.txt`; the new plugin deletes the folder later.
- Mark migrated keys with `"v":2`.
- Test with two fake hosts (old with settings, new empty).

## Render
- All text is a PNG made with resvg (`@resvg/resvg-wasm`, `loadSystemFonts:false`), sent as `data:image/png;base64`. Pack the wasm and font into the one index.js.
- `%` is drawn as shapes. Make the text helper throw on `%`.
- Measure text with resvg `getBBox` of a text-only SVG. Fail if anything falls outside the 144 px key. Step the size 22 to 19 before shortening with an ellipsis.
- Sizes: numbers 50-52, labels 22, minimum 19.
- 28 px of image is hidden in the gap between keys. For one image across several keys, slice a big image and allow for that gap. Only full rectangles of keys.
- Joined keys: one key shows the name, the others show the value only.
- Every part is switchable off. Dark keys, line icons, colour from content.

## Build and test
- Build, then test, then zip. Tests run the built bundle.
- Build zip = plugin folder, install.bat, uninstall.bat, install.ps1, README. Source zip = source + scripts + tests, without node_modules, out/ and test/out/.
- Fakes: Ajazz host (Node 20.8.1), a fake service (HTTPS/WS, self-signed, scripted, records calls).
- Settings panel: headless Chromium. Check messages, visibility, and that an open select stays open.
- Run the real install.ps1 under PS7 on Linux with a copy of the real profile.
- Image checks: no text under 19, nothing leaving the key, PNG is 144x144 and valid, not blank.
- Prove the tests can fail: break the code on purpose and expect a FAIL.
- Remembered readings belong to one source: key them by source.
- Intermittent problems can't be proven by a test. Name the hardware-only items.
