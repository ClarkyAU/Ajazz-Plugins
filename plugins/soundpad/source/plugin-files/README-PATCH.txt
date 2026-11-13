Soundpad "right sound" patch (by Claude for clarkyau)

What it does
  Before each Play Sound key press, a small helper asks Soundpad where the key's sound is
  now (by name) and fixes the saved number if it moved. Your keys and settings stay as they are.
  If a key's sound is no longer in Soundpad, the key shows a warning instead of playing another sound.

Files added to this folder
  patch\index.js           the helper (runs on the Stream Dock software's built-in Node)
  patch\patch.log          what it fixed (created when it runs)
  manifest.original.json   the store plugin's original manifest
  restore-original.bat     undo: puts the original manifest back
                           (or use uninstall.bat from the release zip)

Note: an update of this plugin from the Ajazz store will replace manifest.json and undo the patch.
