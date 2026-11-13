'use strict';
// Line icons, all drawn in a 48 x 48 box with the same round-capped stroke so they look like one family.
// Each function returns SVG shapes; the caller wraps them in a <g> that positions and colours them.

const icons = {
  headset: '<path d="M9 27v-4a15 15 0 0 1 30 0v4"/><rect x="5" y="26" width="8" height="14" rx="3.5"/><rect x="35" y="26" width="8" height="14" rx="3.5"/><path d="M39 40v1a4 4 0 0 1-4 4h-7"/>',
  mouse: '<rect x="13" y="4" width="22" height="40" rx="11"/><path d="M13 19h22M24 4v15"/>',
  keyboard: '<rect x="3" y="11" width="42" height="26" rx="4"/><path d="M10 19h2M17 19h2M24 19h2M31 19h2M38 19h0M10 25h2M17 25h2M24 25h2M31 25h2M38 25h0M14 31h20"/>',
  stand: '<path d="M24 4c-7 0-11 5-11 11v6c0 4 3 7 6 7h10c3 0 6-3 6-7v-6c0-6-4-11-11-11z"/><path d="M24 28v12M12 44h24"/>',
  device: '<rect x="8" y="8" width="32" height="32" rx="7"/><circle cx="24" cy="24" r="5"/>',
  mic: '<rect x="17" y="4" width="14" height="24" rx="7"/><path d="M10 22v2a14 14 0 0 0 28 0v-2M24 38v6M17 44h14"/>',
  micMuted: '<rect x="17" y="4" width="14" height="24" rx="7"/><path d="M10 22v2a14 14 0 0 0 28 0v-2M24 38v6M17 44h14"/><path d="M6 6l36 36" stroke-width="5"/>',
  bolt: '<path d="M28 3L11 27h12l-3 18 17-25H25z"/>',
  link: '<path d="M6 20a26 26 0 0 1 36 0M13 28a16 16 0 0 1 22 0"/><circle cx="24" cy="37" r="3"/>',
  plug: '<path d="M16 4v10M32 4v10"/><path d="M10 14h28v8a14 14 0 0 1-28 0z"/><path d="M24 36v8"/>',
  question: '<path d="M16 17a8 8 0 1 1 11 7.4c-2 1-3 2.5-3 4.6"/><circle cx="24" cy="39" r="1.5"/>',
};

function iconForKind(kind) {
  // CorsairDeviceType: 1 keyboard, 2 mouse, 8 headset, 16 headset stand
  if (kind === 8) return 'headset';
  if (kind === 2) return 'mouse';
  if (kind === 1) return 'keyboard';
  if (kind === 16) return 'stand';
  return 'device';
}

function kindName(kind) {
  if (kind === 8) return 'Headset';
  if (kind === 2) return 'Mouse';
  if (kind === 1) return 'Keyboard';
  if (kind === 16) return 'Stand';
  return 'Device';
}

// Draws icon `name` at (x, y) with the given size (px) and colour.
function drawIcon(name, x, y, size, color) {
  const s = size / 48;
  return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="none" stroke="' + color +
    '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">' + (icons[name] || icons.device) + '</g>';
}

module.exports = { icons, iconForKind, kindName, drawIcon };
