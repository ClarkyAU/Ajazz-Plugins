'use strict';
const { spawn } = require('child_process');
const path = require('path');
const log = require('./log');

// Runs runtime/helper.ps1 with the Windows PowerShell that comes with Windows and turns its
// JSON lines into callbacks. Restarts it if it stops.
function create(onState, onStatus) {
  let child = null;
  let buffer = '';
  let stopped = false;
  let restartTimer = null;
  let delay = 2000;
  let running = false;
  let pollSeconds = 10;

  function command() {
    if (process.env.ICUEBATTERY_HELPER_CMD) { // used by the tests only
      const c = JSON.parse(process.env.ICUEBATTERY_HELPER_CMD);
      return { cmd: c.cmd, args: c.args };
    }
    const root = process.env.SystemRoot || 'C:\\Windows';
    const ps = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return {
      cmd: ps,
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(log.dir, 'runtime', 'helper.ps1')],
    };
  }

  function handleLine(line) {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log.warn('Helper said: ' + line.slice(0, 300)); return; }
    if (msg.type === 'state') { delay = 2000; onState(msg); }
    else if (msg.type === 'log') {
      (msg.level === 'error' ? log.error : msg.level === 'warn' ? log.warn : log.info)('Helper: ' + msg.msg);
    }
  }

  function start() {
    if (stopped || child) return;
    const c = command();
    log.info('Starting helper: ' + path.basename(c.cmd));
    try {
      child = spawn(c.cmd, c.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      log.error('Could not start the helper: ' + e.message);
      child = null; running = false; onStatus('stopped');
      schedule();
      return;
    }
    running = true; onStatus('running');
    try { child.stdin.write('poll ' + pollSeconds + '\n'); } catch (e) { /* ignore */ }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buffer += d;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) { handleLine(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => log.warn('Helper stderr: ' + String(d).trim().slice(0, 500)));
    child.stdin.on('error', () => { /* helper already gone */ });
    child.on('error', (e) => { log.error('Helper error: ' + e.message); });
    child.on('exit', (code) => {
      log.warn('Helper exited with code ' + code);
      child = null; buffer = ''; running = false;
      onStatus('stopped');
      schedule();
    });
  }

  function schedule() {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => { restartTimer = null; start(); }, delay);
    delay = Math.min(delay * 2, 30000);
  }

  return {
    start,
    rescan() {
      if (child) { try { child.stdin.write('rescan\n'); } catch (e) { /* ignore */ } }
      else { delay = 2000; if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; } start(); }
    },
    stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      if (child) { try { child.stdin.end(); } catch (e) { /* ignore */ } setTimeout(() => { try { child && child.kill(); } catch (e) { /* ignore */ } }, 1500); }
    },
    setPoll(seconds) {
      if (seconds === pollSeconds) return;
      pollSeconds = seconds;
      if (child) { try { child.stdin.write('poll ' + seconds + '\n'); } catch (e) { /* ignore */ } }
    },
    recheck() { // ask the helper to look at the receiver right now instead of waiting for its timer
      if (child) { try { child.stdin.write('now\n'); } catch (e) { /* ignore */ } }
    },
    isRunning: () => running,
  };
}

module.exports = { create };
