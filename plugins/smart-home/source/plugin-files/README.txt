SMART HOME - plugin for the Ajazz AKP153E (Ajazz / Stream Dock software)
Plugin ID: com.clarkyau.smarthome   Author: clarkyau

Turns Smart Life / Tuya Wi-Fi plugs, switches and lights on and off from your
keys - Arlec Grid Connect, Brilliant, Mirabella, Deta and other Tuya-based
brands, once they're in the Smart Life app. Keys show the real state, even
when something is switched from Google Home or the phone. The plugin talks to
the devices directly over your home Wi-Fi, so it's fast and keeps working if
the internet drops. Google Home keeps working as before.

INSTALL
1. Extract the zip (right-click > Extract All).
2. Double-click install.bat. It closes the Ajazz software, installs the
   plugin and starts it again. Running it again later updates the plugin and
   keeps your device list. To remove the plugin, double-click uninstall.bat.
   If the old version (dev.smarthome.tuya) is installed, the installer moves
   your keys and saved account details over and removes the old version.
3. If Windows asks whether "node.exe" may use the network, choose Allow
   (private networks). That lets the plugin find your devices.

SET-UP (once)
1. Drag the "Setup" key from the Smart Home list onto your deck (the side
   screen is a good spot).
2. Click it. Paste the Access ID and Access Secret from iot.tuya.com (your
   cloud project's Overview tab) and press "Save & connect". Data centre:
   leave on Auto (Australian accounts use Central Europe).
3. The Setup key shows "Connected" and how many devices it found.
   Pressing the Setup key opens the Tuya site (before set-up) or reconnects.
Until this is done the other keys say "Add the Setup key" or "Finish the
Setup key".

THE KEYS
- Switch: tap to turn a plug or switch on/off.
- Light: tap to turn a light on/off. Glows in the bulb's own colour.
- Brightness: tap steps 25/50/75/100%. Slider keys jump to their own level.
- Power Use: live watts, or a graph of the last few minutes.

Every key has these settings (click the key):
- Device and Outlet (for power boards).
- Shows: what this key displays - e.g. icon and name, name, On/Off, watts,
  brightness level, slider, graph. Automatic picks from the key's position.
- Join with neighbouring keys: keys side by side for the same device join
  into one display (e.g. icon, then the name across the next keys, then
  watts). Neighbouring Slider or Graph keys share one picture. Choose
  "Stand alone" to keep a key separate. Main keys and the side screen never
  join.
- Name on key, Icon, Colour, Glow or Flat, and (Power Use) what pressing does.

Example: [icon][name][watts] for the Racing Cockpit = three Switch keys side
by side; [watts][graph][graph] = three Power Use keys.

TROUBLESHOOTING
- Log: plugin.log in %APPDATA%\HotSpot\StreamDock\plugins\com.clarkyau.smarthome.sdPlugin
  (your Access ID and Secret are never written to it).
- A key says "Looking..." or "Offline": the device wasn't found on the home
  network. Check it works in the Smart Life app and the PC is on the same
  network. If Windows Firewall blocked node.exe, the plugin scans the network
  instead (takes a minute).
- Setup key says "Trial ended": your free Tuya cloud trial ran out. The keys
  keep working from the saved device list; only refreshing the list needs it.
  Extend it at iot.tuya.com > Cloud > My Services > IoT Core.
- Re-paired a device? Press the Setup key to refresh - re-pairing changes its key.
- Needs Ajazz/Stream Dock software 3.10.188.226 or newer (it includes Node.js).
