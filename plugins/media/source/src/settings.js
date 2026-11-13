'use strict';
// Per-key settings (saved by the Stream Dock software on each key), the one
// deck-wide setting (key positions), and conversion from earlier versions:
//   v1  dev.nowplaying.deck.*               (shared settings)
//   v2  com.clarkyau.nowplaying.display      (one action for everything)

const ID = 'com.clarkyau.nowplaying';
const OLD_ID = 'dev.nowplaying.deck';

const CONTROLS = ['playpause', 'prev', 'next', 'voldown', 'volup', 'mute'];
const DISPLAYS = ['art', 'info', 'time', 'progress'];
const ACTIONS = [...DISPLAYS, ...CONTROLS];

// What a Track Info key shows. "auto" picks from the key's position.
const INFO_SHOWS = ['auto', 'titleartist', 'title', 'artist', 'line', 'album', 'player'];

const LOOK = {
  size: ['small', 'medium', 'large'],
  scroll: ['off', 'slow', 'normal', 'fast'],
  background: ['dark', 'tinted'],
  press: ['playpause', 'next', 'none'],
  time: ['remaining', 'elapsed'],
  style: ['glow', 'flat'],
  color: ['art', 'custom']
};

const DEFAULTS = {
  art: { v: 3, join: true, press: 'playpause' },
  info: {
    v: 3, show: 'auto', join: true, size: 'medium', scroll: 'normal',
    titleColor: '#ffffff', artistColor: '#b4b4c0', background: 'dark', press: 'playpause'
  },
  time: { v: 3, time: 'remaining', titleColor: '#ffffff', background: 'dark', press: 'playpause' },
  progress: { v: 3, join: true, background: 'dark', press: 'playpause' },
  control: { v: 3, style: 'glow', color: 'art', customColor: '#7888ff' }
};
const defaultsFor = (action) => DEFAULTS[action] || DEFAULTS.control;

// Settings that "Use on all ... keys" copies (not what a key shows or joining).
const LOOK_KEYS = ['size', 'scroll', 'titleColor', 'artistColor', 'background', 'press', 'time', 'style', 'color', 'customColor'];

function parseColor(v) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

function cleanKeySettings(action, input) {
  const src = input && typeof input === 'object' ? input : {};
  const base = defaultsFor(action);
  const out = { ...base };
  for (const k of Object.keys(base)) {
    if (k === 'show') out.show = INFO_SHOWS.includes(src.show) ? src.show : base.show;
    else if (k === 'join') out.join = src.join !== false;
    else if (/Color$/.test(k)) out[k] = parseColor(src[k]) ? toHex(parseColor(src[k])) : base[k];
    else if (LOOK[k] && LOOK[k].includes(src[k])) out[k] = src[k];
  }
  out.v = 3;
  return out;
}

function cleanGlobals(input) {
  const src = input && typeof input === 'object' ? input : {};
  return { keyLayout: ['auto', 'akp153', 'standard'].includes(src.keyLayout) ? src.keyLayout : 'auto' };
}

// ---------------------------------------------------------------------------
// Earlier versions
// ---------------------------------------------------------------------------
// v1: dev.nowplaying.deck.<action> with one set of shared settings.
function fromV1(oldAction, old) {
  const o = old && typeof old === 'object' ? old : {};
  const look = {
    size: o.textSize, scroll: o.scrollSpeed, titleColor: o.titleColor, artistColor: o.artistColor,
    background: o.textBackground, press: o.artPress,
    style: o.controlStyle, color: o.controlColor, customColor: o.customColor
  };
  const info = (show) => ({ action: 'info', settings: cleanKeySettings('info', { ...look, show }) });
  switch (oldAction) {
    case 'art': return { action: 'art', settings: cleanKeySettings('art', look) };
    case 'title': return info('title');
    case 'artist': return info('artist');
    case 'combined': return info('auto');
    default:
      return CONTROLS.includes(oldAction) ? { action: oldAction, settings: cleanKeySettings(oldAction, look) } : null;
  }
}

// v2: com.clarkyau.nowplaying.display, with "show" (auto = what it showed then).
function fromV2(settings, resolved) {
  const s = settings && typeof settings === 'object' ? settings : {};
  let show = s.show === 'auto' ? (resolved || 'art') : s.show;
  if (show === 'art') return { action: 'art', settings: cleanKeySettings('art', s) };
  if (show === 'time') return { action: 'time', settings: cleanKeySettings('time', s) };
  if (show === 'progress') return { action: 'progress', settings: cleanKeySettings('progress', s) };
  if (!INFO_SHOWS.includes(show)) show = 'auto';
  return { action: 'info', settings: cleanKeySettings('info', { ...s, show }) };
}

module.exports = {
  ID, OLD_ID, CONTROLS, DISPLAYS, ACTIONS, INFO_SHOWS, LOOK_KEYS, DEFAULTS,
  defaultsFor, cleanKeySettings, cleanGlobals, fromV1, fromV2, parseColor, toHex
};
