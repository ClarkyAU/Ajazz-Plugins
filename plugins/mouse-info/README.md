# Mouse Info

A plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E (5 x 3 keys plus the side screen). It shows your wireless mouse's **battery level**, **how it is connected** (wireless, cable or Bluetooth) and **which profile** is active, with its DPI or polling rate.

- **Plugin ID:** `com.clarkyau.mouseinfo`
- **Version:** 1.3.0 (21 Oct 2026)
- **Needs:** Windows 10 or newer and the Ajazz software. Nothing else to install: it runs on the Node 20 inside the Ajazz software and the PowerShell that comes with Windows. The Profile key needs Glorious Core (it reads the profile Core saved).
- **Made with:** a Glorious Model I 2 Wireless.

The plugin only listens. It never sends your mouse anything or changes its settings, so it works side by side with Glorious Core.

## Which mice

- **Glorious Model I 2 Wireless:** tested on real hardware.
- **Glorious Model O 2, D 2 and O 2 Mini Wireless:** same messages according to Glorious Core's own code, but untested.
- **Any Bluetooth mouse** that reports its battery to Windows: tested against a fake only.

## Keys and settings

All settings are in the Ajazz settings panel and apply as you change them. Nothing is edited by hand.

**Mouse key**
- Shows: Automatic (default), Battery, Connection or Profile
- Join with neighbouring keys: on or off. Keys next to each other fill in Battery, then Connection, then Profile, in reading order. The side screen never joins the main keys.
- Battery: big percentage and a battery icon. Low battery warning: Off, 10, 15, 20 (default), 25 or 30 percent; the key goes red at or below it.
- Connection: Wireless, Cable or Bluetooth, with the mouse's name (or "Charging" on the cable).
- Profile: the profile number in a frame coloured like that DPI setting. Under the number: DPI (default), Polling rate or Nothing.

**Setup key** (optional: the other keys work without it)
- Shows the mouse that was found and how it is connected. Press it to search again.
- Read battery from: Automatic, Glorious mouse, or Bluetooth (Windows). Pick a specific mouse if you have more than one.

## Good to know

- The mouse sends its battery level by itself about every 2 minutes while wireless. After starting, the first reading takes up to a minute ("Waiting").
- **On the USB cable the mouse reports nothing at all**, so the battery key shows **Charging / On cable**. The level comes back about a minute after you unplug. (Asking the mouse over the cable was tried in 1.2; it does not answer.)
- **Profile:** the mouse does not report profile changes made with its button, and Glorious Core does not see them either. The Profile key shows what Glorious Core last saved (profiles picked in Glorious Core's app).

## Tested and not tested

- Tested on the author's PC: Model I 2 battery on the receiver, the cable showing Charging, connection changes, profile and DPI from Glorious Core.
- Tested only against fakes (a fake Ajazz host and a fake mouse listener on Node 20.8.1, 42 checks, every key image checked): Bluetooth mice, the other Glorious models, the settings panel.
- Not tested on hardware: `install.bat` / `uninstall.bat` (the author's copy was installed by copying files).

## Install (plain steps)

1. Download `releases/com.clarkyau.mouseinfo-1.3.0.zip` and unzip the whole thing.
2. Double-click `install.bat` inside it. It closes the Ajazz software, copies the plugin in and starts the software again. Your key settings are kept.
3. In the Ajazz software, drag **Mouse** keys (and a **Setup** key if you like) from the **Mouse Info** group onto your deck.

To remove it, double-click `uninstall.bat` from the same zip.

## Folders

- `source/` — full source with build script, tests and fakes (see `source/README.md` to build and test).
- `releases/` — the installable zip and the source zip.
- `NOTES.md` — decisions, findings and known issues. `CHANGELOG.md` — version history.
