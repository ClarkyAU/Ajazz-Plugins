'use strict';
// Works out where keys really are on the AKP153E and joins neighbouring keys
// of the same action into rectangles that are drawn as one display.

// The AKP153E reports key positions in hardware order, not as seen on screen.
// index = row*5 + column; real column = 4 - floor(index/3); real row = index % 3.
// The side screen (column 5) is reported normally.
function realPosition(coords) {
  const column = Number(coords?.column) || 0;
  const row = Number(coords?.row) || 0;
  if (column >= 5) return { col: column, row };
  const index = row * 5 + column;
  return { col: 4 - Math.floor(index / 3), row: index % 3 };
}

// keys: [{ context, device, col, row, joinKey, solo }]
// returns [{ keys:[{context,dx,dy}], w, h, anchor }]
function buildGroups(keys) {
  const groups = [];
  const zones = new Map();
  for (const k of keys) {
    if (k.solo) {
      groups.push({ keys: [{ context: k.context, dx: 0, dy: 0 }], w: 1, h: 1, anchor: k.context });
      continue;
    }
    // Main keys and the side screen are separate surfaces: never join across them.
    const zone = `${k.device}|${k.col >= 5 ? 'side' : 'main'}|${k.joinKey}`;
    if (!zones.has(zone)) zones.set(zone, []);
    zones.get(zone).push(k);
  }
  for (const list of zones.values()) {
    const at = new Map(list.map((k) => [`${k.col},${k.row}`, k]));
    const used = new Set();
    const sorted = [...list].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const k of sorted) {
      if (used.has(k.context)) continue;
      const free = (c, r) => {
        const o = at.get(`${c},${r}`);
        return o && !used.has(o.context) ? o : null;
      };
      // grow right
      let w = 1;
      while (free(k.col + w, k.row)) w++;
      // grow down while the whole row span is free
      let h = 1;
      for (;;) {
        let ok = true;
        for (let i = 0; i < w; i++) if (!free(k.col + i, k.row + h)) { ok = false; break; }
        if (!ok) break;
        h++;
      }
      // Prefer a taller shape if growing down first gives more keys (e.g. an L-shape).
      let h2 = 1;
      while (free(k.col, k.row + h2)) h2++;
      let w2 = 1;
      for (;;) {
        let ok = true;
        for (let j = 0; j < h2; j++) if (!free(k.col + w2, k.row + j)) { ok = false; break; }
        if (!ok) break;
        w2++;
      }
      if (w2 * h2 > w * h) { w = w2; h = h2; }
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

module.exports = { realPosition, buildGroups };
