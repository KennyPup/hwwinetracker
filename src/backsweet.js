// v1.56: back-sweetening in past vintages of the same wine, for the batch page (Ken's bench trials).
// Back-sweetening = sugar or honey added on or after the batch's first potassium sorbate day, or after fermentation ended
// (the Stop ferment entry, else the first free SO2 reading after the last Brix — same split as the Lab charts).
// "Same wine" = any batch sharing a name key with this one: the code without its vintage (whole, and up to the first - or _),
// or the description without its year; letters only, upper case, "BERRY" dropped so Blueberry Cider = Blue Cider = BLUECIDER.
import { E, num } from './lib/py.js';

const LB = 0.45359237, GAL = 3.785411784;
const norm = s => String(s || '').toUpperCase().replace(/^\s*\d{2,4}\s*/, '').replace(/[^A-Z]/g, '').replace(/BERRY/g, '');
export function wine_keys(code, desc) {
  const stem = String(code || '').replace(/^\d+/, '');
  return new Set([norm(stem), norm(stem.split(/[-_ ]/)[0]), norm(desc)].filter(k => k.length >= 2));
}
export function same_wine(c, bid) {
  const me = c.one('SELECT id, code, description FROM batch WHERE id=?', bid);
  if (!me) return { keys: [], ids: [] };
  const mk = wine_keys(me.code, me.description);
  const ids = c.all('SELECT id, code, description FROM batch WHERE id<>?', bid).filter(b => [...wine_keys(b.code, b.description)].some(k => mk.has(k))).map(b => b.id);
  return { keys: [...mk], ids };
}
const day = t => String(t || '').slice(0, 10);

export function additions(c, ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const out = [];
  const sweet = c.all(`SELECT a.batch_id, b.code, o.id op, o.occurred_at t, m.name, m.kind, a.amount_base kg, m.base_unit bu, a.batch_volume_l v
                       FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id JOIN batch b ON b.id=a.batch_id
                       WHERE o.reversed=0 AND m.kind IN ('sugar','honey') AND a.batch_id IN (${ph}) ORDER BY o.occurred_at`, ...ids);
  const byB = new Map();
  for (const s of sweet) { if (!byB.has(s.batch_id)) byB.set(s.batch_id, []); byB.get(s.batch_id).push(s); }
  for (const [b, list] of byB) {
    const sorb = c.all(`SELECT o.occurred_at t, a.amount_base kg, a.batch_volume_l v FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
                        WHERE o.reversed=0 AND m.kind='sorbate' AND a.batch_id=? ORDER BY o.occurred_at`, b);
    const k0 = sorb.length ? day(sorb[0].t) : null;
    const stop = c.val(`SELECT MAX(o.occurred_at) FROM operation o JOIN op_vessel v ON v.op_id=o.id WHERE o.reversed=0 AND o.op_type='Stop ferment' AND (v.batch_id=? OR v.batch_after_id=?)`, b, b);
    const lastBrix = c.val(`SELECT MAX(o.occurred_at) FROM op_analysis an JOIN operation o ON o.id=an.op_id WHERE o.reversed=0 AND an.batch_id=? AND an.metric='Brix'`, b);
    const so2 = lastBrix ? c.val(`SELECT MIN(o.occurred_at) FROM op_analysis an JOIN operation o ON o.id=an.op_id WHERE o.reversed=0 AND an.batch_id=? AND an.metric='Free SO2' AND o.occurred_at>?`, b, lastBrix) : null;
    for (const s of list) {
      const why = k0 && day(s.t) >= k0 ? 'sorbate' : (stop ? s.t >= stop : so2 ? s.t >= so2 : false) ? 'after ferment' : null;
      if (!why) continue;
      const kg = s.bu === 'kg' ? s.kg : s.bu === 'g' ? s.kg / 1000 : s.bu === 'lb' ? s.kg * LB : null;
      const sd = sorb.filter(x => day(x.t) === day(s.t));
      const sg = sd.reduce((a, x) => a + (x.kg || 0) * 1000, 0);
      const after = c.one(`SELECT an.metric m, an.value v, o.occurred_at t FROM op_analysis an JOIN operation o ON o.id=an.op_id
                           WHERE o.reversed=0 AND an.batch_id=? AND an.metric IN ('Brix','SG') AND an.value IS NOT NULL AND o.occurred_at>=? AND o.occurred_at<=datetime(?, '+10 days')
                           ORDER BY o.occurred_at LIMIT 1`, b, s.t, s.t);
      out.push({ bid: b, code: s.code, t: s.t, name: s.name, kg, v: s.v, gpl: kg && s.v ? kg * 1000 / s.v : null, why, sorb_g: sg || null, after });
    }
  }
  const g = new Map();   // one back-sweetening per batch and day: lines summed (e.g. 2 × 25 kg), sorbate counted once
  for (const r of out) {
    const k = r.bid + '|' + day(r.t), x = g.get(k);
    if (!x) { g.set(k, { ...r, names: new Set([r.name]) }); continue; }
    x.kg = (x.kg || 0) + (r.kg || 0); x.v = Math.max(x.v || 0, r.v || 0) || null; x.names.add(r.name);
    if (r.t < x.t) { x.t = r.t; x.after = r.after || x.after; }
  }
  return [...g.values()].map(x => ({ ...x, name: [...x.names].join(' + '), gpl: x.kg && x.v ? x.kg * 1000 / x.v : null })).sort((a, b) => (a.t < b.t ? 1 : -1));
}

const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

export function card(c, bid) {
  const { keys, ids } = same_wine(c, bid);
  const own = additions(c, [bid]), past = additions(c, ids);
  if (!own.length && !past.length) return '';
  const g = past.filter(r => r.gpl).map(r => r.gpl);
  const md = median(g), lo = g.length ? Math.min(...g) : null, hi = g.length ? Math.max(...g) : null;
  const nb = new Set(past.map(r => r.bid)).size;
  const rd = [...own, ...past].some(r => r.after);   // reading column only when some batch was measured after sweetening
  const lpg = x => num(x * GAL / 1000 / LB, x < 12 ? 3 : 2);
  const row = (r, mine) => `<tr${mine ? ' class="bs-own"' : ''}><td><a href="/batch/${r.bid}">${E(r.code)}</a>${mine ? ' <small>this batch</small>' : ''}</td><td class="sk-nw">${E(day(r.t))}</td><td>${E(r.name)}</td>
<td class="n" data-v="${r.kg || ''}">${r.kg ? `${num(r.kg, 1)} kg<small>${num(r.kg / LB, 1)} lb</small>` : ''}</td>
<td class="n" data-v="${r.v || ''}">${r.v ? `${num(r.v, 0)} L<small>${num(r.v / GAL, 0)} gal</small>` : '—'}</td>
<td class="n" data-v="${r.gpl || ''}"><b>${r.gpl ? num(r.gpl, 1) : '—'}</b>${r.gpl ? `<small>${lpg(r.gpl)} lb/gal</small>` : ''}</td>
<td class="n">${r.sorb_g ? `${num(r.sorb_g, 0)} g<small>${r.v ? num(r.sorb_g / r.v * 1000, 0) + ' mg/L' : ''}</small>` : r.why === 'after ferment' ? '<small>none (after ferment)</small>' : ''}</td>
${rd ? `<td>${r.after ? `${E(r.after.m)} ${num(r.after.v, r.after.m === 'SG' ? 3 : 1)}<small>${E(day(r.after.t))}</small>` : ''}</td>` : ''}</tr>`;
  const sum = g.length ? `Past vintages: median <b>${num(md, 1)} g/L</b> (${lpg(md)} lb/gal), range ${num(lo, 1)}–${num(hi, 1)} g/L over ${g.length} addition${g.length === 1 ? '' : 's'} in ${nb} batch${nb === 1 ? '' : 'es'}.` : 'No back-sweetening recorded on earlier vintages.';
  return `<h2>Back-sweetening, this wine over the years</h2>
<p class="sub" style="margin-top:0">${sum} <span class="muted">Sugar or honey added with potassium sorbate or after fermentation ended, on batches named like this one (${E(keys.join(' / '))}). Rate = amount ÷ volume in the tank at the time${rd ? '; reading = first Brix or SG within 10 days after' : ''}.</span></p>
<div class="sk-tw"><table class="sortable"><thead><tr><th>Batch</th><th>Date</th><th>Sweetener</th><th class="n">Amount</th><th class="n">Volume</th><th class="n">g/L</th><th class="n">Sorbate</th>${rd ? '<th>Reading after</th>' : ''}</tr></thead><tbody>
${own.map(r => row(r, true)).join('')}${past.map(r => row(r, false)).join('')}</tbody></table></div>
<style>.bs-own td{background:rgba(56,139,253,.08)}.sk-tw td small{display:block;color:var(--mut);font-size:11.5px}.sk-nw{white-space:nowrap}</style>`;
}

// v1.56: "Typical finishing" block at the foot of the Élevage / Ready card — how earlier vintages of this wine were finished,
// applied to what is in the tank now (V litres): packaging dry goods of the latest run per size with stock on hand,
// back-sweetening rate, sorbate rate (both from past practice) and KMS from the SO₂ calculator.
function runs_of(c, b) {
  return c.all(`SELECT e.id, e.occurred_at t, e.quantity q, e.vt_ref, e.op_id, s.code, s.litres_per_unit l FROM stock_event e JOIN stock_item s ON s.id=e.item_id
                WHERE e.action='Package' AND e.quantity>0 AND s.is_finished=1 AND (
                  e.op_id IN (SELECT ov.op_id FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE ov.batch_id=? AND o.reversed=0)
                  OR (e.op_id IS NULL AND e.occurred_at IN (SELECT o.occurred_at FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
                        WHERE ov.batch_id=? AND o.op_type='Packaging' AND o.reversed=0)))`, b, b);
}
function dry_of(c, r) {
  const w = r.op_id ? ['e.op_id=?', r.op_id] : r.vt_ref ? ['e.vt_ref=?', r.vt_ref] : null;
  if (!w) return [];
  return c.all(`SELECT s.id, s.code, s.name, s.category cat, -SUM(e.quantity) q, (SELECT COALESCE(SUM(quantity),0) FROM stock_event x WHERE x.item_id=s.id) onhand
                FROM stock_event e JOIN stock_item s ON s.id=e.item_id WHERE ${w[0]} AND e.action='Package' AND e.quantity<0 AND s.is_finished=0
                GROUP BY s.id ORDER BY s.category`, w[1]);
}
const CATORD = ['Bottles-Cans', 'Corks', 'Capsules', 'Wire Cage', 'Labels'];
const szName = l => !l ? '?' : l >= 1 ? `${+l.toFixed(2)} L` : Math.abs(l - 0.355) < 0.01 ? '355 ml can' : `${Math.round(l * 1000)} ml`;

export function finishing(c, bid, V, so2rows = null) {
  const { ids } = same_wine(c, bid);
  const batches = [bid, ...ids], code = new Map(c.all(`SELECT id, code FROM batch WHERE id IN (${batches.map(() => '?').join(',')})`, ...batches).map(r => [r.id, r.code]));
  // packaging: latest run per bottle size (among this wine's batches) that recorded its dry goods
  const bySize = new Map();
  for (const b of batches) for (const r of runs_of(c, b)) {
    const k = r.l ? r.l.toFixed(3) : '?';
    const x = bySize.get(k) || { l: r.l, n: 0, best: null };
    x.n++;
    if (!x.best || r.t > x.best.t) { const d = dry_of(c, r); if (d.length) x.best = { ...r, b, d }; }
    bySize.set(k, x);
  }
  const sizes = [...bySize.values()].filter(x => x.best).sort((a, b) => (a.best.t < b.best.t ? 1 : -1));
  const newest = sizes.length ? sizes[0].best.t : '';
  const recent = sizes.filter(x => x.best.t >= String(Number(newest.slice(0, 4)) - 3) + newest.slice(4));   // sizes used within 3 years of the latest run
  const pk = recent.map(x => {
    const r = x.best, need = x.l ? V / x.l : null;
    const items = r.d.sort((p, q) => CATORD.indexOf(p.cat) - CATORD.indexOf(q.cat)).map(d => {
      const per = r.q ? d.q / r.q : 1, want = need ? need * per : null, short = want !== null && d.onhand < want;
      return `<div class="fz-i"><a href="/item/${d.id}">${E(d.name && d.name !== d.code ? d.name : d.code)}</a> <span class="muted">${E(d.cat)}${Math.abs(per - 1) > 0.05 ? ` · ${num(per, 2)} per unit` : ''}</span><b class="${short ? 'fz-short' : ''}" title="${want ? `about ${num(want, 0)} needed if all ${num(V, 0)} L go into ${E(szName(x.l))}` : ''}">${num(d.onhand, 0)} on hand</b></div>`;
    }).join('');
    return `<div class="fz-s"><div class="fz-h">${E(szName(x.l))} <span class="muted">— last as ${E(r.code)}${code.get(r.b) && code.get(r.b) !== r.code ? ` from ${E(code.get(r.b))}` : ''}, ${E(day(r.t))}${need ? ` · this tank ≈ ${num(need, 0)} if all go into this size` : ''}</span></div>${items}</div>`;
  }).join('');
  // back-sweetening and sorbate: recent practice (median of the latest 5 past additions), applied to V
  const past = additions(c, ids), own = additions(c, [bid]);
  const rec = past.filter(r => r.gpl).slice(0, 5), gpl = median(rec.map(r => r.gpl));
  const sorbRec = past.filter(r => r.sorb_g && r.v).slice(0, 5).map(r => r.sorb_g / r.v * 1000), mgl = median(sorbRec);
  const last = rec[0];
  const lines = [];
  if (gpl) lines.push(`<div class="fz-l"><span>Back-sweetening</span><b>${num(gpl * V / 1000, 1)} kg <small>${num(gpl * V / 1000 / LB, 1)} lb</small></b><em>${num(gpl, 1)} g/L, median of the last ${rec.length} · last: ${E(last.code)} ${E(day(last.t))} ${num(last.gpl, 1)} g/L ${E(String(last.name).replace(/^Sugar /, ''))}</em></div>`);
  if (mgl) lines.push(`<div class="fz-l"><span>Potassium sorbate</span><b>${num(mgl * V / 1000, 0)} g</b><em>${num(mgl, 0)} mg/L as before</em></div>`);
  // KMS: the SO₂ calculator's dose to 0.8 (and 0.5) molecular for the current readings
  if (so2rows && so2rows.length) {
    const ok = so2rows.filter(r => r.tg && r.tg[1]);
    if (ok.length) {
      const g8 = ok.reduce((t, r) => t + r.tg[1].g, 0), g5 = ok.reduce((t, r) => t + r.tg[0].g, 0), ph = ok[0].ph.x;
      lines.push(`<div class="fz-l"><span>KMS</span><b>${num(g8, 1)} g</b><em>to 0.8 molecular (${num(g5, 1)} g to 0.5) at pH ${num(ph, 2)}${ok[0].psrc === 'assumed' ? ' (assumed — no pH yet)' : ''}${ok[0].f ? '' : ', no free SO₂ reading (from 0)'}, est. free ${num(ok[0].est, 0)} mg/L${ok.length < so2rows.length ? ' · some vessels lack readings' : ''}${ok.some(r => r.warn && r.warn.includes('re-test recommended')) ? ' · re-test first' : ''}</em></div>`);
    } else lines.push(`<div class="fz-l"><span>KMS</span><b>—</b><em>${E((so2rows[0].warn || []).join('; ') || 'needs free SO₂ and pH')}</em></div>`);
  }
  if (!pk && !lines.length) return '';
  const hist = [...own, ...past].filter(r => r.gpl);
  const list = hist.length ? `<details class="fz-d"><summary>past sweetenings (${hist.length})</summary>${hist.map(r => `<div><a href="/batch/${r.bid}">${E(r.code)}</a> ${E(day(r.t))} · ${num(r.kg, 1)} kg in ${num(r.v, 0)} L · <b>${num(r.gpl, 1)} g/L</b>${r.sorb_g ? ` · sorbate ${num(r.sorb_g / r.v * 1000, 0)} mg/L` : ''}${r.bid === bid ? ' <small>this batch</small>' : ''}</div>`).join('')}</details>` : '';
  return `<div class="csec fz"><div class="csh">Typical finishing <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">for ${num(V, 0)} L, from earlier vintages</span></div>
${lines.join('')}${pk ? `<div class="fz-pk">${pk}</div>` : ''}${list}</div>
<style>.fz-l{display:grid;grid-template-columns:118px 1fr;column-gap:8px;margin:4px 0}.fz-l span{color:var(--mut);font-size:12.5px}.fz-l b{color:var(--fg2)}.fz-l b small{color:var(--mut);font-weight:400}.fz-l em{grid-column:2;font-style:normal;font-size:12px;color:var(--mut)}
.fz-pk{margin-top:8px}.fz-s{margin:6px 0}.fz-h{font-weight:600;color:var(--fg2);font-size:13px}.fz-h .muted{font-weight:400;font-size:12px}.fz-i{display:flex;gap:6px;align-items:baseline;font-size:12.5px;margin:2px 0 2px 8px}.fz-i b{margin-left:auto;white-space:nowrap;font-weight:500}.fz-short{color:#d29922}
.fz-d{margin-top:6px;font-size:12.5px}.fz-d summary{cursor:pointer;color:var(--acc)}.fz-d div{margin:2px 0}</style>`;
}
