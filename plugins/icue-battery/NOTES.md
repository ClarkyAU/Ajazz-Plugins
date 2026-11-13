# iCUE Battery plugin (com.clarkyau.icuebattery) — decisions & findings

_Copy of the Project note `claude/icue-battery-plugin.md`, taken 2026-11-13. The Project note is the live one._

## Why / what
User's Corsair iCUE only shows Low/Medium/High for the HS80 MAX Wireless. Plugin shows the real battery %, mic state,
connection and CHARGING (animated). Status 2026-10-26: working on the user's hardware in REAL TIME (battery %, charging, headset off/on),
using iCUE's tray icon text (see "Best signal" below).

## Best signal: iCUE's notification-area (tray) icon text  (found 2026-10-26, user-confirmed "real time")
- iCUE setting "Enable Battery Gauge in Notification Area" (Device Settings) puts an icon whose accessible name is
  `HS80 MAX WIRELESS Battery Status High|Medium|Low|Charging` (with line breaks). It changes the instant the cable goes in/out. While it changes, the text
  can briefly hold BOTH states ("... Status High HS80 MAX WIRELESS Battery Status Charging"): take the text after the LAST "Battery Status".
  When the headset is switched OFF the text disappears completely (empty list). (BarRaider's Stream Deck plugin reads the same icon; it needs iCUE in English.)
- Read with Windows UI Automation from PowerShell 5.1 (`runtime/Tray.cs`, compiled separately in helper.ps1 with `Add-Type -AssemblyName UIAutomationClient,
  UIAutomationTypes, WindowsBase`; walks the Shell_TrayWnd / overflow windows every second; exposes `Tray.Json()` that Helper.cs reads by reflection and adds
  to every state message as `"tray":[...]`). **Clean tray text before putting it in JSON (it has line breaks): one bad line made the plugin ignore all
  state and show "not connected".** If Tray.cs fails to compile the helper just logs a warning and the receiver path remains.
- Plugin logic: tray "Charging" => charging; tray High/Medium/Low => not charging (beats the receiver); tray text gone + iCUE battery value missing for 3 s
  (and the tray text had been seen before) => headset off => grey "Not found". No tray text ever seen (option off) => receiver/SDK paths below.
- The user did NOT want the plugin to read iCUE's log file ("use the SDK"), but accepted the tray icon.

## Confirmed on the user's PC (2026-10-24 / 26)
- iCUE 5.52.93, only device: HS80 MAX WIRELESS (type 8). iCUE SDK (iCUESDK.x64_2019.dll v4.0.84 from
  github.com/CorsairOfficial/cue-sdk releases) reads CDPI_BatteryLevel (9) = real % . Needs iCUE running with
  Settings > Software and Games > Enable SDK on. Sidetone/surround/EQ removed (user: pointless).
- **Official SDK docs (corsairofficial.github.io/cue-sdk, read in full 2026-10-26):** the only battery property is CDPI_BatteryLevel; there is NO
  charging or power property. Only two events exist (device connection changed, key press). CorsairSessionState (CSS_Connected etc.) is the
  link to the iCUE program, not the headset. The page has no changelog. github.com pages are blocked from the cloud session (use the github.io docs).
- The SDK battery value just disappears while the cable is in AND while the headset is off, so "value missing" can't tell them apart.
- USB RECEIVER over HID (backup when the tray icon is not available): 1B1C:0A97, collection usage page FF42 / usage 0001, 64-byte reports:
  `02 09 02 0F` -> `01 01 02 00 lo hi` battery in tenths of a percent; `02 09 02 10` -> byte 4: 1 charging, 2 on battery
  (method from github.com/chrisingram22/hs80-battery-widget). Wake handshake `02 08 02 13`, `02 08 02 12`, `02 09 02 12` if no answer.
- Receiver timing: it answers in ~20 ms but only on fixed 24 s ticks, and its charge flag lags the SDK battery-value change by ~18-24 s (tray icon is
  faster). First report after a restart can take ~80 s, "headset not answering" shows ~70-95 s after switch-off. NEVER run a long property sweep on the
  reader loop. The helper reads the charge flag first, the battery only every 5th round or on a change, trusts one answer when the SDK battery value just
  flipped (plugin sends "now" to the helper), and logs "Charge request answered in N ms".
- Reply matching: property replies have byte 2 == 02; heartbeat replies (byte 2 == 12) are not property replies. **The receiver also
  forwards iCUE's own replies and a reply does not say which property it answers** (seen: iCUE's vendor-id reply 1c1b read as a charge flag of 28).
  So a CHANGE of battery or charge value must be seen twice in a row (a repeat of the last confirmed value needs one read), and the charge flag must be 1 or 2.
- Other receiver properties that answer (status byte 3 = 00): 02,03,0d,0e,0f(battery),10(charge),11,12,13,3a,46,47,48,53. Unsupported ids reply with status 05.
- iCUE's own log shows `Property "ExternalPowerSourcePresent" change not handled` bursts at each plug event, and
  `cue.dev.connection_controller: "HS80 MAX WIRELESS" Wireless -> Disconnected` (also Disconnected -> Wireless, Unknown -> Direct for the PC cable) to the second.
- **SDK device event** (CorsairSubscribeForEvents, id 1; struct: int id at 0, pointer at 8, then char deviceId[128] + bool isConnected; verified against the
  docs): fires "connected" at start-up and on power-on (once seen), and "disconnected" on power-off (seen 95 s before the receiver noticed). It does NOT
  always fire "connected" when the headset comes back, so a live battery reading overrides a stale "disconnected" mark. The cable going in/out sends no SDK event.
- Rejected ideas: reading iCUE's memory (github MrSlimbrowser/ReadBatteryLevel: Void Pro, Cheat Engine pointer chains, breaks on every iCUE update);
  the Python cuesdk event example (same event we already use); an "instant but sometimes wrong" guess from the SDK battery value vanishing (user chose accuracy).
- Local dev can't reach the PC shell directly; updates are copied into the plugin folder via the device bridge, then the user restarts the Ajazz software.

## Decisions
- Reads only (never writes settings to devices).
- Keys: "Device" key (Shows: Automatic / Battery / Microphone / Connection; per-key Join, Device, Low warning) and a "Setup" key
  (iCUE status + default device + "Check every 5/10/30/60 s"). Other keys say "Add the Setup key" / "Finish the Setup key".
- Battery key = device icon + big % (percent sign drawn from shapes) + bar + model; flashes red at/below low level (default 20).
  Charging: blue, bolt, "Charging" label, bar refills from current level (6 frames, 2/s); level while charging comes from the receiver or the last reading.
- Charging source order: iCUE tray text > fresh receiver data > fallback guess (iCUE battery missing for 3 s). The guess is used ONLY on a PC with no
  receiver at all. A slow, stale or "not answering" receiver means unknown/off, never "charging".
- SDK says disconnected, or tray text gone, with no battery reading -> "Not found", greyed, last reading kept (data/last.json).
- Node can't call a DLL, so a PowerShell 5.1 helper (runtime/helper.ps1 + Helper.cs + Tray.cs, cached DLL, C# 5 only) wraps the SDK, HID and tray reads.
- The helper logs every iCUE SDK event ("iCUE event N") and tray text changes ("Tray battery text now") for diagnosis; harmless.
- Not built: press-to-toggle mic, time-left estimate, a Setup-key hint when the tray gauge setting is off (worth adding).

## Dev notes
- `node tools/build.js --zip` (rebuild before tests: they run build/), `node test/run-tests.js` (32 scenarios, ~2 min, run in background), `tools/check-cs.ps1` (C# 5 check; for Tray.cs run with `-Path runtime/Tray.cs` and ignore the missing-UIAutomation-type errors on Linux).
- **Run the tests on Node 20** (the default `node` was 22 once and two timing tests failed there).
- Lesson: when editing several files in one python snippet, don't reuse a variable across files.
- Lesson: when something "can't be done", look at what iCUE/other tools do (their logs, tray icon, GitHub projects) and read the vendor's full docs before saying so. The user pushed back, and was right. The user's own hint ("iCUE updates its tray icon") was the answer.
- Lesson: when the user says it's not working, check their log for the exact moment before theorising; keep diagnostics off the main loop.
- Lesson: a "fallback guess" can become the main bug (headset off looked like charging). Make fallbacks apply only when the better source truly doesn't exist.
- Lesson: anything new that goes into the helper's JSON lines must be cleaned (line breaks etc.); one invalid line silently breaks the whole plugin.
- Lesson: don't ask the user jargon questions about integration choices; they want the plain answer and a working result.
