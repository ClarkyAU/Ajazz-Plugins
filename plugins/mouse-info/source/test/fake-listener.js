// Fake of runtime/listener.ps1 for tests: prints the same JSON lines.
// Scenario from MOUSEINFO_SCENARIO: receiver | cable | profile | low | waiting | none | bluetooth | crash
const sc = process.env.MOUSEINFO_SCENARIO || 'receiver';
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const hex = (a) => a.map(n => n.toString(16).padStart(2, '0')).join('');
const rep = (pid, conn, bytes, src) => out({ type: 'report', pid, model: 'Model I 2', conn, src: src || 'read', hex: hex(bytes.concat([0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 8)) });
const I2 = (conn, pid) => ({ pid, model: 'Model I 2', conn, product: 'Model I 2 Wireless' });
const later = (ms, fn) => setTimeout(fn, ms);
out({ type: 'log', level: 'info', msg: 'Listener ready in 5 ms (fake)' });
if (sc === 'crash') process.exit(3);
out({ type: 'ready' });
const BT = [{ id: 'BTHLE\\DEV_D1C2B3A4F5E6\\7&1', name: 'MX Master 3S', level: 58 }, { id: 'BTHENUM\\X', name: 'WH-1000XM5', level: 90 }];
switch (sc) {
  case 'receiver': out({ type: 'devices', list: [I2('receiver', '821D')] }); rep('821D', 'receiver', [6, 0xf9, 0x80, 1]); rep('821D', 'receiver', [6, 0xfb, 21, 0]); break;
  case 'cable': // battery while wireless, then the cable is plugged in (receiver disappears)
    out({ type: 'devices', list: [I2('receiver', '821D')] }); rep('821D', 'receiver', [6, 0xfb, 21, 0]);
    later(300, () => { out({ type: 'devices', list: [] }); out({ type: 'devices', list: [I2('cable', '821A')] }); });
    break;
  case 'profile': out({ type: 'devices', list: [I2('receiver', '821D')] }); rep('821D', 'receiver', [6, 0xfb, 64, 0]); later(300, () => rep('821D', 'receiver', [4, 0xf1, 3], 'consumer')); break;
  case 'low': out({ type: 'devices', list: [I2('receiver', '821D')] }); rep('821D', 'receiver', [6, 0xfb, 12, 0]); break;
  case 'waiting': out({ type: 'devices', list: [I2('receiver', '821D')] }); break;
  case 'none': out({ type: 'devices', list: [] }); break;
  case 'bluetooth': out({ type: 'devices', list: [] }); break;
}
out({ type: 'bt', list: sc === 'bluetooth' ? BT : [] });
let buf = '';
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const cmd = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (cmd === 'rescan') out({ type: 'log', level: 'info', msg: 'got rescan' });
    if (cmd === 'quit') process.exit(0);
  }
});
process.stdin.on('end', () => process.exit(0));
