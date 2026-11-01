// v0.9.2 — the rest of the Vintrace data: cost ledger, work orders, fruit bookings, contacts (with editing),
// additive lot numbers and intake / extraction details. Data loaded by tools/import_extras.py.
import { E, num, qv, today } from './lib/py.js';
import { page, table, link, opts } from './core.js';

const S = v => (v === null || v === undefined ? '' : String(v));
const GAL = 3.785411784;
const money = v => (v === null || v === undefined || v === '' ? '' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const COMP = ['fruit', 'bulk', 'additive', 'operation', 'packaging', 'storage', 'overhead', 'freight', 'other'];
// columns on the Costs overview: packaging, storage and overhead dropped (storage/overhead are always 0; packaging is folded into Other)
// v1.47 (Ken): freight (one record) and other (a handful) dropped from the overview
const TCOLS = ['fruit', 'bulk', 'additive', 'operation'];
const tval = (r, k) => (k === 'other' ? (r.other || 0) + (r.packaging || 0) + (r.storage || 0) + (r.overhead || 0) : r[k] || 0);
// whole dollars for the batch totals on the overview (v1.50: keeps By batch and By activity side by side)
const money0 = v => (v === null || v === undefined || v === '' ? '' : (v < -0.5 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US'));
const nw = s => (s ? `<span style="white-space:nowrap">${s}</span>` : '');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cost_txn(id INTEGER PRIMARY KEY, vt_posted_id INTEGER UNIQUE, activity_id TEXT, op_id INTEGER, activity_type TEXT,
    activity_date TEXT, posted_date TEXT, batch_code TEXT, batch_id INTEGER, target2 TEXT, vessel TEXT, location TEXT, volume_l REAL,
    cost_total REAL, cost_fruit REAL, cost_overhead REAL, cost_storage REAL, cost_additive REAL, cost_bulk REAL, cost_packaging REAL,
    cost_operation REAL, cost_freight REAL, cost_other REAL, customer TEXT, vendor TEXT, loss_reason TEXT, summary TEXT, correction INTEGER, source TEXT DEFAULT 'vintrace')`,
  'CREATE INDEX IF NOT EXISTS ix_cost_batch ON cost_txn(batch_id, activity_date)',
  'CREATE INDEX IF NOT EXISTS ix_cost_op ON cost_txn(op_id)',
  `CREATE TABLE IF NOT EXISTS work_order(id INTEGER PRIMARY KEY, vt_id INTEGER UNIQUE, code TEXT, summary TEXT, status TEXT, assigned_to TEXT,
    issued_by TEXT, scheduled_at TEXT, finished_at TEXT, jobs TEXT, source TEXT DEFAULT 'vintrace')`,
  'CREATE TABLE IF NOT EXISTS ttb_filed(year INTEGER NOT NULL, line TEXT NOT NULL, cls TEXT NOT NULL, gal REAL, source TEXT, PRIMARY KEY(year, line, cls))',
  `CREATE TABLE IF NOT EXISTS booking(id INTEGER PRIMARY KEY, vt_id INTEGER UNIQUE, booking_no TEXT, arrival_at TEXT, vintage INTEGER,
    weight_kg REAL, vineyard TEXT, block TEXT, grower TEXT, source TEXT DEFAULT 'vintrace')`,
];
const COLS = {
  party: [['given_name', 'TEXT'], ['surname', 'TEXT'], ['is_org', 'INTEGER'], ['phone', 'TEXT'], ['email', 'TEXT'], ['address', 'TEXT'], ['contacts', 'TEXT'], ['notes', 'TEXT'],
    ['contact_person', 'TEXT'], ['products', 'TEXT'], ['website', 'TEXT'], ['ship_to', 'TEXT'], ['aka', 'TEXT'], ['source', 'TEXT']],
  op_addition: [['lot', 'TEXT'], ['change_to_state', 'TEXT']],
  operation: [['details', 'TEXT']],
  intake: [['booking_no', 'TEXT'], ['block', 'TEXT'], ['vineyard', 'TEXT'], ['carrier', 'TEXT'], ['gross_amount', 'REAL'], ['tare_amount', 'REAL'], ['cost', 'REAL'], ['cost_rate', 'TEXT'], ['details', 'TEXT']],
  stock_item: [['unit_cost', 'REAL'], ['total_cost', 'REAL'], ['cost_detail', 'TEXT'], ['location', 'TEXT'], ['tax_state', 'TEXT'], ['cost_as_of', 'TEXT']],
};

export function ensure_schema(c) {
  for (const s of SCHEMA) c.run(s);
  for (const [t, cols] of Object.entries(COLS)) {
    if (!c.val("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t)) continue;
    const have = new Set(c.columns(t));
    for (const [n, ty] of cols) if (!have.has(n)) c.run(`ALTER TABLE ${t} ADD COLUMN ${n} ${ty}`);
  }
}

const J = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

// ---------------------------------------------------------------- operation details (used on the operation page)
export function op_details_html(o) {
  const d = J(o.details);
  if (!d) return '';
  const rows = [];
  const add = (k, v) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) rows.push([E(k), v]); };
  if (d.summary) add('Summary', d.summary.map(E).join('<br>'));
  add('Grower', E(d.grower)); add('Booking #', E(d.bookingNo)); add('Variety', E(d.varietal)); add('Block', E(d.block)); add('Region', E(d.subAva));
  add('Vintage', E(d.vintage)); if (d.netAmount) add('Net amount', `${num(d.netAmount, 3)} ${E(d.netAmountUnit || '')}`);
  add('Dockets', E((d.dockets || []).join(', '))); add('Fraction', E(d.fractionType)); add('Crusher', E(d.crusher)); add('Press', E(d.press));
  add('Fruit process', E(d.fruitProcess)); add('Harvest method', E(d.harvestMethod)); add('Dispatch #', E(d.dispatchNo)); add('Job #', E(d.job));
  if (d.parcels && d.parcels.length) add('Fruit parcels', d.parcels.map(p => `${E(p.growerName || '')} · booking ${E(p.bookingNo || '')} · docket ${E(p.docket || '')}${p.blockName ? ' · ' + E(p.blockName) : ''} · ${num(p.weight, 3)} ${E(p.weightUnit || '')}`).join('<br>'));
  if (d.steps) add('Steps', E(d.steps.join(' + ')));
  return rows.length ? '<h2>Details (from Vintrace)</h2>' + table(['', ''], rows) : '';
}

export function op_costs_html(c, oid) {
  const r = c.all('SELECT activity_type, batch_code, vessel, volume_l, cost_total, summary FROM cost_txn WHERE op_id=? ORDER BY id', oid);
  if (!r.length) return '';
  return '<h2>Costs posted</h2>' + table(['Activity', 'Batch', 'Vessel', 'Volume (L)', 'Cost', 'Summary'],
    r.map(x => [E(x.activity_type), E(x.batch_code), E(x.vessel), num(x.volume_l, 1), money(x.cost_total), `<span class="muted">${E(x.summary)}</span>`]), [3, 4]);
}

// ---------------------------------------------------------------- costs
export function p_costs(c, q) {
  const bcode = qv(q, 'batch', '').trim();
  const yr = qv(q, 'year', '');
  const ys = c.col("SELECT DISTINCT substr(activity_date,1,4) y FROM cost_txn WHERE activity_date IS NOT NULL ORDER BY 1 DESC");
  if (!ys.length) return page('Costs', '<h1>Costs</h1><p class="muted">No cost records loaded.</p>', '/costs');
  const act = qv(q, 'activity', '').trim();
  if (act) return p_cost_activity(c, act, yr, qv(q, 'item', '').trim(), ys);
  if (bcode) {
    const rows = c.all(`SELECT * FROM cost_txn WHERE batch_code=? ${yr ? 'AND substr(activity_date,1,4)=?' : ''} ORDER BY activity_date, id`, bcode, ...(yr ? [yr] : []));
    const b = c.one('SELECT id, description FROM batch WHERE code=?', bcode);
    const tot = k => rows.reduce((s, r) => s + (r['cost_' + k] || 0), 0);
    const cin = rows.reduce((s, r) => s + Math.max(r.cost_total || 0, 0), 0), cout = rows.reduce((s, r) => s + Math.min(r.cost_total || 0, 0), 0);
    const pk = rows.filter(r => String(r.activity_type).startsWith('Package'));
    const pkEv = new Map();                       // one bottling posts several cost rows with the same volume — count it once
    for (const r of pk) pkEv.set(`${r.activity_date}|${r.summary}`, Math.max(pkEv.get(`${r.activity_date}|${r.summary}`) || 0, -(r.volume_l || 0)));
    const pkL = [...pkEv.values()].reduce((s, v) => s + v, 0), pkC = -pk.reduce((s, r) => s + (r.cost_total || 0), 0);
    const comp = COMP.filter(k => Math.abs(tot(k)) > 0.005);
    const head = `<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))"><a><b>${money(cin)}</b><span>costs in (incl. wine transferred in)</span></a>
      <a><b>${money(-cout)}</b><span>moved out with wine (bottled, transferred, lost)</span></a><a><b>${money(tot('total'))}</b><span>still carried in bulk</span></a>
      ${pkL > 1 ? `<a><b>${money(pkC / pkL)}/L</b><span>bottled wine cost (${num(pkL)} L packaged)</span></a>` : ''}${[...(pkSizes(c, yr, bcode).get(bcode) || new Map()).entries()].sort((a, b) => a[0] - b[0]).map(([l, g]) => { const p = perBottle(g); return `<a><b>${money(p.full)}${p.none ? ' †' : p.inc ? ' *' : ''}</b><span>per ${sizeName(l)} · ${num(g.n)} packaged<br>wine ${money(p.wine)}${p.none ? ' · no packaging recorded' : ` + packaging ${money(p.pkg)}${p.nobottle ? ' (no bottle or can recorded)' : ''}: ${[...g.items.values()].sort((x, y) => y.cost - x.cost).map(x => `${E(x.name || '')} ${x.uc > 0 ? money(x.cost / g.nd) : '(no cost on file)'}`).join(', ')}`}</span></a>`; }).join('')}</div>
      <p class="muted" style="font-size:12px">Net by cost type: ${comp.map(k => `${k} ${money(tot(k))}`).join(' · ') || 'none'}. Wine costs only; dry goods (bottles, labels) are added at packaging in Vintrace's finished-goods cost.</p>`;
    let bal = 0;
    const t = table(['Date', 'Activity', 'Vessel', 'Volume (L)', 'Cost', 'Running', 'Summary'], rows.map(r => {
      bal += r.cost_total || 0;
      return [r.op_id ? link(`/op/${S(r.op_id)}`, S(r.activity_date).slice(0, 10)) : E(S(r.activity_date).slice(0, 10)), E(r.activity_type), E(r.vessel), num(r.volume_l, 1),
        money(r.cost_total), money(bal), `<span class="muted" style="font-size:12px">${E(r.summary)}</span>`];
    }), [3, 4, 5]);
    return page(`Costs · ${bcode}`, `<h1>Costs · ${b ? link(`/batch/${S(b.id)}`, bcode) : E(bcode)}</h1><p class="sub">${E(b ? b.description || '' : '')} · Vintrace cost ledger (movements in and out net to what is in the batch now)</p>${head}<h2>Ledger (${rows.length})</h2>${t}`, '/costs', [['Costs', '/costs'], [bcode, null]]);
  }
  const w = yr ? 'WHERE substr(activity_date,1,4)=?' : '';
  const ya = yr ? [yr] : [];
  const pkv = new Map(c.all(`SELECT batch_code, SUM(v) L FROM (SELECT batch_code, activity_date, summary, MAX(-volume_l) v FROM cost_txn
      WHERE activity_type LIKE 'Package%' ${yr ? 'AND substr(activity_date,1,4)=?' : ''} GROUP BY batch_code, activity_date, summary) GROUP BY batch_code`, ...ya).map(r => [r.batch_code, r.L]));
  const rows = c.all(`SELECT batch_code, MAX(batch_id) bid, COUNT(*) n, -SUM(CASE WHEN activity_type LIKE 'Package%' THEN cost_total ELSE 0 END) pc, SUM(cost_total) t,
                        ${COMP.map(k => `SUM(cost_${k}) - SUM(CASE WHEN activity_type LIKE 'Package%' THEN cost_${k} ELSE 0 END) ${k}`).join(', ')}
                        FROM cost_txn ${w} GROUP BY batch_code HAVING SUM(ABS(cost_total))>0.005`, ...ya);
  const z = v => (Math.abs(v || 0) < 0.005 ? 0 : v);
  rows.sort((a, b) => (z(b.pc) - z(a.pc)) || (Math.abs(z(b.t)) - Math.abs(z(a.t))));
  // v1.46 (Ken): the in/out pairs that only carry cost from one batch to the next are left out of By activity — they net to ~0
  const PAIRS = ['Movement in', 'Movement out', 'Pressed in', 'Pressed out', 'Measurement'];
  const byType = c.all(`SELECT activity_type, COUNT(*) n, SUM(cost_total) t FROM cost_txn ${w ? w + ' AND' : 'WHERE'} activity_type NOT IN (${PAIRS.map(() => '?').join(',')}) GROUP BY 1 ORDER BY ABS(SUM(cost_total)) DESC LIMIT 15`, ...ya, ...PAIRS);
  const pairNet = c.one(`SELECT COUNT(*) n, COALESCE(SUM(cost_total),0) t FROM cost_txn ${w ? w + ' AND' : 'WHERE'} activity_type IN (${PAIRS.map(() => '?').join(',')})`, ...ya, ...PAIRS);
  const f = `<form class="f"><label>Year<select name="year">${opts(ys, yr, 'all years')}</select></label><label>Batch<input name="batch" placeholder="e.g. 26Straw2" list="bl"><datalist id="bl">${rows.map(r => `<option value="${E(r.batch_code)}">`).join('')}</datalist></label><button>Show</button></form>`;
  const psz = pkSizes(c, yr);
  const gz = (b, l) => (psz.get(b) || new Map()).get(l);
  const t = table(['Batch / cost target', 'Bottled (L)', 'Bottled wine cost', '$ / 750 ml', '$ / 375 ml', 'Other packages', 'Still in bulk', ...TCOLS.map(k => k[0].toUpperCase() + k.slice(1))],
    rows.map(r => { const L = pkv.get(r.batch_code) || 0, pc = z(r.pc);
      return [link(`/costs?batch=${encodeURIComponent(r.batch_code || '')}${yr ? '&year=' + yr : ''}`, r.batch_code || '(none)'), L > 0.5 ? num(L) : '',
        nw(pc ? money0(pc) : ''), bottleCell(gz(r.batch_code, 0.75) || gz(r.batch_code, SPK), ''), bottleCell(gz(r.batch_code, 0.375)),
        `<span style="font-size:12px">${[...(psz.get(r.batch_code) || new Map()).entries()].filter(([l]) => showOther(l, psz.get(r.batch_code))).sort((a, b) => a[0] - b[0]).map(([l, g]) => bottleCell(g, l === 0.355 ? 'can ' : l === SPK ? 'sparkling ' : sizeName(l) + ' ')).join(' ')}</span>`, nw(money0(z(r.t))), ...TCOLS.map(k => (Math.abs(tval(r, k)) > 0.5 ? nw(money0(tval(r, k))) : ''))]; }),
    [1, 2, 3, 4, 6, ...TCOLS.map((_, i) => 7 + i)]);
  const tS = t.replace(/<td class="n"><span data-sv="([\d.]+)"/g, '<td class="n" data-v="$1"><span');
  const tt = table(['Activity', 'Records', 'Cost'], byType.map(r => [link(`/costs?activity=${encodeURIComponent(r.activity_type || '')}${yr ? '&year=' + yr : ''}`, r.activity_type || '(none)'), num(r.n), nw(money0(r.t))]), [1, 2]) + `<p class="muted" style="font-size:12px">Click an activity for its breakdown — e.g. Additive by additive, with amounts and unit cost. Not listed: Movement in/out and Pressed in/out, which only carry a wine's cost along when it is transferred or pressed into another batch (they net to about zero), and Measurement — cost written off with wine lost (a TTB matter); ${num(pairNet.n)} records, ${money(pairNet.t)} together.</p>`;
  return page('Costs', `<h1>Costs</h1><p class="sub">Vintrace cost ledger (${num(c.val('SELECT COUNT(*) FROM cost_txn'))} records, ${E(ys[ys.length - 1])}–${E(ys[0])}). Bottled wine cost is the wine cost moved into packaged stock; $ / 750 ml, $ / 375 ml and Other packages are the cost of one bottle — wine + packaging materials — for the sizes each batch was actually packaged in (see “How the cost per bottle is worked out”); "Still in bulk" is what each batch or fruit lot carries now; Fruit, Bulk (bought-in cider and wine), Additive and Operation split the batch's own wine cost — bottled plus still in bulk, after what moved on to other batches. For a year, figures are the movements in that year. "FI/…" targets are fruit intake lots before they went into a batch. Pectic enzymes (Scottzyme HC, PEC5L) re-priced 2026-10-02 at the Scott Labs list price ($100.63 per 890 ml) — Vintrace had charged $4.58–$89 per ml.</p>${f}
    ${COST_HELP(c)}<style>.cgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,250px);gap:18px;align-items:start}.cgrid>div{min-width:0}@media (max-width:1400px){.cgrid{grid-template-columns:1fr}}</style><div class="cgrid"><div><h2>By batch</h2>${tS}</div><div><h2>By activity</h2>${tt}</div></div>`, '/costs');
}

// v1.45 (Ken, 2026-10-13) — one activity of the cost ledger opened up: what it was spent on (additive, cost item, fruit and
// grower, loss reason, vendor — read from Vintrace's summary line), by year, by batch, and every record; one item drills to its records.
const UNITK = { kg: [1, 'kg'], g: [0.001, 'kg'], lb: [0.45359237, 'kg'], L: [1, 'L'], l: [1, 'L'], ml: [0.001, 'L'], units: [1, 'units'], unit: [1, 'units'] };
function itemOf(r) {
  const s = S(r.summary);
  let m = s.match(/^Consumed\s+([\d.,]+)\s*([A-Za-z]+)\s+x\s+(.+?)\s+from\b/);
  if (m) { const u = UNITK[m[2]], qq = parseFloat(m[1].replace(/,/g, '')); return { item: m[3].trim(), q: u && isFinite(qq) ? qq * u[0] : null, u: u ? u[1] : m[2] }; }
  if ((m = s.match(/^Cost items added:\s*(.+)$/))) return { item: m[1].trim() };
  if ((m = s.match(/kg of \d{4}\s+(.+?)\s*\[(.+?)\]/))) return { item: `${m[1].trim()} · ${m[2].trim()}` };
  if ((m = s.match(/Reason:\s*(.+)$/))) return { item: m[1].trim() };
  if (r.vendor) return { item: S(r.vendor) };
  return null;
}
// v1.48–v1.49 (Ken): cost per bottle for the sizes each batch was actually packaged in = wine + packaging materials.
// Wine: each packaging run's wine cost ÷ the bottles it made (wine lost at bottling included). Packaging: the bottles, corks,
// capsules, cages and labels Vintrace consumed in that run (stock events sharing the run's reference) × each item's average unit
// cost on file in Vintrace (as of the last pull). Size from the packaged product (stock item litres per unit), else the run's
// litres per bottle rounded to a standard size.
const SIZES = [0.355, 0.375, 0.5, 0.75, 1.5, 3, 4, 5, 20];
const DRY = ['Bottles-Cans', 'Capsules', 'Corks', 'Wire Cage', 'Labels'];
const sizeName = l => (l === SPK ? 'sparkling 750 ml' : l === 0.355 ? '355 ml can' : l < 1 ? `${Math.round(l * 1000)} ml` : l >= 19 ? `${num(l)} L keg` : `${num(l)} L`);
// v1.50 — Ken's figures (2026-10-13) where Vintrace has no cost: sparkling 750s bottled at Flag Hill ≈ $5,000 per ~1,500
// bottles all in (bottle, cork, cage, CO₂, bottling) + label ~$0.35; Stelvin pressure capsule ≈ 1.5 × a regular Stelvin
// capsule; Winni Rosé and Pear Apple labels ≈ $0.30.
const FLAGHILL = 5000 / 1500, FH_LABEL = 0.35, SPK = 0.7501;
const FILL = { 'lab/rose-gnp': 0.30, 'lab/pa': 0.30 };
const isFlagHill = (code, l, items) => l === 0.75 && /spk|sprk|cirque|bab/i.test(code) && !/can/i.test(code) && !items.some(i => i.code.toLowerCase() === 'cap/mbp');
const showOther = (l, g) => !(l === SPK && !g.has(0.75)) && l !== 0.75 && l !== 0.375 && l !== 4 && l !== 5 && l < 19;   // Ken: cans and 3 L yes; 4 L, 5 L and kegs no
function pkSizes(c, yr, bcode = null) {
  const lpu = new Map(c.all('SELECT lower(code) k, litres_per_unit l FROM stock_item WHERE litres_per_unit > 0').map(r => [r.k, r.l]));
  const ev = c.all(`SELECT batch_code, substr(activity_date,1,10) d, summary, SUM(cost_total) t, MAX(-volume_l) v FROM cost_txn WHERE activity_type LIKE 'Package%'
                    ${yr ? 'AND substr(activity_date,1,4)=?' : ''} ${bcode ? 'AND batch_code=?' : ''} GROUP BY batch_code, activity_date, summary`, ...(yr ? [yr] : []), ...(bcode ? [bcode] : []));
  const fg = new Map();   // product code|day|bottles -> packaging run reference
  for (const r of c.all(`SELECT e.vt_ref ref, lower(s.code) code, substr(e.occurred_at,1,10) d, e.quantity q FROM stock_event e JOIN stock_item s ON s.id=e.item_id
                         WHERE e.action='Package' AND e.quantity>0 AND e.vt_ref IS NOT NULL`)) fg.set(`${r.code}|${r.d}|${Math.round(r.q)}`, r.ref);
  const dg = new Map();
  for (const r of c.all(`SELECT e.vt_ref ref, s.code, s.name, s.category cat, -e.quantity q, s.unit_cost uc FROM stock_event e JOIN stock_item s ON s.id=e.item_id
                         WHERE e.action='Package' AND e.quantity<0 AND e.vt_ref IS NOT NULL AND s.category IN (${DRY.map(() => '?').join(',')})`, ...DRY)) {
    if (!dg.has(r.ref)) dg.set(r.ref, []); dg.get(r.ref).push(r);
  }
  const mbs = c.val("SELECT unit_cost FROM stock_item WHERE lower(code)='cap/mbs'") || 0;
  const fill = code => (code.toLowerCase() === 'cap/mbp' ? 1.5 * mbs : FILL[code.toLowerCase()]);
  const out = new Map();
  for (const e of ev) {
    const m = S(e.summary).match(/^Packaged\s+(\d+)\s+x(\d+)\s+x\s+(.+?)\s+from\s/);
    if (!m || !(e.v > 0)) continue;
    const n = +m[1] * +m[2]; if (!n) continue;
    const code = m[3].toLowerCase();
    let l = lpu.get(code);
    if (!l) { const per = e.v / n; l = SIZES.reduce((a, b) => (Math.abs(b - per) < Math.abs(a - per) ? b : a)); }
    let items = dg.get(fg.get(`${code}|${e.d}|${n}`)) || [];
    const fh = isFlagHill(code, l, items);
    if (fh) l = SPK;   // sparkling 750s kept apart from still 750s of the same batch
    if (!out.has(e.batch_code)) out.set(e.batch_code, new Map());
    const g = out.get(e.batch_code), s0 = g.get(l) || { c: 0, n: 0, L: 0, d: 0, nd: 0, items: new Map(), missing: new Set(), cats: new Set(), est: new Set(), fh: 0 };
    s0.c += -(e.t || 0); s0.n += n; s0.L += e.v;
    if (fh) {   // Flag Hill's fee covers bottle, cork, cage and CO₂ — keep only the labels Vintrace recorded
      const labs = items.filter(i => i.cat === 'Labels');
      items = [{ code: 'flaghill', name: 'Flag Hill bottling (bottle, cork, cage, CO₂) — est.', cat: 'Bottles-Cans', q: n, uc: FLAGHILL, est: 1 },
        ...(labs.length ? labs : [{ code: 'label-est', name: 'Label — est.', cat: 'Labels', q: n, uc: FH_LABEL, est: 1 }])];
      s0.fh += n;
    }
    if (items.length) {
      s0.nd += n;
      for (const it of items) {
        const f = it.uc > 0 ? null : fill(it.code);
        const uc = it.uc > 0 ? it.uc : f > 0 ? f : 0; if (!(it.uc > 0) && !(f > 0)) s0.missing.add(it.code); if (f > 0 || it.est) s0.est.add(it.name || it.code); s0.cats.add(it.cat);
        s0.d += it.q * uc;
        const x = s0.items.get(it.code) || { q: 0, cost: 0, uc: uc, cat: it.cat, name: it.name + (f > 0 ? ' — est.' : '') }; x.q += it.q; x.cost += it.q * uc; s0.items.set(it.code, x);
      }
    }
    g.set(l, s0);
  }
  return out;
}
// per bottle: wine + packaging (packaging averaged over the runs that recorded it); null when nothing was packaged in that size
const perBottle = g => (g && g.n ? { wine: g.c / g.n, pkg: g.nd ? g.d / g.nd : null, full: g.c / g.n + (g.nd ? g.d / g.nd : 0), partial: g.nd && g.nd < g.n, none: !g.nd, missing: g.missing, inc: !!g.nd && (g.missing.size > 0 || !g.cats.has('Bottles-Cans')), nobottle: !!g.nd && !g.cats.has('Bottles-Cans') } : null);
const bottleCell = (g, label = '') => {
  const p = perBottle(g); if (!p) return '';
  const mark = p.none ? '†' : p.inc ? '*' : '';
  const tip = `wine ${money(p.wine)}${p.none ? ' — no packaging recorded' : ` + packaging ${money(p.pkg)}${p.inc ? ' (incomplete)' : ''}`}${g.est && g.est.size ? ' — includes estimates' : ''}`;
  return `<span data-sv="${p.full.toFixed(4)}" title="${E(tip)}" style="white-space:nowrap;cursor:help">${label}${money(p.full)}${mark ? `<sup>${mark}</sup>` : ''}</span>`;
};
const COST_HELP = (c) => {
  const asof = c.val("SELECT MAX(cost_as_of) FROM stock_item WHERE category IN ('Bottles-Cans','Capsules','Corks','Wire Cage','Labels')");
  const nocost = c.all(`SELECT s.code, s.name, -SUM(e.quantity) q FROM stock_event e JOIN stock_item s ON s.id=e.item_id WHERE e.action='Package' AND e.quantity<0
                        AND s.category IN ('Bottles-Cans','Capsules','Corks','Wire Cage','Labels') AND COALESCE(s.unit_cost,0)<=0 GROUP BY s.id ORDER BY 3 DESC`);
  const nocostL = nocost.filter(r => !(String(r.code).toLowerCase() in FILL) && String(r.code).toLowerCase() !== 'cap/mbp');
  return `<details class="cost-help" style="background:var(--card);border:1px solid var(--line);border-left:4px solid #3987e5;border-radius:8px;padding:8px 14px;margin:8px 0 14px;font-size:13.5px"><summary style="cursor:pointer"><b>How the cost per bottle is worked out</b> — wine + packaging materials</summary>
<p><b>$ / 750 ml, $ / 375 ml and Other packages</b> are the true cost of one bottle (or can) as packaged, for the sizes that batch was actually packaged in: <b>wine + packaging</b>. Hover a figure for its two parts; click the batch for the itemised packaging.</p>
<ul><li><b>Wine</b> — everything Vintrace costed into the wine: fruit (delivery cost), bought-in cider or wine (Bulk), additives (honey, sugar, yeast, nutrients, enzymes, SO₂ … at their receipt price; pectic enzymes corrected 2026-10-02) and operations Vintrace costed (filter pads and the like). The cost travels with the wine through transfers, presses and blends; at bottling it moves into the bottles. Wine per bottle = the wine cost of that batch's bottling runs ÷ the bottles they made, so wine lost at bottling is in it.</li>
<li><b>Packaging</b> — the bottles, corks, capsules, wire cages and labels Vintrace recorded as used in each bottling run, at each item's average unit cost on file in Vintrace${asof ? ` (as of ${E(S(asof).slice(0, 10))})` : ''}. Older bottlings are therefore priced at today's dry-goods cost. Check: 23BM (23BBMead, 375 ml) = wine $2.44 + Rocket bottle $1.75 + agglomerated cork $0.16 + capsule $0.04 = $4.39, Vintrace's own unit cost for 23BM.</li>
<li><b>Estimates (Ken, 2026-10-13)</b> — sparkling 750s bottled at Flag Hill (sparkling rosé, Cirque de Strawberry, BaB: sparkling 750 runs without the in-house Stelvin pressure capsule): $5,000 per ~1,500 bottles = $${num(FLAGHILL, 2)} a bottle for bottle, cork, cage, CO₂ and bottling, plus the label Vintrace recorded or ~$${num(FH_LABEL, 2)}; Stelvin pressure capsule = 1.5 × a regular Stelvin capsule; Winni Rosé and Pear Apple labels $0.30.</li>
<li><b>Not included</b> — labour and bottling time (unless entered as an operation cost), cases and cartons, overhead, excise tax, freight and selling costs. Add those on top when setting a retail price.</li>
<li><b>†</b> no packaging materials were recorded for that bottling run, so the figure is wine only. <b>*</b> packaging is incomplete — no bottle or can was recorded for the run, or an item used has no cost on file in Vintrace${nocostL.length ? `: ${nocostL.map(r => `${E(r.name || r.code)} (${num(r.q)} used)`).join(', ')}` : ''}.</li></ul></details>`;
};
const ITEM_WORD = { Additive: 'additive', 'Add costs': 'cost item', 'Intake delivery': 'fruit and grower', Measurement: 'loss reason', 'Bulk intake': 'vendor' };
function p_cost_activity(c, act, yr, item, ys) {
  const rows = c.all(`SELECT * FROM cost_txn WHERE activity_type=? ${yr ? 'AND substr(activity_date,1,4)=?' : ''} ORDER BY activity_date DESC, id DESC`, act, ...(yr ? [yr] : []));
  const P = rows.map(r => ({ r, it: itemOf(r) }));
  const useItems = rows.length && P.filter(p => p.it).length >= rows.length * 0.5;
  const word = ITEM_WORD[act] || 'item';
  const sel = item ? P.filter(p => (p.it ? p.it.item : '(not stated)') === item) : P;
  const sum = a => a.reduce((t, p) => t + (p.r.cost_total || 0), 0);
  const tot = sum(sel);
  const base = `/costs?activity=${encodeURIComponent(act)}`, yq = yr ? '&year=' + yr : '';
  const amt = (u, v) => `${num(v, Math.abs(v) < 10 ? 2 : 0)} ${E(u)}${u === 'kg' ? ` <span class="muted">(${num(v / 0.45359237, Math.abs(v) < 10 ? 1 : 0)} lb)</span>` : ''}`;
  const per = (u, v, t) => (v > 1e-9 ? `${money(t / v)}/${E(u)}${u === 'kg' ? ` <span class="muted">(${money(t / v * 0.45359237)}/lb)</span>` : ''}` : '');
  let html = '';
  if (useItems && !item) {
    const G = new Map();
    for (const p of P) {
      const k = p.it ? p.it.item : '(not stated)', g = G.get(k) || { n: 0, t: 0, q: {}, first: p.r.activity_date, last: p.r.activity_date };
      g.n++; g.t += p.r.cost_total || 0; if (p.it && p.it.q !== null && p.it.q !== undefined) g.q[p.it.u] = (g.q[p.it.u] || 0) + p.it.q;
      if (p.r.activity_date < g.first) g.first = p.r.activity_date; if (p.r.activity_date > g.last) g.last = p.r.activity_date; G.set(k, g);
    }
    const all = [...G.entries()].sort((a, b) => Math.abs(b[1].t) - Math.abs(a[1].t));
    const hasQ = all.some(([, g]) => Object.keys(g.q).length);
    html += `<h2>By ${E(word)} (${all.length})</h2><p class="muted" style="margin-top:-4px;font-size:12.5px">Click one to see every record of it.${hasQ ? ' Amounts are converted to kg, L or units; cost per unit = cost ÷ amount used.' : ''}</p>
<table><thead><tr><th>${E(word[0].toUpperCase() + word.slice(1))}</th><th class="n">Records</th>${hasQ ? '<th class="n">Amount used</th>' : ''}<th class="n">Cost</th>${hasQ ? '<th class="n">Cost per unit</th>' : ''}<th class="n">Share</th><th>First – last</th></tr></thead><tbody>${all.map(([k, g]) => {
      const us = Object.entries(g.q), one = us.length === 1 ? us[0] : null;
      return `<tr><td>${link(`${base}&item=${encodeURIComponent(k)}${yq}`, k)}</td><td class="n">${num(g.n)}</td>${hasQ ? `<td class="n" data-v="${one ? one[1].toFixed(4) : ''}">${us.map(([u, v]) => amt(u, v)).join('<br>')}</td>` : ''}<td class="n" data-v="${g.t.toFixed(2)}">${nw(money(g.t))}</td>${hasQ ? `<td class="n" data-v="${one && one[1] > 1e-9 ? (g.t / one[1]).toFixed(4) : ''}">${one ? nw(per(one[0], one[1], g.t)) : ''}</td>` : ''}<td class="n" data-v="${tot ? (100 * g.t / tot).toFixed(2) : 0}">${tot ? num(100 * g.t / tot, 1) + '%' : ''}</td><td class="muted" style="white-space:nowrap;font-size:12.5px">${E(S(g.first).slice(0, 10))} – ${E(S(g.last).slice(0, 10))}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  // by year and by batch for the selection
  const Y = new Map(), B = new Map();
  for (const p of sel) {
    const y = S(p.r.activity_date).slice(0, 4), b = p.r.batch_code || '(none)';
    const gy = Y.get(y) || { n: 0, t: 0, q: 0, u: '' }; gy.n++; gy.t += p.r.cost_total || 0; if (item && p.it && p.it.q != null) { gy.q += p.it.q; gy.u = p.it.u; } Y.set(y, gy);
    const gb = B.get(b) || { n: 0, t: 0 }; gb.n++; gb.t += p.r.cost_total || 0; B.set(b, gb);
  }
  const yq2 = [...Y.values()].some(g => g.u);
  const ty = table(['Year', 'Records', ...(yq2 ? ['Amount used', 'Cost per unit'] : []), 'Cost'], [...Y.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([y, g]) =>
    [link(`${base}${item ? '&item=' + encodeURIComponent(item) : ''}&year=${y}`, y), num(g.n), ...(yq2 ? [g.u ? amt(g.u, g.q) : '', g.u ? nw(per(g.u, g.q, g.t)) : ''] : []), nw(money(g.t))]), yq2 ? [1, 2, 3, 4] : [1, 2]);
  const bs = [...B.entries()].sort((a, b) => Math.abs(b[1].t) - Math.abs(a[1].t));
  const tb = table(['Batch / cost target', 'Records', 'Cost', 'Share'], bs.slice(0, 40).map(([b, g]) =>
    [link(`/costs?batch=${encodeURIComponent(b)}${yq}`, b), num(g.n), nw(money(g.t)), tot ? num(100 * g.t / tot, 1) + '%' : '']), [1, 2, 3]) + (bs.length > 40 ? `<p class="muted" style="font-size:12px">Top 40 of ${bs.length} batches.</p>` : '');
  const MAX = 800;
  const tl = table(['Date', 'Batch', 'Vessel', ...(useItems ? [word[0].toUpperCase() + word.slice(1)] : []), 'Cost', 'Summary'], sel.slice(0, MAX).map(p => [
    p.r.op_id ? link(`/op/${S(p.r.op_id)}`, S(p.r.activity_date).slice(0, 10)) : E(S(p.r.activity_date).slice(0, 10)), p.r.batch_code ? link(`/costs?batch=${encodeURIComponent(p.r.batch_code)}${yq}`, p.r.batch_code) : '',
    E(p.r.vessel), ...(useItems ? [E(p.it ? p.it.item : '')] : []), nw(money(p.r.cost_total)), `<span class="muted" style="font-size:12px">${E(p.r.summary)}</span>`]), [useItems ? 4 : 3]);
  const f = `<form class="f"><input type="hidden" name="activity" value="${E(act)}">${item ? `<input type="hidden" name="item" value="${E(item)}">` : ''}<label>Year<select name="year">${opts(ys, yr, 'all years')}</select></label><button>Show</button></form>`;
  const dates = sel.map(p => S(p.r.activity_date).slice(0, 10)).filter(Boolean).sort();
  const head = `<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))"><a><b>${money(tot)}</b><span>${E(item || act)}${yr ? ' in ' + E(yr) : ''}</span></a><a><b>${num(sel.length)}</b><span>records</span></a>${dates.length ? `<a><b>${E(dates[0].slice(0, 4))}${dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4) ? '–' + E(dates[dates.length - 1].slice(0, 4)) : ''}</b><span>${E(dates[0])} to ${E(dates[dates.length - 1])}</span></a>` : ''}</div>`;
  const crumbs = [['Costs', '/costs' + (yr ? '?year=' + yr : '')], [act, item ? base + yq : null], ...(item ? [[item, null]] : [])];
  return page(`Costs · ${item || act}`, `<h1>Costs · ${E(act)}${item ? ' · ' + E(item) : ''}</h1><p class="sub">Vintrace cost ledger, ${E(act)} records${yr ? ' in ' + E(yr) : ', all years'}. ${useItems ? `What each record was for is read from its summary line (${E(word)}).` : ''}</p>${f}${head}${html}
    <div class="grid2"><div><h2>By year</h2>${ty}</div><div><h2>By batch</h2>${tb}</div></div><h2>Records (${num(sel.length)}${sel.length > MAX ? `, newest ${MAX} shown` : ''})</h2>${tl}`, '/costs', crumbs);
}

// ---------------------------------------------------------------- work orders
export function p_workorders(c, q) {
  const rows = c.all('SELECT * FROM work_order ORDER BY scheduled_at DESC, vt_id DESC');
  const ops = new Map(c.all("SELECT work_order w, COUNT(*) n FROM operation WHERE work_order IS NOT NULL GROUP BY 1").map(r => [String(r.w), r.n]));
  const t = table(['#', 'Scheduled', 'Finished', 'Summary', 'Jobs', 'Status', 'Assigned to', 'Issued by', 'Ops'], rows.map(r => {
    const jobs = J(r.jobs) || [];
    return [E(r.code), E(S(r.scheduled_at).slice(0, 16)), E(S(r.finished_at).slice(0, 16)), E(r.summary), E(jobs.map(j => j.type || j.text || '').filter(x => x).join(', ').toLowerCase()),
      E(r.status), E(r.assigned_to), E(r.issued_by), ops.has(String(r.code)) ? num(ops.get(String(r.code))) : ''];
  }), [8]);
  return page('Work orders', `<h1>Work orders</h1><p class="sub">From Vintrace (${rows.length}). Day-to-day scheduling now lives on the HW Ferments calendar; this is the history.</p>${t}`, '/ops', [['Operations', '/ops'], ['Work orders', null]]);
}

// ---------------------------------------------------------------- bookings
export function p_bookings(c, q) {
  const yr = qv(q, 'year', '');
  const ys = c.col('SELECT DISTINCT vintage FROM booking ORDER BY 1 DESC').map(String);
  const rows = c.all(`SELECT bk.*, (SELECT COUNT(*) FROM intake i WHERE i.booking_no=bk.booking_no AND i.vintage=bk.vintage) n_in,
                        (SELECT SUM(amount) FROM intake i WHERE i.booking_no=bk.booking_no AND i.vintage=bk.vintage AND i.unit='kg' AND i.reversed=0) kg_in
                      FROM booking bk ${yr ? 'WHERE vintage=?' : ''} ORDER BY arrival_at DESC`, ...(yr ? [Number(yr)] : []));
  const f = `<form class="f"><label>Vintage<select name="year">${opts(ys, yr, 'all')}</select></label><button>Show</button></form>`;
  const t = table(['Booking #', 'Arrival', 'Vintage', 'Grower', 'Vineyard / block', 'Estimate (kg)', 'Delivered (kg)', 'Delivered (lb)'],
    rows.map(r => [E(r.booking_no), E(S(r.arrival_at).slice(0, 16)), E(r.vintage), E(r.grower), E([r.vineyard, r.block].filter(x => x).join(' / ')), num(r.weight_kg), r.kg_in ? `<a href="/intakes?year=${r.vintage}">${num(r.kg_in)}</a>` : '', r.kg_in ? num(r.kg_in / 0.45359237) : '']), [5, 6, 7]);
  return page('Bookings', `<h1>Fruit bookings</h1><p class="sub">From Vintrace (${rows.length}${yr ? ' in ' + E(yr) : ''}). Delivered = intakes recorded against the same booking number and vintage.</p>${f}${t}`, '/intakes', [['Intakes', '/intakes'], ['Bookings', null]]);
}

// ---------------------------------------------------------------- contacts
// Growers, suppliers, carriers: Vintrace parties merged with the cookbook SOURCES tab (products, people, pickup notes).
export function p_contacts(c, q, token, msg = '') {
  const edit = qv(q, 'edit', ''), find = qv(q, 'q', '');
  const rows = c.all(`SELECT p.*, (SELECT COUNT(*) FROM intake i WHERE i.supplier=p.name) n_in FROM party p
    WHERE name NOT IN ('System Administrator','Deli customer') ORDER BY (products IS NULL AND phone IS NULL AND email IS NULL), name COLLATE NOCASE`);
  const nl = s => E(s || '').replace(/\n/g, '<br>');
  const web = w => (w ? `<a href="${E(/^https?:/.test(w) ? w : 'https://' + w)}" target="_blank" rel="noopener">${E(w.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>` : '');
  const tr = rows.map(r => {
    const srch = [r.name, r.aka, r.contact_person, r.products, r.phone, r.email, r.ship_to, r.notes, r.roles].join(' ').toLowerCase();
    return `<tr data-s="${E(srch)}"><td><b>${E(r.name)}</b>${r.aka ? `<br><small class="muted">${E(r.aka)}</small>` : ''}</td><td>${nl(r.contact_person)}</td><td>${nl(r.products)}</td>
      <td style="white-space:nowrap">${E(r.phone || '').split(/[;,] ?/).map(x => x ? `<a href="tel:${E(x.replace(/[^\d+x]/g, ''))}">${E(x)}</a>` : '').join('<br>')}</td>
      <td>${E(r.email || '').split(/, ?/).map(x => x ? `<a href="mailto:${E(x)}">${E(x)}</a>` : '').join('<br>')}</td><td>${web(r.website)}</td>
      <td style="font-size:12px">${nl(r.ship_to || r.address)}${r.notes ? `<br><span class="muted">${nl(r.notes)}</span>` : ''}</td>
      <td>${E((r.roles || '').toLowerCase().replace(/,/g, ', '))}</td><td class="n">${r.n_in ? `<a href="/intakes">${num(r.n_in)}</a>` : ''}</td><td><a href="/contacts?edit=${r.id}#form">edit</a></td></tr>`;
  }).join('');
  const t = `<table id="ct"><thead><tr><th>Name</th><th>Contact</th><th>Products</th><th>Phone</th><th>Email</th><th>Web</th><th>Address / pickup / notes</th><th>Roles</th><th class="n">Intakes</th><th></th></tr></thead><tbody>${tr}</tbody></table>`;
  const p = edit ? c.one('SELECT * FROM party WHERE id=?', Number(edit)) || {} : {};
  const fld = (n, l, w = 24) => `<label>${l}<input name="${n}" size="${w}" value="${E(p[n] || '')}"></label>`;
  const area = (n, l) => `<label class="wide">${l}<textarea name="${n}" rows="2" style="font:inherit;padding:6px;border:1px solid var(--line);border-radius:4px;background:var(--card);color:var(--fg)">${E(p[n] || '')}</textarea></label>`;
  const form = `<form id="form" class="entry" method="post" action="/contacts/save"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="id" value="${E(p.id || '')}">
    ${fld('name', 'Name', 30)}${fld('contact_person', 'Contact person', 22)}${fld('phone', 'Phone(s)', 22)}${fld('email', 'Email(s)', 30)}${fld('website', 'Website', 26)}${fld('roles', 'Roles (Grower, Supplier, Carrier …)', 18)}
    ${area('products', 'Products')}${area('ship_to', 'Address / shipping / pickup')}${area('notes', 'Notes')}
    <div class="actions"><button>${p.id ? 'Save changes' : 'Add contact'}</button> ${p.id ? '<a href="/contacts">Cancel</a>' : ''}</div></form>`;
  const search = `<form class="f" onsubmit="return false"><label>Find<input id="cq" value="${E(find)}" placeholder="name, fruit, person, phone…" autofocus></label><span class="muted" id="cn"></span></form>`;
  const sjs = `<script>(function(){const i=document.getElementById('cq');function f(){const t=i.value.toLowerCase();let n=0;document.querySelectorAll('#ct tbody tr').forEach(r=>{const ok=r.dataset.s.indexOf(t)>=0;r.style.display=ok?'':'none';n+=ok});document.getElementById('cn').textContent=n+' shown'}i.oninput=f;f()})();</script>`;
  return page('Contacts', `<h1>Contacts</h1>${msg}<p class="sub">Growers, suppliers and carriers — from Vintrace, merged with the SOURCES tab of the <a href="https://docs.google.com/spreadsheets/d/1Wp0fCRAR-Zl93V3C7jAvtXUxH99H31Rhe7lceKpR2i8/edit" target="_blank" rel="noopener">HW winemaking cookbook</a>, plus any you add here. Intake suppliers link by name.</p>${search}${t}${sjs}<h2>${p.id ? 'Edit ' + E(p.name) : 'Add a contact'}</h2>${form}`, '/contacts');
}

export function post_contact(c, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  const name = g('name');
  if (!name) return [null, 'Name is required.'];
  for (const em of g('email').split(/[,;] ?/).filter(x => x)) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return [null, `Email "${em}" doesn't look right.`];
  const w = g('website');
  if (w && /\s/.test(w)) return [null, 'Website: one address, no spaces.'];
  const cols = ['name', 'contact_person', 'phone', 'email', 'website', 'roles', 'products', 'ship_to', 'notes'];
  const vals = cols.map(k => g(k) || null);
  if (g('id')) {
    c.run(`UPDATE party SET ${cols.map(k => k + '=?').join(', ')} WHERE id=?`, ...vals, Number(g('id')));
  } else {
    if (c.one('SELECT 1 FROM party WHERE name=?', name)) return [null, `${name} is already in the list — use edit.`];
    c.run(`INSERT INTO party(${cols.join(',')}, source) VALUES (${cols.map(() => '?').join(',')}, 'HWWineTracker')`, ...vals);
  }
  return ['/contacts?saved=1', null];
}
