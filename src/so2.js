// v1.30 — SO₂ status and KMS recommendations. Free SO₂ decays first-order, F(t) = F0·e^(−k·t); k is fitted per vessel
// from consecutive free SO₂ readings with nothing in between and shrunk toward its vessel type (barrel / fixed tank /
// variable-capacity), and the type toward the default in Constants. What a KMS addition actually adds is measured:
// retention R = (free after − reading before decayed to the addition) ÷ ppm added, from additions with a reading before
// and one 2–14 days after; R is predicted per wine, shrunk toward the overall fit, with a continuous predictor (prior
// additions to the lot or cumulative SO₂ added) when the data support it. Doses: KMS g = (target − estimate) × L ÷ 1000
// ÷ 0.576 ÷ R; target free = M × (1 + 10^(pH − 1.81)), M = 0.5 / 0.8 molecular.
import { tip as HELP } from './help.js';
import { E, num } from './lib/py.js';
import * as F from './formulation.js';
import * as VU from './vessel_ui.js';
import { current_contents } from './entry.js';

const DAY = 864e5, PKA = 1.81, GAL = 3.785411784;
const T = s => Date.parse(String(s).replace(' ', 'T').slice(0, 19) + 'Z');
const day = s => String(s || '').slice(0, 10);
// operations that put different wine into a vessel (role 'to'), or change the wine whatever the role
const INTO = ['Transfer', 'Racking', 'Multi transfer (one-to-many)', 'Multi transfer (many-to-one)', 'Bulk intake', 'Press cycle', 'Extraction', 'Intake delivery', 'Break barrels'];
const ANY = ['Blend', 'Change batch', 'Rack & Return'];
const q = a => a.map(x => `'${x.replace(/'/g, "''")}'`).join(',');

import { SO2_CONSTANTS, LIMITS } from './so2const.js';
export { SO2_CONSTANTS, LIMITS };
export const target = (M, ph) => M * (1 + 10 ** (ph - PKA));

// vessel type for decay: barrel, fixed tank, or variable-capacity
export function vtype(c, v) {
  if (v.kind === 'barrel' || v.kind === 'barrel_group' || c.val('SELECT 1 FROM barrel_group_member WHERE vessel_id=?', v.id)) return 'barrel';
  return VU.is_fixed(c, v) ? 'tank' : 'var';
}

function load(c) {
  const vs = new Map(c.all('SELECT id, code, kind, capacity_l FROM vessel').map(v => [v.id, v]));
  const ev = new Map(), put = (v, e) => { if (!ev.has(v)) ev.set(v, []); ev.get(v).push(e); };
  for (const r of c.all(`SELECT a.vessel_id v, a.batch_id b, o.occurred_at t, a.metric m, a.value x FROM op_analysis a JOIN operation o ON o.id=a.op_id
                         WHERE o.reversed=0 AND a.vessel_id IS NOT NULL AND a.value IS NOT NULL AND a.metric IN ('Free SO2','Total SO2','pH')`))
    put(r.v, { k: r.m === 'Free SO2' ? 'F' : r.m === 'pH' ? 'P' : 'S', t: T(r.t), at: r.t, b: r.b, x: r.x, o: 1 });
  const adds = new Map();
  for (const r of c.all(`SELECT a.op_id op, a.vessel_id v, a.batch_id b, o.occurred_at t, a.amount_base ab, m.base_unit bu,
                           COALESCE(a.batch_volume_l, (SELECT ov.vol_after_l FROM op_vessel ov WHERE ov.op_id=a.op_id AND ov.vessel_id=a.vessel_id LIMIT 1)) vl
                         FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
                         WHERE o.reversed=0 AND m.kind='sulfite' AND a.vessel_id IS NOT NULL AND a.amount_base>0`)) {
    const key = r.op + '|' + r.v, g = r.ab * (r.bu === 'kg' ? 1000 : 1);
    if (!adds.has(key)) adds.set(key, { k: 'A', op: r.op, v: r.v, b: r.b, t: T(r.t), at: r.t, g: 0, V: r.vl, o: 2 });
    adds.get(key).g += g;
  }
  for (const a of adds.values()) { a.ppm = a.V > 0 ? a.g * 576 / a.V : null; put(a.v, a); }
  for (const r of c.all(`SELECT ov.vessel_id v, o.occurred_at t, ov.batch_after_id b FROM op_vessel ov JOIN operation o ON o.id=ov.op_id
                         WHERE o.reversed=0 AND ov.vessel_id IS NOT NULL AND ((ov.role='to' AND o.op_type IN (${q(INTO)})) OR o.op_type IN (${q(ANY)}))`))
    put(r.v, { k: 'X', t: T(r.t), at: r.t, b: r.b, o: 0 });
  for (const l of ev.values()) l.sort((a, b) => a.t - b.t || a.o - b.o);
  // lot-level additions (one per operation): ppm = Σg·576 / ΣV, for the prior-additions predictors
  const lot = new Map();
  for (const a of adds.values()) {
    if (!a.b) continue;
    if (!lot.has(a.b)) lot.set(a.b, new Map());
    const m = lot.get(a.b), e = m.get(a.op) || { t: a.t, g: 0, V: 0 };
    e.g += a.g; e.V += a.V || 0; m.set(a.op, e);
  }
  const lots = new Map([...lot].map(([b, m]) => [b, [...m.values()].map(e => ({ t: e.t, ppm: e.V > 0 ? e.g * 576 / e.V : 0 })).sort((x, y) => x.t - y.t)]));
  return { vs, ev, lots };
}
const prior = (lots, b, t) => { const l = (lots.get(b) || []).filter(e => e.t < t); return { n: l.length, cum: l.reduce((s, e) => s + e.ppm, 0) }; };

function ols(xs, ys) {
  const n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxx > 0 ? sxy / sxx : 0, a = my - b * mx;
  let sse = 0; for (let i = 0; i < n; i++) sse += (ys[i] - a - b * xs[i]) ** 2;
  const se = n > 2 && sxx > 0 ? Math.sqrt(sse / (n - 2) / sxx) : Infinity;
  return { a, b, se, t: se > 0 && isFinite(se) ? b / se : 0, sse, n };
}
const quant = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

// Calibration from every vessel's history. Returns decay (per type and per vessel) and retention (model + per-wine offsets).
export function calibrate(c, C = F.constants(c)) {
  const D = load(c), w = +C.so2Shrink;
  const def = { barrel: +C.so2KBarrel, tank: +C.so2KTank, var: +C.so2KVar };
  const typeOf = new Map([...D.vs.values()].map(v => [v.id, vtype(c, v)]));
  // decay pairs
  const pairs = [];
  for (const [v, l] of D.ev) {
    let prev = null, lastA = -Infinity;
    for (const e of l) {
      if (e.k === 'A') { prev = null; lastA = e.t; continue; }
      if (e.k === 'X') { prev = null; continue; }
      if (e.k !== 'F') continue;
      if (prev && prev.b === e.b && prev.x > 0 && e.x > 0) {
        const dt = (e.t - prev.t) / DAY;
        if (dt >= 1 && dt <= 180 && (prev.t - lastA) / DAY >= 2) pairs.push({ v, type: typeOf.get(v), b: e.b, dt, f0: prev.x, f1: e.x, k: Math.log(prev.x / e.x) / dt, t0: prev.at, t1: e.at });
      }
      prev = e;
    }
  }
  const pool = ps => { const dt = ps.reduce((s, p) => s + p.dt, 0); return dt > 0 ? ps.reduce((s, p) => s + Math.log(p.f0 / p.f1), 0) / dt : 0; };
  const types = {};
  for (const ty of ['barrel', 'tank', 'var']) {
    const ps = pairs.filter(p => p.type === ty), raw = ps.length ? pool(ps) : null, n = ps.length;
    const k = Math.max(0, (n * (raw || 0) + w * def[ty]) / (n + w));
    const ks = ps.filter(p => p.dt >= 7).map(p => p.k), s = ks.length >= 4 ? (quant(ks, 0.75) - quant(ks, 0.25)) / 2 : 0.5 * k;
    types[ty] = { n, raw, k, def: def[ty], spread: Math.max(s, 0.25 * k) };
  }
  const vk = new Map();
  const byV = new Map(); for (const p of pairs) { if (!byV.has(p.v)) byV.set(p.v, []); byV.get(p.v).push(p); }
  const kOf = v => {
    if (vk.has(v)) return vk.get(v);
    const ty = types[typeOf.get(v) || 'tank'], ps = byV.get(v) || [], n = ps.length, raw = n ? pool(ps) : null;
    const k = Math.max(0, (n * (raw || 0) + w * ty.k) / (n + w)), r = { k, n, raw, type: typeOf.get(v), lo: Math.max(0, k - ty.spread), hi: k + ty.spread };
    vk.set(v, r); return r;
  };
  // retention events
  const ret = [];
  for (const [v, l] of D.ev) {
    for (let i = 0; i < l.length; i++) {
      const a = l[i];
      if (a.k !== 'A' || !(a.ppm > 0)) continue;
      let j = i - 1; while (j >= 0 && (l[j].k === 'P' || l[j].k === 'S')) j--;
      const r0 = j >= 0 && l[j].k === 'F' && l[j].b === a.b ? l[j] : null;
      let m = i + 1; while (m < l.length && (l[m].k === 'P' || l[m].k === 'S')) m++;
      const r1 = m < l.length && l[m].k === 'F' && l[m].b === a.b ? l[m] : null;
      if (!r0 || !r1) continue;
      const dA = (r1.t - a.t) / DAY;
      if (dA < 2 || dA > 14) continue;
      const k = kOf(v).k, proj = r0.x * Math.exp(-k * (a.t - r0.t) / DAY), p = prior(D.lots, a.b, a.t);
      ret.push({ v, b: a.b, at: a.at, g: a.g, V: a.V, ppm: a.ppm, f0: r0.x, gap: (a.t - r0.t) / DAY, proj, f1: r1.x, dA, R: (r1.x - proj) / a.ppm, n: p.n, cum: p.cum });
    }
  }
  // retention model: intercept only, + prior additions (count), or + cumulative SO₂ added; keep a slope only if |t| ≥ 2
  const use = ret.filter(r => r.ppm >= 5 && isFinite(r.R));
  const Rs = use.map(r => r.R), N = use.length;
  const mean = N ? Rs.reduce((s, x) => s + x, 0) / N : +C.so2R;
  const fN = N >= 5 ? ols(use.map(r => r.n), Rs) : null, fC = N >= 5 ? ols(use.map(r => r.cum), Rs) : null;
  const best = [fN && ['n', fN], fC && ['cum', fC]].filter(Boolean).sort((x, y) => x[1].sse - y[1].sse)[0] || null;
  const model = best && Math.abs(best[1].t) >= 2 ? { x: best[0], a: best[1].a, b: best[1].b, t: best[1].t } : { x: null, a: mean, b: 0, t: 0 };
  const fit = r => model.a + model.b * (model.x ? r[model.x] : 0);
  const off = new Map();
  for (const r of use) { const o = off.get(r.b) || { s: 0, n: 0 }; o.s += r.R - fit(r); o.n++; off.set(r.b, o); }
  const Rfit = (b, x) => {
    const base = (N * (model.a + model.b * (model.x ? x[model.x] : 0)) + w * +C.so2R) / (N + w), o = off.get(b);
    return Math.min(1.2, Math.max(0.15, base + (o ? o.s / (o.n + w) : 0)));
  };
  const fitted = +C.so2UseFit === 1, Rhat = (b, x) => (fitted ? Rfit(b, x) : +C.so2R);
  return { C, D, pairs, types, kOf, ret, use, mean, fN, fC, model, Rhat, Rfit, fitted, typeOf, N, w };
}

// Per-vessel SO₂ status for one wine: rows for each vessel holding it now (a barrel group still on its group record is one
// row, with the per-barrel share). asof = now unless given (YYYY-MM-DD HH:MM:SS).
export function status(c, bid, cal = null, asof = null) {
  cal = cal || calibrate(c);
  const C = cal.C, now = asof ? T(asof) : Date.now(), D = cal.D;
  const cont = current_contents(c).filter(x => x.batch_id === bid && x.volume_l > 0.05);
  const lotLast = (k) => { let best = null; for (const l of D.ev.values()) for (const e of l) if (e.k === k && e.b === bid && (!best || e.t > best.t)) best = e; return best; };
  const lotF = lotLast('F'), lotP = lotLast('P'), lotS = lotLast('S');
  const p = prior(D.lots, bid, now);
  const Rnext = cal.Rhat(bid, p);
  return cont.map(x => {
    const v = D.vs.get(x.vessel_id), l = (D.ev.get(x.vessel_id) || []).filter(e => e.t <= now);
    let s = 0; for (let i = 0; i < l.length; i++) if (l[i].k === 'X') s = i + 1;   // since the wine came into this vessel
    const mine = l.slice(s).filter(e => e.b === bid || e.k === 'A');
    const last = k => mine.filter(e => e.k === k).pop() || null;
    let f = last('F'), fsrc = 'vessel'; if (!f && lotF) { f = lotF; fsrc = 'lot'; }
    let ph = last('P'), psrc = 'vessel'; if (!ph && lotP) { ph = lotP; psrc = 'lot'; }
    if (!ph) { ph = { x: C.so2AssumePH ?? 3.6, at: null, t: null }; psrc = 'assumed'; }   // v1.71: no pH yet — assume 3.6 (Ken), errs a little high on KMS
    let ts = last('S'); if (!ts && lotS) ts = lotS;
    const kk = cal.kOf(x.vessel_id), V = x.volume_l;
    // v1.71.1: no free SO₂ reading — start from 0 plus every KMS addition to this wine (any vessel, so additions before a transfer count)
    // v1.71.2 (Ken): KMS added before the wine's last yeast addition (crush / pre-ferment) is used up by fermentation — not counted
    const yeastAt = c.val(`SELECT MAX(o.occurred_at) FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
                           WHERE a.batch_id=? AND o.reversed=0 AND m.kind='yeast'`, bid);
    const yT = yeastAt ? T(yeastAt) : -Infinity;
    const lotAll = (D.lots.get(bid) || []).filter(e => e.t <= now && e.ppm > 0);
    const lotAdds = lotAll.filter(e => e.t > yT), preFerm = lotAll.filter(e => e.t <= yT);
    const addsSince = f ? mine.filter(e => e.k === 'A' && e.t > f.t) : lotAdds;
    const est = kv => (f ? f.x * Math.exp(-kv * (now - f.t) / DAY) : 0) + addsSince.reduce((t, a) => t + (a.ppm || 0) * cal.Rhat(bid, prior(D.lots, bid, a.t)) * Math.exp(-kv * (now - a.t) / DAY), 0);
    const e = est(kk.k), lo = est(kk.hi), hi = est(kk.lo);
    const tot = ts ? ts.x + (D.ev.get(x.vessel_id) || []).filter(a => a.k === 'A' && a.t > ts.t && a.t <= now).reduce((t, a) => t + (a.ppm || 0), 0) : null;
    const age = f ? (now - f.t) / DAY : null;
    const phOk = ph && ph.x >= 2.8 && ph.x <= 4.2;
    const tg = [0.5, 0.8].map(M => {
      if (!ph || !phOk) return null;
      const tf = target(M, ph.x), need = Math.max(0, tf - e);
      return { M, tf, g: need * V / 1000 / C.kmsSO2 / Rnext, need };
    });
    const warn = [];
    if (!f && preFerm.length) warn.push(`KMS added before fermentation (${preFerm.map(e => `${num(e.ppm, 0)} mg/L on ${day(new Date(e.t).toISOString())}`).join(', ')}) is not counted — used up by fermentation`);
    if (!f) warn.push(addsSince.length ? `no free SO₂ reading — estimate starts from 0 plus the KMS added since fermentation (${addsSince.map(e => `${num(e.ppm, 0)} mg/L on ${day(new Date(e.t).toISOString())}`).join(', ')}); measure free SO₂ to confirm` : 'no free SO₂ reading — initial dose assumes 0 free SO₂');
    if (psrc === 'assumed') warn.push(`no pH reading — assumed pH ${num(ph.x, 1)}`); else if (!phOk) warn.push(`pH ${num(ph.x, 2)} outside 2.8–4.2 — no grams`);
    if (age !== null && age > C.so2StaleDays) warn.push('re-test recommended');
    if (tg[1] && tg[1].tf > C.so2TargetMax) warn.push(`0.8 molecular needs ${num(tg[1].tf, 0)} mg/L free (pH ${num(ph.x, 2)})`);
    if (tot !== null && tot > C.so2TotalMax) warn.push(`est. total SO₂ ${num(tot, 0)} mg/L, above ${num(C.so2TotalMax, 0)}`);
    const ms = v.kind === 'barrel_group' ? VU.members(c, v.id) : [];
    return { vid: x.vessel_id, code: x.vessel, kind: v.kind, type: kk.type, V, members: ms, f, fsrc, age, ph, psrc, ts, tot, est: e, lo, hi, k: kk, R: Rnext, tg, warn, addsSince: addsSince.length };
  }).sort((a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true }));
}

const TYPE = { barrel: 'barrel', tank: 'fixed tank', var: 'variable-capacity' };
// HTML table; fill = true makes the target cells clickable (addition sheet)
export function table(c, bid, opts = {}) {
  const cal = opts.cal || calibrate(c), rows = status(c, bid, cal), C = cal.C;
  const b = c.one('SELECT code FROM batch WHERE id=?', bid);
  if (!rows.length) return `<div class="so2p"><div class="so2h"><b>SO₂ · ${E(b ? b.code : '')}</b></div><p class="muted">Not in any vessel now.</p></div>`;
  const R = rows[0].R, ago = d => d === null ? '' : d < 1 ? 'today' : `${Math.round(d)} d`;
  const gcell = (r, t) => {
    if (!t) return '<td class="n muted">—</td>';
    const g = t.g, txt = g <= 0.05 ? '0 g' : `${num(g, g < 10 ? 1 : 0)} g`;
    const per = r.members.length && g > 0.05 ? `<em>${num(g / r.members.length, 1)} g × ${r.members.length} barrels</em>` : '';
    const inner = g <= 0.05 ? `<em>free SO₂ target ${num(t.tf, 0)} mg/L</em><b>no KMS needed</b>` : `<em>free SO₂ target ${num(t.tf, 0)} mg/L</em>add <b>${txt} KMS</b><em>raises free SO₂ ≈ ${num(t.need, 0)} mg/L</em>${per}`;
    return opts.fill && g > 0.05 ? `<td class="n so2t" data-v="${r.vid}" data-g="${num(g, 1).replace(/,/g, '')}" title="Fill the addition with ${num(g, 1)} g KMS for ${E(r.code)}">${inner}</td>` : `<td class="n">${inner}</td>`;
  };
  const body = rows.map(r => `<tr><td><a href="/vessel/${r.vid}">${E(r.code)}</a><em>${TYPE[r.type]}${r.members.length ? ' · ' + r.members.map(m => E(m.code)).join(', ') : ''}</em></td>
<td class="n">${num(r.V, 0)} L<em>${num(r.V / GAL, 1)} gal</em></td>
<td class="n">${r.ph ? num(r.ph.x, 2) : '—'}${r.ph ? `<em>${r.psrc === 'assumed' ? 'assumed (no pH yet)' : `${r.psrc === 'lot' ? 'lot pH · ' : ''}${day(r.ph.at)}`}</em>` : ''}</td>
<td class="n">${r.f ? num(r.f.x, 0) : '0'}${r.f ? `<em>${r.fsrc === 'lot' ? 'lot · ' : ''}${day(r.f.at)} · ${ago(r.age)}</em>` : '<em>assumed (no reading)</em>'}</td>
<td class="n">${r.est === null ? '—' : `<b>${num(r.est, 0)}</b><em>${num(r.lo, 0)}–${num(r.hi, 0)} · k ${num(r.k.k, 4)}${r.addsSince ? ` · ${r.addsSince} add.` : ''}</em>`}</td>
${gcell(r, r.tg[0])}${gcell(r, r.tg[1])}</tr>${r.warn.length ? `<tr class="so2w"><td colspan="7">${r.warn.map(E).join(' · ')}</td></tr>` : ''}`).join('');
  return `<div class="so2p"><div class="so2h"><b>SO₂ · ${E(b ? b.code : '')}${HELP('so2')}</b><span class="muted">KMS ${C.kmsSO2} g SO₂/g · retention ${num(R, 2)} ${cal.fitted ? `(measured, ${cal.use.length} past additions)` : '(Constants; measured ' + num(cal.Rfit(bid, prior(cal.D.lots, bid, Date.now())), 2) + ' — not in use)'} · <a href="/so2/calibration">how these are worked out</a></span></div>
<div class="so2tw"><table><thead><tr><th>Vessel</th><th class="n">Volume</th><th class="n">pH</th><th class="n">Last free SO₂</th><th class="n">Est. today${HELP('so2', 'Last free SO₂ decayed at this vessel’s rate k, plus each KMS addition since × retention. Range: the middle half of the decay rates seen in this vessel type.')}</th><th class="n">KMS to add for<br>0.5 molecular</th><th class="n">KMS to add for<br>0.8 molecular${HELP('so2', 'Grams of potassium metabisulfite (KMS) to add to this vessel now. Target = the free SO₂ that gives this molecular SO₂ at the vessel’s pH; grams = (target − today’s estimate) × litres ÷ 1000 ÷ 0.576 g SO₂ per g KMS ÷ retention.')}</th></tr></thead><tbody>${body}</tbody></table></div>
${opts.fill ? '<p class="muted" style="font-size:12px;margin:6px 0 0">Click a target to fill the addition with those grams.</p>' : ''}</div>`;
}
export const CSS = `<style>.so2p{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:10px 0}.so2h{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;margin-bottom:6px}.so2h b{color:var(--fg2);font-size:15px}.so2h span{font-size:12px}
.so2tw{overflow-x:auto}.so2tw table{width:100%;font-size:13px}.so2tw thead th{position:static!important}.so2tw td{vertical-align:top}.so2tw em{display:block;font-style:normal;font-size:11.5px;color:var(--mut);white-space:nowrap}
.so2t{cursor:pointer;border-radius:6px}.so2t:hover{background:var(--line2)}.so2t.on{outline:2px solid var(--acc)}.so2w td{color:#f0b84a;font-size:12px;padding-top:0;border-top:0}</style>`;

// /so2/calibration — what the data say, before relying on it
export function page_calibration(c) {
  const cal = calibrate(c), C = cal.C, vc = id => (cal.D.vs.get(id) || {}).code || id;
  const bc = new Map(c.all('SELECT id, code FROM batch').map(b => [b.id, b.code]));
  const f = x => x === null || x === undefined ? '—' : num(x, 4);
  const types = Object.entries(cal.types).map(([k, t]) => `<tr><td>${TYPE[k]}</td><td class="n">${t.n}</td><td class="n">${f(t.raw)}</td><td class="n">${f(t.def)}</td><td class="n"><b>${f(t.k)}</b></td><td class="n">${f(Math.max(0, t.k - t.spread))}–${f(t.k + t.spread)}</td></tr>`).join('');
  const fitRow = (n, x) => x ? `<tr><td>${n}</td><td class="n">${num(x.a, 3)}</td><td class="n">${num(x.b, 5)}</td><td class="n">${num(x.t, 2)}</td><td class="n">${num(x.sse, 3)}</td></tr>` : '';
  const m = cal.model, Rall = cal.N ? (cal.N * m.a + cal.w * C.so2R) / (cal.N + cal.w) : C.so2R;
  const ret = cal.ret.slice().sort((a, b) => b.at.localeCompare(a.at)).map(r => `<tr><td>${E(day(r.at))}</td><td>${E(vc(r.v))}</td><td>${E(bc.get(r.b) || '')}</td><td class="n">${num(r.g, 0)} g</td><td class="n">${num(r.V, 0)}</td><td class="n">${num(r.ppm, 1)}</td><td class="n">${num(r.f0, 0)} <small>${num(r.gap, 0)} d before</small></td><td class="n">${num(r.proj, 1)}</td><td class="n">${num(r.f1, 0)} <small>${num(r.dA, 0)} d after</small></td><td class="n"><b>${num(r.R, 2)}</b></td><td class="n">${r.n}</td><td class="n">${num(r.cum, 0)}</td></tr>`).join('');
  const prs = cal.pairs.slice().sort((a, b) => b.t1.localeCompare(a.t1)).map(p => `<tr><td>${E(vc(p.v))}</td><td>${TYPE[p.type]}</td><td>${E(bc.get(p.b) || '')}</td><td>${E(day(p.t0))}</td><td class="n">${num(p.f0, 0)}</td><td>${E(day(p.t1))}</td><td class="n">${num(p.f1, 0)}</td><td class="n">${num(p.dt, 0)}</td><td class="n">${num(p.k, 4)}</td></tr>`).join('');
  return `<h1>SO₂ calibration${HELP('so2')}</h1><p class="sub">Fitted from every free SO₂ reading and KMS addition in the records (Vintrace history included). Defaults and the shrinkage weight are on <a href="/constants">Constants</a>.</p>
<h2>Decay of free SO₂ — ${cal.pairs.length} reading pairs</h2><p class="sub">A pair = two consecutive free SO₂ readings in one vessel, same wine, both above 0, 1–180 days apart, with no sulfite addition and no wine moved in between, and the first reading at least 2 days after any addition. k = Σ ln(F0/F1) ÷ Σ days. Type k = (n·fitted + ${cal.w}·default)/(n + ${cal.w}); each vessel is shrunk toward its type the same way. Range = middle half of the pair rates for that type.</p>
<div class="so2tw"><table><thead><tr><th>Type</th><th class="n">Pairs</th><th class="n">Fitted k /day</th><th class="n">Default</th><th class="n">Used</th><th class="n">Range</th></tr></thead><tbody>${types}</tbody></table></div>
<h2>Retention of KMS additions — ${cal.ret.length} additions</h2><p class="sub">An addition counts when the same vessel has a free SO₂ reading before it (nothing else in between) and the next reading 2–14 days after it. R = (after − before decayed to the addition) ÷ ppm added; ppm = g × 576 ÷ L. Additions under 5 ppm are left out of the fit (${cal.use.length} used).</p>
<div class="so2tw"><table><thead><tr><th>Model</th><th class="n">Intercept</th><th class="n">Slope</th><th class="n">t</th><th class="n">Squared error</th></tr></thead><tbody>
<tr><td>Mean only</td><td class="n">${num(cal.mean, 3)}</td><td class="n">—</td><td class="n">—</td><td class="n"></td></tr>${fitRow('R ~ prior additions to the lot (count)', cal.fN)}${fitRow('R ~ cumulative SO₂ added to the lot (mg/L)', cal.fC)}</tbody></table></div>
<p>${m.x ? `Kept: <b>${m.x === 'n' ? 'prior additions' : 'cumulative SO₂ added'}</b> (|t| ≥ 2).` : 'Neither predictor is supported by the data (|t| < 2), so the fit is the mean.'} Overall measured retention, shrunk toward ${num(C.so2R, 2)} with weight ${cal.w}: <b>${num(Rall, 2)}</b>. Each wine then gets its own offset, shrunk the same way.
Doses now use <b>${cal.fitted ? 'the measured retention' : `R = ${num(C.so2R, 2)} from Constants`}</b>${cal.fitted ? '' : ' — set “Use measured retention” to 1 on Constants to switch'}.</p>
<div class="so2tw"><table><thead><tr><th>Date</th><th>Vessel</th><th>Wine</th><th class="n">KMS</th><th class="n">L</th><th class="n">ppm added</th><th class="n">Free before</th><th class="n">Projected</th><th class="n">Free after</th><th class="n">R</th><th class="n">Prior adds</th><th class="n">Cum. ppm</th></tr></thead><tbody>${ret || '<tr><td colspan="12" class="muted">None</td></tr>'}</tbody></table></div>
<h2>The reading pairs</h2><div class="so2tw"><table><thead><tr><th>Vessel</th><th>Type</th><th>Wine</th><th>From</th><th class="n">Free</th><th>To</th><th class="n">Free</th><th class="n">Days</th><th class="n">k</th></tr></thead><tbody>${prs}</tbody></table></div>${CSS}`;
}
