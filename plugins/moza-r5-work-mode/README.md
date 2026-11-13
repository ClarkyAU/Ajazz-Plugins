# Moza R5 Work Mode

A plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E (5 x 3 keys plus the side screen). It puts a **Moza R5 wheel base into Standby or back into Work Mode** from one key, and can do it **automatically when the cockpit smart plug turns on or off**. Moza Pit House has this switch (Base > Miscellaneous > Current Mode) but no shortcut for it, and Moza's own SDK has no call for it.

- **Plugin ID:** `com.clarkyau.mozabase`
- **Version:** 0.5.0 (23 Oct 2026)
- **Needs:** Windows 10 or newer, the Ajazz software, Moza Pit House installed in its normal place, and a Moza R5 on USB. Nothing else to install: it runs on the Node 20 inside the Ajazz software and the PowerShell that comes with Windows.
- **Made with:** a Moza R5 base and Pit House 1.4.1.13. Other Moza bases use the same command in the open-source Boxflat project but are untested here.

## How it works (plain words)

The base can only be talked to over its USB serial port, and Pit House holds that port open the whole time it runs. So the plugin does this each time:

1. Closes Pit House.
2. Reads the base's current mode, writes the new one, and reads it back to check.
3. Starts Pit House again (except when the plug has just turned off, see below).

It takes about 10 seconds. The base reports **0 = Work Mode, 1 = Standby Mode**. In Standby the wheel disconnects from the base; Work reconnects it.

## Keys and settings

All settings are in the Ajazz settings panel and save as you change them. Nothing is edited by hand.

**Moza key** (one key type)
- Shows the mode: **Work** (green), **Standby** (amber), **Working** while it runs, **Error** (red) if something failed, or **Moza R5 / press** until the mode is known (the base can only be read while Pit House is closed, so the key learns the mode on the first press or plug change).
- Press: flips Work and Standby, then reopens Pit House.
- Panel, Base: the current mode and the last change.
- Panel, Cockpit plug: **Follow the cockpit plug** (on by default) and **Plug name** (default "Cockpit"), with the plug's live state (on, off, can't reach).

**Following the cockpit plug**
- Plug turns **on**: Pit House is closed if open, the base is set to Work, then Pit House is started.
- Plug turns **off**: Pit House is closed and the base is set to Standby. Pit House stays closed.
- It checks the plug every 3 seconds and only acts after 3 matching readings in a row. The first reading after the plugin starts is only a starting point. A plug it can't reach does nothing.
- The plug is a Tuya / Smart Life plug on the home network. Its address and local key are **read from the Smart Home plugin's saved device list** (`com.clarkyau.smarthome`), read-only, so nothing is entered twice and that plugin is never changed. The plug must be set up in that plugin first.

## What is tested, and what needs the hardware

Tested automatically (`npm test` in `source/`, on Node 20.8.1) against a fake Ajazz host, a fake Tuya plug and a fake serial layer: the serial frames and checksums (including bytes captured from the real base), the Tuya reader (including older 22-character plugs and wrong keys), key presses, the plug on, off, flicker and unreachable cases, the settings panel messages, and every key picture (no `#` or `%`, text 19 px or bigger, inside the key, no gradients).

Confirmed on the author's hardware (23 Oct 2026): reading the mode in Work and Standby, switching to Standby and back, Pit House closing and reopening, the cockpit plug turning the base on and off, and the Smart Home plugin's own key still working beside it.

Not tested: other Moza bases, other Pit House versions, plugs that are not Tuya protocol 3.3, and whether the plugin runs when none of its keys is on the deck (believed yes, not checked).

## Install (plain steps)

1. Download `releases/com.clarkyau.mozabase-0.5.0.zip` and unzip the whole thing.
2. Double-click `install.bat` inside it. It closes the Ajazz software, copies the plugin in and starts the software again. Your settings are kept.
3. Drag the **Moza** key onto the deck. Press it once to learn the mode.

To remove it, double-click `uninstall.bat` from the same unzipped folder. (The `install.bat` and `uninstall.bat` beside this README are the same files; they only work next to the unzipped plugin folder.)

## Known limits

- Pressing the key (and each plug change) closes Pit House for about 10 seconds. That is the only way to reach the base, because Pit House owns its serial port.
- The key can't show the mode until the first press or plug change, and it does not notice a mode changed by hand in Pit House until the next one.
- A second short connection to the plug is made every 3 seconds; this did not disturb the Smart Home plugin on the author's plug.

## Folder

- `releases/` the installable zip and the source zip
- `source/` full source: `src/`, `pkg/` (manifest, settings panel, installers), `tools/` (build, package, tests, key renderer), `package.json`
- `NOTES.md` decisions, protocol details and lessons
- `CHANGELOG.md` version history
