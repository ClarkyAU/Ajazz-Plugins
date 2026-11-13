# Smart Home plugin - notes

Plugin ID `com.clarkyau.smarthome`, version 2.0.0. Controls Tuya / Smart Life devices (Arlec Grid Connect and similar) from the AKP153E keys over the home network, while they keep working in Google Home.

## Decisions
- **Local control, not the Google Home API.** Google Home has no way for a plugin to control devices. Arlec Grid Connect devices are Tuya underneath, so the plugin uses Tuya's local protocol (TCP 6668) and leaves the devices where they are. Google Home is unaffected because it uses the cloud.
- **Tuya cloud only for the list and keys.** The free Tuya IoT Core project (Central Europe data centre for Australia) is used to fetch the device list and local keys, and as a fallback for control. The list is cached in `devices.json` in the plugin folder, so keys keep working if the cloud trial ends. Only "Refresh devices" needs it.
- **Account details only on the Setup key** (Access ID, Access Secret, data centre), saved as global settings. Never in the log; only sent over https (plain http only to 127.0.0.1 in tests).
- **Protocols 3.3, 3.4 and 3.5**, with auto-detect, UDP discovery (6666/6667/7000) and a TCP-scan fallback for PCs where Windows Firewall blocks incoming broadcasts.
- **Key pictures as PNG via resvg** with bundled Barlow Semi Condensed fonts, so the Ajazz SVG quirks never apply.
- **Per-key "Shows" and "Join with neighbouring keys"**; Automatic picks from position. Display options are per key. Main keys and the side screen never join. In a joined group only one key shows the name.
- **New ID, with a migration.** The first version was `dev.smarthome.tuya`; 2.0.0 is `com.clarkyau.smarthome` (the project's ID rule). The installer renames the IDs in the page files, a handover helper replaces the old plugin's code for one start and passes the account details across, old per-key settings are upgraded (`v: 2`), and the old folder is removed (it carries a `MOVED.txt` marker and is deleted on a later start because it is locked while the old plugin runs).

## Lessons from building it
- Tuya version auto-detect must wait for a reply that decrypts; a TCP connect alone succeeds for any version.
- Node `https` POST needs `Content-Length` set, or the body is chunked and the signature check fails on some servers.
- Many Tuya devices accept only one local connection at a time, so the phone app falls back to the cloud while the plugin is connected. Google Home is unaffected.
- Tests use simulators built from tinytuya's own code and a fake cloud that checks every signature with Tuya's own Python connector, so the plugin is tested against an independent implementation.
- Give simulated devices their own loopback addresses (127.0.0.11, .12, ...), and keep a Python test server's main thread alive after stdin closes.
- General lessons from this plugin are in the project's plugin lessons note.

## Known issues and open checks
- Only the Racing Cockpit plug (Arlec smart plug with energy meter, protocol 3.3) has been used on the real hardware. Lights, power boards and protocol 3.4 / 3.5 devices are tested against simulators only.
- Joined-key layouts have been checked in previews and fake-host tests; the user judges them on the real keys.
- The free Tuya IoT Core trial expires after a while. The Setup key then says "Trial ended"; extend it at iot.tuya.com > Cloud > My Services > IoT Core.
- Re-pairing a device changes its local key; press the Setup key to refresh the list.
- The first-ever start after the move can take two restarts before the old folder disappears.
