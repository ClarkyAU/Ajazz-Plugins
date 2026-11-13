# Plugin template (com.clarkyau.starter) — what it is and how to use it

Copy of the Project note `claude/plugin-template.md`, taken 2026-11-13. The PC user name in one path was replaced with `%USERPROFILE%`.

Built 2026-10-24. A small working Ajazz plugin that every new plugin starts from. Replaces "copy an old plugin and strip it".

## Where it lives
- Google Drive (the user's choice, 2026-10-24): `My Drive\Stream Dock\Plugin-Template\StarterPlugin-1.0.0-source.zip`
  = `%USERPROFILE%\My Drive\Stream Dock\Plugin-Template\...` on the PC (Google Drive for desktop). Copy checked identical (sha1 0dcc375a...).
- Plugin sources go the same way: one folder per plugin under `My Drive\Stream Dock\` (BambuMonitor-StreamDock and NowPlaying-Ajazz-Plugin are already there).
- To use it: the user adds the `Stream Dock` folder with "+" beside the message box (or I call device_request_folder_access for it), then device_stage_files.
- Drive quirk: staging can be refused once with "file is hardlinked (nlink > 1)". Retry after a few seconds; it worked on the second try. Also wait 2 s before reading the staged file.
- Do NOT keep the code in this project: project_read returns a whole doc inline (a 97 KB bundle cost ~30K tokens to read back).
- The cloud workspace does not reliably last between chats (on 2026-10-24 the iCUE source was gone). The Drive copy is the durable one.
- Save each finished plugin's source zip (and build zip if wanted) to its own Drive folder when we deliver it.

## Start a new plugin
    unzip StarterPlugin-1.0.0-source.zip -d template && cd template && npm install
    node tools/new-plugin.js <shortname> "<Display Name>"     # makes ../<shortname>, id com.clarkyau.<shortname>
    cd ../<shortname> && npm install && node tools/build.js && node test/run-tests.js
Node 20.8.1 (`NODE20=` for the tests), PowerShell 7 (`PWSH=`), Chromium (`CHROME=`). The template's own README.md has the full list.

## What is in it
Example + Setup keys, main program, replaceable source reader (`src/plugin/source.js`), resvg drawing with text-fit, layout and joining,
settings panel (Setup panel + per-key panel, open controls never rebuilt), installer (install/uninstall, uninstall keeps data), build tool (--zip),
tests (fake Ajazz host, 15 scenarios, panel in headless Chromium, installer under PS7, deck preview).

## Checked (2026-10-24)
All 15 tests pass, also on a renamed copy. Tests were shown to FAIL when the code was broken on purpose (text overflow, name on every joined key,
"%" as text, text under 19 px). Not provable without the deck: Ajazz loading it, how keys look on screen, reading order of joined keys on the real
deck (layout.js numbering copied from the iCUE plugin), installer under Windows PowerShell 5.1, any real device.

## Differences from the old iCUE plugin
- Drawing is resvg PNG + Inter font (iCUE 1.0.0 sent SVG text). Font comes from npm `@expo-google-fonts/inter`, packed into index.js (about 4.3 MB).
- The source is polled only after the saved settings arrive; remembered readings are kept per source (a bug found while testing).
- Not included: PowerShell helper / HID / serial code (use plugin-lessons.md), press actions, scheduled work. Add as a separate add-on if wanted.
