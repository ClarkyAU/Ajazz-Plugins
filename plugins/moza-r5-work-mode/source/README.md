# Moza Base (com.clarkyau.mozabase)
Ajazz Stream Dock plugin for the Moza R5. One key shows Work/Standby and toggles it.
Pressing it closes Moza Pit House, sets the base over its USB serial port (COM3), and reopens Pit House.
Optionally follows the cockpit smart plug: plug on = Work + start Pit House, plug off = close Pit House + Standby.
The plug's address and local key are read (read-only) from the Smart Home plugin's devices.json; nothing there is changed.

Mode byte (verified on a real R5): 0 = Work, 1 = Standby. Frames: see src/frames.js.
Scripts: `npm run build` (esbuild bundle into dist/), `npm test` (needs Node 20; set NODE20=path to node),
`npm run package` (zips into out/). Tests run the real bundle against a fake Ajazz host, a fake Tuya plug and a fake serial
layer, and check every key image against the Ajazz quirks.
Install: run install.bat from the build zip (keeps settings). Remove: uninstall.bat. Log: plugin.log in the plugin folder.
