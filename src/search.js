// Port of search.py — quick search ("25c" -> links to every match).
import { E, fxc, num } from './lib/py.js';
import { bottled_from, pack_size } from './core.js';
import { current_contents } from './entry.js';
import { search as S } from './gen/strings.js';
import * as hw_ui from './hw_ui.js';

export const WIDGET = S.WIDGET;
export const CSS = S.CSS;

// v1.64: ranked in groups — 1 wines in the cellar now (name, description, variety, base ingredient or an earlier name, anywhere in it;
// and tanks holding wine), 2 bottled & canned products (in stock first; plus the bottled stock of matching cellar wines),
// 3 materials (corks, labels, additives …), 4 past wines, 5 everything else (empty vessels, formulations, BOLs, retired items).
// Within a group: exact code, then code starting with the text, then code containing it, then other fields; then newest / largest.
export const GROUPS = ['', 'In the cellar now', 'Bottled & canned', 'Materials', 'Past wines', 'Other'];
export function search(c, q, limit = 40) {
  q = (q || '').trim();
  if (!q) return [];
  const esc = x => x.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const qn = q.replace(/\s+/g, ''), qu = qn.toUpperCase();
  const like_c = '%' + esc(q) + '%', like_nc = '%' + esc(qn) + '%', like_np = esc(qn) + '%', like_yr = /^\d{2}\D/.test(qn) ? '20' + like_np : like_np;
  const sd = c.val('SELECT MAX(snap_date) FROM bulk_snapshot');
  const bev = hw_ui.bev_map(c);
  let fcat = new Map();
  try { fcat = new Map(c.all('SELECT id, category FROM formula WHERE deleted=0').map(r => [r.id, r.category])); } catch (e) { /* no formula table */ }
  const cands = [], seen = new Set();
  // score: 0 exact code, 1 code starts with it (or 20+ it), 2 code contains it, 3 another field contains it
  const yq = /^\d{2}\D/.test(qu) ? '20' + qu : null;   // "25DB" also matches Vintrace's "2025DB" — only when the text starts with a 2-digit vintage
  const score = code => { const k = String(code || '').replace(/\s+/g, '').toUpperCase(); return k === qu || (yq && k === yq) ? 0 : k.startsWith(qu) || (yq && k.startsWith(yq)) ? 1 : k.includes(qu) ? 2 : 3; };
  function add(tier, sc, order, kind, key, label, sub, href, extra = null) {
    const sk = kind + '|' + key;
    if (seen.has(sk)) return;
    seen.add(sk);
    const b = kind === 'Batch' ? bev.get(key) : null;
    let l, bg, fg;
    if (kind === 'Batch') [l, bg, fg] = hw_ui.KIND[hw_ui.BEV_TO_KIND[b || ''] || ''] || ['·', '#30363d', '#8b949e'];
    else if (kind === 'Formula') [l, bg, fg] = hw_ui.KIND[fcat.get(key) || ''] || ['Rx', '#21262d', '#c9d1d9'];
    else [l, bg, fg] = [{ Vessel: 'Vs', BOL: 'BL', Stock: 'St' }[kind], '#21262d', '#c9d1d9'];
    cands.push({ tier, sc, order, it: { type: kind, label, sub, href, bev: b || '', l, bg, fg, grp: GROUPS[tier], ...(extra || {}) } });
  }
  // wines (batches): code, description, variety, base ingredient, earlier names
  let aliasOf = new Map();
  try { aliasOf = new Map(c.all("SELECT batch_id, GROUP_CONCAT(code, ', ') a FROM batch_alias WHERE REPLACE(code,' ','') LIKE ? ESCAPE '\\' GROUP BY batch_id", like_nc).map(r => [r.batch_id, r.a])); } catch (e) { /* no aliases */ }
  const brows = c.all(`SELECT b.id, b.code, b.description, b.variety, b.base_ingredient, b.production_year,
                         (SELECT SUM(volume_l) FROM bulk_snapshot s WHERE s.batch_id=b.id AND s.snap_date=?) L
                       FROM batch b WHERE REPLACE(b.code,' ','') LIKE ? ESCAPE '\\' OR b.description LIKE ? ESCAPE '\\' OR b.variety LIKE ? ESCAPE '\\'
                         OR b.base_ingredient LIKE ? ESCAPE '\\' OR b.id IN (${[...aliasOf.keys()].map(() => '?').join(',') || 'NULL'})`, sd, like_nc, like_c, like_c, like_c, ...aliasOf.keys());
  const activeHits = [];
  for (const r of brows) {
    const active = r.L > 0.05, sc = Math.min(score(r.code), aliasOf.has(r.id) ? 2 : 9);
    const sub = [r.description || '', aliasOf.has(r.id) ? `formerly ${aliasOf.get(r.id)}` : '', active ? `${fxc(r.L, 0)} L in cellar` : ''].filter(x => x).join(' · ');
    add(active ? 1 : 4, sc, active ? -r.L : -(r.production_year || 0), 'Batch', r.id, r.code, sub, `/batch/${r.id}`);
    if (active) activeHits.push(r);
  }
  // vessels (code starts with the text): a tank holding wine opens the wine (v1.59) and ranks with the cellar wines
  const vrows = c.all("SELECT id, code, kind, capacity_l FROM vessel WHERE REPLACE(code,' ','') LIKE ? ESCAPE '\\' AND kind NOT IN ('virtual','barrel_group') ORDER BY code LIMIT 60", like_np);
  if (vrows.length) {
    let inV = new Map(), grp = new Map();
    try { inV = new Map(current_contents(c).filter(x => x.batch && x.volume_l > 0.05).map(x => [x.vessel_id, x])); } catch (e) { /* contents unavailable */ }
    try { grp = new Map(c.all('SELECT m.vessel_id v, m.group_id g, gv.code gc FROM barrel_group_member m JOIN vessel gv ON gv.id=m.group_id').map(r => [r.v, r])); } catch (e) { /* no groups */ }
    for (const r of vrows) {
      const vs = score(r.code), size = r.capacity_l ? `${r.kind} · ${fxc(r.capacity_l, 0)} L` : r.kind;
      const gm = !inV.has(r.id) && grp.get(r.id), gx = gm && inV.get(gm.g), x = inV.get(r.id);
      if (gx) add(1, vs, 0, 'Vessel', r.id, r.code, `in barrel group ${gm.gc} (${fxc(gx.volume_l, 0)} L in the group)${gx.description ? ' · ' + gx.description : ''} — ${r.kind} · ${fxc(r.capacity_l || 0, 0)} L`, `/batch/${gx.batch_id}`, { wine: gx.batch, vhref: `/vessel/${r.id}` });
      else if (x) add(1, vs, 0, 'Vessel', r.id, r.code, `${fxc(x.volume_l, 0)} L${x.description ? ' · ' + x.description : ''} — ${size}`, `/batch/${x.batch_id}`, { wine: x.batch, vhref: `/vessel/${r.id}` });
      else add(5, vs, 0, 'Vessel', r.id, r.code, `empty — ${size}`, `/vessel/${r.id}`);
    }
  }
  // the bottled stock of matching cellar wines (Vintrace named some products differently, e.g. 25DB bottled as 2025DB)
  for (const r of activeHits.slice(0, 5))
    for (const x of bottled_from(c, r.id)) add(x.inactive ? 5 : 2, (x.onhand > 0 ? 0 : 10) + score(x.code), -x.onhand, 'Stock', x.id, x.code, [`bottled from ${r.code}`, pack_size(x.l), `${num(x.onhand)} on hand`, x.inactive ? 'retired' : ''].filter(v => v).join(' · '), `/item/${x.id}`);
  // stock items: bottled & canned products, then materials
  for (const r of c.all(`SELECT s.id, s.code, s.name, s.description, s.category, s.inactive, s.is_finished,
                           (SELECT COALESCE(SUM(quantity),0) FROM stock_event e WHERE e.item_id=s.id) oh
                         FROM stock_item s WHERE REPLACE(s.code,' ','') LIKE ? ESCAPE '\\' OR REPLACE(s.code,' ','') LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\'
`, like_nc, like_yr, like_c, like_c)) {
    const fin = r.is_finished || r.category === 'Bottled-Canned Wine';
    const tier = r.inactive ? 5 : fin ? 2 : 3;
    add(tier, (r.oh > 0 ? 0 : 10) + score(r.code), -r.oh, 'Stock', r.id, r.code, [r.name && r.name !== r.code ? r.name : '', r.description || '', r.category || '', `${num(r.oh, r.oh % 1 ? 1 : 0)} on hand`, r.inactive ? 'retired' : ''].filter(x => x).join(' · '), `/item/${r.id}`);
  }
  try {   // formulations
    for (const r of c.all("SELECT id, name, wine, year, is_master, retired_at FROM formula WHERE deleted=0 AND (name LIKE ? ESCAPE '\\' OR wine LIKE ? ESCAPE '\\' OR family LIKE ? ESCAPE '\\')", like_c, like_c, like_c))
      add(5, score(r.name), (r.is_master ? 0 : 100000) - (r.year || 0), 'Formula', r.id, r.name, [r.wine || '', String(r.year || '')].filter(x => x).join(' · ') + (r.is_master ? (r.retired_at ? ' · earlier master' : ' · ★ master') : ' · formulation'), `/formula/${r.id}`);
  } catch (e) { /* no formula table */ }
  if (/^\d+$/.test(q)) {
    for (const r of c.all('SELECT id, bol, dispatch_type, substr(occurred_at,1,10) d FROM dispatch WHERE bol=? OR bol LIKE ?', q, q + '%'))
      add(5, r.bol === q ? 0 : 1, 0, 'BOL', r.id, `BOL ${r.bol}`, `${r.dispatch_type} · ${r.d}`, `/dispatch/${r.id}`);
  }
  cands.sort((a, b) => a.tier - b.tier || a.sc - b.sc || a.order - b.order || String(a.it.label).localeCompare(String(b.it.label), 'en', { numeric: true }));
  return cands.slice(0, limit).map(x => x.it);
}

export function results_page(c, q, typ = '') {
  const rows = search(c, q, 300);
  const kinds = ['Batch', 'Vessel', 'Formula', 'Stock', 'BOL'].filter(k => rows.some(r => r.type === k));
  const shown = rows.filter(r => !typ || r.type === typ);
  let sel = kinds.map(k => `<option value="${k}" ${k === typ ? 'selected' : ''}>${k} (${rows.filter(r => r.type === k).length})</option>`).join('');
  sel += `<option value="Note" ${typ === 'Note' ? 'selected' : ''}>Notes (text)</option>`;
  const f = `<form class="f"><label>Search<input name="q" value="${E(q)}" autofocus></label><label>Search type<select name="type" onchange="this.form.submit()">` +
    `<option value="">All (${rows.length})</option>${sel}</select></label><button>Search</button></form>`;
  if (typ === 'Note') return `<h1>Search results for “${E(q)}”</h1>${f}`;
  if (!shown.length) return `<h1>Search results for “${E(q)}”</h1>${f}<p class="muted">No batch, vessel, stock or BOL code matches “${E(q)}”.</p>`;
  const tr = shown.map((r, k) => `${r.grp && (k === 0 || shown[k - 1].grp !== r.grp) ? `<tr class="qgh"><td colspan="3">${E(r.grp)}</td></tr>` : ''}<tr><td style="width:34px"><span class="bdg" style="background:${r.bg};color:${r.fg};width:28px;height:22px;line-height:22px;font-size:10.5px" title="${E(r.bev || r.type)}">${E(r.l)}</span></td>` +
    `<td><a href="${E(r.href)}"><b>${E(r.label)}</b>${r.wine ? ` <span class="qwn">${E(r.wine)}</span>` : ''}</a><small>${E(r.sub)}${r.vhref ? ` · <a href="${E(r.vhref)}">tank page</a>` : ''}</small></td><td class="muted">${E(r.type)}</td></tr>`).join('');
  return `<h1>Search results for “${E(q)}”</h1>${f}<p class="sub">${shown.length} shown</p><style>.qwn{color:#58a6ff;font-weight:600}.qgh td{padding-top:14px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#d29922;border-bottom:1px solid #30363d}</style><table><tbody>${tr}</tbody></table>`;
}

export function api(c, q) {
  return JSON.stringify(search(c, q, 25));
}
