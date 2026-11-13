'use strict';
// Moza serial frames (from Boxflat's serial.yml): 0x7e, payload length, group, device, payload..., checksum.
// checksum = (sum of all previous bytes + 13) mod 256. Replies come back with group + 0x80 and the device nibbles swapped.
const MAGIC = 13;
const DEV = { main: 18, base: 19 };
function checksum(bytes) { return (bytes.reduce((a, b) => a + b, 0) + MAGIC) & 255; }
function build(group, device, payload) {
  const body = [0x7e, payload.length, group, device, ...payload];
  return Buffer.from([...body, checksum(body)]);
}
const swap = (d) => ((d & 15) << 4) | (d >> 4);
// Split a byte stream into frames and return the ones that pass the checksum.
function parse(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x7e || i + 4 >= buf.length) continue;
    const len = buf[i + 1];
    const end = i + 4 + len;
    if (end >= buf.length) continue;
    const frame = buf.slice(i, end + 1);
    if (checksum(Array.from(frame.slice(0, -1))) !== frame[frame.length - 1]) continue;
    out.push({ group: frame[2], device: frame[3], payload: Array.from(frame.slice(4, 4 + len)) });
    i = end;
  }
  return out;
}
// get-work-mode: read group 31, id 52, one byte (a zero is sent for the value, like Pit House does).
const getWorkMode = () => build(31, DEV.main, [52, 0]);
// set-work-mode: write group 31, id 51, one byte. NOT used until the real byte values are confirmed.
const setWorkMode = (v) => build(31, DEV.main, [51, v]);
module.exports = { build, parse, checksum, swap, getWorkMode, setWorkMode, DEV };
