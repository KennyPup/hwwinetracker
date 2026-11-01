// Port of entry.py — recording new cellar operations in HW Cellar (milestone 2).
//
// State model
// -----------
// * Vintrace history ends at meta 'state_base_date' (the last imported end-of-day snapshot).
// * The contents of a vessel at any later moment = its base snapshot row, overridden by the latest app operation
//   (source='app', not reversed) that touched it: op_vessel.vol_after_l / batch_after_id / tax_state_after / tax_class_after.
// * After every write, end-of-day rows in bulk_snapshot are rebuilt for each day after the base date that has app activity
//   (plus today), so the TTB and dashboard code keep reading bulk_snapshot as before.
// * TTB events after the base date are written here explicitly (tax_event.source='app'); derive.py only infers events up to
//   the base date.
import { pyStr, fx, nowIso, today, addDays } from './lib/py.js';
import { entry as K } from './gen/strings.js';

export const GAL = K.GAL;
// litres of volume added per kg dissolved (used only to suggest the new volume after an addition; always editable)
export const DISPLACEMENT_L_PER_KG = K.DISPLACEMENT_L_PER_KG;
export const UNIT_TO_BASE = K.UNIT_TO_BASE;
export const STOCK_UNIT_PER_BASE = K.STOCK_UNIT_PER_BASE;   // keys "base|stock unit"
export const TAX_CLASSES = K.TAX_CLASSES;
export const TREATMENTS = K.TREATMENTS;
// Loss / gain reasons = the 14 categories Ken used in Vintrace (its Wine production loss report, Dec 2019 – Oct 2026), same spelling.
// [reason, direction ('loss' | 'gain' | 'both'), hint]. Direction follows Vintrace's history (e.g. Press and Correction went both ways).
export const ADJUST_REASONS = [
  ['Correction', 'both', 'Re-dip / measuring error / book correction'],
  ['Evaporation', 'loss', 'Evaporation, ullage'],
  ['Fermentable sugar addition', 'gain', 'Volume rise from sugar, honey or juice added'],
  ['Spillage', 'loss', 'Spill or leak'],
  ['Lees', 'both', 'Lees / sediment left behind (racking)'],
  ['Filtration', 'both', 'Lost in filtering'],
  ['Operation Loss', 'both', 'Lost in handling (hoses, pump, must)'],
  ['Press', 'both', 'Press yield'],
  ['Transfer', 'loss', 'Lost in a transfer'],
  ['Bottling', 'both', 'Bottling loss / leftover'],
  ['TTB - Used for testing', 'loss', 'Samples used for testing (TTB Section A line 23)'],
  ['TTB - Destroyed', 'loss', 'Dumped / destroyed (TTB line 24)'],
  ['TTB - Casualty loss', 'loss', 'Casualty loss — accident, breakage (TTB line 29)'],
  ['TTB - Water addition', 'gain', 'Water added (TTB: produced by amelioration, line 6)'],
];
export const LOSS_REASONS = ADJUST_REASONS.filter(r => r[1] !== 'gain').map(r => r[0]);   // for loss boxes on transfer / blend / split forms
export const reason_dir = r => { const x = ADJUST_REASONS.find(a => a[0].toLowerCase() === String(r || '').toLowerCase()); return x ? x[1] : 'both'; };
export const METRICS = K.METRICS;
export const BEVERAGE_TYPES = K.BEVERAGE_TYPES;
export const BASE_INGREDIENTS = K.BASE_INGREDIENTS;

export class EntryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EntryError';
  }
}

// ------------------------------------------------------------------ Python-compatibility helpers (used here and by ui_entry.js)

const _has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);

// characters Python's str.isspace() treats as whitespace (str.strip(), int(), float())
const PY_WS = '\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0                　';
const isPyWs = ch => PY_WS.includes(ch);

// str.strip()
export function pyStrip(s) {
  const a = Array.from(String(s));
  let i = 0, j = a.length;
  while (i < j && isPyWs(a[i])) i++;
  while (j > i && isPyWs(a[j - 1])) j--;
  return a.slice(i, j).join('');
}

// str.replace(old, new) — replaces every occurrence
export function pyReplace(s, a, b) {
  return String(s).split(a).join(b);
}

// Unicode decimal digit value (Py_UNICODE_TODECIMAL) or -1. Nd characters come in contiguous 0..9 runs.
const ND = /^\p{Nd}$/u;
function decimalValue(ch) {
  if (!ND.test(ch)) return -1;
  let cp = ch.codePointAt(0), start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

// _PyUnicode_TransformDecimalAndSpaceToASCII: unicode spaces -> ' ', unicode digits -> ASCII, other non-ASCII -> '?'
function toAsciiNumber(s) {
  let out = '';
  for (const ch of s) {
    if (isPyWs(ch)) out += ' ';
    else if (ch.codePointAt(0) < 128) out += ch;
    else {
      const d = decimalValue(ch);
      out += d >= 0 ? String(d) : '?';
    }
  }
  return out;
}

// underscores are only allowed between two digits
function stripUnderscores(s) {
  if (!s.includes('_')) return s;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '_' && !(i > 0 && /[0-9]/.test(s[i - 1]) && i + 1 < s.length && /[0-9]/.test(s[i + 1]))) return null;
  }
  return s.replace(/_/g, '');
}

const ASCII_WS = /^[ \t\n\x0b\x0c\r]+|[ \t\n\x0b\x0c\r]+$/g;

// Python repr() of a str (for error messages that quote user input)
const NONPRINT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
export function pyRepr(v) {
  if (typeof v !== 'string') return pyStr(v);
  const q = v.includes("'") && !v.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of v) {
    const cp = ch.codePointAt(0);
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp < 0x7f || ch === ' ') out += ch;
    else if (!NONPRINT.test(ch)) out += ch;
    else if (cp <= 0xff) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp <= 0xffff) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += '\\U' + cp.toString(16).padStart(8, '0');
  }
  return out + q;
}

// float(x) — throws a ValueError-like Error with Python's message when the text is not a number
export function pyFloat(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) {
    const e = new TypeError("float() argument must be a string or a real number, not 'NoneType'");
    e.pyType = 'TypeError';
    throw e;
  }
  const s0 = String(v);
  let s = toAsciiNumber(s0).replace(ASCII_WS, '');
  s = stripUnderscores(s);
  const ok = s !== null && /^[+-]?(?:(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|inf|infinity|nan)$/i.test(s);
  if (!ok) {
    const e = new Error(`could not convert string to float: ${pyRepr(s0)}`);
    e.pyType = 'ValueError';
    throw e;
  }
  const t = s.toLowerCase();
  const neg = t.startsWith('-');
  const body = t.replace(/^[+-]/, '');
  if (body === 'inf' || body === 'infinity') return neg ? -Infinity : Infinity;
  if (body === 'nan') return NaN;
  return Number(t);
}

// int(x) for str (base 10) / numbers — throws with Python's ValueError message on bad text
export function pyInt(v) {
  if (typeof v === 'number') {
    if (!isFinite(v)) {
      const e = new Error(Number.isNaN(v) ? 'cannot convert float NaN to integer' : 'cannot convert float infinity to integer');
      e.pyType = Number.isNaN(v) ? 'ValueError' : 'OverflowError';
      throw e;
    }
    return Math.trunc(v);
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) {
    const e = new TypeError("int() argument must be a string, a bytes-like object or a real number, not 'NoneType'");
    e.pyType = 'TypeError';
    throw e;
  }
  const s0 = String(v);
  let s = toAsciiNumber(s0).replace(ASCII_WS, '');
  const m = /^([+-]?)([0-9]+(?:_[0-9]+)*)$/.exec(s);
  if (!m) {
    const e = new Error(`invalid literal for int() with base 10: ${pyRepr(s0)}`);
    e.pyType = 'ValueError';
    throw e;
  }
  const n = Number(m[2].replace(/_/g, ''));
  return m[1] === '-' ? -n : n;
}

// fetchone()[0] / tuple unpacking on a missing row raise TypeError in Python; keep the same message
function _row(r, unpack = false) {
  if (r === null || r === undefined) {
    const e = new TypeError(unpack ? 'cannot unpack non-iterable NoneType object' : "'NoneType' object is not subscriptable");
    e.pyType = 'TypeError';
    throw e;
  }
  return r;
}

// datetime.fromisoformat (Python 3.10 rules), returning [y, mo, d, h, mi, s] or null when Python raises ValueError
const DIG = c => c !== undefined && c >= '0' && c <= '9';
function parseDigits(s, i, n) {
  let v = 0;
  for (let k = 0; k < n; k++) {
    const c = s[i + k];
    if (!DIG(c)) return null;
    v = v * 10 + (c.charCodeAt(0) - 48);
  }
  return [v, i + n];
}
// parse_hh_mm_ss_ff over s[p .. pEnd); characters past the end of s read as '\0'
function parseHMSF(s, p, pEnd, out) {
  const vals = [0, 0, 0];
  let i;
  for (i = 0; i < 3; i++) {
    const r = parseDigits(s, p, 2);
    if (!r) return -3;
    vals[i] = r[0];
    p = r[1];
    const c = p < s.length ? s[p] : '\0';
    p++;
    if (p >= pEnd) {
      out.h = vals[0]; out.m = vals[1]; out.s = vals[2]; out.us = 0;
      return c !== '\0' ? 1 : 0;
    } else if (c === ':') {
      continue;
    } else if (c === '.') {
      break;
    } else {
      return -4;
    }
  }
  out.h = vals[0]; out.m = vals[1]; out.s = vals[2];
  const rem = pEnd - p;
  if (!(rem === 6 || rem === 3)) return -3;
  const r = parseDigits(s, p, rem);
  if (!r) return -3;
  out.us = rem === 3 ? r[0] * 1000 : r[0];
  return (r[1] < s.length ? s[r[1]] : '\0') !== '\0' ? 1 : 0;
}
function fromIsoFormat310(str) {
  const cps = Array.from(str);
  const d = cps.slice(0, 10).join('');
  let y, mo, da;
  let r = parseDigits(d, 0, 4);
  if (!r) return null;
  y = r[0];
  if (d[4] !== '-') return null;
  r = parseDigits(d, 5, 2);
  if (!r) return null;
  mo = r[0];
  if (d[7] !== '-') return null;
  r = parseDigits(d, 8, 2);
  if (!r) return null;
  da = r[0];
  let h = 0, mi = 0, se = 0, tzoff = null;
  if (cps.length > 10) {
    const t = cps.slice(11).join('');   // after the one-character separator (any character)
    if (/[^\x00-\x7f]/.test(t)) return null;   // non-ASCII in the time part always fails in CPython 3.10
    const tEnd = t.length;
    let tz = 0;
    while (tz < tEnd && t[tz] !== '+' && t[tz] !== '-') tz++;
    if (tEnd === 0) tz = 1;   // do/while in C steps past an empty string
    const out = {};
    const rv = parseHMSF(t, 0, tz, out);
    if (rv < 0) return null;
    if (tz === tEnd || (tEnd === 0)) {
      if (rv === 1) return null;
    } else {
      const tzlen = tEnd - tz;
      if (!(tzlen === 6 || tzlen === 9 || tzlen === 16)) return null;
      const sign = t[tz] === '-' ? -1 : 1;
      const tout = {};
      const trv = parseHMSF(t, tz + 1, tEnd, tout);
      if (trv) return null;
      tzoff = sign * (tout.h * 3600 + tout.m * 60 + tout.s) + sign * tout.us / 1e6;
      if (!(tzoff > -86400 && tzoff < 86400)) return null;
    }
    h = out.h; mi = out.m; se = out.s;
  }
  if (y < 1 || y > 9999 || mo < 1 || mo > 12) return null;
  const dim = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (da < 1 || da > dim) return null;
  if (h > 23 || mi > 59 || se > 59) return null;
  return [y, mo, da, h, mi, se];
}

const p2 = n => String(n).padStart(2, '0');

// ------------------------------------------------------------------ schema upgrade

export function ensure_schema(db) {
  let cols = new Set(db.columns('op_vessel'));
  for (const c of ['tax_state_before', 'tax_state_after']) {
    if (!cols.has(c)) db.run(`ALTER TABLE op_vessel ADD COLUMN ${c} TEXT`);
  }
  cols = new Set(db.columns('operation'));
  if (!cols.has('created_at')) db.run('ALTER TABLE operation ADD COLUMN created_at TEXT');
  if (!db.columns('op_loss').includes('gain')) db.run('ALTER TABLE op_loss ADD COLUMN gain INTEGER NOT NULL DEFAULT 0');   // 1 = volume went UP (Vintrace "gain")
  cols = new Set(db.columns('intake'));
  if (!cols.has('op_id')) db.run('ALTER TABLE intake ADD COLUMN op_id INTEGER');
  if (!db.one("SELECT 1 FROM meta WHERE key='state_base_date'")) {
    const base = db.val('SELECT MAX(snap_date) FROM bulk_snapshot');
    db.run("INSERT INTO meta VALUES ('state_base_date', ?)", base);
  }
  db.commit();
}

export function base_date(db) {
  const r = db.one("SELECT value FROM meta WHERE key='state_base_date'");
  return r ? r.value : db.val('SELECT MAX(snap_date) FROM bulk_snapshot');
}

// ------------------------------------------------------------------ state

// Map {vessel_id: {batch_id, volume_l, tax_state, tax_class}} after all app operations with occurred_at <= at (insertion order as Python's dict).
export function vessel_state(db, at = null) {
  at = at || '9999-12-31 23:59:59';
  const bd = base_date(db);
  const st = new Map();
  for (const r of db.all('SELECT vessel_id,batch_id,volume_l,tax_state,tax_class FROM bulk_snapshot WHERE snap_date=?', bd)) {
    st.set(r.vessel_id, { batch_id: r.batch_id, volume_l: r.volume_l, tax_state: r.tax_state, tax_class: r.tax_class });
  }
  const q = `SELECT ov.vessel_id, ov.batch_after_id, ov.vol_after_l, ov.tax_state_after, ov.tax_class_after
           FROM op_vessel ov JOIN operation o ON o.id=ov.op_id
           WHERE o.source='app' AND o.reversed=0 AND o.occurred_at<=? ORDER BY o.occurred_at, o.id, ov.id`;
  for (const r of db.all(q, at)) {
    const L = r.vol_after_l;
    if (L === null || L === undefined || L <= 0.0005) {
      st.delete(r.vessel_id);
    } else {
      st.set(r.vessel_id, { batch_id: r.batch_after_id, volume_l: L, tax_state: r.tax_state_after || 'NON_DECLARED', tax_class: r.tax_class_after });
    }
  }
  return st;
}

// Rewrite end-of-day bulk_snapshot rows for days after the base date that have app activity, plus today.
export function rebuild_snapshots(db) {
  const bd = base_date(db);
  db.run('DELETE FROM bulk_snapshot WHERE snap_date>?', bd);
  const days = new Set(db.col("SELECT DISTINCT substr(occurred_at,1,10) AS d FROM operation WHERE source='app' AND substr(occurred_at,1,10)>?", bd));
  const td = today();
  if (td > bd) days.add(td);
  // year-ends between base date and today, so annual reports always find a closing snapshot
  for (let y = pyInt(bd.slice(0, 4)); y < pyInt(td.slice(0, 4)); y++) {
    const ye = `${y}-12-31`;
    if (ye > bd) days.add(ye);
  }
  const bev = new Map(db.all('SELECT id, beverage_type FROM batch').map(r => [r.id, r.beverage_type]));
  for (const d of [...days].sort(cmpStr)) {
    for (const [vid, s] of vessel_state(db, d + ' 23:59:59')) {
      db.run('INSERT INTO bulk_snapshot VALUES (?,?,?,?,?,?,?,?)',
        d, vid, s.batch_id, s.volume_l, s.tax_state, s.tax_state === 'BONDED' ? s.tax_class : null,
        bev.has(s.batch_id) ? bev.get(s.batch_id) : null, null);
    }
  }
}

// Python str ordering (by code point)
export function cmpStr(a, b) {
  if (a === b) return 0;
  const A = Array.from(a), B = Array.from(b);
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i].codePointAt(0), y = B[i].codePointAt(0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return A.length < B.length ? -1 : A.length > B.length ? 1 : 0;
}

// List of objects for occupied vessels now, for pickers.
export function current_contents(db) {
  const st = vessel_state(db);
  const out = [];
  for (const [vid, s] of st) {
    const v = _row(db.one('SELECT code, kind, capacity_l FROM vessel WHERE id=?', vid));
    const b = s.batch_id ? db.one('SELECT code, description FROM batch WHERE id=?', s.batch_id) : null;
    out.push({ vessel_id: vid, vessel: v.code, kind: v.kind, capacity_l: v.capacity_l, batch_id: s.batch_id, batch: b ? b.code : '',
      description: b ? b.description : '', volume_l: s.volume_l, tax_state: s.tax_state, tax_class: s.tax_class });
  }
  return out.sort((x, y) => cmpStr(x.batch || '~', y.batch || '~') || cmpStr(x.vessel, y.vessel));
}

// ------------------------------------------------------------------ helpers

export function _now() {
  return nowIso().replace('T', ' ');
}

export function _when(s) {
  s = pyReplace(pyStrip(s || ''), 'T', ' ');
  if (!s) return _now();
  const t = fromIsoFormat310(s);
  if (!t) throw new EntryError(`Date/time not understood: ${s}`);
  const [y, mo, d, h, mi, se] = t;
  return `${y}-${p2(mo)}-${p2(d)} ${p2(h)}:${p2(mi)}:${p2(se)}`;
}

export function _check_date(db, when) {
  if (when.slice(0, 10) <= base_date(db)) {
    throw new EntryError(`Date must be after ${base_date(db)} (the end of the imported Vintrace history).`);
  }
  if (when.slice(0, 10) > addDays(today(), 1)) throw new EntryError('Date is in the future.');
}

export function _new_op(db, when, op_type, sub_type = null, treatment = null, operator = 'HARDCASTLE, Ken', notes = null) {
  const cur = db.run('INSERT INTO operation(occurred_at,op_type,sub_type,treatment,operator,notes,source,created_at) VALUES (?,?,?,?,?,?,?,?)',
    when, op_type, sub_type, treatment, operator, notes || null, 'app', _now());
  return cur.id;
}

export function _state_at(db, vid, when) {
  const st = vessel_state(db, when);
  return st.has(vid) ? st.get(vid) : null;
}

export function _later_ops(db, vid, when) {
  return db.val(`SELECT COUNT(*) FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE o.source='app' AND o.reversed=0
                         AND ov.vessel_id=? AND o.occurred_at>?`, vid, when);
}

const nn = v => v !== null && v !== undefined;   // Python "is not None"
const g0 = (b, k) => (_has(b, k) ? b[k] : null); // dict.get(k)

export function _vessel_row(db, op, vid, role, before, after_vol, batch_after = null, ts_after = null, tc_after = null, state = null) {
  const b = before || {};
  db.run(`INSERT INTO op_vessel(op_id,vessel_id,role,batch_id,batch_after_id,vol_before_l,vol_after_l,tax_class_before,tax_class_after,
                  tax_state_before,tax_state_after,product_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    op, vid, role, g0(b, 'batch_id'), nn(batch_after) ? batch_after : g0(b, 'batch_id'), _has(b, 'volume_l') ? b.volume_l : 0.0, after_vol,
    g0(b, 'tax_class'), nn(tc_after) ? tc_after : g0(b, 'tax_class'), g0(b, 'tax_state'),
    nn(ts_after) ? ts_after : g0(b, 'tax_state'), state);
}

export function _num(v, name, allow_zero = false, allow_neg = false) {
  let x, t = pyStrip(pyStr(v));
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');   // 1,200 or 12,500.5 = thousands separators
  else if (t.includes(',')) throw new EntryError(`${name}: use a decimal point, not a comma (e.g. 3.45).`);
  try {
    x = pyFloat(t);
  } catch (e) {
    throw new EntryError(`${name}: enter a number.`);
  }
  if (!Number.isFinite(x)) throw new EntryError(`${name}: enter a number.`);
  if ((x < 0 && !allow_neg) || (x === 0 && !allow_zero)) {
    throw new EntryError(`${name}: must be ${allow_zero ? '≥' : '>'} 0.`);
  }
  return x;
}

export function _tax_event(db, when, bid, cls, vol, kind, op, from_class = null) {
  if (vol && vol > 0.0005 && cls) {
    db.run("INSERT INTO tax_event(event_date,batch_id,tax_class,from_class,volume_l,kind,op_id,source) VALUES (?,?,?,?,?,?,?,'app')",
      when.slice(0, 10), bid, cls, from_class, vol, kind, op);
  }
}

// a correction replays many entries in one go: the end-of-day snapshots are rebuilt once at the end (correct.js)
let _defer = false;
export function deferSnapshots(on) { _defer = !!on; }

export function _finish(db, op) {
  if (!_defer) rebuild_snapshots(db);
  db.commit();
  return op;
}

// ------------------------------------------------------------------ operations

export function record_treatment(db, when, treatment, vessel_ids, notes = null) {
  when = _when(when); _check_date(db, when);
  if (!vessel_ids || !vessel_ids.length) throw new EntryError('Pick at least one vessel.');
  if (!treatment) throw new EntryError('Pick a treatment.');
  const op = _new_op(db, when, 'Treatment (Product)', 'Treatment', treatment, undefined, notes);
  for (const vid of vessel_ids) {
    const s = _state_at(db, vid, when);
    if (!s) throw new EntryError('A selected vessel is empty at that time.');
    _vessel_row(db, op, vid, 'to', s, s.volume_l);
  }
  return _finish(db, op);
}

// ------------------------------------------------------------------ plausibility limits (v0.9.1)
// Readings outside these ranges are refused with a hint. The ranges are wide enough for Hermit Woods' history
// (fruit wines, ciders, meads) and narrow enough to catch a wrong field, a missing decimal point or the wrong unit.
export const LIMITS = {
  Brix: [-5, 42, '°Bx'], SG: [0.98, 1.2, ''], pH: [2.5, 5.0, ''], TempC: [-10, 45, '°C'],
  'Free SO2': [0, 150, 'mg/L'], 'Total SO2': [0, 400, 'mg/L'], Alcohol: [0, 25, '% v/v'],
  'Titratable Acidity': [0, 30, 'g/L'], 'Volatile acidity': [0, 3, 'g/L'], 'Residual sugar': [0, 450, 'g/L'],
};
const METRIC_LABEL = { TempC: 'Temperature', 'Free SO2': 'Free SO₂', 'Total SO2': 'Total SO₂' };
const decimals = s => { const m = /\.(\d+)/.exec(String(s)); return m ? m[1].length : 0; };

export function check_reading(m, val, raw = '', temp_unit = 'C') {
  const lab = METRIC_LABEL[m] || m;
  const L = LIMITS[m];
  if (!L) return;
  let [lo, hi, u] = L;
  if (m === 'TempC' && temp_unit === 'F') { lo = 14; hi = 113; u = '°F'; }
  const range = `${lab} must be between ${lo} and ${hi}${u ? ' ' + u : ''}`;
  if (m === 'SG') {
    if (val >= 950 && val <= 1200) throw new EntryError(`SG ${raw}: looks like SG × 1000 — enter it as ${fx(val / 1000, 3)}.`);
    if (val > 1.2 && val <= 45) throw new EntryError(`SG ${raw}: looks like a Brix value — put it in the Brix field.`);
    if (val >= 0.9 && val < 0.98) throw new EntryError(`SG ${raw}: below any wine — missing a 9? (e.g. ${fx(0.99 + (val - 0.9) / 10, 4)})`);
  }
  if (m === 'Brix' && val >= 0.95 && val <= 1.2 && decimals(raw) >= 3) throw new EntryError(`Brix ${raw}: looks like a specific gravity — put it in the SG field.`);
  if (m === 'TempC' && temp_unit !== 'F' && val > 45 && val <= 120) throw new EntryError(`Temperature ${raw} °C is too hot for a ferment — if that is °F, switch the unit to °F.`);
  if (m === 'TempC' && temp_unit === 'F' && val >= -10 && val < 14) throw new EntryError(`Temperature ${raw} °F is below freezing for wine — if that is °C, switch the unit to °C.`);
  if (m === 'pH' && val >= 25 && val <= 50) throw new EntryError(`pH ${raw}: missing decimal point? (e.g. ${fx(val / 10, 2)})`);
  if (m === 'pH' && val >= 250 && val <= 500) throw new EntryError(`pH ${raw}: missing decimal point? (e.g. ${fx(val / 100, 2)})`);
  if (val < lo || val > hi) throw new EntryError(`${lab} ${raw}: out of range — ${range}.`);
}

// grams (or mL) per litre limits for an addition, by material kind; catches g/kg and mL/L mix-ups
export const DOSE_LIMITS = {
  sulfite: 1.5, sorbate: 1.0, yeast: 10, nutrient: 15, enzyme: 5, fining: 5, bacteria: 1, acid: 15,
  sugar: 800, honey: 1500,
};

export function check_dose(name, kind, base_unit, base_amt, volume_l) {
  if (!volume_l || volume_l <= 0) return;
  if (kind === 'water') {
    if (base_amt > Math.max(10 * volume_l, 500)) throw new EntryError(`${name}: ${fx(base_amt, 0)} L of water into ${fx(volume_l, 0)} L looks wrong — check the amount and unit.`);
    return;
  }
  const lim = DOSE_LIMITS[kind];
  if (!lim || (base_unit !== 'kg' && base_unit !== 'L')) return;
  const per = base_amt * 1000 / volume_l;   // g/L (or mL/L)
  if (per > lim) {
    const u = base_unit === 'kg' ? 'g/L' : 'mL/L';
    throw new EntryError(`${name}: that is ${fx(per, per < 10 ? 2 : 0)} ${u} in ${fx(volume_l, 0)} L — more than the ${lim} ${u} limit for ${kind}. Check the amount and unit (g vs kg, mL vs L).`);
  }
}

function _cap_check(db, vid, litres) {
  const cap = _row(db.one('SELECT capacity_l, code FROM vessel WHERE id=?', vid));
  if (cap.capacity_l && litres > cap.capacity_l * 1.02) {
    throw new EntryError(`${pyStr(cap.code)} holds ${fx(cap.capacity_l, 0)} L; it would reach ${fx(litres, 0)} L.`);
  }
}
export { _cap_check };

// readings: Map {vessel_id: Map|object {metric: value}} (a plain object is accepted too; Map keeps Python's dict order for int keys)
export function record_analysis(db, when, readings, notes = null, temp_unit = 'C') {
  when = _when(when); _check_date(db, when);
  const entries = o => (o instanceof Map ? [...o.entries()] : Object.entries(o).map(([k, v]) => [k, v]));
  const vkey = k => (typeof k === 'string' && /^-?\d+$/.test(k) ? Number(k) : k);
  let rd = entries(readings).map(([v, r]) => [vkey(v), entries(r).filter(([m, x]) => pyStrip(pyStr(x)) !== '')]);
  rd = rd.filter(([v, r]) => r.length);
  if (!rd.length) throw new EntryError('Enter at least one reading.');
  const units = Object.fromEntries(METRICS);
  for (const [, r] of rd) for (const [m] of r) if (!_has(units, m)) throw new EntryError(`Unknown reading: ${m}`);
  const op = _new_op(db, when, 'Analysis', 'Analysis', null, undefined, notes);
  for (const [vid, r] of rd) {
    const s = _state_at(db, vid, when);
    if (!s) throw new EntryError('A vessel with readings is empty at that time.');
    _vessel_row(db, op, vid, 'from', s, s.volume_l);
    for (const [m, x] of r) {
      let val = _num(x, METRIC_LABEL[m] || m, true, m === 'TempC' || m === 'Brix');
      check_reading(m, val, pyStr(x), temp_unit);
      if (m === 'TempC' && temp_unit === 'F') val = pyRoundFloat((val - 32) * 5 / 9, 2);
      db.run('INSERT INTO op_analysis(op_id,vessel_id,batch_id,metric,value,text_value,unit) VALUES (?,?,?,?,?,?,?)',
        op, vid, s.batch_id, m, val, pyStr(x), _has(units, m) ? units[m] : null);
    }
  }
  return _finish(db, op);
}

// Python round(x, n) for a float: correctly rounded on the exact binary value, exact ties to even
function pyRoundFloat(x, n) {
  if (!isFinite(x) || x === 0) return x;
  const [D, e] = exactDecimal(x);              // |x| = D * 10^e exactly
  const k = -e;
  if (k <= n) return x;
  const p = 10n ** BigInt(k - n), half = p / 2n;
  let q = D / p;
  const r = D % p;
  if (r > half || (r === half && q % 2n === 1n)) q += 1n;
  const ds = q.toString().padStart(n + 1, '0');
  const str = n > 0 ? ds.slice(0, ds.length - n) + '.' + ds.slice(ds.length - n) : ds;
  return Number((x < 0 ? '-' : '') + str);
}
// exact decimal expansion of |x| for a double: [BigInt digits, exponent] with |x| = digits * 10^exponent
function exactDecimal(x) {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  let e = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & ((1n << 52n) - 1n);
  if (e === 0) e = 1; else mant |= 1n << 52n;
  e -= 1075;                                   // |x| = mant * 2^e
  if (e >= 0) return [mant << BigInt(e), 0];
  return [mant * 5n ** BigInt(-e), e];         // mant / 2^-e = mant * 5^-e / 10^-e
}
export { pyRoundFloat };

export function suggest_volume_after(db, material_id, amount, unit, volume_before) {
  const r = _row(db.one('SELECT kind, base_unit FROM material WHERE id=?', material_id), true);
  const kind = r.kind;
  const u = _has(UNIT_TO_BASE, unit) ? UNIT_TO_BASE[unit] : null;
  if (!u) return volume_before;
  const qty = amount * u[1];
  if (kind === 'water' && u[0] === 'L') return volume_before + qty;
  if (_has(DISPLACEMENT_L_PER_KG, kind) && u[0] === 'kg') return volume_before + qty * DISPLACEMENT_L_PER_KG[kind];
  return volume_before;
}

// extra: further [material_id, amount, unit] lines added in the same operation (Vintrace "Multi additions")
export function record_addition(db, when, vessel_id, material_id, amount, unit, volume_after = null, notes = null, extra = [], lot = null) {
  when = _when(when); _check_date(db, when);
  const s = _state_at(db, vessel_id, when);
  if (!s) throw new EntryError('That vessel is empty at that time. Fill it (Intake / Transfer) first.');
  const lines = [[material_id, amount, unit, lot], ...(extra || [])];
  const parsed = lines.map(([mid, amt, un, lt], i) => {
    const m = db.one('SELECT id, name, kind, base_unit, stock_item_id FROM material WHERE id=?', mid);
    if (!m) throw new EntryError(i ? `Line ${i + 1}: pick a material.` : 'Pick a material.');
    const a = _num(amt, `${pyStr(m.name)} amount`);
    const u = _has(UNIT_TO_BASE, un) ? UNIT_TO_BASE[un] : null;
    if (!u || u[0] !== m.base_unit) throw new EntryError(`${pyStr(m.name)} is measured in ${pyStr(m.base_unit)}; pick a matching unit.`);
    const base_amt = a * u[1];
    check_dose(pyStr(m.name), m.kind, m.base_unit, base_amt, s.volume_l);
    return { m, amount: a, unit: un, base_amt, lot: pyStrip(pyStr(lt || '')).slice(0, 60) || null };
  });
  const va = pyStrip(pyStr(volume_after || '')) === '' ? s.volume_l : _num(volume_after, 'Volume after', false);
  _cap_check(db, vessel_id, va);
  if (va < s.volume_l * 0.9 - 1) throw new EntryError(`Volume after (${fx(va, 0)} L) is well below the ${fx(s.volume_l, 0)} L in the vessel — an addition doesn't remove wine; use Volume check for a loss.`);
  const op = _new_op(db, when, parsed.length > 1 ? 'Multi additions' : 'Additive', 'Addition', null, undefined, notes);
  _vessel_row(db, op, vessel_id, 'to', s, va);
  for (const { m, amount: amt, unit: un, base_amt, lot: lt } of parsed) {
    db.run('INSERT INTO op_addition(op_id,vessel_id,batch_id,material_id,amount,unit,amount_base,batch_volume_l,lot) VALUES (?,?,?,?,?,?,?,?,?)',
      op, vessel_id, s.batch_id, m.id, amt, un, base_amt, va, lt);
    if (m.stock_item_id) {   // draw the stock item down
      const su = _row(db.one('SELECT unit FROM stock_item WHERE id=?', m.stock_item_id)).unit;
      const key = `${pyStr(m.base_unit)}|${pyStr(su)}`;
      const f = _has(STOCK_UNIT_PER_BASE, key) ? STOCK_UNIT_PER_BASE[key] : null;
      if (f) {
        db.run("INSERT INTO stock_event(item_id,occurred_at,action,quantity,op_id,source) VALUES (?,?,?,?,?,'app')",
          m.stock_item_id, when, 'Consume', -base_amt * f, op);
      }
    }
  }
  if (s.tax_state === 'BONDED' && va > s.volume_l + 0.0005) {
    // water/sugar/honey added to declared wine increases Section A volume (reported as produced)
    _tax_event(db, when, s.batch_id, s.tax_class, va - s.volume_l, 'blended_into_bonded', op);
  }
  return _finish(db, op);
}

// v1.27 barrel group: one addition split across the barrels by their volume (an even split when the barrels match), as one operation
export function record_addition_group(db, when, vessel_ids, material_id, amount, unit, volume_after = null, notes = null, extra = [], lot = null, label = '') {
  when = _when(when); _check_date(db, when);
  const ss = vessel_ids.map(v => [v, _state_at(db, v, when)]).filter(([, s]) => s && s.volume_l > 0);
  if (!ss.length) throw new EntryError('None of the barrels in that group holds wine at that time.');
  const V = ss.reduce((t, [, s]) => t + s.volume_l, 0);
  const lines = [[material_id, amount, unit, lot], ...(extra || [])];
  const parsed = lines.map(([mid, amt, un, lt], i) => {
    const m = db.one('SELECT id, name, kind, base_unit, stock_item_id FROM material WHERE id=?', mid);
    if (!m) throw new EntryError(i ? `Line ${i + 1}: pick a material.` : 'Pick a material.');
    const a = _num(amt, `${pyStr(m.name)} amount`);
    const u = _has(UNIT_TO_BASE, un) ? UNIT_TO_BASE[un] : null;
    if (!u || u[0] !== m.base_unit) throw new EntryError(`${pyStr(m.name)} is measured in ${pyStr(m.base_unit)}; pick a matching unit.`);
    check_dose(pyStr(m.name), m.kind, m.base_unit, a * u[1], V);
    return { m, amount: a, unit: un, base_amt: a * u[1], lot: pyStrip(pyStr(lt || '')).slice(0, 60) || null };
  });
  const VA = pyStrip(pyStr(volume_after || '')) === '' ? V : _num(volume_after, 'Volume after', false);
  if (VA < V * 0.9 - 1) throw new EntryError(`Volume after (${fx(VA, 0)} L) is well below the ${fx(V, 0)} L in the barrels — an addition doesn't remove wine.`);
  const split = `split across ${ss.map(([v]) => _row(db.one('SELECT code FROM vessel WHERE id=?', v)).code).join(', ')} by volume`;
  const op = _new_op(db, when, parsed.length > 1 || ss.length > 1 ? 'Multi additions' : 'Additive', 'Addition', null, undefined, [notes, `${label ? label + ': ' : ''}${split}`].filter(Boolean).join(' · '));
  for (const [vid, s] of ss) {
    const w = s.volume_l / V, va = s.volume_l + (VA - V) * w;
    _cap_check(db, vid, va);
    _vessel_row(db, op, vid, 'to', s, va);
    for (const p of parsed)
      db.run('INSERT INTO op_addition(op_id,vessel_id,batch_id,material_id,amount,unit,amount_base,batch_volume_l,lot) VALUES (?,?,?,?,?,?,?,?,?)',
        op, vid, s.batch_id, p.m.id, p.amount * w, p.unit, p.base_amt * w, va, p.lot);
    if (s.tax_state === 'BONDED' && va > s.volume_l + 0.0005) _tax_event(db, when, s.batch_id, s.tax_class, va - s.volume_l, 'blended_into_bonded', op);
  }
  for (const p of parsed) if (p.m.stock_item_id) {
    const su = _row(db.one('SELECT unit FROM stock_item WHERE id=?', p.m.stock_item_id)).unit;
    const f = STOCK_UNIT_PER_BASE[`${pyStr(p.m.base_unit)}|${pyStr(su)}`];
    if (f) db.run("INSERT INTO stock_event(item_id,occurred_at,action,quantity,op_id,source) VALUES (?,?,?,?,?,'app')", p.m.stock_item_id, when, 'Consume', -p.base_amt * f, op);
  }
  return _finish(db, op);
}

// v1.27 barrel group: a new total volume; the difference is spread evenly over the barrels, as one operation
export function record_measurement_group(db, when, vessel_ids, new_total, reason, notes = null, label = '', needWhy = false) {
  when = _when(when); _check_date(db, when);
  const ss = vessel_ids.map(v => [v, _state_at(db, v, when)]).filter(([, s]) => s && s.volume_l > 0);
  if (!ss.length) throw new EntryError('None of the barrels in that group holds wine at that time.');
  const V = ss.reduce((t, [, s]) => t + s.volume_l, 0);
  const nv = _num(new_total, 'New volume', true);
  if (nv > V * 1.5 + 20) throw new EntryError(`${fx(nv, 0)} L is far above the ${fx(V, 0)} L on record — wine added? Use Transfer or Addition instead.`);
  const diff = V - nv, each = diff / ss.length;
  if (needWhy && Math.abs(diff) > 0.0005 && !String(notes || '').trim()) throw new EntryError('Say why the volume changed (the Why box) — e.g. racked off the lees, re-dipped after settling.');
  reason = String(reason || '').trim() || 'Correction';
  const dir = reason_dir(reason);
  if (diff > 0.0005 && dir === 'gain') throw new EntryError(`"${reason}" is a reason for a gain, but the volume goes down by ${fx(diff, 1)} L. Pick a loss reason (or Correction).`);
  if (diff < -0.0005 && dir === 'loss') throw new EntryError(`"${reason}" is a reason for a loss, but the volume goes up by ${fx(-diff, 1)} L. Pick Correction or a gain reason.`);
  for (const [vid, s] of ss) { if (s.volume_l - each < 0) throw new EntryError(`${_row(db.one('SELECT code FROM vessel WHERE id=?', vid)).code} would go below empty.`); _cap_check(db, vid, s.volume_l - each); }
  const op = _new_op(db, when, 'Measurement', 'Adjustment', null, undefined, [notes, `${label ? label + ': ' : ''}${fx(Math.abs(diff), 1)} L ${diff >= 0 ? 'loss' : 'gain'} spread evenly over ${ss.length} barrels`].filter(Boolean).join(' · '));
  for (const [vid, s] of ss) {
    _vessel_row(db, op, vid, 'to', s, s.volume_l - each);
    if (each > 0.0005) db.run('INSERT INTO op_loss(op_id,vessel_id,batch_id,volume_l,reason,gain) VALUES (?,?,?,?,?,0)', op, vid, s.batch_id, each, reason);
    else if (each < -0.0005) {
      db.run('INSERT INTO op_loss(op_id,vessel_id,batch_id,volume_l,reason,gain) VALUES (?,?,?,?,?,1)', op, vid, s.batch_id, -each, reason);
      if (s.tax_state === 'BONDED') _tax_event(db, when, s.batch_id, s.tax_class, -each, /water addition/i.test(reason) ? 'amelioration' : 'inventory_gain', op);
    }
  }
  return _finish(db, op);
}

export function record_transfer(db, when, from_id, to_id, volume, loss = 0, loss_reason = null, empty_source = false, result_batch_id = null,
  result_state = null, op_type = 'Transfer', notes = null, treatment = null) {
  when = _when(when); _check_date(db, when);
  if (op_type === 'Rack & Return' && (!to_id || to_id === from_id)) return record_rack_return(db, when, from_id, loss, loss_reason, treatment, notes);
  if (from_id === to_id) throw new EntryError('From and to vessels are the same.');
  if (!to_id) throw new EntryError('Pick the vessel it goes to.');
  const s = _state_at(db, from_id, when);
  if (!s) throw new EntryError('The source vessel is empty at that time.');
  const t = _state_at(db, to_id, when);
  loss = _num(loss || 0, 'Loss', true);
  let vol;
  if (empty_source) {
    vol = s.volume_l - loss;
    if (vol <= 0) throw new EntryError('Loss is larger than the source volume.');
  } else {
    vol = _num(volume, 'Volume moved');
  }
  if (vol + loss > s.volume_l + 0.01) throw new EntryError(`Only ${fx(s.volume_l, 0)} L in the source vessel.`);
  const cap = _row(db.one('SELECT capacity_l, code FROM vessel WHERE id=?', to_id));
  const t_vol = t ? t.volume_l : 0.0;
  if (cap.capacity_l && t_vol + vol > cap.capacity_l * 1.02) {
    throw new EntryError(`${pyStr(cap.code)} holds ${fx(cap.capacity_l, 0)} L; it would reach ${fx(t_vol + vol, 0)} L.`);
  }
  // resulting batch and tax state at the destination
  let rb, rs, rc;
  if (t) {
    rb = result_batch_id ? pyInt(result_batch_id) : t.batch_id;
    rs = result_state || t.tax_state;
    rc = t.tax_state === 'BONDED' ? t.tax_class : s.tax_class;
  } else {
    rb = result_batch_id ? pyInt(result_batch_id) : s.batch_id;
    rs = result_state || s.tax_state;
    rc = s.tax_class;
  }
  if (rs === 'BONDED' && !rc) throw new EntryError('The result would be declared wine without a tax class; declare it first.');
  let src_after = s.volume_l - vol - loss;
  if (src_after < 0.05) src_after = 0.0;
  const op = _new_op(db, when, op_type, 'Transfer', treatment || null, undefined, notes);
  _vessel_row(db, op, from_id, 'from', s, src_after);
  _vessel_row(db, op, to_id, 'to', t, t_vol + vol, rb, rs, rs === 'BONDED' ? rc : null);
  if (loss > 0) {
    db.run('INSERT INTO op_loss(op_id,vessel_id,batch_id,volume_l,reason) VALUES (?,?,?,?,?)', op, from_id, s.batch_id, loss, loss_reason || 'Operation Loss');
  }
  // TTB: movement of wine across the declared / undeclared line
  const src_b = s.tax_state === 'BONDED';
  const dst_b = rs === 'BONDED';
  if (!src_b && dst_b) _tax_event(db, when, rb, rc, vol, 'blended_into_bonded', op);
  if (dst_b && t && t.tax_state !== 'BONDED') _tax_event(db, when, rb, rc, t_vol, 'declared', op);   // undeclared contents of destination declared by this blend
  if (src_b && !dst_b) _tax_event(db, when, s.batch_id, s.tax_class, vol, 'undeclared', op);
  if (src_b && dst_b && s.tax_class !== rc) _tax_event(db, when, rb, rc, vol, 'class_change', op, s.tax_class);
  return _finish(db, op);
}

// Rack & Return / filter in place: the wine goes out (to a temporary vessel or through a filter) and back into the same vessel.
// Only the loss changes the vessel.
export function record_rack_return(db, when, vid, loss, loss_reason, treatment = null, notes = null) {
  when = _when(when); _check_date(db, when);
  const s = _state_at(db, vid, when);
  if (!s) throw new EntryError('That vessel is empty at that time.');
  loss = _num(loss || 0, 'Loss', true);
  if (loss >= s.volume_l) throw new EntryError(`Loss (${fx(loss, 0)} L) is not less than the ${fx(s.volume_l, 0)} L in the vessel.`);
  const op = _new_op(db, when, 'Rack & Return', 'Transfer', treatment || null, undefined, notes);
  _vessel_row(db, op, vid, 'from', s, s.volume_l - loss);
  if (loss > 0) db.run('INSERT INTO op_loss(op_id,vessel_id,batch_id,volume_l,reason) VALUES (?,?,?,?,?)', op, vid, s.batch_id, loss, loss_reason || 'Lees');
  return _finish(db, op);
}

// Volume adjustment (dip / volume check), Vintrace's "Measured … with loss/gain of … | Reason". The new volume is what is in
// the vessel now. A drop is a loss and a rise is a gain, each with a reason from ADJUST_REASONS; both are kept in op_loss
// (gain=1 for a rise) so they show on the batch's Losses & gains tab. TTB on declared wine: a rise is an inventory gain (line 9),
// except "TTB - Water addition" (produced by amelioration, line 6); drops go to line 23/24/29 for the TTB reasons, else line 30.
export function record_measurement(db, when, vessel_id, new_volume, reason, notes = null, needWhy = false) {
  when = _when(when); _check_date(db, when);
  const s = _state_at(db, vessel_id, when);
  if (!s) throw new EntryError('That vessel is empty at that time.');
  const nv = _num(new_volume, 'New volume', true);
  _cap_check(db, vessel_id, nv);
  if (nv > s.volume_l * 1.5 + 20) throw new EntryError(`${fx(nv, 0)} L is far above the ${fx(s.volume_l, 0)} L on record — wine added? Use Transfer, Addition or Fill instead.`);
  const diff = s.volume_l - nv;   // > 0 loss, < 0 gain
  if (needWhy && Math.abs(diff) > 0.0005 && !String(notes || '').trim()) throw new EntryError('Say why the volume changed (the Why box) — e.g. racked off the lees, re-dipped after settling.');
  reason = String(reason || '').trim() || 'Correction';
  const dir = reason_dir(reason);
  if (diff > 0.0005 && dir === 'gain') throw new EntryError(`"${reason}" is a reason for a gain, but the volume goes down by ${fx(diff, 1)} L. Pick a loss reason (or Correction).`);
  if (diff < -0.0005 && dir === 'loss') throw new EntryError(`"${reason}" is a reason for a loss, but the volume goes up by ${fx(-diff, 1)} L. Pick Correction or a gain reason.`);
  const op = _new_op(db, when, 'Measurement', 'Adjustment', null, undefined, notes);
  _vessel_row(db, op, vessel_id, 'to', s, nv);
  if (diff > 0.0005) {
    db.run('INSERT INTO op_loss(op_id,vessel_id,batch_id,volume_l,reason,gain) VALUES (?,?,?,?,?,0)', op, vessel_id, s.batch_id, diff, reason);
  } else if (diff < -0.0005) {
    db.run('INSERT INTO op_loss(op_id,vessel_id,batch_id,volume_l,reason,gain) VALUES (?,?,?,?,?,1)', op, vessel_id, s.batch_id, -diff, reason);
    if (s.tax_state === 'BONDED') _tax_event(db, when, s.batch_id, s.tax_class, -diff, /water addition/i.test(reason) ? 'amelioration' : 'inventory_gain', op);
  }
  return _finish(db, op);
}

// Declare wine (fermentation complete): it moves from Part VII (in fermenters) into Section A as 'produced by fermentation'.
export function record_declare(db, when, vessel_ids, tax_class, notes = null) {
  when = _when(when); _check_date(db, when);
  if (!TAX_CLASSES.some(([k]) => k === tax_class)) throw new EntryError('Pick a tax class.');
  if (!vessel_ids || !vessel_ids.length) throw new EntryError('Pick at least one vessel.');
  const op = _new_op(db, when, 'Declare', 'TaxStateChange', null, undefined, notes);
  for (const vid of vessel_ids) {
    const s = _state_at(db, vid, when);
    if (!s) throw new EntryError('A selected vessel is empty.');
    if (s.tax_state === 'BONDED') {
      if (s.tax_class !== tax_class) {
        _vessel_row(db, op, vid, 'to', s, s.volume_l, null, null, tax_class);
        _tax_event(db, when, s.batch_id, tax_class, s.volume_l, 'class_change', op, s.tax_class);
      }
      continue;
    }
    _vessel_row(db, op, vid, 'to', s, s.volume_l, null, 'BONDED', tax_class);
    _tax_event(db, when, s.batch_id, tax_class, s.volume_l, 'declared', op);
  }
  return _finish(db, op);
}

export function create_batch(db, code, description, vintage, beverage_type, base_ingredient, variety, region, notes = null) {
  code = pyStrip(code || '');
  if (!code) throw new EntryError('Batch code is required (e.g. 26NecTom).');
  if (!/[A-Za-z]/.test(code)) throw new EntryError(`Batch code "${code}" has no name — use the year then a name, e.g. 26Rhubarb2.`);
  if (db.one('SELECT 1 FROM batch WHERE code=?', code)) throw new EntryError(`Batch ${code} already exists.`);
  let y = null;
  try {
    y = pyInt(Array.from(pyStr(vintage)).slice(0, 4).join(''));
  } catch (e) {
    if (e.pyType !== 'ValueError') throw e;
  }
  const cur = db.run('INSERT INTO batch(code,description,vintage,production_year,beverage_type,base_ingredient,variety,region,notes) VALUES (?,?,?,?,?,?,?,?,?)',
    code, description || null, vintage || null, y, beverage_type || null, base_ingredient || null, variety || null, region || null, notes || null);
  db.commit();
  return cur.id;
}

// Fruit (kg/lb), honey (kg/lb) or bulk juice/cider (L/gal). Optionally put must/juice into a vessel (starts the batch there).
export function record_intake(db, when, kind, batch_id, variety, supplier, region, amount, unit, docket = null, vessel_id = null, fill_litres = null, notes = null, booking_no = null, cost = null) {
  when = _when(when); _check_date(db, when);
  if (!['fruit', 'honey', 'bulk'].includes(kind)) throw new EntryError('Pick fruit or bulk juice/cider.');
  if (kind === 'honey') throw new EntryError('Honey is kept as a material now — receive it on the Materials page (Honey → Received).');
  if (!batch_id && (kind === 'bulk' || vessel_id)) throw new EntryError(kind === 'bulk' ? 'Pick (or create) the batch this juice/cider goes into.' : 'Pick the batch for fruit/honey going into a vessel (leave vessel blank to hold it on hand).');
  amount = _num(amount, 'Amount');
  if (unit === 'lb') { amount = amount * 0.45359237; unit = 'kg'; }
  if (unit === 'gal') { amount = amount * GAL; unit = 'L'; }
  if ((kind === 'fruit' || kind === 'honey') && unit !== 'kg') throw new EntryError('Fruit and honey are recorded by weight (kg or lb).');
  if (kind === 'bulk' && unit !== 'L') throw new EntryError('Bulk juice/cider is recorded by volume (L or gal).');
  const IMAX = { fruit: 20000, honey: 3000, bulk: 20000 };
  if (amount > IMAX[kind]) throw new EntryError(`${fx(amount, 0)} ${unit} in one delivery is more than the ${IMAX[kind]} ${unit} limit — check the amount and unit.`);
  const cst = pyStrip(pyStr(cost || '')) === '' ? null : _num(pyStrip(pyStr(cost)).replace(/^\$/, ''), 'Cost', true);
  if (cst !== null && cst > 100000) throw new EntryError('Cost over $100,000 for one delivery looks wrong.');
  const op = _new_op(db, when, kind !== 'bulk' ? 'Intake delivery' : 'Bulk intake', 'Intake', null, undefined, notes);
  db.run("INSERT INTO intake(occurred_at,kind,batch_id,vessel_id,variety,supplier,region,vintage,amount,unit,docket,notes,source,op_id,booking_no,cost,cost_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'app',?,?,?,?)",
    when, kind, batch_id || null, vessel_id || null, variety || null, supplier || null, region || null, pyInt(when.slice(0, 4)), amount, unit, docket || null, notes || null, op,
    pyStrip(pyStr(booking_no || '')) || null, cst, cst !== null ? 'Total $' : null);
  let litres = null;
  if (kind === 'bulk' && vessel_id) {
    litres = amount;
  } else if (vessel_id && pyStrip(pyStr(fill_litres || ''))) {
    litres = _num(fill_litres, 'Litres into vessel');
  }
  if (vessel_id && litres) {
    const t = _state_at(db, pyInt(vessel_id), when);
    if (t && t.batch_id !== pyInt(batch_id)) throw new EntryError('That vessel holds another batch; use an empty vessel or one holding this batch.');
    const cap = _row(db.one('SELECT capacity_l, code FROM vessel WHERE id=?', vessel_id));
    const nv = (t ? t.volume_l : 0) + litres;
    if (cap.capacity_l && nv > cap.capacity_l * 1.02) {
      throw new EntryError(`${pyStr(cap.code)} holds ${fx(cap.capacity_l, 0)} L; it would reach ${fx(nv, 0)} L.`);
    }
    _vessel_row(db, op, pyInt(vessel_id), 'to', t, nv, pyInt(batch_id), g0(t || {}, 'tax_state') || 'NON_DECLARED', g0(t || {}, 'tax_class'));
  }
  return _finish(db, op);
}

// Undo an app operation. Allowed only if no later app operation touches the same vessels.
export function reverse_operation(db, op_id) {
  const o = db.one('SELECT occurred_at, source, reversed FROM operation WHERE id=?', op_id);
  if (!o) throw new EntryError('No such operation.');
  if (o.source !== 'app') throw new EntryError('Imported Vintrace history cannot be reversed here.');
  if (o.reversed) throw new EntryError('Already reversed.');
  for (const vid of db.col('SELECT DISTINCT vessel_id FROM op_vessel WHERE op_id=?', op_id)) {
    const n = db.val(`SELECT COUNT(*) FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE o.source='app' AND o.reversed=0 AND ov.vessel_id=?
                          AND (o.occurred_at>? OR (o.occurred_at=? AND o.id>?))`, vid, o.occurred_at, o.occurred_at, op_id);
    if (n) {
      const code = _row(db.one('SELECT code FROM vessel WHERE id=?', vid)).code;
      throw new EntryError(`${pyStr(code)} has later operations; reverse those first.`);
    }
  }
  db.run('UPDATE operation SET reversed=1 WHERE id=?', op_id);
  db.run("UPDATE dispatch SET reversed=1 WHERE source='app' AND reference=?", `op:${op_id}`);
  db.run("DELETE FROM tax_event WHERE op_id=? AND source='app'", op_id);
  db.run("DELETE FROM stock_event WHERE op_id=? AND source='app'", op_id);
  db.run("UPDATE intake SET reversed=1 WHERE source='app' AND op_id=?", op_id);
  rebuild_snapshots(db);
  db.commit();
}

// v1.62: Press (Vintrace's "Press cycle"): must from its tank through the press, juice into a vessel. With "press done" ticked the
// must tank is emptied: litres on record − juice out = press loss (reason "Press"); juice above the litres on record is booked as a
// press gain first (volume adjustment, reason "Press"). Without it (e.g. free run now, pressings later) only the juice moves.
// The press used and the fraction (Combined / Free Run / Pressings …) are kept in the operation's details, as Vintrace did.
export const PRESSES = ['450L Press', '60L Press', 'Hand press (strainer bags)'];
export const FRACTIONS = ['Combined', 'Free Run', 'Pressings', 'Pressings (Light)'];
export function record_press(db, when, from_id, dests, done = true, press = null, fraction = 'Combined', result_batch_id = null, notes = null) {
  // dests: [[to_id, juice litres], …] — one press can fill several containers (v1.63); one Press cycle per container
  when = _when(when); _check_date(db, when);
  if (!from_id) throw new EntryError('Pick the tank the must is in.');
  dests = (dests || []).filter(([v, l]) => v || String(l || '').trim() !== '');
  if (!dests.length) throw new EntryError('Pick the vessel the juice goes into.');
  const seen = new Set();
  dests = dests.map(([v, l], k) => {
    v = pyInt(v || 0);
    if (!v) throw new EntryError(`Container ${k + 1}: pick the vessel.`);
    if (v === from_id) throw new EntryError('The juice must go into a different vessel than the must tank.');
    if (seen.has(v)) throw new EntryError('The same container is listed twice — put its total in one line.');
    seen.add(v);
    const n = _num(l, `Juice into container ${k + 1}`);
    if (!(n > 0)) throw new EntryError(`Container ${k + 1}: enter the litres of juice.`);
    return [v, n];
  });
  const s = _state_at(db, from_id, when);
  if (!s) throw new EntryError('The must tank is empty at that time.');
  const total = dests.reduce((t, [, n]) => t + n, 0);
  for (const [v, n] of dests) {
    const t = _state_at(db, v, when), cap = _row(db.one('SELECT capacity_l, code FROM vessel WHERE id=?', v)), tv = t ? t.volume_l : 0;
    if (cap.capacity_l && tv + n > cap.capacity_l * 1.02) throw new EntryError(`${pyStr(cap.code)} holds ${fx(cap.capacity_l, 0)} L; it would reach ${fx(tv + n, 0)} L.`);
  }
  if (!done && total > s.volume_l + 0.01) throw new EntryError(`Only ${fx(s.volume_l, 0)} L on record in the must tank — tick "press done" to book the extra as a press gain.`);
  if (done && total > s.volume_l * 1.5 + 20) throw new EntryError(`${fx(total, 0)} L of juice is far above the ${fx(s.volume_l, 0)} L on record for the must — check the numbers.`);
  if (done && total > s.volume_l + 0.005) record_measurement(db, when, from_id, total, 'Press', 'Press gain: more juice than the litres on record for the must');
  const det = JSON.stringify({ fractionType: fraction || 'Combined', press: press || null });
  let first = null;
  dests.forEach(([v, n], k) => {
    const last = k === dests.length - 1;
    const left = _state_at(db, from_id, when).volume_l;
    const loss = done && last ? Math.max(0, left - n) : 0;   // the pomace is booked once, on the last container
    const op = record_transfer(db, when, from_id, v, n, loss, 'Press', false, result_batch_id || null, null, 'Press cycle', notes || null, null);
    db.run('UPDATE operation SET details=? WHERE id=?', det, op);
    if (first === null) first = op;
  });
  db.commit();
  return first;
}
