// Make this a batch — the formulation is the plan; this screen only turns it into this season's batch.
// No re-planning here: fruit, water and sugar come from the formulation (change them there). It asks for the batch name and date,
// which on-hand lots the fruit comes from, and the vessel; then creates (or continues) the batch, links the formulation,
// takes the fruit off the on-hand list, fills the vessel and records the water and sugar/honey (drawn from Materials stock).
import { E, today, nowIso, thisYear } from './lib/py.js';
import { page } from './core.js';
import * as entry from './entry.js';
import * as e2 from './entry2.js';
import * as onhand from './onhand.js';
import * as F from './formulation.js';
import { captured } from './correct.js';
import { _when_field } from './ui_entry.js';
import { unstarted, started } from './startbatch.js';

const LB = 0.45359237;
const TYPE = { 'Fruit wine': 'Fruit Wine', Mead: 'Mead', Cider: 'Cider' };
const BASE = { Mead: 'honey', Cider: 'juice / cider' };
const g0 = (f, k, d = '') => (f && f[k] !== undefined && f[k] !== null ? String(f[k]) : d);
const r1 = v => Math.round(v * 10) / 10;
const fm = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const numOrNull = s => { const v = parseFloat(String(s ?? '').replace(/,/g, '')); return isFinite(v) ? v : null; };
const stemsOf = t => String(t || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4).map(w => (w.endsWith('ies') ? w.slice(0, -3) : (w.endsWith('s') ? w.slice(0, -1) : w)));

// the formulation's numbers, as amounts
export function plan_of(c, r) {
  const C = F.constants(c);
  const x = F.calc({ ...r }, C);
  const sw = r.sweetener || 'none';
  let lb = sw === 'none' ? 0 : x.lb;
  if (sw !== 'none' && !(r.brix_desired > 0) && r.sweet_lb_per_gal > 0) lb = r.sweet_lb_per_gal * x.gal;   // older rate recipes
  const k = sw === 'honey' ? 1 / C.honeyLbPerGal : C.sugarVol;
  const sweet_l = lb * k * C.lPerGal, juice_l = x.juice * C.lPerGal;
  const water_l = Math.max((r.target_l || 0) - juice_l - sweet_l, 0);
  return { C, sw, target_l: r.target_l || 0, fruit_lb: x.fruit, juice_l, water_l, sweet_lb: lb, sweet_l, og: r.brix_desired > 0 ? x.og : null, abv: r.brix_desired > 0 && r.fg ? x.abv : null };
}

function code_for(r) {
  const nm = String(r.name || '').replace(/\s+/g, '');
  return /^\d{2}[A-Za-z]/.test(nm) ? nm : String(r.year || today().slice(0, 4)).slice(2, 4) + nm;
}

export function make_page(c, fid, token, err = '', f = null) {
  const r = c.one('SELECT * FROM formula WHERE id=? AND deleted=0', fid);
  if (!r) return null;
  if (r.is_master) {   // the master stays undated and unlinked: batches are made from this season's copy of it
    return page('Make a batch', `<h1>Make a batch from ${E(r.name)}</h1><div class="infobox"><b>${E(r.name)}</b> is a ★ master formulation. Masters are not turned into batches directly: ` +
      `on its page press <b>▶ Start a ${thisYear()} batch</b> to make this season's copy, adjust the copy, then <b>② Make this a batch</b> from it.</div><p><a class="btn" href="/formula/${fid}">← Back to the master</a></p>`, '/formula/',
      [['Formulations', '/formulas'], [r.name, `/formula/${fid}`], ['Make a batch', null]]);
  }
  onhand.sync_lots(c);
  const P = plan_of(c, r);
  const crumbs = [['Formulations', '/formulas'], [r.name, `/formula/${fid}`], ['Make a batch', null]];
  const swn = P.sw === 'honey' ? 'Honey' : 'Sugar';
  const card = `<table style="max-width:640px"><tbody>
    <tr><td>Batch size</td><td class="n"><b>${fm(P.target_l, 0)} L</b></td><td class="muted">${fm(P.target_l / 3.785411784, 1)} gal</td></tr>
    <tr><td>Fruit</td><td class="n"><b>${fm(P.fruit_lb, 1)} lb</b></td><td class="muted">${fm(P.fruit_lb * LB, 1)} kg · ${fm(r.fruit_lb_per_gal, 2)} lb/gal</td></tr>
    <tr><td>Water</td><td class="n"><b>${fm(P.water_l, 1)} L</b></td><td class="muted">${fm(P.water_l / 3.785411784, 1)} gal</td></tr>
    ${P.sw === 'none' ? '' : `<tr><td>${swn}</td><td class="n"><b>${fm(P.sweet_lb, 1)} lb</b></td><td class="muted">${fm(P.sweet_lb * LB, 1)} kg</td></tr>`}
    <tr><td>Starting gravity / alcohol</td><td class="n">${P.og ? P.og.toFixed(3) : '—'}</td><td class="muted">${P.abv ? fm(P.abv, 1) + ' % ABV potential' : ''}</td></tr></tbody></table>
    <p class="sub"><a href="/formula/${fid}">← change the formulation</a> (fruit, sugar, water, batch size) — this screen uses it as saved.</p>`;
  const head = `<h1>Make a batch from ${E(r.name)}</h1>${err}<h2>The plan</h2>${card}`;
  if (!(P.target_l > 0 && r.fruit_lb_per_gal > 0)) {
    return page('Make a batch', head + `<div class="warnbox">This formulation has no recipe numbers yet. On the <a href="/formula/${fid}">formulation page</a> use <b>Fill from</b> to take them from a past formulation, adjust, save, then come back.</div>`, '/formula/', crumbs);
  }
  // state of the linked batch
  const st0 = r.batch_id ? started(c).find(b => b.id === r.batch_id) : null;
  const begun = st0 && !st0.adds.length ? st0 : null;   // started (fruit in a vessel) but no water/sugar yet: finish it here
  const fresh = unstarted(c);
  if (r.batch_id && !begun && !fresh.some(b => b.id === r.batch_id)) {   // already made (or has records beyond a bare start)
    const bc = c.val('SELECT code FROM batch WHERE id=?', r.batch_id);
    return page('Make a batch', head + `<div class="infobox">This formulation is already batch <a href="/batch/${r.batch_id}"><b>${E(bc)}</b></a>. For another batch from the same recipe, use <b>Copy for this season</b> on the formulation.</div>`, '/formula/', crumbs);
  }
  const code0 = begun ? begun.code : (r.batch_id ? c.val('SELECT code FROM batch WHERE id=?', r.batch_id) : code_for(r));
  // fruit: lots that match the formulation, filled up to the plan
  const mine = stemsOf(`${r.name} ${r.wine || ''} ${r.family || ''}`);
  const hit = t => stemsOf(t).some(w => mine.some(m => m.includes(w) || w.includes(m)));
  const already = begun ? begun.fruit.reduce((t, x) => t + x.lb, 0) : 0;
  let left = Math.max(P.fruit_lb - already, 0);
  const lots = c.all("SELECT id, item, amount_kg, supplier FROM ingredient_lot WHERE status='on_hand' AND kind='fruit' ORDER BY item COLLATE NOCASE")
    .map(l => ({ ...l, lb: r1(l.amount_kg / LB), match: hit(l.item) })).sort((a, b) => b.match - a.match);
  const lotRows = lots.map(l => {
    let on = false, amt = l.lb;
    if (l.match && left > 0.05) { on = true; amt = r1(Math.min(l.lb, left)); left -= amt; }
    if (f) { on = !!f['use_' + l.id]; amt = g0(f, 'amt_' + l.id, amt); }
    return `<label class="lot"><input type="checkbox" name="use_${l.id}" value="1" ${on ? 'checked' : ''}><span style="min-width:13em"><b>${E(l.item)}</b> <span class="muted">${l.lb} lb on hand${l.supplier ? ' · ' + E(l.supplier) : ''}</span></span>
      use <input name="amt_${l.id}" inputmode="decimal" size="6" data-uc="1" value="${E(String(amt))}"> lb</label>`;
  }).join('') || '<p class="muted hint">No fruit on the on-hand list. Record the delivery on <a href="/intakes">Intakes</a> first, or make the batch now and add the fruit later.</p>';
  const busy = new Set(entry.current_contents(c).map(x => x.vessel_id));
  const vs = c.all("SELECT id, code, kind, capacity_l FROM vessel WHERE active=1 AND is_virtual=0 AND kind NOT IN ('press') ORDER BY capacity_l, code").filter(v => !busy.has(v.id));
  const vt = v => `${E(v.code)} (${E(v.kind)}${v.capacity_l ? ', ' + Math.round(v.capacity_l) + ' L' : ''})${v.capacity_l && v.capacity_l < P.target_l ? ' — too small for ' + fm(P.target_l, 0) + ' L' : ''}`;
  const vsel = `<select name="vessel_id"><option value="">— not yet —</option>${vs.map(v => `<option value="${v.id}" ${g0(f, 'vessel_id') === String(v.id) ? 'selected' : ''}>${vt(v)}</option>`).join('')}</select>`;
  const mats = c.all("SELECT id, name, kind FROM material WHERE kind IN ('sugar','honey') AND COALESCE(retired,0)=0 ORDER BY kind, name");
  const want = P.sw === 'honey' ? 'honey' : 'sugar';
  const defm = (mats.find(m => m.kind === want && /cane/i.test(m.name)) || mats.find(m => m.kind === want) || {}).id;
  const water0 = begun ? r1(Math.max(P.target_l - begun.vol - P.sweet_l, 0)) : r1(P.water_l);
  const types = entry.BEVERAGE_TYPES.map(t => `<option ${g0(f, 'beverage_type', TYPE[r.category] || 'Fruit Wine') === t ? 'selected' : ''}>${E(t)}</option>`).join('');
  const vessel = begun
    ? `<div class="infobox" style="flex-basis:100%"><b>${E(begun.code)}</b> is already in <b>${E(begun.vcode)}</b> with ${fm(begun.vol, 1)} L (${fm(begun.vol / 3.785411784, 1)} gal)${begun.cap ? ' of ' + fm(begun.cap, 0) + ' L' : ''}${begun.fruit.length ? ' — fruit in: ' + begun.fruit.map(x => `${E(x.item)} ${x.lb} lb`).join(', ') : ''}. The water and ${swn.toLowerCase()} go in there; the water shown tops it up to ${fm(P.target_l, 0)} L.${begun.cap && P.target_l > begun.cap * 1.02 ? ' <b>The batch size is more than that vessel holds.</b>' : ''}</div>`
    : `<label>Vessel${vsel}</label><label id="lab_fill">Fruit / juice going in<input name="fill_l" inputmode="decimal" size="7" value="${E(g0(f, 'fill_l', r1(P.juice_l)))}"> L</label>
       <p class="hint muted">The formulation counts the fruit as ${fm(P.juice_l, 1)} L of juice; water and ${swn.toLowerCase()} bring it to ${fm(P.target_l, 0)} L.</p>`;
  const body = `${head}
    <form class="entry sb" method="post" action="/makebatch?f=${fid}"><input type="hidden" name="_t" value="${E(token)}">
      <h2 style="flex-basis:100%">Batch</h2>
      <label>Batch code<input name="code" size="14" value="${E(g0(f, 'code', code0))}" ${begun || r.batch_id ? 'readonly' : ''}></label>
      <label>Description<input name="description" size="26" value="${E(g0(f, 'description', `${r.year || today().slice(0, 4)} ${r.wine || r.name}`))}"></label>
      <label>Wine type<select name="beverage_type">${types}</select></label>${_when_field(g0(f, 'when'))}
      ${begun ? '' : (r.batch_id ? '<p class="hint muted">Continues the batch already made for this formulation (no records yet).</p>' : '')}
      <h2 style="flex-basis:100%">Fruit from on hand <span class="muted" style="font-weight:400;font-size:13px">— plan ${fm(P.fruit_lb, 1)} lb${already ? `, ${fm(already, 1)} lb already in` : ''}</span></h2>${lotRows}
      <h2 style="flex-basis:100%">Into a vessel</h2>${vessel}
      <label class="lot" style="flex-basis:100%"><input type="checkbox" name="rec_add" value="1" ${f && f.rec_add ? 'checked' : ''}> record the water and ${swn.toLowerCase()} now${begun ? '' : ' (needs a vessel)'} <span class="muted" style="font-size:12px">— usually left off: they go in later, a little at a time, as Additions. The batch keeps the formulation's ${fm(P.target_l, 0)} L as its target.</span></label>
      <label>Water<input name="water_l" inputmode="decimal" size="7" value="${E(g0(f, 'water_l', water0))}"> L</label>
      ${P.sw === 'none' ? '' : `<label>${swn}<input name="sweet_lb" inputmode="decimal" size="7" value="${E(g0(f, 'sweet_lb', r1(P.sweet_lb)))}"> lb</label>
      <label>From stock<select name="sweet_mid">${mats.map(m => `<option value="${m.id}" ${String(g0(f, 'sweet_mid', defm)) === String(m.id) ? 'selected' : ''}>${E(m.name)}</option>`).join('')}</select></label>`}
      <label class="wide">Notes<input name="notes" size="50" value="${E(g0(f, 'notes'))}" placeholder="optional"></label>
      <div class="actions"><button>${begun ? 'Finish the batch start' : 'Make the batch'}</button> <a href="/formula/${fid}">Cancel</a></div></form>
    <style>.sb .lot{flex-direction:row;align-items:center;gap:8px;flex-basis:100%}.sb .lot input[type=checkbox]{width:auto}.sb .hint{flex-basis:100%;font-size:12px;margin:0}</style>`;
  return page('Make a batch', body, '/formula/', crumbs);
}

export function post_make(c, fid, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  const r = c.one('SELECT * FROM formula WHERE id=? AND deleted=0', fid);
  if (!r) return [null, 'No such formulation.'];
  if (r.is_master) return [null, 'This is a master formulation. Press ▶ Start a batch on its page to make this season\'s copy, then make the batch from the copy.'];
  const P = plan_of(c, r);
  if (!(P.target_l > 0 && r.fruit_lb_per_gal > 0)) return [null, 'This formulation has no recipe numbers yet.'];
  const when = entry._when(g('when'));
  const day = when.slice(0, 10);
  const code = g('code');
  if (!/^\d{2}[A-Za-z]/.test(code)) return [null, 'Batch code: the year then a name, e.g. 26Rhubarb2.'];
  const lots = c.all("SELECT * FROM ingredient_lot WHERE status='on_hand' AND kind='fruit'").filter(l => g('use_' + l.id));
  for (const l of lots) if (!(numOrNull(g('amt_' + l.id)) > 0)) return [null, `${l.item}: enter the pounds used.`];
  const water_l = numOrNull(g('water_l')) || 0, sweet_lb = P.sw === 'none' ? 0 : (numOrNull(g('sweet_lb')) || 0);
  if (water_l < 0 || sweet_lb < 0) return [null, 'Water and sweetener can’t be negative.'];
  // the batch: the one already linked, one created but not started with this code, or a new one
  let bid, existing = null;
  const ex = r.batch_id ? c.one('SELECT id, code FROM batch WHERE id=?', r.batch_id) : c.one('SELECT id, code FROM batch WHERE lower(code)=lower(?)', code);
  if (ex) {
    existing = started(c).find(b => b.id === ex.id && !b.adds.length) || null;
    if (!existing && !unstarted(c).some(b => b.id === ex.id)) return [null, `Batch ${ex.code} already exists and has records — pick a new name.`];
    bid = ex.id;
  } else {
    bid = entry.create_batch(c, code, g('description'), String(r.year || day.slice(0, 4)), g('beverage_type'), BASE[r.category] || 'fruit', null, 'New Hampshire', null);
  }
  const bcode = c.val('SELECT code FROM batch WHERE id=?', bid);
  const fruitTxt = lots.map(l => `${l.item} ${g('amt_' + l.id)} lb`).join(', ');
  c.run('UPDATE formula SET batch_id=?, fruit_notes=?, source=?, updated_at=? WHERE id=?', bid,
    [r.fruit_notes, fruitTxt ? `Fruit used ${day}: ${fruitTxt}` : ''].filter(x => x).join('\n') || null,
    [r.source, `Made batch ${bcode} on ${day}: ${g('rec_add') ? `water ${water_l} L${P.sw === 'none' ? '' : `, ${P.sw} ${sweet_lb} lb`} recorded` : 'water and sweetener to be added later'}`].filter(x => x).join(' · '), nowIso(), fid);
  for (const l of lots) {
    const [ok, err] = onhand.post_lot(c, { action: ['use'], id: [String(l.id)], use_amount: [g('amt_' + l.id)], use_unit: ['lb'], batch_id: [String(bid)],
      when: [day > today() ? today() : day], note: [`into ${bcode}`] });
    if (!ok) return [null, `${l.item}: ${err}`];
  }
  const v = existing ? String(existing.vessel_id) : g('vessel_id');
  if (!v) return [`/batch/${bid}?saved=1`, null];
  let vol;
  if (existing) {
    const st = entry.current_contents(c).find(x => x.vessel_id === existing.vessel_id);
    vol = st ? st.volume_l : existing.vol;
  } else {
    vol = numOrNull(g('fill_l'));
    if (!(vol > 0)) return [null, 'Enter the litres of fruit/juice going into the vessel (or set the vessel to "not yet").'];
    const notes = g('notes') || null;
    captured(c, '/record/fill', { when: [when], batch_id: [String(bid)], fv: [v], fl: [String(vol)], notes: [g('notes')] },
      () => { e2.record_fill(c, when, bid, [[v, String(vol)]], notes); return ['ok', null]; });
  }
  if (g('rec_add')) {
    const later = m => { const d = new Date(when.replace(' ', 'T') + 'Z'); d.setUTCMinutes(d.getUTCMinutes() + m); return d.toISOString().slice(0, 19).replace('T', ' '); };
    const add = (t, mid, amount, unit, after) => {
      const form = { when: [t], vessel_id: [v], material_id: [String(mid)], amount: [String(amount)], unit: [unit], volume_after: [String(after)], notes: [`start of ${bcode}`], lot: [''] };
      captured(c, '/record/addition', form, () => { entry.record_addition(c, t, Number(v), mid, String(amount), unit, String(after), `start of ${bcode}`, [], ''); return ['ok', null]; });
    };
    if (water_l > 0) {
      const wmat = c.val("SELECT id FROM material WHERE kind='water' AND COALESCE(retired,0)=0 ORDER BY id LIMIT 1");
      if (!wmat) return [null, 'No Water material — add one on Materials.'];
      vol = r1(vol + water_l);
      add(later(1), wmat, water_l, 'L', vol);
    }
    if (sweet_lb > 0) {
      const m = c.one('SELECT id, kind FROM material WHERE id=?', Number(g('sweet_mid')));
      if (!m || !['sugar', 'honey'].includes(m.kind)) return [null, 'Pick the sugar or honey from stock.'];
      vol = r1(vol + sweet_lb * (P.sw === 'honey' ? 1 / P.C.honeyLbPerGal : P.C.sugarVol) * P.C.lPerGal);
      add(later(2), m.id, sweet_lb, 'lb', vol);
    }
  }
  return [`/batch/${bid}?saved=1`, null];
}
