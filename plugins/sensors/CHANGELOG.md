# Changelog: System Vitals (com.clarkyau.sysvitals)

Newest first.

## 1.2.0 (19 Oct 2026)
- LibreHardwareMonitor can now be read two ways, chosen on the Setup key: its web server (this PC only, recommended) or its log file (no web server).
- Log-file mode sets LibreHardwareMonitor to log every 2 seconds, one file a day, and adds a daily task that deletes logs older than 2 days.
- "Apply to LibreHardwareMonitor" button: switches an installed copy to the chosen way (one Windows permission prompt, restarts it).
- Sensor keys keep their chosen sensor when switching, because both ways use the same sensor ids.
- Not yet confirmed on the real PC.

## 1.1.0 (19 Oct 2026)
- New **Setup** key: shows which sensor app is in use and whether it is connected; choice of Automatic, LibreHardwareMonitor, HWiNFO or built-in only.
- "Install LibreHardwareMonitor" button in the Setup key's settings: downloads it into Program Files, turns on its web server for this PC only, starts it with Windows (minimised), installs PawnIO (signature checked).
- CPU temperature, CPU power and Sensor keys say "Add the Setup key" / "Finish the Setup key" until a sensor app works.
- Installing only happens from the settings panel, never from a key press.
- Not yet confirmed on the real PC.

## 1.0.0 (18-19 Oct 2026)
- First release: CPU, Memory, GPU, Disk, Network, System and Sensor keys, joined layouts, per-key settings, graphs, NVIDIA/AMD/Intel graphics card readings.
- Fix (same version): the Windows collector didn't start on the real PC because Windows PowerShell treats a C# compiler warning as an error. Fixed the line and added `-IgnoreWarnings`. Confirmed working on the real PC afterwards.
- Added: asks the AMD graphics driver for CPU temperature/power and logs every reading it offers. On the user's PC (Ryzen 7 5700X, no built-in graphics) it offers none, as expected; Ryzen chips with built-in graphics should get CPU temperature from it with no extra app.
