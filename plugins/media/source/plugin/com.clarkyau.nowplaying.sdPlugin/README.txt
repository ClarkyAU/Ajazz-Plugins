NOW PLAYING - plugin for the Ajazz AKP153E (Ajazz / Stream Dock software)
Plugin ID: com.clarkyau.nowplaying   Author: clarkyau

Album art, track title, artist, album, player, time and a progress bar on your
keys, plus media buttons. Works with Spotify, web browsers, Apple Music and any
player that shows in the Windows volume popup. No sign-in needed.

INSTALL
1. Extract the zip (right-click > Extract All).
2. Double-click install.bat. It closes the Ajazz software, installs the plugin
   and starts it again. Running it again later updates the plugin and keeps
   your keys and settings. To remove the plugin, double-click uninstall.bat.
   If the previous version (dev.nowplaying.deck) is installed, the installer
   moves its keys and settings over and removes it.

THE KEYS (drag them from "Now Playing" in the action list)
- Album Art: the cover. Neighbouring Album Art keys share one big picture;
  set a key to "Stand alone" to show the whole cover on it.
- Track Info: title, artist, album or player. Keys side by side work as one
  display: names that fit sit still on one key, longer names scroll across all
  of them together. On Automatic, one row shows the title with the artist
  underneath; with two rows, the top row shows the title and the next the
  artist. Each key's "Shows" can be changed.
- Time: time left or time played. Progress Bar: neighbouring keys share one bar.
- Play / Pause, Previous Track, Next Track, Volume Down, Volume Up, Mute.
All of them work on the side screen too; the side screen never joins with the
main keys. The old dev.nowplaying.deck and the earlier single "Now Playing" key
are moved over by install.bat.

SETTINGS (click a key; the panel only shows options for that kind of key)
- Track Info: Shows, Join / Stand alone, text size, long names (scroll speed
  or don't scroll), title and artist colours, background, what pressing does.
- Album Art: Join / Stand alone, what pressing does.
- Time: time left or played, colour, background, what pressing does.
- Progress Bar: Join / Stand alone, background, what pressing does.
- Buttons: Glow or Flat, colour from the album art or your own colour.
- "Use on all keys" copies a key's look to every key of the same kind (all
  six buttons count as one kind), so the deck stays matching.
- Advanced: key positions (only if things land on the wrong keys).

Example layout for the 5x3 keys:
  [Prev ][Play ][Vol+ ][Art  ][Art  ]
  [  -  ][Next ][Vol- ][Art  ][Art  ]
  [Info ][Info ][Time ][Bar  ][Bar  ]    (Info x2 = title + artist strip)

TROUBLESHOOTING
- Log: plugin.log in this folder.
- Nothing shows? Check the music appears in the Windows volume popup (press a
  volume key on the keyboard). The plugin reads the same information.
- Needs Ajazz/Stream Dock software 3.10.188.226 or newer (it includes Node.js).
