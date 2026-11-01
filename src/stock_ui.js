// v1.32 — retire a wine/item (stock_item.inactive): off the Stock list and the pickers, history and TTB untouched; an
// "Adjust on hand" box on the item page books a difference as a dispatch (any type), a count (TTB B5/B19) or a records
// correction (no TTB line), and can retire the item in the same step.
// v1.29 — months left by wine (vintages sell oldest first). v1.28 — Stock: categories you open and close (bottled wine open first), wine rows with class spelled out, size, on hand,
// last 12 months out, months left and a 12-month trend; an item page with one chart of stock on hand over time (every
// bottling, dispatch, receipt and count moves it) and one merged history (dispatches with their type and BOL).
import { tip as HELP } from './help.js';
import { E, num, qv, today, addDays, nowIso } from './lib/py.js';
import { page, GAL, ctx, package_batches_by_time } from './core.js';
import { TAX_CLASSES } from './entry.js';
import * as notes from './notes.js';
import * as hw_ui from './hw_ui.js';
import { blend_sources } from './labchart.js';

const CLASS = Object.fromEntries(TAX_CLASSES.map(([k, l]) => [k, l]));
const ORDER = ['Bottled-Canned Wine', 'Labels', 'Bottles-Cans', 'Corks', 'Capsules', 'Wire Cage', 'Additives', 'Filtration', 'Testing', 'Bulk wine'];
const NAMES = { 'Bottled-Canned Wine': 'Bottled & canned wine', 'Bottles-Cans': 'Empty bottles & cans', 'Wire Cage': 'Wire cages' };
const size = (lpu, unit) => !lpu ? (unit && unit !== 'x1' ? unit : '') : lpu >= 19 ? `${num(lpu, 1)} L keg` : lpu < 1 ? `${Math.round(lpu * 1000)} ml` : `${num(lpu, 2)} L`;
const D = s => Date.parse(String(s).replace(' ', 'T').slice(0, 19) + 'Z');
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = s => { const t = String(s || '').slice(0, 10); return t ? `${M[+t.slice(5, 7) - 1]} ${+t.slice(8, 10)}, ${t.slice(0, 4)}` : ''; };
const cpill = k => (k ? `<span class="sk-cl" title="TTB class ${E(k)}: ${E(CLASS[k] || '')}">${E(k)} · ${E(CLASS[k] || '')}</span>` : '');


// Option B (v1.29): vintages of one wine share a pace and sell oldest first. Family = name stem (vintage digits, size
// suffixes and a trailing CAN dropped) + bottle size. Pace = the whole family's dispatches in the 12 months to `asof`
// ÷ 12; a vintage's months left = (on hand of every older vintage + its own) ÷ that pace.
const stem = code => String(code).toUpperCase().split('_')[0].replace(/^\d+/, '').replace(/[^A-Z]/g, '').replace(/CANS?$/, '') || String(code).toUpperCase();
const vyear = code => { const m = String(code).match(/^(20\d\d)(?=\D)/) || String(code).match(/^(\d\d)/); return m ? +m[1].slice(-2) : 99; };
export function plan(c, asof = today()) {
  const end = addDays(asof, 1), y0 = addDays(asof, -365);
  const its = c.all(`SELECT si.id, si.code, si.litres_per_unit l,
      COALESCE((SELECT SUM(quantity) FROM stock_event WHERE item_id=si.id AND occurred_at<?),0) q,
      COALESCE((SELECT -SUM(quantity) FROM stock_event WHERE item_id=si.id AND action='Dispatch' AND occurred_at>=? AND occurred_at<?),0) o,
      (SELECT MIN(occurred_at) FROM stock_event WHERE item_id=si.id) f
    FROM stock_item si WHERE si.is_finished=1`, end, y0, end);
  const fam = new Map();
  for (const r of its) { const k = stem(r.code) + '|' + (+r.l || 0).toFixed(3); if (!fam.has(k)) fam.set(k, []); fam.get(k).push(r); }
  // months in the window the wine was actually on the shelf: every vintage's balance (never below zero) added up, counted
  // as in stock while that is more than a case (12 bottles/cans; 1 for 3 L and kegs). A new release, or a wine that sold
  // out and waited for the next vintage, is judged only on the time it was available.
  const ev = new Map();
  for (const e of c.all(`SELECT se.item_id i, se.occurred_at t, se.quantity v FROM stock_event se JOIN stock_item si ON si.id=se.item_id
                         WHERE si.is_finished=1 AND se.occurred_at<? ORDER BY se.occurred_at, se.id`, end)) { if (!ev.has(e.i)) ev.set(e.i, []); ev.get(e.i).push(e); }
  const T0 = D(y0 + ' 00:00:00'), T1 = D(end + ' 00:00:00');
  const inStock = rs => {
    const thr = (+rs[0].l || 0.75) < 1.5 ? 12 : 1, bal = new Map(rs.map(r => [r.id, 0])), es = [];
    for (const r of rs) for (const e of ev.get(r.id) || []) { const t = D(e.t); if (t < T0) bal.set(r.id, bal.get(r.id) + e.v); else es.push([t, r.id, e.v]); }
    es.sort((a, b) => a[0] - b[0]);
    const avail = () => [...bal.values()].reduce((s, b) => s + Math.max(0, b), 0) > thr;
    let t = T0, on = avail(), ms = 0;
    for (const [te, id, v] of es) { if (on) ms += te - t; t = te; bal.set(id, bal.get(id) + v); on = avail(); }
    if (on) ms += T1 - t;
    return ms / (30.4375 * 864e5);
  };
  const out = new Map();
  for (const rs of fam.values()) {
    rs.sort((a, b) => (vyear(a.code) - vyear(b.code)) || String(a.f || '').localeCompare(String(b.f || '')) || a.id - b.id);
    const o = rs.reduce((t, r) => t + Math.max(0, r.o), 0);
    const months = o > 0 || rs.some(r => r.q > 1e-6) ? Math.min(12, inStock(rs)) : 12;
    const pace = o > 0 ? o / Math.max(1, months || 12) : 0;
    const live = rs.filter(r => r.q > 1e-6);
    let cum = 0;
    for (const r of rs) {
      const qq = Math.max(0, r.q); cum += qq;
      const i = live.indexOf(r);
      out.set(r.id, { pace, ml: pace > 0 && qq > 0 ? cum / pace : null, start: pace > 0 && qq > 0 ? (cum - qq) / pace : 0,
        before: i > 0 ? live.slice(0, i).map(x => x.code) : [], after: i >= 0 ? live.slice(i + 1).map(x => x.code) : [],
        months, since: r.f && r.f >= y0 ? r.f : null, members: rs.filter(x => x.o > 0 || x.q > 1e-6).map(x => x.code), shared: rs.filter(x => x.o > 0 || x.q > 1e-6).length > 1 });
    }
  }
  return out;
}
const basis = m => m < 1 ? "under 1 mo" : `${num(m, m < 10 ? 1 : 0)} mo`;
const mlTxt = ml => ml === null ? '—' : ml > 60 ? '60+' : num(ml, ml < 10 ? 1 : 0);
const seq = p => [p.before.length ? `after ${p.before.join(', ')}` : '', p.after.length ? `then ${p.after.join(', ')}` : ''].filter(Boolean).join(' · ');

export function p_stock(c, q) {
  const asof = qv(q, 'date', today()), end = addDays(asof, 1), y0 = addDays(asof, -365);
  const items = c.all(`SELECT si.id, si.code, si.name, si.description, si.category, si.unit, si.tax_class, si.litres_per_unit, si.is_finished, SUM(se.quantity) q, MAX(se.occurred_at) last
                       FROM stock_item si JOIN stock_event se ON se.item_id=si.id WHERE se.occurred_at<? AND (si.inactive=0 OR ?<?) GROUP BY si.id HAVING ABS(q)>1e-6`, end, asof, today());
  const retired = c.all(`SELECT si.id, si.code, si.name, si.description, si.category, si.unit, si.is_finished, COALESCE(SUM(se.quantity),0) q, MAX(se.occurred_at) last
                         FROM stock_item si LEFT JOIN stock_event se ON se.item_id=si.id WHERE si.inactive=1 GROUP BY si.id ORDER BY last DESC, si.code`);
  const outY = new Map(c.all(`SELECT item_id, -SUM(quantity) o FROM stock_event WHERE action='Dispatch' AND occurred_at>=? AND occurred_at<? GROUP BY item_id`, y0, end).map(r => [r.item_id, r.o]));
  const PL = plan(c, asof);
  const lastD = new Map(c.all(`SELECT item_id, MAX(occurred_at) t FROM stock_event WHERE action='Dispatch' AND occurred_at<? GROUP BY item_id`, end).map(r => [r.item_id, r.t]));
  // 12-month trend for finished goods: balance at 13 monthly points, walked back from the balance now
  const evY = new Map();
  for (const r of c.all(`SELECT se.item_id, se.occurred_at t, se.quantity v FROM stock_event se JOIN stock_item si ON si.id=se.item_id WHERE si.is_finished=1 AND se.occurred_at>=? AND se.occurred_at<?`, y0, end)) {
    if (!evY.has(r.item_id)) evY.set(r.item_id, []);
    evY.get(r.item_id).push(r);
  }
  const t1 = D(end + ' 00:00:00'), pts = [...Array(13)].map((_, i) => t1 - (12 - i) * 30.4375 * 864e5);
  const spark = it => {
    const ev = evY.get(it.id) || [];
    const vals = pts.map(p => it.q - ev.filter(e => D(e.t) > p).reduce((s, e) => s + e.v, 0));
    const mx = Math.max(...vals, 1), w = 90, h = 22;
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * w / 12).toFixed(1)},${(h - 2 - (Math.max(0, v) / mx) * (h - 4)).toFixed(1)}`).join('');
    return `<svg class="sk-sp" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="12-month trend"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  };
  const groups = new Map();
  for (const r of items) { const k = r.category || (r.is_finished ? 'Bottled-Canned Wine' : 'Other'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const cats = [...groups.keys()].sort((a, b) => ((ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  const open = String((q.open || [''])[0] || 'Bottled-Canned Wine');
  const secs = cats.map(cat => {
    const rs = groups.get(cat).sort((a, b) => (b.q - a.q));
    const wine = cat === 'Bottled-Canned Wine';
    const gal = wine ? rs.reduce((t, r) => t + r.q * (r.litres_per_unit || 0), 0) / GAL : 0;
    const units = rs.reduce((t, r) => t + (r.q > 0 ? r.q : 0), 0);
    const neg = rs.filter(r => r.q < -1e-6).length;
    const head = wine ? '<tr><th>Wine</th><th>Description</th><th>Class</th><th>Size</th><th class="n">On hand</th><th class="n">Gal</th><th class="n" title="This vintage, last 12 months (or since it was bottled)">Out, last 12 mo</th><th class="n" title="All vintages of this wine and size together: bottles out in the last 12 months ÷ the months it was actually in stock">Wine&rsquo;s pace / mo' + HELP('stock') + '</th><th class="n" title="Older vintages are assumed to sell first; this vintage starts selling when they run out">Months left' + HELP('stock') + '</th><th>Last 12 months</th><th>Last dispatch</th></tr>'
      : '<tr><th>Item</th><th>Description</th><th class="n">On hand</th><th>Unit</th><th>Last movement</th></tr>';
    const body = rs.map(r => {
      const s = `data-s="${E((r.code + ' ' + (r.description || '') + ' ' + (r.name || '')).toLowerCase())}"`;
      if (!wine) return `<tr ${s}><td><a href="/item/${r.id}">${E(r.code)}</a></td><td>${E(r.description || r.name || '')}</td><td class="n ${r.q < 0 ? 'sk-neg' : ''}">${num(r.q, r.q % 1 ? 2 : 0)}</td><td>${E(r.unit === 'x1' ? 'each' : r.unit || '')}</td><td>${day(r.last)}</td></tr>`;
      const o = outY.get(r.id) || 0, p = PL.get(r.id) || { pace: o / 12, ml: o > 0 && r.q > 0 ? r.q / (o / 12) : null, before: [], after: [], shared: false }, ml = p.ml, sq = seq(p);
      return `<tr ${s}><td><a href="/item/${r.id}"><b>${E(r.code)}</b></a></td><td>${E(r.description || r.name || '')}</td><td>${cpill(r.tax_class)}</td><td class="sk-nw">${E(size(r.litres_per_unit, r.unit))}</td>
<td class="n ${r.q < 0 ? 'sk-neg' : ''}"><b>${num(r.q, 0)}</b></td><td class="n">${num(r.q * (r.litres_per_unit || 0) / GAL, 1)}</td><td class="n">${o ? num(o, 0) : '—'}${p.since ? `<span class="sk-fam">since ${E(day(p.since).replace(/, \d{4}$/, ''))}</span>` : ''}</td><td class="n">${p.pace ? num(p.pace, p.pace < 10 ? 1 : 0) : '—'}${[p.shared ? '<span title="' + E(p.members.join(' + ')) + '">all vintages</span>' : '', p.pace && p.months < 11.5 ? `${basis(p.months)} in stock` : ''].filter(Boolean).map(x => `<span class="sk-fam">${x}</span>`).join('')}</td>
<td class="n ${ml !== null && ml < 3 ? 'sk-low' : ''}">${mlTxt(ml)}${sq ? `<span class="sk-fam">${E(sq)}</span>` : ''}</td><td>${spark(r)}</td><td class="sk-nw">${day(lastD.get(r.id))}</td></tr>`;
    }).join('');
    return `<details class="sk-cat" data-cat="${E(cat)}" ${cat === open ? 'open' : ''}><summary><span class="sk-t">${E(NAMES[cat] || cat)}</span><span class="sk-m">${rs.length} item${rs.length !== 1 ? 's' : ''} · ${num(units, 0)} on hand${wine ? ` · ${num(gal, 0)} gal` : ''}${neg ? ` · <span class="sk-neg">${neg} below zero</span>` : ''}</span></summary>
<div class="sk-tw"><table>${'<thead>' + head + '</thead>'}<tbody>${body}</tbody></table></div></details>`;
  }).join('') + (asof >= today() && retired.length ? `<details class="sk-cat" data-cat="Retired"><summary><span class="sk-t">Retired</span><span class="sk-m">${retired.length} items no longer on the shelves · history kept, still counted on the TTB report · open one to un-retire</span></summary>
<div class="sk-tw"><table><thead><tr><th>Item</th><th>Description</th><th>Category</th><th class="n">On hand</th><th>Last movement</th></tr></thead><tbody>${retired.map(r => `<tr data-s="${E((r.code + ' ' + (r.description || '') + ' ' + (r.name || '')).toLowerCase())}"><td><a href="/item/${r.id}">${E(r.code)}</a></td><td>${E(r.description || r.name || '')}</td><td>${E(NAMES[r.category] || r.category || (r.is_finished ? 'Bottled & canned wine' : ''))}</td><td class="n ${Math.abs(r.q) > 1e-6 ? 'sk-neg' : ''}">${num(r.q, r.q % 1 ? 2 : 0)}</td><td class="sk-nw">${day(r.last)}</td></tr>`).join('')}</tbody></table></div></details>` : '');
  const body = `<h1>Stock on hand</h1><form class="f sk-f"><label>As of<input type="date" name="date" value="${E(asof)}"></label><button>Show</button>
<input id="skq" placeholder="Find a wine or item" autocomplete="off" oninput="skf(this.value)"> <a href="/stock.csv?date=${E(asof)}">Download CSV</a> · <a href="/record/dispatch">＋ New dispatch</a> · <a href="/dispatches">Dispatches</a></form>
<p class="sub">Click a category to open it, a wine for its stock chart and history (and to adjust its count or retire it). Wine's pace = every vintage of that wine and size: bottles dispatched in the last 12 months (all dispatch types) ÷ the months it was actually in stock, so a new release or a wine that sold out is judged only on its time on the shelf. Months left assumes the older vintage sells first and the next picks up when it runs out.</p>${secs}
<script>function skf(t){t=t.toLowerCase().trim();document.querySelectorAll('.sk-cat').forEach(function(d){var n=0;d.querySelectorAll('tbody tr').forEach(function(r){var on=!t||r.dataset.s.indexOf(t)>=0;r.style.display=on?'':'none';if(on)n++});if(t)d.open=n>0;d.style.display=t&&!n?'none':''})}</script>
<style>.sk-f{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}.sk-f #skq{min-width:220px}
.sk-cat{border:1px solid var(--line);border-radius:8px;margin:10px 0;background:var(--card)}.sk-cat>summary{cursor:pointer;padding:10px 14px;display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline;list-style:none}
.sk-cat>summary::-webkit-details-marker{display:none}.sk-cat>summary::before{content:'▸';color:var(--mut);margin-right:2px}.sk-cat[open]>summary::before{content:'▾'}
.sk-t{font-size:16px;font-weight:700;color:var(--fg2)}.sk-m{color:var(--mut);font-size:13px}.sk-tw{overflow-x:auto;padding:0 8px 8px}.sk-tw table{width:100%}.sk-tw thead th{position:static!important}.sk-nw{white-space:nowrap}
.sk-cl{display:inline-block;font-size:12px;padding:1px 7px;border-radius:9px;border:1px solid var(--line2);color:var(--fg);white-space:nowrap}
.sk-neg{color:#f85149}.sk-low{color:#f0b84a;font-weight:600}.sk-sp{color:#58a6ff;display:block}.sk-fam{display:block;font-size:11.5px;font-weight:400;color:var(--mut);white-space:nowrap}</style>`;
  return page('Stock', body, '/stock');
}

export function p_item(c, iid, q, msg = '') {
  const it = c.one('SELECT * FROM stock_item WHERE id=?', iid);
  if (!it) return null;
  const ev = c.all('SELECT id, occurred_at t, action, quantity v, dispatch_id, op_id, notes FROM stock_event WHERE item_id=? ORDER BY occurred_at, id', iid);
  // dispatch details: by dispatch id (tracker entries) or by time + quantity (Vintrace-era events)
  const dl = c.all('SELECT d.id, d.occurred_at t, d.bol, d.dispatch_type ty, d.reversed, dl.quantity q FROM dispatch_line dl JOIN dispatch d ON d.id=dl.dispatch_id WHERE dl.item_id=?', iid);
  const byId = new Map(dl.map(x => [x.id, x])), byT = new Map();
  for (const x of dl) { const k = x.t + '|' + x.q; if (!byT.has(k)) byT.set(k, []); byT.get(k).push(x); }
  const bat = new Map(c.all(`SELECT ov.op_id, b.code, b.id FROM op_vessel ov JOIN batch b ON b.id=ov.batch_id WHERE ov.op_id IN (SELECT op_id FROM stock_event WHERE item_id=? AND action='Package' AND op_id IS NOT NULL)`, iid).map(r => [r.op_id, r]));
  const batT = package_batches_by_time(c, iid);
  let bal = 0;
  const rows = ev.map(e => {
    bal += e.v;
    let what = e.action, link = '', ty = '';
    if (e.action === 'Dispatch') {
      const d = (e.dispatch_id && byId.get(e.dispatch_id)) || ((byT.get(e.t + '|' + (-e.v)) || []).shift());
      if (d) { ty = d.ty || ''; what = d.ty || 'Dispatch'; link = `<a href="/dispatch/${d.id}">BOL ${E(d.bol)}</a>`; }
    } else if (e.action === 'Package') {
      const b = bat.get(e.op_id) || (e.op_id ? null : batT.get(e.t)); what = 'Bottled'; if (b) link = `from <a href="/batch/${b.id}">${E(b.code)}</a>`;
    } else if (e.action === 'Receive') what = 'Received';
    else if (e.action === 'Adjustment') what = 'Count / adjustment';
    else if (e.action === 'Correction') what = 'Records correction';
    if ((e.action === 'Adjustment' || e.action === 'Correction') && e.notes) link = `<span class="muted">${E(e.notes)}</span>`;
    else if (e.action === 'Create') what = 'Opening stock';
    return { t: e.t, v: e.v, bal, what, link, ty, op: e.op_id };
  });
  const now = bal, y0 = addDays(today(), -365);
  const outY = -rows.filter(r => r.t >= y0 && r.v < 0 && r.what !== 'Count / adjustment' && r.what !== 'Records correction' && r.what !== 'Bottled').reduce((s, r) => s + r.v, 0);
  const lastPack = rows.filter(r => r.what === 'Bottled').pop();
  const PI = it.is_finished ? plan(c).get(+iid) : null;
  const ml = PI ? PI.ml : outY > 0 ? now / (outY / 12) : null, pace = PI ? PI.pace : outY / 12, sqI = PI ? seq(PI) : '';
  const wine = !!it.is_finished;
  const unitW = wine ? (it.litres_per_unit >= 19 ? 'kegs' : 'bottles') : (it.unit === 'x1' ? 'each' : it.unit || '');
  const types = [...new Set(rows.filter(r => r.t >= y0 && r.ty).map(r => r.ty))];
  const byType = types.map(t => [t, -rows.filter(r => r.t >= y0 && r.ty === t).reduce((s, r) => s + r.v, 0)]).sort((a, b) => b[1] - a[1]);
  const showAll = (q.all || [''])[0] === '1';
  const hist = rows.slice().reverse().filter(r => showAll || r.t >= y0);
  const data = rows.map(r => [r.t.slice(0, 16), Math.round(r.bal * 100) / 100, Math.round(r.v * 100) / 100, r.what]);
  const tiles = [['On hand', `${num(now, now % 1 ? 2 : 0)}`, unitW + (wine && it.litres_per_unit ? ` · ${num(now * it.litres_per_unit / GAL, 1)} gal` : '')],
    [PI && PI.since ? `Out since ${day(PI.since)}` : 'Out, last 12 months', num(outY, 0), byType.slice(0, 3).map(([t, n]) => `${num(n, 0)} ${E(t)}`).join(' · ') || '—'],
    ['Months left' + HELP('stock'), ml === null ? '—' : ml > 60 ? '60+' : num(ml, 1), ml === null ? (now > 0 ? 'no dispatches in 12 months' : '') : `at ${num(pace, pace < 10 ? 1 : 0)} a month${PI && PI.months < 11.5 ? ` over ${basis(PI.months)} in stock` : ''}${PI && PI.shared ? ` (${E(PI.members.join(' + '))})` : ''}${sqI ? ` · ${E(sqI)}` : ''}`],
    ['Last bottled', lastPack ? day(lastPack.t) : '—', lastPack ? `${num(lastPack.v, 0)} ${unitW}` : '']];
  const body = `<h1>${E(it.code)} <span class="muted" style="font-weight:400">${E(it.description || it.name || '')}</span></h1>
<p class="sub">${E(it.category || '')}${it.tax_class ? ` · ${cpill(it.tax_class)}` : ''}${it.litres_per_unit ? ` · ${E(size(it.litres_per_unit, it.unit))}` : ''}${it.unit_cost !== null && it.unit_cost !== undefined ? ` · unit cost $${num(it.unit_cost, 2)}` : ''} · <a href="/stock">all stock</a> · <a href="/record/dispatch">＋ New dispatch</a> · <a href="/record/stock?item_id=${iid}">Receive</a></p>
${msg}${adjBox(c, it, now, wine, q)}
<div class="it-tiles">${tiles.map(([k, v, s]) => `<div><span>${k}</span><b>${v}</b><em>${s}</em></div>`).join('')}</div>
<div class="it-card"><div class="it-h"><b>Stock on hand</b><span class="it-rng" id="itr"><button data-m="12" class="on">12 months</button><button data-m="36">3 years</button><button data-m="0">All</button></span></div><div id="itc"></div></div>
${cellar_notes(c, iid, ev, bat, batT)}
<h2>History ${showAll ? '(all)' : '(last 12 months)'} <a style="font-size:13px;font-weight:400" href="/item/${iid}${showAll ? '' : '?all=1'}">${showAll ? 'last 12 months only' : `show all ${rows.length}`}</a></h2>
<div class="sk-tw"><table><thead><tr><th>Date</th><th>What</th><th></th><th class="n">In / out</th><th class="n">On hand after</th></tr></thead><tbody>
${hist.map(r => `<tr><td class="sk-nw">${E(r.t.slice(0, 10))}</td><td>${E(r.what)}</td><td>${r.link}</td><td class="n ${r.v < 0 ? 'it-out' : 'it-in'}">${r.v > 0 ? '+' : ''}${num(r.v, r.v % 1 ? 2 : 0)}</td><td class="n">${num(r.bal, r.bal % 1 ? 2 : 0)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing in the last 12 months</td></tr>'}</tbody></table></div>
<div id="itt" class="it-tip" hidden></div>
<script>window.ITD=${JSON.stringify({ d: data, u: unitW }).replace(/</g, '\\u003c')};</script><script>${CHART}</script>
<style>.it-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:10px 0 14px}.it-tiles div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.it-tiles span{display:block;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}.it-tiles b{display:block;font-size:26px;color:var(--fg2);margin:2px 0}.it-tiles em{font-style:normal;font-size:12.5px;color:var(--mut)}
.it-card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px 6px}.it-h{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.it-h b{color:var(--fg2)}
.it-rng button{background:none;border:1px solid var(--line2);color:var(--mut);padding:4px 10px;font-size:12.5px;cursor:pointer;width:auto;margin:0 0 0 -1px}.it-rng button:first-child{border-radius:6px 0 0 6px}.it-rng button:last-child{border-radius:0 6px 6px 0}.it-rng button.on{background:var(--line2);color:var(--fg2)}
#itc svg{display:block;width:100%}#itc text{fill:var(--mut);font-size:11px}.it-out{color:#f0883e}.it-in{color:#3fb950}
.it-tip{position:fixed;z-index:50;background:#0d1117;border:1px solid var(--line2);border-radius:6px;padding:7px 10px;font-size:12.5px;color:var(--fg2);pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.5)}
.sk-cl{display:inline-block;font-size:12px;padding:1px 7px;border-radius:9px;border:1px solid var(--line2);color:var(--fg);white-space:nowrap}.sk-tw{overflow-x:auto}.sk-tw thead th{position:static!important}</style>`;
  return page(it.code, body, '/stock', [['Stock', '/stock'], [it.code, null]]);
}

// v1.32 — retired banner / retire button, and the Adjust on hand box
function adjBox(c, it, now, wine, q) {
  const iid = it.id, T = `<input type="hidden" name="_t" value="${E(ctx.token)}">`, sv = String((q.saved || [''])[0] || '');
  const ok = sv === 'retired' ? `<div class="ok">Saved — ${E(it.code)} is retired.</div>` : sv === 'active' ? `<div class="ok">${E(it.code)} is back on the Stock list.</div>` : sv ? '<div class="ok">Saved.</div>' : '';
  const zero = Math.abs(now) < 1e-6;
  const status = it.inactive
    ? `<div class="it-ret"><b>Retired</b> — not on the Stock list or in the dispatch and bottling pickers. Its history stays here and still counts on the TTB report.
<form method="post" action="/item/${iid}/status">${T}<input type="hidden" name="status" value="active"><button>Un-retire</button></form></div>`
    : zero ? `<div class="it-ret it-ret0">On hand is zero. <form method="post" action="/item/${iid}/status">${T}<input type="hidden" name="status" value="retired"><button>Retire — no longer on the shelves</button></form></div>` : '';
  const dts = wine ? c.all('SELECT name, ttb_line FROM dispatch_type WHERE active=1 ORDER BY sort') : [];
  const ln = l => String(l || '').replace(/^B/, '');
  const opts = dts.map(t => `<option value="d:${E(t.name)}" ${t.name === 'Family Use' ? 'selected' : ''}>Dispatch — ${E(t.name)} (TTB line ${E(ln(t.ttb_line))})</option>`).join('')
    + `<option value="count" ${wine ? '' : 'selected'}>Count — inventory ${wine ? 'loss or gain (TTB line 19 or 5)' : 'loss or gain'}</option>`
    + '<option value="correction">Records correction — on no TTB line (note required)</option>';
  const adj = it.inactive && zero ? '' : `<details class="it-adj"${zero ? '' : ' open'}><summary><b>Adjust on hand</b> <span class="muted">set the count, zero it out, retire it</span>${HELP('stock')}</summary>
<form method="post" action="/item/${iid}/adjust" class="f it-af">${T}
<label>Date<input type="date" name="date" value="${today()}" max="${today()}"></label>
<label>On hand should be<input name="qty" inputmode="decimal" size="7" value="0" required></label><span class="muted it-now">now ${num(now, now % 1 ? 2 : 0)}</span>
<label>Book the difference as<select name="how">${opts}</select></label>
<label class="it-wide">Note<input name="notes" size="44" placeholder="e.g. aged out · off bottles · two codes for one vintage"></label>
<label class="chk"><input type="checkbox" name="retire" value="1" checked> Retire it if this leaves it at zero</label>
<button>Save</button></form></details>`;
  return ok + status + adj + `<style>.it-ret{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;background:var(--card);border:1px solid #9e6a03;border-radius:8px;padding:8px 12px;margin:8px 0}
.it-ret0{border-color:var(--line)}.it-ret form{margin:0}.it-ret button{width:auto;margin:0;padding:4px 12px}
.it-adj{background:var(--card);border:1px solid var(--line);border-radius:8px;margin:8px 0 12px}.it-adj>summary{cursor:pointer;padding:8px 12px}.it-adj>summary b{color:var(--fg2)}
.it-af{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:flex-end;padding:0 12px 12px}.it-af button{width:auto}.it-now{padding-bottom:8px}.it-af .chk{flex-direction:row;align-items:center;gap:6px}</style>`;
}

// POST /item/<id>/adjust and /item/<id>/status. e2 = entry2.js, captured = correct.captured (keeps the entry correctable).
export function post_item(c, iid, action, f, e2, captured) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]) : '');
  const it = c.one('SELECT id, code, inactive FROM stock_item WHERE id=?', iid);
  if (!it) return [null, 'No such stock item.'];
  const bal = () => c.val('SELECT COALESCE(SUM(quantity),0) FROM stock_event WHERE item_id=?', iid) || 0;
  if (action === 'status') {
    if (g('status') === 'retired') {
      const b = bal();
      if (Math.abs(b) > 1e-6) return [null, `${it.code} still shows ${num(b, b % 1 ? 2 : 0)} on hand — set it to zero first (Adjust on hand).`];
      c.run('UPDATE stock_item SET inactive=1 WHERE id=?', iid);
      return [`/item/${iid}?saved=retired`, null];
    }
    c.run('UPDATE stock_item SET inactive=0 WHERE id=?', iid);
    return [`/item/${iid}?saved=active`, null];
  }
  const date = g('date') || today();
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return [null, 'Pick a date.'];
  const when = `${date} ${date === today() ? nowIso().slice(11, 16) : '12:00'}`;
  const how = g('how'), notes = g('notes').trim();
  if (g('qty').trim() === '' || !Number.isFinite(Number(g('qty')))) return [null, 'Enter what should be on hand.'];
  const target = Number(g('qty'));
  let url = `/item/${iid}?saved=1`;
  if (how.startsWith('d:')) {
    const out = e2.on_hand(c, iid, when) - target;
    if (out < 1e-9) return [null, 'A dispatch can only take stock out — for a gain use Count.'];
    if (Math.abs(out - Math.round(out)) > 1e-9) return [null, `That would dispatch ${num(out, 2)} — a dispatch takes whole bottles or cans.`];
    const form = { when: [when], dispatch_type: [how.slice(2)], destination: [''], bol: [''], it: [String(iid)], iq: [String(Math.round(out))], notes: [notes] };
    captured(c, '/record/dispatch', form, () => { e2.record_dispatch(c, when, how.slice(2), '', '', [[String(iid), String(Math.round(out))]], notes || null, false); return [url, null]; });
  } else if (how === 'count' || how === 'correction') {
    const form = { when: [when], item_id: [String(iid)], mode: [how], qty: [String(target)], notes: [notes] };
    captured(c, '/record/stock', form, () => { e2.record_stock(c, when, iid, how, String(target), notes || null); return [url, null]; });
  } else return [null, 'Pick how to book the difference.'];
  if (g('retire') && Math.abs(bal()) < 1e-6) { c.run('UPDATE stock_item SET inactive=1 WHERE id=?', iid); url = `/item/${iid}?saved=retired`; }
  return [url, null];
}

// step chart of stock on hand; dots where it moved; hover shows the date, what happened and the balance (no backticks/dollar-brace inside)
const CHART = `(function(){var D=window.ITD,box=document.getElementById('itc'),tip=document.getElementById('itt'),NS='http://www.w3.org/2000/svg',m=12;
function P(s){return Date.parse(s.replace(' ','T')+':00Z')}
function el(n,a,p){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
function fmt(v){return Math.abs(v%1)>0?v.toFixed(2):String(Math.round(v))}
var MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function draw(){box.innerHTML='';var now=Date.now(),t0=m?now-m*30.4375*864e5:(D.d.length?P(D.d[0][0]):now-864e5),pts=[],start=0;
  D.d.forEach(function(r){var t=P(r[0]);if(t<t0)start=r[1];else pts.push([t,r[1],r[2],r[3],r[0]])});
  var W=Math.max(320,box.clientWidth),H=230,ml=46,mr=12,mt=10,mb=26,x=function(t){return ml+(t-t0)/(now-t0)*(W-ml-mr)};
  var vals=[start].concat(pts.map(function(p){return p[1]})),mx=Math.max.apply(null,vals.concat([1])),mn=Math.min.apply(null,vals.concat([0]));
  var y=function(v){return mt+(mx-v)/(mx-mn||1)*(H-mt-mb)};var svg=el('svg',{viewBox:'0 0 '+W+' '+H,height:H},box);
  var st=Math.pow(10,Math.floor(Math.log10((mx-mn)/4||1)));[1,2,5,10].some(function(k){if((mx-mn)/(st*k)<=5){st*=k;return true}});
  for(var g=Math.ceil(mn/st)*st;g<=mx+1e-9;g+=st){el('line',{x1:ml,x2:W-mr,y1:y(g),y2:y(g),stroke:'#21262d'},svg);var tx=el('text',{x:ml-6,y:y(g)+4,'text-anchor':'end'},svg);tx.textContent=fmt(g)}
  if(mn<0)el('line',{x1:ml,x2:W-mr,y1:y(0),y2:y(0),stroke:'#8b949e','stroke-dasharray':'3 3'},svg);
  var d0=new Date(t0),step=m&&m<=12?1:m&&m<=36?3:Math.max(3,Math.ceil((now-t0)/864e5/30/10)),mm=new Date(Date.UTC(d0.getUTCFullYear(),d0.getUTCMonth()+1,1)),last=-99;
  for(;mm.getTime()<now;mm=new Date(Date.UTC(mm.getUTCFullYear(),mm.getUTCMonth()+step,1))){var xx=x(mm.getTime());if(xx-last<34)continue;last=xx;var t2=el('text',{x:xx,y:H-8,'text-anchor':'middle'},svg);t2.textContent=MO[mm.getUTCMonth()]+(mm.getUTCMonth()===0||step>1?" '"+String(mm.getUTCFullYear()).slice(2):'');el('line',{x1:xx,x2:xx,y1:H-mb,y2:H-mb+4,stroke:'#30363d'},svg)}
  var p='M'+x(t0)+','+y(start),cur=start;pts.forEach(function(q){p+='H'+x(q[0])+'V'+y(q[1]);cur=q[1]});p+='H'+x(now);
  el('path',{d:p+'V'+y(Math.max(mn,0))+'H'+x(t0)+'Z',fill:'rgba(88,166,255,.10)'},svg);el('path',{d:p,fill:'none',stroke:'#58a6ff','stroke-width':2,'stroke-linejoin':'round'},svg);
  var dots=pts.map(function(q){return el('circle',{cx:x(q[0]),cy:y(q[1]),r:3.5,fill:q[2]<0?'#f0883e':'#3fb950',stroke:'#161b22','stroke-width':1.5},svg)});
  var hl=el('line',{y1:mt,y2:H-mb,stroke:'#8b949e',opacity:0},svg),hit=el('rect',{x:ml,y:0,width:W-ml-mr,height:H,fill:'transparent'},svg);
  function mv(ev){var r=svg.getBoundingClientRect(),px=(ev.clientX-r.left)*W/r.width,best=-1,bd=1e9;pts.forEach(function(q,i){var dd=Math.abs(x(q[0])-px);if(dd<bd){bd=dd;best=i}});
    if(best<0||bd>40){tip.hidden=true;hl.setAttribute('opacity',0);return}var q=pts[best];hl.setAttribute('x1',x(q[0]));hl.setAttribute('x2',x(q[0]));hl.setAttribute('opacity',.5);
    var same=pts.filter(function(z){return z[4].slice(0,10)===q[4].slice(0,10)});
    tip.innerHTML='<b>'+q[4].slice(0,10)+'</b><br>'+same.map(function(z){return z[3]+' <b style="color:'+(z[2]<0?'#f0883e':'#3fb950')+'">'+(z[2]>0?'+':'')+fmt(z[2])+'</b>'}).join('<br>')+'<br>on hand after: <b>'+fmt(same[same.length-1][1])+'</b> '+D.u;
    tip.hidden=false;var w=tip.offsetWidth,xx=ev.clientX+14;if(xx+w>innerWidth-8)xx=ev.clientX-w-14;tip.style.left=xx+'px';tip.style.top=(ev.clientY+14)+'px'}
  hit.addEventListener('mousemove',mv);hit.addEventListener('pointerdown',mv);hit.addEventListener('mouseleave',function(){tip.hidden=true;hl.setAttribute('opacity',0)});
  if(!pts.length){var nt=el('text',{x:W/2,y:H/2,'text-anchor':'middle'},svg);nt.textContent='No movements in this period — on hand '+fmt(start)}}
document.getElementById('itr').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;m=+b.dataset.m;this.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});draw()});
var rt;addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(draw,150)});draw()})()`;

// v1.54: the cellar notes behind a bottled product — Vintrace kept notes on the bulk wine; here they come from the batch(es)
// each bottling run was packaged from (op_id, or the Packaging operation at the same time for Vintrace-era runs),
// including notes carried in from wines blended or racked into that batch. Latest bottling's batch opens first.
function cellar_notes(c, iid, ev, bat, batT) {
  const src = new Map();
  for (const e of ev) {
    if (e.action !== 'Package' || e.v <= 0) continue;
    const b = bat.get(e.op_id) || (e.op_id ? null : batT.get(e.t));
    if (!b) continue;
    const x = src.get(b.id) || { id: b.id, code: b.code, n: 0, d: [] };
    x.n += e.v; x.d.push(e.t.slice(0, 10)); src.set(b.id, x);
  }
  if (!src.size) return '';
  const list = [...src.values()].sort((a, b) => (a.d[a.d.length - 1] < b.d[b.d.length - 1] ? 1 : -1));
  const blocks = list.map((x, k) => {
    const b = c.one('SELECT description FROM batch WHERE id=?', x.id) || {};
    const ns = notes.for_batch(c, x.id), own = ns.filter(n => n.batch_id == x.id).length;
    let made = '';
    try {
      const bs = blend_sources(c, x.id).filter(r => r.depth === 1 && r.on).sort((p, q) => q.L - p.L);   // ≥10% of what went in (topping wine left out)
      if (bs.length) made = `<div class="it-made">Blended in: ${bs.map(r => `<a href="/batch/${r.bid}">${E(r.code)}</a> ${num(r.L, 0)} L`).join(' · ')}</div>`;
    } catch (e) { /* no transfer history */ }
    const d1 = x.d[0], d2 = x.d[x.d.length - 1];
    return `<details class="it-src"${k === 0 ? ' open' : ''}><summary><b><a href="/batch/${x.id}">${E(x.code)}</a></b> <span class="muted">${E(b.description || '')}</span> · bottled ${num(x.n, 0)} ${d1 === d2 ? `on ${E(d1)}` : `${E(d1)} to ${E(d2)}`} · <b>${ns.length} note${ns.length === 1 ? '' : 's'}</b>${ns.length > own ? ` <span class="muted">(${own} on ${E(x.code)}, ${ns.length - own} carried in from wines blended or racked into it)</span>` : ''} · <a href="/batch/${x.id}?tab=notes">notes tab</a> · <a href="/batch/${x.id}?tab=lab">lab</a></summary>
${made}${ns.length ? `<div class="ncards it-notes">${ns.map(n => hw_ui.note_card(n, x.id)).join('')}</div>` : '<p class="muted">No notes on this batch.</p>'}</details>`;
  }).join('');
  return `<h2>Cellar notes <span class="muted" style="font-size:13px;font-weight:400">the bulk wine that went into these bottles — latest notes first</span></h2>${blocks}
<style>.it-src{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin:0 0 10px}.it-src>summary{cursor:pointer;line-height:1.6}.it-made{font-size:13px;color:var(--mut);margin:6px 0 4px}.it-notes{max-height:560px;overflow-y:auto;margin-top:8px}</style>`;
}
