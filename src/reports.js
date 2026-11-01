// Port of reports.py — report engines for HW Cellar: TTB F 5120.17 (annual), Dispatched Stock export (Vintrace CSV layout), stock on hand.
import { fx, pyRound, pyStr, addDays, today, naiveMs, strftime } from './lib/py.js';
import { reports as K } from './gen/strings.js';

export const GAL = K.GAL;
export const LB = K.LB;
export const CLASSES = K.CLASSES;
export const CLASS_NAMES = K.CLASS_NAMES;
export const TTB_LINES_A = K.TTB_LINES_A;
export const TTB_LINES_B = K.TTB_LINES_B;
export const DISPATCH_COLS = K.DISPATCH_COLS;

// ---------------------------------------------------------------- Python-compat helpers

// collections.Counter: missing keys read as 0 without being inserted; insertion order kept (Map, so None/null keys work).
export class Counter extends Map {
  g(k) {
    return this.has(k) ? super.get(k) : 0;
  }
  add(k, v) {
    this.set(k, this.g(k) + v);
  }
}

// str(float) / repr(float): shortest round-trip digits; fixed notation for 1e-4 <= |x| < 1e16 (integer-valued -> '.0'), else 'de±XX'.
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
    if (e >= 0) {
      if (dg.length <= e + 1) s = dg + '0'.repeat(e + 1 - dg.length) + '.0';
      else s = dg.slice(0, e + 1) + '.' + dg.slice(e + 1);
    } else {
      s = '0.' + '0'.repeat(-e - 1) + dg;
    }
  } else {
    s = dg[0] + (dg.length > 1 ? '.' + dg.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  }
  return (neg ? '-' : '') + s;
}

// round(x, d) on a float, keeping Python's signed zero (round(-0.0001, 3) -> -0.0)
export function pyRoundF(x, d) {
  const r = pyRound(x, d);
  return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r;
}

// csv.writer (QUOTE_MINIMAL, delimiter ',', quotechar '"', doublequote). Fields: null/undefined -> '', booleans -> True/False,
// numbers -> String() (pass floats already formatted with pyFloatStr), strings as-is.
export function csv_writer(lineterminator = '\r\n') {
  const out = [];
  const field = v => {
    const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : pyStr(v);
    return /[,"\r\n]/.test(s) || [...lineterminator].some(ch => s.includes(ch)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return {
    writerow(row) {
      let line;
      if (row.length === 1 && field(row[0]) === '') line = '""';   // a lone empty field is quoted so the row is not blank
      else line = row.map(field).join(',');
      out.push(line + lineterminator);
    },
    getvalue() {
      return out.join('');
    },
  };
}

// ---------------------------------------------------------------- report engines

function _snap_date_on_or_before(db, day) {
  return db.val('SELECT MAX(snap_date) FROM bulk_snapshot WHERE snap_date<=?', day);
}

// Section A on hand (BONDED) by class, and in-fermenters (NON_DECLARED) by beverage type, litres, at end of `day`. Returns [d, bonded, ferm].
export function bulk_by_class(db, day) {
  const d = _snap_date_on_or_before(db, day);
  const bonded = new Counter(), ferm = new Counter();
  if (!d) return [d, bonded, ferm];
  for (const r of db.all('SELECT tax_state,tax_class,beverage_type,volume_l FROM bulk_snapshot WHERE snap_date=?', d)) {
    if (r.tax_state === 'BONDED') bonded.add(r.tax_class || '?', r.volume_l);
    else ferm.add({ Cider: 'Cider', Mead: 'Honey' }[r.beverage_type] || 'Fruit', r.volume_l);
  }
  return [d, bonded, ferm];
}

// Finished goods on hand (litres) by class: sum of stock events dated before `before` (YYYY-MM-DD).
export function bottled_by_class(db, before) {
  const out = new Counter();
  const q = `SELECT si.tax_class, SUM(se.quantity*si.litres_per_unit) AS l FROM stock_event se JOIN stock_item si ON si.id=se.item_id
           WHERE si.is_finished=1 AND si.litres_per_unit IS NOT NULL AND se.occurred_at < ? GROUP BY si.tax_class`;
  for (const r of db.all(q, before)) out.add(r.tax_class || '?', r.l || 0);
  return out;
}

// lines of a filed return: Map line -> Map class -> gallons, or null when none is on file
function _filed(db, year) {
  if (!db.one("SELECT 1 x FROM sqlite_master WHERE name='ttb_filed'")) return null;
  const rows = db.all('SELECT line, cls, gal FROM ttb_filed WHERE year=?', year);
  if (!rows.length) return null;
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.line)) m.set(r.line, new Map());
    m.get(r.line).set(r.cls, r.gal);
  }
  return m;
}

export function Counter_copy(c) {
  return new Counter(c);
}

const _sum = it => {
  let s = 0;
  for (const v of it) s += v;
  return s;
};

export function ttb_5120(db, year) {
  year = Number(year);
  const y0 = `${year}-01-01`, y1 = `${year + 1}-01-01`;
  const prev_end = `${year - 1}-12-31`, cur_end = `${year}-12-31`;
  const L = new Map();   // line -> Counter(class -> litres)   (defaultdict(Counter))
  const LL = k => {
    if (!L.has(k)) L.set(k, new Counter());
    return L.get(k);
  };
  const notes = [];
  const [d0, A1] = bulk_by_class(db, prev_end);
  const [d1, A31, ferm] = bulk_by_class(db, cur_end);
  if (d0 !== prev_end) notes.push(`Opening bulk taken from snapshot ${pyStr(d0)} (no snapshot for ${prev_end}).`);
  if (d1 !== cur_end) notes.push(`Closing bulk taken from snapshot ${pyStr(d1)} (no snapshot for ${cur_end}).`);
  L.set('A1', A1); L.set('A31', A31);
  for (const r of db.all('SELECT kind,tax_class,from_class,SUM(volume_l) AS v FROM tax_event WHERE event_date>=? AND event_date<? GROUP BY kind,tax_class,from_class', y0, y1)) {
    const kind = r.kind, cls = r.tax_class, fc = r.from_class, v = r.v;
    if (['declared', 'declared_at_bottling', 'blended_into_bonded'].includes(kind)) {
      LL('A2').add(cls, v);
      LL('A2:' + kind).add(cls, v);
    } else if (kind === 'inventory_gain') {
      LL('A9').add(cls, v);
    } else if (kind === 'amelioration') {   // water added to declared wine (volume adjustment, reason "TTB - Water addition")
      LL('A6').add(cls, v);
    } else if (kind === 'class_change') {
      if (cls === 'd' || cls === 'e') {          // still wine made effervescent (Vintrace: line 22 from-class, line 2 to-class)
        LL('A22').add(fc, v); LL('A2').add(cls, v);
        if (fc === null || fc === undefined) throw new TypeError('can only concatenate str (not "NoneType") to str');
        LL('A2:carbonated_from_' + fc).add(cls, v);
      } else if (cls === 'b' && fc === 'a') {      // fortified
        LL('A19').add(fc, v); LL('A4').add(cls, v);
      } else {
        LL('A20').add(fc, v); LL('A5').add(cls, v);
      }
    } else if (kind === 'undeclared') {
      LL('returned_to_fermenters').add(cls, v);
    } else if (['bulk_loss', 'bottled_bulk', 'bonded_blend'].includes(kind)) {
      LL('info:' + kind).add(cls, v);
    }
  }
  // Section B
  const B1 = bottled_by_class(db, y0), B20 = bottled_by_class(db, y1);
  L.set('B1', B1); L.set('B20', B20);
  let q = `SELECT se.action, si.tax_class, SUM(se.quantity*si.litres_per_unit) AS v FROM stock_event se JOIN stock_item si ON si.id=se.item_id
           WHERE si.is_finished=1 AND si.litres_per_unit IS NOT NULL AND se.occurred_at>=? AND se.occurred_at<? GROUP BY se.action, si.tax_class`;
  const ev = new Map();
  const EV = k => {
    if (!ev.has(k)) ev.set(k, new Counter());
    return ev.get(k);
  };
  for (const r of db.all(q, y0, y1)) EV(r.action).add(r.tax_class || '?', r.v || 0);
  L.set('B2', EV('Package'));
  L.set('B3', EV('Receive'));
  q = `SELECT dt.ttb_line, si.tax_class, SUM(dl.quantity*si.litres_per_unit) AS v FROM dispatch d JOIN dispatch_line dl ON dl.dispatch_id=d.id
           JOIN stock_item si ON si.id=dl.item_id JOIN dispatch_type dt ON dt.name=d.dispatch_type
           WHERE d.reversed=0 AND si.is_finished=1 AND si.litres_per_unit IS NOT NULL AND d.occurred_at>=? AND d.occurred_at<? GROUP BY dt.ttb_line, si.tax_class`;
  for (const r of db.all(q, y0, y1)) LL(r.ttb_line).add(r.tax_class || '?', r.v || 0);
  for (const [cls, v] of EV('Adjustment')) {
    if (v < 0) LL('B19').add(cls, -v);
    else if (v > 0) LL('B5').add(cls, v);
  }
  const disp_hist = EV('Dispatch');
  const disp_lines = new Counter();
  for (const ln of ['B8', 'B9', 'B11', 'B12', 'B13', 'B14']) for (const [c, v] of LL(ln)) disp_lines.add(c, v);
  // Python iterates a set here (hash order); notes come out in first-seen order instead.
  for (const c of new Set([...disp_hist.keys(), ...disp_lines.keys()])) {
    if (Math.abs(-disp_hist.g(c) - disp_lines.g(c)) > 3.8)
      notes.push(`Class ${pyStr(c)}: dispatch records (${fx(disp_lines.g(c) / GAL, 1)} gal) and stock history (${fx(-disp_hist.g(c) / GAL, 1)} gal) disagree.`);
  }
  // A13 = B2 ; A29 casualty losses on bonded wine ; A30 balancing
  L.set('A13', Counter_copy(LL('B2')));
  q = `SELECT substr(o.occurred_at,1,10) AS day, l.vessel_id, l.volume_l, l.reason, o.id, o.source FROM op_loss l JOIN operation o ON o.id=l.op_id
           WHERE o.occurred_at>=? AND o.occurred_at<? AND o.reversed=0 AND l.reason LIKE 'TTB -%' AND COALESCE(l.gain,0)=0 AND l.reason NOT LIKE '%water addition%' `;
  let und_cas = 0.0;
  for (const x of db.all(q, y0, y1)) {
    let st = null, cl = null, found = false;
    if (x.source === 'app') {   // state recorded on the operation itself
      const r = db.one('SELECT tax_state_before,tax_class_before FROM op_vessel WHERE op_id=? AND vessel_id=?', x.id, x.vessel_id);
      if (r) { found = true; st = r.tax_state_before; cl = r.tax_class_before; }
    } else {
      const prev = addDays(x.day, -1);
      const sd = _snap_date_on_or_before(db, prev);
      const r = db.one('SELECT tax_state,tax_class FROM bulk_snapshot WHERE snap_date=? AND vessel_id=?', sd, x.vessel_id);
      if (r) { found = true; st = r.tax_state; cl = r.tax_class; }
    }
    const rl = x.reason.toLowerCase();
    if (found && st === 'BONDED') LL(rl.includes('destroy') ? 'A24' : rl.includes('testing') ? 'A23' : 'A29').add(cl || '?', x.volume_l);   // Vintrace: testing line 23, destroyed 24, casualty 29
    else und_cas += x.volume_l;
  }
  if (und_cas) notes.push(`${fx(und_cas / GAL, 1)} gal of casualty/destroyed/testing losses were on undeclared wine (in fermenters) and do not appear in Section A.`);
  // TTB: line 1 of each section must equal line 31 / line 20 of the previous return AS FILED. When that return is on file
  // (table ttb_filed), carry it forward and keep bottled-on-hand (B20) as the running book balance, as Vintrace does.
  const prev = _filed(db, year - 1);
  if (prev) {
    for (const [line, pl] of [['A1', 'A31'], ['B1', 'B20']]) {
      const f = prev.get(pl) || new Map(), phys = LL(line), diffs = [];
      for (const c of new Set([...phys.keys(), ...f.keys()])) {
        const d = phys.g(c) / GAL - (f.get(c) || 0);
        if (Math.abs(d) >= 0.5) diffs.push(`${c} ${d > 0 ? '+' : ''}${fx(d, 1)}`);
      }
      const nc = new Counter();
      for (const [c, v] of f) if (v) nc.set(c, v * GAL);
      L.set(line, nc);
      notes.push(`${line[0]}${line.slice(1)} carried from the ${year - 1} return as filed (line ${pl.slice(1)})` +
        (diffs.length ? `; the cellar records differ by ${diffs.join(', ')} gal (records minus filed).` : '; matches the cellar records.'));
    }
  }
  const allc = new Set([...CLASSES, ...LL('A1').keys(), ...LL('A31').keys(), ...LL('A2').keys()]);
  for (const c of allc) {
    LL('A12').set(c, LL('A1').g(c) + LL('A2').g(c) + LL('A4').g(c) + LL('A5').g(c) + LL('A6').g(c) + LL('A9').g(c));
    LL('A30').set(c, LL('A12').g(c) - LL('A13').g(c) - LL('A19').g(c) - LL('A20').g(c) - LL('A22').g(c) - LL('A23').g(c) - LL('A24').g(c) - LL('A29').g(c) - LL('A31').g(c) - LL('returned_to_fermenters').g(c));
    LL('A32').set(c, LL('A12').g(c));
    LL('B7').set(c, LL('B1').g(c) + LL('B2').g(c) + LL('B3').g(c) + LL('B5').g(c));
    LL('B21').set(c, LL('B7').g(c));
    LL('B_check').set(c, LL('B7').g(c) - _sum(['B8', 'B9', 'B11', 'B12', 'B13', 'B14', 'B19'].map(x => LL(x).g(c))) - LL('B20').g(c));
  }
  if (prev) {   // book balance for B20; report how far the physical stock records are from it
    const off = [];
    for (const c of allc) {
      const book = LL('B7').g(c) - _sum(['B8', 'B9', 'B11', 'B12', 'B13', 'B14', 'B19'].map(x => LL(x).g(c)));
      const d = (LL('B20').g(c) - book) / GAL;
      if (Math.abs(d) >= 0.5) off.push(`${c} ${d > 0 ? '+' : ''}${fx(d, 1)}`);
      if (Math.abs(book) > 1e-9 || LL('B20').has(c)) LL('B20').set(c, book);
      LL('B_check').set(c, 0);
    }
    if (off.length) notes.push(`B20 is the book balance (line 7 minus removals). Bottled stock in the records differs by ${off.join(', ')} gal — a stock count would reconcile it.`);
  }
  if (LL('A30').size && [...LL('A30').values()].some(v => v < -0.5))
    notes.push('Line 30 is negative for some class (a net gain) — check the gains and blends shown above.');
  if (LL('returned_to_fermenters').size)
    notes.push('Some bonded wine went back to undeclared (fermenter) status; it is folded into line 30.');
  if ([...LL('A1')].some(([c, v]) => c === '?' && v) || [...LL('A31')].some(([c, v]) => c === '?' && v))
    notes.push('Declared wine with no tax class in the data is shown in column "?" — assign a class before filing.');
  // Part IV
  const iv = {};
  iv.fruit_lb = db.val("SELECT COALESCE(SUM(amount),0) FROM intake WHERE kind='fruit' AND reversed=0 AND unit='kg' AND occurred_at>=? AND occurred_at<?", y0, y1) * LB;
  iv.apple_lb = db.val("SELECT COALESCE(SUM(amount),0) FROM intake WHERE kind='fruit' AND reversed=0 AND unit='kg' AND lower(variety)='apple' AND occurred_at>=? AND occurred_at<?", y0, y1) * LB;   // apples (for cider) reported in their own Part IV column
  iv.honey_intake_lb = db.val("SELECT COALESCE(SUM(amount),0) FROM intake WHERE kind='honey' AND reversed=0 AND unit='kg' AND occurred_at>=? AND occurred_at<?", y0, y1) * LB;
  iv.cider_gal = db.val("SELECT COALESCE(SUM(amount),0) FROM intake WHERE kind='bulk' AND reversed=0 AND unit='L' AND occurred_at>=? AND occurred_at<?", y0, y1) / GAL;
  const sug = new Counter();
  q = `SELECT se.action, se.occurred_at<? AS before, SUM(se.quantity * CASE WHEN si.unit IN ('lb','Pounds') THEN 1 WHEN si.unit IN ('kg','Kilograms') THEN ? WHEN si.unit IN ('g','Grams') THEN ?/1000 ELSE 1 END) AS v
           FROM stock_event se JOIN stock_item si ON si.id=se.item_id JOIN material m ON m.stock_item_id=si.id
           WHERE m.ttb_part_iv='sugar_dry' AND se.occurred_at<? GROUP BY se.action, before`;
  for (const r of db.all(q, y0, LB, LB, y1)) {
    if (r.before) sug.add('begin', r.v);
    else sug.add(r.action, r.v);
    sug.add('end', r.v);
  }
  iv.sugar_begin_lb = sug.g('begin'); iv.sugar_received_lb = sug.g('Receive'); iv.sugar_used_lb = -sug.g('Consume');
  iv.sugar_removed_lb = -sug.g('Adjustment'); iv.sugar_end_lb = sug.g('end');
  const add = new Map();
  for (const r of db.all(`SELECT m.kind, SUM(a.amount_base) AS s FROM op_addition a JOIN material m ON m.id=a.material_id JOIN operation o ON o.id=a.op_id
                             WHERE o.reversed=0 AND o.occurred_at>=? AND o.occurred_at<? AND m.kind IN ('honey','water','sugar') GROUP BY m.kind`, y0, y1)) add.set(r.kind, r.s);
  iv.honey_added_lb = (add.get('honey') || 0) * LB;
  iv.sugar_added_lb = (add.get('sugar') || 0) * LB;
  iv.water_added_gal = (add.get('water') || 0) / GAL;
  const vii = {};
  for (const [k, v] of ferm) vii[k] = v / GAL;
  // gal: Map line -> Map class -> gallons
  const gal = new Map();
  for (const [line, cc] of L) gal.set(line, new Map([...cc].map(([c, v]) => [c, v / GAL])));
  return { year, gal, part_iv: iv, part_vii: vii, notes, snapshots: [d0, d1] };
}

const _sortedItems = o => Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

export function ttb_csv(rep) {
  const w = csv_writer();
  w.writerow(['section', 'line', 'item', ...CLASSES.map(c => `${c} ${CLASS_NAMES[c]}`), '? unclassified']);
  for (const [sec, lines] of [['A', TTB_LINES_A], ['B', TTB_LINES_B]]) {
    for (const [key, label] of lines) {
      const vals = rep.gal.get(key) || new Map();
      w.writerow([sec, key.slice(1), label, ...[...CLASSES, '?'].map(c => (vals.get(c) ? pyRound(vals.get(c) ?? 0) : ''))]);
    }
  }
  const iv = rep.part_iv;
  w.writerow([]); w.writerow(['IV', '', 'Fruit received/used (lb)', pyRound(iv.fruit_lb)]);
  w.writerow(['IV', '', 'Honey intakes (lb)', pyRound(iv.honey_intake_lb)]);
  w.writerow(['IV', '', 'Cider / bulk juice received/used (gal)', pyRound(iv.cider_gal)]);
  for (const k of ['sugar_begin_lb', 'sugar_received_lb', 'sugar_used_lb', 'sugar_removed_lb', 'sugar_end_lb']) w.writerow(['IV', '', k, pyRound(iv[k])]);
  w.writerow(['info', '', 'Honey added as ingredient (lb)', pyRound(iv.honey_added_lb)]);
  w.writerow(['info', '', 'Water added (gal)', pyRound(iv.water_added_gal)]);
  w.writerow([]); w.writerow(['VII', '', 'In fermenters end of period (gal)', ..._sortedItems(rep.part_vii).map(([k, v]) => `${k} ${pyRound(v)}`)]);
  for (const n of rep.notes) w.writerow(['note', '', n]);
  return w.getvalue();
}

// Same columns as Vintrace's VINx2_DispatchedStock export; finished goods only, non-reversed, dates inclusive.
export function dispatched_stock_csv(db, date_from, date_to) {
  const w = csv_writer('\n');
  w.writerow(DISPATCH_COLS);
  const q = `SELECT d.occurred_at, d.destination, d.dispatch_type, d.bol, si.code, si.name, si.description, dl.quantity, si.state_tax_class
           FROM dispatch d JOIN dispatch_line dl ON dl.dispatch_id=d.id JOIN stock_item si ON si.id=dl.item_id
           WHERE d.reversed=0 AND si.is_finished=1 AND d.occurred_at>=? AND d.occurred_at<? ORDER BY d.occurred_at, CAST(d.bol AS INTEGER), dl.id`;
  const end = addDays(date_to, 1);
  for (const r of db.all(q, date_from, end)) {
    const t = strftime(naiveMs(r.occurred_at), '%m/%d/%Y %H:%M');
    const row = Object.fromEntries(DISPATCH_COLS.map(c => [c, '']));
    Object.assign(row, {
      'Date': t, 'Winery': 'Hermit Woods Winery', 'Dispatch to': r.destination || 'Hermit Woods Winery', 'Dispatch type': r.dispatch_type,
      'Ship from': 'NH', 'Ship to': 'NH', 'From Bond': 'Hermit Woods Winery - BWN-NH-15024', 'BOL#': r.bol,
      'Address#1': '72 Main Street', 'City': 'MEREDITH', 'State': 'NH', 'Zipcode': '03253', 'Country': 'UNITED STATES',
      'Sent by': 'WOODS| Hermit', 'Location': 'Warehouse / Warehouse', 'Stock item': r.code, 'Name': r.name || r.code,
      'Description': r.description || '', 'Owner': 'Hermit Woods Winery', 'Type': 'Single x1', 'Quantity': fx(r.quantity, 1), 'Unit': 'Single x1',
      'Tax Class': r.state_tax_class || '', 'Tax State': 'Bonded', 'Freight forwarder': '--',
    });
    w.writerow(DISPATCH_COLS.map(c => row[c]));
  }
  return w.getvalue();
}

export function stock_on_hand(db, day = null) {
  day = day || today();
  const end = addDays(day, 1);
  return db.all(`SELECT si.id, si.code, si.name, si.description, si.category, si.unit, si.tax_class, si.litres_per_unit, SUM(se.quantity) q
                         FROM stock_item si JOIN stock_event se ON se.item_id=si.id WHERE se.occurred_at<? GROUP BY si.id HAVING ABS(q)>1e-6
                         ORDER BY si.category, si.code`, end);
}

// Not in reports.py: the body of app.py's GET /stock.csv handler, so the router can call it (csv.writer default '\r\n';
// round(q, 3) and round(q * litres, 2) are floats, printed the way Python prints floats).
export function stock_csv(db, day) {
  const w = csv_writer();
  w.writerow(['Code', 'Name', 'Description', 'Category', 'Unit', 'Tax class', 'Quantity', 'Litres']);
  for (const r of stock_on_hand(db, day))
    w.writerow([r.code, r.name, r.description, r.category, r.unit, r.tax_class, pyFloatStr(pyRoundF(r.q, 3)), pyFloatStr(pyRoundF(r.q * (r.litres_per_unit || 0), 2))]);
  return w.getvalue();
}
