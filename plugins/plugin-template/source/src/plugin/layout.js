'use strict';
// Key positions and joining. Both functions are proven on the real AKP153E deck.

// The host reports coordinates {column,row}. Column 5 and up is the side screen.
// Main keys are converted to the real hardware position (physical col/row).
function realPosition(coords) {
  const column = coords && coords.column != null ? coords.column : 0;
  const row = coords && coords.row != null ? coords.row : 0;
  if (column >= 5) return { col: column, row, side: true };
  const index = row * 5 + column;
  return { col: 4 - Math.floor(index / 3), row: index % 3, side: false };
}

// keys: [{context, device, col, row, side, join}]
// Neighbouring keys (touching sides) join into a group unless join === false.
// Main keys and the side screen never join. Returns Map(context -> {index, size}),
// index = reading order inside the group (top-to-bottom, then left-to-right).
function groupKeys(keys) {
  const result = new Map();
  const byDevice = new Map();
  keys.forEach((k) => {
    const id = k.device + (k.side ? '/side' : '/main');
    if (!byDevice.has(id)) byDevice.set(id, []);
    byDevice.get(id).push(k);
  });
  byDevice.forEach((list) => {
    const seen = new Set();
    const at = new Map();
    list.forEach((k) => at.set(k.col + ',' + k.row, k));
    list.slice().sort((a, b) => a.row - b.row || a.col - b.col).forEach((start) => {
      if (seen.has(start.context)) return;
      const members = [];
      const queue = [start];
      seen.add(start.context);
      while (queue.length) {
        const k = queue.shift();
        members.push(k);
        if (k.join === false) continue;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((d) => {
          const n = at.get((k.col + d[0]) + ',' + (k.row + d[1]));
          if (n && !seen.has(n.context) && n.join !== false) {
            seen.add(n.context);
            queue.push(n);
          }
        });
      }
      members.sort((a, b) => a.row - b.row || a.col - b.col);
      members.forEach((k, i) => result.set(k.context, { index: i, size: members.length }));
    });
  });
  return result;
}

module.exports = { realPosition, groupKeys };
