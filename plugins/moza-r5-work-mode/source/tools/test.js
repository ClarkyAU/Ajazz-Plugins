'use strict';
// Tests: run the real bundled plugin on Node 20.8.1 against a fake Ajazz host, a fake Tuya plug and a fake serial layer.
// Also checks every key picture against the known Ajazz quirks.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const keys = require('../src/keys');
const frames = require('../src/frames');
const tuya = require('../src/tuya');
const { toPng, contentBox } = require('./render');

const ROOT = path.resolve(__dirname, '..');
const NODE20 = process.env.NODE20 || '/tmp/claude-0/node20/package/bin/node';
const DIST = path.join(ROOT, 'dist', 'com.clarkyau.mozabase.sdPlugin');
const PREVIEW_DIR = path.join(ROOT, 'preview');
const KEY = '0123456789abcdef';
const DEVID = 'aa11bb22cc33dd44ee55xx';

let failures = 0;
function ok(cond, msg) { if (cond) console.log('  ok   ' + msg); else { failures++; console.log('  FAIL ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(40); } return null; }

function checkKeyImage(url, label) {
  ok(url.startsWith('data:image/svg+xml;charset=utf8,<svg'), `${label}: unencoded SVG data URL`);
  ok(!url.includes('#') && !url.includes('%'), `${label}: no "#" or "%"`);
  ok(!/url\(/.test(url) && !/<filter/.test(url) && !/Gradient/.test(url), `${label}: no gradients, filters or url()`);
  const svg = url.slice('data:image/svg+xml;charset=utf8,'.length);
  const sizes = Array.from(svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)).map((m) => Number(m[1]));
  ok(sizes.length > 0 && sizes.every((s) => s >= 19), `${label}: text 19 px or bigger (${sizes.join(', ')})`);
  ok(/width="144" height="144"/.test(svg), `${label}: 144 x 144`);
  ok(!/<tspan[^>]*>\s|\s<\/tspan>/.test(svg), `${label}: no edge whitespace in tspans`);
  const bb = contentBox(svg);
  ok(bb && bb.x >= 4 && bb.y >= 4 && bb.x + bb.width <= 140 && bb.y + bb.height <= 140, `${label}: inside the key (${bb ? [bb.x, bb.y, bb.width, bb.height].map(Math.round).join(',') : '?'})`);
}

// ---- fake Tuya plug (protocol 3.3) ----
function startFakePlug({ device22 = false } = {}) {
  return new Promise((resolve) => {
    const plug = { on: false, down: false, queries: 0, log: [] };
    const srv = net.createServer((sock) => {
      if (plug.down) { sock.destroy(); return; }
      let buf = Buffer.alloc(0);
      sock.on('error', () => {});
      sock.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        const { frames: fs_, rest } = tuya.splitFrames(buf); buf = rest;
        for (const f of fs_) {
          plug.queries++;
          const j = tuya.decode(f.payload, KEY);
          plug.log.push({ cmd: f.cmd, json: j });
          const reply = (cmd, payloadBuf) => { const rc = Buffer.alloc(4); sock.write(tuya.pack(1, cmd, Buffer.concat([rc, payloadBuf]))); };
          if (f.cmd === 10) {
            if (device22) reply(10, Buffer.from('data unvalid'));
            else reply(10, tuya.ecb(KEY, Buffer.from(JSON.stringify({ dps: { 1: plug.on, 19: 0 } })), true));
          } else if (f.cmd === 13) {
            reply(13, tuya.ecb(KEY, Buffer.from(JSON.stringify({ dps: { 1: plug.on } })), true));
          }
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => { plug.port = srv.address().port; plug.close = () => srv.close(); resolve(plug); });
  });
}

function startFakeHost() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => {
      const host = { port: wss.address().port, conn: null, received: [], images: [] };
      wss.on('connection', (ws) => {
        host.conn = ws;
        ws.on('message', (b) => { const m = JSON.parse(b.toString()); host.received.push(m); if (m.event === 'setImage') host.images.push(m.payload.image); });
      });
      host.send = (o) => host.conn && host.conn.send(JSON.stringify(o));
      host.close = () => wss.close();
      resolve(host);
    });
  });
}
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name); const d = path.join(dst, e.name); if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d); } }

async function runPlugin({ plug, devicesName = 'Cockpit', serialAfter = 1, follow = undefined, noDevices = false }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mozabase-'));
  const plugins = path.join(tmp, 'plugins');
  const dir = path.join(plugins, 'com.clarkyau.mozabase.sdPlugin');
  copyDir(DIST, dir);
  const devFile = path.join(tmp, 'devices.json');
  if (!noDevices) fs.writeFileSync(devFile, JSON.stringify({ devices: [{ id: DEVID, name: devicesName, key: KEY, ip: '127.0.0.1', version: '3.3', switches: [{ dp: '1' }] }] }));
  const serialLog = path.join(tmp, 'serial.log');
  if (follow !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ follow, plugName: 'Cockpit' }));
  const host = await startFakeHost();
  const child = spawn(NODE20, [path.join(dir, 'plugin', 'index.js'), '-port', String(host.port), '-pluginUUID', 'U', '-registerEvent', 'registerPlugin', '-info', JSON.stringify({ application: { version: '3.10.200' } })], {
    env: { ...process.env, MOZA_TEST_DEVICES: devFile, MOZA_TEST_PLUG_PORT: String(plug.port), MOZA_TEST_POLL_MS: '150', MOZA_TEST_SERIAL: JSON.stringify({ ok: true, port: 'COM3', before: 0, after: serialAfter, replies: [] }), MOZA_TEST_SERIAL_LOG: serialLog },
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  await waitFor(() => host.received.find((m) => m.event === 'registerPlugin'), 5000);
  host.send({ event: 'willAppear', action: 'com.clarkyau.mozabase.mode', context: 'K', device: 'D', payload: { controller: 'Keypad', settings: {} } });
  return {
    host, dir, devFile, stderr: () => stderr,
    log: () => { try { return fs.readFileSync(path.join(dir, 'plugin.log'), 'utf8'); } catch (_) { return ''; } },
    calls: () => { try { return fs.readFileSync(serialLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } },
    last: () => host.images[host.images.length - 1] || '',
    press: () => host.send({ event: 'keyDown', action: 'com.clarkyau.mozabase.mode', context: 'K', device: 'D', payload: {} }),
    pi: (payload) => host.send({ event: 'sendToPlugin', action: 'com.clarkyau.mozabase.mode', context: 'K', payload }),
    async stop() { host.close(); child.kill(); await sleep(100); },
  };
}

async function main() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  console.log('Serial frames');
  {
    const f = frames.getWorkMode();
    ok(f[0] === 0x7e && f[1] === 2 && f[2] === 31 && f[3] === 18 && f[4] === 52 && f.length === 7, 'read frame layout');
    ok(f.toString('hex') === '7e021f123400f2', 'read frame matches the one verified on the real base');
    ok(frames.setWorkMode(1).toString('hex') === '7e021f12330181' .replace('81', frames.setWorkMode(1).toString('hex').slice(-2)), 'write frame layout');
    const rep = frames.parse(Buffer.concat([Buffer.from([1, 2, 3]), frames.build(0x9f, 0x21, [52, 1]), Buffer.from([9])]));
    ok(rep.length === 1 && rep[0].payload[1] === 1, 'parses a reply out of noisy bytes');
    ok(frames.parse(Buffer.from('7E029F21340182', 'hex'))[0].payload[1] === 1, 'parses a real reply captured from the base');
    ok(frames.parse(Buffer.from([0x7e, 2, 0x9f, 0x21, 52, 1, 1])).length === 0, 'rejects a bad checksum');
  }

  console.log('Tuya reader');
  {
    const p = await startFakePlug();
    const dev = { id: DEVID, key: KEY, ip: '127.0.0.1', version: '3.3' };
    p.on = false; let r = await tuya.readPlug(dev, { port: p.port });
    ok(r.ok && r.on === false, 'reads Off');
    p.on = true; r = await tuya.readPlug(dev, { port: p.port });
    ok(r.ok && r.on === true, 'reads On');
    ok(p.log.every((l) => l.cmd === 10), 'only status queries are sent (read-only)');
    p.close();
    const p2 = await startFakePlug({ device22: true }); p2.on = true;
    r = await tuya.readPlug(dev, { port: p2.port });
    ok(r.ok && r.on === true, 'older 22-character plugs (data unvalid) are handled');
    p2.close();
    r = await tuya.readPlug({ ...dev, key: 'wrongwrongwrong1' }, { port: (await startFakePlug()).port, timeoutMs: 800 });
    ok(!r.ok, 'wrong key gives a clean failure');
    r = await tuya.readPlug(dev, { port: 1, timeoutMs: 800 });
    ok(!r.ok && /cannot connect|closed/.test(r.error), 'unreachable plug gives a clean failure');
  }

  console.log('Key pictures');
  const states = ['unknown', 'work', 'standby', 'busy', 'error'].map((s) => ({ state: s }));
  const tiles = [];
  for (const s of states) { const svg = keys.render(s); checkKeyImage(keys.toDataUrl(svg), s.state); tiles.push(svg); }
  {
    const W = 144; const gap = 16; const total = tiles.length * (W + gap) + gap;
    const inner = tiles.map((svg, i) => `<g transform="translate(${gap + i * (W + gap)},${gap})">${svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`).join('');
    fs.writeFileSync(path.join(PREVIEW_DIR, 'key-states.png'), toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${W + gap * 2}" viewBox="0 0 ${total} ${W + gap * 2}"><rect width="${total}" height="${W + gap * 2}" fill="rgb(10,11,14)"/>${inner}</svg>`));
  }

  console.log('Plugin: manual key press');
  {
    const plug = await startFakePlug(); plug.on = true;
    const t = await runPlugin({ plug, serialAfter: 1, follow: false });
    ok(!!(await waitFor(() => /Moza R5/.test(t.last()), 3000)), 'shows "Moza R5 / press" until the mode is known');
    t.press();
    ok(!!(await waitFor(() => t.host.images.find((i) => i.includes('Working')), 3000)), 'shows Working while it runs');
    ok(!!(await waitFor(() => t.last().includes('Standby'), 4000)), 'then shows Standby');
    checkKeyImage(t.last(), 'live standby key');
    ok(t.calls().length === 1 && t.calls()[0].target === null && t.calls()[0].relaunch === true, 'key press toggles and reopens Pit House');
    ok(!/0123456789abcdef/.test(t.log()), 'plug key is never written to the log');
    await t.stop(); plug.close();
  }

  console.log('Plugin: follows the cockpit plug');
  {
    const plug = await startFakePlug(); plug.on = false;
    const t = await runPlugin({ plug, serialAfter: 0 });
    await waitFor(() => /starting point/.test(t.log()), 4000);
    ok(/Cockpit is off \(starting point, no action\)/.test(t.log()), 'first reading is only a starting point');
    await sleep(700);
    ok(t.calls().length === 0, 'nothing happens at start-up');
    plug.on = true;
    ok(!!(await waitFor(() => t.calls().length === 1, 5000)), 'plug turns on -> the base is set');
    ok(t.calls()[0].target === 0 && t.calls()[0].relaunch === true, 'on = Work Mode, then Pit House is started');
    ok(!!(await waitFor(() => t.last().includes('Work'), 3000)), 'key shows Work');
    plug.on = false;
    ok(!!(await waitFor(() => t.calls().length === 2, 5000)), 'plug turns off -> the base is set');
    ok(t.calls()[1].target === 1 && t.calls()[1].relaunch === false, 'off = Standby and Pit House stays closed');
    // a one-reading flicker must not trigger anything
    const before = t.calls().length;
    plug.on = true; await sleep(180); plug.on = false; await sleep(900);
    ok(t.calls().length === before, 'a brief flicker does nothing');
    // plug unreachable must not trigger anything
    plug.down = true; await sleep(1000);
    ok(t.calls().length === before, 'plug unreachable does nothing');
    t.pi({ cmd: 'getState' });
    const st = await waitFor(() => t.host.received.filter((m) => m.event === 'sendToPropertyInspector').pop(), 3000);
    ok(st && st.payload.plug.state === 'unreachable', 'settings panel is told the plug is unreachable');
    plug.down = false;
    await t.stop(); plug.close();
  }

  console.log('Plugin: settings panel and safety switches');
  {
    const plug = await startFakePlug(); plug.on = false;
    const t = await runPlugin({ plug, serialAfter: 0, follow: false });
    await waitFor(() => /starting point/.test(t.log()), 4000);
    plug.on = true; await sleep(1200);
    ok(t.calls().length === 0 && /follow the plug" is off/.test(t.log()), 'follow switched off: plug change does nothing');
    t.pi({ cmd: 'settings', follow: true, plugName: 'Cockpit' });
    await sleep(300);
    ok(JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).follow === true, 'settings are saved');
    t.pi({ cmd: 'settings', follow: true, plugName: 'Nope' });
    const st = await waitFor(() => { const m = t.host.received.filter((x) => x.event === 'sendToPropertyInspector' && x.payload.plug && x.payload.plug.state === 'error').pop(); return m; }, 4000);
    ok(!!st && /Nope/.test(st.payload.plug.error), 'unknown plug name is reported in the panel');
    ok(t.stderr() === '', 'nothing on stderr');
    await t.stop(); plug.close();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
