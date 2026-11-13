# iCUE Battery

A plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E (5 x 3 keys plus the side screen). It shows the **real battery percentage** of your Corsair device, with a picture of the device. Corsair's own iCUE app only shows Low, Medium or High. It also shows when the headset is charging (animated) and when it is switched off.

- **Plugin ID:** `com.clarkyau.icuebattery`
- **Version:** 1.0.0 (26 Oct 2026)
- **Needs:** Windows 10 or newer, the Ajazz software, and Corsair iCUE running. Nothing else to install: it runs on the Node 20 inside the Ajazz software and the PowerShell that comes with Windows.
- **Made with:** an HS80 MAX Wireless headset. Other Corsair devices should show their battery percentage but are untested.

The plugin only reads. It never changes anything on your devices.

## Keys and settings

All settings are in the Ajazz settings panel and save as you change them. Nothing is edited by hand.

**Device key** (battery, microphone or connection)
- Shows: Automatic (default), Battery, Microphone or Connection
- Join with neighbouring keys: on or off. Keys next to each other fill in Battery, then Microphone, then Connection, in reading order. The side screen never joins the main keys.
- Device: the default device, or pick one
- Low battery warning: Off, 10, 15, 20 (default), 25 or 30 percent. The key goes red and flashes at or below it.

**Setup key** (shows the iCUE connection; press it to check again)
- Default device: Automatic (your headset, or the first wireless device) or a specific one
- Check every: 5, 10, 30 or 60 seconds (for the headset's USB receiver)
- A list of what was found in iCUE, and the version

Other keys say "Add the Setup key" or "Finish the Setup key" until the Setup key is on the deck and working.

**What the keys do**
- Battery: device picture, big percentage, a bar, the model name.
- Charging: blue, with a bolt and the word "Charging"; the bar fills up and repeats.
- Headset switched off: the last reading stays, greyed, with "Not found".
- Microphone shows on, or MUTED in red.

## Install (plain steps)

1. Download `releases/com.clarkyau.icuebattery-1.0.0.zip` and unzip the whole thing.
2. Double-click `install.bat` inside it. It closes the Ajazz software, copies the plugin in and starts the software again. Your key settings are kept.
3. In iCUE: Settings > Software and Games > switch on **Enable SDK** (once).
4. In iCUE, for the headset: switch on **Enable Battery Gauge in Notification Area**. This is how the plugin gets "Charging" and "switched off" instantly (English iCUE only). Without it the plugin still works, but charging shows 20-40 seconds late and only for the HS80 MAX.
5. In the Ajazz software, drag the iCUE Battery keys onto your deck. Add the **Setup** key first, then the Device keys.

To remove it, double-click `uninstall.bat` (from the unzipped release). Your saved settings stay.

The `install.bat` and `uninstall.bat` in this folder are copies of the ones inside the zip. They only work next to `install.ps1` and the plugin folder, so use the ones from the unzipped release.

## How it gets the numbers

Corsair's iCUE SDK gives the battery percentage. It has no "charging" or "switched off" value, so the plugin also reads, in this order: iCUE's tray icon text (real time), the headset's USB receiver (20-40 seconds behind), and the SDK's connected/disconnected event. The full story, with the evidence, is in `NOTES.md`.

## What is tested, and what needs the real headset

Tested (32 tests pass on Node 20.8.1, against a fake Ajazz host and a fake helper, with every key picture checked and whole-deck previews):
- start-up, the Setup key and the "Add/Finish the Setup key" messages
- battery levels, colours, bar, the low warning and turning it off
- charging, from the tray text, from the receiver, and the guess for a PC without a receiver
- headset off, remembered readings, "Not found", and the headset coming back
- joining, the "Shows" and "Device" settings, the side screen never joining, the microphone and a device without a microphone
- the settings panel getting its state and changing settings
- the helper's C# compiles as C# 5 (what Windows PowerShell understands). The tray reader could not be fully compiled on Linux.

Confirmed on the author's PC with an HS80 MAX Wireless:
- real battery percentage, "Charging" in real time from the tray text, the receiver reading (and that it only answers every 24 seconds), and the SDK "disconnected" event

Still needs checking on the real headset:
- the key going grey the moment the tray text disappears when the headset is switched off (installed, not yet seen)
- other Corsair devices (battery percentage only, from the SDK)

## Files

- `releases/` has the installable zip and the source zip.
- `source/` is the full source: `src/` (the plugin), `runtime/` (the PowerShell helper, the tray reader and Corsair's SDK DLL), `pi/` (settings panel), `installer/`, `tools/` (build) and `test/` (fake host and tests). Start with `source/README.md`.
- `CHANGELOG.md` is the version history. `NOTES.md` is the decisions, lessons and findings.

To build it: in `source/` run `npm install`, `node tools/build.js --zip`, then `NODE20=<path to node 20.8.1> node test/run-tests.js`.

## Credits and licences

- `source/runtime/iCUESDK.x64_2019.dll` is Corsair's iCUE SDK v4.0.84, from github.com/CorsairOfficial/cue-sdk. It is Corsair's, not this project's.
- The way to read the headset receiver comes from github.com/chrisingram22/hs80-battery-widget.
