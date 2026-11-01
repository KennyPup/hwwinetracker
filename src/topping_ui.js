// v1.25 — Topping from a batch page: the source is the tank picked in ＋ Record; the batch's other vessels are offered as the
// ones to top. A barrel group shows its barrels with one total split equally (the default) or fine-tuned barrel by barrel.
// Same record as before (entry2.record_topping: the source loses the litres, each topped vessel stays full and the litres are
// booked as evaporation); the per-barrel split goes into the operation notes and table topping_split.
import { tip as HELP } from './help.js';
import { E } from './lib/py.js';
import * as entry from './entry.js';
import * as VU from './vessel_ui.js';
import { _when_field, _form } from './ui_entry.js';

export function ensure_schema(c) {
  c.run('CREATE TABLE IF NOT EXISTS topping_split(op_id INTEGER NOT NULL, group_id INTEGER NOT NULL, vessel_id INTEGER NOT NULL, litres REAL NOT NULL)');
}
const arr = (f, k) => { const v = f[k]; return v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]; };
const one = (f, k, d = '') => { const v = f[k]; return v === undefined || v === null ? d : Array.isArray(v) ? (v[0] ?? d) : v; };

export function page_topping(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c).filter(x => x.batch_id);
  const kinds = new Map(c.all('SELECT id, kind FROM vessel').map(v => [v.id, v.kind]));
  const V = [], G = new Map();   // v1.26: barrels of one group holding the same wine show as the group (real: litres go to each barrel)
  for (const x of cont) {
    const k = kinds.get(x.vessel_id) || x.kind;
    const g = k === 'barrel' ? VU.group_of(c, x.vessel_id) : null;
    if (g) {
      const key = g.id + ':' + x.batch_id;
      if (!G.has(key)) { const e = { id: 'g' + g.id + '_' + x.batch_id, code: g.code, kind: 'barrel_group', b: x.batch_id, bc: x.batch, vol: 0, ms: [], real: true }; G.set(key, e); V.push(e); }
      const e = G.get(key); e.vol = Math.round((e.vol + x.volume_l) * 10) / 10; e.ms.push({ id: x.vessel_id, code: x.vessel });
      V.push({ id: x.vessel_id, code: x.vessel, kind: k, b: x.batch_id, bc: x.batch, vol: Math.round(x.volume_l * 10) / 10, ms: [], inGroup: e.id });
      continue;
    }
    const ms = k === 'barrel_group' ? VU.members(c, x.vessel_id).map(m => ({ id: m.id, code: m.code })) : [];
    V.push({ id: x.vessel_id, code: x.vessel, kind: k, b: x.batch_id, bc: x.batch, vol: Math.round(x.volume_l * 10) / 10, ms });
  }
  const posted = {};
  arr(f, 'dv').forEach((v, i) => { if (v) posted[v] = arr(f, 'dl')[i] || ''; });
  const splits = {};
  for (const k of Object.keys(f)) if (k.startsWith('split_')) splits[k.slice(6)] = one(f, k);
  const from = one(f, 'from_id', '');
  const data = { V, from, posted, splits };
  const fromSel = `<select name="from_id" id="tfrom" required><option value="">— pick —</option>${V.filter(v => !v.real).map(v => `<option value="${v.id}" ${String(v.id) === String(from) ? 'selected' : ''}>${E(v.code)} · ${E(v.bc)} · ${Math.round(v.vol)} L</option>`).join('')}</select>`;
  const inner = `${_when_field(one(f, 'when'))}<label>Topping wine from${fromSel}</label><label class="wide">Notes<input name="notes" value="${E(one(f, 'notes', ''))}" placeholder="optional"></label>
<span style="flex:1 1 100%"></span><div id="tdst" class="tdst"></div>
<div class="tadd"><select id="tother"><option value="">＋ Top another vessel…</option>${V.map(v => `<option value="${v.id}">${E(v.code)} · ${E(v.bc)}</option>`).join('')}</select></div>
<div id="tsum" class="tsum"></div><div id="thid"></div>`;
  return `<h1>Topping${HELP('topping')}</h1><p class="sub">The topping wine leaves the source; each vessel you top stays full, and the litres are booked as evaporation there. A barrel group takes one total, split equally across its barrels unless you fine-tune it.</p>${err}`
    + _form('/record/topping', token, inner) + `<script>window.TOP=${JSON.stringify(data).replace(/</g, '\\u003c')};</script><script>${CLIENT}</script><style>${CSS}</style>`;
}

// POST: per-barrel splits must add up to the group's litres; they are written into the notes and topping_split
export function check_splits(c, f) {
  const dv = f.dv || [], dl = f.dl || [];
  const out = [];
  for (const k of Object.keys(f)) {
    if (!k.startsWith('split_')) continue;
    const gid = Number(k.slice(6)), i = dv.indexOf(String(gid));
    if (i < 0) continue;
    const parts = String(f[k][0] || '').split(',').filter(Boolean).map(p => { const [v, l] = p.split(':'); return { v: Number(v), l: Number(l) }; });
    if (!parts.length) continue;
    const tot = Number(dl[i]), sum = parts.reduce((t, p) => t + p.l, 0);
    if (parts.some(p => !(p.l >= 0)) || Math.abs(sum - tot) > 0.051) throw new entry.EntryError(`The barrels of ${c.val('SELECT code FROM vessel WHERE id=?', gid)} add up to ${sum.toFixed(1)} L, not ${tot} L.`);
    const names = new Map(c.all('SELECT id, code FROM vessel WHERE id IN (' + parts.map(() => '?').join(',') + ')', ...parts.map(p => p.v)).map(r => [r.id, r.code]));
    if (parts.some(p => !names.has(p.v))) throw new entry.EntryError('Unknown barrel in the split.');
    out.push({ gid, gcode: c.val('SELECT code FROM vessel WHERE id=?', gid), parts: parts.map(p => ({ ...p, code: names.get(p.v) })) });
  }
  return out;
}
export const split_note = sp => sp.map(s => `${s.gcode}: ${s.parts.map(p => `${p.code} ${+p.l.toFixed(2)} L`).join(', ')}`).join(' · ');
export function save_splits(c, op, sp) {
  for (const s of sp) for (const p of s.parts) c.run('INSERT INTO topping_split(op_id, group_id, vessel_id, litres) VALUES (?,?,?,?)', op, s.gid, p.v, p.l);
}

const CSS = `.tdst{flex:1 1 100%;display:flex;flex-direction:column;gap:10px}.tv{border:1px solid var(--line2);border-radius:8px;padding:10px 12px;background:var(--card)}
.tv .th{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}.tv .th b{color:var(--fg2);font-size:15px}.tv .th .m{color:var(--mut);font-size:13px}.tv .th .x{margin-left:auto;background:none;border:0;color:var(--mut);font-size:18px;cursor:pointer;width:auto}
.tv label{display:inline-flex;flex-direction:row;align-items:center;gap:6px;font-size:13px;color:var(--mut)}.tv input[type=text]{width:6em;text-align:right;font-size:15px}
.tb{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 14px;margin-top:8px}.tb div{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;color:var(--fg)}
.tb input{width:5.5em;text-align:right}.tb input[readonly]{background:transparent;border-color:transparent;color:var(--fg2)}.tsum{flex:1 1 100%;font-size:14px;color:var(--fg2)}.tsum .w{color:#f0b84a}
.tadd select{max-width:340px}`;

// client (inside a template literal: no backticks or dollar-brace)
const CLIENT = `(function(){var T=window.TOP,V=T.V,byId={},shown=[],box=document.getElementById('tdst'),fs=document.getElementById('tfrom'),form=fs.form;
V.forEach(function(v){byId[v.id]=v});
function r1(x){return Math.round(x*100)/100}
function esc(s){return String(s).replace(/[&<>"]/g,function(ch){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]})}
function card(v,litres,split){var d=document.createElement('div');d.className='tv';d.dataset.id=v.id;
  var h='<div class="th"><b>'+esc(v.code)+'</b><span class="m">'+esc(v.kind==='barrel_group'?'barrel group':v.kind)+' · '+esc(v.bc)+' · '+Math.round(v.vol)+' L</span>'+
   '<label>Litres <input type="text" inputmode="decimal" class="tl" value="'+esc(litres||'')+'" placeholder="0"></label><button type="button" class="x" title="Don\\u2019t top this one">×</button></div>';
  if(v.ms.length){h+='<label style="margin-top:6px"><input type="checkbox" class="ft"'+(split?' checked':'')+'> Fine-tune each barrel (otherwise split equally)</label><div class="tb">'+
   v.ms.map(function(m){return '<div><span>'+esc(m.code)+'</span><input type="text" inputmode="decimal" class="bl" data-b="'+m.id+'" readonly></div>'}).join('')+'</div>'}
  else if(v.kind==='barrel_group')h+='<div class="m" style="margin-top:6px;font-size:13px;color:var(--mut)">This group\\u2019s barrels aren\\u2019t set — <a href="/v/'+encodeURIComponent(v.code)+'">set them</a> to split by barrel.</div>';
  d.innerHTML=h;box.appendChild(d);
  var tl=d.querySelector('.tl'),ft=d.querySelector('.ft'),bl=[].slice.call(d.querySelectorAll('.bl'));
  if(split&&bl.length){var sp={};split.split(',').forEach(function(p){var a=p.split(':');sp[a[0]]=a[1]});bl.forEach(function(i){i.value=sp[i.dataset.b]||''})}
  function eq(){if(ft&&ft.checked)return;var t=parseFloat(tl.value)||0,n=bl.length;bl.forEach(function(i){i.value=t?r1(t/n):''})}
  function mode(){bl.forEach(function(i){i.readOnly=!(ft&&ft.checked)});tl.readOnly=!!(ft&&ft.checked);if(ft&&!ft.checked)eq();sum()}
  tl.addEventListener('input',function(){eq();sum()});bl.forEach(function(i){i.addEventListener('input',function(){tl.value=r1(bl.reduce(function(s,x){return s+(parseFloat(x.value)||0)},0))||'';sum()})});
  if(ft)ft.addEventListener('change',mode);d.querySelector('.x').onclick=function(){d.remove();shown=shown.filter(function(x){return x!==v.id});sum()};
  shown.push(v.id);mode();return d}
function suggest(){box.innerHTML='';shown=[];var src=byId[fs.value];if(!src){sum();return}
  var pre=Object.keys(T.posted).length;
  V.filter(function(v){return pre?T.posted[v.id]!==undefined:(v.b===src.b&&v.id!==src.id&&!v.inGroup&&!(v.real&&v.ms.some(function(m){return m.id===src.id})))}).forEach(function(v){card(v,pre?T.posted[v.id]:'',T.splits[v.id])});
  T.posted={};T.splits={};sum()}
function sum(){var src=byId[fs.value],t=0,n=0;[].slice.call(box.querySelectorAll('.tv')).forEach(function(d){var x=parseFloat(d.querySelector('.tl').value)||0;if(x>0){t+=x;n++}});
  var s=document.getElementById('tsum');if(!src){s.innerHTML='Pick the tank the topping wine comes from.';return}
  s.innerHTML=n?('Topping <b>'+r1(t)+' L</b> into '+n+' vessel'+(n>1?'s':'')+' · '+esc(src.code)+' goes from '+Math.round(src.vol)+' to <b>'+r1(src.vol-t)+' L</b>'+(t>src.vol?' <span class="w">— more than it holds</span>':'')):'Enter the litres for each vessel you topped.'}
fs.addEventListener('change',suggest);
document.getElementById('tother').addEventListener('change',function(){var v=byId[this.value];this.value='';if(!v||shown.indexOf(v.id)>=0||String(v.id)===fs.value)return;card(v,'','');sum()});
form.addEventListener('submit',function(e){var hid=document.getElementById('thid');hid.innerHTML='';var any=false;
  [].slice.call(box.querySelectorAll('.tv')).forEach(function(d){var x=parseFloat(d.querySelector('.tl').value)||0;if(!(x>0))return;any=true;
   var bl=[].slice.call(d.querySelectorAll('.bl')),v=byId[d.dataset.id];
   if(v&&v.real){bl.forEach(function(i){var l=parseFloat(i.value)||0;if(l>0)hid.insertAdjacentHTML('beforeend','<input type="hidden" name="dv" value="'+i.dataset.b+'"><input type="hidden" name="dl" value="'+r1(l)+'">')});return}
   hid.insertAdjacentHTML('beforeend','<input type="hidden" name="dv" value="'+d.dataset.id+'"><input type="hidden" name="dl" value="'+r1(x)+'">');
   if(bl.length)hid.insertAdjacentHTML('beforeend','<input type="hidden" name="split_'+d.dataset.id+'" value="'+bl.map(function(i){return i.dataset.b+':'+(parseFloat(i.value)||0)}).join(',')+'">')});
  if(!any){e.preventDefault();alert('Enter the litres for at least one vessel.')}});
suggest()})()`;
