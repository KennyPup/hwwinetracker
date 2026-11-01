// v0.9.1 entry screens for the remaining Vintrace activities (see entry2.js).
import { E, pyStr, fxc } from './lib/py.js';
import * as entry from './entry.js';
import * as e2 from './entry2.js';
import * as opm from './opmenu.js';
import * as DU from './dispatch_ui.js';
import * as TU from './topping_ui.js';
import { _form, _when_field, _notes_field, _vessel_select, _occupied_checks, _vlabel } from './ui_entry.js';

const _has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const G = (f, k, d = null) => (_has(f, k) ? f[k] : d);
const A = (f, k) => { const v = G(f, k, []); return Array.isArray(v) ? v : [v]; };   // repeated field as array
const allVessels = c => c.all("SELECT id, code, capacity_l FROM vessel WHERE is_virtual=0 AND active=1 ORDER BY kind, code");
const batchOpts = (c, sel, blank = '— pick —') => `<option value="">${E(blank)}</option>` + c.all('SELECT id, code, description FROM batch ORDER BY id DESC')
  .map(b => `<option value="${b.id}" ${pyStr(sel) === pyStr(b.id) ? 'selected' : ''}>${E(b.code)}${b.description ? ' · ' + E(b.description) : ''}</option>`).join('');
const lossOpts = (sel, def = 'Lees') => entry.LOSS_REASONS.map(r => `<option ${(sel || def) === r ? 'selected' : ''}>${E(r)}</option>`).join('');
const treatOpts = sel => '<option value="">(none)</option>' + entry.TREATMENTS.filter(t => /FILTER|Cold|Degas|Carbonate|Heat|Cool|Other/.test(t))
  .map(t => `<option ${sel === t ? 'selected' : ''}>${E(t)}</option>`).join('');
const optSel = (name, cont, all, sel, blank = '— pick —') => _vessel_select(name, cont, all, sel, blank).replace(' required', '');
const ROWS = 6;

// ---------------------------------------------------------------- fill / extraction
export function page_fill(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c), allv = allVessels(c);
  const V = A(f, 'fv'), L = A(f, 'fl');
  const rows = [...Array(4)].map((_, i) => `<label>Vessel ${i + 1}${optSel('fv', cont, allv, V[i] || (i === 0 ? G(f, 'vessel_id') : ''), i ? '(none)' : '— pick —')}</label>
      <label>Litres<input name="fl" inputmode="decimal" size="7" value="${E(L[i] || '')}"></label>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>Batch<select name="batch_id" required>${batchOpts(c, G(f, 'batch_id'))}</select></label><span style="flex:1 1 100%"></span>${rows}${_notes_field(G(f, 'notes', ''))}`;
  return '<h1>Fill / extraction</h1><p class="sub">Juice or must from pressing, extraction or draining goes into vessels of a batch . For a delivery use Intake; for vessel-to-vessel use Transfer.</p>' + err + _form('/record/fill', token, inner);
}

// ---------------------------------------------------------------- change batch
export function page_changebatch(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const inner = `${_when_field(G(f, 'when'))}<label>New batch<select name="batch_id" required>${batchOpts(c, G(f, 'batch_id'))}</select></label>${_notes_field(G(f, 'notes', ''))}
      <label class="wide">Vessels</label>${_occupied_checks(cont, undefined, undefined, A(f, 'vessels'))}`;
  return '<h1>Change batch</h1><p class="sub">Re-label the wine in a vessel as another batch. Volume and TTB status stay as they are.</p>' + err + _form('/record/changebatch', token, inner);
}

// ---------------------------------------------------------------- start / stop ferment
export function page_ferment(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const w = G(f, 'which', 'start');
  const inner = `${_when_field(G(f, 'when'))}<label>What<select name="which"><option value="start" ${w === 'start' ? 'selected' : ''}>Start ferment (yeast pitched)</option><option value="stop" ${w === 'stop' ? 'selected' : ''}>Stop ferment (fermentation finished / stopped)</option></select></label>${_notes_field(G(f, 'notes', ''))}
      <label class="wide">Vessels</label>${_occupied_checks(cont, undefined, undefined, A(f, 'vessels'))}`;
  return '<h1>Start / stop ferment</h1><p class="sub">Record the yeast addition itself under Addition. The phone screens use these dates to list what is fermenting.</p>' + err + _form('/record/ferment', token, inner);
}

// ---------------------------------------------------------------- many-to-one
export function page_blend(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c), allv = allVessels(c);
  const V = A(f, 'sv'), L = A(f, 'sl'), X = A(f, 'sx');
  const rows = [...Array(ROWS)].map((_, i) => `<label>From ${i + 1}${optSel('sv', cont, null, V[i] || '', i ? '(none)' : '— pick —')}</label>
      <label>Litres<input name="sl" inputmode="decimal" size="7" placeholder="all" value="${E(L[i] || '')}"></label><label>Loss (L)<input name="sx" inputmode="decimal" size="5" value="${E(X[i] || '')}"></label><span style="flex:1 1 40%"></span>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>Into${_vessel_select('to_id', cont, allv, G(f, 'to_id'))}</label>
      <label>Resulting batch<select name="result_batch_id">${batchOpts(c, G(f, 'result_batch_id'), "(destination's batch, or first source's if empty)")}</select></label>
      <label>Resulting TTB status<select name="result_state"><option value="">(destination's, or first source's)</option><option value="NON_DECLARED" ${G(f, 'result_state') === 'NON_DECLARED' ? 'selected' : ''}>in fermenter / undeclared</option><option value="BONDED" ${G(f, 'result_state') === 'BONDED' ? 'selected' : ''}>declared</option></select></label>
      <label>Loss reason<select name="loss_reason">${lossOpts(G(f, 'loss_reason'))}</select></label><label>Treatment<select name="treatment">${treatOpts(G(f, 'treatment'))}</select></label>
      <span style="flex:1 1 100%"></span>${rows}${_notes_field(G(f, 'notes', ''))}`;
  return '<h1>Blend / combine (many → one)</h1><p class="sub">Leave Litres blank to move everything left after the loss. Each source\'s batch is kept on the operation, so the blend make-up stays traceable.</p>' + err + _form('/record/blend', token, inner);
}

// ---------------------------------------------------------------- one-to-many
export function page_split(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c), allv = allVessels(c);
  const V = A(f, 'dv'), L = A(f, 'dl');
  const rows = [...Array(ROWS)].map((_, i) => `<label>Into ${i + 1}${optSel('dv', cont, allv, V[i] || '', i ? '(none)' : '— pick —')}</label>
      <label>Litres<input name="dl" inputmode="decimal" size="7" value="${E(L[i] || '')}"></label><span style="flex:1 1 50%"></span>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>From${_vessel_select('from_id', cont, null, G(f, 'from_id'))}</label>
      <label>Loss (L)<input name="loss" inputmode="decimal" size="6" value="${E(G(f, 'loss', '0'))}"></label><label>Loss reason<select name="loss_reason">${lossOpts(G(f, 'loss_reason'))}</select></label>
      <label>Treatment<select name="treatment">${treatOpts(G(f, 'treatment'))}</select></label><span style="flex:1 1 100%"></span>${rows}${_notes_field(G(f, 'notes', ''))}`;
  return '<h1>Split / rack into several (one → many)</h1><p class="sub">Destinations that already hold wine keep their batch; empty ones take the source\'s batch and TTB status.</p>' + err + _form('/record/split', token, inner);
}

// ---------------------------------------------------------------- topping
export function page_topping(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const V = A(f, 'dv'), L = A(f, 'dl');
  const rows = [...Array(8)].map((_, i) => `<label>Top ${i + 1}${optSel('dv', cont, null, V[i] || '', i ? '(none)' : '— pick —')}</label>
      <label>Litres<input name="dl" inputmode="decimal" size="6" value="${E(L[i] || '')}"></label><span style="flex:1 1 50%"></span>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>Topping wine from${_vessel_select('from_id', cont, null, G(f, 'from_id'))}</label>${_notes_field(G(f, 'notes', ''))}<span style="flex:1 1 100%"></span>${rows}`;
  return '<h1>Topping</h1><p class="sub">Barrels are filled back to their recorded volume: the topping wine leaves the source and is booked as evaporation on each barrel.</p>' + err + _form('/record/topping', token, inner);
}

// ---------------------------------------------------------------- bottling
function itemOpts(c, finished, sel, blank = '— pick —') {
  const rows = c.all(`SELECT id, code, name, description, unit, litres_per_unit, tax_class FROM stock_item WHERE inactive=0 AND is_finished=? ORDER BY ${finished ? 'id DESC' : 'category, code'}`, finished ? 1 : 0);
  return `<option value="">${E(blank)}</option>` + rows.map(r => `<option value="${r.id}" ${pyStr(sel) === pyStr(r.id) ? 'selected' : ''}>${E(r.code)} · ${E(r.description || r.name || '')}${finished ? ` · ${r.litres_per_unit || '?'} L · class ${r.tax_class || '?'}` : ` (${E(r.unit || '')})`}</option>`).join('');
}
// Live help on the Packaging screen: litres packaged and what stays in the vessel, and the dry goods used per unit at the
// last bottling of the same product (falls back to the last bottling of any product of the same size), scaled to the units.
function bottling_js(c, cont, user_dry) {
  const vol = Object.fromEntries(cont.map(x => [x.vessel_id, x.volume_l]));
  const lpu = Object.fromEntries(c.all('SELECT id, litres_per_unit l FROM stock_item WHERE is_finished=1').map(r => [r.id, r.l]));
  const per = {}, bySize = {};
  for (const r of c.all(`SELECT e.item_id, e.op_id, e.quantity units, i.litres_per_unit l FROM stock_event e JOIN operation o ON o.id=e.op_id JOIN stock_item i ON i.id=e.item_id
                         WHERE e.action='Package' AND e.source='app' AND o.reversed=0 AND e.quantity>0 ORDER BY e.occurred_at DESC, e.id DESC`)) {
    if (per[r.item_id] && bySize[r.l]) continue;
    const lines = c.all("SELECT item_id d, -quantity q FROM stock_event WHERE op_id=? AND action='Consume' AND source='app'", r.op_id).map(x => [x.d, x.q / r.units]);
    if (!lines.length) continue;
    if (!per[r.item_id]) per[r.item_id] = lines;
    if (!bySize[r.l]) bySize[r.l] = lines;
  }
  return `(function(){var V=${JSON.stringify(vol)},L=${JSON.stringify(lpu)},P=${JSON.stringify(per)},S=${JSON.stringify(bySize)},auto=${user_dry ? 'false' : 'true'};
var f=document.querySelector('form[action="/record/bottling"]');if(!f)return;var vs=f.vessel_id,it=f.item_id,un=f.units,ls=f.loss,em=f.empty_vessel,out=document.getElementById('bt-sum');
var ds=f.querySelectorAll('select[name=dry]'),dq=f.querySelectorAll('input[name=dq]');
function fill(){if(!auto)return;var r=P[it.value]||S[L[it.value]]||[],n=parseFloat(un.value)||0;for(var i=0;i<ds.length;i++){ds[i].value=r[i]?String(r[i][0]):'';dq[i].value=r[i]&&n?String(Math.ceil(r[i][1]*n-1e-9)):''}}
function sum(){var l=L[it.value],n=parseFloat(un.value)||0,v=V[vs.value];if(!l||!n){out.textContent='';return}var p=n*l,lo=parseFloat(ls.value)||0;
out.textContent='= '+p.toFixed(1)+' L packaged ('+(p/3.785411784).toFixed(1)+' gal)'+(v?' · vessel holds '+v.toFixed(1)+' L → '+(em.checked?'emptied, loss '+Math.max(0,v-p).toFixed(1)+' L':((v-p-lo)<-0.5?'⚠ '+(p+lo-v).toFixed(1)+' L more than it holds':(v-p-lo).toFixed(1)+' L left')):'')}
it.addEventListener('change',function(){fill();sum()});un.addEventListener('input',function(){fill();sum()});[vs,ls,em].forEach(function(e){e.addEventListener('input',sum);e.addEventListener('change',sum)});
for(var i=0;i<ds.length;i++){ds[i].addEventListener('change',function(){auto=false});dq[i].addEventListener('input',function(){auto=false})}
fill();sum()})()`;
}
export function page_bottling(c, token, f = null, err = '') {
  f = f || {};
  let make = '';
  const bid = parseInt(G(f, 'batch', '') || '0', 10);
  const b = bid ? c.one('SELECT id, code, description, beverage_type FROM batch WHERE id=?', bid) : null;
  if (b && !G(f, 'item_id')) {   // opened from the batch page: pick this wine's product, or offer to create it
    const its = c.all('SELECT id FROM stock_item WHERE is_finished=1 AND inactive=0 AND (batch_id=? OR lower(code) LIKE lower(?)) ORDER BY id DESC', b.id, b.code + '%');
    if (its.length === 1) f = { ...f, item_id: its[0].id };
    else if (!its.length) {
      const back = `/record/bottling?vessel_id=${encodeURIComponent(G(f, 'vessel_id', '') || '')}&batch=${b.id}${G(f, '_next') ? '&_next=' + encodeURIComponent(G(f, '_next')) : ''}`;
      const cr = opm.class_reason(c, b.id), cls = cr.cls, isCider = /cider/i.test(b.beverage_type || '');
      const co = entry.TAX_CLASSES.map(([k, n]) => `<option value="${k}" ${cls === k ? 'selected' : ''}>(${k}) ${E(n)}</option>`).join('');
      const still = isCider ? 'f' : 'a';
      const cv = cls === 'd' ? 'flaghill' : 'still';
      const carbSel = `<label>Carbonation<select onchange="this.form.tax_class.value=this.value==='flaghill'?'d':(this.value==='still'?'${still}':this.form.tax_class.value)">
        <option value="still" ${cv === 'still' ? 'selected' : ''}>Still / low (≤ 0.392 g/100 mL, ~2 vol${isCider ? '; cider ≤ 0.64' : ''}) → (${still})</option>
        <option value="flaghill" ${cv === 'flaghill' ? 'selected' : ''}>Flag Hill, injected → (d)</option><option value="other">Other — set the class by hand</option></select></label>
        <p class="muted" style="flex-basis:100%;font-size:12px;margin:0">Suggested from: ${E(cr.why)}.</p>`;
      make = `<div class="cbanner" style="background:#2a2410;border:1px solid #6b5514;color:#f0d68a;border-radius:8px;padding:10px 12px;margin:10px 0"><b style="color:#fff">${E(b.code)} has no bottled product yet.</b> Create it here (Vintrace made it during packaging); you come straight back to this screen.</div>` +
        _form('/record/stockitem', token, `<input type="hidden" name="_back" value="${E(back)}"><input type="hidden" name="category" value="Bottled-Canned Wine"><input type="hidden" name="unit" value="x1"><input type="hidden" name="batch_id" value="${b.id}">
      <label>Product code<input name="code" required size="16" value="${E(b.code)}"></label><label>Description<input name="description" size="32" value="${E((b.description || b.code) + ' 750ml')}"></label>
      <label>Litres per unit<input name="litres_per_unit" inputmode="decimal" size="6" value="0.75"></label>${carbSel}<label>Tax class<select name="tax_class">${co}</select></label>`, 'Create product');
    }
  }
  const cont = entry.current_contents(c);
  const D = A(f, 'dry'), Q = A(f, 'dq');
  const dry = [...Array(5)].map((_, i) => `<label>Dry goods ${i + 1}<select name="dry">${itemOpts(c, false, D[i] || '', '(none)')}</select></label><label>Used<input name="dq" inputmode="decimal" size="6" value="${E(Q[i] || '')}"></label><span style="flex:1 1 40%"></span>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>From vessel${_vessel_select('vessel_id', cont, null, G(f, 'vessel_id'))}</label>
      <label>Product filled<select name="item_id" required>${itemOpts(c, true, G(f, 'item_id'))}</select></label>
      <label>Units filled<input name="units" inputmode="numeric" required size="7" value="${E(G(f, 'units', ''))}"></label>
      <label>Loss (L)<input name="loss" inputmode="decimal" size="6" value="${E(G(f, 'loss', '0'))}"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="empty_vessel" value="1" ${G(f, 'empty_vessel') ? 'checked' : ''}> vessel is now empty (the rest is bottling loss)</label>
      <span style="flex:1 1 100%" id="bt-sum" class="muted"></span>
      <span style="flex:1 1 100%" class="muted">Product missing? <a href="/record/stock#new">Create the stock item</a> first (code, litres per unit, tax class). Dry goods fill in from the last bottling of the same product (per bottle × units) — change them as needed.</span>${dry}${_notes_field(G(f, 'notes', ''))}
      <script>${bottling_js(c, cont, D.some(x => x))}</script>`;
  return '<h1>Bottling / canning / kegging</h1><p class="sub">Bulk wine leaves the vessel and becomes finished stock (TTB Section B line 2 / Section A line 13). Undeclared wine is declared at bottling in the product\'s tax class. Dry goods used (bottles, closures, capsules, labels, cases) come off stock.</p>' + err + (G(f, 'created') ? '<div class="ok">Product created and picked below.</div>' : '') + make + _form('/record/bottling', token, inner);
}

// ---------------------------------------------------------------- dispatch
// One BOL = one dispatch type and date; quantities for as many products as needed (a whole month of tasting-room sales
// or a week of samples on one screen). Products with stock are listed first; tick "show all" for the rest.
export function page_dispatch(c, token, f = null, err = '') {
  f = f || {};
  const types = c.all('SELECT name, ttb_line FROM dispatch_type WHERE active=1 ORDER BY sort');
  const to = types.map(t => `<option ${G(f, 'dispatch_type', 'Tasting Room Sales') === t.name ? 'selected' : ''}>${E(t.name)}</option>`).join('');
  const dests = c.col('SELECT destination FROM dispatch WHERE destination IS NOT NULL GROUP BY destination ORDER BY COUNT(*) DESC LIMIT 30').map(d => `<option value="${E(d)}">`).join('');
  const nb = (c.val("SELECT MAX(CAST(bol AS INTEGER)) FROM dispatch WHERE bol GLOB '[0-9]*'") || 0) + 1;
  const stock = new Map(c.all('SELECT item_id, SUM(quantity) q FROM stock_event GROUP BY item_id').map(r => [r.item_id, r.q]));
  const last = new Map(c.all(`SELECT dl.item_id, MAX(d.occurred_at) t FROM dispatch_line dl JOIN dispatch d ON d.id=dl.dispatch_id WHERE d.reversed=0 GROUP BY dl.item_id`).map(r => [r.item_id, r.t]));
  const fin = c.all('SELECT id, code, description, name, litres_per_unit, tax_class FROM stock_item WHERE is_finished=1 AND inactive=0')
    .map(r => ({ ...r, oh: stock.get(r.id) || 0, last: last.get(r.id) || '' }))
    .sort((a, b) => ((b.oh > 0.5) - (a.oh > 0.5)) || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || (a.code < b.code ? -1 : 1));
  const I = A(f, 'it'), Q = A(f, 'iq');
  const sub = new Map(I.map((id, i) => [String(id), Q[i] || '']));
  const rows = fin.map(r => `<tr class="${r.oh > 0.5 ? '' : 'zero'}" data-s="${E((r.code + ' ' + (r.description || r.name || '')).toLowerCase())}" data-l="${r.litres_per_unit || 0}" style="${r.oh > 0.5 || sub.get(String(r.id)) ? '' : 'display:none'}">
      <td>${E(r.code)}</td><td>${E(r.description || r.name || '')}</td><td>${E(r.tax_class || '')}</td><td class="n">${fxc(r.oh, 0)}</td>
      <td><input type="hidden" name="it" value="${r.id}"><input name="iq" inputmode="numeric" size="5" value="${E(sub.get(String(r.id)) || '')}" style="width:5em"></td></tr>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>Dispatch type<select name="dispatch_type">${to}</select></label>
      <label>To<input name="destination" list="dests" value="${E(G(f, 'destination', 'Hermit Woods Winery'))}"><datalist id="dests">${dests}</datalist></label>
      <label>BOL #<input name="bol" size="8" value="${E(G(f, 'bol', String(nb)))}"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="allow_negative" value="1" ${G(f, 'allow_negative') ? 'checked' : ''}> allow negative stock</label>
      <span style="flex:1 1 100%"></span>
      <label>Find<input id="dq" placeholder="code or wine" oninput="flt()"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="dall" onchange="flt()"> show products with no stock</label>
      <span id="dtot" class="muted" style="font-size:13px"></span>
      <div style="flex:1 1 100%;max-height:60vh;overflow:auto"><table class="grid" id="dg"><thead><tr><th>Item</th><th>Wine</th><th>Class</th><th>On hand</th><th>Qty out</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${_notes_field(G(f, 'notes', ''))}
      <script>function flt(){const t=document.getElementById('dq').value.toLowerCase(),a=document.getElementById('dall').checked;
        document.querySelectorAll('#dg tbody tr').forEach(r=>{const q=r.querySelector('[name=iq]').value;r.style.display=(q||((a||!r.classList.contains('zero'))&&r.dataset.s.indexOf(t)>=0))?'':'none'})}
      function tot(){let n=0,l=0,k=0;document.querySelectorAll('#dg tbody tr').forEach(r=>{const q=parseFloat(r.querySelector('[name=iq]').value);if(q>0){n+=q;l+=q*parseFloat(r.dataset.l);k++}});
        document.getElementById('dtot').textContent=k?k+' products · '+n+' units · '+(l/3.785411784).toFixed(1)+' gal':''}
      document.getElementById('dg').addEventListener('input',tot);tot();</script>`;
  return `<h1>Dispatch (BOL)</h1><p class="sub">Bottles and cans leaving: weekly tasting-room samples, monthly sales by type, wholesale, NHLC, family use. One BOL per type and date. The type sets the TTB line: ${types.map(t => `${E(t.name)} → ${E(t.ttb_line)}`).join(' · ')}. Monthly summary for the sales workbook: <a href="/dispatches">Dispatches</a> → download.</p>` + err + _form('/record/dispatch', token, inner);
}

// ---------------------------------------------------------------- stock receive / count + new stock item
export function page_stock(c, token, f = null, err = '') {
  f = f || {};
  const stock = new Map(c.all('SELECT item_id, SUM(quantity) q FROM stock_event GROUP BY item_id').map(r => [r.item_id, r.q]));
  const items = c.all('SELECT id, code, description, name, unit, is_finished FROM stock_item WHERE inactive=0 ORDER BY is_finished DESC, code');
  const io = '<option value="">— pick —</option>' + items.map(r => `<option value="${r.id}" ${pyStr(G(f, 'item_id')) === pyStr(r.id) ? 'selected' : ''}>${E(r.code)} · ${E(r.description || r.name || '')} · ${fxc(stock.get(r.id) || 0, 0)} ${E(r.unit || '')} on hand</option>`).join('');
  const m = G(f, 'mode', 'receive');
  const inner = `${_when_field(G(f, 'when'))}<label>What<select name="mode"><option value="receive" ${m === 'receive' ? 'selected' : ''}>Receive (delivery, return)</option><option value="count" ${m === 'count' ? 'selected' : ''}>Count (set on-hand to a physical count)</option><option value="correction" ${m === 'correction' ? 'selected' : ''}>Records correction (set on-hand; on no TTB line — note required)</option></select></label>
      <label>Item<select name="item_id" required>${io}</select></label><label>Quantity / count<input name="qty" inputmode="decimal" required size="8" value="${E(G(f, 'qty', ''))}"></label>${_notes_field(G(f, 'notes', ''))}`;
  const bo = batchOpts(c, G(f, 'batch_id'), '(none)');
  const co = '<option value="">(none — dry goods)</option>' + entry.TAX_CLASSES.map(([k, n]) => `<option value="${k}" ${G(f, 'tax_class') === k ? 'selected' : ''}>(${k}) ${E(n)}</option>`).join('');
  const cats = ['Bottled-Canned Wine', 'Labels', 'Bottles-Cans', 'Capsules', 'Corks', 'Wire Cage', 'Additives', 'Filtration', 'Testing', 'Other'].map(x => `<option ${G(f, 'category') === x ? 'selected' : ''}>${x}</option>`).join('');
  const ni = `<label>Code<input name="code" required size="16" value="${E(G(f, 'code', ''))}" placeholder="26NecTom750"></label><label>Description<input name="description" size="32" value="${E(G(f, 'description', ''))}" placeholder="2026 Nectarine Tomato 750ml"></label>
      <label>Category<select name="category">${cats}</select></label><label>Unit<input name="unit" size="6" value="${E(G(f, 'unit', 'x1'))}"></label>
      <label>Litres per unit (finished goods)<input name="litres_per_unit" inputmode="decimal" size="6" value="${E(G(f, 'litres_per_unit', ''))}" placeholder="0.75"></label>
      <label>Tax class<select name="tax_class">${co}</select></label><label>Batch<select name="batch_id">${bo}</select></label>`;
  return '<h1>Stock — receive / count</h1><p class="sub">Finished wine received counts as TTB Section B line 3; count differences go to line 5 (gain) or 19 (loss); a records correction goes on no TTB line.</p>' + err + _form('/record/stock', token, inner) +
    '<h2 id="new">New stock item</h2><p class="sub">Finished goods need litres per unit and a tax class (they can then be bottled and dispatched). Leave both blank for dry goods.</p>' + _form('/record/stockitem', token, ni, 'Create item');
}

export function create_stock_item(c, f) {
  const g = k => pyStr(G(f, k, '') || '').trim();
  const codev = g('code');
  if (!codev) throw new entry.EntryError('Item code is required.');
  if (c.one('SELECT 1 FROM stock_item WHERE code=?', codev)) throw new entry.EntryError(`${codev} already exists.`);
  const lpu = g('litres_per_unit') ? entry._num(g('litres_per_unit'), 'Litres per unit') : null;
  if (lpu !== null && lpu > 60) throw new entry.EntryError('Litres per unit over 60 L looks wrong (a 1/2 bbl keg is 58.7 L).');
  const tc = g('tax_class') || null;
  if (lpu && !tc) throw new entry.EntryError('Finished goods need a tax class.');
  if (tc && !lpu) throw new entry.EntryError('Finished goods need litres per unit.');
  const fin = lpu ? 1 : 0;
  return c.run('INSERT INTO stock_item(code,name,description,category,item_type,unit,litres_per_unit,tax_class,batch_id,is_finished) VALUES (?,?,?,?,?,?,?,?,?,?)',
    codev, codev, g('description') || null, g('category') || null, fin ? 'Single x1' : 'Dry goods', g('unit') || 'x1', lpu, tc, g('batch_id') ? Number(g('batch_id')) : null, fin).id;
}

// ---------------------------------------------------------------- POST
const zip = (...a) => a[0].map((_, i) => a.map(x => x[i]));
export function post(c, path, f) {
  const g = (k, d = '') => (_has(f, k) && f[k] && f[k].length ? f[k] : [d])[0];
  const arr = k => (_has(f, k) ? f[k] : []);
  let op;
  if (path === '/record/fill') op = e2.record_fill(c, g('when'), g('batch_id'), zip(arr('fv'), arr('fl')), g('notes'));
  else if (path === '/record/changebatch') op = e2.record_change_batch(c, g('when'), arr('vessels'), g('batch_id'), g('notes'));
  else if (path === '/record/ferment') op = e2.record_ferment(c, g('when'), arr('vessels'), g('which'), g('notes'));
  else if (path === '/record/blend') op = e2.record_blend(c, g('when'), g('to_id'), zip(arr('sv'), arr('sl'), arr('sx')), g('loss_reason'), g('result_batch_id') || null, g('result_state') || null, g('notes'), g('treatment'));
  else if (path === '/record/split') op = e2.record_split(c, g('when'), g('from_id'), zip(arr('dv'), arr('dl')), g('loss'), g('loss_reason'), g('notes'), g('treatment'));
  else if (path === '/record/topping') {   // v1.25: barrel-group splits checked, noted and kept per barrel
    const sp = TU.check_splits(c, f);
    const nt = [g('notes'), sp.length ? TU.split_note(sp) : ''].filter(Boolean).join(' · ');
    op = e2.record_topping(c, g('when'), g('from_id'), zip(arr('dv'), arr('dl')), nt || null);
    TU.save_splits(c, op, sp);
  }
  else if (path === '/record/bottling') op = e2.record_bottling(c, g('when'), g('vessel_id'), g('item_id'), g('units'), g('loss'), !!g('empty_vessel'), zip(arr('dry'), arr('dq')), g('notes'));
  else if (path === '/record/dispatch' && g('ui') === 'lines') {   // v1.22 line form: flagged not blocked, duplicates summed, one transaction
    const { lines, bad } = DU.lines_from_post(f);
    if (bad.length) throw new entry.EntryError('Not saved: ' + bad.join('; ') + '.');
    op = e2.record_dispatch(c, g('when'), g('dispatch_type'), g('destination'), g('bol'), lines, g('notes'), true);
    const did = c.val('SELECT id FROM dispatch WHERE reference=?', `op:${op}`);
    return [did ? `/dispatch/${did}?saved=1` : `/record?done=${op}`, null];
  }
  else if (path === '/record/dispatch') op = e2.record_dispatch(c, g('when'), g('dispatch_type'), g('destination'), g('bol'), zip(arr('it'), arr('iq')), g('notes'), !!g('allow_negative'));
  else if (path === '/record/stock') op = e2.record_stock(c, g('when'), g('item_id'), g('mode'), g('qty'), g('notes'));
  else if (path === '/record/stockitem') {
    const flat = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v[0]]));
    const nid = create_stock_item(c, flat);
    const back = String(flat._back || '');   // made from the Packaging screen: go back there with the new product picked
    if (/^\/record\/bottling\?[A-Za-z0-9_=&%.-]*$/.test(back)) return [`${back}&item_id=${nid}&created=1`, null];
    return ['/record/stock?created=1', null];
  } else return null;
  return [`/record?done=${op}`, null];
}

export const PAGES = {
  '/record/fill': page_fill, '/record/changebatch': page_changebatch, '/record/ferment': page_ferment, '/record/blend': page_blend,
  '/record/split': page_split, '/record/topping': TU.page_topping, '/record/bottling': page_bottling, '/record/dispatch': DU.page_dispatch,   // v1.22 line-by-line form (old product grid: page_dispatch, kept unused)
 
  '/record/stock': page_stock, '/record/stockitem': page_stock,
};

export const TILES = [
  ['/record/ferment', 'Start / stop ferment', 'Yeast pitched, or fermentation finished'],
  ['/record/fill', 'Fill / extraction', 'Juice or must from pressing into vessels'],
  ['/record/blend', 'Blend / combine', 'Many vessels into one, with losses'],
  ['/record/split', 'Split / rack out', 'One vessel into several'],
  ['/record/topping', 'Topping', 'Top barrels from a tank'],
  ['/record/changebatch', 'Change batch', 'Re-label the wine in a vessel'],
  ['/record/bottling', 'Bottling / canning', 'Bulk to finished goods, dry goods used'],
  ['/record/dispatch', 'Dispatch (BOL)', 'Cases and bottles leaving: tasting room, wholesale, NHLC …'],
  ['/record/stock', 'Stock receive / count', 'Dry goods deliveries, counts, new stock items'],
];
