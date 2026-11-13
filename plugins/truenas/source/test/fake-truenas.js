'use strict';
// A pretend TrueNAS 25.x server for testing: wss://127.0.0.1:<port>/api/current
// speaking JSON-RPC 2.0, plus a plain-http icon server.
//   node test/fake-truenas.js [--port 8443] [--scenario healthy|problems]
const https = require('https');
const http = require('http');
const WebSocket = require('ws');
const selfsigned = require('selfsigned');
const { Resvg } = require('@resvg/resvg-js');

const API_KEY = '1-testkeytestkeytestkey';

function makeIcon(shape, color, color2) {
  const shapes = {
    triangle: `<path d="M40 24 L104 64 L40 104 Z" fill="${color}"/>`,
    jelly: `<path d="M64 18 C30 60 24 92 64 110 C104 92 98 60 64 18 Z" fill="${color}"/><path d="M64 48 C48 70 46 86 64 94 C82 86 80 70 64 48 Z" fill="${color2}"/>`,
    cloud: `<circle cx="40" cy="64" r="16" fill="none" stroke="${color}" stroke-width="10"/><circle cx="64" cy="64" r="22" fill="none" stroke="${color}" stroke-width="10"/><circle cx="88" cy="64" r="16" fill="none" stroke="${color}" stroke-width="10"/>`,
    petals: `<circle cx="48" cy="48" r="22" fill="${color}"/><circle cx="80" cy="48" r="22" fill="${color2}"/><circle cx="48" cy="80" r="22" fill="rgb(60,200,120)"/><circle cx="80" cy="80" r="22" fill="rgb(70,140,255)"/>`,
    house: `<path d="M64 20 L108 58 L108 108 L20 108 L20 58 Z" fill="${color}"/><circle cx="64" cy="74" r="12" fill="white"/>`,
    shield: `<path d="M64 16 L104 32 C104 72 88 98 64 112 C40 98 24 72 24 32 Z" fill="${color}"/>`,
    grid: `<rect x="24" y="24" width="34" height="34" rx="6" fill="${color}"/><rect x="70" y="24" width="34" height="34" rx="6" fill="${color2}"/><rect x="24" y="70" width="34" height="34" rx="6" fill="${color2}"/><rect x="70" y="70" width="34" height="34" rx="6" fill="${color}"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128">${shapes[shape]}</svg>`;
  return new Resvg(svg, { fitTo: { mode: 'width', value: 256 }, font: { loadSystemFonts: false } }).render().asPng();
}

const ICONS = {
  plex: makeIcon('triangle', 'rgb(229,160,13)'),
  jellyfin: makeIcon('jelly', 'rgb(170,92,195)', 'rgb(0,164,220)'),
  nextcloud: makeIcon('cloud', 'rgb(0,130,201)'),
  immich: makeIcon('petals', 'rgb(250,90,90)', 'rgb(250,200,40)'),
  'home-assistant': makeIcon('house', 'rgb(24,188,242)'),
  pihole: makeIcon('shield', 'rgb(150,6,15)'),
  syncthing: makeIcon('grid', 'rgb(0,145,226)', 'rgb(30,80,170)'),
};

function scenarioData(name, iconBase) {
  const TB = 1024 ** 4, GB = 1024 ** 3;
  const problems = name === 'problems';
  const pool = (n, size, frac, status = 'ONLINE', scan = null) => ({
    id: n.length, name: n, guid: '1', status, healthy: status === 'ONLINE', warning: false,
    size: Math.round(size), allocated: Math.round(size * frac), free: Math.round(size * (1 - frac)), scan,
  });
  const app = (n, title, state, upgrade = false) => ({
    name: n, id: n, state, upgrade_available: upgrade,
    metadata: { title, icon: `${iconBase}/icons/${n}.png` },
    portals: { 'Web UI': `http://0.0.0.0:${30000 + n.length}/` },
  });
  return {
    info: { hostname: 'truenas', version: '25.04.2.4', uptime_seconds: 12 * 86400 + 5 * 3600 + 17 * 60, physmem: 32 * GB, cores: 8, model: 'AMD Ryzen 5 5600G' },
    pools: problems
      ? [pool('tank', 16 * TB, 0.93, 'DEGRADED', { state: 'SCANNING', function: 'RESILVER', percentage: 37 }), pool('fast', 1.8 * TB, 0.41)]
      : [pool('tank', 16 * TB, 0.62, 'ONLINE', { state: 'FINISHED', function: 'SCRUB', percentage: 100 }), pool('fast', 1.8 * TB, 0.41), pool('backup', 8 * TB, 0.86)],
    alerts: problems
      ? [
        { uuid: 'a1', level: 'CRITICAL', klass: 'VolumeStatus', formatted: 'Pool tank state is DEGRADED: One or more devices has been removed by the administrator.', dismissed: false },
        { uuid: 'a2', level: 'WARNING', klass: 'SMART', formatted: 'Device: /dev/sdc, 8 Currently unreadable (pending) sectors.', dismissed: false },
        { uuid: 'a3', level: 'WARNING', klass: 'Update', formatted: 'A system update is available. Go to System > Update to download and apply the update.', dismissed: false },
        { uuid: 'a4', level: 'INFO', klass: 'AppUpdate', formatted: 'An update is available for nextcloud.', dismissed: false },
        { uuid: 'a5', level: 'INFO', klass: 'Old', formatted: 'Dismissed alert', dismissed: true },
      ]
      : [],
    apps: [
      app('plex', 'Plex', 'RUNNING'),
      app('jellyfin', 'Jellyfin', 'STOPPED'),
      app('nextcloud', 'Nextcloud', 'RUNNING', true),
      app('immich', 'Immich', 'RUNNING'),
      app('home-assistant', 'Home Assistant', 'RUNNING'),
      app('pihole', 'Pi-hole', problems ? 'CRASHED' : 'RUNNING'),
      app('syncthing', 'Syncthing', 'STOPPED'),
    ],
    cpuBase: problems ? 88 : 23,
    tempBase: problems ? 82 : 47,
  };
}

function start({ port = 8443, iconPort = 8480, scenario = 'healthy', interval = 1000, log = () => {} } = {}) {
  const iconBase = `http://127.0.0.1:${iconPort}`;
  const data = scenarioData(scenario, iconBase);
  const pems = selfsigned.generate([{ name: 'commonName', value: 'truenas.local' }], { days: 30, keySize: 2048 });
  const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocket.Server({ noServer: true });
  const calls = [];
  server.on('upgrade', (req, sock, head) => {
    if (req.url !== '/api/current') { sock.write('HTTP/1.1 404 Not Found\r\n\r\n'); sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req));
  });
  let t = 0;
  wss.on('connection', (ws) => {
    let authed = false;
    let sub = null;
    ws.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      calls.push(msg.method);
      log(`<- ${msg.method}`);
      const reply = (result) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      const error = (reason, code = -32001) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message: 'Method call error', data: { reason, errname: 'EACCES' } } }));
      if (msg.method === 'auth.login_with_api_key') { authed = msg.params[0] === API_KEY; return reply(authed); }
      if (!authed) return error('Not authenticated');
      switch (msg.method) {
        case 'core.subscribe':
          sub = setInterval(() => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'collection_update', params: { msg: 'added', collection: 'reporting.realtime', fields: realtime(data, t++) } })), interval);
          return reply('sub-1');
        case 'system.info': return reply({ ...data.info });
        case 'pool.query': return reply(data.pools);
        case 'alert.list': return reply(data.alerts);
        case 'app.query': return reply(data.apps);
        case 'app.start':
        case 'app.stop': {
          const a = data.apps.find((x) => x.name === msg.params[0]);
          if (!a) return error('App not found');
          a.state = msg.method === 'app.start' ? 'DEPLOYING' : 'STOPPING';
          setTimeout(() => { a.state = msg.method === 'app.start' ? 'RUNNING' : 'STOPPED'; }, 1500);
          return reply(42);
        }
        default: return ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method does not exist' } }));
      }
    });
    ws.on('close', () => clearInterval(sub));
  });
  const iconServer = http.createServer((req, res) => {
    const m = /^\/icons\/([\w-]+)\.png$/.exec(req.url);
    if (m && ICONS[m[1]]) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(ICONS[m[1]]); } else { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => iconServer.listen(iconPort, '127.0.0.1', () => resolve({
      data, calls, apiKey: API_KEY,
      close: () => { wss.clients.forEach((c) => c.terminate()); server.close(); iconServer.close(); },
    })));
  });
}

function realtime(data, t) {
  const wave = (p, a) => Math.sin(t / p) * a;
  const cpu = Math.max(1, Math.min(99, data.cpuBase + wave(3, 9) + wave(1.3, 4)));
  const cores = {};
  for (let i = 0; i < 8; i++) cores['cpu' + i] = { usage: Math.max(0, cpu + wave(1 + i, 12)), temp: data.tempBase + i % 3 };
  const burst = (t % 25) > 14 ? 1 : 0.15;
  const GB = 1024 ** 3;
  return {
    cpu: { cpu: { usage: cpu, temp: null }, ...cores },
    memory: { physical_memory_total: 32 * GB, physical_memory_available: (11.5 + wave(6, 0.6)) * GB, arc_size: 14.2 * GB },
    zfs: { demand_data_hit_percentage: 97.6 },
    interfaces: {
      enp3s0: { link_state: 'LINK_STATE_UP', speed: 2500, received_bytes_rate: (60 + wave(2, 30)) * 1e6 * burst + 4e5, sent_bytes_rate: (9 + wave(3, 5)) * 1e6 * burst + 1e5 },
      enp4s0: { link_state: 'LINK_STATE_DOWN', speed: 0, received_bytes_rate: 0, sent_bytes_rate: 0 },
    },
    disks: {}, pools: {},
  };
}

module.exports = { start, API_KEY };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  start({ port: Number(get('port', 8443)), scenario: get('scenario', 'healthy'), log: console.log }).then(() =>
    console.log(`Fake TrueNAS on wss://127.0.0.1:${get('port', 8443)}/api/current  (API key: ${API_KEY})`));
}
