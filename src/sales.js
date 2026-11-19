// v1.73.0 — Analytics › Sales (desktop). Replaces Ken's WineSalesbySKU workbook: the lead view is his ANNUAL SALES sheet —
// one row per product line (the main wines and can families), with bottled stock, wine in tank, planned production, the
// sales rate, the date each line runs short, his fruit-to-bottle production time, and when the next batch has to start,
// allowing for lines that can be made any time vs only in a season (fall harvest, late June strawberries …).
// Everything is read live from the tracker's own dispatches, stock and bulk snapshots: no Toast data, no costs, no prices.
// Product lines, their SKUs, tank-batch assignments and planned batches are HWWineTracker's own data (sales_* tables),
// seeded once from the ANNUAL SALES sheet and the SKU filters of its per-wine pivot sheets (workbook through Sep 2026),
// and editable on each line's page. Additive tables only; nothing else in the database is changed.
import { E, fxc, today, nowIso, naiveMs, addDays, isoDate } from './lib/py.js';
import { ctx, page } from './core.js';
import { TABS } from './film.js';
import * as stage from './stage.js';

export function ensure_schema(c) {
  c.run(`CREATE TABLE IF NOT EXISTS sales_line(id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER, unit_l REAL, annual_target REAL,
         lead_months REAL, season_months TEXT, season_note TEXT, buffer_months REAL DEFAULT 0, basis TEXT DEFAULT 'measured',
         active INTEGER DEFAULT 1, notes TEXT, updated_at TEXT, by TEXT)`);
  c.run('CREATE TABLE IF NOT EXISTS sales_line_item(item_id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL, auto INTEGER DEFAULT 0)');
  c.run('CREATE TABLE IF NOT EXISTS sales_line_batch(batch_id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL, share REAL DEFAULT 1, auto INTEGER DEFAULT 0)');   // line_id 0 = not for a product line
  c.run('CREATE TABLE IF NOT EXISTS sales_plan(id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL, ready_month TEXT NOT NULL, units REAL NOT NULL, note TEXT, at TEXT, by TEXT)');
  c.run('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT)');
  if (!c.val("SELECT value FROM app_meta WHERE key='sales_seeded'") && !c.val('SELECT COUNT(*) n FROM sales_line')) seed(c);
}

// ---- seed: Ken's ANNUAL SALES sheet (WineSalesbySKU_Jan2021thruSeptember2026.xlsx). target = col D "Ave. Annual Sales in
// bottles/cans", lead = col S "Production time from Fruit to Bottle (yrs)" × 12, unit = col B. SKUs = the Stock item filter of
// that line's pivot sheet, plus newer vintages from name_map.json. Seasons only where a sheet note says so (quoted).
const ALL = '1,2,3,4,5,6,7,8,9,10,11,12';
const SEED = [
  ['Hermitage', 0.75, 600, 24, null, null, '17Herm 18HERM 19Herm 20Herm 21Herm 22Herm'],
  ['Lake House Red (LHR)', 0.75, 100, 18, null, null, '18LHR 19LHR 20LHR 21LHR 22LHR'],
  ['Lake House White (LHW)', 0.75, 500, 18, '7,8', 'LHW sheet: “LHW only made in July-August each year”', '18LHW 19LHW 20LHW 21LHW 22LHW 23LHW'],
  ['Meredith Bay White (MBW)', 0.75, 1000, 12, null, null, '21MBW 22MBW 23MBW 24MBW 25MBW'],
  ['Winni White (WW, MMW, Ozark)', 0.75, 800, 12, null, null, '18WW 21WW 22WW 23MMW 22Ozark 24Ozark 24MMW 24WW 25WW'],
  ['Winni Rosé', 0.75, 1500, 12, '9,10,11', 'Rose sheet: “ROSE only made in the Fall each year”', '19ROSE 19ROSECORK 19ROSEGMP 20Rose 21Rose 22Rose 23Rose 25Rose'],
  ['Sparkling Rosé 750', 0.75, 1100, 12, '9,10,11', 'Rose sheet: “ROSE only made in the Fall each year”; 2025Production: sparkling “can only bottle in Spring”', '19SpkRose 19SPKROSE_ 20SpkRose 20SpkRose_ 21SpkRoseF 23SpkRose'],
  ['Red Scare', 0.75, 1000, 18, '10,11', 'RS sheet: “REDSCARE only made in late Fall each year”', '18RS 19RS 19RS-5L 20RS 21RS-SF 21RS 22RS 23RS'],
  ['Deep Blue / DBR (375)', 0.375, 900, 24, null, null, '17DBR 19DB 19DB2 19DBR 20DB 20DBR 21DBry 21DB 22DB 23DB 21DBR 2025DB'],
  ['Strawberry Rhubarb', 0.75, 1000, 12, '6', 'Strawberry sheet: “STRAW only made in late JUNE each year”', '19STRAW 20STRAW 21Straw 21Straw2 22straw 23Straw'],
  ['Petite Blue Reserve (PBR)', 0.75, 1200, 12, ALL, 'PBR sheet: “WE can make PB/PBR at any time and need 7 months before bottling”', '18PBR2 19PBR 20PBR 21PBR-SF 21PBR 22PBR 25PBR'],
  ['Wine cans', 0.355, 3000, 12, null, null, '19Dolgo 19PB2CAN 19SPKROSECAN2 19SpkRoseCAN 22Dolgo 22SpkRose_Can 23SprkStrawCAN 23SpkRoseCANS 24SIS 24SpkStrawCAN 24DolgoCan 25BaB_CAN 25BaB 25Rose_CAN'],
  ['Three Honey / 3HG (375)', 0.375, 400, 12, null, null, '183H 193H 193HG 203HG 213H 213HG 223HG 233HG1 243H 243HG'],
  ['Heirloom Crabapple', 0.75, 1000, 12, null, null, '19CRAB 21Crab 22Crab 24CRAB'],
  ['Northern Berry Red (NBR)', 0.75, 300, 12, '9', 'NBR sheet: “NBR only made in Sept. each year”', '19HB 20NBR 21NBR 22nbr 23NBR 24NBR'],
  ['Kittens hard cider 750', 0.75, 1000, 12, null, null, '19HC 20HC 21HC 22HC 23HC 25Kittens'],
  ['Petite Blue (PB)', 0.75, 2500, 9.6, ALL, 'PB sheet: “WE can make PB/PBR at any time and need 7 months before bottling”', '19PB 19PB2 20PB 20PB2 21PB 22PB'],
  ['Cider & session cans', 0.355, 4500, 3.6, null, null, '20CranCider5CAN 21CranCiderCAN 21CranCiderCAN23 20CranCCan 20CRANCAN 23CCQuadCAN 23HLC 24MulledCranCiderCANS 24CCQuadCAN 25CranCAN 24CiderLG 24HLC 25MCC-CANS 25CranCider2CAN 25FP_CANS 25HC 25HCider 25HCider_CAN 25HC_CANS 25CranCider3CAN 26HLC_CAN 26HC_CAN'],
  ['Blueberry Cider (cans & 750)', 0.55, 2000, 15.6, null, null, '20BC 22Bcider 22BC 22BC-CAN 24BC_750ml 24BC_CAN 24CAN_BC 25BCCan 25BCider 25BC3 25BC_CAN'],
  ['Cranberry Cider 750', 0.75, 2000, 3.6, null, null, '20CRANCIDER3 20CranCider4 20CranCider5 21CranCider 21CranCIDER2 22CranCider_750ml 23CranCider 23CRANCIDRE 24CranCider750 25CranCider_750ml 25MCC_750ml 25CranCider750ml 25CranCider3 26CranCider750 26MCC'],
];
// wine in tank on 2026-11-18, by batch code → seeded line (auto=1: shown as "assigned automatically — check")
const SEED_TANK = { 'Petite Blue (PB)': '25PB', 'Blueberry Cider (cans & 750)': '26BlueCider', 'Red Scare': '25RS', 'Strawberry Rhubarb': '26Straw2 26StrawHG 24Straw 23STRAW',
  'Winni Rosé': '25Rose', 'Heirloom Crabapple': '25Crab', 'Lake House White (LHW)': '24LHW', 'Winni White (WW, MMW, Ozark)': '26WW 26WW-Plum',
  'Cranberry Cider 750': '26CranCider 25CranCider3', 'Three Honey / 3HG (375)': '253HG', 'Cider & session cans': '26Cider2', 'Hermitage': '25Herm' };

function seed(c) {
  const item = new Map(c.all('SELECT id, code FROM stock_item WHERE is_finished=1').map(r => [r.code.replace(/ /g, '_'), r.id]));
  const bat = new Map(c.all('SELECT id, code FROM batch').map(r => [r.code, r.id]));
  SEED.forEach(([name, unit, target, lead, months, note, codes], i) => {
    const id = c.run(`INSERT INTO sales_line(name, sort, unit_l, annual_target, lead_months, season_months, season_note, buffer_months, basis, active, updated_at, by)
                      VALUES (?,?,?,?,?,?,?,0,'measured',1,?,?)`, name, (i + 1) * 10, unit, target, lead, months, note, nowIso(), 'seed: ANNUAL SALES sheet').id;
    for (const code of codes.split(' ')) { const iid = item.get(code); if (iid) c.run('INSERT OR IGNORE INTO sales_line_item(item_id, line_id, auto) VALUES (?,?,0)', iid, id); }
    for (const code of (SEED_TANK[name] || '').split(' ').filter(Boolean)) { const b = bat.get(code); if (b) c.run('INSERT OR IGNORE INTO sales_line_batch(batch_id, line_id, share, auto) VALUES (?,?,1,1)', b, id); }
  });
  c.run("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('sales_seeded', ?)", nowIso());
}

// ---- month helpers ('YYYY-MM')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mAdd = (m, n) => { const y = +m.slice(0, 4), k = +m.slice(5, 7) - 1 + n; return `${y + Math.floor(k / 12)}-${String(((k % 12) + 12) % 12 + 1).padStart(2, '0')}`; };
const mDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const dim = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const mLabel = m => `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const dLabel = d => d ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '';
const monthDate = (m, frac) => isoDate(naiveMs(`${m}-01`) + Math.min(0.999, Math.max(0, frac)) * dim(m) * 86400000);   // a point inside month m
const addMonthsDate = (d, n) => { const whole = Math.floor(n), m = mAdd(d.slice(0, 7), whole), day = Math.min(+d.slice(8, 10), dim(m)); return addDays(`${m}-${String(day).padStart(2, '0')}`, Math.round((n - whole) * 30.44)); };
const n0 = x => (x === null || x === undefined || !isFinite(x)) ? '' : fxc(Math.round(x), 0);
const n1 = x => (x === null || x === undefined || !isFinite(x)) ? '' : fxc(x, 1);

export const TYPES = ['Tasting Room Sales', 'Tasting room Samples', 'Vinoshipper sale', 'Eatery Transfer', 'Wholesale', 'NH State LC', 'Family Use'];
const WEEKLY = new Set(['Tasting room Samples', 'Family Use']);   // booked through the month; the rest are month-end dispatches from Jen's reports
const TCOL = { 'Tasting Room Sales': '#388bfd', 'Tasting room Samples': '#d29922', 'Vinoshipper sale': '#a371f7', 'Eatery Transfer': '#3fb950', 'Wholesale': '#db6d28', 'NH State LC': '#f778ba', 'Family Use': '#8b949e' };

function chosenTypes(q) {
  const t = (q.t || []).filter(x => TYPES.includes(x) || x === 'other');
  return t.length ? new Set(t) : null;   // null = every dispatch type
}

// ---- the model: one object per line
export function model(c, q = {}) {
  const now = today(), curM = now.slice(0, 7);
  const lastBooked = (c.val("SELECT substr(MAX(occurred_at),1,7) m FROM dispatch WHERE reversed=0 AND dispatch_type='Tasting Room Sales'") || mAdd(curM, -1));
  const types = chosenTypes(q);
  const useType = t => !types || types.has(TYPES.includes(t) ? t : 'other');
  const w0 = mAdd(lastBooked, -35);   // 36 complete months ending at the last booked month
  const lines = c.all('SELECT * FROM sales_line ORDER BY active DESC, sort, id');
  const L = new Map(lines.map(l => [l.id, { ...l, items: [], tank: [], plans: [], monthly: new Map(), byType: new Map() }]));
  const items = c.all(`SELECT si.id, si.code, si.description, si.inactive, si.litres_per_unit l, sli.line_id, sli.auto,
                       COALESCE((SELECT SUM(e.quantity) FROM stock_event e WHERE e.item_id=si.id),0) oh
                       FROM stock_item si LEFT JOIN sales_line_item sli ON sli.item_id=si.id WHERE si.is_finished=1`);
  const itemLine = new Map();
  for (const it of items) if (it.line_id && L.has(it.line_id)) { L.get(it.line_id).items.push(it); itemLine.set(it.id, it.line_id); }
  // monthly outflow per item (all history from w0; the History tab reads its own range)
  const out = c.all(`SELECT dl.item_id iid, substr(d.occurred_at,1,7) m, d.dispatch_type t, SUM(dl.quantity) qty FROM dispatch d JOIN dispatch_line dl ON dl.dispatch_id=d.id
                     WHERE d.reversed=0 AND d.occurred_at>=? GROUP BY dl.item_id, m, t`, `${w0}-01`);
  const itemT12 = new Map(), itemLast = new Map();
  for (const r of out) {
    if (!useType(r.t)) continue;
    if (mDiff(r.m, lastBooked) < 12 && mDiff(r.m, lastBooked) >= 0) itemT12.set(r.iid, (itemT12.get(r.iid) || 0) + r.qty);
    const ln = L.get(itemLine.get(r.iid));
    if (!ln) continue;
    ln.monthly.set(r.m, (ln.monthly.get(r.m) || 0) + r.qty);
    const k = `${r.m}|${r.t}`; ln.byType.set(k, (ln.byType.get(k) || 0) + r.qty);
  }
  for (const r of c.all('SELECT dl.item_id iid, MAX(d.occurred_at) t FROM dispatch d JOIN dispatch_line dl ON dl.dispatch_id=d.id WHERE d.reversed=0 GROUP BY dl.item_id')) itemLast.set(r.iid, r.t);
  // wine in tank now (latest bulk snapshot), with the batch's stage and the first day it was in a tank
  const snapDate = c.val('SELECT MAX(snap_date) d FROM bulk_snapshot');
  const tank = snapDate ? c.all(`SELECT s.batch_id bid, b.code, b.description, SUM(s.volume_l) L, GROUP_CONCAT(v.code, ', ') vessels, slb.line_id, slb.share, slb.auto
                                 FROM bulk_snapshot s JOIN batch b ON b.id=s.batch_id LEFT JOIN vessel v ON v.id=s.vessel_id LEFT JOIN sales_line_batch slb ON slb.batch_id=s.batch_id
                                 WHERE s.snap_date=? AND s.volume_l>0.5 GROUP BY s.batch_id ORDER BY L DESC`, snapDate) : [];
  const bids = tank.map(t => t.bid);
  const first = new Map(bids.length ? c.all(`SELECT batch_id bid, MIN(snap_date) d FROM bulk_snapshot WHERE batch_id IN (${bids.map(() => '?').join(',')}) GROUP BY batch_id`, ...bids).map(r => [r.bid, r.d]) : []);
  const stages = stage.current_map(c);
  for (const t of tank) {
    t.first = first.get(t.bid) || null;
    t.stage = (stages.get(t.bid) || {}).stage || null;
    const ln = L.get(t.line_id);
    if (!ln) continue;
    const share = t.share === null || t.share === undefined ? 1 : t.share;
    t.units = t.L * share / (ln.unit_l || 0.75);
    if (t.stage === 'ready') { t.ready = now; t.readyWhy = 'Ready for packaging'; }
    else if (t.first && ln.lead_months) {
      const est = addMonthsDate(t.first, ln.lead_months);
      t.ready = est > now ? est : now; t.readyWhy = est > now ? `in tank since ${dLabel(t.first)} + ${n1(ln.lead_months)} mo production time` : `production time from ${dLabel(t.first)} has passed`;
    } else { t.ready = now; t.readyWhy = 'no production time set'; }
    ln.tank.push(t);
  }
  for (const p of c.all('SELECT * FROM sales_plan ORDER BY ready_month, id')) if (L.has(p.line_id)) L.get(p.line_id).plans.push(p);
  // per line: rates, seasonal profile, projection, dates
  const elapsed = mDiff(lastBooked, curM) - 1 + (+now.slice(8, 10)) / dim(curM);   // months of sales not yet booked (Jen's month-end dispatches)
  for (const ln of L.values()) calc(ln, { now, curM, lastBooked, elapsed: Math.max(0, elapsed), useType });
  const lineList = [...L.values()];
  const unlinedItems = items.filter(it => !itemLine.has(it.id) && (Math.round(it.oh) !== 0 || (itemT12.get(it.id) || 0) > 0))
    .map(it => ({ ...it, t12: itemT12.get(it.id) || 0, last: itemLast.get(it.id) || null })).sort((a, b) => b.oh - a.oh);
  for (const ln of lineList) for (const it of ln.items) { it.t12 = itemT12.get(it.id) || 0; it.last = itemLast.get(it.id) || null; }
  const unlinedTank = tank.filter(t => t.line_id === null || t.line_id === undefined);
  return { now, curM, lastBooked, elapsed: Math.max(0, elapsed), snapDate, types, lines: lineList, unlinedItems, unlinedTank, ignoredTank: tank.filter(t => t.line_id === 0) };
}

function calc(ln, { now, curM, lastBooked, elapsed, useType }) {
  const w = k => ln.monthly.get(mAdd(lastBooked, -k)) || 0;
  let t12 = 0, t3 = 0, p12 = 0, sales12 = 0;
  for (let k = 0; k < 12; k++) t12 += w(k);
  for (let k = 0; k < 3; k++) t3 += w(k);
  for (let k = 12; k < 24; k++) p12 += w(k);
  for (const [key, v] of ln.byType) { const [m, t] = key.split('|'); const d = mDiff(m, lastBooked); if (d >= 0 && d < 12 && !WEEKLY.has(t)) sales12 += v; }
  // seasonal profile: pooled share of each calendar month over the complete 12-month blocks ending at the last booked month,
  // blended with a flat year (weight 1 against the number of blocks) so one odd year can't dominate
  const blocks = [0, 1, 2].filter(b => { let s = 0; for (let k = 0; k < 12; k++) s += w(12 * b + k); return s > 0; });
  const cal = new Array(12).fill(0); let tot = 0;
  for (const b of blocks) for (let k = 0; k < 12; k++) { const m = mAdd(lastBooked, -(12 * b + k)); cal[+m.slice(5, 7) - 1] += w(12 * b + k); tot += w(12 * b + k); }
  const prof = cal.map(v => (blocks.length * (tot ? v / tot : 1 / 12) + 1 / 12) / (blocks.length + 1));
  const ps = prof.reduce((s, v) => s + v, 0); for (let i = 0; i < 12; i++) prof[i] /= ps;
  ln.prof = prof; ln.blocks = blocks.length;
  ln.t12 = t12; ln.t3 = t3; ln.p12 = p12; ln.sales12 = sales12;
  ln.annual = ln.basis === 'target' && ln.annual_target ? ln.annual_target : t12;
  ln.onhand = ln.items.reduce((s, it) => s + it.oh, 0);
  // sales Jen has not booked yet (month-end dispatch types only; samples and family use are booked as they happen)
  const salesAnnual = ln.basis === 'target' && ln.annual_target && t12 ? ln.annual_target * sales12 / t12 : sales12;
  let unb = 0;
  for (let k = 1; k <= Math.ceil(elapsed); k++) { const m = mAdd(lastBooked, k); unb += salesAnnual * prof[+m.slice(5, 7) - 1] * Math.min(1, elapsed - (k - 1)); }
  ln.unbooked = unb;
  ln.est = Math.max(0, ln.onhand - unb);
  ln.tankUnits = ln.tank.reduce((s, t) => s + (t.units || 0), 0);
  ln.planUnits = ln.plans.reduce((s, p) => s + p.units, 0);
  // projection, month by month from today (60 months); supplies arrive on their ready dates
  const sup = [...ln.tank.map(t => ({ d: t.ready, u: t.units || 0 })), ...ln.plans.map(p => ({ d: `${p.ready_month}-01` < now ? now : `${p.ready_month}-01`, u: p.units }))].sort((a, b) => a.d < b.d ? -1 : 1);
  const thr = (ln.buffer_months || 0) * ln.annual / 12;
  const run = (withSupply) => {
    let s = ln.est, out = null; const track = [];
    let si = 0;
    for (let k = 0; k < 60; k++) {
      const m = mAdd(curM, k), f0 = k === 0 ? (+now.slice(8, 10)) / dim(m) : 0;
      const dm = ln.annual * prof[+m.slice(5, 7) - 1];
      // within the month: supplies first (if they land this month), then the month's demand spread evenly
      const arr = []; while (withSupply && si < sup.length && sup[si].d.slice(0, 7) <= m) arr.push(sup[si++]);
      const start = s;
      if (arr.length) { for (const a of arr) s += a.u; }
      const need = dm * (1 - f0);
      if (out === null && dm > 0 && s - need < thr) { const frac = need > 0 ? Math.max(0, (s - thr) / dm) : 0; out = monthDate(m, f0 + frac); }
      s -= need;
      track.push({ m, start, end: s, cover: dm > 0 ? s / (ln.annual / 12) : null, arr: arr.reduce((t, a) => t + a.u, 0) });
    }
    return { out, track };
  };
  const a = run(false), b = run(true);
  ln.outBottled = ln.annual > 0 ? a.out : null; ln.outAll = ln.annual > 0 ? b.out : null; ln.track = b.track;
  ln.yrsBottled = ln.annual > 0 ? ln.est / ln.annual : null;
  ln.yrsAll = ln.annual > 0 ? (ln.est + ln.tankUnits + ln.planUnits) / ln.annual : null;
  // start the next batch by: run-out (incl. tank and plans) minus production time, moved back to an allowed season month
  ln.startBy = null; ln.status = 'none';
  if (!ln.annual) { ln.status = 'nosales'; return; }
  if (!ln.outAll) { ln.status = 'far'; return; }
  if (!ln.lead_months) { ln.status = 'nolead'; return; }
  let s = addMonthsDate(ln.outAll, -ln.lead_months);
  const months = ln.season_months ? ln.season_months.split(',').map(Number).filter(x => x >= 1 && x <= 12) : [];
  if (months.length && months.length < 12) {
    let m = s.slice(0, 7), guard = 0;
    while (!months.includes(+m.slice(5, 7)) && guard++ < 13) m = mAdd(m, -1);
    if (m !== s.slice(0, 7)) s = `${m}-${String(dim(m)).padStart(2, '0')}`;
  }
  ln.startBy = s;
  const days = (naiveMs(s) - naiveMs(now)) / 864e5;
  ln.status = days < 0 ? 'late' : days <= 92 ? 'soon' : 'ok';
}

// ---- pieces of HTML
const CSS = `<style>
.sl-kpi{display:flex;flex-wrap:wrap;gap:8px 18px;margin:4px 0 12px;font-size:13px;color:var(--mut)}.sl-kpi b{color:var(--fg2);font-weight:600}
.sl-st{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;white-space:nowrap}
.sl-late{background:rgba(248,81,73,.16);color:#ffb3ad}.sl-soon{background:rgba(210,153,34,.16);color:#f0d79a}.sl-ok{background:rgba(63,185,80,.13);color:#9be9a8}.sl-none{background:var(--hi);color:var(--mut)}
table.sl td{white-space:nowrap;padding:7px 8px}table.sl th{padding:7px 8px}table.sl td small{white-space:normal;max-width:190px}table.sl td.w{white-space:normal;min-width:160px;max-width:230px}tr.off td{opacity:.55}
.sl-types{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px;align-items:center;font-size:13px}.sl-types a{padding:3px 10px;border:1px solid var(--line2);border-radius:14px;color:var(--mut);background:var(--card)}
.sl-types a.on{color:var(--fg2);border-color:var(--acc);background:var(--blue-t)}.sl-types a:hover{text-decoration:none}
.sl-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px 16px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:14px;max-width:1100px}
.sl-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--mut);font-weight:600}.sl-form .wide{grid-column:1/-1}
.sl-mo{display:flex;flex-wrap:wrap;gap:4px}.sl-mo label{flex-direction:row;align-items:center;gap:3px;font-weight:400;color:var(--fg);font-size:12.5px;border:1px solid var(--line2);border-radius:5px;padding:2px 6px}
.sl-help{font-size:12.5px;color:var(--mut);max-width:1100px}.sl-help b{color:var(--fg)}
details.sl-d{margin:10px 0}details.sl-d summary{cursor:pointer;color:var(--acc);font-size:13px}
</style>`;

function typeChips(q, base) {
  const t = chosenTypes(q);
  const href = set => base + (set && set.size ? (base.includes('?') ? '&' : '?') + [...set].map(x => 't=' + encodeURIComponent(x)).join('&') : '');
  const one = ty => { const s = new Set(t || []); if (t && s.has(ty)) s.delete(ty); else s.add(ty); return `<a class="${t && t.has(ty) ? 'on' : ''}" href="${E(href(s))}"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${TCOL[ty]};margin-right:5px"></i>${E(ty)}</a>`; };
  return `<div class="sl-types"><span class="muted">Dispatch types counted:</span><a class="${t ? '' : 'on'}" href="${E(href(null))}">All</a>${TYPES.map(one).join('')}</div>`;
}
const keepT = q => (q.t || []).map(x => '&t=' + encodeURIComponent(x)).join('');

function statusPill(ln) {
  const map = { late: ['sl-late', 'Overdue'], soon: ['sl-soon', '< 3 months'], ok: ['sl-ok', 'OK'], far: ['sl-ok', '5+ yrs'], nosales: ['sl-none', 'No sales'], nolead: ['sl-none', 'No prod. time'] };
  const [cls, txt] = map[ln.status] || ['sl-none', '—'];
  return `<span class="sl-st ${cls}">${txt}</span>`;
}

// 24-month strip: each month coloured by months of stock left at its end (incl. tank and plans); ▲ = wine coming ready
function strip(ln, n = 24) {
  if (!ln.track || !ln.annual) return '<span class="muted">—</span>';
  const W = 9, H = 16, out = [`<svg width="${n * W}" height="${H + 6}" viewBox="0 0 ${n * W} ${H + 6}" role="img">`];
  ln.track.slice(0, n).forEach((t, i) => {
    const cv = t.cover, col = cv === null ? '#30363d' : cv <= 0 ? '#f85149' : cv < 2 ? '#db6d28' : cv < 6 ? '#d29922' : '#2ea043';
    out.push(`<rect x="${i * W}" y="4" width="${W - 1.5}" height="${H - 4}" rx="1.5" fill="${col}" fill-opacity="${cv !== null && cv <= 0 ? .55 : .85}"><title>${mLabel(t.m)}: ${cv === null ? 'no demand' : n0(t.end) + ' left at month end (' + n1(cv) + ' months)'}${t.arr ? ' · +' + n0(t.arr) + ' coming ready' : ''}</title></rect>`);
    if (t.arr) out.push(`<path d="M${i * W + W / 2 - 3.5} 3.5 L${i * W + W / 2 + 2.5} 3.5 L${i * W + W / 2 - .5} 0 Z" fill="#c9d1d9"/>`);
    if (t.m.endsWith('-01')) out.push(`<line x1="${i * W - .75}" x2="${i * W - .75}" y1="2" y2="${H + 6}" stroke="#8b949e" stroke-width=".8"/>`);
  });
  out.push('</svg>');
  return out.join('');
}

function head(m, q) {
  const tnote = m.types ? `<b>${[...m.types].join(', ')}</b> only` : 'all dispatch types';
  return `<div class="sl-kpi"><span>Sales booked through <b>${mLabel(m.lastBooked)}</b> (last month with Tasting Room Sales dispatched)</span>
    <span>Rates: <b>12 months to ${mLabel(m.lastBooked)}</b>, ${tnote}</span><span>Tank volumes from the bulk snapshot of <b>${dLabel(m.snapDate)}</b></span><span>Today ${dLabel(m.now)}</span></div>`;
}

const SUBTABS = (on, q) => `<div class="tabs" style="margin:0 0 14px"><a class="${on === 'annual' ? 'on' : ''}" href="/analytics/sales${q ? '?' + q : ''}">Annual sales &amp; runway</a><a class="${on === 'hist' ? 'on' : ''}" href="/analytics/sales/history${q ? '?' + q : ''}">Sales history</a></div>`;

// ---- Annual sales (lead view)
export function page_sales(c, q) {
  const m = model(c, q);
  const tq = keepT(q).slice(1);
  const rows = m.lines.filter(l => l.active).map(ln => {
    const oh = ln.items.filter(it => Math.round(it.oh) !== 0).sort((a, b) => a.code < b.code ? -1 : 1).map(it => `${E(it.code)} ${n0(it.oh)}`).join(' · ');
    const season = ln.season_months ? (ln.season_months.split(',').length >= 12 ? 'Any time' : ln.season_months.split(',').map(x => MON[+x - 1]).join(', ')) : '<span class="muted">not set</span>';
    const lead = ln.lead_months ? `${n1(ln.lead_months)} mo` : '<span class="muted">not set</span>';
    return `<tr>
      <td class="w"><a href="/analytics/sales/line?id=${ln.id}${keepT(q)}"><b>${E(ln.name)}</b></a><small>${oh || 'no bottled stock'}</small></td>
      <td class="n" data-v="${Math.round(ln.est)}">${n0(ln.est)}<small>${ln.unbooked >= 0.5 ? `${n0(ln.onhand)} on hand − ${n0(ln.unbooked)} unbooked` : 'on hand'}</small></td>
      <td class="n" data-v="${Math.round(ln.tankUnits)}">${ln.tankUnits ? n0(ln.tankUnits) : ''}<small>${ln.tank.length ? ln.tank.map(t => E(t.code)).join(', ') : ''}</small></td>
      <td class="n">${ln.planUnits ? n0(ln.planUnits) : ''}</td>
      <td class="n" data-v="${Math.round(ln.t12)}">${n0(ln.t12)}<small>last 3 mo ×4: ${n0(ln.t3 * 4)}</small></td>
      <td class="n">${n0(ln.annual_target)}${ln.basis === 'target' ? '<small>used for runway</small>' : ''}</td>
      <td class="n" data-v="${ln.yrsBottled ?? ''}">${ln.yrsBottled === null ? '' : n1(ln.yrsBottled)}</td>
      <td class="n" data-v="${ln.yrsAll ?? ''}">${ln.yrsAll === null ? '' : n1(ln.yrsAll)}</td>
      <td data-v="${ln.outBottled || '9999'}">${ln.outBottled ? dLabel(ln.outBottled) : ln.annual ? '5+ yrs' : ''}</td>
      <td data-v="${ln.outAll || '9999'}">${ln.outAll ? dLabel(ln.outAll) : ln.annual ? '5+ yrs' : ''}</td>
      <td>${lead}</td><td class="w" style="min-width:90px">${season}</td>
      <td data-v="${ln.startBy || '9999'}"><b>${ln.startBy ? dLabel(ln.startBy) : ''}</b> ${statusPill(ln)}</td>
      <td>${strip(ln)}</td></tr>`;
  }).join('');
  const off = m.lines.filter(l => !l.active);
  const otherItems = m.unlinedItems.filter(it => Math.round(it.oh) > 0 || it.t12 > 0);
  const lineOpts = m.lines.map(l => `<option value="${l.id}">${E(l.name)}</option>`).join('');
  const T = ctx.token;
  const other = otherItems.length ? `<h2>Bottled stock not in a product line (${otherItems.length})</h2>
    <p class="sl-help">These SKUs have stock or sales in the last 12 months but belong to no line above, so they are not in any runway. Add one to a line, or leave it out (one-offs, library wines).</p>
    <table><thead><tr><th>SKU</th><th>Description</th><th class="n">On hand</th><th class="n">Out, 12 mo</th><th>Last dispatch</th><th>Add to line</th></tr></thead><tbody>
    ${otherItems.map(it => `<tr><td><a href="/item/${it.id}">${E(it.code)}</a>${it.inactive ? ' <span class="tag">inactive</span>' : ''}</td><td>${E(it.description || '')}</td><td class="n">${n0(it.oh)}</td><td class="n">${n0(it.t12)}</td><td>${dLabel(String(it.last || '').slice(0, 10))}</td>
      <td><form method="post" action="/analytics/sales/item" style="display:flex;gap:6px;margin:0"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="item_id" value="${it.id}"><input type="hidden" name="back" value="/analytics/sales"><select name="line_id"><option value="">—</option>${lineOpts}</select><button>Add</button></form></td></tr>`).join('')}
    </tbody></table>` : '';
  const ut = m.unlinedTank.length ? `<h2>Wine in tank not assigned to a line (${m.unlinedTank.length})</h2>
    <p class="sl-help">Assign a batch to the line it will be bottled as, so it counts toward that line's runway; or mark it “not for a line” (blending components, experiments).</p>
    <table><thead><tr><th>Batch</th><th>Vessels</th><th class="n">Litres</th><th class="n">Gallons</th><th>Stage</th><th>Assign</th></tr></thead><tbody>
    ${m.unlinedTank.map(t => `<tr><td><a href="/batch/${t.bid}">${E(t.code)}</a><small>${E(t.description || '')}</small></td><td>${E(t.vessels || '')}</td><td class="n">${n0(t.L)}</td><td class="n">${n0(t.L / 3.785411784)}</td><td>${t.stage ? stage.pill(t.stage) : ''}</td>
      <td><form method="post" action="/analytics/sales/batch" style="display:flex;gap:6px;margin:0"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="batch_id" value="${t.bid}"><input type="hidden" name="back" value="/analytics/sales"><select name="line_id"><option value="">—</option><option value="0">Not for a line</option>${lineOpts}</select><button>Save</button></form></td></tr>`).join('')}
    </tbody></table>` : '';
  const ign = m.ignoredTank.length ? `<p class="sl-help">Not for a line: ${m.ignoredTank.map(t => `<a href="/batch/${t.bid}">${E(t.code)}</a> ${n0(t.L)} L`).join(' · ')}.</p>` : '';
  const body = `${CSS}${TABS('sales')}${SUBTABS('annual', tq)}<h1>Annual sales &amp; runway</h1>${q.saved ? '<div class="ok">Saved.</div>' : ''}${head(m, q)}${typeChips(q, '/analytics/sales')}
    <table class="sl"><thead><tr><th>Product line</th><th class="n">Bottled<br>est. now</th><th class="n">In tank<br>(units)</th><th class="n">Planned</th><th class="n">Sold, last<br>12 months</th><th class="n">Your annual<br>figure</th>
    <th class="n">Years<br>bottled</th><th class="n">Years incl.<br>tank &amp; plans</th><th>Bottled<br>runs out</th><th>Runs out incl.<br>tank &amp; plans</th><th>Production<br>time</th><th>Can start</th><th>Start next<br>batch by</th><th>Next 24 months</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <details class="sl-d"><summary>How these numbers are worked out</summary><div class="sl-help">
    <p><b>Bottled est. now</b> = on hand in the tracker today minus the sales not yet booked. Jen's tasting-room, Vinoshipper, eatery, wholesale and NHLC sales go in once a month; samples and family use go in as they happen. So after the last booked month (${mLabel(m.lastBooked)}) the month-end types are estimated: the line's yearly month-end sales × each month's seasonal share × the part of the month elapsed (${n1(m.elapsed)} months so far).</p>
    <p><b>Sold, last 12 months</b> = bottles/cans dispatched (types chosen above) in the 12 months ending ${mLabel(m.lastBooked)}. This is the runway rate unless a line is set to use <b>your annual figure</b> (seeded from the ANNUAL SALES sheet, column D).</p>
    <p><b>Seasonal shape</b>: each calendar month's share of the year, pooled over up to three complete 12-month blocks of the line's own history and blended with a flat year (weight 1 against the number of blocks), so July draws down faster than February.</p>
    <p><b>In tank</b> = litres in the latest bulk snapshot × the line's share ÷ the line's unit size (0.75, 0.375 or 0.355 L; 0.55 for mixed cans/750s). Bottling losses are not taken off. A batch counts as ready on the day it is marked Ready for packaging; otherwise on its first day in a tank + the production time (or today, if that has passed). <b>Planned</b> batches count from the first of their ready month.</p>
    <p><b>Runs out</b> = the date the projected stock falls below the line's safety buffer (0 months unless set). <b>Start next batch by</b> = runs out incl. tank &amp; plans − production time (fruit to bottle, seeded from ANNUAL SALES column S), moved back to the last month the wine can be started in when a season is set. Overdue = that date has passed; within 3 months = amber.</p>
    <p><b>Next 24 months</b>: one block per month, coloured by months of stock left at its end incl. tank and plans — green 6+, amber 2–6, orange under 2, red out; ▲ marks wine coming ready; a tick marks January.</p>
    <p>Costs, prices and margins from the ANNUAL SALES sheet are not used: the tracker keeps no ongoing costing.</p></div></details>
    ${ut}${ign}${other}
    ${off.length ? `<h2>Inactive lines</h2><p class="sl-help">${off.map(l => `<a href="/analytics/sales/line?id=${l.id}">${E(l.name)}</a>`).join(' · ')}</p>` : ''}
    <p class="sl-help" style="margin-top:18px"><a href="/analytics/sales/line?new=1">＋ New product line</a></p>`;
  return page('Sales', body, '/analytics', [['Analytics', '/analytics'], ['Sales', null]]);
}

// ---- monthly bar chart (stacked by dispatch type) + projected stock line
function barChart(ln, from, to, types) {
  const months = []; for (let mm = from; mm <= to; mm = mAdd(mm, 1)) months.push(mm);
  const tys = TYPES.filter(t => !types || types.has(t)).concat(types && !types.has('other') ? [] : ['other']);
  const val = (mm, t) => t === 'other' ? [...ln.byType].filter(([k]) => k.startsWith(mm + '|') && !TYPES.includes(k.split('|')[1])).reduce((s, [, v]) => s + v, 0) : (ln.byType.get(`${mm}|${t}`) || 0);
  const tot = months.map(mm => tys.reduce((s, t) => s + val(mm, t), 0));
  const max = Math.max(1, ...tot), W = 960, H = 230, pl = 44, pb = 30, bw = (W - pl - 10) / months.length;
  const Y = v => H - pb - v / max * (H - pb - 14);
  const out = [`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`];
  for (let i = 0; i <= 4; i++) { const v = max * i / 4; out.push(`<line x1="${pl}" x2="${W - 10}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".08"/><text x="2" y="${(Y(v) + 4).toFixed(1)}">${n0(v)}</text>`); }
  months.forEach((mm, i) => {
    let y0 = H - pb;
    for (const t of tys) { const v = val(mm, t); if (!v) continue; const h = v / max * (H - pb - 14); out.push(`<rect x="${(pl + i * bw + 1).toFixed(1)}" y="${(y0 - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${TCOL[t] || '#6e7681'}"><title>${mLabel(mm)} · ${E(t)}: ${n0(v)}</title></rect>`); y0 -= h; }
    if (mm.endsWith('-01') || (i === 0 && +mm.slice(5, 7) <= 9)) out.push(`<text x="${(pl + i * bw).toFixed(1)}" y="${H - 12}">${mm.endsWith('-01') ? mm.slice(0, 4) : mLabel(mm)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

function projChart(ln) {
  if (!ln.track || !ln.annual) return '<p class="muted">No sales in the last 12 months, so no projection.</p>';
  const tr = ln.track.slice(0, 36).map(t => ({ ...t, start: Math.max(0, t.start), end: Math.max(0, t.end) })), W = 960, H = 200, pl = 44, pb = 26;
  const vals = tr.flatMap(t => [t.start, t.end, t.start + t.arr]), max = Math.max(1, ...vals), min = 0;
  const X = i => pl + i * (W - pl - 10) / tr.length, Y = v => H - pb - (v - min) / (max - min) * (H - pb - 12);
  const out = [`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`];
  for (let i = 0; i <= 4; i++) { const v = min + (max - min) * i / 4; out.push(`<line x1="${pl}" x2="${W - 10}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".08"/><text x="2" y="${(Y(v) + 4).toFixed(1)}">${n0(v)}</text>`); }
  out.push(`<line x1="${pl}" x2="${W - 10}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#f85149" stroke-opacity=".5"/>`);
  let d = `M${X(0).toFixed(1)},${Y(tr[0].start).toFixed(1)}`;
  tr.forEach((t, i) => { d += ` L${X(i).toFixed(1)},${Y(t.start + t.arr).toFixed(1)} L${X(i + 1).toFixed(1)},${Y(t.end).toFixed(1)}`; });
  out.push(`<path d="${d}" fill="none" stroke="#388bfd" stroke-width="1.8"/>`);
  tr.forEach((t, i) => {
    out.push(`<circle cx="${X(i + 1).toFixed(1)}" cy="${Y(t.end).toFixed(1)}" r="2.2" fill="#388bfd"><title>End of ${mLabel(t.m)}: ${n0(t.end)}${t.arr ? ' (incl. +' + n0(t.arr) + ' coming ready)' : ''}</title></circle>`);
    if (t.m.endsWith('-01') || (i === 0 && +t.m.slice(5, 7) <= 9)) out.push(`<text x="${X(i).toFixed(1)}" y="${H - 8}">${t.m.endsWith('-01') ? t.m.slice(0, 4) : mLabel(t.m)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

// ---- one line: settings, SKUs, tank, plans, charts
export function page_line(c, q) {
  const T = ctx.token, id = parseInt((q.id || ['0'])[0], 10);
  if ((q.new || [])[0] === '1') return page('New product line', `${CSS}${TABS('sales')}<h1>New product line</h1>${settingsForm({ id: 0, name: '', unit_l: 0.75, annual_target: null, lead_months: 12, season_months: null, season_note: '', buffer_months: 0, basis: 'measured', active: 1, notes: '' }, T)}`, '/analytics', [['Analytics', '/analytics'], ['Sales', '/analytics/sales'], ['New line', null]]);
  const m = model(c, q);
  const ln = m.lines.find(l => l.id === id);
  if (!ln) return null;
  const msg = q.saved ? '<div class="ok">Saved.</div>' : '';
  const from = mAdd(m.lastBooked, -35);
  const items = ln.items.slice().sort((a, b) => (b.oh - a.oh) || (a.code < b.code ? -1 : 1));
  const itemRows = items.map(it => `<tr${!Math.round(it.oh) && !it.t12 ? ' class="off"' : ''}><td><a href="/item/${it.id}">${E(it.code)}</a>${it.inactive ? ' <span class="tag">inactive</span>' : ''}${Math.round(it.oh) < 0 ? ' <span class="sl-st sl-late">negative</span>' : ''}</td><td>${E(it.description || '')}</td><td class="n">${n0(it.oh)}</td><td class="n">${n0(it.t12)}</td><td>${dLabel(String(it.last || '').slice(0, 10))}</td>
    <td><form method="post" action="/analytics/sales/item" style="margin:0"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="item_id" value="${it.id}"><input type="hidden" name="line_id" value=""><input type="hidden" name="back" value="/analytics/sales/line?id=${ln.id}"><button class="btn2" title="Take this SKU out of the line">Remove</button></form></td></tr>`).join('');
  const addable = m.unlinedItems.concat(c.all(`SELECT si.id, si.code, si.description, si.inactive FROM stock_item si LEFT JOIN sales_line_item s ON s.item_id=si.id WHERE si.is_finished=1 AND s.item_id IS NULL ORDER BY si.code`)
    .filter(r => !m.unlinedItems.some(u => u.id === r.id)));
  const tankRows = ln.tank.map(t => `<tr><td><a href="/batch/${t.bid}">${E(t.code)}</a>${t.auto ? ' <span class="tag u" title="Assigned automatically when the Sales tab was set up — check">auto</span>' : ''}<small>${E(t.description || '')}</small></td><td>${E(t.vessels || '')}</td><td class="n">${n0(t.L)}</td><td class="n">${n0(t.L / 3.785411784)}</td>
    <td><form method="post" action="/analytics/sales/batch" style="display:flex;gap:6px;margin:0;align-items:center"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="batch_id" value="${t.bid}"><input type="hidden" name="line_id" value="${ln.id}"><input type="hidden" name="back" value="/analytics/sales/line?id=${ln.id}"><input name="share" value="${Math.round((t.share ?? 1) * 100)}" style="width:4.5em;text-align:right">%<button class="btn2">Save</button></form></td>
    <td class="n">${n0(t.units)}</td><td>${t.stage ? stage.pill(t.stage) : ''}</td><td>${dLabel(t.ready)}<small>${E(t.readyWhy || '')}</small></td>
    <td><form method="post" action="/analytics/sales/batch" style="margin:0"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="batch_id" value="${t.bid}"><input type="hidden" name="line_id" value=""><input type="hidden" name="back" value="/analytics/sales/line?id=${ln.id}"><button class="btn2">Remove</button></form></td></tr>`).join('');
  const tankAdd = m.unlinedTank.concat(m.ignoredTank);
  const planRows = ln.plans.map(p => `<tr><td>${mLabel(p.ready_month)}</td><td class="n">${n0(p.units)}</td><td>${E(p.note || '')}</td><td class="muted">${E(String(p.at || '').slice(0, 10))}</td>
    <td><form method="post" action="/analytics/sales/plan" style="margin:0"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="line_id" value="${ln.id}"><input type="hidden" name="delete" value="${p.id}"><button class="btn2">Delete</button></form></td></tr>`).join('');
  const body = `${CSS}${TABS('sales')}${SUBTABS('annual', keepT(q).slice(1))}<h1>${E(ln.name)}${ln.active ? '' : ' <span class="tag">inactive</span>'}</h1>${msg}${head(m, q)}
    <div class="cards">
      <div class="card"><div class="k">Bottled, est. now</div><div class="v">${n0(ln.est)}</div><div class="muted" style="font-size:12px">${n0(ln.onhand)} on hand − ${n0(ln.unbooked)} sales not yet booked</div></div>
      <div class="card"><div class="k">In tank / planned</div><div class="v">${n0(ln.tankUnits)} / ${n0(ln.planUnits)}</div><div class="muted" style="font-size:12px">bottles/cans of ${fxc(ln.unit_l * 1000, 0)} mL</div></div>
      <div class="card"><div class="k">Sold, 12 months to ${mLabel(m.lastBooked)}</div><div class="v">${n0(ln.t12)}</div><div class="muted" style="font-size:12px">prior 12 months ${n0(ln.p12)} · 3-month pace ${n0(ln.t3 * 4)}/yr · your figure ${n0(ln.annual_target)}</div></div>
      <div class="card"><div class="k">Runs out (bottled / incl. tank &amp; plans)</div><div class="v" style="font-size:18px">${ln.outBottled ? dLabel(ln.outBottled) : '—'}<br>${ln.outAll ? dLabel(ln.outAll) : ln.annual ? '5+ years' : '—'}</div></div>
      <div class="card"><div class="k">Start next batch by</div><div class="v" style="font-size:18px">${ln.startBy ? dLabel(ln.startBy) : '—'}</div><div>${statusPill(ln)}</div></div>
    </div>
    <h2>Projected stock incl. tank &amp; plans, next 36 months (runway rate ${n0(ln.annual)}/yr${ln.basis === 'target' ? ', your figure' : ''}, seasonal; stops at zero)</h2>${projChart(ln)}
    <h2>Bottles/cans out per month, ${mLabel(from)} – ${mLabel(m.lastBooked)}</h2>${typeChips(q, `/analytics/sales/line?id=${ln.id}`)}${barChart(ln, from, m.lastBooked, m.types)}
    <h2>SKUs in this line</h2><table><thead><tr><th>SKU</th><th>Description</th><th class="n">On hand</th><th class="n">Out, 12 mo</th><th>Last dispatch</th><th></th></tr></thead><tbody>${itemRows || '<tr><td colspan=6 class=muted>No SKUs yet</td></tr>'}</tbody></table>
    <form method="post" action="/analytics/sales/item" class="f" style="margin-top:8px"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="line_id" value="${ln.id}"><input type="hidden" name="back" value="/analytics/sales/line?id=${ln.id}">
      <label>Add a SKU<select name="item_id" required><option value="">— pick a SKU —</option>${addable.map(r => `<option value="${r.id}">${E(r.code)} — ${E(r.description || '')}${r.inactive ? ' (inactive)' : ''}</option>`).join('')}</select></label><button>Add</button></form>
    <h2>Wine in tank for this line</h2><table><thead><tr><th>Batch</th><th>Vessels</th><th class="n">Litres</th><th class="n">Gallons</th><th>Share for this line</th><th class="n">Units</th><th>Stage</th><th>Counts as ready</th><th></th></tr></thead><tbody>${tankRows || '<tr><td colspan=9 class=muted>None assigned</td></tr>'}</tbody></table>
    ${tankAdd.length ? `<form method="post" action="/analytics/sales/batch" class="f" style="margin-top:8px"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="line_id" value="${ln.id}"><input type="hidden" name="back" value="/analytics/sales/line?id=${ln.id}">
      <label>Add a batch in tank<select name="batch_id" required><option value="">— pick a batch —</option>${tankAdd.map(t => `<option value="${t.bid}">${E(t.code)} — ${n0(t.L)} L</option>`).join('')}</select></label><label>Share %<input name="share" value="100" style="width:5em"></label><button>Add</button></form>` : ''}
    <p class="sl-help">A batch counts toward one line. If it will be split (e.g. Rosé into bottles, cans and sparkling), give it this line's share here and add the rest as a planned batch on the other lines. Adding a batch that sits on another line moves it here.</p>
    <h2>Planned batches</h2><table><thead><tr><th>Ready</th><th class="n">Units</th><th>Note</th><th>Added</th><th></th></tr></thead><tbody>${planRows || '<tr><td colspan=5 class=muted>None</td></tr>'}</tbody></table>
    <form method="post" action="/analytics/sales/plan" class="f" style="margin-top:8px"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="line_id" value="${ln.id}">
      <label>Ready (month)<input type="month" name="ready_month" required min="${m.curM}"></label><label>Bottles/cans<input name="units" required style="width:7em"></label><label>Note<input name="note" style="width:22em" placeholder="e.g. 1,200 L Fall 2026 batch"></label><button>Add plan</button></form>
    <h2>Settings</h2>${settingsForm(ln, T)}`;
  return page(ln.name, body, '/analytics', [['Analytics', '/analytics'], ['Sales', '/analytics/sales'], [ln.name, null]]);
}

function settingsForm(ln, T) {
  const mset = new Set((ln.season_months || '').split(',').filter(Boolean).map(Number));
  return `<form method="post" action="/analytics/sales/line" class="sl-form"><input type="hidden" name="_t" value="${E(T)}"><input type="hidden" name="id" value="${ln.id}">
    <label class="wide">Name<input name="name" value="${E(ln.name)}" required></label>
    <label>Unit size (L)<input name="unit_l" value="${ln.unit_l ?? ''}" placeholder="0.75"></label>
    <label>Your annual figure (bottles/cans)<input name="annual_target" value="${ln.annual_target ?? ''}"></label>
    <label>Runway rate<select name="basis"><option value="measured" ${ln.basis !== 'target' ? 'selected' : ''}>Sold in the last 12 months</option><option value="target" ${ln.basis === 'target' ? 'selected' : ''}>Your annual figure</option></select></label>
    <label>Production time, fruit to bottle (months)<input name="lead_months" value="${ln.lead_months ?? ''}"></label>
    <label>Safety buffer (months of sales)<input name="buffer_months" value="${ln.buffer_months ?? 0}"></label>
    <label>Order on the page<input name="sort" value="${ln.sort ?? ''}"></label>
    <label class="wide">Months a batch can be started (none ticked = not set; all = any time)<span class="sl-mo">${MON.map((mn, i) => `<label><input type="checkbox" name="season" value="${i + 1}" ${mset.has(i + 1) ? 'checked' : ''}>${mn}</label>`).join('')}</span></label>
    <label class="wide">Season note<input name="season_note" value="${E(ln.season_note || '')}"></label>
    <label class="wide">Notes<textarea name="notes" rows="2">${E(ln.notes || '')}</textarea></label>
    <label><span><input type="checkbox" name="active" value="1" ${ln.active ? 'checked' : ''}> Active (shown in the table)</span></label>
    <div class="wide"><button>Save</button>${ln.updated_at ? ` <span class="muted" style="font-size:12px">last saved ${E(String(ln.updated_at).slice(0, 16).replace('T', ' '))} · ${E(ln.by || '')}</span>` : ''}</div></form>`;
}

// ---- Sales history: compare lines over time, by month / quarter / year, plus a rank table
export function page_history(c, q) {
  const types = chosenTypes(q), useType = t => !types || types.has(TYPES.includes(t) ? t : 'other');
  const g = ['m', 'q', 'y'].includes((q.g || [])[0]) ? q.g[0] : 'q';
  const lines = c.all('SELECT id, name, active FROM sales_line ORDER BY active DESC, sort, id');
  const pick = new Set((q.l || []).map(Number).filter(x => lines.some(l => l.id === x)));
  const lastBooked = c.val("SELECT substr(MAX(occurred_at),1,7) m FROM dispatch WHERE reversed=0 AND dispatch_type='Tasting Room Sales'") || today().slice(0, 7);
  const firstM = c.val("SELECT substr(MIN(occurred_at),1,7) m FROM dispatch WHERE reversed=0") || '2021-01';
  const rows = c.all(`SELECT sli.line_id lid, substr(d.occurred_at,1,7) m, d.dispatch_type t, SUM(dl.quantity) qty FROM dispatch d JOIN dispatch_line dl ON dl.dispatch_id=d.id
                      JOIN sales_line_item sli ON sli.item_id=dl.item_id WHERE d.reversed=0 AND d.occurred_at<? GROUP BY lid, m, t`, `${mAdd(lastBooked, 1)}-01`);
  const per = m => g === 'm' ? m : g === 'y' ? m.slice(0, 4) : `${m.slice(0, 4)} Q${Math.floor((+m.slice(5, 7) - 1) / 3) + 1}`;
  const P = []; for (let mm = firstM; mm <= lastBooked; mm = mAdd(mm, 1)) if (!P.includes(per(mm))) P.push(per(mm));
  const S = new Map();
  for (const r of rows) { if (!useType(r.t)) continue; const k = `${r.lid}|${per(r.m)}`; S.set(k, (S.get(k) || 0) + r.qty); }
  // rank: last 12 vs prior 12 months, every line
  const R = new Map();
  for (const r of rows) { if (!useType(r.t)) continue; const d = mDiff(r.m, lastBooked); const o = R.get(r.lid) || { a: 0, b: 0, spark: new Array(24).fill(0) }; if (d >= 0 && d < 12) o.a += r.qty; else if (d >= 12 && d < 24) o.b += r.qty; if (d >= 0 && d < 24) o.spark[23 - d] += r.qty; R.set(r.lid, o); }
  const show = pick.size ? lines.filter(l => pick.has(l.id)) : [...R.entries()].sort((x, y) => y[1].a - x[1].a).slice(0, 6).map(([id]) => lines.find(l => l.id === id)).filter(Boolean);
  const COLS = ['#388bfd', '#d29922', '#3fb950', '#a371f7', '#f85149', '#56d4dd', '#f778ba', '#db6d28', '#c9d1d9', '#8b949e'];
  const partial = g !== 'm' && (g === 'y' ? lastBooked.slice(5) !== '12' : +lastBooked.slice(5) % 3 !== 0) ? per(lastBooked) : null;
  // chart
  const W = 960, H = 260, pl = 44, pb = 30;
  const vmax = Math.max(1, ...show.flatMap(l => P.map(p => S.get(`${l.id}|${p}`) || 0)));
  const X = i => pl + (P.length > 1 ? i * (W - pl - 10) / (P.length - 1) : 0), Y = v => H - pb - v / vmax * (H - pb - 14);
  const svg = [`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`];
  for (let i = 0; i <= 4; i++) { const v = vmax * i / 4; svg.push(`<line x1="${pl}" x2="${W - 10}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".08"/><text x="2" y="${(Y(v) + 4).toFixed(1)}">${n0(v)}</text>`); }
  const lab = Math.max(1, Math.ceil(P.length / 12));
  P.forEach((p, i) => { if (i % lab === 0 && X(i) < W - 60) svg.push(`<text x="${(X(i) - 10).toFixed(1)}" y="${H - 10}">${E(g === 'm' ? mLabel(p) : p)}</text>`); });
  show.forEach((l, k) => {
    const col = COLS[k % COLS.length];
    const pts = P.map((p, i) => [X(i), Y(S.get(`${l.id}|${p}`) || 0), S.get(`${l.id}|${p}`) || 0, p]);
    svg.push(`<path d="${pts.map((t, i) => `${i ? 'L' : 'M'}${t[0].toFixed(1)},${t[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="1.8"/>`);
    for (const t of pts) svg.push(`<circle cx="${t[0].toFixed(1)}" cy="${t[1].toFixed(1)}" r="2.4" fill="${col}"><title>${E(l.name)} · ${E(g === 'm' ? mLabel(t[3]) : t[3])}: ${n0(t[2])}${t[3] === partial ? ' (part period)' : ''}</title></circle>`);
  });
  svg.push('</svg>');
  const legend = `<div class="sl-types">${show.map((l, k) => `<span><i style="display:inline-block;width:14px;height:3px;background:${COLS[k % COLS.length]};vertical-align:middle;margin-right:5px"></i>${E(l.name)}</span>`).join('')}</div>`;
  const base = `/analytics/sales/history?g=${g}${[...pick].map(x => '&l=' + x).join('')}`;
  const picker = `<form method="get" action="/analytics/sales/history" class="sl-form" style="max-width:none"><input type="hidden" name="g" value="${g}">${(q.t || []).map(t => `<input type="hidden" name="t" value="${E(t)}">`).join('')}
    <label class="wide">Product lines to compare (none ticked = the six biggest)<span class="sl-mo">${lines.map(l => `<label><input type="checkbox" name="l" value="${l.id}" ${pick.has(l.id) ? 'checked' : ''}>${E(l.name)}</label>`).join('')}</span></label><div class="wide"><button>Show</button></div></form>`;
  const gchips = `<div class="chips" style="margin:10px 0">${[['m', 'Month'], ['q', 'Quarter'], ['y', 'Year']].map(([k, t]) => `<a class="${g === k ? 'on' : ''}" href="${E(base.replace(/g=[mqy]/, 'g=' + k) + keepT(q))}">${t}</a>`).join('')}</div>`;
  const tbl = `<div style="overflow-x:auto"><table><thead><tr><th>Period</th>${show.map(l => `<th class="n">${E(l.name)}</th>`).join('')}</tr></thead><tbody>
    ${P.slice().reverse().map(p => `<tr><td>${E(g === 'm' ? mLabel(p) : p)}${p === partial ? ' <span class="tag">part</span>' : ''}</td>${show.map(l => `<td class="n">${n0(S.get(`${l.id}|${p}`) || 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const spark = a => { const mx = Math.max(1, ...a); return `<svg width="96" height="18" viewBox="0 0 96 18">${a.map((v, i) => `<rect x="${i * 4}" y="${(17 - v / mx * 16).toFixed(1)}" width="3" height="${(v / mx * 16).toFixed(1)}" fill="${i >= 12 ? '#388bfd' : '#30363d'}"/>`).join('')}</svg>`; };
  const rank = [...R.entries()].map(([id, o]) => ({ l: lines.find(x => x.id === id), ...o })).filter(r => r.l).sort((a, b) => b.a - a.a);
  const rankT = `<table><thead><tr><th>Product line</th><th class="n">Last 12 months</th><th class="n">Prior 12 months</th><th class="n">Change</th><th>24 months (blue = last 12)</th></tr></thead><tbody>
    ${rank.map(r => `<tr><td><a href="/analytics/sales/line?id=${r.l.id}">${E(r.l.name)}</a></td><td class="n">${n0(r.a)}</td><td class="n">${n0(r.b)}</td><td class="n ${r.a >= r.b ? 'up' : 'dn'}" data-v="${r.b ? ((r.a - r.b) / r.b * 100).toFixed(1) : ''}">${r.b ? (r.a >= r.b ? '+' : '−') + fxc(Math.abs((r.a - r.b) / r.b * 100), 0) + '%' : ''}</td><td>${spark(r.spark)}</td></tr>`).join('')}</tbody></table>`;
  const body = `${CSS}${TABS('sales')}${SUBTABS('hist', keepT(q).slice(1))}<h1>Sales history</h1>
    <div class="sl-kpi"><span>Bottles/cans dispatched, ${mLabel(firstM)} – ${mLabel(lastBooked)} (last month with Tasting Room Sales booked)</span><span>${types ? [...types].join(', ') + ' only' : 'All dispatch types'}</span></div>
    ${typeChips(q, base)}${gchips}${picker}${legend}${svg.join('')}
    <h2>Ranked: last 12 months vs the 12 before (to ${mLabel(lastBooked)})</h2>${rankT}
    <h2>By ${g === 'm' ? 'month' : g === 'q' ? 'quarter' : 'year'}</h2>${tbl}`;
  return page('Sales history', body, '/analytics', [['Analytics', '/analytics'], ['Sales', '/analytics/sales'], ['History', null]]);
}

// ---- saving (HWWineTracker's own data: allowed in the real copy, like outcome ratings)
export function post(c, path, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  const num = (k, lo, hi, label) => { const s = g(k).replace(/,/g, ''); if (s === '') return null; const v = Number(s); if (!isFinite(v) || v < lo || v > hi) throw new RangeError(`${label} must be between ${lo} and ${hi}`); return v; };
  const backOk = b => /^\/analytics\/sales(\/line\?id=\d+)?$/.test(b) ? b : '/analytics/sales';
  try {
    if (path === '/analytics/sales/line') {
      const id = parseInt(g('id') || '0', 10), name = g('name').slice(0, 80);
      if (!name) return [null, 'A line needs a name.'];
      const months = (f.season || []).map(Number).filter(x => x >= 1 && x <= 12).sort((a, b) => a - b).join(',') || null;
      const vals = [name, num('unit_l', 0.05, 20, 'Unit size'), num('annual_target', 0, 100000, 'Annual figure'), num('lead_months', 0, 120, 'Production time'),
        months, g('season_note').slice(0, 300) || null, num('buffer_months', 0, 24, 'Safety buffer') ?? 0, g('basis') === 'target' ? 'target' : 'measured', g('active') === '1' ? 1 : 0, g('notes').slice(0, 1000) || null, nowIso(), ctx.user || 'HARDCASTLE, Ken'];
      const sort = num('sort', -1e6, 1e6, 'Order');
      if (id) {
        if (!c.one('SELECT 1 x FROM sales_line WHERE id=?', id)) return [null, 'No such line.'];
        c.run('UPDATE sales_line SET name=?, unit_l=?, annual_target=?, lead_months=?, season_months=?, season_note=?, buffer_months=?, basis=?, active=?, notes=?, updated_at=?, by=?, sort=COALESCE(?, sort) WHERE id=?', ...vals, sort, id);
        return [`/analytics/sales/line?id=${id}&saved=1`, null];
      }
      const nid = c.run('INSERT INTO sales_line(name, unit_l, annual_target, lead_months, season_months, season_note, buffer_months, basis, active, notes, updated_at, by, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, (SELECT COALESCE(MAX(sort),0)+10 FROM sales_line)))', ...vals, sort).id;
      return [`/analytics/sales/line?id=${nid}&saved=1`, null];
    }
    if (path === '/analytics/sales/item') {
      const iid = parseInt(g('item_id') || '0', 10), lid = g('line_id') === '' ? null : parseInt(g('line_id'), 10);
      if (!c.one('SELECT 1 x FROM stock_item WHERE id=? AND is_finished=1', iid)) return [null, 'No such bottled-stock SKU.'];
      if (lid === null) c.run('DELETE FROM sales_line_item WHERE item_id=?', iid);
      else { if (!c.one('SELECT 1 x FROM sales_line WHERE id=?', lid)) return [null, 'Pick a line.']; c.run('INSERT INTO sales_line_item(item_id, line_id, auto) VALUES (?,?,0) ON CONFLICT(item_id) DO UPDATE SET line_id=excluded.line_id, auto=0', iid, lid); }
      return [backOk(g('back')) + (g('back').includes('?') ? '&' : '?') + 'saved=1', null];
    }
    if (path === '/analytics/sales/batch') {
      const bid = parseInt(g('batch_id') || '0', 10), lid = g('line_id') === '' ? null : parseInt(g('line_id'), 10);
      if (!c.one('SELECT 1 x FROM batch WHERE id=?', bid)) return [null, 'No such batch.'];
      if (lid === null) c.run('DELETE FROM sales_line_batch WHERE batch_id=?', bid);
      else {
        if (lid !== 0 && !c.one('SELECT 1 x FROM sales_line WHERE id=?', lid)) return [null, 'Pick a line.'];
        const share = (num('share', 1, 100, 'Share') ?? 100) / 100;
        c.run('INSERT INTO sales_line_batch(batch_id, line_id, share, auto) VALUES (?,?,?,0) ON CONFLICT(batch_id) DO UPDATE SET line_id=excluded.line_id, share=excluded.share, auto=0', bid, lid, share);
      }
      return [backOk(g('back')) + (g('back').includes('?') ? '&' : '?') + 'saved=1', null];
    }
    if (path === '/analytics/sales/plan') {
      const lid = parseInt(g('line_id') || '0', 10);
      if (!c.one('SELECT 1 x FROM sales_line WHERE id=?', lid)) return [null, 'No such line.'];
      if (g('delete')) c.run('DELETE FROM sales_plan WHERE id=? AND line_id=?', parseInt(g('delete'), 10), lid);
      else {
        const rm = g('ready_month');
        if (!/^\d{4}-\d{2}$/.test(rm) || +rm.slice(5) < 1 || +rm.slice(5) > 12) return [null, 'Ready month must be a month (YYYY-MM).'];
        const u = num('units', 1, 100000, 'Bottles/cans');
        if (u === null) return [null, 'How many bottles/cans?'];
        c.run('INSERT INTO sales_plan(line_id, ready_month, units, note, at, by) VALUES (?,?,?,?,?,?)', lid, rm, u, g('note').slice(0, 200) || null, nowIso(), ctx.user || 'HARDCASTLE, Ken');
      }
      return [`/analytics/sales/line?id=${lid}&saved=1`, null];
    }
  } catch (e) {
    if (e instanceof RangeError) return [null, e.message];
    throw e;
  }
  return [null, 'Unknown form.'];
}
