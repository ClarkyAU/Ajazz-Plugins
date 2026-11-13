SYSTEM VITALS - plugin for the Ajazz AKP153E (Ajazz Stream Dock software, Windows)

Live readings from this PC on your keys: CPU, memory, graphics card (NVIDIA, AMD
and Intel, including temperatures), disks, network, battery and any sensor from
HWiNFO or LibreHardwareMonitor. Nothing else to install.

INSTALL
1. Extract the zip (right-click > Extract All).
2. Double-click install.bat in the extracted folder. It closes the Stream Dock
   software, installs the plugin and starts the software again. Running it again
   later updates the plugin; your key settings are kept.
   To remove the plugin, double-click uninstall.bat.

   Manual install instead: quit the Stream Dock software (right-click its tray
   icon > Quit), copy the "com.clarkyau.sysvitals.sdPlugin" folder into
   %APPDATA%\HotSpot\StreamDock\plugins and start the software again.

USE
Drag keys from the "System Vitals" group: CPU, Memory, GPU, Disk, Network,
System and Sensor. Keys of the same kind that touch each other join into one
display (for example a row of CPU keys shows load, temperature and a wide graph).
Each key's settings let you choose what it shows, which graphics card / drive /
network adapter / sensor, units, how long the graph covers, and what pressing it
does. Untick "Join with neighbouring keys" to keep a key on its own.

SETUP KEY
Add the Setup key from the "System Vitals" group to choose the sensor app and see
whether it is working. Its settings have an "Install LibreHardwareMonitor" button
that downloads it from its official GitHub page, turns on its web server for this
PC only, starts it with Windows (minimised to the tray) and installs PawnIO, the
small signed driver it uses to read the CPU. Windows asks for permission once.
You choose how the plugin reads LibreHardwareMonitor:
- Web server (recommended): its built-in web server, reachable from this PC only.
- Log file: no web server; it writes a log file every 2 seconds, and a small
  daily task deletes log files older than 2 days (about 50 MB a day).
Change it later with "Apply to LibreHardwareMonitor" in the Setup key's settings.

TEMPERATURES
- Graphics cards: read from the NVIDIA or AMD driver (or from Windows for
  other cards). Nothing extra needed.
- CPU temperature, CPU power, fans and voltages: Windows does not share these
  with apps. If HWiNFO (with "Shared Memory Support" ticked in its settings) or
  LibreHardwareMonitor is running, the plugin reads from it automatically, and
  the Sensor key can show any of their readings. The Setup key installs and
  configures LibreHardwareMonitor for you.

TROUBLESHOOTING
The plugin writes plugin.log in its folder
(%APPDATA%\HotSpot\StreamDock\plugins\com.clarkyau.sysvitals.sdPlugin).
