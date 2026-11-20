// v1.75 — the wine card beside the Batches list (desktop): the selected wine's free SO₂ runway, where it is, its latest
// note and readings, ＋ Record and the batch tabs — so the everyday work starts from the list without opening the batch page.
// Free SO₂ comes from so2.status() (same estimate, targets and KMS grams as the batch page's SO₂ table); the only new figure
// is the date the estimate falls to the 0.5-molecular target: days = ln(estimate ÷ target) ÷ k, per vessel.
import { E, num } from './lib/py.js';
import { GAL, TABS, latest_snap, ctx } from './core.js';
import * as hw_ui from './hw_ui.js';
import * as notes from './notes.js';
import * as stage from './stage.js';
import * as CC from './cellarcard.js';
import * as VU from './vessel_ui.js';
import * as S2 from './so2.js';
import { auto_film } from './film.js';
import { batch_menu } from './opmenu.js';
import { current_contents as entry_contents } from './entry.js';

const DAY = 864e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dshort = t => { const d = new Date(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const dlong = t => { const d = new Date(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const COL = ['#58a6ff', '#bc8cff', '#56d4dd', '#f778ba', '#c9d1d9', '#a5d6ff'];   // none close to the amber / red target lines or the green KMS ticks   // one colour per vessel (all ≥ 4.5:1 on the card)

// modelled free SO₂ in one vessel at time t (same terms as status().est, moved to t)
function model(r, t) {
  const k = r.k.k;
  let y = r.f && t >= r.f.t ? r.f.x * Math.exp(-k * (t - r.f.t) / DAY) : 0;
  for (const a of r.hist.terms) if (t >= a.t) y += a.eff * Math.exp(-k * (t - a.t) / DAY);
  return y;
}
const t05 = r => (r.tg && r.tg[0] ? r.tg[0].tf : null);
// days until this vessel's estimate reaches the 0.5-molecular target (0 = already at or below it; null = cannot say)
function daysLeft(r) {
  const tf = t05(r);
  if (tf === null) return null;
  if (r.est <= tf) return 0;
  return r.k.k > 0 ? Math.log(r.est / tf) / r.k.k : null;
}
// the vessel that needs KMS first: smallest margin over its 0.5 target
const margin = r => (t05(r) === null ? Infinity : r.est - t05(r));   // no target (pH out of range): ranked last
export const lowest = rows => rows.slice().sort((a, b) => margin(a) - margin(b) || a.est - b.est)[0] || null;

// Batches list: one cell per wine — estimate in the lowest vessel against its 0.5 target. data-v (sort value) = margin, mg/L.
export function so2_cell(c, bid, cal, fermenting) {
  if (fermenting) return '<td class="n bl-so2 muted" data-v="" title="Fermenting — free SO₂ is not tracked until fermentation ends">—</td>';
  const rows = S2.status(c, bid, cal), r = lowest(rows);
  if (!r) return '<td class="n bl-so2" data-v=""></td>';
  const tf = t05(r), tf8 = r.tg && r.tg[1] ? r.tg[1].tf : null;
  const cls = tf === null ? '' : r.est < tf ? 's-lo' : (tf8 !== null && r.est < tf8) ? 's-mid' : 's-ok';
  const word = tf === null ? '' : r.est < tf ? 'below 0.5' : (tf8 !== null && r.est < tf8) ? 'below 0.8' : 'at 0.8';
  const scale = Math.max(1, (tf8 ?? tf ?? r.est) * 1.3, r.est);
  const bar = `<span class="sbar"><i class="${cls}" style="width:${Math.min(100, 100 * r.est / scale).toFixed(0)}%"></i>${tf !== null ? `<u style="left:${(100 * tf / scale).toFixed(0)}%"></u>` : ''}</span>`;
  const tip = `Estimated free SO₂ today in ${r.code}${rows.length > 1 ? ` (of ${rows.length} vessels, the one that needs KMS first)` : ''}: ${num(r.est, 0)} mg/L` + (tf !== null ? ` · 0.5 molecular = ${num(tf, 0)} mg/L at pH ${num(r.ph.x, 2)}${r.psrc === 'assumed' ? ' (assumed)' : ''}` : '') + (r.f ? '' : ' · no free SO₂ reading — estimate only');
  return `<td class="n bl-so2" data-v="${tf === null ? '' : margin(r).toFixed(1)}" title="${E(tip)}"><b>${num(r.est, 0)}</b>${r.f ? '' : '<span class="q" role="img" aria-label="estimate, no reading">?</span>'}${bar}<small>${E(word)}${rows.length > 1 ? ` · ${E(r.code)}` : ''}</small></td>`;
}

// the runway chart: one line per vessel — readings (dots), KMS additions (green ticks), the estimate to today (solid; dashed
// throughout when there is no reading yet) and its projection (dashed), with the 0.5 / 0.8 molecular target lines.
function chart(rows, now) {
  const W = 440, H = 190, L = 34, R = 8, T = 10, B = 26, lead = lowest(rows);
  const starts = rows.map(r => (r.f ? r.f.t : r.hist.terms.length ? Math.min(...r.hist.terms.map(a => a.t)) : now));
  const dl = rows.map(daysLeft).filter(d => d !== null && d > 0);
  const horizon = Math.min(150, Math.max(30, (dl.length ? Math.max(...dl) : 0) * 1.15));
  const t0 = Math.max(Math.min(...starts, now - 14 * DAY), now - 240 * DAY), t1 = now + horizon * DAY;
  const tf5 = t05(lead), tf8 = lead.tg && lead.tg[1] ? lead.tg[1].tf : null;
  let ymax = Math.max(tf8 ?? 0, tf5 ?? 0, 10);
  for (const r of rows) { for (const p of r.hist.F) if (p.t >= t0) ymax = Math.max(ymax, p.x); for (let i = 0; i <= 40; i++) ymax = Math.max(ymax, model(r, t0 + (t1 - t0) * i / 40)); ymax = Math.max(ymax, r.hi || 0); }
  ymax = Math.ceil(ymax * 1.12 / 10) * 10;
  const X = t => L + (t - t0) / (t1 - t0) * (W - L - R), Y = v => T + (1 - Math.min(v, ymax) / ymax) * (H - T - B);
  const f1 = v => v.toFixed(1);
  const o = [`<svg class="rw-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Free SO₂ runway: readings, estimate to today and projection, with the 0.5 and 0.8 molecular targets">`,
    `<path d="M${L} ${T}V${H - B}H${W - R}" fill="none" stroke="#30363d"/>`];
  for (const v of [0, ymax / 2, ymax]) o.push(`<text x="${L - 5}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${num(v, 0)}</text>`);
  if (tf8 !== null) o.push(`<path d="M${L} ${f1(Y(tf8))}H${W - R}" stroke="#d29922" stroke-dasharray="5 4" fill="none"/><text class="hl" x="${L + 6}" y="${f1(Y(tf8) - 4)}" style="fill:#d29922">0.8 molecular · ${num(tf8, 0)}</text>`);
  if (tf5 !== null) o.push(`<path d="M${L} ${f1(Y(tf5))}H${W - R}" stroke="#ff7b72" stroke-dasharray="2 3" fill="none"/><text class="hl" x="${L + 6}" y="${f1(Y(tf5) + 11)}" style="fill:#ff7b72">0.5 molecular · ${num(tf5, 0)}</text>`);
  o.push(`<path d="M${f1(X(now))} ${T}V${H - B}" stroke="#8b949e" stroke-dasharray="2 3" fill="none"/><text x="${f1(X(now))}" y="${H - 12}" text-anchor="middle" style="fill:#e6edf3">today</text>`);
  if (X(now) - L > 62) o.push(`<text x="${L}" y="${H - 12}">${E(dshort(t0))}</text>`);
  if (W - R - X(now) > 62) o.push(`<text x="${W - R}" y="${H - 12}" text-anchor="end">${E(dshort(t1))}</text>`);
  rows.forEach((r, i) => {
    const col = COL[i % COL.length], s = Math.max(t0, starts[i]);
    const seg = (a, b) => { const n = 24, p = []; for (let j = 0; j <= n; j++) { const t = a + (b - a) * j / n; p.push(`${j ? 'L' : 'M'}${f1(X(t))} ${f1(Y(model(r, t)))}`); } return p.join(''); };
    // a KMS addition is a step up: draw each stretch between additions separately so the jump is vertical
    const cuts = [s, ...r.hist.terms.map(a => a.t).filter(t => t > s && t < now), now];
    for (let j = 0; j < cuts.length - 1; j++) {
      if (j) o.push(`<path d="M${f1(X(cuts[j]))} ${f1(Y(model(r, cuts[j] - 1)))}V${f1(Y(model(r, cuts[j])))}" stroke="${col}" stroke-width="1.5" fill="none"/>`);
      o.push(`<path d="${seg(cuts[j], cuts[j + 1] - 1)}" stroke="${col}" stroke-width="2" fill="none"${r.f ? '' : ' stroke-dasharray="6 3"'}/>`);
    }
    o.push(`<path d="${seg(now, t1)}" stroke="${col}" stroke-width="2" stroke-dasharray="3 4" fill="none" opacity=".85"/>`);
    // KMS ticks: this vessel's additions, plus the additions counted in its estimate (with no reading yet those are the lot's, any vessel)
    const ticks = new Map(); for (const a of r.hist.A) ticks.set(a.t, a); for (const a of r.hist.terms) if (!ticks.has(a.t)) ticks.set(a.t, { t: a.t, ppm: 0 });
    for (const a of ticks.values()) if (a.t >= t0 && a.t <= now) o.push(`<path d="M${f1(X(a.t))} ${H - B}v-7" stroke="#3fb950" stroke-width="2"><title>KMS added ${E(dlong(a.t))}${a.ppm ? ` · ${num(a.ppm, 0)} mg/L` : ''} (${E(r.code)})</title></path>`);
    for (const p of r.hist.F) if (p.t >= t0) o.push(`<circle cx="${f1(X(p.t))}" cy="${f1(Y(p.x))}" r="3.5" fill="${col}"><title>${E(r.code)} · free SO₂ ${num(p.x, 0)} mg/L · ${E(dlong(p.t))}</title></circle>`);
    if (r.f && r.fsrc === 'lot' && r.f.t >= t0) o.push(`<circle cx="${f1(X(r.f.t))}" cy="${f1(Y(r.f.x))}" r="3.5" fill="none" stroke="${col}" stroke-width="1.5"><title>${E(r.code)} · lot reading ${num(r.f.x, 0)} mg/L · ${E(dlong(r.f.t))} (measured before the wine came into this vessel)</title></circle>`);
    if (r.hi - r.lo > 0.5) o.push(`<path d="M${f1(X(now))} ${f1(Y(r.lo))}V${f1(Y(r.hi))}" stroke="${col}" stroke-width="1" opacity=".7"/>`);
    o.push(`<circle cx="${f1(X(now))}" cy="${f1(Y(r.est))}" r="4" fill="#161b22" stroke="${col}" stroke-width="2"><title>${E(r.code)} · estimated today ${num(r.est, 0)} mg/L (range ${num(r.lo, 0)}–${num(r.hi, 0)})</title></circle>`);
  });
  o.push('</svg>');
  return o.join('');
}

function so2_block(c, bid, fermenting, nowCount, cal) {
  if (fermenting) return '<div class="rw"><div class="rw-h"><b>Free SO₂ runway</b></div><p class="muted rw-n">Fermenting — the runway starts once fermentation ends (set the stage to Élevage).</p></div>';
  if (!nowCount) return '';
  const rows = S2.status(c, bid, cal);
  if (!rows.length) return '';
  const now = rows[0].now, r = lowest(rows), tf = t05(r), d = daysLeft(r);
  const g8 = rows.every(x => x.tg && x.tg[1]) ? rows.reduce((t, x) => t + x.tg[1].g, 0) : null;
  const gtxt = g8 === null ? '' : g8 <= 0.05 ? 'no KMS needed for 0.8 molecular' : `${num(g8, g8 < 10 ? 1 : 0)} g KMS brings ${rows.length > 2 ? `all ${rows.length} vessels` : rows.length === 2 ? 'both vessels' : 'it'} to 0.8 molecular`;
  let act;
  if (tf === null) act = '<span class="rw-a">pH outside 2.8–4.2 — no target</span>';
  else if (d === 0) act = `<span class="rw-a lo">Below 0.5 molecular — add KMS now</span>`;
  else if (d === null) act = '<span class="rw-a">No decay rate yet for this vessel</span>';
  else act = `<span class="rw-a${d <= 14 ? ' mid' : ''}">Add KMS by <b>${E(dlong(now + d * DAY))}</b> · ${d < 1.5 ? 'about a day' : `${Math.round(d)} days`}</span>`;
  const none = rows.every(x => !x.f && !x.hist.terms.length);
  const notes_ = [];
  if (rows.some(x => x.psrc === 'assumed')) notes_.push(`pH ${num(r.ph.x, 1)} assumed — no pH reading yet; the targets move once one is recorded`);
  if (rows.some(x => !x.f)) notes_.push(none ? 'no free SO₂ reading and no KMS since fermentation — measure free SO₂' : 'no free SO₂ reading yet — dashed line is an estimate from the KMS added; measure to confirm');
  else if (rows.some(x => x.warn.includes('re-test recommended'))) notes_.push('last reading is old — re-test recommended');
  if (rows.length > 1 && rows.some(x => t05(x) !== null && Math.abs(t05(x) - tf) > 0.5)) notes_.push(`target lines are for ${r.code}; the other vessels have a different pH`);
  const legend = rows.map((x, i) => `<span><i style="background:${COL[i % COL.length]}"></i><a href="/vessel/${x.vid}">${E(x.code)}</a> <b>${num(x.est, 0)}</b>${x.f ? ` <em>last read ${num(x.f.x, 0)}${x.fsrc === 'lot' ? ' (lot)' : ''} · ${x.age < 1 ? 'today' : `${Math.round(x.age)} d ago`}</em>` : ' <em>no reading</em>'}</span>`).join('');
  return `<div class="rw"><div class="rw-h"><b>Free SO₂ runway</b><span>est. today <b class="rw-e">${num(r.est, 0)}</b> mg/L${rows.length > 1 ? ` in ${E(r.code)} (needs KMS first)` : ''}</span></div>
<div class="rw-act">${act}${gtxt ? `<span class="muted">${E(gtxt)}</span>` : ''}</div>
${none ? '' : chart(rows, now)}<div class="rw-l">${legend}</div>${notes_.length ? `<p class="rw-n">${notes_.map(E).join(' · ')}</p>` : ''}</div>`;
}

const WS = /^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?\s*[—–-]\s*/;   // the automatic "YYYY-MM-DD HH:MM — " stamp at the start of a note
function note_fact(c, nts) {
  if (!nts.length) return '<div class="bc-note none"><span>Last note</span><p class="muted">No notes on this wine.</p></div>';
  const n = nts[0], txt = String(n.detail || '').trim().replace(WS, '');
  let film = null;
  try { const o = c.one('SELECT film FROM note_film WHERE note_id=?', n.id); film = o ? !!o.film : auto_film(txt); } catch (e) { film = auto_film(txt); }
  const head = Array.from(txt).slice(0, 180).join('');
  return `<div class="bc-note"><span>Last note · ${E(String(n.noted_at || '').slice(0, 10))} · ${E(hw_ui.ago(n.noted_at))}${film ? ' · <b class="film">film yeast</b>' : ''}</span><p>${E(head)}${head.length < txt.length ? '…' : ''}</p></div>`;
}

export const CSS = `<style>.bl{display:flex;gap:18px;align-items:flex-start}.bl-main{flex:1 1 0;min-width:0}
#bcard{flex:0 0 470px;width:470px;box-sizing:border-box;background:var(--card);border:1px solid var(--line2);border-radius:8px;padding:16px 18px;position:sticky;top:68px;max-height:calc(100vh - 80px);overflow:auto}
#bcard.busy{opacity:.55}
@media(max-width:1100px){#bcard{display:none}.bl{display:block}}
@media(min-width:1101px){.bl-yr,.bl-ty{display:none}#bl tbody tr{cursor:pointer}#bl tbody tr.sel td{background:var(--blue-t)}#bl tbody tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--acc)}}
.bl-so2 b{font-weight:600;color:var(--fg2)}.bl-so2 .q{color:var(--amber);margin-left:2px}.bl-so2 small{white-space:nowrap}
.sbar{display:block;position:relative;height:6px;border-radius:3px;background:var(--line);margin:3px 0 2px auto;width:72px}.sbar i{display:block;height:100%;border-radius:3px;background:#8b949e}.sbar i.s-lo{background:#f85149}.sbar i.s-mid{background:#d29922}.sbar i.s-ok{background:#3fb950}.sbar u{position:absolute;top:-2px;width:2px;height:10px;background:var(--fg2)}
.bc-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.bc-h .code{font-size:28px;font-weight:650;line-height:1.1;color:var(--fg2)}.bc-h .code:hover{text-decoration:none;color:var(--acc)}.bc-h .om-btn{margin-left:auto}
.bc-d{font-size:15px;color:var(--fg2);margin:6px 0 10px}.bc-d .stpill{margin-left:8px;vertical-align:middle}
.rw{border-top:1px solid var(--line);padding:10px 0 12px}.rw-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}.rw-h b{color:var(--fg2);font-weight:600}.rw-h span{margin-left:auto;font-size:13px}.rw-e{font-size:18px}
.rw-act{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;margin:4px 0 6px;font-size:13px}.rw-a{color:var(--fg2);font-weight:600}.rw-a.lo{color:#ff7b72}.rw-a.mid{color:#e3b341}
.rw-svg{display:block;width:100%;height:auto}.rw-svg text{font-size:10.5px;fill:var(--mut)}.rw-svg text.hl{paint-order:stroke;stroke:var(--card);stroke-width:3px;stroke-linejoin:round}
.rw-l{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;margin-top:4px}.rw-l i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}.rw-l b{color:var(--fg2)}.rw-l em{font-style:normal;color:var(--mut);font-size:12px}
.rw-n{margin:6px 0 0;font-size:12px;color:#e3b341}p.muted.rw-n{color:var(--mut)}
.bc-v{border-top:1px solid var(--line);padding:8px 0}.bc-v div{display:flex;align-items:baseline;gap:8px;padding:3px 0;font-size:13.5px}.bc-v div>a:first-child{font-weight:700}.bc-v small{color:var(--mut)}.bc-v .acts{margin-left:auto;display:flex;gap:10px;white-space:nowrap;font-size:12.5px}
.bc-note{background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:4px;padding:7px 11px;margin:4px 0 10px}.bc-note span{display:block;font-size:12px;color:var(--mut)}.bc-note p{margin:2px 0 0;font-size:13px;white-space:pre-wrap}.bc-note .film{color:#ff7b72}
.bc-f{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;padding:10px 0;border-top:1px solid var(--line)}.bc-f span{display:block;font-size:12px;color:var(--mut)}.bc-f b{display:block;font-weight:600;color:var(--fg2)}
.bc-t{display:flex;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:8px;gap:2px}.bc-t a{padding:6px 9px;font-size:13px;font-weight:600;border-radius:5px;color:var(--acc)}.bc-t a:hover{background:var(--hi);text-decoration:none}
.bc-a{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 10px}.bc-a a{padding:6px 12px;border:1px solid var(--line2);border-radius:6px;background:var(--bg);color:var(--fg);font-weight:600;font-size:13px}.bc-a a:hover{text-decoration:none;border-color:var(--acc)}</style>`;

// The card's inner HTML for one wine (also served on its own at /batches/card?id= when a row is clicked).
export function card(c, bid, cal = null) {
  const b = c.one('SELECT * FROM batch WHERE id=?', bid);
  if (!b) return '<p class="muted">Wine not found.</p>';
  const sd = latest_snap(c), back = `/batches?sel=${bid}`, nx = encodeURIComponent(back);
  const now = c.all(`SELECT v.id, v.code, v.kind, v.capacity_l, s.volume_l, s.tax_state, s.tax_class, s.product_state FROM bulk_snapshot s JOIN vessel v ON v.id=s.vessel_id
                     WHERE s.batch_id=? AND s.snap_date=? ORDER BY v.code`, bid, sd);
  const tot = now.reduce((t, r) => t + (r.volume_l || 0), 0);
  const bev = hw_ui.bev_map(c).get(bid), st = stage.current(c, bid), fermenting = (st || {}).stage === 'fermenting';
  const nts = notes.for_batch(c, bid);
  const menu = batch_menu(bid, b.code, now.filter(r => r.kind !== 'barrel_group'), VU.wine_groups(c, entry_contents(c)).filter(g => now.some(r => g.ids.includes(r.id))), back);
  const g = CC.grouped(c, now).filter(e => (e.volume_l || 0) > 0.05).sort((x, y) => (y.volume_l || 0) - (x.volume_l || 0));
  const vrows = g.map(e => { const vp = e.group && !e.legacy ? 'g' + e.id : String(e.id);
    return `<div><a href="/vessel/${e.id}">${E(e.code)}</a><small>${num(e.volume_l / GAL, 0)} gal / ${num(e.volume_l, 0)} L${e.group && e.members && e.members.length ? ` · ${e.members.length} barrels` : ''}</small><span class="acts"><a href="/record/addition?vessel_id=${vp}&_next=${nx}">Addition</a><a href="/record/measure?vessel_id=${vp}&_next=${nx}" title="Adjust the volume in ${E(e.code)} (racking, new dip …) with a reason">⚖ Adjust volume</a></span></div>`; }).join('');
  // last topping: barrels only (the same record the cellar card uses)
  const bids = [];
  for (const e of g) if (e.group) { bids.push(e.id); for (const r of e.rows || []) bids.push(r.id); for (const m of e.members || []) bids.push(m.id); } else if (e.kind === 'barrel') bids.push(e.id);
  // topping ops that topped this wine (role 'to'); the source tank of a topping does not count
  const top = bids.length ? c.val(`SELECT MAX(o.occurred_at) FROM operation o JOIN op_vessel ov ON ov.op_id=o.id WHERE o.reversed=0 AND o.op_type IN ('Topping','Multi topping')
                                   AND ov.role='to' AND (ov.batch_id=? OR ov.batch_after_id=?)`, bid, bid) : null;
  const last = c.val(`SELECT MAX(o.occurred_at) FROM operation o WHERE o.reversed=0 AND o.id IN (SELECT op_id FROM op_vessel WHERE batch_id=? UNION SELECT op_id FROM op_analysis WHERE batch_id=?
                      UNION SELECT op_id FROM op_addition WHERE batch_id=? UNION SELECT op_id FROM op_loss WHERE batch_id=?)`, bid, bid, bid, bid);
  const nops = c.val(`SELECT COUNT(*) FROM operation o WHERE o.id IN (SELECT op_id FROM op_vessel WHERE batch_id=? OR batch_after_id=? UNION SELECT op_id FROM op_addition WHERE batch_id=? UNION SELECT op_id FROM op_analysis WHERE batch_id=?)`, bid, bid, bid, bid);
  const facts = [['Volume', `${num(tot / GAL)} gal · ${num(tot)} L`], ['Type', E(bev || '—') + (b.variety ? ` · ${E(b.variety)}` : '')], ['Last operation', last ? `${E(hw_ui.ago(last))} · ${E(String(last).slice(0, 10))}` : '—']];
  if (bids.length) facts.push(['Last topping', top ? `${E(hw_ui.ago(top))} · ${E(String(top).slice(0, 10))}` : 'none recorded']);
  const tabs = TABS.map(([k, t]) => `<a href="/batch/${bid}${k === 'general' ? '' : `?tab=${k}`}">${E(t)}${k === 'history' ? ` (${nops})` : k === 'notes' && nts.length ? ` (${nts.length})` : ''}</a>`).join('');
  return `<div class="bc-h">${hw_ui.badge(bev, true)}<a class="code" href="/batch/${bid}" title="Open the full batch page">${E(b.code)}</a>${menu}</div>
<div class="bc-d">${E(b.description || '')}${st && st.stage ? stage.pill(st.stage) : ''}</div>
${so2_block(c, bid, fermenting, now.length, cal)}
${vrows ? `<div class="bc-v">${vrows}</div>` : '<div class="bc-v"><div class="muted">Not in a tank or barrel now.</div></div>'}
${note_fact(c, nts)}
<div class="bc-a"><a href="/record/lab?batch=${bid}&_next=${nx}">Lab readings</a><a href="/record/note?batch=${bid}&_next=${nx}">Note</a></div>
<div class="bc-f">${facts.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
<div class="bc-t">${tabs}</div>`;
}

// click a row → its card loads in place (wide screens); the code is still a real link (Ctrl/middle-click, narrow screens)
export const JS = `<script>(function(){var card=document.getElementById('bcard'),tb=document.querySelector('#bl tbody');if(!card||!tb)return;
var wide=function(){return matchMedia('(min-width:1101px)').matches},seq=0;
function run(el){[].forEach.call(el.querySelectorAll('script'),function(s){var n=document.createElement('script');n.textContent=s.textContent;s.parentNode.replaceChild(n,s)})}
function load(id,tr){var k=++seq;card.classList.add('busy');[].forEach.call(tb.rows,function(r){r.classList.toggle('sel',r===tr)});
 fetch('/batches/card?id='+id,{credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(h){if(k!==seq)return;card.innerHTML=h;card.classList.remove('busy');card.scrollTop=0;run(card);
  try{var u=new URL(location.href);u.searchParams.set('sel',id);u.searchParams.delete('saved');u.searchParams.delete('op');history.replaceState(null,'',u)}catch(e){}}).catch(function(){if(k===seq)location.href='/batch/'+id})}
tb.addEventListener('click',function(e){if(!wide()||e.ctrlKey||e.metaKey||e.shiftKey)return;var tr=e.target.closest('tr[data-b]');if(!tr)return;
 var a=e.target.closest('a');if(a&&!a.classList.contains('bl-code'))return;e.preventDefault();load(tr.dataset.b,tr)});
tb.addEventListener('dblclick',function(e){var tr=e.target.closest('tr[data-b]');if(tr&&!e.target.closest('small'))location.href='/batch/'+tr.dataset.b});
})()</script>`;
