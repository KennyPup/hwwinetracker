// Python-compatible helpers so the JavaScript port renders exactly what the Python app rendered.
// Times are Hermit Woods local time (America/New_York), like the laptop app.

export const TZ = 'America/New_York';
export const GAL = 3.785411784;
export const LB = 2.20462262;

// html.escape(str(s)) with None -> ''
export function E(s) {
  if (s === null || s === undefined) return '';
  return String(pyStr(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// str(x): booleans as True/False; everything else as JS would print it
export function pyStr(v) {
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null || v === undefined) return 'None';
  return String(v);
}

// f'{x:.{d}f}' — Python rounds exact ties to even; JS toFixed rounds them up. Handle the exact-tie case.
export function fx(x, d = 0) {
  x = Number(x);
  if (!isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'nan';
  const ax = Math.abs(x);
  let s;
  if (ax < 1e21) {
    const t = ax.toFixed(Math.min(100, d + 25));          // exact decimal expansion of the binary value
    const i = t.indexOf('.') + 1 + d;
    if (t[i] === '5' && /^0*$/.test(t.slice(i + 1))) {    // a true tie: round half to even, as Python does
      const keep = t.slice(0, i).replace(/\.$/, '');
      s = Number(keep.slice(-1)) % 2 === 0 ? keep : ax.toFixed(d);
    } else s = ax.toFixed(d);
  } else s = ax.toFixed(d);
  return (x < 0 || Object.is(x, -0) ? '-' : '') + s;
}

// f'{x:,.{d}f}'
export function fxc(x, d = 0) {
  const s = fx(x, d);
  const neg = s.startsWith('-');
  const [i, f] = (neg ? s.slice(1) : s).split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + g + (f !== undefined ? '.' + f : '');
}

// app.num(v, d): '' for None/'' else f'{float(v):,.{d}f}' (non-numbers escaped)
export function num(v, d = 0) {
  if (v === null || v === undefined || v === '') return '';
  const x = typeof v === 'number' ? v : Number(v);
  if (typeof v === 'boolean') return fxc(v ? 1 : 0, d);
  if (Number.isNaN(x)) return E(v);
  return fxc(x, d);
}

// f'{x:.{p}g}'
export function fg(x, p = 6) {
  x = Number(x);
  if (x === 0) return '0';
  if (!isFinite(x)) return String(x);
  const e = Math.floor(Math.log10(Math.abs(x)));
  let s;
  // decide by the exponent after rounding to p significant digits
  const exp = Number(x.toExponential(p - 1).split('e')[1]);
  if (exp < -4 || exp >= p) {
    s = x.toExponential(p - 1);
    let [mant, ex] = s.split('e');
    if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    const en = Number(ex);
    return mant + 'e' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(2, '0');
  }
  s = fx(x, Math.max(0, p - 1 - exp));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  void e;
  return s;
}

// Python round(x) -> int with banker's rounding; round(x, d) -> float
export function pyRound(x, d = 0) {
  return Number(fx(x, d));
}

export function median(vs) {
  const s = [...vs].sort((a, b) => a - b), n = s.length;
  if (!n) throw new Error('median of empty list');
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---------------------------------------------------------------- local time (America/New_York)
const _parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function nowParts(d = new Date()) {
  const p = Object.fromEntries(_parts.formatToParts(d).map(x => [x.type, x.value]));
  return p; // year month day hour minute second (strings)
}
// datetime.now().isoformat(timespec='seconds') in local time, naive
export function nowIso() {
  const p = nowParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export function today() {
  const p = nowParts();
  return `${p.year}-${p.month}-${p.day}`;
}
export function thisYear() {
  return Number(nowParts().year);
}
// naive local 'YYYY-MM-DD[THH:MM[:SS]]' -> milliseconds on a UTC clock (naive arithmetic, like Python)
export function naiveMs(s) {
  s = String(s).replace(' ', 'T');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) throw new Error('bad date ' + s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}
export function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
// date.fromisoformat(d) +/- days -> 'YYYY-MM-DD'
export function addDays(day, n) {
  return isoDate(naiveMs(day) + n * 86400000);
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// strftime subset: %a %d %b %Y %m %H %M %S
export function strftime(ms, f) {
  const d = new Date(ms), pad = n => String(n).padStart(2, '0');
  return f.replace(/%([adbYmHMS%])/g, (_, k) => ({
    a: WD[d.getUTCDay()], d: pad(d.getUTCDate()), b: MON[d.getUTCMonth()], Y: String(d.getUTCFullYear()), m: pad(d.getUTCMonth() + 1),
    H: pad(d.getUTCHours()), M: pad(d.getUTCMinutes()), S: pad(d.getUTCSeconds()), '%': '%',
  })[k]);
}
export function nowMs() {
  return naiveMs(nowIso());
}

// ---------------------------------------------------------------- query strings (urllib.parse.parse_qs)
export function parseQs(s, keepBlank = false) {
  const out = {};
  for (const part of String(s || '').replace(/^\?/, '').split(/[&;]/)) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' '));
    const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
    if (!v && !keepBlank) continue;
    (out[k] = out[k] || []).push(v);
  }
  return out;
}
// q.get(k, [d])[0]
export function qv(q, k, d = '') {
  return q[k] && q[k].length ? q[k][0] : d;
}
export function urlencode(obj) {
  return Object.entries(obj).map(([k, v]) => encodeURIComponent(k).replace(/%20/g, '+') + '=' + encodePlus(pyStr(v))).join('&');
}
function encodePlus(s) {
  // urllib.parse.quote_plus semantics (safe: letters digits _.-~)
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');
}
// urllib.parse.quote(s, safe='')
export function quote(s, safe = '/') {
  let out = '';
  for (const ch of String(s)) {
    if (/[A-Za-z0-9_.\-~]/.test(ch) || safe.includes(ch)) out += ch;
    else out += Array.from(new TextEncoder().encode(ch)).map(b => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
  }
  return out;
}

export class UserError extends Error {}

// repr(float): integer-valued floats print with '.0'
export function pyFloatStr(x) {
  x = Number(x);
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  let [m, e] = x.toExponential().split('e');
  e = Number(e);
  const neg = m.startsWith('-');
  if (neg) m = m.slice(1);
  const dg = m.replace('.', '');
  let s;
  if (e >= -4 && e < 16) {
    if (e >= 0) s = dg.length <= e + 1 ? dg + '0'.repeat(e + 1 - dg.length) + '.0' : dg.slice(0, e + 1) + '.' + dg.slice(e + 1);
    else s = '0.' + '0'.repeat(-e - 1) + dg;
  } else s = dg[0] + (dg.length > 1 ? '.' + dg.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  return (neg ? '-' : '') + s;
}

// naive local time (America/New_York) <-> real epoch ms, daylight-saving aware (Python's .timestamp() / fromtimestamp())
function nyOffset(epochMs) {
  const p = nowParts(new Date(epochMs));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(epochMs / 1000) * 1000;
}
export function localToEpoch(s) {
  const n = naiveMs(s);
  let e = n - nyOffset(n);
  e = n - nyOffset(e);
  return e;
}
export function epochToLocalMs(e) {
  return Math.floor(e / 1000) * 1000 + nyOffset(e);
}
