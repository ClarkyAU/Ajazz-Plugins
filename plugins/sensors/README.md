# System Vitals (sensors)

A plugin for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E (5 x 3 keys plus the 3-key side screen). It shows live readings from the PC the software runs on: CPU, memory, graphics card (NVIDIA, AMD and Intel, temperatures included), disks, network, battery, and any sensor from LibreHardwareMonitor or HWiNFO.

- **Plugin ID:** `com.clarkyau.sysvitals`
- **Version:** 1.2.0 (19 Oct 2026)
- **Needs:** Windows 10 or newer and the Ajazz software. Nothing else to install for CPU load, memory, graphics card, disks and network. It runs on the Node 20 inside the Ajazz software and the PowerShell that comes with Windows.
- **CPU temperature and power, fans, voltages:** Windows doesn't give these to apps. They need LibreHardwareMonitor or HWiNFO running; the Setup key can install LibreHardwareMonitor for you.
- **Made for others too:** nothing is tied to one PC. It finds the graphics cards, drives and network adapters itself and works on any Windows language.

## Keys and settings

All settings are in the Ajazz settings panel and apply as you change them. Nothing is edited by hand.

Every key (except Setup) has:
- **Shows:** Automatic (default; picks from the key's position) or a specific reading
- **Join with neighbouring keys:** on or off. Keys of the same kind next to each other join into one display; neighbouring Graph (or CPU Cores) keys share one picture. The side screen never joins the main keys.
- **Graph covers:** 1, 2, 5 or 10 minutes
- **When pressed:** Task Manager, Resource Monitor, or nothing (plus extras on some keys)

| Key | Can show | Its own options |
|---|---|---|
| CPU | Load, Temperature, Clock speed, Power, Cores, Graph, Busiest app | Temperature unit |
| Memory | Used (percent), Amount used, Free, Committed, Graph, Biggest app | |
| GPU | Load, Temperature, Hot spot, Video memory, Power, Fan, Clock speed, Graph | Which graphics card, temperature unit |
| Disk | Activity, Read speed, Write speed, Read + write, Space used, Free space, Graph | Which drive (or all), bytes or bits; press can open the drive |
| Network | Download + upload, Download, Upload, Adapter and link speed, IP address, Graph | Which adapter (or all), bits or bytes; press can open network settings |
| System | Overview (CPU, RAM, GPU), Uptime, Battery, Processes, Graph | Press can open power settings |
| Sensor | Any LibreHardwareMonitor or HWiNFO reading, as a value or a graph | Which sensor (with a search box), label, temperature unit |
| Setup | Which sensor app is used and whether it works | See below |

**Setup key**
- **Use:** Automatic (whichever sensor app is running), LibreHardwareMonitor, HWiNFO, or built-in only (no apps).
- **LibreHardwareMonitor:** read it through its **web server** (this PC only, recommended) or its **log file** (no web server; a small daily task deletes logs older than 2 days, about 50 MB a day). Web server port setting.
- **Install LibreHardwareMonitor** button (in the settings panel only, never on a key press): downloads it from its official GitHub page into Program Files, sets it up the way you chose, starts it with Windows (minimised to the tray), and installs PawnIO, the small signed driver it needs to read the CPU. Windows asks for permission once. An **Apply to LibreHardwareMonitor** button appears if you change how it's read later.
- **HWiNFO:** status and set-up steps (tick "Shared Memory Support"; the free version switches it off after 12 hours).
- Pressing the Setup key: starts LibreHardwareMonitor if it is installed but not running, or opens its page once it runs; otherwise it checks again.

CPU temperature, CPU power and Sensor keys say "Add the Setup key" or "Finish the Setup key" until a sensor app is working.

## Install (plain steps)

1. Download `releases/com.clarkyau.sysvitals-1.2.0.zip` and unzip the whole thing.
2. Double-click `install.bat` inside it. It closes the Ajazz software, copies the plugin in and starts the software again. Your key settings are kept.
3. In the Ajazz software, drag keys from the **System Vitals** group onto your deck.
4. For CPU temperature: add the **Setup** key, open its settings, choose how to read LibreHardwareMonitor, and click **Install LibreHardwareMonitor** (or start HWiNFO with Shared Memory Support).

To remove it, double-click `uninstall.bat` from the unzipped release.

The `install.bat` and `uninstall.bat` in this folder are copies of the ones inside the zip. They only work next to `install.ps1` and the plugin folder, so use the ones from the unzipped release.

## How it gets the numbers

All built into Windows or the graphics driver:
- Windows performance counters (by their English names, so any Windows language works): CPU and per-core load, clock speed, disks, graphics card load and memory, processes, busiest apps.
- The graphics adapter list and temperature Task Manager uses (any brand, newer drivers).
- NVIDIA's driver library (`nvml.dll`, with `nvidia-smi` as a fallback) and AMD's driver library (`atiadlxx.dll`): temperature, hot spot, power, fan, clocks.
- .NET and Windows: network adapters, drive space, memory, battery, uptime.
- Optional: LibreHardwareMonitor (web server or log file) and HWiNFO (shared memory) for CPU temperature, power, fans and the Sensor key.

Only the readings that the keys on the deck need are collected.

## What is tested, and what needs the real PC

Tested: 122 checks pass on Node 20.8.1, against a fake Ajazz host, a fake collector with four made-up PCs, a fake LibreHardwareMonitor (web server and log file), a fake installer and a fake nvidia-smi. Every key picture is checked (no "#" or "%", nothing under 19 px, text measured with a real font stays in its key), with whole-deck previews. The Windows collector script parses and its C# compiles as C# 5 under PowerShell 7 on Linux.

Confirmed on the real PC (Ryzen 7 5700X, Radeon RX 9070 XT, 19 Oct 2026, version 1.0.0):
- the plugin and its collector start, keys are placed correctly, including the side screen
- CPU, memory, network and graphics card readings, with the graphics card temperature from the AMD driver
- the AMD driver offers no CPU temperature on this PC (it only does for Ryzen chips with built-in graphics)

Not yet confirmed on the real PC:
- the Setup key, the Install / Apply buttons (download, PawnIO, startup task), and reading LibreHardwareMonitor through its web server or log file (versions 1.1.0 and 1.2.0 were installed but not reported back)
- HWiNFO shared memory, NVIDIA and Intel graphics cards, laptops (battery), and the busiest-app keys

## Folder contents

- `releases/` the installable build zip and the source zip
- `source/` the full source: `src/` (plugin and Windows collector), `template/pi/` (settings panel), `scripts/` (build, package, installer), `test/` (fake host, fakes, checks, previews). `source/generated/` holds the manifest, settings panel and icons as built by `npm run build`, for reference.
- `CHANGELOG.md` version history, `NOTES.md` decisions and findings

Build and test: `npm install`, `npm run build`, `npm test`, `npm run package` (Node 20).
