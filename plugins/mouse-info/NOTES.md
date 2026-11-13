# Mouse Info plugin (com.clarkyau.mouseinfo) — decisions & findings

Record of this plugin. Update it whenever a decision is made.

## Before starting work in a new chat
- CHECK THE CLOUD WORKSPACE FIRST: /home/claude/mouseinfo holds the source, and the session record
  (/root/.claude/projects/-home-claude/*.jsonl) holds earlier chats in the same session. On 2026-10-21
  Claude missed this and re-asked questions answered on 2026-10-20, which annoyed the user.
- The user wants Claude to build, test, install and read logs itself. Never hand them commands to run.
- Build/test: `node tools/build.js --zip`, `NODE20=/home/claude/tools/package/bin/node node test/run-tests.js`
  (Node 20.8.1 unpacked in /home/claude/tools/package, PowerShell 7 in /home/claude/tools/pwsh for
  `tools/check-cs.ps1`).

## Decisions
- 2026-10-20 (first chat): connects both wireless and cable; listen to the receiver (no other app
  needed); "whatever info we can get"; just the I2 for now. Nothing was delivered that day
  (partial files moved to /home/claude/old-oct20-attempt).
- 2026-10-21 after trying 1.0 on hardware: "history is kinda pointless, just need basic info:
  Battery, how it's connected, profile information." -> removed graph, time left, mouse picture.
- Keys (1.1+): Mouse key "Shows" Battery / Connection / Profile (Automatic in reading order, joined
  neighbours). Battery has per-key low warning; Profile has per-key "Under the number": DPI /
  Polling rate / Nothing, frame colour = DPI stage colour. Setup key: mouse + connection, press =
  search again; its panel picks source (Auto / Glorious / Bluetooth) and mouse. Other keys work
  without the Setup key (no login needed).
- 2026-10-21: user asked to try reading battery over the cable (1.2 test). It failed, so 1.3 is
  listen-only again and the Battery key shows "Charging / On cable" while plugged in.

## What the Model I 2 does (confirmed on hardware 2026-10-21)
- Wireless: sends input report 06 FB <level> <charging> on FF00/FF00 about every 2 minutes
  (also a 06 00 00.. message). First one ~40 s after start. HidD_GetInputReport is not answered.
- USB cable: receiver interface disappears (821D -> 821A) and the mouse sends NOTHING by itself.
  Glorious Core's battery request (feature report 3: 83 00.. checksum 7C, on FF00/0001) is accepted
  (HidD_SetFeature ok) but HidD_GetFeature times out (error 121) and nothing arrives on the input
  channel. So no battery level over the cable.
- Profile button switches are NOT reported (no 04 F1 / 06 F6 on any channel, wired or wireless) and
  Glorious Core does not see them either. Profile shown = what Glorious Core saved
  (%APPDATA%\Glorious Core\datastore\Devices.json currentDeviceProfileId + iterableProfileIds;
  DeviceProfiles.json mousePerformanceRecord: DpiStage[{value,color}], dpiSelectIndex, pollingrate,
  wirelessPollingRate). Profiles have no names.
- Interfaces drop and come back every few minutes (ReadFile error 1167); listener rescans every 3 s.

## Found on the user's PC (confirmed 2026-10-21)
- Glorious Core 2.1.21 (Electron). Its app.asar CAN be read by a plugin's Node (plain fs); the device
  bridge cannot read inside .asar. Probe 0.1 copied Core's code for diagnosis; 1.x deletes it.
- Model I 2 Wireless, VID 093A (PixArt). PIDs: 821D receiver, 821A cable, 821B Bluetooth.
  Same family: Model O 2 (822x), D 2 (824x), O 2 Mini (826x). x: A cable, D receiver, B Bluetooth.
- Receiver MI_01 collections: col01 FF00/0001 feature id 3 (64 B, Core's command channel), col02 mouse,
  col03 consumer (id 4, 3 B), col04 system, col05 FF00/FF00 input id 6 (8 B). MI_00 keyboard.
- Core 2.1.21 never asks these mice for battery; its I2 handler even ignores 06 FB.
- PC has no Bluetooth adapter. Also present: Logitech receiver 046D:C52B, Apple keyboard 05AC:024F.
- Computer use can't type into PowerShell/terminals (click-only) — use a plugin build to run things.

## Known issues / not tested on hardware
- Bluetooth mice and the Model O 2 / D 2 / O 2 Mini are tested against fakes only.
- install.bat / uninstall.bat not run on the real PC (installed by copying files).
- The test fixtures in source/test/fixtures/core use made-up profile and device IDs (the real ones
  were replaced before publishing).

## Versions
- 0.1 probe: read-only diagnostics.
- 1.0.0: battery/time/graph/connection/picture. Battery 21% confirmed on hardware.
- 1.1.0: battery / connection / profile, cable = charging (last level greyed).
- 1.2.0: test of the cable battery request (failed, see above).
- 1.3.0 (2026-10-21, installed, zips delivered): listen-only; cable shows Charging.
- On GitHub: plugins/mouse-info/, v1.3.0, 2026-11-13.
