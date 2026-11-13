'use strict';
// Turns a Tuya device record + its data point list into what the keys need:
// what kind of thing it is, which data point switches it, power reading,
// brightness and colour.

const LIGHT_CATS = new Set(['dj', 'dd', 'fwd', 'xdd', 'dc', 'tyndj', 'gyd', 'fsd', 'sxd', 'tgq', 'tgkg']);
const PLUG_CATS = new Set(['cz', 'pc', 'wkcz']);
const SWITCH_CATS = new Set(['kg', 'tdq', 'qjdcz', 'dlq', 'cjkg', 'ckmkzq', 'kgq']);
const FAN_CATS = new Set(['fs', 'fsd', 'fskg']);

const SWITCH_CODE = /^(switch|switch_\d+|switch_led|switch_led_\d+|led_switch|switch_usb\d*)$/;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Build the normalised device description. spec: { dpId: {code,type,values} } */
function describe(raw, spec) {
  const category = raw.category || '';
  const s = spec && Object.keys(spec).length ? spec : guessSpec(category, raw);
  const byCode = {};
  for (const [dp, item] of Object.entries(s)) if (item && item.code) byCode[item.code] = { dp, ...item };

  // On/off data points (several for power boards)
  const switches = [];
  for (const [dp, item] of Object.entries(s)) {
    if (!item || !SWITCH_CODE.test(item.code || '')) continue;
    if (String(item.type).toLowerCase() !== 'boolean' && item.type) continue;
    switches.push({ dp, code: item.code, label: switchLabel(item.code) });
  }
  switches.sort((a, b) => order(a.code) - order(b.code) || Number(a.dp) - Number(b.dp));

  // Light
  let light = null;
  const bright = byCode.bright_value_v2 || byCode.bright_value || byCode.bright_value_1;
  const colour = byCode.colour_data_v2 || byCode.colour_data;
  if (LIGHT_CATS.has(category) || bright || colour) {
    const sw = byCode.switch_led || byCode.switch_led_1 || byCode.switch_1 || byCode.switch || switches[0];
    const temp = byCode.temp_value_v2 || byCode.temp_value;
    const v2 = !!(byCode.bright_value_v2 || byCode.colour_data_v2);
    if (sw || bright) {
      light = {
        switchDp: sw ? sw.dp : null,
        modeDp: byCode.work_mode ? byCode.work_mode.dp : null,
        brightDp: bright ? bright.dp : null,
        brightMin: bright ? num(bright.values && bright.values.min, v2 ? 10 : 25) : 0,
        brightMax: bright ? num(bright.values && bright.values.max, v2 ? 1000 : 255) : 0,
        tempDp: temp ? temp.dp : null,
        tempMin: temp ? num(temp.values && temp.values.min, 0) : 0,
        tempMax: temp ? num(temp.values && temp.values.max, v2 ? 1000 : 255) : 0,
        colourDp: colour ? colour.dp : null,
        colourV2: colour ? colour.code === 'colour_data_v2' : v2,
      };
    }
  }

  // Power meter
  let power = null;
  const p = byCode.cur_power || byCode.power || byCode.cur_power_1;
  if (p && /value|integer/i.test(p.type || 'value')) {
    power = { dp: p.dp, scale: num(p.values && p.values.scale, 1), unit: (p.values && p.values.unit) || 'W' };
  }

  let kind = 'switch';
  if (light) kind = 'light';
  else if (FAN_CATS.has(category)) kind = 'fan';
  else if (PLUG_CATS.has(category)) kind = 'plug';
  else if (SWITCH_CATS.has(category)) kind = 'switch';
  else if (power) kind = 'plug';

  return {
    id: raw.id,
    name: (raw.name || raw.product_name || 'Device').trim(),
    key: raw.local_key || '',
    category,
    product: raw.product_name || '',
    model: raw.model || '',
    kind,
    switches: light && light.switchDp && !switches.some((x) => x.dp === light.switchDp)
      ? [{ dp: light.switchDp, code: 'switch_led', label: 'Light' }, ...switches]
      : switches.length ? switches : [{ dp: '1', code: 'switch_1', label: 'Power' }],
    light,
    power,
    cloudCodes: Object.fromEntries(Object.entries(s).map(([dp, it]) => [dp, it && it.code]).filter(([, c]) => c)),
    sub: !!raw.sub,
  };
}

function order(code) {
  if (code === 'switch_led' || code === 'switch' || code === 'switch_1') return 0;
  const m = /(\d+)$/.exec(code);
  if (/usb/.test(code)) return 100 + (m ? Number(m[1]) : 0);
  return m ? Number(m[1]) : 50;
}

function switchLabel(code) {
  if (code === 'switch_led' || code === 'led_switch') return 'Light';
  if (code === 'switch') return 'Power';
  let m = /^switch_usb(\d*)$/.exec(code);
  if (m) return m[1] ? `USB ${m[1]}` : 'USB';
  m = /^switch(?:_led)?_(\d+)$/.exec(code);
  if (m) return `Outlet ${m[1]}`;
  return code;
}

/** Fallback when the cloud gives no data point list. */
function guessSpec(category, raw) {
  if (LIGHT_CATS.has(category)) {
    return {
      20: { code: 'switch_led', type: 'Boolean' },
      21: { code: 'work_mode', type: 'Enum' },
      22: { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
      23: { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } },
      24: { code: 'colour_data_v2', type: 'Json' },
    };
  }
  const s = { 1: { code: 'switch_1', type: 'Boolean' } };
  if (PLUG_CATS.has(category)) s[19] = { code: 'cur_power', type: 'Integer', values: { scale: 1, unit: 'W' } };
  // Use the cloud's current status to spot extra outlets.
  for (const st of (raw && raw.status) || []) {
    const m = /^switch_(\d+)$/.exec(st.code || '');
    if (m && Number(m[1]) > 1 && Number(m[1]) < 10) s[m[1]] = { code: st.code, type: 'Boolean' };
  }
  return s;
}

// ------------------------------------------------------------------ light values

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m].map((n) => Math.round(n * 255));
}

/** Parse colour data (hex v2 "hhhhssssvvvv", v1 "rrggbb0hhhssvv", or JSON). Returns {h,s,v} 0..1 for s,v. */
function parseColour(value, v2) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object') return { h: num(value.h, 0), s: num(value.s, 0) / (v2 ? 1000 : 255), v: num(value.v, 0) / (v2 ? 1000 : 255) };
  const str = String(value).trim();
  if (str[0] === '{') {
    try { return parseColour(JSON.parse(str), v2); } catch (_) { return null; }
  }
  if (/^[0-9a-f]{12}$/i.test(str)) {
    return { h: parseInt(str.slice(0, 4), 16), s: parseInt(str.slice(4, 8), 16) / 1000, v: parseInt(str.slice(8, 12), 16) / 1000 };
  }
  if (/^[0-9a-f]{14}$/i.test(str)) {
    return { h: parseInt(str.slice(7, 10), 16), s: parseInt(str.slice(10, 12), 16) / 255, v: parseInt(str.slice(12, 14), 16) / 255 };
  }
  return null;
}

function formatColour(hsv, v2) {
  const h = Math.round(Math.max(0, Math.min(360, hsv.h)));
  if (v2) {
    const s = Math.round(Math.max(0, Math.min(1, hsv.s)) * 1000);
    const v = Math.round(Math.max(0, Math.min(1, hsv.v)) * 1000);
    return [h, s, v].map((n) => n.toString(16).padStart(4, '0')).join('');
  }
  const rgb = hsvToRgb(h, hsv.s, hsv.v);
  return rgb.map((n) => n.toString(16).padStart(2, '0')).join('') + '0' + h.toString(16).padStart(3, '0')
    + Math.round(hsv.s * 255).toString(16).padStart(2, '0') + Math.round(hsv.v * 255).toString(16).padStart(2, '0');
}

const WARM = [255, 168, 82];
const COOL = [214, 230, 255];

/** What the light looks like now: { on, pct (0-100), rgb, mode } */
function lightState(dev, dps) {
  const L = dev.light;
  if (!L) return null;
  const on = L.switchDp ? dps[L.switchDp] === true : true;
  const mode = L.modeDp ? String(dps[L.modeDp] || 'white') : 'white';
  let pct = null;
  let rgb = WARM;
  const colour = L.colourDp ? parseColour(dps[L.colourDp], L.colourV2) : null;
  if (mode === 'colour' && colour) {
    pct = Math.round(colour.v * 100);
    rgb = hsvToRgb(colour.h, Math.max(0.35, colour.s), 1);
  } else {
    if (L.brightDp && dps[L.brightDp] !== undefined) {
      pct = Math.round(((num(dps[L.brightDp], L.brightMax) - L.brightMin) / Math.max(1, L.brightMax - L.brightMin)) * 99 + 1);
    }
    if (L.tempDp && dps[L.tempDp] !== undefined) {
      const t = Math.max(0, Math.min(1, (num(dps[L.tempDp], 0) - L.tempMin) / Math.max(1, L.tempMax - L.tempMin)));
      rgb = WARM.map((w, i) => Math.round(w + (COOL[i] - w) * t));
    }
  }
  if (pct !== null) pct = Math.max(1, Math.min(100, pct));
  return { on, pct, rgb, mode };
}

/** Data points to set a light to `pct` (1-100) brightness (and turn it on). */
function brightnessDps(dev, dps, pct) {
  const L = dev.light;
  const out = {};
  if (!L) return out;
  pct = Math.max(1, Math.min(100, Math.round(pct)));
  const mode = L.modeDp ? String(dps[L.modeDp] || 'white') : 'white';
  const colour = L.colourDp ? parseColour(dps[L.colourDp], L.colourV2) : null;
  if (mode === 'colour' && colour) {
    out[L.colourDp] = formatColour({ ...colour, v: pct / 100 }, L.colourV2);
  } else if (L.brightDp) {
    out[L.brightDp] = Math.round(L.brightMin + ((pct - 1) / 99) * (L.brightMax - L.brightMin));
  }
  if (L.switchDp && dps[L.switchDp] !== true) out[L.switchDp] = true;
  return out;
}

function powerWatts(dev, dps) {
  if (!dev.power) return null;
  const v = dps[dev.power.dp];
  if (v === undefined || v === null) return null;
  return num(v, 0) / Math.pow(10, dev.power.scale || 0);
}

/** Cloud status [{code,value}] -> local-style dps using the device's codes. */
function cloudStatusToDps(dev, list) {
  const codeToDp = {};
  for (const [dp, code] of Object.entries(dev.cloudCodes || {})) codeToDp[code] = dp;
  const out = {};
  for (const { code, value } of list || []) {
    const dp = codeToDp[code];
    if (!dp) continue;
    let v = value;
    if (dev.light && dp === dev.light.colourDp && typeof v === 'string' && v.trim()[0] === '{') {
      const c = parseColour(v, true);
      if (c) v = formatColour(c, dev.light.colourV2);
    }
    out[dp] = v;
  }
  return out;
}

/** Local-style dps -> cloud commands [{code,value}] */
function dpsToCloudCommands(dev, dps) {
  const cmds = [];
  for (const [dp, value] of Object.entries(dps)) {
    const code = (dev.cloudCodes || {})[dp];
    if (!code) continue;
    let v = value;
    if (dev.light && dp === dev.light.colourDp) {
      const c = parseColour(v, dev.light.colourV2);
      if (c) v = { h: Math.round(c.h), s: Math.round(c.s * 1000), v: Math.round(c.v * 1000) };
    }
    cmds.push({ code, value: v });
  }
  return cmds;
}

module.exports = {
  describe, lightState, brightnessDps, powerWatts, parseColour, formatColour, hsvToRgb,
  cloudStatusToDps, dpsToCloudCommands,
};
