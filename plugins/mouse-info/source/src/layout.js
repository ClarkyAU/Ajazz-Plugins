// Key positions, joining neighbouring keys, and what each key shows.
'use strict';

// The AKP153E reports main keys in hardware order. Convert to what the user sees.
// Side screen keys (column 5) are reported normally.
function realPosition(coords) {
  const c = coords ? Number(coords.column) : 0, r = coords ? Number(coords.row) : 0;
  if (c >= 5) return { col: 5, row: r, side: true };
  const index = r * 5 + c;
  return { col: 4 - Math.floor(index / 3), row: index % 3, side: false };
}

const SHOWS = ['battery', 'connection', 'profile'];

// keys: [{context, device, pos:{col,row,side}, settings}] all of the Mouse action.
// Neighbouring keys (same device, both main keys or both side screen) join into a group unless a key
// has "Join with neighbouring keys" off. Automatic picks from the key's place in its group.
// Returns Map context -> {role, auto, group:[contexts]}
function computeLayout(keys) {
  const out = new Map();
  const byDevice = new Map();
  for (const k of keys) {
    if (!byDevice.has(k.device)) byDevice.set(k.device, []);
    byDevice.get(k.device).push(k);
  }
  for (const list of byDevice.values()) {
    const groups = components(list.filter(k => k.settings.join !== false), (a, b) => a.pos.side === b.pos.side);
    for (const k of list) if (k.settings.join === false) groups.push([k]);
    for (const g of groups) {
      g.sort((a, b) => a.pos.row - b.pos.row || a.pos.col - b.pos.col);
      g.forEach((k, i) => {
        const chosen = SHOWS.includes(k.settings.shows);
        out.set(k.context, { role: chosen ? k.settings.shows : SHOWS[i % SHOWS.length], auto: !chosen, group: g.map(x => x.context) });
      });
    }
  }
  return out;
}

// Connected components with 4-neighbour adjacency.
function components(keys, same) {
  const left = new Set(keys), groups = [];
  for (const k of keys) {
    if (!left.has(k)) continue;
    const g = [k]; left.delete(k);
    for (let i = 0; i < g.length; i++) {
      for (const o of [...left]) {
        const d = Math.abs(o.pos.col - g[i].pos.col) + Math.abs(o.pos.row - g[i].pos.row);
        if (d === 1 && same(o, g[i])) { g.push(o); left.delete(o); }
      }
    }
    groups.push(g);
  }
  return groups;
}

module.exports = { realPosition, computeLayout, SHOWS };
