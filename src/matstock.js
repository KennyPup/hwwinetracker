// Materials page: the materials in use first (every tracked one, zero included) (each material's stock item balance: receipts + counts − additions), then the
// per-year usage history below the fold. Count / receive is allowed in the real copy too (supplies on hand are not TTB wine),
// so Ken can correct Vintrace's figures before cutover. A material with no stock item gets one on its first count/receipt.
import { E, num, qv, today, nowIso } from './lib/py.js';
import { page, table, link, ctx } from './core.js';
import * as e2 from './entry2.js';
import { STOCK_UNIT_PER_BASE } from './entry.js';
import { captured } from './correct.js';

const RANK = { honey: 0, sugar: 1, yeast: 2, nutrient: 3, enzyme: 4, sulfite: 5, sorbate: 6, acid: 7, fining: 8, bacteria: 9, oak: 10 };
const rk = k => (k in RANK ? RANK[k] : 50);
const UNITS_FOR = { kg: ['kg', 'lb', 'g'], L: ['L', 'ml'], units: ['units'] };
const trim = s => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
export function qfmt(q, unit) {
  const d = unit === 'g' || unit === 'ml' || unit === 'units' ? 0 : Math.abs(q) < 10 ? 2 : 1;
  let s = `${trim(num(q, d))} ${E(unit)}`;
  if (unit === 'lb') s += ` <span class="muted">(${trim(num(q * 0.45359237, 1))} kg)</span>`;
  if (unit === 'kg' && q) s += ` <span class="muted">(${trim(num(q / 0.45359237, 1))} lb)</span>`;
  return s;
}

export function ensure_schema(c) {
  if (!c.val("SELECT 1 FROM sqlite_master WHERE name='material'")) return;
  if (!c.columns('material').includes('retired')) c.run('ALTER TABLE material ADD COLUMN retired INTEGER NOT NULL DEFAULT 0');
}
const KINDS = ['acid', 'bacteria', 'enzyme', 'fining', 'honey', 'nutrient', 'oak', 'sorbate', 'sugar', 'sulfite', 'tannin', 'yeast', 'other'];
const PART_IV = [['', '—'], ['sugar_dry', 'Sugar (dry)'], ['others', 'Other (e.g. honey)']];

function rows(c) {
  return c.all(`SELECT m.id, m.name, m.kind, m.base_unit, m.retired, m.stock_item_id sid, s.unit su,
      (SELECT COALESCE(SUM(quantity),0) FROM stock_event e WHERE e.item_id=s.id) q,
      (SELECT MAX(occurred_at) FROM stock_event e WHERE e.item_id=s.id AND e.action IN ('Adjustment','Receive','Count')) lc,
      (SELECT MAX(occurred_at) FROM stock_event e WHERE e.item_id=s.id AND e.quantity<0 AND e.action NOT IN ('Adjustment','Count')) lu,
      (SELECT MAX(o.occurred_at) FROM op_addition a JOIN operation o ON o.id=a.op_id WHERE a.material_id=m.id AND o.reversed=0) la
    FROM material m LEFT JOIN stock_item s ON s.id=m.stock_item_id`);
}
const d10 = s => (s ? E(String(s).slice(0, 10)) : '');
const sortm = (a, b) => rk(a.kind) - rk(b.kind) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.name.localeCompare(b.name);

export function p_materials(c, q, token, msg = '') {
  ensure_schema(c);
  const every = rows(c).sort(sortm);
  const all = every.filter(r => !r.retired), retired = every.filter(r => r.retired);
  // v1.44 (Ken, 2026-10-13: honey zeroed out and vanished from the list) — one list of the materials in use: every tracked
  // material whatever its stock (zero = out, below zero = needs a count), plus untracked ones added to wine in the last two
  // years. Sort by In stock to see what is out. Untracked materials not used for two years are listed under the table.
  const cut = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
  const inUse = all.filter(r => r.sid || (r.kind !== 'water' && r.la && r.la >= cut));
  const idle = all.filter(r => !r.sid && r.kind !== 'water' && !(r.la && r.la >= cut));
  const act = r => `<a href="/material/${r.id}">${r.sid ? 'receive / count' : 'count to start'}</a>`;
  const st = r => !r.sid ? ['<span class="muted">not tracked</span>', '']
    : r.q < -1e-6 ? [`<span style="color:var(--red,#f85149)">${qfmt(r.q, r.su)}</span>`, r.q]
    : Math.abs(r.q) <= 1e-6 ? [`<b style="color:#f0883e">0 ${E(r.su)}</b>`, 0] : [qfmt(r.q, r.su), r.q];
  const tag = r => !r.sid ? '<span class="muted">count to start tracking</span>' : r.q < -1e-6 ? '<span style="color:var(--red,#f85149)">count needed</span>' : Math.abs(r.q) <= 1e-6 ? '<span class="tag" style="color:#f0883e;border-color:#f0883e">out</span>' : '';
  const T = rs => `<table><thead><tr><th>Material</th><th>Kind</th><th class="n">In stock</th><th>Status</th><th>Last count / receipt</th><th>Last used</th><th></th></tr></thead><tbody>${rs.map(r => {
      const [h, v] = st(r);
      return `<tr><td>${link(`/material/${r.id}`, r.name)}</td><td>${E(r.kind)}</td><td class="n" data-v="${v}">${h}</td><td>${tag(r)}</td><td>${d10(r.lc)}</td><td data-v="${E(String(r.lu || r.la || ''))}">${d10(r.lu || r.la)}</td><td>${act(r)}</td></tr>`;
    }).join('') || '<tr><td colspan=99 class=muted>No records</td></tr>'}</tbody></table>`;
  const nOut = inUse.filter(r => r.sid && Math.abs(r.q) <= 1e-6).length, nNeg = inUse.filter(r => r.sid && r.q < -1e-6).length;
  let top = `<h2>Materials in use</h2><p class="muted" style="margin-top:-4px">${inUse.length} materials${nOut ? ` · <b style="color:#f0883e">${nOut} out</b>` : ''}${nNeg ? ` · <span style="color:var(--red,#f85149)">${nNeg} below zero — more was used than was received or counted; count what is on the shelf</span>` : ''}. Sort by In stock (click it twice) to put what is out at the top.</p>` + T(inUse);
  top += `<p style="margin-top:12px"><a class="btn" href="/materials/new">＋ New material</a></p>`;
  if (idle.length) top += `<p class="muted" style="margin-top:12px">Not tracked and not used in the last two years: ${idle.map(r => `<a href="/material/${r.id}">${E(r.name)}</a>`).join(', ')} — a first count or receipt starts tracking it; retire any you no longer use.</p>`;
  if (retired.length) top += `<details style="margin-top:8px"><summary class="muted">Retired — hidden from lists and the additions form (${retired.length})</summary><p>${retired.map(r => link(`/material/${r.id}`, r.name)).join(' · ')}</p></details>`;
  const note = ctx.mode === 'readonly' ? '<p class="muted" style="margin-top:-4px">Real records before cutover: additions made in Vintrace are not subtracted here, so counts drift until additions are recorded in HWWineTracker.</p>' : '';

  // usage history (per year), below the fold
  const hr = c.all(`SELECT m.id, m.name, m.kind, m.base_unit, m.ttb_part_iv, substr(o.occurred_at,1,4) y, SUM(a.amount_base) s
                    FROM material m LEFT JOIN op_addition a ON a.material_id=m.id LEFT JOIN operation o ON o.id=a.op_id GROUP BY m.id, y`);
  const ys = [...new Set(hr.filter(r => r.y).map(r => r.y))].sort();
  const mats = new Map();
  for (const r of hr) { if (!mats.has(r.id)) mats.set(r.id, { r, y: new Map() }); mats.get(r.id).y.set(r.y, r.s); }
  const order = [...mats.values()].sort((a, b) => rk(a.r.kind) - rk(b.r.kind) || a.r.name.localeCompare(b.r.name));
  const ht = table(['Material', 'Kind', 'Unit', 'Part IV', ...ys], order.map(m => [link(`/material/${m.r.id}`, m.r.name), E(m.r.kind), E(m.r.base_unit), E(m.r.ttb_part_iv || ''),
    ...ys.map(y => num(m.y.get(y), 1))]), ys.map((_, i) => 4 + i));

  return page('Materials', `<h1>Materials</h1>${msg}<p class="sub">Supplies on hand: receipts and counts, less what additions used. Open a material to receive, count or edit it.</p>${note}${top}
    <details style="margin-top:24px"><summary class="muted">Amounts added to wine per year (base units kg, L)</summary>${ht}</details>`, '/materials');
}

const sel = (name, cur, items) => `<select name="${name}">${items.map(([v, t]) => `<option value="${E(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${E(t)}</option>`).join('')}</select>`;
const kindField = cur => `<label>Kind<input name="kind" list="kinds" size="12" value="${E(cur || '')}" required><datalist id="kinds">${KINDS.map(k => `<option value="${k}">`).join('')}</datalist></label>`;

// one material: stock on hand, receive / count, edit details, stock history, additions
export function p_material(c, mid, q, token, err = '', f = {}) {
  ensure_schema(c);
  const m = c.one('SELECT m.*, s.unit su, s.code FROM material m LEFT JOIN stock_item s ON s.id=m.stock_item_id WHERE m.id=?', mid);
  if (!m) return null;
  const qty = m.stock_item_id ? e2.on_hand(c, m.stock_item_id) : null;
  const uo = m.stock_item_id ? `<label>Unit<input value="${E(m.su)}" size="5" disabled></label>`
    : `<label>Unit (stock is kept in this)<select name="unit">${(UNITS_FOR[m.base_unit] || ['kg']).map(u => `<option ${u === f.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>`;
  const mode = f.mode || 'receive';
  const stockForm = `<form class="entry" method="post" action="/materials/stock"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="m" value="${m.id}">
      <label>What<select name="mode"><option value="receive" ${mode === 'receive' ? 'selected' : ''}>Received — a delivery to add</option><option value="count" ${mode === 'count' ? 'selected' : ''}>Count — set to what is on the shelf now</option></select></label>
      <label>Amount<input name="qty" inputmode="decimal" required size="8" value="${E(f.qty || '')}"></label>${uo}
      <label>Date<input type="date" name="date" value="${E(f.date || today())}"></label><label class="wide">Note (supplier, lot, cost…)<input name="notes" size="40" value="${E(f.notes || '')}"></label>
      <div class="actions"><button>Save</button></div></form>`;
  const edit = `<details style="margin-top:18px"${q.edit ? ' open' : ''}><summary class="btn btn2" style="display:inline-block;cursor:pointer">Edit details</summary>
    <form class="entry" method="post" action="/materials/save" style="margin-top:10px"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="id" value="${m.id}">
      <label>Name<input name="name" size="26" required value="${E(m.name)}"></label>${kindField(m.kind)}
      <label>TTB Part IV${sel('ttb_part_iv', m.ttb_part_iv || '', PART_IV)}</label>
      <label class="wide">Notes<input name="notes" size="40" value="${E(m.notes || '')}"></label>
      <label><input type="checkbox" name="retired" value="1" ${m.retired ? 'checked' : ''} style="width:auto"> Retired (hide from lists and the additions form)</label>
      <div class="actions"><button>Save details</button></div></form></details>`;
  let hist = '';
  if (m.stock_item_id) {
    const ev = c.all('SELECT occurred_at, action, quantity, notes FROM stock_event WHERE item_id=? ORDER BY occurred_at, id', m.stock_item_id);
    let bal = 0;
    const rr = ev.map(e => { bal += e.quantity; return [E(e.occurred_at.slice(0, 16)), E(e.action), qfmt(e.quantity, m.su), qfmt(bal, m.su), E(e.notes || '')]; }).reverse();
    hist = '<h2>Stock history</h2>' + table(['When', 'What', 'Qty', 'Balance', 'Note'], rr.slice(0, 40), [2, 3]) + (rr.length > 40 ? `<p>${link('/item/' + m.stock_item_id, `all ${rr.length} entries`)}</p>` : '');
  }
  const adds = c.all(`SELECT o.id, o.occurred_at, b.id bid, b.code bc, v.code vc, a.amount, a.unit, a.amount_base FROM op_addition a JOIN operation o ON o.id=a.op_id
                        LEFT JOIN batch b ON b.id=a.batch_id LEFT JOIN vessel v ON v.id=a.vessel_id WHERE a.material_id=? ORDER BY o.occurred_at DESC`, mid);
  const at = adds.length ? `<details style="margin-top:18px"><summary class="muted">Additions to wine (${adds.length})</summary>` + table(['When', 'Batch', 'Vessel', 'Amount', 'Unit', `In ${E(m.base_unit)}`],
    adds.map(r => [link(`/op/${r.id}`, r.occurred_at.slice(0, 16)), r.bid ? link(`/batch/${r.bid}`, r.bc) : '', E(r.vc), num(r.amount, 3), E(r.unit), num(r.amount_base, 3)]), [3, 5]) + '</details>' : '';
  const body = `<h1>${E(m.name)} <span class="muted">${qty === null ? 'not tracked in stock yet' : qfmt(qty, m.su) + ' in stock'}</span>${m.retired ? ' <span class="tag">retired</span>' : ''}</h1>
    <p class="sub">${E(m.kind)} · base unit ${E(m.base_unit)}${m.ttb_part_iv ? ' · TTB Part IV ' + E(m.ttb_part_iv) : ''}${m.notes ? ' · ' + E(m.notes) : ''}</p>${err}
    <h2>Receive or count</h2>${stockForm}${edit}${hist}${at}`;
  return page(m.name, body, '/materials', [['Materials', '/materials'], [m.name, null]]);
}

export function p_new(c, q, token, err = '', f = {}) {
  ensure_schema(c);
  const body = `<h1>New material</h1>${err}<p class="sub">Anything you add to wine or keep on the shelf: yeast, nutrient, enzyme, acid, fining, oak… It shows in the additions form right away.</p>
    <form class="entry" method="post" action="/materials/save"><input type="hidden" name="_t" value="${E(token)}">
      <label>Name<input name="name" size="26" required value="${E(f.name || '')}" autofocus></label>${kindField(f.kind)}
      <label>Measured as${sel('base_unit', f.base_unit || 'kg', [['kg', 'weight'], ['L', 'volume'], ['units', 'count (units)']])}</label>
      <label>Stock unit${sel('unit', f.unit || 'kg', [['kg', 'kg'], ['lb', 'lb'], ['g', 'g'], ['L', 'L'], ['ml', 'ml'], ['units', 'units']])}</label>
      <label>TTB Part IV${sel('ttb_part_iv', f.ttb_part_iv || '', PART_IV)}</label>
      <label>Amount on hand now (optional)<input name="qty" inputmode="decimal" size="8" value="${E(f.qty || '')}"></label>
      <label class="wide">Notes (supplier…)<input name="notes" size="40" value="${E(f.notes || '')}"></label>
      <div class="actions"><button>Add material</button> <a href="/materials">Cancel</a></div></form>`;
  return page('New material', body, '/materials', [['Materials', '/materials'], ['New material', null]]);
}

export function post_save(c, f) {
  ensure_schema(c);
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  const name = g('name'), kind = g('kind').toLowerCase(), id = Number(g('id') || 0), part = ['sugar_dry', 'others'].includes(g('ttb_part_iv')) ? g('ttb_part_iv') : null;
  if (!name) return [null, 'Name is required.'];
  if (!kind) return [null, 'Kind is required.'];
  if (c.one('SELECT id FROM material WHERE lower(name)=lower(?) AND id<>?', name, id)) return [null, `${name} already exists.`];
  if (id) {
    const m = c.one('SELECT * FROM material WHERE id=?', id);
    if (!m) return [null, 'No such material.'];
    c.run('UPDATE material SET name=?, kind=?, ttb_part_iv=?, notes=?, retired=? WHERE id=?', name, kind, part, g('notes') || null, g('retired') ? 1 : 0, id);
    if (m.stock_item_id) {
      if (name !== m.name && !c.one('SELECT 1 x FROM stock_item WHERE code=? AND id<>?', name, m.stock_item_id)) c.run('UPDATE stock_item SET code=?, name=? WHERE id=?', name, name, m.stock_item_id);
      c.run('UPDATE stock_item SET inactive=? WHERE id=?', g('retired') ? 1 : 0, m.stock_item_id);
    }
    return [`/material/${id}?saved=1`, null];
  }
  const base = ['kg', 'L', 'units'].includes(g('base_unit')) ? g('base_unit') : 'kg';
  const unit = g('unit') || base;
  if (!STOCK_UNIT_PER_BASE[`${base}|${unit}`]) return [null, `Stock unit ${unit} doesn't fit something measured by ${base === 'kg' ? 'weight' : base === 'L' ? 'volume' : 'count'} — pick ${UNITS_FOR[base].join(', ')}.`];
  if (c.one('SELECT 1 x FROM stock_item WHERE code=?', name)) return [null, `A stock item called ${name} already exists.`];
  let x = 0;
  if (g('qty') !== '') {
    x = Number(g('qty').replace(/,/g, ''));
    if (!isFinite(x) || x < 0) return [null, 'Amount on hand: enter a number (0 or more).'];
    if (x > (MAX[unit] || 1e5)) return [null, `${num(x, 0)} ${unit} looks wrong — check the amount and unit.`];
  }
  const mid = c.run('INSERT INTO material(name, kind, base_unit, ttb_part_iv, notes) VALUES (?,?,?,?,?)', name, kind, base, part, g('notes') || null).id;
  const sid = c.run("INSERT INTO stock_item(code, name, description, category, item_type, unit, is_finished, inactive) VALUES (?,?,?,?,?,?,0,0)", name, name, `${kind} — added in HWWineTracker`, 'Additives', 'Additive', unit).id;
  c.run('UPDATE material SET stock_item_id=? WHERE id=?', sid, mid);
  if (x > 0) {
    const form = { when: [`${today()} ${nowIso().slice(11, 16)}`], item_id: [String(sid)], mode: ['count'], qty: [String(x)], notes: ['starting amount'] };
    captured(c, '/record/stock', form, () => { e2.record_stock(c, form.when[0], sid, 'count', form.qty[0], 'starting amount'); return ['ok', null]; });
  }
  return [`/material/${mid}?saved=1`, null];
}

const MAX = { kg: 5000, lb: 11000, g: 5000000, L: 5000, ml: 5000000, units: 10000 };
export function post_stock(c, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  const m = c.one('SELECT * FROM material WHERE id=?', Number(g('m') || 0));
  if (!m) return [null, 'No such material.'];
  const mode = g('mode') === 'receive' ? 'receive' : 'count';
  const date = g('date') || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return [null, 'Date must be a real date, not in the future.'];
  const x = Number(g('qty').replace(/,/g, ''));
  if (g('qty') === '' || !isFinite(x) || x < 0) return [null, 'Amount: enter a number (0 or more).'];
  if (mode === 'receive' && x === 0) return [null, 'A receipt must be more than zero.'];
  let sid = m.stock_item_id, unit;
  if (!sid) {
    unit = g('unit');
    if (!(UNITS_FOR[m.base_unit] || []).includes(unit) || !STOCK_UNIT_PER_BASE[`${m.base_unit}|${unit}`]) return [null, 'Pick a unit.'];
    if (c.one('SELECT 1 x FROM stock_item WHERE code=?', m.name)) return [null, `A stock item called ${m.name} already exists — link it rather than making another.`];
    sid = c.run("INSERT INTO stock_item(code, name, description, category, item_type, unit, is_finished, inactive) VALUES (?,?,?,?,?,?,0,0)", m.name, m.name, `${m.kind} — started in HWWineTracker`, 'Additives', 'Additive', unit).id;
    c.run('UPDATE material SET stock_item_id=? WHERE id=?', sid, m.id);
  } else unit = c.val('SELECT unit FROM stock_item WHERE id=?', sid);
  if (x > (MAX[unit] || 1e5)) return [null, `${num(x, 0)} ${unit} looks wrong — check the amount and unit.`];
  const now = nowIso().slice(11, 16);
  // kept as an ordinary Stock receive/count entry (same saved form), so Correct & replay on the Record page works on it
  const form = { when: [`${date} ${date === today() ? now : '12:00'}`], item_id: [String(sid)], mode: [mode], qty: [String(x)], notes: [g('notes')] };
  return captured(c, '/record/stock', form, () => { e2.record_stock(c, form.when[0], sid, mode, form.qty[0], g('notes') || null); return [`/material/${m.id}?saved=1`, null]; });
}
