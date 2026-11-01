// v1.24 — right-hand card on the batch page for a wine in élevage (or ready): where it is (every vessel, barrel groups opened up
// into their barrels), how full each one is, SO₂ (latest free SO₂, pH, molecular SO₂, days since the last sulfite addition),
// days since topping, and the latest note. Worked out afresh from the records on every page view.
import { tip as HELP } from './help.js';
import { E, num } from './lib/py.js';
import { GAL } from './core.js';
import * as VU from './vessel_ui.js';
import * as BS from './backsweet.js';
import * as S2 from './so2.js';

const D = s => Date.parse(String(s).replace(' ', 'T').slice(0, 19) + 'Z');
const ago = t => { if (!t) return null; const d = Math.floor((Date.now() - D(t)) / 864e5); return d < 0 ? 0 : d; };
const agoTxt = d => (d === null ? '' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} d ago`);
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = t => { const s = String(t || '').slice(0, 10); return s ? `${M[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}${s.slice(0, 4) !== String(new Date().getUTCFullYear()) ? ', ' + s.slice(0, 4) : ''}` : ''; };

// v1.26 barrel groups are labels over real barrels: the batch's barrels that belong to a group show as one group entry.
// Older Vintrace-style groups that still hold the wine themselves (a virtual vessel) are shown the same way.
export function grouped(c, now) {
  const out = [], byG = new Map();
  for (const r of now) {
    const g = r.kind === 'barrel' ? VU.group_of(c, r.id) : null;
    if (g) {
      if (!byG.has(g.id)) { const e = { group: true, id: g.id, code: g.code, members: g.members, rows: [], legacy: false }; byG.set(g.id, e); out.push(e); }
      byG.get(g.id).rows.push(r);
    } else if (r.kind === 'barrel_group') {
      out.push({ group: true, id: r.id, code: r.code, members: VU.members(c, r.id), rows: [r], legacy: true });
    } else out.push(r);
  }
  for (const e of out) if (e.group) {
    e.volume_l = e.rows.reduce((t, r) => t + (r.volume_l || 0), 0);
    e.capacity_l = e.legacy ? e.members.reduce((t, m) => t + (m.capacity_l || 0), 0) || null : e.rows.reduce((t, r) => t + (r.capacity_l || 0), 0);
  }
  return out;
}
export function where_text(c, now) {
  if (!now.length) return 'not in any vessel now';
  const g = grouped(c, now);
  const groups = g.filter(e => e.group), plain = g.filter(e => !e.group);
  const kinds = {};
  for (const r of plain) { const k = r.kind === 'barrel' ? 'barrel' : r.kind === 'tank' ? 'tank' : 'other'; kinds[k] = (kinds[k] || 0) + 1; }
  const parts = Object.entries(kinds).map(([k, n]) => (k === 'other' ? `${n} other` : `${n} ${k}${n > 1 ? 's' : ''}`))
    .concat(groups.map(e => `barrel group ${e.code}${e.members.length ? ` (${e.members.length} barrels)` : ''}`));
  return `in ${g.length} vessel${g.length !== 1 ? 's' : ''}${groups.length || parts.length > 1 ? ` — ${parts.join(' + ')}` : ''}`;
}

export function cellar_card(c, bid, now, tot, stg, nts) {
  const bar = (p, warn) => `<span class="cbar"><i style="width:${Math.max(0, Math.min(100, p)).toFixed(0)}%;${warn ? 'background:#d29922' : ''}"></i></span>`;
  // per vessel: fill, headspace, last topping / gas
  const lastTop = vid => c.val(`SELECT MAX(o.occurred_at) FROM operation o JOIN op_vessel ov ON ov.op_id=o.id WHERE ov.vessel_id=? AND o.reversed=0
                                AND o.op_type IN ('Topping','Multi topping')`, vid);
  const lastTopAny = ids => ids.map(lastTop).filter(Boolean).sort().pop() || null;
  const rows = grouped(c, now).sort((a, b) => (b.volume_l || 0) - (a.volume_l || 0)).map(r => {
    const isG = !!r.group, ms = isG ? r.members : [];
    const cap = r.capacity_l || (ms.length ? ms.reduce((t, m) => t + (m.capacity_l || 0), 0) : 0);
    const pct = cap ? 100 * (r.volume_l || 0) / cap : null;
    const head = cap ? cap - (r.volume_l || 0) : null;
    const fixed = isG || VU.is_fixed(c, r), barrel = r.kind === 'barrel' || isG;   // headspace only matters in fixed vessels; topping only for barrels
    const tp = barrel ? ago(isG ? lastTopAny([r.id].concat(r.legacy ? [] : r.rows.map(x => x.id))) : lastTop(r.id)) : null;
    const tags = [isG ? `barrel group${ms.length ? ` · ${ms.length} barrels` : ' · <a href="/vessel/' + r.id + '">set its barrels</a>'}` : E(r.kind || ''),
      r.tax_state === 'BONDED' ? `declared ${E(r.tax_class || '')}` : ''].filter(Boolean).join(' · ');
    const sub = [fixed ? (head !== null && head > 0.5 ? `<span class="${pct < 95 ? 'cw' : ''}">${num(head, 0)} L headspace</span>` : (cap ? 'full' : '')) : (cap ? 'variable lid' : ''),
      barrel ? (tp !== null ? `topped ${agoTxt(tp)}` : 'no topping recorded') : ''].filter(Boolean).join(' · ');
    return `<div class="crow"><a class="cn" href="/vessel/${r.id}">${E(r.code)}</a><span class="ck">${tags}</span>
<span class="cv"><b>${num(r.volume_l || 0, 0)}</b>${cap ? ` / ${num(cap, 0)}` : ''} <small>L</small></span>${pct !== null ? bar(pct, fixed && pct < 95) + `<span class="cp">${num(pct, 0)}%</span>` : '<span></span><span></span>'}
${sub ? `<div class="cs">${sub}</div>` : ''}${isG && !r.legacy ? `<div class="cm">${r.rows.slice().sort((x, y) => String(x.code).localeCompare(String(y.code), 'en', { numeric: true })).map(x => `<a href="/vessel/${x.id}">${E(x.code)}</a> <span class="cmv">${num(x.volume_l || 0, 0)}${x.capacity_l ? '/' + num(x.capacity_l, 0) : ''}</span>`).join(' · ')}</div>`
  : ms.length ? `<div class="cm">${ms.map(m => `<a href="/vessel/${m.id}">${E(m.code)}</a>`).join(' · ')}${r.legacy ? ` · <span class="cw">the wine is still on the group record — <a href="/vessel/${r.id}">move it into the barrels</a></span>` : ''}</div>` : ''}</div>`;
  }).join('');
  // SO₂
  const lab = m => c.one(`SELECT a.value v, o.occurred_at t, v.code vc FROM op_analysis a JOIN operation o ON o.id=a.op_id LEFT JOIN vessel v ON v.id=a.vessel_id
                          WHERE a.batch_id=? AND a.metric=? AND o.reversed=0 AND a.value IS NOT NULL ORDER BY o.occurred_at DESC, o.id DESC LIMIT 1`, bid, m);
  const fs = lab('Free SO2'), ph = lab('pH'), ts = lab('Total SO2');
  const ms = fs && ph ? fs.v / (1 + 10 ** (ph.v - 1.81)) : null;
  const so2add = c.one(`SELECT o.occurred_at t, m.name FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
                        WHERE a.batch_id=? AND o.reversed=0 AND m.kind='sulfite' ORDER BY o.occurred_at DESC LIMIT 1`, bid);
  const msCls = ms === null ? '' : ms < 0.4 ? 'cbad' : ms < 0.5 ? 'cwarn' : 'cgood';
  const so2 = `<div class="csec"><div class="csh">SO₂${HELP('cellar', 'Latest free SO₂ and pH of the wine; molecular = free ÷ (1 + 10^(pH − 1.81)), aim 0.5–0.8. Per-vessel estimates and KMS grams: the SO₂ table on the General tab.')}</div>
${fs ? `<div class="cl"><span>Free SO₂</span><b>${num(fs.v, 0)} <small>mg/L</small></b><em>${day(fs.t)} · ${agoTxt(ago(fs.t))}${fs.vc ? ' · ' + E(fs.vc) : ''}</em></div>` : '<div class="cl"><span>Free SO₂</span><b>—</b><em>no reading</em></div>'}
${ph ? `<div class="cl"><span>pH</span><b>${num(ph.v, 2)}</b><em>${day(ph.t)}</em></div>` : ''}
${ms !== null ? `<div class="cl"><span>Molecular SO₂</span><b class="${msCls}">${num(ms, 2)} <small>mg/L</small></b><em>${ms < 0.5 ? 'below the 0.5–0.8 protective range' : ms <= 0.8 ? 'in the 0.5–0.8 protective range' : 'above 0.8'}${ago(fs.t) > 60 ? ' · reading is old' : ''}</em></div>` : ''}
${ts ? `<div class="cl"><span>Total SO₂</span><b>${num(ts.v, 0)} <small>mg/L</small></b><em>${day(ts.t)}</em></div>` : ''}
<div class="cl"><span>Last sulfite</span><b>${so2add ? agoTxt(ago(so2add.t)) : '—'}</b><em>${so2add ? day(so2add.t) + ' · ' + E(so2add.name) : 'none recorded'}</em></div></div>`;
  const n0 = nts && nts[0];
  const txt = n0 ? String(n0.detail || '').replace(/\s+/g, ' ').trim() : '';
  const note = n0 ? `<div class="csec"><div class="csh">Latest note <span>${day(n0.noted_at)} · ${agoTxt(ago(n0.noted_at))}</span></div><div class="cnote">${E(txt.length > 320 ? txt.slice(0, 320) + '…' : txt)}</div>
<a href="/batch/${bid}?tab=notes">all notes (${nts.length})</a> · <a href="/record/note?batch=${bid}&amp;_next=/batch/${bid}">＋ note</a></div>` : `<div class="csec"><div class="csh">Latest note</div><span class="muted">No notes yet</span> · <a href="/record/note?batch=${bid}">＋ note</a></div>`;
  const label = stg === 'ready' ? 'Ready for packaging' : stg === 'elevage' ? 'Élevage' : stg === 'fermenting' ? 'Fermenting' : 'In the cellar';
  return `<div class="ccard"><div class="clab">${label} <span>${E(where_text(c, now))}</span></div>
<div class="cbig" data-nouc>${num(tot, 0)} <small>L</small> <span>${num(tot / GAL, 1)} gal</span></div>
<div class="csec"><div class="csh">Vessels${HELP('cellar')}</div>${rows || '<span class="muted">Not in any vessel</span>'}</div>${so2}${note}${(() => { try { return BS.finishing(c, bid, tot, S2.status(c, bid)); } catch (e) { return ''; } })()}
<div class="clinks"><a href="/record/lab?batch=${bid}&amp;_next=/batch/${bid}">＋ Lab readings</a> · <a href="/record/addition?vessel_id=${(() => { const t = grouped(c, now).sort((a, b) => (b.volume_l || 0) - (a.volume_l || 0))[0] || {}; return t.group && !t.legacy ? 'g' + t.id : (t.id || ''); })()}&amp;_next=/batch/${bid}">＋ Addition</a> · <a href="/labels/print?ids=${now.filter(r => r.kind !== 'barrel_group').map(r => r.id).join(',')}" target="_blank">🏷 Labels</a></div></div>`;
}

export const CSTYLE = `<style>.ccard{background:rgba(163,113,247,.07);border:1px solid rgba(163,113,247,.42);border-left:5px solid #a371f7;border-radius:10px;padding:10px 14px}
.ccard .clab{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a371f7;font-weight:700;display:flex;justify-content:space-between;gap:10px}.ccard .clab span{color:var(--mut);letter-spacing:0;text-transform:none;font-weight:600;text-align:right}
.ccard .cbig{font-size:30px;font-weight:700;color:var(--fg2);line-height:1.15;margin:2px 0 4px}.ccard .cbig small{font-size:16px;font-weight:600}.ccard .cbig span{font-size:14px;font-weight:400;color:var(--mut);margin-left:6px}
.ccard .csec{margin-top:9px;padding-top:7px;border-top:1px solid rgba(163,113,247,.22);font-size:13px}.ccard .csh{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between}.ccard .csh span{text-transform:none;letter-spacing:0;font-weight:600}
.ccard .crow{display:grid;grid-template-columns:minmax(0,1fr) auto 70px 34px;gap:2px 8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)}.ccard .crow:last-child{border-bottom:0}
.ccard .cn{grid-column:1/-1;font-weight:700;color:var(--fg2);font-size:14px;text-decoration:none}.ccard .cn:hover{text-decoration:underline}
.ccard .ck{color:var(--mut);font-size:12px;grid-column:1}.ccard .cv{color:var(--fg);white-space:nowrap;text-align:right}.ccard .cv small{color:var(--mut)}.ccard .cp{color:var(--mut);font-size:12px;text-align:right}
.ccard .cbar{display:block;height:7px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}.ccard .cbar i{display:block;height:100%;background:#a371f7;border-radius:4px}
.ccard .cs{grid-column:1/-1;font-size:12px;color:var(--mut)}.ccard .cs .cw{color:#f0b84a}.ccard .cm{grid-column:1/-1;font-size:12px}.ccard .cmv{color:var(--mut)}.ccard .cm .cw{color:#f0b84a}.ccard .cm a{color:var(--acc)}
.ccard .cl{display:grid;grid-template-columns:96px auto 1fr;gap:8px;align-items:baseline;margin:2px 0}.ccard .cl span{color:var(--mut)}.ccard .cl b{color:var(--fg2);white-space:nowrap}.ccard .cl b small{color:var(--mut);font-weight:400}.ccard .cl em{font-style:normal;color:var(--mut);font-size:12px}
.ccard .cgood{color:#3fb950!important}.ccard .cwarn{color:#f0b84a!important}.ccard .cbad{color:#f85149!important}
.ccard .cnote{color:var(--fg);line-height:1.4;margin-bottom:3px;white-space:pre-wrap}.ccard .clinks{font-size:12.5px;margin-top:9px;padding-top:7px;border-top:1px solid rgba(163,113,247,.25)}</style>`;
