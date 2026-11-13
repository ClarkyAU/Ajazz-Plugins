'use strict';
// A "source" is where the numbers come from. REPLACE the demo with your own reader
// (a vendor app's local API, a USB device, a PowerShell helper, ...).
//
// A reader's read() resolves to:
//   { status: 'ok' | 'nosource', note: 'short text', items: [{id, name, value (0-100), charging}] }
// Read only. Never write to a device from here.
const fs = require('fs');

const demo = {
  id: 'demo',
  name: 'Demo (built in)',
  read() {
    const t = Date.now() / 1000;
    return Promise.resolve({
      status: 'ok',
      note: 'Made-up numbers so you can see the keys working.',
      items: [
        { id: 'demo-a', name: 'Demo A', value: Math.round(50 + 50 * Math.sin(t / 60)), charging: false },
        { id: 'demo-b', name: 'Demo B', value: 63, charging: Math.floor(t / 20) % 2 === 0 }
      ]
    });
  }
};

// Used by the tests only (needs PLUGIN_SOURCE_FILE). Reads a JSON file in the shape above.
function fileSource(filePath) {
  return {
    id: 'file',
    name: 'Test file',
    read() {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Promise.resolve({ status: data.status || 'ok', note: data.note || '', items: data.items || [] });
      } catch (e) {
        return Promise.resolve({ status: 'nosource', note: 'File not readable', items: [] });
      }
    }
  };
}

const readers = [demo];
if (process.env.PLUGIN_SOURCE_FILE) readers.push(fileSource(process.env.PLUGIN_SOURCE_FILE));

function list() { return readers.map((r) => ({ id: r.id, name: r.name })); }
function find(id) { return readers.find((r) => r.id === id) || readers[0]; }

// onState(state) is called after every read. Returns controls.
function create(onState, log) {
  let id = 'demo';
  let pollSec = 10;
  let timer = null;
  let busy = false;
  let stopped = false;
  let running = false;

  async function poll() {
    if (busy || stopped) return;
    busy = true;
    try {
      const sid = id;
      const state = await find(sid).read();
      if (!stopped && sid === id) onState(state); // drop an answer from a source that was switched away meanwhile
    } catch (e) {
      log.warn('Source read failed: ' + e.message);
      if (!stopped) onState({ status: 'nosource', note: 'Read failed', items: [] });
    } finally {
      busy = false;
    }
  }
  function schedule() {
    if (timer) clearInterval(timer);
    const ms = process.env.PLUGIN_POLL_MS ? parseInt(process.env.PLUGIN_POLL_MS, 10) : pollSec * 1000;
    timer = setInterval(poll, ms);
  }
  return {
    start() { stopped = false; running = true; schedule(); poll(); },
    stop() { stopped = true; running = false; if (timer) clearInterval(timer); timer = null; },
    rescan() { poll(); },
    setPoll(sec) { if (sec !== pollSec) { pollSec = sec; if (timer) schedule(); } },
    setSource(newId) { const real = find(newId).id; if (real !== id) { id = real; if (running) poll(); } },
    sourceId() { return id; },
    sourceName() { return find(id).name; }
  };
}

module.exports = { create, list };
