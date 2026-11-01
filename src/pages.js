// Port of the page functions of app.py (p_dashboard … p_reports). Each returns the full page HTML, or null where Python returned None.
import { tip as HELP } from './help.js';
import * as extras from './extras.js';
// q is a parse_qs-style object of arrays. Server, routing, login, backup and startup are ported elsewhere.
import { E, num, fx, fxc, pyStr, qv, urlencode, today, thisYear, addDays, strftime } from './lib/py.js';
import { page, table, link, opts, line_chart, latest_snap, years, bdg, status_tag, latest_labs, labcell, snap_near, TABS, LAB_CARDS, SHORT, GAL, bottled_from, pack_size } from './core.js';
import * as hw_ui from './hw_ui.js';
import * as notes from './notes.js';
import * as reports from './reports.js';
import { history_html } from './correct.js';
import { batch_menu } from './opmenu.js';
import { daily_box } from './daily.js';
import { batch_target, batch_plan, state as pstate } from './target.js';
import { lab_tab } from './labchart.js';
import * as stage from './stage.js';
import * as CC from './cellarcard.js';
import * as VU from './vessel_ui.js';
import * as S2 from './so2.js';
import { current_contents as entry_contents } from './entry.js';
import { ctx } from './core.js';

// ---------------------------------------------------------------- small Python-compat helpers
const S = pyStr;   // f'{x}' for ints / strings / None
// str.strip() with no argument (Python's whitespace set)
const WS = '\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0                　';
function strip(s) {
  let a = 0, b = s.length;
  while (a < b && WS.includes(s[a])) a++;
  while (b > a && WS.includes(s[b - 1])) b--;
  return s.slice(a, b);
}
// s[:n] and len(s) by code point
const cpHead = (s, n) => Array.from(s).slice(0, n).join('');
const cpLen = s => Array.from(s).length;
// x.rstrip('0').rstrip('.')
const trimZeros = s => s.replace(/0+$/, '').replace(/\.+$/, '');
// int(s) as Python parses a query value (ValueError otherwise)
function pyInt(s) {
  const t = strip(String(s));
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) throw new Error(`ValueError: invalid literal for int() with base 10: '${s}'`);
  return parseInt(t.replace(/_/g, ''), 10);
}
// Python string ordering (code points)
function cmpStr(a, b) {
  if (a === b) return 0;
  const A = Array.from(a), B = Array.from(b);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i].codePointAt(0), y = B[i].codePointAt(0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return A.length - B.length;
}
// tuple comparison for sort keys made of numbers / strings / booleans
function cmpKey(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (typeof x === 'string' && typeof y === 'string') return cmpStr(x, y);
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
}
const pyRepr = v => (v === null || v === undefined ? 'None' : typeof v === 'string' ? (v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`) : String(v));
const sum = arr => arr.reduce((s, v) => s + v, 0);
const truthyDict = d => !!d && Object.keys(d).length > 0;

export function p_dashboard(c, q) {
  const sd = latest_snap(c);
  const rows = c.all(`SELECT v.id vid, v.code, v.kind, v.capacity_l, s.volume_l, s.tax_state, s.tax_class, b.id bid, b.code bcode, b.description
                        FROM bulk_snapshot s JOIN vessel v ON v.id=s.vessel_id LEFT JOIN batch b ON b.id=s.batch_id WHERE s.snap_date=? ORDER BY b.code, v.code`, sd);
  const bonded = sum(rows.filter(r => r.tax_state === 'BONDED').map(r => r.volume_l));
  const ferm = sum(rows.filter(r => r.tax_state !== 'BONDED').map(r => r.volume_l));
  const ly = snap_near(c, addDays(sd, -365));
  const ly_l = ly ? (c.val('SELECT SUM(volume_l) FROM bulk_snapshot WHERE snap_date=?', ly) || 0) : 0;
  const tot = bonded + ferm;
  const td = today();
  const soh = reports.stock_on_hand(c, td);
  const fin_units = sum(soh.filter(r => r.category === 'Bottled-Canned Wine').map(r => r.q));
  const fin_gal = sum(soh.filter(r => r.category === 'Bottled-Canned Wine').map(r => r.q * (r.litres_per_unit || 0))) / GAL;
  const y = String(thisYear());
  const disp = c.val(`SELECT SUM(dl.quantity) FROM dispatch d JOIN dispatch_line dl ON dl.dispatch_id=d.id JOIN stock_item si ON si.id=dl.item_id
                        WHERE d.reversed=0 AND si.is_finished=1 AND substr(d.occurred_at,1,4)=?`, y) || 0;
  const batches_in = new Set(rows.filter(r => r.bid).map(r => r.bid)).size;
  const vessels_in = new Set(rows.filter(r => !['virtual', 'barrel_group'].includes(r.kind)).map(r => r.vid)).size;
  const empty = c.val(`SELECT COUNT(*) FROM vessel v WHERE v.kind IN ('tank','barrel','keg','tote') AND v.active=1 AND NOT EXISTS
                         (SELECT 1 FROM bulk_snapshot s WHERE s.vessel_id=v.id AND s.snap_date=?)`, sd);
  const week = addDays(today(), -7);
  const ops7 = c.val('SELECT COUNT(*) FROM operation WHERE occurred_at>=? AND reversed=0', week);
  const delta = ly ? `<span class="${tot >= ly_l ? 'up' : 'dn'}">${tot >= ly_l ? '▲' : '▼'} ${num(Math.abs(tot - ly_l) / GAL)} gal</span> vs ${E(ly)}` : '';
  const cards = `<div class="cards">
    <div class="card"><div class="k">Volume of wine</div><div class="v">${num(tot / GAL)} gal</div><div class="k">${num(tot)} L · last year ${num(ly_l / GAL)} gal</div><div class="k">${delta}</div></div>
    <div class="card"><div class="k">Declared (Section A)</div><div class="v">${num(bonded / GAL)} gal</div><div class="k">${num(bonded)} L</div></div>
    <div class="card"><div class="k">In fermenters / undeclared</div><div class="v">${num(ferm / GAL)} gal</div><div class="k">${num(ferm)} L</div></div>
    <div class="card"><div class="k">Finished goods on hand</div><div class="v">${num(fin_units)}</div><div class="k">units · ${num(fin_gal)} gal</div></div>
    <div class="card"><div class="k">Dispatched ${y}</div><div class="v">${num(disp)}</div><div class="k">finished units, non-reversed BOLs</div></div></div>`;
  const shortcuts = `<h2>My searches</h2><div class="cards sc">
    <a class="card" href="/batches?in=1"><div class="v">${batches_in}</div><div class="k">Batches in cellar</div></a>
    <a class="card" href="/vessels?st=inuse&amp;kind=all"><div class="v">${vessels_in}</div><div class="k">Vessels in use</div></a>
    <a class="card" href="/vessels?st=empty&amp;kind=all"><div class="v">${S(empty)}</div><div class="k">Empty vessels</div></a>
    <a class="card" href="/ops?year=${y}"><div class="v">${S(ops7)}</div><div class="k">Operations, last 7 days</div></a></div>`;
  const vt = table(['', 'Batch', 'Vessel', 'Gal', 'Fill', 'Status'],
    rows.map(r => [r.bid ? bdg(c, r.bid) : '', (r.bid ? `<a href="/batch/${S(r.bid)}"><b>${E(r.bcode)}</b></a><small>${E(r.description)}</small>` : ''),
      link(`/vessel/${S(r.vid)}`, r.code), num(r.volume_l / GAL), r.capacity_l ? `${fx(100 * r.volume_l / r.capacity_l, 0)}%` : '',
      status_tag(r.tax_state, r.tax_class)]), [3, 4]);
  const recent = c.all(`SELECT o.id, o.occurred_at, o.op_type, o.treatment, o.operator, GROUP_CONCAT(DISTINCT b.code) batches FROM operation o
                          LEFT JOIN op_vessel ov ON ov.op_id=o.id LEFT JOIN batch b ON b.id=ov.batch_id GROUP BY o.id ORDER BY o.occurred_at DESC LIMIT 20`);
  const rt = table(['Operation', 'Batches', 'When'], recent.map(r => [link(`/op/${S(r.id)}`, r.op_type + (r.treatment ? ` · ${r.treatment}` : '')) + `<small>${E(r.operator)}</small>`,
    E((r.batches || '').replaceAll(',', ', ')), `${E(hw_ui.ago(r.occurred_at))}<small>${E(r.occurred_at.slice(0, 16))}</small>`]));
  const rn = notes.recent(c, 12);
  const nt = rn.length ? table(['Recorded', 'Batch', 'Equipment', 'Note'], rn.map(n => [`${E(n.noted_at.slice(0, 10))}<small>${E(hw_ui.ago(n.noted_at))}</small>`, n.batch_id ? link(`/batch/${S(n.batch_id)}?tab=notes`, n.bcode) : '',
    E(n.container), E(cpHead(strip(n.detail || ''), 220)) + (cpLen(strip(n.detail || '')) > 220 ? '…' : '')])) : '';
  return page('Dashboard', `<h1>Dashboard</h1><p class="sub">Bulk as of ${E(sd)} · history imported from Vintrace</p>${cards}${shortcuts}<div class="grid2"><div><h2>Vessels in use</h2>${vt}</div><div><h2>Recent activity <a href="/record" style="font-size:13px;font-weight:400">my entries — correct or reverse ›</a></h2>${rt}</div></div>` + (rn.length ? `<h2>Batch notes</h2>${nt}` : ''), '/', [['Dashboard', null]]);
}

export function p_batches(c, q) {
  const text = qv(q, 'q', ''), yr = qv(q, 'year', S(thisYear())), typ = qv(q, 'type', '');   // lands on this year, every wine type
  const inc = qv(q, 'in', '1');   // v1.17: lands on In cellar + this year, latest activity first
  const sd = latest_snap(c);
  const bev = hw_ui.bev_map(c);
  let sql = `SELECT b.*, (SELECT SUM(volume_l) FROM bulk_snapshot s WHERE s.batch_id=b.id AND s.snap_date=?) cur_l,
             (SELECT COUNT(*) FROM bulk_snapshot s WHERE s.batch_id=b.id AND s.snap_date=?) nves,
             (SELECT MAX(o.occurred_at) FROM operation o WHERE o.reversed=0 AND o.id IN (SELECT op_id FROM op_vessel WHERE batch_id=b.id
                UNION SELECT op_id FROM op_analysis WHERE batch_id=b.id UNION SELECT op_id FROM op_addition WHERE batch_id=b.id
                UNION SELECT op_id FROM op_loss WHERE batch_id=b.id)) last_op
             FROM batch b WHERE 1=1`;
  let args = [sd, sd];
  if (yr && yr !== 'all') { sql += ' AND (b.production_year=? OR b.vintage=?)'; args.push(yr, yr); }
  if (text) { sql += ' AND (b.code LIKE ? OR b.description LIKE ? OR b.variety LIKE ?)'; args.push(`%${text}%`, `%${text}%`, `%${text}%`); }
  sql += ' ORDER BY last_op IS NULL, last_op DESC, b.production_year DESC, b.code';   // most recent work (readings, additions, moves, losses) first
  const rows = c.all(sql, ...args).filter(r => (inc !== '1' || (r.cur_l || 0) > 0) && (!typ || bev.get(r.id) === typ));
  const keep = { q: text, year: yr, in: inc, type: typ };
  const ys = c.col('SELECT DISTINCT production_year FROM batch WHERE production_year IS NOT NULL ORDER BY 1 DESC LIMIT 7').map(v => S(v));
  const types = [...new Set([...bev.values()].filter(v => v))].sort(cmpStr);
  const f = `<div style="display:flex;flex-wrap:wrap;align-items:flex-start">${hw_ui.chips([['1', 'In cellar'], ['0', 'All batches']], inc, 'in', '/batches', keep)}
      ${hw_ui.chips([...ys.map(y => [y, y]), ['all', 'Any year']], yr, 'year', '/batches', keep)}</div>
      <form class="f"><input type="hidden" name="in" value="${E(inc)}"><input type="hidden" name="year" value="${E(yr)}"><label>Code / description<input name="q" value="${E(text)}"></label>
      <label>Wine type<select name="type" onchange="this.form.submit()"><option value="">all</option>${types.map(t => `<option ${t === typ ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></label><button>Filter</button></form>`;
  const tl = sum(rows.map(r => r.cur_l || 0));
  const SM = stage.current_map(c);
  const t = table(['', 'Batch', 'Stage', 'Year', 'Variety', 'Type', 'Gal', 'Litres', 'Vessels', 'Last operation'],
    rows.map(r => [hw_ui.badge(bev.get(r.id)), `<a href="/batch/${S(r.id)}"><b>${E(r.code)}</b></a><small>${E(r.description)}</small>`, SM.has(r.id) ? stage.pill(SM.get(r.id).stage) : '', E(r.production_year), E(r.variety),
      E(bev.get(r.id) || ''), r.cur_l ? num((r.cur_l || 0) / GAL) : '', num(r.cur_l), r.nves || '',
      r.last_op ? `${E(hw_ui.ago(r.last_op))}<small>${E((r.last_op || '').slice(0, 10))}</small>` : '']), [6, 7, 8]);
  return page('Batches', `<h1>Batches <a class="btn" href="/formulas?start=1" style="font-size:14px;vertical-align:middle;margin-left:10px">＋ New batch (from a formulation)</a></h1><p class="sub">${rows.length} batches · ${num(tl / GAL)} gal (${num(tl)} L) in cellar as of ${E(sd)}</p>${f}${stage.CSS}${t}`, '/batches');
}

const LABEL = { 'TempC': 'Temp °C', 'Titratable Acidity': 'TA' };
const lbl = m => (Object.prototype.hasOwnProperty.call(LABEL, m) ? LABEL[m] : m);

// v1.20: the formulation as a checklist in a right-hand column of the batch page (every tab) — target, fruit (by fruit when the
// formulation has a fruit mix), water, sugar/honey additions, start additions and the two nutrient additions, each against
// what is recorded on the batch, with a green check at 100%. It is worked out afresh from the records on every page view.
function target_card(P, tot, bid) {
  const T = P.T;
  const fmtv = (v, u) => (v === null || v === undefined ? '—' : num(v, (u === 'g' || u === 'ml') ? (Math.abs(v) < 10 ? 1 : 0) : 1));
  // v1.36: L and lb shown with gal and kg as well (Ken works in both)
  const ALT = { L: [1 / GAL, 'gal'], lb: [0.45359237, 'kg'] };
  const other = (v, u) => (ALT[u] && v !== null && v !== undefined ? `${num(v * ALT[u][0], 1)} ${ALT[u][1]}` : '');
  const both = (v, u) => `${fmtv(v, u)} ${u}${ALT[u] ? ` <span class="talt2">(${other(v, u)})</span>` : ''}`;
  const bar = (v, of) => { const p = of > 0 ? Math.max(0, Math.min(100, 100 * v / of)) : 0; return `<span class="tbar"><i style="width:${p.toFixed(0)}%"></i></span>`; };
  const mark = { done: '<span class="tok" title="done">✓</span>', part: '<span class="tpart" title="part done">◐</span>', none: '<span class="tnone" title="not yet">○</span>', info: '<span class="tnone">·</span>' };
  const day = t => { const d = String(t || '').slice(0, 10); const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return d ? `${M[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}` : ''; };
  const short = T.target_l - tot;
  let ndone = 0, nall = 0;
  const secs = P.sections.map(([title, rows]) => {
    const tr = rows.map(p => {
      const st = pstate(p);
      if (p.plan > 0 && !p.sub) { nall++; if (st === 'done') ndone++; }
      const ev = p.events && p.events.length > (p.split ? 0 : 1) ? `<div class="tev">${p.events.map((e, k) => `${p.split ? `<b>${k + 1}</b> ` : ''}${day(e[0])} · ${both(e[1], e[2])}`).join(' <span>|</span> ')}` +
        (p.split && p.plan > 0 && p.done < p.plan * 0.98 ? ` <em>${both(p.plan - p.done, p.unit)} to go</em>` : '') + '</div>' :
        (p.split && p.plan > 0 && !p.done ? '<div class="tev"><em>usually 2–3 additions</em></div>' : '');
      return `<div class="trow ${st}${p.sub ? ' sub' : ''}${p.strong ? ' strong' : ''}"><span class="tl">${p.label}</span>${p.plan > 0 ? bar(p.done, p.plan) : '<span></span>'}` +
        `<b>${fmtv(p.done, p.unit)}${p.plan > 0 ? ` / ${fmtv(p.plan, p.unit)}` : ''} <small>${p.unit}</small>${ALT[p.unit] ? `<i class="talt">${num(p.done * ALT[p.unit][0], 1)}${p.plan > 0 ? ` / ${num(p.plan * ALT[p.unit][0], 1)}` : ''} ${ALT[p.unit][1]}</i>` : ''}</b>${p.sub && !(p.plan > 0) ? '<span></span>' : mark[st]}</div>${ev}`;
    }).join('');
    return `<div class="tsec"><div class="tsh">${title}</div>${tr}</div>`;
  }).join('');
  return `<div class="tcard"><div class="tlab">Formulation target${HELP('formulation')} <span>${ndone} of ${nall} done</span></div>
    <div class="tbig">${num(T.target_l)} <small>L</small> <span>${num(T.target_l / GAL, 1)} gal</span></div>
    <div class="trow strong ${tot >= T.target_l * 0.98 ? 'done' : 'part'}"><span class="tl">In vessel${tot > 0 ? '' : ''}</span>${bar(tot, T.target_l)}<b>${num(tot, 1)} <small>L</small><i class="talt">${num(tot / GAL, 1)} gal</i></b>${tot >= T.target_l * 0.98 ? mark.done : mark.part}</div>
    ${short > 0.5 ? `<div class="tshort">${num(short, 1)} L (${num(short / GAL, 1)} gal) to go</div>` : ''}
    ${secs}
    <div class="tlinks"><a href="/formula/${S(T.fid)}">Formulation ${E(T.name)}</a>${P.mix.length ? '' : ' · <a href="/formula/' + S(T.fid) + '#mix">add a fruit mix</a>'} · <a href="/additions?batch=${S(bid)}">Additions on ${num(T.target_l)} L (${num(T.target_l / GAL, 1)} gal)${P.cider ? ' (cider)' : ''}</a></div></div>`;
}

const TSTYLE = `<style>.bgrid{display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:22px;align-items:start}.bmain{min-width:0}
.bside{position:sticky;top:10px;max-height:calc(100vh - 20px);overflow:auto}
@media (max-width:1150px){.bgrid{grid-template-columns:minmax(0,1fr)}.bside{position:static;max-height:none;order:-1}}
.tcard{background:rgba(57,197,207,.08);border:1px solid rgba(57,197,207,.45);border-left:5px solid #39c5cf;border-radius:10px;padding:10px 14px}
.tcard .tlab{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#39c5cf;font-weight:700;display:flex;justify-content:space-between}.tcard .tlab span{color:var(--mut);letter-spacing:0;text-transform:none;font-weight:600}
.tcard .tbig{font-size:30px;font-weight:700;color:var(--fg2);line-height:1.15;margin:2px 0 6px}.tcard .tbig small{font-size:16px;font-weight:600}.tcard .tbig span{font-size:14px;font-weight:400;color:var(--mut);margin-left:6px}
.tcard .tsec{margin-top:9px;padding-top:7px;border-top:1px solid rgba(57,197,207,.22)}.tcard .tsh{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);font-weight:700;margin-bottom:3px}
.tcard .trow{display:grid;grid-template-columns:118px 1fr auto 16px;gap:7px;align-items:center;font-size:13px;margin:3px 0}.tcard .trow .tl{color:var(--fg);line-height:1.2}.tcard .trow .tl small{display:block;color:var(--mut);font-size:11px}
.tcard .trow.sub .tl{padding-left:10px;color:var(--mut)}.tcard .trow.strong .tl{font-weight:600;color:var(--fg2)}.tcard .trow b{color:var(--fg2);font-weight:600;white-space:nowrap;text-align:right}.tcard .trow b .talt{display:block;font-style:normal;font-weight:400;font-size:11px;color:var(--mut);line-height:1.15}.tcard .talt2{color:var(--faint)}.tcard .trow b small{color:var(--mut);font-weight:400}
.tcard .tbar{display:block;height:7px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}.tcard .tbar i{display:block;height:100%;background:#39c5cf;border-radius:4px}.tcard .trow.done .tbar i{background:#3fb950}
.tcard .tok{color:#3fb950;font-weight:800;font-size:15px}.tcard .tpart{color:#d29922}.tcard .tnone{color:var(--faint)}
.tcard .tev{font-size:11.5px;color:var(--mut);margin:-1px 0 4px 125px;line-height:1.35}.tcard .tev b{color:#39c5cf}.tcard .tev span{color:var(--faint)}.tcard .tev em{color:#f0b84a;font-style:normal;white-space:nowrap}
.tcard .tshort{font-size:12.5px;color:#f0b84a;margin:-1px 0 2px 125px}.tcard .tlinks{font-size:12.5px;margin-top:9px;padding-top:7px;border-top:1px solid rgba(57,197,207,.25)}
.whead{flex-wrap:wrap}.whead .om-btn{white-space:nowrap}.whead .wloc .we{white-space:nowrap}.whead .wloc{margin-left:4px;font-size:17px;vertical-align:middle;color:var(--fg2);white-space:normal}.whead .wloc a{font-weight:700}.whead .wloc small{color:var(--mut);font-size:13px}.whead .wloc i{font-style:normal;color:var(--mut);margin:0 8px}.whead .wloc .wadj{font-size:14px;text-decoration:none;opacity:.75;margin-left:2px}.whead .wloc .wadj:hover{opacity:1}.whead .wloc.none{color:var(--mut);font-size:14px}
.whead .ren{margin-left:8px;font-size:18px;text-decoration:none;opacity:.7}.whead .ren:hover{opacity:1}</style>`;

// v1.70: where the wine is now, beside ＋ Record (largest first; a barrel group shows as one entry)
function in_where(c, now, bid) {
  const g = CC.grouped(c, now).filter(e => (e.volume_l || 0) > 0.05).sort((a, b) => (b.volume_l || 0) - (a.volume_l || 0));
  if (!g.length) return '<span class="wloc none">not in a tank or barrel now</span>';
  const parts = g.map(e => `<span class="we"><a href="/vessel/${S(e.id)}">${E(e.code)}</a> <small>${num(e.volume_l / GAL, 0)} gal / ${num(e.volume_l, 0)} L${e.group && e.members && e.members.length ? ` · ${e.members.length} barrels` : ''}</small> <a class="wadj" title="Adjust the volume in ${E(e.code)} (racking, new dip …) with a reason" href="/record/measure?vessel_id=${e.group && !e.legacy ? 'g' + S(e.id) : S(e.id)}${bid ? `&_next=/batch/${S(bid)}` : ''}">⚖</a></span>`);
  return `<span class="wloc" title="Where this wine is now">📍 in ${parts.slice(0, 4).join('<i>·</i>')}${parts.length > 4 ? ` <small>+${parts.length - 4} more</small>` : ''}</span>`;
}

export function p_batch(c, bid, q) {
  const b = c.one('SELECT * FROM batch WHERE id=?', bid);
  if (!b) return null;
  const tab = qv(q, 'tab', 'general');
  const sd = latest_snap(c);
  const now = c.all(`SELECT v.id, v.code, v.kind, v.capacity_l, s.volume_l, s.tax_state, s.tax_class, s.product_state FROM bulk_snapshot s JOIN vessel v ON v.id=s.vessel_id
                       WHERE s.batch_id=? AND s.snap_date=? ORDER BY v.code`, bid, sd);
  const tot = sum(now.map(r => r.volume_l));
  const bev = hw_ui.bev_map(c).get(bid);
  const stMap = new Map();
  for (const r of now) stMap.set(JSON.stringify([r.tax_state, r.tax_class]), [r.tax_state, r.tax_class]);
  const states = [...stMap.values()].sort((a, b) => cmpStr(`(${pyRepr(a[0])}, ${pyRepr(a[1])})`, `(${pyRepr(b[0])}, ${pyRepr(b[1])})`));
  const pills = states.map(([st, cl]) => `<span class="pill">${st === 'BONDED' ? 'Declared · class ' + E(cl) : 'In fermenter (undeclared)'}</span> `).join('');
  const PL = batch_plan(c, bid);
  const tcard = PL ? target_card(PL, tot, bid) : '';
  const head = `<div class="bhead"><div class="bleft"><div class="whead">${hw_ui.badge(bev, true)}<span class="code">${E(b.code)}</span><a class="ren" href="/batch/${bid}/rename" title="Edit the batch name and description">✎</a>${batch_menu(bid, b.code, now.filter(r => r.kind !== 'barrel_group'), VU.wine_groups(c, entry_contents(c)).filter(g => now.some(r => g.ids.includes(r.id))))}${in_where(c, now, bid)}</div>${stage.bar(c, bid, ctx.token)}
      <div class="wsub"><span class="vv">${num(tot / GAL)} <small>gal</small></span><span class="vv">${num(tot)} <small>L</small></span>
      <span class="muted">${E(CC.where_text(c, now))}</span>${pills}</div>
      <div class="wdesc">${E(b.description || '')} · <a href="/costs?batch=${encodeURIComponent(b.code)}">costs</a> · <a href="/batch/${bid}/rename">edit name</a> · <a href="/analytics?w=${encodeURIComponent(String(b.code).replace(/^\d+/, '').replace(/[^A-Za-z]/g, '').toUpperCase())}">compare vintages</a>${(() => { const al = c.col('SELECT code FROM batch_alias WHERE batch_id=? ORDER BY id DESC', bid); return al.length ? ` · <span class="muted">formerly ${al.map(E).join(', ')}</span>` : ''; })()}</div>${(() => { const bt = bottled_from(c, bid); return bt.length ? `<div class="wdesc">Bottled stock: ${bt.map(r => `<a href="/item/${r.id}"><b>${E(r.code)}</b></a> ${E(pack_size(r.l))} — ${num(r.onhand)} on hand${r.inactive ? ' (retired)' : ''} <span class="muted">· ${num(r.packed)} packaged ${r.runs > 1 ? `${E(r.first)} to ${E(r.last)}` : E(r.first)}</span>`).join(' · ')}</div>` : ''; })()}${q.renamed ? '<div class="ok">Renamed.</div>' : ''}${q.saved ? `<div class="ok">Saved${q.op ? ` — <a href="/op/${E(q.op[0])}">view the operation</a>` : ''}.</div>` : ''}</div></div>`;
  const ops = c.all(`SELECT o.id, o.occurred_at, o.op_type, o.treatment, o.operator, o.reversed FROM operation o WHERE o.id IN
                       (SELECT op_id FROM op_vessel WHERE batch_id=? OR batch_after_id=? UNION SELECT op_id FROM op_addition WHERE batch_id=? UNION SELECT op_id FROM op_analysis WHERE batch_id=?)
                       ORDER BY o.occurred_at DESC`, bid, bid, bid, bid);
  const base = `/batch/${S(bid)}`;
  const nts = notes.for_batch(c, bid);
  let body = head + hw_ui.tabs(TABS.map(([k, t]) => [k, t + (k === 'history' ? ` (${ops.length})` : (k === 'notes' && nts.length ? ` (${nts.length})` : ''))]), tab, base);

  if (tab === 'general') {
    const fermenting = (stage.current(c, bid) || {}).stage === 'fermenting';   // v1.65: while fermenting the chart sits under the reading inputs, not at the bottom
    const dbx = fermenting ? daily_box(c, bid, ctx.token) : '';   // v1.21.1: only while fermenting
    if (fermenting) body += dbx;
    else if (now.length) body += S2.CSS + S2.table(c, bid);   // v1.30 SO₂ status per vessel
    const cards = [];
    for (const m of LAB_CARDS) {
      const r = hw_ui.latest_metric(c, bid, m);
      if (r && r.value !== null && r.value !== undefined) {
        const label = lbl(m);
        cards.push(`<div class="card lab"><div class="k">${E(label)}</div><div class="v">${m !== 'SG' ? num(r.value, ['pH', 'SG'].includes(m) ? 2 : 1) : fx(r.value, 3)}</div><div class="a">${E(hw_ui.ago(r.occurred_at))}</div></div>`);
      }
    }
    body += '<h2>Latest labs</h2>' + (cards.length ? `<div class="cards">${cards.slice(0, 6).join('')}</div>` : '<p class="muted">No lab readings.</p>');
    const first = ops.length ? ops[ops.length - 1].occurred_at.slice(0, 10) : '';
    const last = ops.length ? ops[0].occurred_at.slice(0, 10) : '';
    const det = [['Batch code', b.code], ['Description', b.description], ['Wine type', bev], ['Production year', b.production_year], ['Vintage', b.vintage],
      ['Variety', b.variety], ['Region', b.region], ['Base ingredient', b.base_ingredient], ['First operation', first], ['Last operation', last],
      ['Status', b.inactive ? 'inactive' : 'active']];
    if (nts.length) {
      const d0 = strip(nts[0].detail || '');
      det.push(['Recent note', cpHead(d0, 160) + (cpLen(d0) > 160 ? '…' : '')]);
    }
    let lf;
    try {
      lf = c.all('SELECT id, name, year FROM formula WHERE batch_id=? AND deleted=0 ORDER BY year DESC', bid);
    } catch (e) {
      lf = [];
    }
    body += ('<div class="bar" style="margin:6px 0 4px">' + lf.map(x => `<a class="btn btn2" href="/formula/${S(x.id)}">Formulation: ${E(x.name)}</a>`).join('')
      + `<a class="btn btn2" href="/additions?batch=${S(bid)}">Additions for this batch</a></div>`);
    body += '<h2>Details</h2><div class="details">' + det.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<div><b>${E(v)}</b><span>${E(k)}</span></div>`).join('') + '</div>';
    const vt = table(['Vessel', 'Kind', 'Gal', 'Litres', 'Capacity (L)', 'Fill', 'Status', ''],
      now.map(r => [link(`/vessel/${S(r.id)}`, r.code), E(r.kind), num(r.volume_l / GAL, 1), num(r.volume_l), num(r.capacity_l),
        r.capacity_l ? `${fx(100 * r.volume_l / r.capacity_l, 0)}%` : '', status_tag(r.tax_state, r.tax_class),
        `<a class="btn btn2 adj" title="Adjust the volume in ${E(r.code)} (loss or gain, with a reason)" href="/record/measure?vessel_id=${S(r.id)}&_next=/batch/${S(bid)}">⚖ Adjust volume</a>`]), [2, 3, 4, 5]);
    if (now.length) body += `<h2>Batch total: ${num(tot)} L (${num(tot / GAL, 1)} gal) ${E(CC.where_text(c, now))}</h2>${vt}`;
    if (b.notes) body += `<h2>Notes</h2><div class="note">${E(b.notes)}</div>`;
    const series = new Map();
    for (const r of c.all(`SELECT o.occurred_at, a.metric, a.value FROM op_analysis a JOIN operation o ON o.id=a.op_id WHERE a.batch_id=? AND a.metric IN ('Brix','TempC') AND o.reversed=0
                              ORDER BY o.occurred_at`, bid)) {
      if (!series.has(r.metric)) series.set(r.metric, []);
      series.get(r.metric).push([r.occurred_at, r.value]);
    }
    if (series.size && !dbx.includes('lc-card')) body += '<h2>Fermentation — Brix and temperature</h2><div class="card">' + line_chart(Object.fromEntries(series)) + '</div>';

  } else if (tab === 'lab') {   // v1.37: charts instead of the list (labchart.js)
    body += lab_tab(c, bid);

  } else if (tab === 'adds') {
    const matsum = c.all(`SELECT m.id, m.name, m.kind, m.base_unit, SUM(a.amount_base) s, COUNT(*) n FROM op_addition a JOIN material m ON m.id=a.material_id JOIN operation o ON o.id=a.op_id
                              WHERE a.batch_id=? AND o.reversed=0 GROUP BY m.id ORDER BY m.kind, m.name`, bid);
    body += '<h2>Totals</h2>' + table(['Material', 'Kind', 'Total', 'Unit', 'Additions'], matsum.map(r => [link(`/material/${S(r.id)}`, r.name), E(r.kind), num(r.s, 2), E(r.base_unit), S(r.n)]), [2, 4]);
    const rows = c.all(`SELECT o.id, o.occurred_at, v.code vc, m.id mid, m.name, a.amount, a.unit, a.batch_volume_l FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
                            LEFT JOIN vessel v ON v.id=a.vessel_id WHERE a.batch_id=? AND o.reversed=0 ORDER BY o.occurred_at DESC`, bid);
    body += '<h2>Additions</h2>' + table(['When', 'Vessel', 'Material', 'Amount', 'Unit', 'Wine volume (L)'], rows.map(r => [link(`/op/${S(r.id)}`, r.occurred_at.slice(0, 16)), E(r.vc), link(`/material/${S(r.mid)}`, r.name),
      trimZeros(num(r.amount, 3)), E(r.unit), num(r.batch_volume_l)]), [3, 5]);

  } else if (tab === 'notes') {
    const own = nts.filter(n => n.batch_id == bid).length;
    body += (`<p class="sub" style="display:flex;gap:16px;align-items:center;margin-top:0"><a class="btn" href="/record/note?batch=${S(bid)}&amp;_next=/batch/${S(bid)}?tab=notes">+ Add note</a>`
      + `<span>${nts.length} notes · ${own} written on ${E(b.code)}, ${nts.length - own} carried in from wines blended or racked into it</span></p>`);
    body += nts.length ? '<div class="ncards">' + nts.map(n => hw_ui.note_card(n, bid)).join('') + '</div>' : '<p class="muted">No notes.</p>';

  } else if (tab === 'history') {
    const ids = ops.length ? ops.map(o => o.id) : [0];
    const ph = ids.map(() => '?').join(',');
    const ves = new Map(), det = new Map();
    const push = (m, k, v) => {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    };
    for (const r of c.all(`SELECT ov.op_id, v.code, ov.vol_before_l, ov.vol_after_l, b2.code bc FROM op_vessel ov LEFT JOIN vessel v ON v.id=ov.vessel_id LEFT JOIN batch b2 ON b2.id=ov.batch_id WHERE ov.op_id IN (${ph})`, ...ids))
      push(ves, r.op_id, `${E(r.code)}${r.bc === b.code ? '' : ' (' + E(r.bc) + ')'} ${num(r.vol_before_l)}→${num(r.vol_after_l)}`);
    for (const r of c.all(`SELECT a.op_id, m.name, a.amount, a.unit FROM op_addition a JOIN material m ON m.id=a.material_id WHERE a.op_id IN (${ph}) AND a.batch_id=?`, ...ids, bid))
      push(det, r.op_id, `${E(r.name)} ${trimZeros(num(r.amount, 2))} ${E(r.unit)}`);
    for (const r of c.all(`SELECT op_id, metric, value FROM op_analysis WHERE op_id IN (${ph}) AND batch_id=?`, ...ids, bid))
      push(det, r.op_id, `${E(r.metric)} ${trimZeros(num(r.value, 3))}`);
    for (const r of c.all(`SELECT l.op_id, l.volume_l, l.reason, l.gain FROM op_loss l WHERE l.op_id IN (${ph}) AND (l.batch_id=? OR (l.batch_id IS NULL AND EXISTS
                             (SELECT 1 FROM op_vessel ov WHERE ov.op_id=l.op_id AND ov.vessel_id=l.vessel_id AND ? IN (ov.batch_id, ov.batch_after_id))))`, ...ids, bid, bid))
      push(det, r.op_id, `${r.gain ? 'gain' : 'loss'} ${num(r.volume_l, r.volume_l < 10 ? 1 : 0)} L (${E(r.reason)})`);
    body += table(['When', 'Operation', 'Vessels (L before→after)', 'Details', 'By'],
      ops.map(o => [link(`/op/${S(o.id)}`, o.occurred_at.slice(0, 16)) + `<small>${E(hw_ui.ago(o.occurred_at))}</small>`,
        E(o.op_type + (o.treatment ? ` · ${o.treatment}` : '')) + (o.reversed ? ' <span class="tag">reversed</span>' : ''),
        (ves.get(o.id) || []).join('<br>'), (det.get(o.id) || []).join('<br>'), E(o.operator)]));

  } else if (tab === 'losses') {
    body += losses_tab(c, bid, now);
  } else if (tab === 'ttb') {
    const tev = c.all('SELECT event_date, kind, tax_class, volume_l, source FROM tax_event WHERE batch_id=? ORDER BY event_date', bid);
    body += '<p class="sub">Every TTB-relevant event for this batch (declarations, blends into bonded wine, bottling, losses).</p>' + table(
      ['Date', 'Event', 'Class', 'Litres', 'Gal', 'Source'], tev.map(r => [E(r.event_date), E(r.kind.replaceAll('_', ' ')), E(r.tax_class), num(r.volume_l), num(r.volume_l / GAL, 1), E(r.source)]), [3, 4]);
  }
  // v1.24 right-hand card: the formulation checklist while fermenting, the cellar card (vessels, SO₂, latest note) in élevage / ready
  const stg = (stage.current(c, bid) || {}).stage || '';
  const side = stg === 'fermenting' && tcard ? tcard : now.length && (stg === 'elevage' || stg === 'ready' || !tcard) ? CC.cellar_card(c, bid, now, tot, stg, nts) : tcard;
  if (side) body = `${TSTYLE}${CC.CSTYLE}<div class="bgrid"><div class="bmain">${body}</div><aside class="bside">${side}</aside></div>`;
  return page(b.code, body, '/batches', [['Batches', '/batches'], [b.code, null]]);
}

// Batch tab "Losses & gains": every volume loss or gain on this wine (Vintrace history + new adjustments), with the reason,
// and totals by reason. Same rows Vintrace's Wine production loss report listed for the batch.
function losses_tab(c, bid, now) {
  const vr = c.one("SELECT 1 x FROM sqlite_master WHERE name='vt_loss_report'");   // Vintrace's own description of each imported loss/gain
  const rows = c.all(`SELECT l.id, l.op_id, l.volume_l, l.reason, l.gain, o.occurred_at, o.op_type, o.treatment, o.reversed, o.notes, v.code vc,
      ${vr ? '(SELECT r.operation_summary FROM vt_loss_report r WHERE r.op_loss_id=l.id LIMIT 1)' : 'NULL'} vts
      FROM op_loss l JOIN operation o ON o.id=l.op_id LEFT JOIN vessel v ON v.id=l.vessel_id
      WHERE (l.batch_id=? OR (l.batch_id IS NULL AND EXISTS (SELECT 1 FROM op_vessel ov WHERE ov.op_id=l.op_id AND ov.vessel_id=l.vessel_id AND ? IN (ov.batch_id, ov.batch_after_id))))
        AND o.id NOT IN (SELECT old_op FROM op_change WHERE kind IN ('correct','replay'))
      ORDER BY o.occurred_at DESC, l.id DESC`, bid, bid);
  const live = rows.filter(r => !r.reversed);
  const by = new Map();
  for (const r of live) { const k = r.reason || '—'; const a = by.get(k) || [0, 0, 0]; a[0]++; a[r.gain ? 2 : 1] += r.volume_l; by.set(k, a); }
  const tl = live.filter(r => !r.gain).reduce((s, r) => s + r.volume_l, 0), tg = live.filter(r => r.gain).reduce((s, r) => s + r.volume_l, 0);
  const btns = now.map(r => `<a class="btn" href="/record/measure?vessel_id=${S(r.id)}&_next=/batch/${S(bid)}">⚖ Adjust ${E(r.code)} (${num(r.volume_l)} L)</a>`).join(' ');
  let out = `<p class="sub">${HELP('ttb', 'Every volume loss or gain on this wine (Vintrace history and new adjustments) with its reason, and totals by reason. Losses with a TTB reason on bonded wine feed Section A lines 23, 24 and 29.')} Every change in volume that was not a transfer: re-dips and corrections, evaporation, lees, spills, sugar additions, testing samples… each with its reason (the 14 categories used in your records).
    Use <b>⚖ Adjust volume</b> to enter a new dip; the difference is saved here as a loss or gain.</p>${btns ? `<div class="bar" style="margin:6px 0 10px">${btns}</div>` : ''}`;
  if (!rows.length) return out + '<p class="muted">No losses or gains recorded for this batch.</p>';
  out += `<h2>Totals: lost ${num(tl, 1)} L (${num(tl / GAL, 1)} gal) · gained ${num(tg, 1)} L (${num(tg / GAL, 1)} gal)</h2>`;
  out += table(['Reason', 'Times', 'Lost (L)', 'Gained (L)', 'Net (L)', 'Net (gal)'], [...by.entries()].sort((a, b) => b[1][1] + b[1][2] - a[1][1] - a[1][2])
    .map(([k, a]) => [E(k), num(a[0]), a[1] ? num(a[1], 1) : '', a[2] ? num(a[2], 1) : '', num(a[2] - a[1], 1), num((a[2] - a[1]) / GAL, 1)]), [1, 2, 3, 4, 5]);
  out += '<h2>All entries</h2><div data-nouc>' + table(['When', 'Vessel', 'Operation', 'Loss (L)', 'Gain (L)', 'Gal', 'Reason', 'Notes'], rows.map(r => [
    link(`/op/${S(r.op_id)}`, r.occurred_at.slice(0, 16)) + (r.reversed ? ' <span class="tag">reversed</span>' : ''), E(r.vc || ''), E(r.op_type + (r.treatment ? ` · ${r.treatment}` : '')),
    r.gain ? '' : num(r.volume_l, 1), r.gain ? num(r.volume_l, 1) : '', (r.gain ? '+' : '−') + num(r.volume_l / GAL, 2), E(r.reason), r.notes ? E(r.notes) : r.vts ? `<small class="muted">Vintrace: ${E(String(r.vts).replace(/\|\s*Reason:.*$/, ''))}</small>` : '']), [3, 4, 5]) + '</div>';
  return out;
}

export function p_vessels(c, q) {
  const st = qv(q, 'st', 'inuse'), kind = qv(q, 'kind', 'tank');   // default view (Ken): tanks in use, fullest first
  const sd = latest_snap(c);
  let rows = c.all(`SELECT v.*, s.volume_l, s.tax_state, s.tax_class, b.id bid, b.code bcode, b.description FROM vessel v
                        LEFT JOIN bulk_snapshot s ON s.vessel_id=v.id AND s.snap_date=? LEFT JOIN batch b ON b.id=s.batch_id
                        WHERE v.kind NOT IN ('virtual','barrel_group') OR s.volume_l IS NOT NULL ORDER BY v.kind, v.code`, sd);
  const main = { tank: 'tank', barrel: 'barrel', keg: 'keg' };
  rows = rows.filter(r => (st === 'all' || (st === 'inuse') === !!r.volume_l) && (kind === 'all' || (Object.prototype.hasOwnProperty.call(main, r.kind) ? main[r.kind] : 'other') === kind));
  rows.sort((a, b) => (b.volume_l || 0) - (a.volume_l || 0) || String(a.code).localeCompare(String(b.code)));
  const labs = latest_labs(c);
  const keep = { st, kind };
  const f = ('<div style="display:flex;flex-wrap:wrap">' + hw_ui.chips([['all', 'All'], ['inuse', 'In use'], ['empty', 'Empty']], st, 'st', '/vessels', keep)
    + hw_ui.chips([['all', 'All'], ['tank', 'Tanks'], ['barrel', 'Barrels'], ['keg', 'Kegs'], ['other', 'Other']], kind, 'kind', '/vessels', keep) + '</div>');
  const tl = sum(rows.map(r => r.volume_l || 0));
  const t = table(['', 'Vessel', 'Contents', 'Gal', 'Litres', 'Capacity (L)', 'Fill', 'Free SO2', 'pH', 'Status'],
    rows.map(r => [r.bid ? bdg(c, r.bid) : '', `<a href="/vessel/${S(r.id)}"><b>${E(r.code)}</b></a><small>${E(r.kind)}</small>`,
      (r.bid ? `<a href="/batch/${S(r.bid)}">${E(r.bcode)}</a><small>${E(r.description)}</small>` : '<span class="muted">empty</span>'),
      r.volume_l ? num((r.volume_l || 0) / GAL) : '', num(r.volume_l), num(r.capacity_l),
      r.capacity_l && r.volume_l ? `${fx(100 * r.volume_l / r.capacity_l, 0)}%` : '',
      r.bid ? labcell(labs.get(`${r.bid}|Free SO2`), 0) : '', r.bid ? labcell(labs.get(`${r.bid}|pH`), 2) : '',
      status_tag(r.tax_state, r.tax_class)]), [3, 4, 5, 6, 7, 8]);
  return page('Vessels', `<h1>Vessels</h1><p class="sub">${rows.length} vessels · ${num(tl / GAL)} gal (${num(tl)} L) · contents as of ${E(sd)} · <a href="/labels">🏷 Print vessel labels</a></p>${f}${t}`, '/vessels');
}

export function p_vessel(c, vid, q) {
  const v = c.one('SELECT * FROM vessel WHERE id=?', vid);
  if (!v) return null;
  const hist = c.all('SELECT snap_date, volume_l FROM bulk_snapshot WHERE vessel_id=? ORDER BY snap_date', vid);
  const chart = hist.length ? line_chart({ Litres: hist.map(r => [r.snap_date + 'T00:00', r.volume_l]) }, 900, 160) : '';
  const ops = c.all(`SELECT o.id, o.occurred_at, o.op_type, o.treatment, b.id bid, b.code bc, ov.vol_before_l, ov.vol_after_l FROM op_vessel ov JOIN operation o ON o.id=ov.op_id
                       LEFT JOIN batch b ON b.id=ov.batch_id WHERE ov.vessel_id=? ORDER BY o.occurred_at DESC LIMIT 500`, vid);
  const t = table(['When', 'Operation', 'Batch', 'Before', 'After'], ops.map(r => [link(`/op/${S(r.id)}`, r.occurred_at.slice(0, 16)), E(r.op_type + (r.treatment ? ` · ${r.treatment}` : '')),
    r.bid ? link(`/batch/${S(r.bid)}`, r.bc) : '', num(r.vol_before_l), num(r.vol_after_l)]), [3, 4]);
  const inUse = c.one('SELECT 1 x FROM bulk_snapshot WHERE vessel_id=? AND snap_date=? AND volume_l>0', vid, latest_snap(c));
  const adj = inUse ? ` · <a class="btn btn2" href="/record/measure?vessel_id=${S(vid)}">⚖ Adjust volume</a>` : '';
  // v1.27.1 desktop: what is in it now, its barrel group, details (year, oak, location, fixed capacity), group barrels
  const cur = entry_contents(c).find(x => x.vessel_id === vid);
  const g = v.kind === 'barrel' ? VU.group_of(c, vid) : null;
  const nowl = cur ? `<div class="ok" style="border-color:var(--line2)">Holds <a href="/batch/${S(cur.batch_id)}"><b>${E(cur.batch)}</b></a> ${E(cur.description || '')} · <b>${num(cur.volume_l)} L</b>${v.capacity_l ? ` of ${num(v.capacity_l)} L (${num(100 * cur.volume_l / v.capacity_l)}%)` : ''}</div>` : `<div class="ok" style="border-color:var(--line2)">Empty</div>`;
  const gl = g ? `<div class="ok" style="border-color:var(--acc)">In barrel group <a href="/vessel/${S(g.id)}"><b>${E(g.code)}</b></a>: ${g.members.map(m => m.id === vid ? `<b>${E(m.code)}</b>` : `<a href="/vessel/${S(m.id)}">${E(m.code)}</a>`).join(' · ')}</div>` : '';
  const grp = v.kind === 'barrel_group' ? (() => {
    const ms = VU.members(c, vid), cc = entry_contents(c);
    const rows = ms.map(m => { const x = cc.find(y => y.vessel_id === m.id); return [link(`/vessel/${S(m.id)}`, m.code), x ? link(`/batch/${S(x.batch_id)}`, x.batch) : '<span class="muted">empty</span>', num(x ? x.volume_l : 0), num(m.capacity_l)]; });
    const any = ms.some(m => cc.some(y => y.vessel_id === m.id));
    return `${VU.towine_form(c, vid, ctx.token, `/vessel/${vid}`)}<h2>Barrels</h2>${table(['Barrel', 'Batch', 'Litres', 'Capacity'], rows, [2, 3])}
${any ? `<p><a class="btn btn2" href="/record/addition?vessel_id=g${S(vid)}">🧪 Addition (split across the barrels)</a> <a class="btn btn2" href="/record/measure?vessel_id=g${S(vid)}">⚖ Adjust volume (split evenly)</a> <a class="btn btn2" href="/labels/print?ids=${ms.map(m => m.id).join(',')}" target="_blank">🏷 Barrel labels</a></p>` : ''}
${VU.group_block(c, vid, ctx.token, `/vessel/${vid}`)}`;
  })() : `<div style="max-width:560px">${VU.details(c, v, ctx.token, `/vessel/${vid}`, cur ? cur.batch : null)}</div>`;
  const msg = q && (q.saved || q.added) ? '<div class="ok">Saved.</div>' : '';
  return page(v.code, `${msg}<h1>${E(v.code)}</h1><p class="sub">${E(v.kind)} · capacity ${num(v.capacity_l)} L${adj} · <a href="/labels/print?ids=${vid}" target="_blank">🏷 Print label</a> · <a href="/m/v/${S(vid)}">phone view</a></p>${nowl}${gl}${grp}<style>${VU.DETAILS_CSS}</style><h2>Volume over time</h2>${chart}<h2>Operations (latest 500)</h2>${t}`, '/vessels');
}

export function p_ops(c, q) {
  const typ = qv(q, 'type', ''), yr = qv(q, 'year', String(thisYear())), text = qv(q, 'q', '');
  const types = c.col('SELECT DISTINCT op_type FROM operation ORDER BY 1');
  let sql = `SELECT o.id, o.occurred_at, o.op_type, o.treatment, o.operator, GROUP_CONCAT(DISTINCT b.code) batches, GROUP_CONCAT(DISTINCT v.code) vessels
             FROM operation o LEFT JOIN op_vessel ov ON ov.op_id=o.id LEFT JOIN batch b ON b.id=ov.batch_id LEFT JOIN vessel v ON v.id=ov.vessel_id
             WHERE o.id NOT IN (SELECT old_op FROM op_change WHERE kind IN ('correct','replay'))`;
  const args = [];
  if (typ) { sql += ' AND o.op_type=?'; args.push(typ); }
  if (yr) { sql += ' AND substr(o.occurred_at,1,4)=?'; args.push(yr); }
  sql += ' GROUP BY o.id';
  if (text) { sql += ' HAVING batches LIKE ? OR vessels LIKE ?'; args.push(`%${text}%`, `%${text}%`); }
  sql += ' ORDER BY o.occurred_at DESC LIMIT 2000';
  const rows = c.all(sql, ...args);
  const f = `<form class="f"><label>Year<select name="year"><option value="">all</option>${years(c).map(y => `<option ${y === yr ? 'selected' : ''}>${S(y)}</option>`).join('')}</select></label>
    <label>Type<select name="type"><option value="">all</option>${types.map(t => `<option ${t === typ ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></label>
    <label>Batch / vessel<input name="q" value="${E(text)}"></label><button>Filter</button></form>`;
  const t = table(['When', 'Operation', 'Batches', 'Vessels', 'By'], rows.map(r => [link(`/op/${S(r.id)}`, r.occurred_at.slice(0, 16)), E(r.op_type + (r.treatment ? ` · ${r.treatment}` : '')),
    E(r.batches), E(r.vessels), E(r.operator)]));
  return page('Operations', `<h1>Operations</h1><p class="sub">${rows.length} shown (max 2000) · <a href="/workorders">Work orders</a></p>${f}${t}`, '/ops');
}

export function p_op(c, oid, q) {
  const o = c.one('SELECT * FROM operation WHERE id=?', oid);
  if (!o) return null;
  const v = c.all('SELECT ov.*, v.code vc, b.code bc, b2.code bc2 FROM op_vessel ov LEFT JOIN vessel v ON v.id=ov.vessel_id LEFT JOIN batch b ON b.id=ov.batch_id LEFT JOIN batch b2 ON b2.id=ov.batch_after_id WHERE op_id=?', oid);
  const vt = table(['Role', 'Vessel', 'Batch', 'Before (L)', 'After (L)', 'Tax class', 'State'], v.map(r => [E(r.role), link(`/vessel/${S(r.vessel_id)}`, r.vc), link(`/batch/${S(r.batch_id)}`, r.bc) + (r.bc2 && r.bc2 !== r.bc ? ` → ${E(r.bc2)}` : ''),
    num(r.vol_before_l), num(r.vol_after_l), E((r.tax_class_before || '-') + ' → ' + (r.tax_class_after || '-')), E(r.product_state)]), [3, 4]);
  const a = c.all('SELECT a.*, m.name, b.code bc FROM op_addition a JOIN material m ON m.id=a.material_id LEFT JOIN batch b ON b.id=a.batch_id WHERE op_id=?', oid);
  const an = c.all('SELECT a.*, b.code bc FROM op_analysis a LEFT JOIN batch b ON b.id=a.batch_id WHERE op_id=?', oid);
  const ls = c.all('SELECT * FROM op_loss WHERE op_id=?', oid);
  let body = `<h1>${E(o.op_type)}${o.treatment ? ' · ' + E(o.treatment) : ''}</h1><p class="sub">${E(o.occurred_at)} · ${E(o.operator)} · ${E(o.source)} #${E(o.vt_op_id)}${o.reversed ? ' · REVERSED' : ''}</p>`;
  body += history_html(c, oid, q);
  body += '<h2>Vessels</h2>' + vt;
  if (a.length) body += '<h2>Additions</h2>' + table(['Batch', 'Material', 'Amount', 'Unit', 'Batch volume (L)', 'Lot #'], a.map(r => [E(r.bc), link(`/material/${S(r.material_id)}`, r.name), num(r.amount, 3), E(r.unit), num(r.batch_volume_l), E(r.lot || '') + (r.change_to_state ? ` <span class="muted">→ ${E(r.change_to_state)}</span>` : '')]), [2, 4]);
  if (an.length) body += '<h2>Analysis</h2>' + table(['Batch', 'Metric', 'Value', 'Unit'], an.map(r => [E(r.bc), E(r.metric), num(r.value, 3), E(r.unit)]), [2]);
  if (ls.length) body += '<h2>Losses / gains</h2>' + table(['', 'Litres', 'Gal', 'Reason'], ls.map(r => [r.gain ? 'gain' : 'loss', num(r.volume_l, 1), num(r.volume_l / GAL, 1), E(r.reason)]), [1, 2]);
  body += extras.op_details_html(o) + extras.op_costs_html(c, oid);
  return page('Operation', body, '/ops');
}

// Latest results first: one row per vessel per lab entry, metrics across (as on a lab sheet); yearly counts at the bottom.
export function p_lab(c, q) {
  const metric = qv(q, 'metric', ''), text = qv(q, 'q', ''), yr = qv(q, 'year', '');
  const lim = Math.min(pyInt(qv(q, 'n', '150') || 150), 5000);
  const metrics = c.col('SELECT metric FROM op_analysis GROUP BY metric ORDER BY COUNT(*) DESC');
  const w = ['o.reversed=0'], args = [];
  if (yr) { w.push('substr(o.occurred_at,1,4)=?'); args.push(yr); }
  if (text) { w.push('(b.code LIKE ? OR v.code LIKE ?)'); args.push(`%${text}%`, `%${text}%`); }
  if (metric) { w.push('EXISTS (SELECT 1 FROM op_analysis a2 WHERE a2.op_id=a.op_id AND a2.metric=?)'); args.push(metric); }
  let keys = c.all(`SELECT a.op_id, a.vessel_id, MIN(o.occurred_at) t FROM op_analysis a JOIN operation o ON o.id=a.op_id
                         LEFT JOIN batch b ON b.id=a.batch_id LEFT JOIN vessel v ON v.id=a.vessel_id WHERE ${w.join(' AND ')}
                         GROUP BY a.op_id, a.vessel_id ORDER BY t DESC, a.op_id DESC LIMIT ?`, ...args, lim + 1);
  const more = keys.length > lim;
  keys = keys.slice(0, lim);   // same as Python keys[:lim], negative lim included
  const kk = (op, ve) => `${op}|${ve}`;
  const rows = new Map();
  if (keys.length) {
    const ops = [...new Set(keys.map(k => k.op_id))].sort((x, y) => x - y);
    for (const r of c.all(`SELECT a.op_id, a.vessel_id, o.occurred_at, b.id bid, b.code bc, v.code vc, a.metric, a.value, a.unit FROM op_analysis a
                                 JOIN operation o ON o.id=a.op_id LEFT JOIN batch b ON b.id=a.batch_id LEFT JOIN vessel v ON v.id=a.vessel_id
                                 WHERE a.op_id IN (${ops.map(() => '?').join(',')})`, ...ops)) {
      const key = kk(r.op_id, r.vessel_id);
      if (!rows.has(key)) rows.set(key, { t: r.occurred_at, bid: r.bid, bc: r.bc, vc: r.vc, m: new Map() });
      rows.get(key).m.set(r.metric, r.value);
    }
  }
  const want = keys.map(k => [k.op_id, k.vessel_id]).filter(([a, b]) => rows.has(kk(a, b)));
  const used = metrics.filter(m => want.some(([a, b]) => rows.get(kk(a, b)).m.has(m)));
  const fmt = (m, v) => (m === 'SG' ? num(v, 3) : num(v, ['pH', 'Titratable Acidity', 'Volatile acidity'].includes(m) ? 2 : 1));
  const shortOf = m => (Object.prototype.hasOwnProperty.call(SHORT, m) ? SHORT[m] : m);
  const head = used.map(m => `<th class="n">${E(shortOf(m))}</th>`).join('');
  let body = '';
  for (const k of want) {
    const d = rows.get(kk(k[0], k[1]));
    body += (`<tr><td>${link(`/op/${S(k[0])}`, d.t.slice(0, 16).replaceAll('T', ' '))}</td><td>${d.bid ? link('/batch/' + S(d.bid), d.bc) : ''}</td><td>${E(d.vc)}</td>`
      + used.map(m => `<td class="n">${d.m.has(m) ? fmt(m, d.m.get(m)) : ''}</td>`).join('') + '</tr>');
  }
  let latest = (`<div style="overflow-x:auto"><table><thead><tr><th>When</th><th>Batch</th><th>Vessel</th>${head}</tr></thead>`
    + `<tbody>${body || '<tr><td colspan=99 class=muted>No readings</td></tr>'}</tbody></table></div>`);
  if (more) {
    const qs = urlencode({ metric, q: text, year: yr, n: lim * 4 });
    latest += `<p><a class="btn btn2" href="/lab?${qs}">Show more</a></p>`;
  }
  const f = `<form class="f"><label>Batch / vessel<input name="q" value="${E(text)}" placeholder="e.g. 25PB"></label>
    <label>Has metric<select name="metric"><option value="">any</option>${metrics.map(m => `<option ${m === metric ? 'selected' : ''}>${E(m)}</option>`).join('')}</select></label>
    <label>Year<select name="year"><option value="">all</option>${years(c).map(y => `<option ${y === yr ? 'selected' : ''}>${S(y)}</option>`).join('')}</select></label>
    <button>Filter</button></form>`;
  const counts = c.all('SELECT substr(o.occurred_at,1,4) y, a.metric, COUNT(*) n FROM op_analysis a JOIN operation o ON o.id=a.op_id GROUP BY y, a.metric');
  const ys = [...new Set(counts.map(r => r.y))].sort(cmpStr);
  const piv = new Map();
  for (const r of counts) {
    if (!piv.has(r.metric)) piv.set(r.metric, new Map());
    piv.get(r.metric).set(r.y, r.n);
  }
  const ct = table(['Metric', ...ys], metrics.map(m => [E(shortOf(m)), ...ys.map(y => num((piv.get(m) || new Map()).get(y)))]), ys.map((_, i) => 1 + i));
  return page('Lab', `<h1>Lab analyses</h1><p class="sub">Latest results first — one row per vessel per lab entry.</p>${f}${latest}`
    + `<details style="margin-top:22px;max-width:760px;font-size:12px"><summary class="muted">Readings per year (counts)</summary>${ct}</details>`, '/lab');
}

export function p_notes(c, q) {
  const g = (k, d = '') => qv(q, k, d);
  const text = g('q'), batch = g('batch'), yr = g('year'), src = g('src'), order = g('order', 'new');
  const pg = Math.max(pyInt(g('p', '1') || 1), 1), per = 100;
  const [rows, total] = notes.listing(c, text, batch, yr, src, order, per, (pg - 1) * per);
  const st = notes.stats(c);
  const stOk = truthyDict(st);
  const sel = (name, cur, items) => `<select name="${name}">` + items.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${E(t)}</option>`).join('') + '</select>';
  const yrs = stOk ? c.col('SELECT DISTINCT substr(noted_at,1,4) FROM batch_note ORDER BY 1 DESC') : [];
  const f = (`<form class="f"><label>Text<input name="q" value="${E(text)}" placeholder="words in the note"></label><label>Batch<input name="batch" value="${E(batch)}" placeholder="e.g. 25Crab"></label>`
    + `<label>Year${sel('year', yr, [['', 'all'], ...yrs.map(y => [y, y])])}</label>`
    + `<label>From${sel('src', src, [['', 'all'], ['vintrace', 'Vintrace'], ['app', 'written here'], ['nobatch', 'no batch']])}</label>`
    + `<label>Sort${sel('order', order, [['new', 'newest first'], ['old', 'oldest first'], ['batch', 'by batch, then date']])}</label><button>Filter</button></form>`);
  let tr = '';
  for (const n of rows) {
    const extra = (n.nlinks || 0) > 1 ? `<small>also shown on ${n.nlinks - 1} other batch${n.nlinks > 2 ? 'es' : ''}</small>` : '';
    tr += (`<tr><td style="white-space:nowrap"><b>${E(hw_ui.stamp(n.noted_at))}</b><small>${E(hw_ui.ago(n.noted_at))}</small></td>`
      + `<td>${n.batch_id ? link('/batch/' + S(n.batch_id) + '?tab=notes', n.bcode) : '<span class=muted>none</span>'}${extra}</td><td>${E(n.container || '')}</td>`
      + `<td style="white-space:pre-wrap;max-width:720px">${E(strip(n.detail || ''))}${hw_ui.note_photos(n)}</td><td class="muted">${n.source !== 'app' || (n.who || '') !== 'HWWineTracker' ? E(n.who || '') : ''}${n.source === 'app' ? ' · written here' : ''}${n.edited_at ? ' · edited' : ''} · <a href="/notes/edit?note=${n.id}&amp;back=/notes">edit</a> · <a href="/notes/photo?note=${n.id}">＋ photo</a></td></tr>`);
  }
  const qs = p => urlencode({ q: text, batch, year: yr, src, order, p });
  let nav = '';
  if (total > per) {
    const prev = pg > 1 ? '<a class="btn btn2" href="/notes?' + qs(pg - 1) + '">← Previous page</a>' : '';
    const nxt = pg * per < total ? '<a class="btn btn2" href="/notes?' + qs(pg + 1) + '">Next page →</a>' : '';
    nav = `<p class="bar">${prev}<span class="muted">${(pg - 1) * per + 1}–${Math.min(pg * per, total)} of ${fxc(total, 0)}</span>${nxt}</p>`;
  }
  const kept = stOk ? (`<div class="infobox">${fxc(st.total || 0, 0)} notes: ${fxc(st.vintrace || 0, 0)} from Vintrace (${(st.first || '').slice(0, 10)} to ${(st.last || '').slice(0, 10)}) `
    + `and ${fxc(st.app || 0, 0)} written here. Each note is stored once, dated, with the batch that was in its vessel at that minute; `
    + `notes carried through racking and blends are linked to every later batch, so none drop out when wines are combined. `
    + `${fxc(st.nobatch || 0, 0)} have no batch (still listed here). Refreshing from Vintrace replaces only the Vintrace notes, from the saved raw files; notes written here are never touched.</div>`) : '';
  const body = (`<h1>Notes</h1><p class="sub"><a class="btn" href="/record/note">+ Add note</a></p>${kept}${f}<p class="muted">${fxc(total, 0)} match</p>${nav}`
    + `<table><thead><tr><th>Date / time</th><th>Batch</th><th>Vessel</th><th>Note</th><th>By</th></tr></thead><tbody>${tr || '<tr><td colspan=5 class=muted>No notes</td></tr>'}</tbody></table>${nav}`);
  return page('Notes', body, '/notes');
}

export function p_materials(c, q) {
  const rows = c.all(`SELECT m.id, m.name, m.kind, m.base_unit, m.ttb_part_iv, substr(o.occurred_at,1,4) y, SUM(a.amount_base) s, COUNT(*) n
                        FROM material m LEFT JOIN op_addition a ON a.material_id=m.id LEFT JOIN operation o ON o.id=a.op_id GROUP BY m.id, y`);
  const ys = [...new Set(rows.filter(r => r.y).map(r => r.y))].sort(cmpStr);
  const mats = new Map();
  for (const r of rows) {
    if (!mats.has(r.id)) mats.set(r.id, { r, y: new Map() });
    mats.get(r.id).y.set(r.y, r.s);
  }
  const rank = { honey: 0, sugar: 1, water: 2 };
  const order = [...mats.values()].sort((a, b) => cmpKey(
    [Object.prototype.hasOwnProperty.call(rank, a.r.kind) ? rank[a.r.kind] : 3, a.r.kind, a.r.name],
    [Object.prototype.hasOwnProperty.call(rank, b.r.kind) ? rank[b.r.kind] : 3, b.r.kind, b.r.name]));
  const t = table(['Material', 'Kind', 'Unit', 'Part IV', ...ys], order.map(m => [link(`/material/${S(m.r.id)}`, m.r.name), E(m.r.kind), E(m.r.base_unit), E(m.r.ttb_part_iv || ''),
    ...ys.map(y => num(m.y.get(y), 1))]), ys.map((_, i) => 4 + i));
  return page('Materials', `<h1>Materials added to wine</h1><p class="sub">Amounts per year in base units (kg, L). Honey, sugar and water are first-class ingredients here.</p>${t}`, '/materials');
}

export function p_material(c, mid, q) {
  const m = c.one('SELECT * FROM material WHERE id=?', mid);
  if (!m) return null;
  const rows = c.all(`SELECT o.id, o.occurred_at, b.id bid, b.code bc, v.code vc, a.amount, a.unit, a.amount_base, a.batch_volume_l FROM op_addition a JOIN operation o ON o.id=a.op_id
                        LEFT JOIN batch b ON b.id=a.batch_id LEFT JOIN vessel v ON v.id=a.vessel_id WHERE a.material_id=? ORDER BY o.occurred_at DESC`, mid);
  const t = table(['When', 'Batch', 'Vessel', 'Amount', 'Unit', `In ${S(m.base_unit)}`, 'Batch vol (L)'], rows.map(r => [link(`/op/${S(r.id)}`, r.occurred_at.slice(0, 16)), r.bid ? link(`/batch/${S(r.bid)}`, r.bc) : '',
    E(r.vc), num(r.amount, 3), E(r.unit), num(r.amount_base, 3), num(r.batch_volume_l)]), [3, 5, 6]);
  let stock = '';
  if (m.stock_item_id) stock = `<p>Stock item: ${link('/item/' + S(m.stock_item_id), 'view stock history')}</p>`;
  return page(m.name, `<h1>${E(m.name)}</h1><p class="sub">${E(m.kind)} · base unit ${E(m.base_unit)}</p>${stock}${t}`, '/materials');
}

export function p_intakes(c, q) {
  const yr = qv(q, 'year', '');
  let sql = 'SELECT i.*, b.code bc FROM intake i LEFT JOIN batch b ON b.id=i.batch_id WHERE 1=1';
  const args = [];
  if (yr) { sql += ' AND substr(i.occurred_at,1,4)=?'; args.push(yr); }
  const rows = c.all(sql + ' ORDER BY i.occurred_at DESC', ...args);
  const tot = c.all('SELECT variety, kind, unit, substr(occurred_at,1,4) y, SUM(amount) s FROM intake WHERE reversed=0 GROUP BY variety, kind, unit, y');
  const ys = [...new Set(tot.map(r => r.y))].sort(cmpStr);
  const piv = new Map();
  for (const r of tot) {
    const k = JSON.stringify([r.variety, r.kind, r.unit]);
    if (!piv.has(k)) piv.set(k, { k: [r.variety, r.kind, r.unit], v: new Map() });
    piv.get(k).v.set(r.y, r.s);
  }
  const items = [...piv.values()].sort((a, b) => cmpKey([a.k[1], -sum([...a.v.values()])], [b.k[1], -sum([...b.v.values()])]));
  const pt = table(['Variety', 'Kind', 'Unit', ...ys], items.map(({ k, v }) => [E(k[0]), E(k[1]), E(k[2]), ...ys.map(y => num(v.get(y)))]), ys.map((_, i) => 3 + i));
  const f = `<form class="f"><label>Year<select name="year">${opts(ys, yr, 'all')}</select></label><button>Filter</button></form>`;
  const t = table(['Date', 'Kind', 'Variety', 'Supplier', 'Amount', 'Unit', 'Batch', 'Booking', 'Docket', 'Cost', ''], rows.map(r => [E(r.occurred_at.slice(0, 10)), E(r.kind), E(r.variety), E(r.supplier), num(r.amount, 1), E(r.unit),
    r.batch_id ? link(`/batch/${S(r.batch_id)}`, r.bc) : '', E(r.booking_no || ''), E(r.docket), r.cost ? '$' + num(r.cost, 2) : '', r.reversed ? 'reversed' : '']), [4, 9]);
  return page('Intakes', `<h1>Intakes</h1><p class="sub"><a href="/bookings">Fruit bookings</a> · <a href="/contacts">Growers &amp; suppliers</a></p><h2>Totals by year</h2>${pt}<h2>Deliveries</h2>${f}${t}`, '/intakes');
}

export function p_stock(c, q) {
  const day = qv(q, 'date', today());
  const rows = reports.stock_on_hand(c, day);
  const groups = new Map();
  for (const r of rows) {
    const k = r.category || 'Other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let body = `<h1>Stock on hand</h1><form class="f"><label>As of<input type="date" name="date" value="${E(day)}"></label><button>Show</button> <a href="/stock.csv?date=${E(day)}">Download CSV</a></form>`;
  for (const cat of [...groups.keys()].sort((a, b) => cmpKey([a !== 'Bottled-Canned Wine' ? 1 : 0, a], [b !== 'Bottled-Canned Wine' ? 1 : 0, b]))) {
    const rs = groups.get(cat);
    const gal = sum(rs.map(r => r.q * (r.litres_per_unit || 0))) / GAL;
    body += `<h2>${E(cat)} (${rs.length}${gal ? ` · ${num(gal)} gal` : ''})</h2>` + table(['Item', 'Name', 'Description', 'Class', 'On hand', 'Unit', 'Gal'],
      rs.map(r => [link(`/item/${S(r.id)}`, r.code), E(r.name), E(r.description), E(r.tax_class), trimZeros(num(r.q, 2)), E(r.unit),
        r.litres_per_unit ? num(r.q * r.litres_per_unit / GAL, 1) : '']), [4, 6]);
  }
  return page('Stock', body, '/stock');
}

export function p_item(c, iid, q) {
  const it = c.one('SELECT * FROM stock_item WHERE id=?', iid);
  if (!it) return null;
  const ev = c.all(`SELECT se.occurred_at, se.action, se.quantity, d.id did, d.bol, d.dispatch_type FROM stock_event se
                      LEFT JOIN dispatch d ON d.id=se.dispatch_id WHERE se.item_id=? ORDER BY se.occurred_at, se.id`, iid);
  let bal = 0;
  const rows = [];
  for (const r of ev) {
    bal += r.quantity;
    rows.push([E(r.occurred_at.slice(0, 16)), E(r.action), num(r.quantity, 2), num(bal, 2)]);
  }
  rows.reverse();
  const lines = c.all('SELECT d.id, d.occurred_at, d.bol, d.dispatch_type, dl.quantity, d.reversed FROM dispatch_line dl JOIN dispatch d ON d.id=dl.dispatch_id WHERE dl.item_id=? ORDER BY d.occurred_at DESC', iid);
  const dt_ = table(['Date', 'BOL', 'Type', 'Qty', ''], lines.map(r => [E(r.occurred_at.slice(0, 16)), link(`/dispatch/${S(r.id)}`, r.bol), E(r.dispatch_type), num(r.quantity), r.reversed ? 'reversed' : '']), [3]);
  return page(it.code, `<h1>${E(it.code)} <span class="muted">${E(it.description)}</span></h1>
      <p class="sub">${E(it.category)} · ${E(it.item_type)} · unit ${E(it.unit)}${it.litres_per_unit ? ` · ${num(it.litres_per_unit, 3)} L per unit` : ''}${it.tax_class ? ` · class ${E(it.tax_class)} (${E(it.state_tax_class)})` : ''}${it.unit_cost !== null && it.unit_cost !== undefined ? ` · unit cost $${num(it.unit_cost, 2)}` : ''}${it.location ? ` · ${E(it.location)}` : ''}${it.tax_state ? ` · ${E(it.tax_state)}` : ''}${it.cost_as_of ? ` <span class="muted">(Vintrace, ${E(String(it.cost_as_of).slice(0, 10))})</span>` : ''}</p>
      <div class="grid2"><div><h2>Stock history (date order, running balance)</h2>${table(['When', 'Action', 'Qty', 'Balance'], rows, [2, 3])}</div><div><h2>Dispatches</h2>${dt_}</div></div>`, '/stock');
}

export function p_dispatches(c, q) {
  const yr = qv(q, 'year', String(thisYear()));
  const unit = qv(q, 'unit', 'units');
  const ys = c.col('SELECT DISTINCT substr(occurred_at,1,4) FROM dispatch ORDER BY 1 DESC');
  const val = unit === 'units' ? 'dl.quantity' : 'dl.quantity*si.litres_per_unit/3.785411784';
  const rows = c.all(`SELECT substr(d.occurred_at,6,2) m, d.dispatch_type t, SUM(${val}) s FROM dispatch d JOIN dispatch_line dl ON dl.dispatch_id=d.id JOIN stock_item si ON si.id=dl.item_id
                         WHERE d.reversed=0 AND si.is_finished=1 AND substr(d.occurred_at,1,4)=? GROUP BY m, t`, yr);
  const types = c.col('SELECT name FROM dispatch_type ORDER BY sort').filter(t => rows.some(r => r.t === t));
  const piv = new Map();
  for (const r of rows) {
    if (!piv.has(r.m)) piv.set(r.m, new Map());
    piv.get(r.m).set(r.t, r.s);
  }
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const prow = months.filter(m => piv.get(m) && piv.get(m).size).map(m => [strftime(Date.UTC(2000, Number(m) - 1, 1), '%b'), ...types.map(t => num(piv.get(m).get(t))), num(sum([...piv.get(m).values()]))]);
  prow.push(['<b>Total</b>', ...types.map(t => `<b>${num(sum([...piv.keys()].map(m => (piv.get(m).has(t) ? piv.get(m).get(t) : 0))))}</b>`), `<b>${num(sum([...piv.values()].map(v => sum([...v.values()]))))}</b>`]);
  const pt = table(['Month', ...types, 'All'], prow, types.map((_, i) => 1 + i).concat([types.length + 1]));
  const bols = c.all(`SELECT d.id, d.occurred_at, d.bol, d.dispatch_type, d.reversed, SUM(CASE WHEN si.is_finished=1 THEN dl.quantity END) q, COUNT(dl.id) n
                        FROM dispatch d LEFT JOIN dispatch_line dl ON dl.dispatch_id=d.id LEFT JOIN stock_item si ON si.id=dl.item_id
                        WHERE substr(d.occurred_at,1,4)=? GROUP BY d.id ORDER BY d.occurred_at DESC`, yr);
  const bt = table(['Date', 'BOL', 'Type', 'Lines', 'Units', ''], bols.map(r => [E(r.occurred_at.slice(0, 16)), link(`/dispatch/${S(r.id)}`, r.bol), E(r.dispatch_type), S(r.n), num(r.q), r.reversed ? '<span class="tag">reversed</span>' : '']), [3, 4]);
  const f = `<form class="f"><label>Year<select name="year">${ys.map(y => `<option ${y === yr ? 'selected' : ''}>${S(y)}</option>`).join('')}</select></label>
    <label>Show<select name="unit"><option value="units">units (bottles/cans)</option><option value="gal" ${unit === 'gal' ? 'selected' : ''}>gallons</option></select></label><button>Show</button></form>`;
  const m0 = today().slice(0, 8) + '01', pm = addDays(m0, -1), pm0 = pm.slice(0, 8) + '01';
  const dl = `<form class="f" action="/dispatched_stock.csv"><label>Dispatched Stock (same columns as Vintrace's export) from<input type="date" name="from" value="${E(pm0)}"></label><label>to<input type="date" name="to" value="${E(pm)}"></label><button>Download CSV</button> <a href="/record/dispatch">＋ New dispatch</a></form>`;
  return page('Dispatches', `<h1>Dispatches (BOLs)</h1>${dl}${f}<h2>By month and sector — ${E(yr)}, ${E(unit)}</h2>${pt}<h2>BOLs</h2>${bt}`, '/dispatches');
}

export function p_dispatch(c, did, q) {
  const d = c.one('SELECT * FROM dispatch WHERE id=?', did);
  if (!d) return null;
  const lines = c.all('SELECT dl.*, si.code, si.name, si.description, si.tax_class, si.litres_per_unit FROM dispatch_line dl JOIN stock_item si ON si.id=dl.item_id WHERE dispatch_id=? ORDER BY si.code', did);
  const t = table(['Item', 'Name', 'Description', 'Class', 'Qty', 'Gal'], lines.map(r => [link(`/item/${S(r.item_id)}`, r.code), E(r.name), E(r.description), E(r.tax_class), num(r.quantity),
    num(r.quantity * (r.litres_per_unit || 0) / GAL, 2)]), [4, 5]);
  const tot = sum(lines.map(r => r.quantity));
  const sv = q && q.saved ? `<div class="ok">Saved: ${lines.length} line${lines.length === 1 ? '' : 's'}, ${num(sum(lines.map(r => r.quantity)))} units. <a href="/record/dispatch">＋ New dispatch</a></div><script>try{localStorage.removeItem('hwt_dispatch_draft_v1')}catch(e){}</script>` : '';
  return page(`BOL ${S(d.bol)}`, `${sv}<h1>BOL ${E(d.bol)} · ${E(d.dispatch_type)}</h1><p class="sub">${E(d.occurred_at)} · ${E(d.operator)} · ${num(tot)} units${d.reversed ? ' · REVERSED' : ''}${d.modified_at ? ' · modified ' + E(d.modified_at) : ''}</p>${t}`, '/dispatches');
}

export function p_reports(c, q) {
  const yr = pyInt(qv(q, 'year', String(thisYear() - 1)));
  const ys = years(c).filter(y => pyInt(y) >= 2020).map(y => pyInt(y));
  const rep = reports.ttb_5120(c, yr);
  const CL = [...reports.CLASSES, ...([...rep.gal.values()].some(v => v.has('?')) ? ['?'] : [])];
  const g0 = (vals, cc) => (vals.has(cc) ? vals.get(cc) : 0);
  const sect = lines => {
    const rows = [];
    for (const [key, label] of lines) {
      const vals = rep.gal.get(key) || new Map();
      if (!['A1', 'A12', 'A31', 'A32', 'B1', 'B7', 'B20', 'B21', 'A2', 'A13', 'B2', 'B8'].includes(key) && !CL.some(cc => Math.abs(g0(vals, cc)) >= 0.5)) continue;
      const bold = ['A12', 'A32', 'B7', 'B21'].includes(key);
      const wrap = s => (bold ? `<b>${s}</b>` : s);
      rows.push([wrap(E(label)), ...CL.map(cc => wrap(Math.abs(g0(vals, cc)) >= 0.5 ? num(vals.get(cc)) : ''))]);
    }
    return table(['Line', ...CL.map(cc => `(${cc}) ${reports.CLASS_NAMES[cc]}`)], rows, CL.map((_, i) => 1 + i));
  };
  const a2 = rep.gal;
  const detail = table(['How wine entered Section A (gal)', ...CL], ['A2:declared', 'A2:declared_at_bottling', 'A2:blended_into_bonded'].filter(k => a2.get(k) && a2.get(k).size)
    .map(k => [E(k.split(':')[1].replaceAll('_', ' ')), ...CL.map(cc => num((a2.get(k) || new Map()).get(cc), 1))]), CL.map((_, i) => 1 + i));
  const iv = rep.part_iv;
  const ivt = table(['Part IV item', 'Value'], [['Fruit received / used (lb)', num(iv.fruit_lb)], ['Honey received as intake (lb)', num(iv.honey_intake_lb)], ['Cider / bulk juice received / used (gal)', num(iv.cider_gal)],
    ['Sugar (dry, lb) — on hand beginning', num(iv.sugar_begin_lb)], ['Sugar — received', num(iv.sugar_received_lb)], ['Sugar — used in wine production', num(iv.sugar_used_lb)],
    ['Sugar — removed / adjusted', num(iv.sugar_removed_lb)], ['Sugar — on hand end', num(iv.sugar_end_lb)],
    ['<span class="muted">Honey added as an ingredient (lb) — not in Vintrace\'s Part IV</span>', num(iv.honey_added_lb)],
    ['<span class="muted">Water added (gal) — no Part IV line</span>', num(iv.water_added_gal)]], [1]);
  const vii = Object.entries(rep.part_vii);
  const viit = table(['Part VII — in fermenters end of period (gal)', 'Gal'], [...[...vii].sort((a, b) => cmpStr(a[0], b[0])).map(([k, v]) => [E(k), num(v)]), ['<b>Total</b>', `<b>${num(sum(vii.map(([, v]) => v)))}</b>`]], [1]);
  const notesHtml = rep.notes.map(n => `<div class="note">${E(n)}</div>`).join('');
  const f = `<form class="f"><label>Year<select name="year">${opts(ys, yr)}</select></label><button>Build</button> <a class="muted" style="font-size:12px" href="/ttb.csv?year=${yr}">data (CSV)</a></form>
    <form class="f" action="/ttb.pdf"><input type="hidden" name="year" value="${E(String(yr))}"><button class="btn">Download TTB form (PDF)</button>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="kinds" value="1" style="width:auto"> list the fruit kinds received in Part X</label></form>
    <p class="muted" style="font-size:12px;margin-top:-4px">The official TTB F 5120.17 with these figures filled in — every box stays editable: review, add the EIN, sign, date and print. The current year comes out marked DRAFT.</p>`;
  const td = today();
  const monthEnd = addDays(td.slice(0, 8) + '01', -1);
  const exp = `<h2>Monthly Dispatched Stock export</h2><p class="sub">Same 53 columns as Vintrace's VINx2_DispatchedStock CSV (finished goods, non-reversed). Cost columns are blank.</p>
      <form class="f" action="/dispatched_stock.csv"><label>From<input type="date" name="from" value="2021-01-01"></label><label>To<input type="date" name="to" value="${monthEnd}"></label><button>Download CSV</button></form>`;
  let lb = null;
  try { lb = JSON.parse(c.val("SELECT value FROM app_meta WHERE key='last_backup'") || 'null'); } catch (e) { lb = null; }
  let le = null;
  try { le = JSON.parse(c.val("SELECT value FROM app_meta WHERE key='last_backup_error'") || 'null'); } catch (e) { le = null; }
  const bk = (le ? `<p class="err">Last backup attempt FAILED (${E(String(le.at).replace('T', ' ').slice(0, 16))} UTC): ${E(le.error)}</p>` : '')
    + (lb ? `<p class="muted" style="font-size:13px">Last backup: ${E(String(lb.at).replace('T', ' ').slice(0, 16))} UTC · ${E(String(lb.file).split('/').pop())} (${num(lb.bytes / 1e6, 1)} MB) · ${E(lb.folder || '')}${lb.photos ? ` · ${num(lb.photos)} new photo(s)` : ''} · <a href="/backups">Backups</a></p>`
      : '<p class="muted" style="font-size:13px">No backup recorded yet · <a href="/backups">Backups</a></p>');
  const body = `<h1>Reports</h1>${bk}<p class="sub"><a href="/ops">All operations (chronological)</a> · <a href="/workorders">Work orders (Vintrace history)</a></p>${exp}<h2>TTB F 5120.17${HELP('ttb')} — Report of Wine Premises Operations, ${yr}</h2>${f}${notesHtml}
      <p class="sub">Gallons, rounded. Bulk on hand from end-of-day snapshots ${E(rep.snapshots[0])} / ${E(rep.snapshots[1])}. Line 13 = bottled finished goods (= Section B line 2); line 30 balances.</p>
      <h2>Part I Section A — bulk wines</h2>${sect(reports.TTB_LINES_A)}${detail}<h2>Part I Section B — bottled wines</h2>${sect(reports.TTB_LINES_B)}<div class="grid2"><div><h2>Part IV — materials</h2>${ivt}</div><div><h2>Part VII</h2>${viit}</div></div>`;
  return page('Reports', body, '/reports');
}
