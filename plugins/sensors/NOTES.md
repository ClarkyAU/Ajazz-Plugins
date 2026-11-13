# Sensors plugin (PC temperatures / load) — decisions & findings

Copy of the Project note `claude/sensors-plugin.md` (13 Nov 2026). The plugin is System Vitals, ID `com.clarkyau.sysvitals`.

Moved here from plugin-lessons.md on 2026-10-24. Add decisions as we make them. [HW] = confirmed on the user's PC.

## Hardware on the user's PC
- [HW] Ryzen 5700X (no iGPU); RX 9070 XT on PCI bus 45.
- [HW] AMD PMLog indexes: 14/15 fan, 8 edge temp, 9 memory temp, 19 activity, 21 voltage, 27 hotspot, 73 board watts.
  NO CPU temp from it (32/33 unsupported).

## CPU temperature
- Chosen: LibreHardwareMonitor (LHM). Alternative: HWiNFO. NOT [HW] yet (not tested on the PC).
- LHM 0.9.6, LibreHardwareMonitor.zip (the NET.10 build is a separate download).
- No WMI. Two ways to read it:
  - /data.json from its web server (SensorId, Type, RawValue), or
  - the CSV log LibreHardwareMonitorLog-yyyy-MM-dd.csv (line 1 = ",<ids>", line 2 = "Time,<names>"; about 50 MB/day at 2 s).
- CPU readings need PawnIO >= 2.0. Silent install: `PawnIO_setup.exe -install -silent` (namazso/PawnIO.Setup).
- Start LHM with a logon task named "LibreHardwareMonitor", run with highest privileges.
- LHM config sits beside the exe: runWebServerMenuItem, listenerIp, listenerPort, logSensorsMenuItem, loggingInterval
  (0 = 1 s, 1 = 2 s, 2 = 5 s). Values are the strings "true"/"false".

## Outside dependency rule
- LHM / PawnIO belong on the Setup key. Install only from a panel button. A key press = retry / start / open.

## GPU without installing anything
- PDH counters "GPU Engine" and "GPU Adapter Memory" (PdhAddEnglishCounterW).
- D3DKMTEnumAdapters2 (adapter LUID looks like luid_0xHIGH_0xLOW).
- D3DKMTQueryAdapterInfo type 62 gives temperature in 0.1 °C (needs WDDM 2.9+).
- NVIDIA: nvml.dll (what nvidia-smi uses). AMD: atiadlxx ADL2_New_QueryPMLogData_Get. ADLX gives CPU usage only.

## Gotchas
- ACPI temperatures are fake on desktop boards: trust a value only if it changes.
- Poll only the sensors that a key actually needs.
- PDH rates need 2 samples before they mean anything; rebuild wildcard counters when adapters change; backfill history on start.
