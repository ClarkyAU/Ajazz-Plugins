# Changelog

Newest first.

## 1.2.0 - 2026-10-18

- Renamed the plugin ID from `com.homelab.truenas` to `com.clarkyau.truenas`, to match the author's other plugins. Author is now clarkyau.
- Moving from the old name keeps everything:
  - The keys on the deck were switched to the new ID, keeping their per-key settings. The page file was backed up first.
  - The address and API key were handed over by a one-off helper in the old plugin folder. The new plugin imports them on first start and deletes the handover file straight away.
  - Confirmed on the author's deck: settings imported, connected, and all 14 keys came across.
- The installer now removes the old `com.homelab.truenas.sdPlugin` folder on install and on uninstall.
- Tests: 35, including a handover test with two fake hosts running side by side.

## 1.1.0 - 2026-10-17

- Fixed: System and Storage keys were blank on the real deck. A "%" sign in the key picture breaks it in the Ajazz software, so the percent sign is now drawn as shapes.
- Much bigger text, so it reads on the real keys: numbers about 52 px, labels 22 px, nothing under 19 px. Version 1.0 used 13-17 px, which was too small.
- New **Setup** key. It is the only place for the address and API key. It shows the connection status, NAS name and version, and pressing it opens the TrueNAS web page.
- Each key's settings panel now only shows its own options. Temperature units moved to System keys and speed units to Network keys, both saved per key.
- Every key has a **Shows** setting. Automatic picks from the key's position, and you can choose what any key shows, even inside a joined group.
- The default for a row of Network keys is now Download, Upload, then a graph. The port name only shows if you choose it.
- Neighbouring Graph keys share one graph. Graphs allow for the gap between keys, so lines meet up.
- Network and Storage keys now join even when they show different ports or pools.
- Small fixes: shorter labels that fit ("Set up here", "1 problem", "Stop?").

## 1.0.0 - 2026-10-17

First version.
- Keys: System (CPU, memory, temperature, ZFS cache, uptime, graph), Network (down/up speed, port, graph), Storage pool (usage, free space, health, scrub/resilver progress), Alerts (count and alert text), App (state, start/stop/open, colour from the app icon).
- Connects to TrueNAS 25.04+ over a secure WebSocket with an API key. Live stats come from TrueNAS's real-time feed; pools, alerts and apps are polled.
- Neighbouring keys of the same kind join into bigger displays. The AKP153E's key order is corrected.
- install.bat and uninstall.bat (keep settings). Runs on the Ajazz software's own Node 20.
- Test kit: fake Ajazz host, fake TrueNAS (self-signed HTTPS/WebSocket, healthy and problems scenarios), deck preview images.
- Installed on the author's PC by copying the files in directly.
