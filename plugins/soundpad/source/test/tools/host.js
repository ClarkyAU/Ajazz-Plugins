// Fake Ajazz host: a WebSocket server that launches the patch like the software does.
'use strict';
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const NODE = process.env.NODE20 || process.execPath;
async function startHost(env = {}) {
  const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  await new Promise(r => server.on('listening', r));
  const port = server.address().port;
  const h = { msgs: [], sock: null, server, waiters: [] };
  server.on('connection', s => {
    h.sock = s;
    s.on('message', d => { const m = JSON.parse(d.toString()); h.msgs.push(m); h.waiters.slice().forEach(w => w()); });
  });
  const info = JSON.stringify({ application: { version: '3.10.200' }, devices: [{ id: 'D1', size: { columns: 6, rows: 3 } }] });
  h.proc = spawn(NODE, [path.join(__dirname, '..', '..', 'dist', 'patch', 'index.js'), '-port', String(port), '-pluginUUID', 'UUID123', '-registerEvent', 'registerPlugin', '-info', info],
    { env: Object.assign({}, process.env, { SP_PATCH_EXE: NODE, SP_PATCH_EXE_ARGS: JSON.stringify([path.join(__dirname, 'fake-exe.js')]) }, env), stdio: 'ignore' });
  h.exited = new Promise(r => h.proc.on('exit', r));
  h.send = m => h.sock.send(JSON.stringify(m));
  h.waitFor = (pred, ms = 3000) => new Promise((res, rej) => {
    const check = () => { const f = h.msgs.find(pred); if (f) { h.waiters = h.waiters.filter(x => x !== check); clearTimeout(t); res(f); return true; } };
    const t = setTimeout(() => { h.waiters = h.waiters.filter(x => x !== check); rej(new Error('timeout waiting')); }, ms);
    if (!check()) h.waiters.push(check);
  });
  h.plays = () => h.msgs.filter(m => m.event === 'logMessage').map(m => m.payload.message);
  h.close = async () => { try { h.sock.close(); } catch (_) {} server.close(); await h.exited; };
  await h.waitFor(m => m.event === 'registerPlugin');
  return h;
}
module.exports = { startHost };
