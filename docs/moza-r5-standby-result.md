# Moza R5 Standby key: result and how it works (23 Oct 2026)

Plugin: `plugins/moza-r5-work-mode/` (com.clarkyau.mozabase).

## Result: route 1 works (v0.4)
- Mode byte is read with `get-work-mode` (frame `7e 02 1f 12 34 00 f2`, reply `7E 02 9F 21 34 vv chk`): **0 = Work, 1 = Standby**.
- `set-work-mode` is frame `7e 02 1f 12 33 vv chk`. Writing 1 gets an ack (`7E 02 9F 21 33 01 81`), a read-back of 1, and the firmware logs `Set MotorMode to:0` (Standby). Verified on the real PC.
- Serial: found via VID_346E in Win32_PnPEntity, 115200 8N1, DtrEnable on. Pit House (2 processes: the main exe and `bin\MOZA Pit House.exe`) must be stopped first. Relaunch the main exe `C:\Program Files (x86)\MOZA Pit House\MOZA Pit House.exe`, not the one in `bin\`.
- The reply stream also contains the base's text log lines (`7E len 0E 21 05 <ascii>`), handy for confirming state.
- Route 2 (CoAP): Pit House's CoAP is plain UDP on a random port. `POST .../SetMotorRunState` is accepted and forwarded to the base, but it is NOT Work/Standby (no mode change). Don't use it.
- Pit House's own Standby/Work button write is not logged anywhere. The plugin's serial read/write is the confirmed way.

## Cockpit plug follow (v0.5, worked first time on the real PC)
- Plug on: Pit House closed if open, base set to Work (byte 0), Pit House started.
- Plug off: Pit House closed, base set to Standby (byte 1), Pit House left closed.
- The plug is a Tuya device (22-character id, protocol 3.3, local TCP 6668). Its address and local key are read read-only from the Smart Home plugin's `devices.json`. Never edit that plugin.
- Status read is DP_QUERY (cmd 10), AES-128-ECB with the local key. Older 22-character ids answer "data unvalid" and need CONTROL_NEW (cmd 13) with dps `{"1":null}`.
- Safety: the first reading is only a starting point. The plugin needs 3 matching readings (about 9 s) before it acts. An unreachable plug does nothing.
- Settings (follow on/off, plug name) are in the key's panel, saved in `settings.json` in the plugin folder.
- To watch: a second local connection to the plug may knock the Smart Home plugin's key offline (not seen so far).

## Open
- Does Standby survive a Pit House relaunch (the user reports the base stayed in Standby).
- Key image at startup (the mode is unknown until the first press).
