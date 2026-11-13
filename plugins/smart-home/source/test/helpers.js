'use strict';
// Shared helpers for the tests.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''}`);
  return !!ok;
}
function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 5000, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/** Start the Python device simulator. Returns { events, send(obj), stop() }. */
function startSim(devices, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuyasim-'));
  const file = path.join(dir, 'devices.json');
  fs.writeFileSync(file, JSON.stringify(devices));
  const proc = spawn('python3', [path.join(__dirname, 'sim', 'tuya_sim.py'), file], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const events = [];
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { events.push(JSON.parse(line)); } catch (_) { events.push({ raw: line }); }
    }
  });
  proc.stderr.on('data', (d) => process.stderr.write('[sim] ' + d));
  return {
    events,
    send: (obj) => proc.stdin.write(JSON.stringify(obj) + '\n'),
    stop: () => { try { proc.kill(); } catch (_) {} },
    ready: () => waitFor(() => events.filter((e) => e.event === 'listening').length >= devices.length, 8000),
  };
}

module.exports = { check, summary, sleep, waitFor, startSim };
