'use strict';
// Builds the SVG for every key. raster.js turns it into a 144x144 PNG.
// Every function returns { svg, texts } where texts lists each piece of text
// (size and where it sits) so the tests can check readability rules.

const { textWidth, esc, FONT } = require('./raster');

const S = 144;
const GAP = 28;            // gap between keys treated as hidden (≈0.2 of a key)
const PAD = 11;            // space kept clear at each side of a key
const INNER = S - PAD * 2; // widest text that fits on one key
const MIN_TEXT = 19;       // nothing smaller than this
const BG = [14, 14, 18];
const MUTED = [138, 138, 150];
const WHITE = [255, 255, 255];
const MUTE_RED = [255, 104, 104];
const SCROLL_GAP = 56;     // space between the end of scrolling text and its repeat

const rgb = (c) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// ---------------------------------------------------------------------------
// Key frame
// ---------------------------------------------------------------------------
function doc(body, { background = 'dark', accent = null, defs = '' } = {}) {
  let bg = `<rect width="144" height="144" fill="${rgb(BG)}"/>`;
  if (background === 'tinted' && accent) {
    defs += `<linearGradient id="tint" x1="0" x2="0" y1="0" y2="1">` +
      `<stop offset="0" stop-color="${rgb(accent)}" stop-opacity="0.26"/><stop offset="1" stop-color="${rgb(accent)}" stop-opacity="0.07"/></linearGradient>`;
    bg += `<rect width="144" height="144" fill="url(#tint)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144">` +
    `<defs>${defs}<linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">` +
    `<stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="0.07" stop-color="white" stop-opacity="1"/>` +
    `<stop offset="0.93" stop-color="white" stop-opacity="1"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>` +
    `<mask id="edge"><rect x="0" y="0" width="144" height="144" fill="url(#fade)"/></mask>` +
    // strips: fade only at the strip's outer ends
    `<linearGradient id="fadeL" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="0.07" stop-color="white" stop-opacity="1"/></linearGradient>` +
    `<linearGradient id="fadeR" x1="0" x2="1" y1="0" y2="0"><stop offset="0.93" stop-color="white" stop-opacity="1"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>` +
    `<mask id="edgeL"><rect x="0" y="0" width="144" height="144" fill="url(#fadeL)"/></mask>` +
    `<mask id="edgeR"><rect x="0" y="0" width="144" height="144" fill="url(#fadeR)"/></mask></defs>` +
    `${bg}${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Text that always stays inside one key
// ---------------------------------------------------------------------------
const WEIGHT = { title: 700, artist: 500, album: 500, player: 600 };
// [small, medium, large] sizes for one line / two lines
const SIZES = {
  title: { one: [36, 42, 48], two: [30, 34, 38] },
  artist: { one: [34, 40, 46], two: [28, 32, 36] },
  album: { one: [30, 34, 38], two: [26, 29, 32] },
  player: { one: [30, 34, 38], two: [26, 29, 32] }
};
const SIZE_INDEX = { small: 0, medium: 1, large: 2 };

// Splits text into exactly n lines that each fit on the key (most even split),
// or returns null.
function wrapLines(text, size, weight, n) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length < n) return null;
  let best = null;
  const walk = (start, linesLeft, acc, widest) => {
    if (linesLeft === 1) {
      const t = words.slice(start).join(' ');
      const w = textWidth(t, size, weight);
      if (w > INNER) return;
      const score = Math.max(widest, w);
      if (!best || score < best.score) best = { lines: [...acc, t], score };
      return;
    }
    for (let end = start + 1; end <= words.length - (linesLeft - 1); end++) {
      const t = words.slice(start, end).join(' ');
      const w = textWidth(t, size, weight);
      if (w > INNER) break; // longer pieces only get wider
      walk(end, linesLeft - 1, [...acc, t], Math.max(widest, w));
    }
  };
  walk(0, n, [], 0);
  return best ? best.lines : null;
}

// Decides how a piece of text is shown, trying in order:
//   one line at the chosen size, two lines (shrinking to 28 px if needed),
//   three short lines,
//   one smaller line (down to 28 px), and finally one scrolling line.
const SMALLEST_FIT = 28;
function fitText(text, kind, sizeName) {
  const idx = SIZE_INDEX[sizeName] ?? 1;
  const weight = WEIGHT[kind] || 600;
  const one = SIZES[kind].one[idx], two = SIZES[kind].two[idx];
  if (textWidth(text, one, weight) <= INNER) return { mode: 'one', size: one, weight, lines: [text] };
  for (let s = two; s >= SMALLEST_FIT; s -= 2) {
    const lines = wrapLines(text, s, weight, 2);
    if (lines) return { mode: 'lines', size: s, weight, lines };
  }
  for (let s = 30; s >= SMALLEST_FIT; s -= 2) { // three short lines still read well
    const lines = wrapLines(text, s, weight, 3);
    if (lines) return { mode: 'lines', size: s, weight, lines };
  }
  for (let s = one - 2; s >= SMALLEST_FIT; s -= 2) {
    if (textWidth(text, s, weight) <= INNER) return { mode: 'one', size: s, weight, lines: [text] };
  }
  // Scroll at the two-line size so more of the name shows at once.
  return { mode: 'scroll', size: two, weight, lines: [text], width: textWidth(text, two, weight) };
}

// Distance a scrolling line travels before it repeats.
const scrollLoop = (width) => Math.ceil(width + SCROLL_GAP);

// One line of text centred on the key, or scrolling (clipped to this key).
function line(text, { size, weight, color, baseline, offset = 0, scroll = false, width = null }) {
  const w = width ?? textWidth(text, size, weight);
  const attrs = `font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${rgb(color)}" xml:space="preserve"`;
  if (!scroll) {
    const x = (S - w) / 2;
    return {
      svg: `<text x="${x.toFixed(1)}" y="${baseline.toFixed(1)}" ${attrs}>${esc(text)}</text>`,
      text: { size, x0: x, x1: x + w, scrolling: false, value: text }
    };
  }
  const x = PAD - offset;
  const copy = (cx) => `<text x="${cx.toFixed(1)}" y="${baseline.toFixed(1)}" ${attrs}>${esc(text)}</text>`;
  return {
    svg: `<g mask="url(#edge)">${copy(x)}${copy(x + scrollLoop(w))}</g>`,
    text: { size, x0: 0, x1: S, scrolling: true, value: text }
  };
}

// A whole text key (title / artist / album / player), with an optional label.
function textKey(kind, text, o) {
  const color = o.color;
  const label = kind === 'album' ? 'ALBUM' : kind === 'player' ? 'PLAYING ON' : null;
  const centre = label ? 84 : 72;
  const parts = [];
  const texts = [];
  if (label) {
    parts.push(`<text x="72" y="36" text-anchor="middle" font-family="${FONT}" font-size="20" font-weight="600" letter-spacing="2" fill="${rgb(MUTED)}">${label}</text>`);
    const lw = textWidth(label, 20, 600) + 2 * (label.length - 1);
    texts.push({ size: 20, x0: 72 - lw / 2, x1: 72 + lw / 2, scrolling: false, value: label });
  }
  const fit = fitText(text, kind, o.size);
  const capMid = fit.size * 0.35;
  if (fit.mode === 'lines') {
    const lh = fit.size * 1.06;
    const first = centre - (lh * (fit.lines.length - 1)) / 2 + capMid;
    fit.lines.forEach((t, i) => {
      const l = line(t, { size: fit.size, weight: fit.weight, color, baseline: first + i * lh });
      parts.push(l.svg); texts.push(l.text);
    });
  } else {
    const l = line(fit.lines[0], {
      size: fit.size, weight: fit.weight, color, baseline: centre + capMid,
      scroll: fit.mode === 'scroll', offset: o.offsetFor ? o.offsetFor(`${kind}`, scrollLoop(fit.width || 0)) : 0,
      width: fit.width
    });
    parts.push(l.svg); texts.push(l.text);
  }
  return { svg: doc(parts.join(''), o), texts };
}

// Title and artist stacked on one key. The title shrinks or takes two lines
// before it scrolls; the artist shrinks before it scrolls.
const TA_SIZES = { small: [28, 24], medium: [32, 27], large: [36, 30] };
function titleArtistKey(title, artist, o) {
  const [ts, as] = TA_SIZES[o.size] || TA_SIZES.medium;
  const parts = [], texts = [];
  // Title
  let tLines = null, tSize = ts, tScroll = false;
  for (let sz = ts; sz >= 26 && !tLines; sz -= 2) {
    if (textWidth(title, sz, 700) <= INNER) { tLines = [title]; tSize = sz; }
  }
  // Two title lines: big when the key has no artist line, smaller when it does.
  for (let sz = artist ? 26 : ts; sz >= (artist ? 24 : 26) && !tLines; sz -= 2) {
    const l = wrapLines(title, sz, 700, 2);
    if (l) { tLines = l; tSize = sz; }
  }
  if (!tLines) { tLines = [title]; tSize = ts; tScroll = true; }
  // Artist
  let aSize = as, aScroll = false;
  if (artist) {
    while (aSize > 22 && textWidth(artist, aSize, 500) > INNER) aSize -= 2;
    aScroll = textWidth(artist, aSize, 500) > INNER;
    if (aScroll) aSize = as;
  }
  // Centre the whole block on the key.
  const tLh = tSize * 1.04, gap = artist ? Math.round(as * 0.45) : 0;
  const height = tLh * tLines.length + (artist ? gap + aSize : 0);
  let y = 72 - height / 2;
  const rows = tLines.map((t) => { const r = { text: t, size: tSize, weight: 700, color: o.titleColor, baseline: y + tSize * 0.86, scroll: tScroll, id: 'title' }; y += tLh; return r; });
  if (artist) rows.push({ text: artist, size: aSize, weight: 500, color: o.artistColor, baseline: y + gap + aSize * 0.82, scroll: aScroll, id: 'artist' });
  for (const r of rows) {
    const w = textWidth(r.text, r.size, r.weight);
    const l = line(r.text, {
      size: r.size, weight: r.weight, color: r.color, baseline: r.baseline, width: w, scroll: r.scroll,
      offset: r.scroll && o.offsetFor ? o.offsetFor(r.id, scrollLoop(w)) : 0
    });
    parts.push(l.svg); texts.push(l.text);
  }
  return { svg: doc(parts.join(''), o), texts };
}

// ---------------------------------------------------------------------------
// Track Info strips: keys side by side acting as one wide display. Text that
// fits on one key sits still on the middle key; longer text scrolls across
// all the keys together, sliding behind the gaps between them.
// ---------------------------------------------------------------------------
const STRIP_SIZES = {
  stacked: { small: [36, 30], medium: [40, 34], large: [46, 38] },
  single: { small: 44, medium: 50, large: 56 }
};

// lines: [{ size, segs: [{ text, color, weight }] }]   (one or two lines)
const lineWidth = (l, size) => l.segs.reduce((w, sg) => w + textWidth(sg.text, size, sg.weight), 0);

function stripKeys(n, linesIn, o) {
  const W = n * S + (n - 1) * GAP;
  // Text a little too wide for one key shrinks (to 80%) rather than scrolling.
  const shrunk = linesIn.map((l) => {
    for (let size = l.size; size >= Math.max(SMALLEST_FIT - 2, Math.round(l.size * 0.8)); size -= 2) {
      if (lineWidth(l, size) <= INNER) return { ...l, size };
    }
    return null;
  });
  const lines = shrunk.every(Boolean) ? shrunk : linesIn;
  const widths = lines.map((l) => lineWidth(l, l.size));
  let bases;
  if (lines.length === 2) {
    const [a, b] = lines;
    const lh = a.size * 1.04, gap = Math.round(b.size * 0.45);
    const top = 72 - (lh + gap + b.size) / 2;
    bases = [top + a.size * 0.86, top + lh + gap + b.size * 0.82];
  } else {
    bases = [72 + lines[0].size * 0.35];
  }
  const spans = (l) => l.segs.map((sg) =>
    `<tspan font-weight="${sg.weight}" fill="${rgb(sg.color)}">${esc(sg.text)}</tspan>`).join('');
  const textEl = (l, x, y) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${l.size}" xml:space="preserve">${spans(l)}</text>`;
  const out = [];
  const fitsOne = widths.every((w) => w <= INNER);
  if (fitsOne) {
    const target = Math.floor((n - 1) / 2);
    for (let i = 0; i < n; i++) {
      let body = '';
      const texts = [];
      if (i === target) {
        lines.forEach((l, li) => {
          const x = (S - widths[li]) / 2;
          body += textEl(l, x, bases[li]);
          texts.push({ size: l.size, x0: x, x1: x + widths[li], scrolling: false, value: l.segs.map((sg) => sg.text).join('') });
        });
      }
      out.push({ svg: doc(body, o), texts });
    }
    return { keys: out, scrolling: false };
  }
  // Scroll: one copy crosses the whole strip, then the next comes in from the right.
  const period = Math.ceil(Math.max(Math.max(...widths) + SCROLL_GAP, W - PAD));
  const offset = o.offsetFor ? o.offsetFor('strip', period) : 0;
  for (let i = 0; i < n; i++) {
    const shift = i * (S + GAP);
    const mask = i === 0 ? 'edgeL' : i === n - 1 ? 'edgeR' : null;
    let inner = '';
    const texts = [];
    lines.forEach((l, li) => {
      for (const start of [PAD - offset, PAD - offset + period]) {
        const x = start - shift;
        if (x > S || x + widths[li] < 0) continue;
        inner += textEl(l, x, bases[li]);
      }
      texts.push({ size: l.size, x0: 0, x1: S, scrolling: true, strip: true, value: l.segs.map((sg) => sg.text).join('') });
    });
    out.push({ svg: doc(mask ? `<g mask="url(#${mask})">${inner}</g>` : inner, o), texts });
  }
  return { keys: out, scrolling: true };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function timeKey(info, o) {
  // info: { known, position, duration, status }
  let value = '--:--', label = 'TIME', color = MUTED;
  if (info.known) {
    const remaining = o.time !== 'elapsed';
    value = remaining ? fmtTime(info.duration - info.position) : fmtTime(info.position);
    label = info.status === 'paused' ? 'PAUSED' : remaining ? 'LEFT' : 'PLAYED';
    color = o.titleColor;
  }
  let size = 52;
  while (size > 38 && textWidth(value, size, 600) > INNER) size -= 2;
  const w = textWidth(value, size, 600);
  const lw = textWidth(label, 22, 600) + 2 * (label.length - 1);
  const svg =
    `<text x="72" y="${(70 + size * 0.36).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${rgb(color)}">${esc(value)}</text>` +
    `<text x="72" y="118" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="600" letter-spacing="2" fill="${rgb(MUTED)}">${label}</text>`;
  return {
    svg: doc(svg, o),
    texts: [
      { size, x0: 72 - w / 2, x1: 72 + w / 2, scrolling: false, value },
      { size: 22, x0: 72 - lw / 2, x1: 72 + lw / 2, scrolling: false, value: label }
    ]
  };
}

// ---------------------------------------------------------------------------
// Spanning graphics: album art and progress bar
// ---------------------------------------------------------------------------
function blockGeometry(span, key) {
  const W = span.cols * S + (span.cols - 1) * GAP;
  const H = span.rows * S + (span.rows - 1) * GAP;
  const x0 = (key.col - span.minCol) * (S + GAP);
  const y0 = (key.row - span.minRow) * (S + GAP);
  return { W, H, x0, y0 };
}

// art: { href (data URL), width, height } or null
function artTile(art, span, key, o) {
  const { W, H, x0, y0 } = blockGeometry(span, key);
  if (art) {
    const body = `<g transform="translate(${-x0} ${-y0})">` +
      `<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" xlink:href="${art.href}" href="${art.href}"/></g>`;
    return { svg: doc(body, { background: 'dark' }), texts: [] };
  }
  // No artwork: a large line-drawn music note across the block.
  const size = Math.min(W, H) * 0.5;
  const u = size / 100;
  const ox = W / 2 - 50 * u - x0, oy = H / 2 - 50 * u - y0;
  const c = rgb(mix(BG, o.accent || [120, 136, 255], 0.45));
  const sw = Math.max(5, 7 / Math.max(u, 0.6)); // keeps the line weight steady
  const body = `<g transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${u.toFixed(3)})" fill="none" stroke="${c}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round">` +
    `<ellipse cx="30" cy="80" rx="15" ry="11"/><ellipse cx="78" cy="70" rx="15" ry="11"/>` +
    `<path d="M45 80 V16 L93 6 V70"/><path d="M45 32 L93 22"/></g>`;
  return { svg: doc(body, { background: 'dark' }), texts: [] };
}

// info: { known, position, duration }
function progressTile(info, span, key, o) {
  const { W, x0 } = blockGeometry({ ...span, rows: 1, minRow: key.row }, key);
  const accent = o.accent || [120, 136, 255];
  const left = 18, right = W - 18, y = 72;
  const frac = info.known && info.duration > 0 ? Math.max(0, Math.min(1, info.position / info.duration)) : 0;
  const fx = left + (right - left) * frac;
  let body = `<g transform="translate(${-x0} 0)">` +
    `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${rgb(WHITE)}" stroke-opacity="0.14" stroke-width="12" stroke-linecap="round"/>`;
  if (info.known) {
    body += `<line x1="${left}" y1="${y}" x2="${Math.max(left + 0.1, fx).toFixed(1)}" y2="${y}" stroke="${rgb(accent)}" stroke-width="12" stroke-linecap="round"/>` +
      `<circle cx="${fx.toFixed(1)}" cy="${y}" r="13" fill="${rgb(accent)}" fill-opacity="0.35"/>` +
      `<circle cx="${fx.toFixed(1)}" cy="${y}" r="9" fill="${rgb(WHITE)}"/>`;
  }
  body += '</g>';
  return { svg: doc(body, o), texts: [] };
}

// ---------------------------------------------------------------------------
// Control keys (line icons)
// ---------------------------------------------------------------------------
const stroke = (c, w = 8, extra = '') =>
  `fill="none" stroke="${rgb(c)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}`;

function speaker(c) {
  return `<path d="M30 60 H46 L66 44 V100 L46 84 H30 Z" ${stroke(c, 7)}/>`;
}
function wave(r, c, opacity = 1) {
  const a = (48 * Math.PI) / 180, cx = 66, cy = 72;
  const x = (cx + r * Math.cos(a)).toFixed(1), y1 = (cy - r * Math.sin(a)).toFixed(1), y2 = (cy + r * Math.sin(a)).toFixed(1);
  return `<path d="M${x} ${y1} A${r} ${r} 0 0 1 ${x} ${y2}" ${stroke(c, 7, `stroke-opacity="${opacity}"`)}/>`;
}

function glyph(role, c, status, accent) {
  switch (role) {
    case 'playpause':
      return status === 'playing'
        ? `<path d="M61 54 V90 M83 54 V90" ${stroke(c, 10)}/>`
        : `<path d="M62 52 V92 L94 72 Z" ${stroke(c, 8)}/>`;
    case 'next': return `<path d="M50 52 V92 L82 72 Z" ${stroke(c, 7)}/><path d="M96 52 V92" ${stroke(c, 8)}/>`;
    case 'prev': return `<path d="M94 52 V92 L62 72 Z" ${stroke(c, 7)}/><path d="M48 52 V92" ${stroke(c, 8)}/>`;
    case 'volup': return speaker(c) + wave(16, accent) + wave(28, accent) + wave(40, accent);
    case 'voldown': return speaker(c) + wave(16, accent) + wave(28, accent, 0.22) + wave(40, accent, 0.22);
    case 'mute': return speaker(c) + `<path d="M84 60 L106 84 M106 60 L84 84" ${stroke(MUTE_RED, 7)}/>`;
    default: return '';
  }
}

function controlKey(role, o) {
  // o: { accent, style, status, pressed }
  const accent = o.accent;
  const pressed = !!o.pressed;
  const flat = o.style === 'flat';
  const defs = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>`;
  let body = '';
  if (role === 'playpause') {
    const ring = pressed ? mix(accent, WHITE, 0.35) : accent;
    if (!flat) body += `<circle cx="72" cy="72" r="46" ${stroke(accent, 10, `filter="url(#glow)" stroke-opacity="${pressed ? 0.9 : 0.55}"`)}/>`;
    body += `<circle cx="72" cy="72" r="46" ${stroke(ring, flat ? 5 : 6)}/>`;
    body += glyph(role, pressed ? ring : WHITE, o.status, accent);
  } else {
    if (!flat) {
      body += `<rect x="8" y="8" width="128" height="128" rx="26" ${stroke(accent, 3, `stroke-opacity="${pressed ? 0.9 : 0.35}"`)}/>`;
      body += `<g filter="url(#glow)" opacity="${pressed ? 0.9 : 0.45}">${glyph(role, accent, o.status, accent)}</g>`;
    } else if (pressed) {
      body += `<rect x="0" y="0" width="144" height="144" fill="${rgb(accent)}" fill-opacity="0.18"/>`;
    }
    body += glyph(role, pressed ? mix(WHITE, accent, 0.4) : WHITE, o.status, accent);
  }
  return { svg: doc(body, { background: 'dark', defs }), texts: [] };
}

// Icons for the software's action list (static/*.png), same line style.
function actionIcon(name) {
  const accent = [120, 136, 255];
  const W8 = (c, w = 7) => stroke(c, w);
  let body;
  switch (name) {
    case 'plugin':
      body = `<rect x="22" y="22" width="100" height="100" rx="18" ${W8(accent, 6)}/>` +
        `<g ${W8(WHITE)}><ellipse cx="57" cy="94" rx="10" ry="8"/><ellipse cx="89" cy="86" rx="10" ry="8"/><path d="M67 94 V50 L99 43 V86"/></g>`;
      break;
    case 'art':
      body = `<rect x="26" y="30" width="92" height="84" rx="10" ${W8(WHITE)}/>` +
        `<path d="M34 104 L62 72 L80 90 L92 78 L110 104" ${W8(accent)}/><circle cx="92" cy="54" r="8" ${W8(accent, 6)}/>`;
      break;
    case 'info':
      body = `<path d="M30 46 H114" ${W8(WHITE, 10)}/><path d="M30 72 H96" ${W8(accent, 8)}/><path d="M30 98 H78" ${W8(rgbArr(MUTED), 8)}/>`;
      break;
    case 'time':
      body = `<circle cx="72" cy="72" r="42" ${W8(WHITE)}/><path d="M72 46 V72 L90 84" ${W8(accent)}/>`;
      break;
    case 'progress':
      body = `<path d="M28 72 H116" ${stroke(WHITE, 12, 'stroke-opacity="0.25"')}/><path d="M28 72 H78" ${W8(accent, 12)}/><circle cx="80" cy="72" r="11" fill="${rgb(WHITE)}"/>`;
      break;
    default:
      return controlKey(name, { accent, style: 'glow', status: 'paused' }).svg;
  }
  return doc(body, { background: 'dark' });
}
const rgbArr = (c) => c;

module.exports = {
  S, GAP, PAD, INNER, MIN_TEXT, BG, rgb, mix,
  doc, fitText, textKey, titleArtistKey, stripKeys, STRIP_SIZES, timeKey, artTile, progressTile, controlKey, actionIcon,
  fmtTime, scrollLoop
};
