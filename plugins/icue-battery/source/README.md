# iCUE Battery (com.clarkyau.icuebattery)

Stream Dock (Ajazz AKP153E) plugin: real battery percentage with a picture of the device, plus microphone
and connection, for Corsair devices (made with the HS80 MAX Wireless).
Everything is read through Corsair's official iCUE SDK. The plugin only reads; it never changes a device.

## How it works
- `runtime/helper.ps1` + `runtime/Helper.cs` run in the Windows PowerShell that ships with Windows, load
  `runtime/iCUESDK.x64_2019.dll` (Corsair's SDK v4.0.84) and print one JSON line whenever something changes.
  Node 20 cannot call a DLL on its own, which is why the helper exists. Nothing needs installing.
- `src/plugin/*` is the plugin itself (bundled to one `plugin/index.js` with esbuild).
- Setup key: shows the iCUE connection (needs iCUE running with Settings > Software and Games > Enable SDK) and picks the
  default device. Until it is added every other key says "Add the Setup key", then "Finish the Setup key".
- Device keys: "Shows" = Automatic / Battery / Microphone / Connection.
  Automatic fills neighbouring keys in reading order with whatever the device offers. "Join with neighbouring keys",
  "Device" and "Low battery warning" are per key. The side screen never joins the main keys.
- When the headset is off, the last readings stay on the keys, greyed, with "Not found".
- Charging and "headset off" (iCUE's SDK has neither): the helper reads, in this order of trust:
  1. **iCUE's tray icon text** (`runtime/Tray.cs`, Windows UI Automation, read only). With iCUE's "Enable Battery Gauge in
     Notification Area" on, the icon says "<model> Battery Status High|Medium|Low|Charging" and changes the moment the cable goes
     in or out. The text disappears when the headset is switched off. This is the fastest signal (real time).
  2. **The headset's USB receiver** (Corsair Slipstream 1B1C:0A97, HID usage page FF42 / usage 0001, "get" requests only:
     `02 09 02 0F` = battery in tenths of a percent, `02 09 02 10` = charge flag 1 charging / 2 on battery; method from
     github.com/chrisingram22/hs80-battery-widget). It answers only on a 24 s tick, so it lags by 20-40 s. It is also forwarded
     iCUE's own replies, so a changed value has to be seen twice in a row. Checked every 5/10/30/60 s (Setup panel).
  3. **The SDK's device connected/disconnected event** (fires on power-off; not always on power-on, so a live battery reading
     overrides an old "disconnected").
  4. Only on a PC with no receiver at all: a guess from iCUE dropping its battery value for 3 s.
  While charging the battery key shows a bolt, "Charging", the level and an animated bar. Each receiver reply makes iCUE log
  a harmless warning.

## Build / test / package
```
npm install
node tools/build.js --zip          # build/ and dist/*.zip
NODE20=/path/to/node20 node test/run-tests.js
pwsh tools/check-cs.ps1            # compile-checks Helper.cs as C# 5 (what Windows PowerShell 5.1 understands)
node tools/make-icons.js           # redraws static/*.png
```
The tests run the real built plugin against a fake Ajazz host (`test/harness.js`) and a fake helper
(`test/fake-helper.js`), check every key image against the AKP153E quirks (`test/checks.js`) and write preview
images of the whole deck to `test/out/`.

## Not covered by tests (needs the real PC)
Everything below was confirmed on the author's PC with an HS80 MAX Wireless except where noted.
- Battery %, charging in real time from the tray text, the receiver reading and its 24 s tick, the SDK disconnect event.
- Not yet confirmed after the last change: the key going grey the moment the tray text disappears (headset switched off).
- Other Corsair devices: battery % comes from the SDK and should work, but charging/off detection was only tried on the HS80 MAX.
- The tray text is English iCUE only. The Setup panel does not yet tell you to switch on "Enable Battery Gauge in Notification Area".
