'use strict';
// Finds the cockpit plug in the Smart Home plugin's saved device list (read-only) and watches its on/off state.
const fs = require('fs');
const path = require('path');
const { readPlug } = require('./tuya');

function devicesFile(pluginDir) {
  return process.env.MOZA_TEST_DEVICES || path.join(path.dirname(pluginDir), 'com.clarkyau.smarthome.sdPlugin', 'devices.json');
}
function loadDevice(pluginDir, name) {
  let j;
  try { j = JSON.parse(fs.readFileSync(devicesFile(pluginDir), 'utf8')); } catch (e) { return { error: 'Smart Home plugin device list not found' }; }
  const list = Array.isArray(j.devices) ? j.devices : [];
  const want = String(name || '').trim().toLowerCase();
  const d = list.find((x) => String(x.name || '').trim().toLowerCase() === want);
  if (!d) return { error: `No device called "${name}" in the Smart Home plugin` + (list.length ? ` (found: ${list.map((x) => x.name).join(', ')})` : '') };
  const sw = (d.switches && d.switches[0] && d.switches[0].dp) || '1';
  return { dev: { id: d.id, key: d.key, ip: d.ip, version: d.version || '3.3' }, name: d.name, switchDp: String(sw) };
}

// Polls the plug; calls onChange('on'|'off') after STABLE consecutive matching readings that differ from the last stable state.
// The first stable reading only sets the starting point (no action).
class Watcher {
  constructor({ pluginDir, getName, log, onChange, onStatus, intervalMs = 3000, stable = 3, port }) {
    Object.assign(this, { pluginDir, getName, log, onChange, onStatus, intervalMs, stable, port });
    this.status = { state: 'unknown' };
    this.last = null; this.cand = null; this.count = 0; this.timer = null; this.fails = 0;
  }
  start() { this.stop(); const tick = async () => { await this.poll(); this.timer = setTimeout(tick, this.intervalMs); }; this.timer = setTimeout(tick, 500); }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  reset() { this.last = null; this.cand = null; this.count = 0; }
  async poll() {
    const found = loadDevice(this.pluginDir, this.getName());
    if (found.error) return this.set({ state: 'error', error: found.error });
    const r = await readPlug(found.dev, { switchDp: found.switchDp, port: this.port });
    if (!r.ok) {
      this.fails++;
      if (this.fails >= 2) this.set({ state: 'unreachable', name: found.name, error: r.error });
      return;
    }
    this.fails = 0;
    const cur = r.on ? 'on' : 'off';
    this.set({ state: cur, name: found.name });
    if (cur === this.cand) this.count++; else { this.cand = cur; this.count = 1; }
    if (this.count >= this.stable && cur !== this.last) {
      const first = this.last === null;
      this.last = cur;
      this.log.info(`[plug] ${found.name} is ${cur}${first ? ' (starting point, no action)' : ' (changed)'}`);
      if (!first) this.onChange(cur);
    }
  }
  set(s) {
    const a = JSON.stringify(this.status); const b = JSON.stringify(s);
    if (a !== b) { this.status = s; if (s.state === 'error' || s.state === 'unreachable') this.log.warn(`[plug] ${s.state}: ${s.error}`); if (this.onStatus) this.onStatus(s); }
  }
}
module.exports = { Watcher, loadDevice };
