# Moza R5 Work Mode plugin (com.clarkyau.mozabase) — decisions & findings

_Copy of the two Project notes `claude/moza-r5-standby-result.md` (part 1, what works) and `claude/moza-r5-work-mode.md` (part 2, the earlier exploration), taken 2026-11-13. The Project notes are the live ones. Where part 2 disagrees with part 1, part 1 is right (the write values are now confirmed, and the CoAP route turned out to be plain UDP and is not the switch)._

# Part 1 — Result and how it works (23 Oct 2026)

## RESULT: route 1 works (serial, with Pit House closed and reopened)
- Mode byte read with `get-work-mode` (frame `7e 02 1f 12 34 00 f2`, reply `7E 02 9F 21 34 vv chk`): **0 = Work, 1 = Standby**.
- `set-work-mode` = frame `7e 02 1f 12 33 vv chk`; write 1 -> base acks (`7E 02 9F 21 33 01 81`), read-back 1, firmware logs `Set MotorMode to:0` (Standby). Verified on the user's PC, wheel in Standby.
- Serial: COM3 found via VID_346E in Win32_PnPEntity, 115200 8N1, DtrEnable on. Pit House (2 processes: main exe + `bin\MOZA Pit House.exe`) must be stopped first; relaunch the main exe `C:\Program Files (x86)\MOZA Pit House\MOZA Pit House.exe` (not the bin one).
- The reply stream also contains the base's text log lines (`7E len 0E 21 05 <ascii>`), handy for confirming state.
- Route 2 (CoAP) result: Pit House's CoAP is plain UDP on a random port (found via Get-NetUDPEndpoint of the Pit House process; GET /.well-known/core works). `POST .../SetMotorRunState` with 4 bytes is accepted (2.03) and is forwarded to the base as serial group 44 payload `01 00 xx`, but it is NOT Work/Standby (value 1 = what Pit House sends itself at startup; 0 made the wheel LEDs blink faster; no mode change). Don't use it.
- Pit House's own Standby/Work button write is not logged anywhere; the plugin's read/write over serial is the confirmed way.
- Deploy gotcha: `device_commit_files` to the plugin folder often needs a second call; always list_dir and check the file size.
- Open at the time: does Standby survive Pit House relaunch (user reports base stayed in Standby), key image at startup (unknown mode until first press), settings panel (all done in v0.5 except the startup mode, which stays "unknown until first press").

## Cockpit plug follow (v0.5, worked first time on the real PC, 23 Oct 2026)
- Plug on -> Pit House closed if open, base set to Work (byte 0), Pit House started. Plug off -> Pit House closed, base set to Standby (byte 1), Pit House left closed.
- Plug = Tuya "Cockpit" (22-char id, protocol 3.3, local TCP 6668). Address and local key are read read-only from `com.clarkyau.smarthome.sdPlugin\devices.json`; never edit that plugin. Status read = DP_QUERY (cmd 10), AES-128-ECB with the local key; older 22-char ids answer "data unvalid" and need CONTROL_NEW (cmd 13) with dps {"1":null}.
- Safety: first reading is only a starting point; needs 3 matching readings (~9 s) to act; unreachable plug does nothing; settings (follow on/off, plug name) in the key's panel, saved in settings.json in the plugin folder.
- Possible issue to watch: a second local connection to the plug may knock the Smart Home plugin's key offline (not seen; the user confirmed both plugins kept working).
- Source/build zips: `releases/com.clarkyau.mozabase-0.5.0.zip` and `-source.zip`.

# Part 2 — Earlier exploration (22 Oct 2026)

Goal: an Ajazz key that sets the R5 base to Standby (and back to Work).

## The command (from Boxflat's data/serial.yml, user attached it)
- Device `main` (id 18 = 0x12), set: request group 31, command id [51], 1 byte (`set-work-mode`).
  Read: group 31, id [52], 1 byte (`get-work-mode`). Reads send value 0 (see Pit House wire log style `43 02 00`).
- Frame (moza-protocol.md): 0x7e, payload length, request group, device id, command id(s)+value(s), checksum =
  (sum of all bytes + 13) mod 256. Response: group + 0x80, device id nibbles swapped (0x12 -> 0x21).
- Values: the base firmware log shows MotorMode 12 = Work, 0 = Standby, but the byte Pit House/Boxflat WRITES for
  `set-work-mode` was not confirmed at that point (it turned out to be 0 = Work, 1 = Standby, see part 1).

## Confirmed on the user's PC (Pit House 1.4.1.13)
- R5 is a USB serial (CDC) device on COM3. Pit House holds COM3 open the whole time it runs (IO log every ~20 ms).
  Windows serial ports are exclusive, so a second program (the plugin) cannot open COM3 while Pit House runs.
- Pit House > Base > Miscellaneous > "Current Mode": LEFT button = Standby Mode, RIGHT = Work Mode (the screen capture of
  Pit House is washed out unless Pit House's own Dark Mode is on; the log line "Motor - Current Mode - ... text: <name>" shows which was pressed).
  Computer use needs `MOZA Pit House` AND the worker `bin\moza pit house.exe` granted; the window sat behind the desktop
  shell so a click-only "File Explorer" grant was also needed.
- Pressing Standby: base log `motor_mode.c:28 Set MotorMode to:0`, `MotorMode From 12 to 0`, `Gpw Wheel Disconnected`.
  Pressing Work: `Set MotorMode to:12`, `From 0 to 12`, `Gpw Wheel Successfully Connected` (~1.2 s). Both verified live.
  Logs: `%LOCALAPPDATA%\MOZA Pit House\Logs\...-Common.log` (button clicks) and `...\DeviceLog\2026-10\22.txt` (base firmware).
- Pit House does not log the bytes of this command, so logs can't show the write value.

## Not it
- `BaseFfbStatus` ([33,6]/[33,7]) = "Base FFB Output Signal". Not Work Mode. Pit House's own command database
  (`bin\rs21_parameter.json`) has no work-mode command.
- Official MOZA Racing SDK (MOZA_SDK.zip 1.0.1.8, talks to the running Pit House over CoAP): no standby/work-mode
  call. Only `stopForceFeedback()`, `CenterWheel()`, `SoftReboot()`, `setMotorFfbStrength` etc. Pit House also publishes a
  CoAP resource `.../<id>/SetMotorRunState` (private; turned out not to be the switch, see part 1).

## Routes to a "clean" key (as offered; route 1 was built)
1. Plugin quits Pit House, sends the serial command on COM3, relaunches Pit House. **Built and working.**
2. Talk to Pit House's private CoAP `SetMotorRunState`. Tried: accepted but not the Work/Standby switch.
3. Click Pit House's button automatically (works, shown live; window flashes; fragile). Not built.
4. "Stop force" key via the official SDK (not real standby). Not built.
