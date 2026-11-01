// v1.38 — Analytics › Reductones. Ken has run the Vinmetrica peroxide ("B") test since 2022: apparent free SO₂ (run A) minus
// reductones (run B, ascorbic-acid-type compounds that titrate as SO₂) = actual free SO₂. Those results live in batch notes
// ("Apparent Free SO2: 20  Reductones: 6  Free SO2: 14" and freer wordings). This reads them, then shows which wines carry
// reductones and which don't — the point being which wines need the B run, and how far pre-Vinmetrica free SO₂ readings
// (before 2022, never corrected) may be inflated for the wines that do.
// v1.41 — (Ken, 2026-10-13: “typical ppm” and “share of apparent” were ambiguous; rows looked like one vintage) each row is
// named for the wine without its vintage and lists the vintages pooled; columns say what they are: apparent free SO₂, reductones
// and actual free SO₂ as medians in ppm, reductones as % of apparent, plus a worked example line under the table.
// v1.42 — key findings for KMS additions in the upper right (Ken: to size additions without falling short or over-adding),
// computed from the readings: which wines need the B run and by how much, which need no correction, how reductones drift.
import { E, num } from './lib/py.js';
import { tip as HELP } from './help.js';

const N = '(\\d+(?:\\.\\d+)?)';
const RX = {
  red: new RegExp(`(?:free\\s*so2\\s*)?reductones?(?:\\s*test)?\\s*(?:\\(free\\))?\\s*[:=]?\\s*${N}`, 'i'),
  app: new RegExp(`(?:apparent\\s*(?:free\\s*)?so2|free\\s*so2\\s*apparent|apparent\\s*value\\s*of)\\s*[:=]?\\s*${N}`, 'i'),
  act: new RegExp(`(?:actual\\s*(?:free\\s*)?so2|free\\s*so2\\s*actual|free\\s*so2)\\s*[:=]?\\s*${N}`, 'i'),
  ph: new RegExp(`\\bph\\s*[:=]?\\s*(\\d\\.\\d+)`, 'i'),
};

// one note → [{ app, red, act, ph, odd }] (one per vessel when a note lists several), or [] when it holds no readable B-run result
export function parse_note(text) {
  const t = String(text || '').replace(/\r/g, '');
  const ti = t.search(/total\s*so2/i);
  const free = ti >= 0 ? t.slice(0, ti) : t;
  const p = t.match(RX.ph), ph = p ? +p[1] : null;
  // a note can hold several A/B results (one per vessel): cut it where each "apparent" reading starts
  const cuts = [...free.matchAll(/(?:free\s*so2\s*)?apparent/gi)].map(m => m.index);
  const segs = cuts.length > 1 ? cuts.map((s0, i) => free.slice(s0, cuts[i + 1] ?? free.length)) : [free];
  const out = [];
  for (const seg of segs) {
    const r = seg.match(RX.red);
    if (!r) continue;
    const red = +r[1];
    const a = seg.match(RX.app), c = seg.slice(r.index + r[0].length).match(RX.act);
    let app = a ? +a[1] : null, act = c ? +c[1] : null;
    if (app === null && act === null) continue;
    if (app === null) app = act + red;
    if (act === null) act = Math.max(0, app - red);
    out.push({ app, red, act, ph, odd: Math.abs(app - red - act) > 1 });
  }
  return out;
}

// wine "family" from the batch code: vintage digits and size/lot suffixes dropped, trailing numbers dropped (25CranCider3 → CRANCIDER)
export const fam = code => (String(code || '').replace(/^(19|20)?\d\d/, '').split(/[_\s]/)[0].replace(/[^A-Za-z]/g, '').toUpperCase() || String(code)).replace(/\d+$/, '');

export function red_data(c) {
  const notes = c.all(`SELECT n.id, n.noted_at t, n.detail d, n.batch_id bid, b.code, b.description descr FROM batch_note n LEFT JOIN batch b ON b.id=n.batch_id
                       WHERE n.detail LIKE '%reducton%' OR n.detail LIKE '%peroxide%' ORDER BY n.noted_at`);
  const rd = [], unread = [];
  for (const n of notes) {
    const ps = parse_note(n.d);
    for (const p of ps) rd.push({ id: n.id, t: String(n.t).slice(0, 10), bid: n.bid, code: n.code || '(no wine)', descr: n.descr || '', fam: fam(n.code), ...p });
    if (!ps.length) unread.push({ id: n.id, t: String(n.t).slice(0, 10), bid: n.bid, code: n.code || '(no wine)', text: String(n.d || '').replace(/\s+/g, ' ').slice(0, 220) });
  }
  return { rd, unread };
}

const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * f, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

export function page_red(c, TABS) {
  const { rd, unread } = red_data(c);
  if (!rd.length) return `${TABS('red')}<h1>Reductones</h1><p class="muted">No reductone (peroxide B-run) results found in the notes yet.</p>`;
  const first = rd[0].t;
  // per family; shrink each family's mean toward the overall mean so one or two readings don't decide a verdict
  const all = rd.map(r => r.red), mu = all.reduce((s, v) => s + v, 0) / all.length, K = 3;
  const F = new Map();
  for (const r of rd) { if (!F.has(r.fam)) F.set(r.fam, []); F.get(r.fam).push(r); }
  const fams = [...F.entries()].map(([k, rs]) => {
    const v = rs.map(r => r.red), n = v.length, mean = v.reduce((s, x) => s + x, 0) / n;
    const shr = (n * mean + K * mu) / (n + K);
    const share = rs.filter(r => r.app > 0).map(r => r.red / r.app);
    const wines = [...new Set(rs.map(r => r.code))];
    const pos = v.filter(x => x > 0).length;
    // verdict from the family's own readings; the shrunk mean only orders the table and gives the "typical" figure
    const m0 = med(v), hiShare = v.filter(x => x >= 10).length / n;
    const verdict = pos === 0 ? 'none' : (m0 >= 8 || hiShare >= 0.25) ? 'carries' : (m0 >= 2 || Math.max(...v) >= 10) ? 'some' : 'low';
    const nm = new Map();
    for (const r of rs) { const d = String(r.descr || '').replace(/^\s*((19|20)?\d\d)(-\d)?\s+/, '').trim(); if (d) nm.set(d.toLowerCase(), [d, ((nm.get(d.toLowerCase()) || [])[1] || 0) + 1, r.t]); }
    const name = [...nm.values()].sort((a, b) => b[1] - a[1] || (b[2] > a[2] ? 1 : -1))[0]?.[0] || '';   // most-used name, latest on a tie
    const vint = [...new Set(rs.map(r => (String(r.code).match(/^(\d\d)/) || [])[1]).filter(Boolean))].sort();
    const cnt = new Map(); for (const r of rs) cnt.set(r.code, (cnt.get(r.code) || 0) + 1);
    return { k, rs, n, mean, shr, name, vint, cnt, medA: med(rs.map(r => r.app)), medF: med(rs.filter(r => r.act !== null && r.act !== undefined).map(r => r.act)), med: med(v), lo: Math.min(...v), hi: Math.max(...v), q1: q(v, 0.25), q3: q(v, 0.75), share: med(share), wines, pos, verdict, descr: rs[rs.length - 1].descr };
  }).sort((a, b) => b.shr - a.shr || b.n - a.n);
  // free SO₂ readings before the first B-run note (never corrected): how many per family, and the typical inflation to expect
  const pre = new Map();
  for (const r of c.all(`SELECT b.code, COUNT(*) n FROM op_analysis a JOIN operation o ON o.id=a.op_id JOIN batch b ON b.id=a.batch_id
                         WHERE a.metric='Free SO2' AND o.reversed=0 AND o.occurred_at < ? GROUP BY b.code`, first)) {
    const k = fam(r.code); pre.set(k, (pre.get(k) || 0) + r.n);
  }
  const VW = { carries: ['Carries — B run every time', '#f0883e'], some: ['Some — B run now and then', '#d29922'], low: ['Low — occasional check', '#8b949e'], none: ['None found', '#3fb950'] };
  const hiMax = Math.max(...fams.map(f => f.hi), 10);
  const W = 240, x = v => 6 + (v / hiMax) * (W - 12);
  const bars = fams.map(f => `<svg class="rd-b" viewBox="0 0 ${W} 18" width="${W}" height="18"><line x1="${x(f.lo)}" x2="${x(f.hi)}" y1="9" y2="9" stroke="${VW[f.verdict][1]}" stroke-width="1.5"/><rect x="${x(f.q1)}" y="4" width="${Math.max(2, x(f.q3) - x(f.q1))}" height="10" rx="2" fill="${VW[f.verdict][1]}" opacity=".55"/><circle cx="${x(f.med)}" cy="9" r="4" fill="${VW[f.verdict][1]}"/></svg>`);
  const P0 = x => x === null || x === undefined ? '—' : num(x, 0);
  const fr = fams.map((f, i) => `<tr><td><b>${E(f.name || f.k)}</b><small>${E(f.k)}${f.vint.length ? ` · ${f.vint.length === 1 ? 'vintage' : `${f.vint.length} vintages`} ${f.vint.map(y => '20' + y).join(', ')}` : ''}</small></td><td><span class="rd-v" style="border-color:${VW[f.verdict][1]};color:${VW[f.verdict][1]}">${E(VW[f.verdict][0])}</span>${f.n < 3 ? `<small>${f.n === 1 ? 'one reading' : 'two readings'} — confirm with another B run</small>` : ''}</td>
<td class="n" data-v="${f.n}">${f.n}<small>${f.pos} above 0</small></td>
<td class="n" data-v="${f.medA ?? -1}">${P0(f.medA)}</td><td class="n" data-v="${f.med}"><b>${P0(f.med)}</b></td><td class="n" data-v="${f.medF ?? -1}">${P0(f.medF)}</td>
<td class="n" data-v="${f.share ?? -1}">${f.share === null ? '—' : num(100 * f.share, 0) + '%'}</td><td class="n rd-nw" data-v="${f.hi}">${f.lo === f.hi ? num(f.lo, 0) : `${num(f.lo, 0)}–${num(f.hi, 0)}`}</td>
<td class="n" data-v="${f.shr.toFixed(2)}">${num(f.shr, 1)}</td><td class="rd-bc">${bars[i]}</td><td class="n" data-v="${pre.get(f.k) || 0}">${pre.get(f.k) ? `${pre.get(f.k)}${f.verdict === 'carries' || f.verdict === 'some' ? `<small>may read ~${num(f.med, 0)} ppm high</small>` : ''}` : '—'}</td>
<td class="rd-w">${[...f.cnt.keys()].sort().map(w => { const b = f.rs.find(r => r.code === w); const t = `${E(w)}</a> <span class="muted">×${f.cnt.get(w)}</span>`; return b && b.bid ? `<a href="/batch/${b.bid}?tab=notes">${t}` : `<a>${t}`; }).join(' · ')}</td></tr>`).join('');
  // a worked example from the best-documented family that carries reductones, so the columns read unambiguously
  const ex = fams.filter(f => f.verdict === 'carries' && f.medA !== null && f.medF !== null).sort((a, b) => b.n - a.n)[0];
  const exLine = ex ? `<p class="rd-ex"><b>Reading a row</b> — ${E(ex.name || ex.k)} (${ex.n} B runs): a typical run read <b>${P0(ex.medA)}</b> ppm apparent free SO₂, of which <b>${P0(ex.med)}</b> ppm was reductones (${num(100 * ex.share, 0)}% of the apparent reading), leaving <b>${P0(ex.medF)}</b> ppm actual free SO₂. Each figure is the median of its own column, so the three needn’t add up exactly. All figures are ppm (mg/L).</p>` : '';
  // key findings for KMS additions (upper right): computed from the readings, so they update as B runs are added
  const L = (fs, g, m = 4) => fs.slice(0, m).map(f => `${E(f.name || f.k)} ${g(f)}`).join(', ') + (fs.length > m ? ', …' : '');
  const solid = fams.filter(f => f.n >= 3);
  const car = solid.filter(f => f.verdict === 'carries').sort((a, b) => b.med - a.med);
  const nil = solid.filter(f => f.verdict === 'none').sort((a, b) => b.n - a.n);
  const age = new Map();   // per batch: B runs over time, for wines that showed reductones at all
  for (const r of rd) { if (!age.has(r.code)) age.set(r.code, []); age.get(r.code).push(r); }
  const drift = [];
  for (const [code, rs] of age) {
    const ts = rs.map(r => Date.parse(r.t) / (365.25 * 864e5)), span = Math.max(...ts) - Math.min(...ts);
    if (rs.length < 3 || span < 0.5 || Math.max(...rs.map(r => r.red)) < 5) continue;
    const mt = ts.reduce((a, b) => a + b, 0) / ts.length, mr = rs.reduce((a, r) => a + r.red, 0) / rs.length;
    const sl = rs.reduce((a, r, i) => a + (ts[i] - mt) * (r.red - mr), 0) / ts.reduce((a, t) => a + (t - mt) ** 2, 0);   // ppm per year
    drift.push({ code, sl, a: rs[0], b: rs[rs.length - 1], m: Math.round(span * 12) });
  }
  const fell = drift.filter(d => d.sl <= -3), rose = drift.filter(d => d.sl >= 3), held = drift.length - fell.length - rose.length;
  const bigFall = [...fell].sort((a, b) => (b.a.red - b.b.red) - (a.a.red - a.b.red))[0];
  const preCar = car.reduce((a, f) => a + (pre.get(f.k) || 0), 0);
  const summary = `<aside class="rd-sum"><h3>Key findings for KMS additions</h3><ol>
${car.length ? `<li><b>Dose from actual free SO₂ (A − B), not the A run.</b> In the ${car.length} wine${car.length > 1 ? 's' : ''} that carry reductones (3+ B runs), the A run reads high by a median of ${L(car, f => `${num(f.med, 0)}`, 5)} ppm — an addition sized from it falls short by about that much.</li>
<li><b>No B run?</b> Subtracting the wine’s median is only rough: half its B runs fall within ${L(car, f => `${num(f.q1, 0)}–${num(f.q3, 0)}`, 3)} ppm, so the addition can be off by ±${num(Math.max(...car.slice(0, 3).map(f => (f.q3 - f.q1) / 2)), 0)} ppm or more. Run B before a KMS addition to these.</li>` : ''}
${nil.length ? `<li><b>No correction for these:</b> ${nil.length} wines never showed reductones in 3+ B runs (${L(nil, () => '', 6).replace(/ ,/g, ',').trim()}). Their A run is the actual free SO₂ — subtracting a guess would over-add.</li>` : ''}
${drift.length ? `<li><b>Reductones change with time.</b> Of ${drift.length} wines with reductones tested over 6+ months, ${fell.length} fell, ${held} held steady${rose.length ? `, ${rose.length} rose` : ''}${bigFall ? ` (e.g. ${E(bigFall.code)}: ${num(bigFall.a.red, 0)} → ${num(bigFall.b.red, 0)} ppm over ${bigFall.m} months)` : ''}. Use a recent B run, not last season’s.</li>` : ''}
${preCar ? `<li><b>Older records:</b> ${preCar} free SO₂ readings on these wines before ${E(first)} were never corrected — read them as high by about the medians above.</li>` : ''}
</ol></aside>`;
  const nC = fams.filter(f => f.verdict === 'carries').length, nZero = fams.filter(f => f.verdict === 'none').length;
  const rows = [...rd].reverse().map(r => `<tr><td class="sk-nw">${E(r.t)}</td><td>${r.bid ? `<a href="/batch/${r.bid}?tab=notes">${E(r.code)}</a>` : E(r.code)}</td><td>${E(r.fam)}</td><td class="n">${num(r.app, 0)}</td><td class="n"><b>${num(r.red, 0)}</b></td><td class="n">${num(r.act, 0)}</td><td class="n">${r.app > 0 ? num(100 * r.red / r.app, 0) + '%' : '—'}</td><td class="n">${r.ph === null ? '' : num(r.ph, 2)}</td><td>${r.odd ? '<span class="rd-odd" title="apparent − reductones ≠ actual in the note">check</span>' : ''} <a href="/notes/edit?note=${r.id}&amp;back=/analytics/reductones">note</a></td></tr>`).join('');
  return `${TABS('red')}<h1>Reductones${HELP('red')}</h1>
<div class="rd-top"><div class="rd-intro"><p class="sub">Vinmetrica peroxide (“B”) runs read from your notes: <b>${rd.length}</b> results on <b>${new Set(rd.map(r => r.code)).size}</b> wines, ${E(first)} to ${E(rd[rd.length - 1].t)}. Reductones (ascorbic-acid-type compounds) titrate as SO₂, so apparent free SO₂ − reductones = actual free SO₂. <b>${nC}</b> wine families clearly carry them; <b>${nZero}</b> never showed any.</p>
<div class="rd-key">${Object.values(VW).map(([t, col]) => `<span><i style="background:${col}"></i>${E(t)}</span>`).join('')}<span class="muted">Bar: thick = middle half of readings, dot = median, thin line = lowest–highest (0–${num(hiMax, 0)} ppm)</span></div>${exLine}<p class="muted" style="font-size:13px">Verdict, from each family’s own readings: “carries” = median ≥ 8 ppm or a quarter of readings ≥ 10 ppm; “some” = median ≥ 2 ppm or any reading ≥ 10; “low” = only small readings; “none” = every B run was 0. “Weighted mean” is the wine’s mean reductones pulled toward the all-wine mean by ${K} readings’ worth (it orders the table, so a wine with one or two readings isn’t over-read). Each row pools every vintage of a wine by its batch code with the vintage dropped (21LHW … 24LHW are one row); a different code is a different row (24KiwiG is not 25Kiwi). Before ${E(first)} free SO₂ was never corrected, so for families that carry reductones those older readings are likely high by about the median shown — and the SO₂ decay and retention calibration (SO₂ page) uses them.</p></div>${summary}</div>
<div class="sk-tw"><table class="rd-t"><thead><tr><th>Wine<small>all vintages pooled</small></th><th>Verdict</th><th class="n">B runs</th><th class="n" title="Run A — free SO₂ as titrated, reductones included">Apparent free SO₂<small>median ppm</small></th><th class="n" title="Run A − run B">Reductones<small>median ppm</small></th><th class="n" title="Apparent − reductones">Actual free SO₂<small>median ppm</small></th><th class="n" title="For each B run, reductones ÷ apparent free SO₂; the median of those">Reductones % of apparent<small>median</small></th><th class="n">Reductones<small>range, ppm</small></th><th class="n" title="Mean reductones pulled toward the all-wine mean (${num(mu, 1)} ppm) by ${K} readings’ worth, so a wine with one or two readings isn’t over-read; orders the table">Reductones<small>weighted mean, ppm</small></th><th>Reductones spread</th><th class="n" title="Free SO₂ readings recorded before ${E(first)} (before the B test was used) — not corrected">Uncorrected free SO₂ readings<small>before ${E(first.slice(0, 4))}</small></th><th>Batches <small>(B runs each)</small></th></tr></thead><tbody>${fr}</tbody></table></div>

<details class="rd-all"><summary>Every result (${rd.length})</summary><div class="sk-tw"><table><thead><tr><th>Date</th><th>Wine</th><th>Family</th><th class="n">Apparent</th><th class="n">Reductones</th><th class="n">Actual free SO₂</th><th class="n">Reductones % of apparent</th><th class="n">pH</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></details>
${unread.length ? `<details class="rd-all"><summary>Notes that mention reductones but hold no readable A/B numbers (${unread.length}) — open to check</summary><ul class="rd-un">${unread.map(u => `<li><b>${E(u.t)}</b> ${u.bid ? `<a href="/batch/${u.bid}?tab=notes">${E(u.code)}</a>` : E(u.code)} — ${E(u.text)}${u.text.length >= 220 ? '…' : ''} <a href="/notes/edit?note=${u.id}&amp;back=/analytics/reductones">note</a></li>`).join('')}</ul></details>` : ''}
<style>.rd-top{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;margin-bottom:6px}.rd-intro{flex:1 1 420px;min-width:0}.rd-sum{flex:0 1 520px;background:var(--card);border:1px solid var(--line);border-left:4px solid #f0883e;border-radius:8px;padding:8px 14px 4px;font-size:13.5px;color:var(--fg)}.rd-sum h3{margin:2px 0 6px;font-size:15px;color:var(--fg2)}.rd-sum ol{margin:0 0 6px;padding-left:18px}.rd-sum li{margin:0 0 6px}.rd-t th small{display:block;font-weight:400;color:var(--mut);font-size:11px}.rd-ex{font-size:13.5px;background:var(--card);border:1px solid var(--line);border-left:4px solid #f0883e;border-radius:8px;padding:8px 12px;margin:10px 0}.rd-t td small{display:block;color:var(--mut);font-size:11.5px;font-weight:400}.rd-v{display:inline-block;border:1px solid;border-radius:10px;padding:1px 8px;font-size:12px;white-space:nowrap}
.rd-bc{min-width:250px}.rd-nw,.rd-t td small{white-space:nowrap}.rd-t td:first-child small{white-space:normal}.rd-b{display:block}.rd-w{font-size:12.5px;max-width:260px}.rd-key{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;margin:6px 0 10px;color:var(--fg)}.rd-key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.rd-all{margin:12px 0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}.rd-all summary{cursor:pointer;color:var(--fg2)}.rd-un{font-size:12.5px;color:var(--fg)}.rd-un li{margin:4px 0}.rd-odd{color:#f0b84a;font-size:12px}.sk-nw{white-space:nowrap}</style>`;
}
