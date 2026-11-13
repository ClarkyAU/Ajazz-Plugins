# System Vitals — Ajazz AKP153E / Stream Dock plugin

Live readings from the PC the Stream Dock software runs on: CPU, memory, graphics
cards (NVIDIA, AMD, Intel — temperatures included), disks, network, battery, and any
sensor from HWiNFO or LibreHardwareMonitor. Windows 10/11. Nothing to install
besides the plugin.

Plugin ID `com.clarkyau.sysvitals`, author clarkyau.

## Key types

| Key | Can show |
|---|---|
| CPU | Load, Temperature, Clock speed, Power, Cores, Graph, Busiest app |
| Memory | Used (percent), Amount used, Free, Committed, Graph, Biggest app |
| GPU | Load, Temperature, Hot spot, Video memory, Power, Fan, Clock speed, Graph |
| Disk | Activity, Read speed, Write speed, Read + write, Space used, Free space, Graph |
| Network | Download + upload, Download, Upload, Adapter and link speed, IP address, Graph |
| System | Overview (CPU/RAM/GPU), Uptime, Battery, Processes, Graph |
| Sensor | Any HWiNFO / LibreHardwareMonitor reading as a value or graph |
| Setup | Which sensor app is used and whether it works; press to start it / open it |

Neighbouring keys of the same type join into one display (main keys and the side
screen never join). Every key has a **Shows** setting (Automatic picks from the
key's position) and a **Join with neighbouring keys** option. Neighbouring keys
showing Graph (or CPU Cores) share one picture. Display options (units, which
GPU/drive/adapter/sensor, graph length, what a press does) are saved per key.
The **Setup** key holds the only plugin-wide settings: which sensor app to use
(Automatic, LibreHardwareMonitor, HWiNFO, or built-in only), how to read
LibreHardwareMonitor (its web server, this PC only, or its log file) and the web server port. Its settings panel has an **Install LibreHardwareMonitor** button.
Keys that need a sensor app (CPU temperature/power, Sensor) say "Add the Setup key"
or "Finish the Setup key" until one is working.

### Install LibreHardwareMonitor button

Runs `src/native/install-lhm.ps1` elevated (one Windows permission prompt):
downloads the latest `LibreHardwareMonitor.zip` from its official GitHub releases,
copies it to `C:\Program Files\LibreHardwareMonitor` (keeping an existing config),
sets it up for the chosen way of reading it — **web server**: `runWebServerMenuItem=true`,
`listenerIp=127.0.0.1` (this PC only), `listenerPort`; **log file**: `logSensorsMenuItem=true`,
2-second interval, one file a day, plus a daily task deleting logs older than 2 days —
and start minimised to the tray, installs PawnIO (signature checked;
LibreHardwareMonitor needs it to read the CPU) if missing, registers the same
"LibreHardwareMonitor" logon task its own "Run On Windows Startup" option uses, and
starts it. The plugin then reads `http://127.0.0.1:<port>/data.json` every 2 s
(RawValue fields), or the newest line of the newest `LibreHardwareMonitorLog-*.csv`
(only the file's last 64 KB). Changing the choice later shows an **Apply** button that
runs the same script with `-ConfigOnly` (no download). Current LibreHardwareMonitor
versions no longer publish WMI; the WMI reader is kept for older versions.

## Where the readings come from

All of these are built into Windows or the graphics driver:

- **Performance counters** (PDH, added by English name so any Windows language
  works): CPU load and per-core load, clock speed, disk activity and speed, GPU
  load and video memory per adapter, processes, busiest apps.
- **D3DKMT** (what Task Manager uses): graphics card list, memory size, and the
  GPU temperature/fan on WDDM 2.9+ drivers for any vendor.
- **NVIDIA NVML** (`nvml.dll`, part of the NVIDIA driver): temperature, power and
  limit, fan, clocks. If it can't be loaded, the plugin falls back to
  `nvidia-smi`.
- **AMD ADL** (`atiadlxx.dll`, part of the AMD driver): edge and hot-spot
  temperature, memory temperature, power, fan, clocks.
- **.NET**: network adapters (speed, IP, traffic), drives (space).
- **Win32**: memory, battery, uptime.
- **Optional**: HWiNFO shared memory and LibreHardwareMonitor/OpenHardwareMonitor
  WMI, for CPU temperature/power and the Sensor key. Without them, the CPU
  temperature falls back to an ACPI thermal zone, but only one whose value
  actually changes (many desktops report a fixed fake value).

The collector (`src/native/vitals.ps1` + `src/native/Vitals.cs`) runs in the
built-in Windows PowerShell 5.1. The C# is compiled once with `Add-Type` (C# 5,
mscorlib + System only) and cached as `runtime/SysVitals-<hash>.dll` in the plugin
folder. It prints one JSON line per second and only reads the expensive things
(GPU driver libraries, busiest apps, sensor apps) when a visible key needs them.

## Building

Requires Node 20 and npm.

```
npm install
npm run build      # dist/com.clarkyau.sysvitals.sdPlugin (single bundled plugin/index.js)
npm test           # build + end-to-end tests against the fake host, previews in test/out/
npm run package    # dist/SystemVitals-<version>.zip and -source.zip
```

Static check of the Windows collector (PowerShell 7, any OS):

```
pwsh -File test/check-collector.ps1
```

It parses `vitals.ps1` and compiles `Vitals.cs` with C# 5 rules.

## Tests

`test/run-tests.js` starts the built plugin exactly like the Ajazz software does
(`-port -pluginUUID -registerEvent -info`) against `test/fake-host.js`, which
places keys using the AKP153E's hardware-order coordinates. `test/fake-collector.js`
stands in for the Windows collector with a few made-up PCs (NVIDIA desktop with
HWiNFO, AMD+Intel laptop with battery, older PC without sensors that needs
`nvidia-smi` — faked by `test/fake-nvidia-smi`, and a collector that fails).

Every image the plugin sends is checked by `test/check-svg.js`:
no `#` or `%`, no `url()`/gradients/filters, rgb colours, 144×144, no
whitespace at the edges of text runs, no text under 19 px, and text measured
with a real font must stay inside its own key. Previews of the whole deck are
written to `test/out/*.png`.

## Files on the PC

`%APPDATA%\HotSpot\StreamDock\plugins\com.clarkyau.sysvitals.sdPlugin`

- `plugin.log` — the plugin log (rotates at 1 MB)
- `runtime\` — the collector script, C# source and compiled DLL (recreated as needed)
