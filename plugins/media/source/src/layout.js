'use strict';
// Works out how neighbouring keys combine. Main keys and the side screen never join.
//
//   Album Art     neighbouring Album Art keys share one picture.
//   Progress Bar  neighbouring Progress Bar keys in a row share one bar.
//   Track Info    neighbouring Track Info keys join; on Automatic a single row
//                 shows title + artist, and with more rows the first shows the
//                 title, the next the artist, then the album. Keys side by side
//                 in a row showing the same thing form one strip, which scrolls
//                 across the keys when the text is too long for one key.
//   Time          always one key.
// "Stand alone" keeps a key out of any group.

const posKey = (k) => `${k.col},${k.row}`;
const zoneOf = (col) => (col >= 5 ? 'side' : 'main');
const readingOrder = (a, b) => a.row - b.row || a.col - b.col;

// Connected groups of joinable keys (dirs: which neighbours count).
function groups(keys, dirs) {
  const out = [];
  const byZone = new Map();
  for (const k of keys) {
    const id = `${k.device}|${zoneOf(k.col)}`;
    if (!byZone.has(id)) byZone.set(id, []);
    byZone.get(id).push(k);
  }
  for (const list of byZone.values()) {
    const joinable = new Map(list.filter((k) => k.settings.join !== false).map((k) => [posKey(k), k]));
    const seen = new Set();
    for (const k of list) {
      if (k.settings.join === false) { out.push([k]); continue; }
      if (seen.has(posKey(k))) continue;
      const group = [];
      const queue = [k];
      seen.add(posKey(k));
      while (queue.length) {
        const cur = queue.shift();
        group.push(cur);
        for (const [dc, dr] of dirs) {
          const n = joinable.get(`${cur.col + dc},${cur.row + dr}`);
          if (n && !seen.has(posKey(n))) { seen.add(posKey(n)); queue.push(n); }
        }
      }
      out.push(group);
    }
  }
  return out;
}

const ALL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ROW_DIRS = [[1, 0], [-1, 0]];

function boxOf(type, keys) {
  const cols = keys.map((k) => k.col), rows = keys.map((k) => k.row);
  const box = {
    type,
    minCol: Math.min(...cols), minRow: Math.min(...rows),
    cols: Math.max(...cols) - Math.min(...cols) + 1,
    rows: Math.max(...rows) - Math.min(...rows) + 1,
    keys: keys.slice().sort(readingOrder)
  };
  box.leader = box.keys[0]; // the top-left key's settings decide shared options
  return box;
}

// Track Info: Automatic choices, then strips (keys side by side showing the same thing).
function resolveInfo(group) {
  const rows = [...new Set(group.map((k) => k.row))].sort((a, b) => a - b);
  const byRow = ['title', 'artist', 'album', 'player'];
  for (const k of group) {
    if (k.settings.show !== 'auto') k.resolved = k.settings.show;
    else k.resolved = rows.length === 1 ? 'titleartist' : byRow[rows.indexOf(k.row)] || 'title';
  }
  const strips = [];
  const at = new Map(group.map((k) => [posKey(k), k]));
  const seen = new Set();
  for (const k of group.slice().sort(readingOrder)) {
    if (seen.has(posKey(k))) continue;
    const strip = [k];
    seen.add(posKey(k));
    for (let c = k.col + 1; ; c++) {
      const n = at.get(`${c},${k.row}`);
      if (!n || n.resolved !== k.resolved || seen.has(posKey(n))) break;
      strip.push(n); seen.add(posKey(n));
    }
    const s = boxOf('strip', strip);
    s.show = k.resolved;
    for (const m of strip) m.strip = s;
    strips.push(s);
  }
  return strips;
}

// Sets k.span (art / progress), k.strip and k.resolved (info) on every display key.
function resolveAll(keys) {
  for (const k of keys) { k.span = null; k.strip = null; k.resolved = k.action; k.group = null; }
  let g = 0;
  const of = (action) => keys.filter((k) => k.action === action);
  for (const group of groups(of('art'), ALL_DIRS)) {
    const box = boxOf('art', group);
    for (const k of group) { k.span = box; k.group = g; }
    g++;
  }
  for (const group of groups(of('progress'), ROW_DIRS)) {
    const box = boxOf('progress', group);
    for (const k of group) { k.span = box; k.group = g; }
    g++;
  }
  for (const group of groups(of('info'), ALL_DIRS)) {
    for (const k of group) k.group = g;
    resolveInfo(group);
    g++;
  }
  for (const k of of('time')) k.group = g++;
}

module.exports = { resolveAll, zoneOf };
