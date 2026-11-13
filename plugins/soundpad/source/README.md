# Soundpad "right sound" patch - source

Fixes the Ajazz store plugin `com.hotspot.soundpad` (Soundpad Integration 1.0.260929) playing the
wrong sound after the Soundpad list changes. The store plugin plays by Soundpad position number;
this helper sits between the Stream Dock software and `SoundpadPlugin.exe`, and before each Play
Sound press it asks the exe for the current list (its own "refresh" command), finds the sound by
name and corrects the number.

- `src/index.js` - the helper. `src/main.js` starts it.
- `build.sh` - bundles it (with `ws`) into `dist/patch/index.js` (esbuild, Node 20).
- `package.sh` - builds, then makes the release zip and source zip in `dist/releases/`.
- `installer/` - install.bat / install.ps1 (patches the installed store plugin, keeps a copy of its
  manifest), uninstall.bat / uninstall.ps1 (puts it back), README.txt for the release zip.
- `plugin-files/` - small files copied into the plugin folder next to the helper.
- `test.sh` - runs everything: `npm ci`, then `NODE20=/path/to/node20 PWSH=/path/to/pwsh ./test.sh`.
  - `test/patch.test.js` - 14 tests against `test/tools/host.js` (fake Stream Dock host) and
    `test/tools/fake-exe.js` (fake SoundpadPlugin.exe, behaving the way its log shows).
  - `test/installer-test.sh` - runs the real install.ps1 / uninstall.ps1 under PowerShell 7.
  - `test/sample-list.json`, `test/sample-settings.txt` - a sound list and key settings with the same
    shape as the store plugin's log (positions, duplicates, stale categories), with made-up names.
  - `test/fixtures/` - the store plugin's manifest, and the patched one confirmed on the PC.

The manifest change the installer makes, after `"CodePath": "SoundpadPlugin.exe",`:
`"CodePathWin": "patch/index.js", "Nodejs": { "Version": "20" },`
