# Soundpad plugin - decisions & findings

Copy of the Project note `claude/soundpad-plugin.md` (13 Nov 2026), with details from the chat that made the patch.

## From the Project note
- Soundpad plays a sound by its list POSITION, and positions shift when the list changes.
- The patch maps sounds by name instead; the panel asks for a refresh with sendToPlugin {refresh:true}.
- The patch works by Node acting as a man-in-the-middle: Soundpad is pointed at our code through CodePathWin, with the exe running on a local port.
- A store update of Soundpad undoes the patch.

## Details (20 Oct 2026)
- Cause, proven from the store plugin's own log: on a key press `SoundpadPlugin.exe` (closed-source Qt/C++) sends `DoPlaySound(<SoundIndexInput>)` to Soundpad. In 4 days of logs, 46 of 62 sounds changed position. Refresh only fixed a key until the next change.
- Key settings saved by the store plugin: CategorySelect, SoundSelect (the name), SoundIndexInput (the number, as text), ShowTitleCheck, PTPModeCheck. CategorySelect is often stale, so the name is matched first and the category is only a tie-break.
- The exe answers `sendToPlugin {refresh:true}` at any time (the settings panel doesn't need to be open) with `sendToPropertyInspector` payload `{CategoryAndSounds:{categories, indexs, sounds:[{category,index,name}]}}`. It gets this from Soundpad with `GetCategories(true, false)`. So the helper never talks to Soundpad itself and uses exactly the same names as the store plugin.
- Why not patch the exe: it is closed source. Why not a new plugin: the user wanted a quick fix to keep their keys.
- How it works: the manifest gets `"CodePathWin": "patch/index.js", "Nodejs": {"Version":"20"}`. The helper starts its own local WebSocket server, launches the exe with that port (after closing any leftover copy), and relays both ways. For a soundpadplay keyDown it: asks for the list, finds the sound, saves the fixed settings with setSettings, sends the exe a didReceiveSettings with them, and forwards the corrected press. Messages stay in their original order (press then release for Push-to-Play).
- Same-named sounds: extra settings PatchName / PatchIndex / PatchRank remember which copy (1st, 2nd...) a key means. If the user changes the sound in the panel, the panel's choice wins.
- Sound gone from Soundpad: showAlert on the key, no play.
- Helper log: `patch/patch.log` in the plugin folder (rolls over at 1 MB).
- Undo: uninstall.bat, or restore-original.bat in the plugin folder.

## Known issues / limits
- A store update replaces manifest.json and undoes the patch. Run install.bat again.
- Remove Sound keys still work by position number (they only store a number).
- The new install.bat / uninstall.bat have not been run on the real PC yet.

On GitHub: plugins/soundpad/, v1.0.0, 13 Nov 2026
