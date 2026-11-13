"use strict";
// Key positions and grouping of neighbouring keys.

// The AKP153E reports main-key positions in hardware order:
// index = row*5 + column; real column = 4 - floor(index/3); real row = index % 3.
// The side screen (column 5) is reported normally.
function realPosition(coords) {
  const column = Number(coords && coords.column) || 0;
  const row = Number(coords && coords.row) || 0;
  if (column >= 5) return { col: column, row };
  const index = row * 5 + column;
  return { col: 4 - Math.floor(index / 3), row: index % 3 };
}

// Inverse of realPosition, used by the fake host.
function reportedPosition(col, row) {
  if (col >= 5) return { column: col, row };
  const index = (4 - col) * 3 + row;
  return { column: index % 5, row: Math.floor(index / 5) };
}

// Splits keys into rectangles of neighbouring keys. Keys only join when they share
// the same device, zone (main keys / side screen) and join key.
// keys: [{context, device, col, row, joinKey, solo}]
// returns [{keys:[{context,dx,dy}], w, h, anchor}]
function buildGroups(keys) {
  const groups = [];
  const zones = new Map();
  for (const k of keys) {
    if (k.solo) {
      groups.push({ keys: [{ context: k.context, dx: 0, dy: 0 }], w: 1, h: 1, anchor: k.context });
      continue;
    }
    const zone = `${k.device}|${k.col >= 5 ? "side" : "main"}|${k.joinKey}`;
    if (!zones.has(zone)) zones.set(zone, []);
    zones.get(zone).push(k);
  }
  for (const list of zones.values()) {
    const at = new Map(list.map((k) => [`${k.col},${k.row}`, k]));
    const used = new Set();
    const sorted = [...list].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const k of sorted) {
      if (used.has(k.context)) continue;
      const free = (c, rr) => {
        const o = at.get(`${c},${rr}`);
        return o && !used.has(o.context) ? o : null;
      };
      // widest-first rectangle
      let w = 1;
      while (free(k.col + w, k.row)) w++;
      let h = 1;
      for (;;) {
        let ok = true;
        for (let i = 0; i < w; i++) if (!free(k.col + i, k.row + h)) { ok = false; break; }
        if (!ok) break;
        h++;
      }
      // tallest-first rectangle, keep whichever covers more keys
      let h2 = 1;
      while (free(k.col, k.row + h2)) h2++;
      let w2 = 1;
      for (;;) {
        let ok = true;
        for (let j = 0; j < h2; j++) if (!free(k.col + w2, k.row + j)) { ok = false; break; }
        if (!ok) break;
        w2++;
      }
      if (w2 * h2 > w * h) {
        w = w2;
        h = h2;
      }
      const g = { keys: [], w, h, anchor: k.context };
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const o = at.get(`${k.col + i},${k.row + j}`);
          used.add(o.context);
          g.keys.push({ context: o.context, dx: i, dy: j });
        }
      }
      groups.push(g);
    }
  }
  return groups;
}

module.exports = { realPosition, reportedPosition, buildGroups };
