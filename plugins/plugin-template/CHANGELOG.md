# Changelog

Newest first.

## 1.0.0 - 2026-10-24

First version.

- Example key and Setup key, with the settings panel for both.
- Drawing with resvg and the Inter font: text steps down from 22 to 19 px and then shortens with "...", numbers are 50 px, "%" is drawn as shapes.
- Keys next to each other join (value, then status). One key in a group shows the name. The side screen never joins.
- A demo reader in `source.js` to replace with the real one. It only reads.
- Settings that arrive late show a waiting picture. If they never arrive the plugin starts with defaults after 2.5 seconds.
- Installer with install.bat and uninstall.bat. Uninstall keeps saved settings and readings.
- Build tool (`--zip` makes the build zip and source zip), `new-plugin.js` to start a renamed copy, and a test kit (fake Ajazz host, 15 tests, settings panel in headless Chromium, installer under PowerShell 7, whole-deck preview picture).

Found and fixed while testing:
- Remembered readings from one source could show up under another. They are now kept per source.
- The source is read only after the saved settings arrive, so the first reading uses the right source.
- An answer from a source that was switched away mid-read is dropped.
- The installer compares file paths correctly on both Windows and the Linux test machine.
- Some tests could not fail (for example "no pictures after shutdown" when the connection was already closed). They were fixed or removed.

Published on GitHub on 2026-11-13. No code change.
