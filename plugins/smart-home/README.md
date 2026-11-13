# Smart Home

A plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E (5 x 3 keys plus the side screen). It turns Tuya / Smart Life Wi-Fi devices on and off from your keys: Arlec Grid Connect, Brilliant, Mirabella, Deta and other Tuya-based brands. The keys show the real state, even when something is switched from Google Home or the phone.

- **Plugin ID:** `com.clarkyau.smarthome`
- **Version:** 2.0.0 (Oct 2026)
- **Needs:** Windows 10 or newer, the Ajazz software (3.10.188.226 or newer, it includes Node.js), and devices that are in the Smart Life app. Nothing else to install: it runs on the Node 20 inside the Ajazz software and the PowerShell that comes with Windows.
- **Replaces:** the first version, `dev.smarthome.tuya`. The installer moves its keys and saved account details over and removes it.

The plugin talks to the devices directly over your home Wi-Fi (Tuya local protocol 3.3, 3.4 and 3.5), so it is fast and keeps working if the internet drops. The Tuya cloud is only used to fetch the device list and local keys, and as a fallback. Devices stay in Google Home and keep working there.

## Keys and settings

All settings are in the Ajazz settings panel and save as you change them. Nothing is edited by hand.

**Setup key** (once)
- Access ID and Access Secret from iot.tuya.com (your cloud project's Overview tab), and the data centre (Auto by default; Australian accounts use Central Europe).
- Shows the connection status and how many devices were found. Pressing it opens the Tuya site (before set-up) or reconnects.
- Other keys say "Add the Setup key" or "Finish the Setup key" until it is done.

**Switch** - tap to turn a plug or switch on or off. **Light** - tap to turn a light on or off; it glows in the bulb's own colour. **Brightness** - tap steps 25/50/75/100%; slider keys jump to their own level. **Power Use** - live watts, or a graph of the last few minutes.

Every device key has:
- **Device** and **Outlet** (for power boards)
- **Shows:** Automatic (default), or icon, name, On/Off, watts, brightness level, slider, graph
- **Join with neighbouring keys:** on or off. Keys side by side for the same device join into one display (for example icon, then the name across the next keys, then watts). Neighbouring Slider or Graph keys share one picture. The side screen never joins the main keys. Only one key in a joined group shows the name.
- Name on key, Icon, Colour, Glow or Flat, and (Power Use) what pressing does.

## Install (plain steps)

1. Download `releases/com.clarkyau.smarthome-2.0.0.zip` and unzip the whole thing.
2. Double-click `install.bat` inside it. It closes the Ajazz software, copies the plugin in and starts the software again. Your key settings and device list are kept.
3. If Windows asks whether "node.exe" may use the network, choose Allow (private networks). That lets the plugin find your devices.
4. In the Ajazz software, drag the **Setup** key onto your deck (the side screen is a good spot), click it, paste your Access ID and Access Secret, and press "Save & connect".
5. Drag the other keys on and pick a device for each.

To remove it, double-click `uninstall.bat` (from the unzipped release). Your saved settings stay.

The `install.bat` and `uninstall.bat` in this folder are copies of the ones inside the zip. They only work next to `install.ps1` and the plugin folder, so use the ones from the unzipped release.

## What is tested, and what needs the real hardware

Tested (all tests pass on Node 20.8.1, with every key picture checked and whole-deck previews in `source/test/previews/`):
- The Tuya local code against simulated devices built from tinytuya's own code (3.3, 3.4, 3.5, version auto-detect, wrong key, UDP discovery).
- The cloud sign-in, device list and local keys against a fake cloud, with every request's signature checked by Tuya's own Python connector.
- The built plugin run by a fake Ajazz host (AKP153E hardware key order, side screen): Setup key, automatic and chosen "Shows", joining and standing alone, shared slider and graph, presses, changes made elsewhere, the network-scan fallback, restart without the cloud, and no secrets in the log.
- Moving over from `dev.smarthome.tuya`, using two fake hosts.

Confirmed on the real PC: the move from the old plugin worked, the saved account was imported, the Racing Cockpit plug connected locally, and the old folder was removed.

Needs more real-device checking: lights and power boards, devices on protocol 3.4 or 3.5, and every joined-key layout on the real keys. Only one plug has been used on the hardware so far.

## More

- `CHANGELOG.md` - version history
- `NOTES.md` - decisions, lessons and known issues
- `source/README.md` - how to build and test
- `releases/` - the installable zip and the source zip

Third-party: tinytuya and tuyapi (protocol details), resvg (MPL-2.0), Barlow Semi Condensed font (SIL OFL 1.1), ws (MIT).
