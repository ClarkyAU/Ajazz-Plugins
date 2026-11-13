# Changelog

Newest first.

## 1.0.0 - 2026-10-26

First version. It was built and tested over 24-26 Oct 2026 and installed on the author's PC as it grew; there were no separate releases before this one.

- Battery key: a picture of the device, the real battery percentage (iCUE's own app only shows Low/Medium/High), a bar and the model name. It goes red and flashes at or below a warning level (default 20 percent, can be turned off per key).
- Microphone (on or muted) and connection keys. Neighbouring keys fill in Battery, Microphone and Connection in reading order; each key has "Shows", "Join with neighbouring keys" and "Device" settings.
- Setup key: shows the iCUE connection, picks the default device, and has "Check every 5/10/30/60 seconds". Other keys say "Add the Setup key" or "Finish the Setup key" until it is done.
- Charging: the battery key turns blue with a bolt, says "Charging", and the bar fills up and repeats. It reads iCUE's tray icon text (real time), then the headset's USB receiver (20-40 seconds behind), and only on a PC with no receiver it guesses from iCUE's battery value disappearing.
- Headset switched off: the last reading stays on the key, greyed, with "Not found". Detected from the tray text disappearing, the iCUE SDK's "disconnected" event, or the receiver not answering.
- Sidetone, surround sound and equaliser were built first and then removed, because they were not wanted.
- Installer: install.bat and uninstall.bat (uninstall keeps settings). Needs nothing installed: it runs on the Node 20 inside the Ajazz software and the PowerShell that comes with Windows.
- Test kit: a fake Ajazz host and fake helper, 32 tests on Node 20.8.1, checks on every key picture, and whole-deck preview images.

Found and fixed while building:
- Pressing the cable in made no change at first: the receiver's charge answer was matched against a heartbeat reply instead of a property reply.
- The receiver also forwards iCUE's own replies, which could be read as the charge flag. A changed value now has to be seen twice in a row.
- A long scan of receiver properties blocked the charge check for 40 minutes. The scan was removed.
- "Charging" was shown for a headset that was switched off, because its battery value also disappears. The guess now only applies on a PC with no receiver at all.
- A stale "disconnected" mark kept the key on "Not found" after the headset came back. A live battery reading now overrides it.
- Tray text with line breaks made the helper's messages invalid, so the plugin ignored them and showed "not connected". The text is cleaned first.

Known gaps:
- The Setup panel does not yet tell you to switch on iCUE's "Enable Battery Gauge in Notification Area" (needed for the instant charging signal; the tray text is English iCUE only).
- The key going grey the moment the tray text disappears was installed but not yet checked on the real headset.
- Tried only with an HS80 MAX Wireless. Other Corsair devices should show battery percentage but charging and off detection are untested.
