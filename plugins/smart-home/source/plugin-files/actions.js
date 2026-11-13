'use strict';
// Single source for manifest.json and en.json.
module.exports = {
  id: 'com.clarkyau.smarthome',
  name: 'Smart Home',
  version: '2.0.0',
  description: 'Control Smart Life / Tuya Wi-Fi plugs, switches and lights (Arlec Grid Connect, Brilliant, Mirabella and more) straight over your home network.',
  actions: [
    { key: 'setup', name: 'Setup', tooltip: 'Your Tuya account. Shows the connection status. Press to open Tuya (not set up yet) or to reconnect.' },
    { key: 'switch', name: 'Switch', tooltip: 'Turn a smart plug or switch on and off. Keys side by side for the same device join into one display.' },
    { key: 'light', name: 'Light', tooltip: "Turn a smart light on and off. Glows in the bulb's own colour." },
    { key: 'brightness', name: 'Brightness', tooltip: 'Light brightness. One key steps 25/50/75/100%. Keys side by side make a slider: each key jumps to its level.' },
    { key: 'power', name: 'Power Use', tooltip: 'Live watts from a plug with an energy meter. Keys side by side add a graph.' },
  ],
};
