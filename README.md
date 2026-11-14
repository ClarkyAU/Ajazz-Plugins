# Ajazz Plugins

Plugins for the **Ajazz "Stream Dock AJAZZ Global"** software (3.10.x) on the **AKP153E** (5 x 3 keys plus the side screen). Windows 10 or newer.

## The plugins

| Plugin | What it does | ID | Version | Folder |
|---|---|---|---|---|
| **iCUE Battery** | Real battery % of a Corsair headset | `com.clarkyau.icuebattery` | 1.0.0 | [plugins/icue-battery](plugins/icue-battery) |
| **Media (Now Playing)** | Album art, title, progress and media buttons | `com.clarkyau.nowplaying` | 2.0.0 | [plugins/media](plugins/media) |
| **Mouse Info** | Wireless mouse battery, connection and profile | `com.clarkyau.mouseinfo` | 1.3.0 | [plugins/mouse-info](plugins/mouse-info) |
| **Moza R5 Work Mode** | Moza R5 base Standby / Work from one key | `com.clarkyau.mozabase` | 0.5.0 | [plugins/moza-r5-work-mode](plugins/moza-r5-work-mode) |
| **System Vitals** | CPU, memory, GPU, disks, network, sensors | `com.clarkyau.sysvitals` | 1.2.0 | [plugins/sensors](plugins/sensors) |
| **Smart Home** | Tuya / Smart Life devices on and off | `com.clarkyau.smarthome` | 2.0.0 | [plugins/smart-home](plugins/smart-home) |
| **Soundpad patch** | Fixes wrong sounds in the store Soundpad plugin | patches `com.hotspot.soundpad` | 1.0.0 | [plugins/soundpad](plugins/soundpad) |
| **TrueNAS** | Live TrueNAS stats, start/stop apps | `com.clarkyau.truenas` | 1.2.0 | [plugins/truenas](plugins/truenas) |

Not uploaded yet: Bambu.

## How the repo is laid out

```
plugins/<name>/        one folder per plugin
  README.md            what it does, keys, settings, what is tested
  CHANGELOG.md         versions, newest first
  NOTES.md             decisions, lessons, known issues
  releases/            installable zip + source zip for each version.
                       The plain zip holds the installers (install.bat with
                       install.ps1, uninstall.bat) and the plugin files.
  source/              full source, tests, build scripts
templates/
  plugin-template/     starting point for every new plugin
docs/
  plugin-lessons.md    general lessons that apply to all plugins
  moza-r5-standby-result.md   how the Moza Standby command was found
```

## Installing a plugin

1. Open the plugin's `releases/` folder and download the file without `-source` in its name (for example `com.clarkyau.truenas-1.2.0.zip`).
2. Unzip it fully (don't run it from inside the zip) and double-click `install.bat`. Keep the `.ps1` files next to it.
3. Restart the Ajazz software from the tray.

Settings are changed in the Ajazz settings panel. `uninstall.bat` (in the same unzipped folder) removes the plugin but keeps your settings.

## Adding or updating a plugin

- Only touch your own `plugins/<name>/` folder.
- Put a new version's zips in `releases/` and add a line to `CHANGELOG.md`.
- Update the table above.
- Never commit accounts, keys, tokens, saved settings or logs.
