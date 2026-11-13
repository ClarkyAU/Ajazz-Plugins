# Changelog

## 1.0.0 - 13 Nov 2026 (release package)
- Added `install.bat` / `uninstall.bat` (with install.ps1 / uninstall.ps1). The installer patches the installed store plugin, keeps its original manifest, and refuses a store version it doesn't know. The uninstaller puts the original back.
- Added installer tests (run under PowerShell 7). The helper itself is unchanged.

## 1.0.0 - 20 Oct 2026
- First version. A Node helper starts the store plugin's `SoundpadPlugin.exe` and passes everything through. Before each Play Sound press it gets Soundpad's current list from the exe, finds the key's sound by name and corrects the saved number.
- Same-named sounds: remembers which copy a key uses.
- A sound no longer in Soundpad shows a warning on the key instead of playing a wrong sound.
- If the list doesn't arrive within 1.5 s, the press plays the saved number as before.
- Installed by hand on the PC and confirmed working on the real hardware the same day.
