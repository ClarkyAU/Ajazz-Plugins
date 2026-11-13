# Soundpad "right sound" patch

A fix for the **Soundpad Integration** plugin from the Ajazz store, for the Ajazz "Stream Dock AJAZZ Global" software (3.10.x) on the AKP153E.

**The problem it fixes:** the store plugin's Play Sound keys remember a sound by its *position number* in Soundpad's list, not by the sound itself. When you add, remove or sort sounds in Soundpad, the numbers shift and keys play the wrong sound until you press Refresh in each key's settings.

**What the patch does:** just before each Play Sound key press, a small helper asks Soundpad where that key's sound is now (by name), fixes the saved number if it moved, then lets the press go through. If the sound has been deleted or renamed in Soundpad, the key shows a warning instead of playing a different sound.

- **Patches:** `com.hotspot.soundpad` (Soundpad Integration 1.0.260929, author hotspot). This is not a separate plugin, so it has no `com.clarkyau` ID of its own.
- **Version:** 1.0.0 (helper from 20 Oct 2026; installer added 13 Nov 2026)
- **Needs:** Windows 10 or newer, the Ajazz software, Soundpad, and the Soundpad Integration plugin from the Ajazz store. Nothing else to install: it runs on the Node 20 inside the Ajazz software.

## Keys and settings

No new keys and no new settings. Your existing Soundpad keys and their settings stay exactly as they are.

- **Play Sound:** now always plays the sound you picked, even after the Soundpad list changes. The "Sound Index" in its settings panel updates itself.
- **Same-named sounds** (for example two sounds both called "output"): the key remembers which copy it uses. Giving them different names in Soundpad is still the safest.
- **Stop, Pause, Play Random, Record, Remove:** unchanged. (Remove still works by position number, as the store plugin does.)

## Install (plain steps)

1. Install **Soundpad Integration** from the Ajazz store first, if you haven't already.
2. Download `releases/com.hotspot.soundpad-patch-1.0.0.zip` and unzip the whole thing.
3. Double-click `install.bat` inside it. It closes the Ajazz software, adds the patch and starts the software again (about 10 seconds). Your keys are kept.
4. Press a Soundpad key: it plays the right sound.

**After a store update** of the Soundpad plugin, the patch is gone: run `install.bat` again. If the store's new version is different from the one this was made for, the installer stops and changes nothing.

**To remove it:** double-click `uninstall.bat` from the unzipped release. It puts the store plugin back exactly as it was.

The `install.bat` and `uninstall.bat` in this folder are copies of the ones inside the zip. They only work next to `install.ps1` and the patch files, so use the ones from the unzipped release.

## What is tested, and what needs the real hardware

Tested here (on Node 20.8.1 and PowerShell 7):
- 14 helper tests against a fake Ajazz host and a fake copy of the store program (built from what its log shows), using a real sound list and real key settings from the log: moved sounds, unchanged sounds, deleted sounds, same-named copies, a stale category, Push-to-Play order, the settings panel Refresh, falling back to the saved number if the list doesn't arrive, and shutting down.
- 5 installer tests running the real install.ps1 / uninstall.ps1: the patched manifest is byte-for-byte the one confirmed on the PC, installing twice is safe, uninstall restores the original exactly, and it refuses an unknown plugin version or a missing store plugin.

Confirmed on the real PC (20 Oct 2026): the patched plugin plays the right sounds.

Not tried on the real PC yet: the new `install.bat` / `uninstall.bat` themselves (the patch was installed by hand that day). They run the same steps as the iCUE Battery installer, which works.

Source and how to build/test: see `source/README.md`. Background and decisions: `NOTES.md`.
