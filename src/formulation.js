// Port of formulation.py — formulations and additions, the engine.
//
// Formulation model (Ken's formulation page; checked against HWRecipes25, 45 of 47 tabs reproduce to the sheet's digits):
//   gal = L / lPerGal;  fruit = gal × fruitLbPerGal;  juice = fruit × juiceGalPerLb;  Bf = BrixFruit × juice / gal
//   Bs = BrixDesired − Bf;  sweetener lb = Bs × gal × factor / 16;  volume = lb × sugarVol (sugar) or lb / honeyLbPerGal (honey)
//   water (cider gallons on cider tabs) = gal − juice − volume
//   OG = SG(Bf) + SG(Bs) − 1, with the sheets' own Brix→SG polynomial;  ABV = (OG−FG)/0.0074 and 76.08(OG−FG)/(1.775−OG) × FG/0.794
// Doses: HW winemaking cookbook, BASIC ADDS (cookbook is the master; KMS at 0.576 g SO2 per g).
import { fxc, fg as fmt_g } from './lib/py.js';
import { formulation as S } from './gen/strings.js';

export const SCHEMA = S.SCHEMA;
// key: [default, label, unit, note, group]
import { SO2_CONSTANTS } from './so2const.js';
export const CONSTANTS = Object.assign({}, S.CONSTANTS, SO2_CONSTANTS);   // v1.30: SO₂ group
export const FIELDS = S.FIELDS;
// v1.14 masters: one current, undated recipe per prototype wine (is_master=1, retired_at NULL); promoting a batch's formulation
// writes a new master version and retires the old one (kept, with retired_at). derived_from = the formula a row was made from.
export const NEW_COLS = S.NEW_COLS.concat([['is_master', 'INTEGER DEFAULT 0'], ['master_version', 'INTEGER'], ['derived_from', 'INTEGER'], ['retired_at', 'TEXT'], ['fruit_mix', 'TEXT']]);   // v1.20 fruit_mix: JSON [{fruit, pct}]
export const CATEGORIES = S.CATEGORIES;
export const SWEETENERS = S.SWEETENERS;
export const DEFAULT_SWEETENER = S.DEFAULT_SWEETENER;
// Families Ken settled on 2026-10-01 (his answers to the grouping questions)
export const CONFIRMED_FAMILIES = S.CONFIRMED_FAMILIES;
// ---- JavaScript twin of calc() for live editing (kept identical; verified against calc() in tests)
export const JS_CALC = S.JS_CALC;
// ---- planned vs actual (from the cellar records of a linked batch)
export const LB = S.LB;
export const GAL = S.GAL;

// ------------------------------------------------------------------ Python-compatibility helpers (shared with ui_formula.js)
export class ValueError extends Error {}
export class TypeError_ extends Error {}
export class ZeroDivisionError extends Error {}
export class OverflowError extends Error {}

// Python float/int "type" of numbers that came from Python-typed sources: container -> Set of keys holding a Python float.
// JS numbers can't tell 12 from 12.0; this registry lets str()/json.dumps print '12.0' where Python would.
export const PYFLOATS = new WeakMap();
export function markFloat(obj, key) {
  let s = PYFLOATS.get(obj);
  if (!s) PYFLOATS.set(obj, (s = new Set()));
  s.add(String(key));
}
export function isPyFloat(obj, key) {
  const v = obj[key];
  if (typeof v !== 'number') return false;
  if (!Number.isInteger(v)) return true;
  const s = PYFLOATS.get(obj);
  return !!(s && s.has(String(key)));
}

// str.isspace() characters (Python), for strip()
const PYWS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP_RE = new RegExp(`^[${PYWS}]+|[${PYWS}]+$`, 'g');
export function pyStrip(s) {
  return String(s).replace(STRIP_RE, '');
}

// repr(str)
const NONPRINT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
export function pyRepr(s) {
  s = String(s);
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && NONPRINT.test(ch)) {
      if (cp < 0x100) out += '\\x' + cp.toString(16).padStart(2, '0');
      else if (cp < 0x10000) out += '\\u' + cp.toString(16).padStart(4, '0');
      else out += '\\U' + cp.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + q;
}

function pyTypeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'object') return 'dict';
  return typeof v;
}

// float(v): numbers as they are, bools 1.0/0.0, strings parsed like Python (whitespace, underscores, inf/nan); else ValueError/TypeError
const FLOAT_RE = /^[+-]?(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
export function pyFloat(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') throw new TypeError_(`float() argument must be a string or a real number, not '${pyTypeName(v)}'`);
  const t = pyStrip(v);
  if (FLOAT_RE.test(t)) return Number(t.replace(/_/g, ''));
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
  if (m) return m[2].toLowerCase() === 'nan' ? NaN : (m[1] === '-' ? -Infinity : Infinity);
  throw new ValueError(`could not convert string to float: ${pyRepr(v)}`);
}

// int(v): strings in base 10, floats truncated
export function pyInt(v) {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) throw new ValueError('cannot convert float NaN to integer');
    if (!isFinite(v)) throw new OverflowError('cannot convert float infinity to integer');
    return Math.trunc(v);
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${pyTypeName(v)}'`);
  const t = pyStrip(v);
  if (/^[+-]?\d(?:_?\d)*$/.test(t)) return Number(t.replace(/_/g, ''));
  throw new ValueError(`invalid literal for int() with base 10: ${pyRepr(v)}`);
}

// a / b that raises like Python on a zero divisor (only used where the Python code has no guard)
function div(a, b) {
  if (b === 0) throw new ZeroDivisionError('float division by zero');
  return a / b;
}

// Python max(a, b): returns a unless b > a
function pmax(a, b) {
  return b > a ? b : a;
}

// ------------------------------------------------------------------ engine
export function sg(b) {
  return 1.000898 + 0.003859118 * b + 0.00001370735 * b * b + 0.00000003742517 * b * b * b;
}

export function ensure_schema(db) {
  db.script(SCHEMA);
  db.run('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT)');
  // v1.15: Core (made most years) vs Occasional, per prototype wine; a wine not listed is Occasional
  db.run('CREATE TABLE IF NOT EXISTS wine_tier(family TEXT PRIMARY KEY, tier TEXT NOT NULL, updated_at TEXT)');
  const have = new Set(db.columns('formula'));
  for (const [col, typ] of NEW_COLS) {
    if (!have.has(col)) db.run(`ALTER TABLE formula ADD COLUMN ${col} ${typ}`);
  }
  // v0.4 used type = sugar | honey | cider; move to category (Fruit wine / Mead / Cider) + sweetener (sugar / honey / none)
  for (const r of db.all('SELECT id, type, sweetener, factor FROM formula WHERE category IS NULL')) {
    const cat = r.type === 'cider' ? 'Cider' : r.type === 'honey' ? 'Mead' : 'Fruit wine';
    const sw = r.type === 'honey' ? 'honey' : (r.factor ? 'sugar' : 'none');
    db.run("UPDATE formula SET category=?, sweetener=?, model=COALESCE(model,'brix'), liquid=? WHERE id=?",
      cat, sw, r.type === 'cider' ? 'cider' : 'water', r.id);
  }
  db.commit();
}

// import_history(db, json_path), regroup(db, json_path) and seed(db, json_path) load the seed JSON files from disk:
// they run on the laptop (Python app), not in the Worker.

export function constants(db) {
  const c = {};
  for (const [k, v] of Object.entries(CONSTANTS)) c[k] = v[0];   // defaults keep their Python type (int literals stay ints)
  try {
    for (const r of db.all('SELECT key, value FROM app_constant')) {
      const k = r.key, v = r.value;
      if (Object.prototype.hasOwnProperty.call(c, k) && v !== null && v !== undefined) {
        c[k] = v;
        markFloat(c, k);   // REAL column: Python reads a float
      }
    }
  } catch (e) {
    /* no app_constant table */
  }
  return c;
}

export function save_constants(db, values) {
  for (const [k, v] of Object.entries(values)) {
    if (Object.prototype.hasOwnProperty.call(CONSTANTS, k)) db.run('INSERT OR REPLACE INTO app_constant VALUES (?,?)', k, pyFloat(v));
  }
  db.commit();
}

export function reset_constants(db) {
  db.run('DELETE FROM app_constant');
  db.commit();
}

export function brix_of_sg(s) {
  // Inverse of sg(): °Brix for a specific gravity (Newton's method on the same polynomial).
  let b = (s - 1) * 259;
  for (let i = 0; i < 30; i++) {
    const d = 0.003859118 + 2 * 0.00001370735 * b + 3 * 0.00000003742517 * b * b;
    const nb = b - div(sg(b) - s, d);
    if (Math.abs(nb - b) < 1e-9) break;
    b = nb;
  }
  return b;
}

export function calc(f, C) {
  // f: mapping with the FIELDS plus type/sweetener. Returns every derived number the formulation page shows.
  const g = k => (f[k] !== null && f[k] !== undefined && f[k] !== '' ? pyFloat(f[k]) : 0.0);
  const sweet = f.sweetener ?? null;
  const L = g('target_l');
  const gal = C.lPerGal ? L / C.lPerGal : 0;
  const fruit = gal * g('fruit_lb_per_gal');
  const juice = fruit * g('juice_gal_per_lb');
  const bf = gal ? g('brix_fruit') * juice / gal : 0;
  let bs = g('brix_desired') - bf;
  const factor = g('factor');
  const honey = sweet === 'honey' || (sweet === null && f.type === 'honey');
  const lsg = g('liquid_sg');
  let bcl = 0.0, bc = 0.0;
  let lb, vol, water, og;
  if (lsg) {   // cider (or juice) is the liquid instead of water: its own sugar counts toward the OG
    bcl = brix_of_sg(lsg);
    const k = honey ? div(1, C.honeyLbPerGal) : C.sugarVol;
    lb = 0.0;
    if (factor && sweet !== 'none' && gal) {
      lb = pmax(div(((g('brix_desired') - bf) * gal - bcl * (gal - juice)) * factor / 16, 1 - bcl * k * factor / 16), 0.0);
    }
    vol = lb * k;
    water = gal - juice - vol;
    bc = gal ? bcl * water / gal : 0;
    bs = lb ? lb * 16 / (gal * factor) : 0.0;
    og = sg(bf + bc + bs);   // Brix adds up; pure cider gives exactly its own SG
  } else {
    lb = factor && sweet !== 'none' ? bs * gal * factor / 16 : 0.0;
    vol = honey ? div(lb, C.honeyLbPerGal) : lb * C.sugarVol;
    water = gal - juice - vol;
    og = sg(bf) + sg(bs) - 1;
  }
  const fg = g('fg');
  const abv = (og - fg) / 0.0074;
  const abv2 = og !== 1.775 ? (76.08 * (og - fg) / (1.775 - og)) * (fg / 0.794) : null;
  const bottles = C.bottleL ? L / C.bottleL : 0;
  return {
    gal, fruit, juice, bf, bs, sgf: sg(bf), sgs: sg(bs), lb, vol, water,
    water_l: water * C.lPerGal, og, abv, abv2, bottles, cases: bottles / 12,
    boxes: C.boxLb ? fruit / C.boxLb : 0, honey, bcl, bc, sgc: sg(bc),
  };
}

export function doses(V, C, cider = false) {
  // Cookbook BASIC ADDS scaled to V litres. Returns rows: key, name, rate (constant key), dose, unit, material name, note.
  const k = C.kmsSO2 || 0.576;
  const nut = C.fermaidK * (cider ? C.ciderNutrient : 1);
  const gof = V * C.goferm;
  return [
    ['kmsStart', 'KMS at start', 'kmsStartPpm', V * C.kmsStartPpm / 1000 / k, 'g', 'KMS', 'Free SO₂ at the start. Order from BSG.'],
    ['pecHC', 'Pectic enzyme Scottzyme HC', 'pecHC', V / 100 * C.pecHC, 'mL', 'Pec Enzyme HC', 'Order from Scott Labs.'],
    ['pec5L', 'Pectic enzyme Scottzyme Pec5L', 'pec5L', V / 100 * C.pec5L, 'mL', 'Pec Enzyme PEC5L', 'Order from Scott Labs.'],
    ['yeast', 'Yeast', 'yeast', V * C.yeast, 'g', null, 'Pitch the slurry once it is within 10 °C (18 °F) of the must.'],
    ['goferm', 'GoFerm (hydration nutrient)', 'goferm', gof, 'g', 'Go Ferm Protect Evo', `Hydrate in ${fxc(gof * C.gofermWater, 2)} L water at 40–43 °C; pitch yeast at 35–40 °C, wait 20 min, add product over 5 min.`],
    ['fk1', 'FermaidK — first addition' + (cider ? ' (cider, half)' : ''), 'fermaidK', V * nut, 'g', 'nutrient', 'Typically with the first sugar, once the yeast have started.' + (cider ? ' Ciders: half nutrient, before pitch.' : '')],
    ['fk2', 'FermaidK — second addition' + (cider ? ' (cider, half)' : ''), 'fermaidK', V * nut, 'g', 'nutrient', `Total for the batch ${fxc(2 * V * nut, 0)} g.`],
    ['bent', 'Bentonite', 'bentonite', V * C.bentonite, 'g', 'Bentonite', `Near the end of fermentation; blend in ${fxc(V * C.bentonite * 10, 0)} mL warm water.`],
    ['kmsEnd', 'KMS at end of fermentation', 'kmsEndPpm', V * C.kmsEndPpm / 1000 / k, 'g', 'KMS', 'Free SO₂ at the end of fermentation.'],
    ['so2', 'SO₂ addition (as KMS)', 'so2Ppm', V * C.so2Ppm / 1000 / k, 'g', 'KMS', 'Set the ppm from pH below.'],
    ['sorb', 'Potassium sorbate', 'sorbate', V * C.sorbate * 1.25, 'g', 'KSorbate', 'Rate is sorbate; dose is K-sorbate (× 1.25).'],
  ];
}

export function free_so2(ph, mol) {
  return mol * (1 + 10 ** (ph - 1.81));
}

export function backsweeten(V, gpl, brix) {
  // Cookbook: g = g/L × V; juice L = g / (Brix × 10). Dilution-corrected: V × D / (10·Brix − D).
  const g = gpl * V;
  const simple = brix ? g / (brix * 10) : null;
  const exact = brix * 10 > gpl ? V * gpl / (brix * 10 - gpl) : null;
  return [g, simple, exact];
}

export function actuals(db, batch_id) {
  // What actually went into a batch, from intakes, additions, lab readings and volumes. Values are null where there is no record.
  let fruit_kg = db.val("SELECT SUM(amount) FROM intake WHERE batch_id=? AND reversed=0 AND kind='fruit' AND unit='kg'", batch_id);
  try {   // fruit taken off the on-hand list into this batch (onhand.js lots)
    const lot_kg = db.val("SELECT SUM(CASE WHEN action='use undone' THEN -amount_kg ELSE amount_kg END) FROM ingredient_lot_log WHERE batch_id=? AND action IN ('used','used up','use undone')", batch_id);
    if (lot_kg) fruit_kg = (fruit_kg || 0) + lot_kg;
  } catch (e) { /* no lots table yet */ }
  const honey_in = db.val("SELECT SUM(amount) FROM intake WHERE batch_id=? AND reversed=0 AND kind='honey' AND unit='kg'", batch_id);
  const bulk_l = db.val("SELECT SUM(amount) FROM intake WHERE batch_id=? AND reversed=0 AND kind='bulk' AND unit='L'", batch_id);
  const add = new Map();
  for (const r of db.all(`SELECT m.kind AS kind, SUM(a.amount_base) AS s FROM op_addition a JOIN material m ON m.id=a.material_id JOIN operation o ON o.id=a.op_id
                                           WHERE a.batch_id=? AND o.reversed=0 AND m.kind IN ('sugar','honey','water') GROUP BY m.kind`, batch_id)) add.set(r.kind, r.s);
  const aget = k => (add.has(k) ? add.get(k) : null);
  function first(metric, desc = false) {
    const r = db.one(`SELECT a.value AS value, substr(o.occurred_at,1,10) AS d FROM op_analysis a JOIN operation o ON o.id=a.op_id WHERE a.batch_id=? AND a.metric=? AND o.reversed=0
                     AND a.value IS NOT NULL ORDER BY o.occurred_at ${desc ? 'DESC' : ''} LIMIT 1`, batch_id, metric);
    return r ? [r.value, r.d] : null;
  }
  const brix0 = first('Brix'), sg0 = first('SG'), sgN = first('SG', true), alc = first('Alcohol', true);
  const peak = db.val('SELECT MAX(t) FROM (SELECT snap_date, SUM(volume_l) t FROM bulk_snapshot WHERE batch_id=? GROUP BY snap_date)', batch_id);
  let sg_start = null;
  if (brix0 && (!sg0 || brix0[1] <= sg0[1])) {
    sg_start = [sg(brix0[0]), brix0[1], `Brix ${fmt_g(brix0[0])}`];
  } else if (sg0) {
    sg_start = [sg0[0], sg0[1], 'SG'];
  }
  const honey_kg = (honey_in || 0) + (aget('honey') || 0);
  return {
    peak_l: peak, fruit_lb: fruit_kg ? fruit_kg * LB : null, bulk_l,
    sugar_lb: aget('sugar') ? add.get('sugar') * LB : null, honey_lb: honey_kg ? honey_kg * LB : null,
    water_gal: aget('water') ? add.get('water') / GAL : null,
    sg_start, sg_end: sgN ? [sgN[0], sgN[1]] : null, alcohol: alc ? [alc[0], alc[1]] : null,
  };
}

