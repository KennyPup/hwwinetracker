// Start a new batch — one screen, in the order Ken works:
//   1 name it · 2 tick the fruit on hand (and how much) · 3 pick a past formulation of a similar wine (ranked by fruit, newest first)
//   4 the plan: batch size, water and sugar/honey from that formulation, scaled to the fruit — every number editable
//   5 (optional) the vessel, with the water and sugar/honey additions recorded at the same time.
// Saving creates (or continues) the batch, writes this batch's formulation (linked), takes the fruit off the on-hand list,
// and — if a vessel is picked — fills it and records the additions (drawing sugar/honey from Materials stock).
import { E, today, nowIso } from './lib/py.js';
import { page } from './core.js';
import * as entry from './entry.js';
import * as e2 from './entry2.js';
import * as onhand from './onhand.js';
import * as F from './formulation.js';
import { captured } from './correct.js';
import { _when_field } from './ui_entry.js';

const LB = 0.45359237;
const TYPE = { 'Fruit wine': 'Fruit Wine', Mead: 'Mead', Cider: 'Cider' };
const BASE = { Mead: 'honey', Cider: 'juice / cider' };
const STOP = new Set(['red', 'white', 'wild', 'fresh', 'frozen', 'local', 'farm', 'organic', 'mixed', 'the', 'and', 'for', 'with', 'juice', 'puree']);
const FCOLS = 'fruit_notes,id,name,wine,year,family,category,sweetener,model,target_l,fruit_lb_per_gal,juice_gal_per_lb,brix_fruit,brix_desired,factor,fg,sweet_lb_per_gal,liquid_sg,verified,yeast,fermenter,batch_id';
const g0 = (f, k, d = '') => (f && f[k] !== undefined && f[k] !== null ? String(f[k]) : d);
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const json = o => JSON.stringify(o).replace(/</g, '\\u003c');

function stems(item) {
  return String(item || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3 && !STOP.has(w))
    .map(w => (w.endsWith('ies') ? w.slice(0, -3) : (w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)));
}
const usable = r => r.fruit_lb_per_gal > 0 && (r.brix_desired > 0 || r.sweet_lb_per_gal > 0 || r.sweetener === 'none');
// how well a past formulation fits one fruit: name/wine/family hits, single-fruit wines first, complete Brix recipes, verified, newer
function score(r, st) {
  if (!st.length) return 0;
  const h = k => String(r[k] || '').toLowerCase();
  let s = 0;
  for (const w of st) {
    let t = 0;
    if (h('family').includes(w)) t = 5;
    if (h('wine').includes(w)) t = Math.max(t, 4);
    if (h('name').includes(w)) t = Math.max(t, 3);
    if (!t && h('fruit_notes').includes(w)) t = 2;
    s = Math.max(s, t);
  }
  if (!s) return 0;
  if (h('family').startsWith(st[0]) && !/[-—\/,(]/.test(r.family || '')) s += 2;
  if (r.brix_fruit !== null && r.brix_desired > 0 && r.juice_gal_per_lb > 0) s += 3;
  if (r.verified === 'Y') s += 1;
  return s + Math.max(0, (Number(r.year) || 2000) - 2000) * 0.05;
}

function candidates(c, items, fid) {   // items: [{key, item}] — on-hand lots and fruit already in a started batch
  const all = c.all(`SELECT ${FCOLS} FROM formula WHERE deleted=0 AND COALESCE(is_master,0)=0`);   // masters are started from their own page
  const by = new Map();
  for (const l of items) {
    const st = stems(l.item);
    const hits = all.filter(usable).map(r => [score(r, st), r]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0] || b[1].year - a[1].year);
    const seen = new Map();
    let n = 0;
    for (const [s, r] of hits) {
      // the same recipe carried from year to year: keep the newest, note the other years
      const key = [norm(r.name), (r.fruit_lb_per_gal || 0).toFixed(2), r.brix_fruit, r.brix_desired, r.sweetener].join('|');
      if (seen.has(key)) { const k = seen.get(key); if (!k.also.includes(r.year) && r.year !== k.year) k.also.push(r.year); continue; }
      if (++n > 25) break;
      const e = by.get(r.id) || { ...r, also: [], sc: {} };
      e.sc[l.key] = Math.round(s * 100) / 100;
      seen.set(key, e);
      by.set(r.id, e);
    }
  }
  if (fid) {
    const r = c.one(`SELECT ${FCOLS} FROM formula WHERE id=? AND deleted=0`, fid);
    if (r && usable(r)) { const e = by.get(r.id) || { ...r, also: [], sc: {} }; e.base = 1; by.set(r.id, e); }
  }
  return [...by.values()].map(({ fruit_notes, ...e }) => e);
}

// batches started this season (not in the opening snapshot) that sit in one vessel: the page can finish planning them —
// the fruit already in counts, and the water and sugar go into that vessel
export function started(c) {
  const bd = c.val("SELECT value FROM meta WHERE key='state_base_date'") || '2026-09-29';
  const by = new Map();
  for (const x of entry.current_contents(c)) if (x.batch_id) { if (!by.has(x.batch_id)) by.set(x.batch_id, []); by.get(x.batch_id).push(x); }
  const out = [];
  for (const [bid, vs] of by) {
    if (vs.length !== 1 || c.one('SELECT 1 x FROM bulk_snapshot WHERE batch_id=? AND snap_date<=? LIMIT 1', bid, bd)) continue;
    let fruit = [];
    try {
      fruit = c.all("SELECT l.item item, SUM(CASE WHEN g.action='use undone' THEN -g.amount_kg ELSE g.amount_kg END) kg FROM ingredient_lot_log g JOIN ingredient_lot l ON l.id=g.lot_id WHERE g.batch_id=? AND g.action IN ('used','used up','use undone') GROUP BY l.item", bid);
    } catch (e) { /* no lots table */ }
    fruit = fruit.concat(c.all("SELECT variety item, SUM(amount) kg FROM intake WHERE batch_id=? AND reversed=0 AND kind='fruit' AND unit='kg' GROUP BY variety", bid));
    const adds = c.all(`SELECT m.kind kind, SUM(a.amount_base) s FROM op_addition a JOIN material m ON m.id=a.material_id JOIN operation o ON o.id=a.op_id
                        WHERE a.batch_id=? AND o.reversed=0 AND m.kind IN ('sugar','honey','water') GROUP BY m.kind`, bid);
    out.push({ id: bid, code: c.val('SELECT code FROM batch WHERE id=?', bid), vessel_id: vs[0].vessel_id, vcode: vs[0].vessel, cap: vs[0].capacity_l, vol: Math.round(vs[0].volume_l * 10) / 10,
      fruit: fruit.filter(f => f.kg > 0).map(f => ({ item: f.item || 'fruit', key: 'i:' + String(f.item || '').toLowerCase(), lb: Math.round(f.kg / LB * 10) / 10 })),
      adds: adds.map(a => ({ kind: a.kind, amt: a.kind === 'water' ? Math.round(a.s * 10) / 10 : Math.round(a.s / LB * 10) / 10 })) });
  }
  return out;
}

// batches created but with no records yet (no cellar ops, not in the snapshot): typing their code continues them
export function unstarted(c) {
  const sd = c.val('SELECT MAX(snap_date) FROM bulk_snapshot');
  return c.all(`SELECT b.id, b.code, b.description FROM batch b WHERE b.production_year>=? AND NOT EXISTS (SELECT 1 FROM bulk_snapshot s WHERE s.batch_id=b.id AND s.snap_date=?)
                AND NOT EXISTS (SELECT 1 FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE o.reversed=0 AND (ov.batch_id=b.id OR ov.batch_after_id=b.id)) ORDER BY b.id DESC`, Number(today().slice(0, 4)) - 1, sd);
}

function suggest_code(r) {
  const yy = String(r.year || today().slice(0, 4)).slice(2, 4);
  const nm = String(r.name || '').replace(/\s+/g, '');
  return /^\d{2}[A-Za-z]/.test(nm) ? nm : yy + nm;
}

const CSS = `<style>
.sb h2{flex-basis:100%;margin:14px 0 2px;display:flex;gap:8px;align-items:baseline}.sb h2 i{font-style:normal;background:#6b2d3c;color:#fff;border-radius:50%;width:1.5em;height:1.5em;display:inline-flex;align-items:center;justify-content:center;font-size:13px}
.sb .hint{flex-basis:100%;font-size:12px;margin:0}.sb .lot{flex-direction:row;align-items:center;gap:8px;flex-basis:100%}.sb .lot input[type=checkbox]{width:auto}
.sb table.cand{flex-basis:100%;font-size:13px}.sb table.cand td,.sb table.cand th{padding:3px 6px}.sb table.cand tr.on{background:#f3e9ec}.sb table.cand input{width:auto}
.sb .plan{flex-basis:100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}.sb .pbox{border:1px solid #ddd;border-radius:8px;padding:8px 10px}
.sb .pbox h3{margin:0 0 6px;font-size:14px}.sb .pr{display:flex;align-items:center;gap:6px;margin:3px 0;font-size:13px}.sb .pr .l{flex:1}.sb .pr input,.sb .pr select{width:6.5em;text-align:right}
.sb .pr .u{min-width:4.2em;color:#666}.sb .pr.big{font-weight:600;font-size:14px}.sb .was{font-size:11px;color:#777;margin:-2px 0 4px;text-align:right}.sb .was a{cursor:pointer;color:#6b2d3c;text-decoration:underline}
.sb .uk{color:#777;font-size:12px}.sb .tot{flex-basis:100%;font-size:14px;margin:4px 0}
</style>`;

export function start_page(c, fid, token, err = '', f = null) {
  fid = fid || 0;
  const f0 = fid ? c.one('SELECT * FROM formula WHERE id=? AND deleted=0', fid) : null;
  if (fid && !f0) return null;
  onhand.sync_lots(c);
  const C = F.constants(c);
  const yr = Number((f0 && f0.year) || today().slice(0, 4));
  const lots = c.all("SELECT id, item, amount_kg, supplier, received_at FROM ingredient_lot WHERE status='on_hand' AND kind='fruit' ORDER BY item COLLATE NOCASE")
    .map(l => ({ id: l.id, item: l.item, lb: Math.round(l.amount_kg / LB * 10) / 10, supplier: l.supplier || '' }));
  const begun = started(c);
  const items = lots.map(l => ({ key: String(l.id), item: l.item }));
  for (const b of begun) for (const fr of b.fruit) if (!items.some(i => i.key === fr.key)) items.push({ key: fr.key, item: fr.item });
  const cand = candidates(c, items, fid);
  const fresh = unstarted(c);
  const codes = c.all('SELECT lower(code) k FROM batch').map(r => r.k);
  const mats = c.all("SELECT id, name, kind FROM material WHERE kind IN ('sugar','honey') AND COALESCE(retired,0)=0 ORDER BY kind, name");
  const types = entry.BEVERAGE_TYPES.map(t => `<option ${g0(f, 'beverage_type', TYPE[f0 && f0.category] || 'Fruit Wine') === t ? 'selected' : ''}>${E(t)}</option>`).join('');
  const lotRows = lots.length ? lots.map(l => `<label class="lot"><input type="checkbox" name="use_${l.id}" value="1" ${f && f['use_' + l.id] ? 'checked' : ''}>
      <span style="min-width:12em"><b>${E(l.item)}</b> <span class="muted">${l.lb} lb on hand${l.supplier ? ' · ' + E(l.supplier) : ''}</span></span>
      use <input name="amt_${l.id}" inputmode="decimal" size="6" data-uc="1" value="${E(g0(f, 'amt_' + l.id, String(l.lb)))}"> lb <span class="uk" id="k_${l.id}"></span></label>`).join('')
    : '<p class="muted hint">No fruit on hand. Record a delivery on <a href="/intakes">Intakes</a> first, or plan without fruit (type the batch size in step 4).</p>';
  const busy = new Set(entry.current_contents(c).map(x => x.vessel_id));
  const vs = c.all("SELECT id, code, kind, capacity_l FROM vessel WHERE active=1 AND is_virtual=0 AND kind NOT IN ('press') ORDER BY capacity_l, code").filter(v => !busy.has(v.id));
  const vt = v => `${E(v.code)} (${E(v.kind)}${v.capacity_l ? ', ' + Math.round(v.capacity_l) + ' L' : ''})`;
  const vsel = `<select name="vessel_id"><option value="">— not yet —</option>${vs.map(v => `<option value="${v.id}" data-cap="${v.capacity_l || ''}" data-t="${vt(v)}" ${g0(f, 'vessel_id') === String(v.id) ? 'selected' : ''}>${vt(v)}</option>`).join('')}</select>`;
  const num = (k, d) => E(g0(f, k, d === null || d === undefined ? '' : String(d)));
  const pr = (label, name, unit) => `<div class="pr"><span class="l">${label}</span><input name="${name}" inputmode="decimal" data-uc="1" value="${num(name)}"><span class="u">${unit}</span></div>`;
  const plan = `<div class="plan">
   <div class="pbox"><h3>Size</h3>
    <div class="pr"><span class="l">Fruit</span><b id="o_fruit">—</b><span class="u">lb</span></div><div class="was" id="o_fruitk"></div>
    ${pr('Fruit per gallon', 'fruit_lb_per_gal', 'lb/gal')}${pr('<b>Batch size</b>', 'target_l', 'litres')}<div class="was" id="o_gal"></div>
    ${pr('Juice yield', 'juice_gal_per_lb', 'gal/lb')}</div>
   <div class="pbox"><h3>Sugar</h3>
    ${pr('Brix of the fruit', 'brix_fruit', '°Brix')}${pr('Brix wanted', 'brix_desired', '°Brix')}
    <div class="pr"><span class="l">Sweetener</span><select name="sweetener">${F.SWEETENERS.map(([k, t]) => `<option value="${k}" ${g0(f, 'sweetener') === k ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="u"></span></div>
    ${pr('Factor', 'factor', 'per 16')}${pr('FG expected', 'fg', '')}<input type="hidden" name="liquid_sg" value="${num('liquid_sg')}"></div>
   <div class="pbox"><h3>What goes in</h3>
    ${pr('<b>Water</b>', 'water_l', 'litres')}<div class="was" id="w_water"></div>
    ${pr('<b id="t_sw">Sugar</b>', 'sweet_lb', 'lb')}<div class="was" id="w_sweet"></div>
    <div class="pr big"><span class="l">Total volume</span><b id="o_total">—</b><span class="u">litres</span></div><div class="was" id="o_totalg"></div>
    <div class="pr"><span class="l">Starting gravity</span><b id="o_og">—</b><span class="u"></span></div>
    <div class="pr"><span class="l">Alcohol (potential)</span><b id="o_abv">—</b><span class="u">% ABV</span></div>
    <div class="pr"><span class="l">Makes about</span><b id="o_bot">—</b><span class="u">bottles</span></div></div></div>
   <div id="w_neg" class="warnbox" style="display:none;flex-basis:100%">The fruit juice and sweetener come to more than the batch size, so the water is negative. Lower the Brix wanted or the fruit per gallon, or raise the batch size.</div>`;
  const D = { lots, cand, C, codes, fresh: fresh.map(b => ({ id: b.id, code: b.code })), started: begun, fid, yr, posted: !!f };
  const body = `<h1>Start a new batch${f0 ? ` <span class="muted" style="font-weight:400">from ${E(f0.name)}</span>` : ''}</h1>
    <p class="sub">Name it, tick the fruit, pick a past formulation of a similar wine, and adjust the water and sugar. Saving creates the batch with its own formulation, takes the fruit off the on-hand list and — if you pick a vessel — fills it and records the additions.</p>${err}
    <form class="entry sb" id="sb" method="post" action="/startbatch${fid ? '?f=' + fid : ''}"><input type="hidden" name="_t" value="${E(token)}">
      <h2><i>1</i>Name</h2>
      <label>Batch code<input name="code" size="14" value="${num('code', f0 ? suggest_code(f0) : '')}" placeholder="e.g. 26Rhubarb2" autocomplete="off"></label>
      <label>Description<input name="description" size="26" value="${num('description', f0 ? `${yr} ${f0.wine || f0.name}` : '')}"></label>
      <label>Wine type<select name="beverage_type">${types}</select></label>
      <label>Vintage<input name="vintage" size="5" value="${num('vintage', yr)}"></label>${_when_field(g0(f, 'when'))}
      <p class="hint" id="codehint"></p>
      <h2><i>2</i>Fruit from on hand</h2>${lotRows}<p class="tot" id="o_ftot"></p>
      <h2><i>3</i>Recipe from past formulations</h2>
      <p class="hint muted">Past formulations that used this fruit, best match and newest first. Pick one to start from; its numbers fill in step 4. Not listed? Open any formulation and press ▶ Start a batch from this.</p>
      <input type="hidden" name="base_id" value="${num('base_id', f0 && usable(f0) ? f0.id : '')}">
      <div id="cands" style="flex-basis:100%"></div>
      <h2><i>4</i>The plan <span class="muted" style="font-weight:400;font-size:13px">— scaled to your fruit; change any number</span></h2>${plan}
      <h2><i>5</i>Into a vessel <span class="muted" style="font-weight:400;font-size:13px">— optional; you can do it later</span></h2>
      <input type="hidden" name="existing_bid" value="${num('existing_bid')}"><div id="exblock" class="infobox" style="display:none;flex-basis:100%"></div>
      <label id="lab_vessel">Empty vessel${vsel}</label>
      <div id="vblock" style="display:contents">
       <label id="lab_fill">Fruit / must going in<input name="fill_l" inputmode="decimal" size="7" data-uc="1" value="${num('fill_l')}"><span class="uk" id="k_fill">litres</span></label>
       <label class="lot" style="flex-basis:auto"><input type="checkbox" name="rec_add" value="1" ${!f || f.rec_add ? 'checked' : ''}> also record the water and <span id="t_sw2">sugar</span> additions now</label>
       <label>Sweetener from stock<select name="sweet_mid">${mats.map(m => `<option value="${m.id}" data-kind="${m.kind}" ${g0(f, 'sweet_mid') === String(m.id) ? 'selected' : ''}>${E(m.name)}</option>`).join('')}</select></label>
       <p class="hint muted">The must going in is the juice the formulation counts; the water and sweetener additions bring the vessel up to the total volume, and the sugar/honey comes off Materials stock.</p></div>
      <label class="wide">Notes<input name="notes" size="50" value="${num('notes')}" placeholder="optional"></label>
      <div class="actions"><button>Start batch</button> <a href="${fid ? '/formula/' + fid : '/batches'}">Cancel</a> <a class="muted" style="margin-left:auto;font-size:12px" href="/record/batch">just create an empty batch</a></div></form>
    ${CSS}<script>${F.JS_CALC}
const D=${json(D)};
${CLIENT}</script>`;
  const crumbs = f0 ? [['Formulations', '/formulas'], [f0.name, `/formula/${fid}`], ['Start batch', null]] : [['Batches', '/batches'], ['Start a new batch', null]];
  return page('Start a new batch', body, f0 ? '/formula/' : '/batches', crumbs);
}

// browser side of the start page (plain string: no template substitutions inside)
const CLIENT = String.raw`const C=D.C,G=C.lPerGal,KG=0.45359237;const fm=document.getElementById('sb');const q=n=>fm.querySelector('[name="'+n+'"]');
const nv=n=>{const v=parseFloat(String(q(n).value).replace(/,/g,''));return isFinite(v)?v:0};
const fmt=(v,d)=>(v===null||v===undefined||!isFinite(v))?'—':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t};const r1=(v,d)=>String(Math.round(v*Math.pow(10,d))/Math.pow(10,d));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const T={target_l:!!(D.posted&&q('target_l').value),water_l:D.posted,sweet_lb:D.posted,fill_l:D.posted,code:!!q('code').value,description:D.posted};
const byId=id=>D.cand.find(x=>String(x.id)===String(id));let base=byId(q('base_id').value)||null,showAll=false;
const ticked=()=>D.lots.filter(l=>q('use_'+l.id).checked);
const exB=()=>{const cd=q('code').value.trim().toLowerCase();return cd?D.started.find(b=>b.code.toLowerCase()===cd)||null:null};
const fruitLb=()=>ticked().reduce((t,l)=>t+(parseFloat(q('amt_'+l.id).value)||0),0)+(exB()?exB().fruit.reduce((t,x)=>t+x.lb,0):0);
function ranked(){const e=exB(),ids=ticked().map(l=>String(l.id)).concat(e?e.fruit.map(x=>x.key):[]);return D.cand.map(x=>{let s=x.base?50:0;ids.forEach(i=>s+=(x.sc[i]||0));return [s,x]}).filter(z=>z[0]>0).sort((a,b)=>b[0]-a[0]||b[1].year-a[1].year).map(z=>z[1])}
const own=x=>fcalc({target_l:x.target_l,fruit_lb_per_gal:x.fruit_lb_per_gal,juice_gal_per_lb:x.juice_gal_per_lb,brix_fruit:x.brix_fruit,brix_desired:x.brix_desired,factor:x.factor,fg:x.fg,liquid_sg:x.liquid_sg,sweetener:x.sweetener},C);
function drawCands(){const el=document.getElementById('cands');let L=ranked();if(base&&!L.includes(base))L=[base].concat(L);
 if(!L.length){el.innerHTML='<p class="muted hint">'+(ticked().length||exB()?'No past formulation names this fruit. Open a similar one from Formulations and press ▶ Start a batch from this, or fill in step 4 yourself.':'Tick the fruit above to see past formulations that used it.')+'</p>';return}
 const n=showAll?L.length:Math.min(8,L.length);
 let h='<table class="cand"><thead><tr><th></th><th>Formulation</th><th class="n">Vintage</th><th class="n">Size</th><th class="n">Fruit</th><th class="n">Brix fruit → wanted</th><th>Sweetener</th><th class="n">Water</th></tr></thead><tbody>';
 L.slice(0,n).forEach(x=>{const o=own(x),rate=!(x.brix_desired>0),sw=x.sweetener==='honey'?'honey':(x.sweetener==='none'?'none':'sugar');
  const swl=sw==='none'?'none':(rate?fmt(x.sweet_lb_per_gal,2):fmt(o.gal?o.lb/o.gal:0,2))+' lb/gal '+sw;
  h+='<tr class="'+(base===x?'on':'')+'"><td><input type="radio" name="_pick" value="'+x.id+'" '+(base===x?'checked':'')+'></td><td><a href="/formula/'+x.id+'" target="_blank">'+esc(x.name)+'</a> <span class="muted">'+esc(x.wine||'')+(x.base?' · this formulation':'')+'</span></td>'
   +'<td class="n">'+x.year+(x.also.length?' <span class="muted">(also '+x.also.slice(0,3).join(', ')+')</span>':'')+'</td><td class="n">'+fmt(x.target_l,0)+' L</td><td class="n">'+fmt(x.fruit_lb_per_gal,2)+' lb/gal</td>'
   +'<td class="n">'+(rate?'<span class=muted>older recipe</span>':fmt(x.brix_fruit,1)+' → '+fmt(x.brix_desired,1))+'</td><td>'+swl+'</td><td class="n">'+(rate||!o.gal?'—':fmt(Math.max(o.water,0)/o.gal*100,0)+' % of volume')+'</td></tr>'});
 h+='</tbody></table>'+(L.length>8?'<p class="hint"><a href="#" id="more">'+(showAll?'show fewer':'show all '+L.length)+'</a></p>':'');el.innerHTML=h;
 el.querySelectorAll('input[name=_pick]').forEach(i=>i.addEventListener('change',()=>{pick(byId(i.value));drawCands()}));
 const m=document.getElementById('more');if(m)m.onclick=e=>{e.preventDefault();showAll=!showAll;drawCands()}}
function pick(x){base=x;q('base_id').value=x?x.id:'';if(!x)return;const put=(k,v,d)=>{q(k).value=(v===null||v===undefined||v==='')?'':r1(+v,d)};
 put('fruit_lb_per_gal',x.fruit_lb_per_gal,2);put('juice_gal_per_lb',x.juice_gal_per_lb,3);put('brix_fruit',x.brix_fruit,1);put('brix_desired',x.brix_desired,1);
 put('factor',x.factor||(x.sweetener==='honey'?C.honeyFactor:C.sugarFactor),3);put('fg',x.fg,3);put('liquid_sg',x.liquid_sg,4);q('sweetener').value=x.sweetener||'sugar';
 if(!T.description&&x.wine)q('description').value=D.yr+' '+x.wine;T.target_l=!fruitLb();T.water_l=T.sweet_lb=T.fill_l=false;swMat();upd()}
function swMat(){const k=q('sweetener').value==='honey'?'honey':'sugar',s=q('sweet_mid');const cur=s.options[s.selectedIndex];if(cur&&cur.dataset.kind===k)return;
 const o=[...s.options].find(o=>o.dataset.kind===k&&/cane/i.test(o.text))||[...s.options].find(o=>o.dataset.kind===k);if(o)s.value=o.value}
function codeHint(){const cd=q('code').value.trim().toLowerCase(),fr=D.fresh.find(b=>b.code.toLowerCase()===cd),ch=document.getElementById('codehint');
 const sb=exB();if(sb)ch.innerHTML='<b>'+esc(sb.code)+'</b> is already started — this finishes its plan (see step 5).';else if(fr)ch.innerHTML='<b>'+esc(fr.code)+'</b> exists but has no records yet — it will be continued.';
 else if(cd&&D.codes.includes(cd))ch.innerHTML='<span style="color:#b00">'+esc(q('code').value)+' is already used by another batch — pick a new name.</span>';
 else{const lk=L=>L.map(b=>'<a href="#" data-code="'+esc(b.code)+'">'+esc(b.code)+'</a>').join(', ');ch.innerHTML=[D.fresh.length?'Created but not started: '+lk(D.fresh):'',D.started.length?'Started this season: '+lk(D.started):''].filter(x=>x).join(' · ')+(D.fresh.length||D.started.length?' — click one to continue it.':'')}
 ch.querySelectorAll('a[data-code]').forEach(a=>a.onclick=ev=>{ev.preventDefault();q('code').value=a.dataset.code;T.code=true;upd()})}
function upd(){const e=exB(),fl=fruitLb();set('o_ftot',ticked().length||e?(e?'Already in '+e.code+': '+e.fruit.map(x=>x.item+' '+fmt(x.lb,1)+' lb').join(', ')+(ticked().length?' · plus ticked':'')+' · ':'')+'Fruit: '+fmt(fl,1)+' lb ('+fmt(fl*KG,1)+' kg)':'');
 D.lots.forEach(l=>set('k_'+l.id,'= '+fmt((parseFloat(q('amt_'+l.id).value)||0)*KG,1)+' kg'));
 let lbpg=nv('fruit_lb_per_gal');
 if(fl>0&&T.target_l&&nv('target_l')>0){lbpg=fl/(nv('target_l')/G);q('fruit_lb_per_gal').value=r1(lbpg,2)}else if(fl>0&&lbpg>0)q('target_l').value=r1(fl/lbpg*G,0);
 const L=nv('target_l'),sw=q('sweetener').value,honey=sw==='honey',k=honey?1/C.honeyLbPerGal:C.sugarVol;
 const f={target_l:L,fruit_lb_per_gal:lbpg,juice_gal_per_lb:nv('juice_gal_per_lb'),brix_fruit:nv('brix_fruit'),brix_desired:nv('brix_desired'),factor:nv('factor'),fg:nv('fg'),liquid_sg:nv('liquid_sg'),sweetener:sw};
 let x=fcalc(f,C);const rate=!(f.brix_desired>0)&&base&&base.sweet_lb_per_gal>0&&sw!=='none';
 if(rate){const lb=base.sweet_lb_per_gal*x.gal,vol=lb*k;x=Object.assign({},x,{lb:lb,vol:vol,water:x.gal-x.juice-vol,og:NaN})}
 const fr=fl>0?fl:x.fruit;set('o_fruit',fmt(fr,1));set('o_fruitk',(fl>0?'':'needed for this size · ')+'= '+fmt(fr*KG,1)+' kg');set('o_gal','= '+fmt(x.gal,1)+' gal');
 const cw=Math.max(x.water,0)*G,cs=x.lb;if(!T.sweet_lb)q('sweet_lb').value=r1(cs,1);
 const S=nv('sweet_lb'),jl=x.juice*G,sl=S*k*G;if(!T.fill_l)q('fill_l').value=r1(jl,1);const fillL=e?e.vol:nv('fill_l');
 if(!T.water_l)q('water_l').value=r1(Math.max(L-fillL-sl,0),1);const W=nv('water_l');
 const was=(id,key,v,u,alt)=>{const d=Math.abs(nv(key)-v)>0.05;document.getElementById(id).innerHTML=alt+(d?' · formula: '+fmt(v,1)+' '+u+' <a data-k="'+key+'">↺ use it</a>':'')};
 set('t_sw',honey?'Honey':(sw==='none'?'Sweetener (none)':'Sugar'));set('t_sw2',honey?'honey':'sugar');
 was('w_water','water_l',cw,'L','= '+fmt(W/G,1)+' gal');was('w_sweet','sweet_lb',cs,'lb','= '+fmt(S*KG,1)+' kg');
 fm.querySelectorAll('.was a[data-k]').forEach(a=>a.onclick=()=>{T[a.dataset.k]=false;upd()});
 const tot=fillL+W+sl;set('o_total',fmt(tot,0));set('o_totalg','= '+fmt(tot/G,1)+' gal');set('o_bot',fmt(tot/C.bottleL,0));set('k_fill','litres = '+fmt(nv('fill_l')/G,1)+' gal');
 let og=x.og;if(!rate&&(T.water_l||T.sweet_lb||T.fill_l)&&!f.liquid_sg){const gt=(jl+W+sl)/G,bf=gt?f.brix_fruit*x.juice/gt:0,bs=(f.factor&&gt)?S*16/(gt*f.factor):0;og=sgB(bf)+sgB(bs)-1}
 if(!(L>0))og=NaN;set('o_og',isFinite(og)?og.toFixed(3):'—');set('o_abv',isFinite(og)&&f.fg?fmt((og-f.fg)/0.0074,1):'—');document.getElementById('w_neg').style.display=x.water<-0.05?'':'none';
 const vsel=q('vessel_id');[...vsel.options].forEach(o=>{if(!o.dataset.cap)return;const c=+o.dataset.cap;o.text=o.dataset.t+(c&&c<tot?' — too small':'')});
 const xb=document.getElementById('exblock');q('existing_bid').value=e?e.id:'';xb.style.display=e?'':'none';document.getElementById('lab_vessel').style.display=e?'none':'';document.getElementById('lab_fill').style.display=e?'none':'';
 if(e){vsel.value='';xb.innerHTML='<b>'+esc(e.code)+'</b> is already in <b>'+esc(e.vcode)+'</b> with '+fmt(e.vol,1)+' L ('+fmt(e.vol/G,1)+' gal)'+(e.cap?' of '+fmt(e.cap,0)+' L':'')+'. Saving fills in its formulation and adds the water and sweetener there; the water default tops it up to the batch size.'+(e.adds.length?' Already added: '+e.adds.map(a=>a.kind+' '+fmt(a.amt,1)+(a.kind==='water'?' L':' lb')).join(', ')+'.':'')+(e.cap&&tot>e.cap?' <b style="color:#b00">The total is more than the vessel holds.</b>':'')}
 document.getElementById('vblock').style.display=(vsel.value||e)?'contents':'none';
 if(!T.code){const t=ticked();const yy=String(nv('vintage')||D.yr).slice(2,4);q('code').value=t.length?yy+t.map(l=>l.item.replace(/[^A-Za-z]/g,'')).join('').slice(0,16):''}
 codeHint()}
fm.addEventListener('input',e=>{const n=e.target.name;if(n in T)T[n]=true;if(n==='fruit_lb_per_gal')T.target_l=false;if(n==='code'){if(!base){const r=ranked();if(r.length)pick(r[0])}drawCands()}upd()});
fm.addEventListener('change',e=>{const n=e.target.name||'';if(/^use_/.test(n)){if(!base){const r=ranked();if(r.length)pick(r[0])}drawCands()}if(n==='sweetener'){const fa=nv('factor'),h=q('sweetener').value==='honey';if(h&&Math.abs(fa-C.sugarFactor)<0.01)q('factor').value=r1(C.honeyFactor,3);if(!h&&Math.abs(fa-C.honeyFactor)<0.01)q('factor').value=r1(C.sugarFactor,3);swMat()}upd()});
if(!base&&!D.posted){const r=ranked();if(r.length)base=r[0]}if(base&&!D.posted)pick(base);drawCands();swMat();upd();`;

const numOrNull = s => { const v = parseFloat(String(s ?? '').replace(/,/g, '')); return isFinite(v) ? v : null; };

export function post_start(c, fid, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  fid = fid || 0;
  const f0 = fid ? c.one('SELECT * FROM formula WHERE id=? AND deleted=0', fid) : null;
  if (fid && !f0) return [null, 'No such formulation.'];
  const when = entry._when(g('when'));
  const day = when.slice(0, 10);
  const code = g('code');
  if (!/^\d{2}[A-Za-z]/.test(code)) return [null, 'Batch code: the year then a name, e.g. 26Rhubarb2.'];
  const base = g('base_id') ? c.one('SELECT * FROM formula WHERE id=? AND deleted=0', Number(g('base_id'))) : null;
  const cat = (base && base.category) || (f0 && f0.category) || 'Fruit wine';
  const lots = c.all("SELECT * FROM ingredient_lot WHERE status='on_hand' AND kind='fruit'").filter(l => g('use_' + l.id));
  for (const l of lots) if (!(numOrNull(g('amt_' + l.id)) > 0)) return [null, `${l.item}: enter the pounds used.`];
  const P = {}; for (const k of F.FIELDS) P[k] = numOrNull(g(k));
  if (!(P.target_l > 0)) return [null, 'Batch size (litres) is needed — tick the fruit and pick a formulation, or type it in step 4.'];
  const sw = ['sugar', 'honey', 'none'].includes(g('sweetener')) ? g('sweetener') : 'sugar';
  const water_l = numOrNull(g('water_l')) || 0, sweet_lb = sw === 'none' ? 0 : (numOrNull(g('sweet_lb')) || 0);
  if (water_l < 0 || sweet_lb < 0) return [null, 'Water and sweetener can’t be negative.'];
  // batch: continue one created but not started, or create it
  let bid, existing = null;
  const ex = c.one('SELECT id, code FROM batch WHERE lower(code)=lower(?)', code);
  if (ex) {
    existing = started(c).find(b => b.id === ex.id) || null;
    if (!existing && !unstarted(c).some(b => b.id === ex.id)) return [null, `Batch ${ex.code} already exists and has records — pick a new name.`];
    bid = ex.id;
  } else {
    bid = entry.create_batch(c, code, g('description'), g('vintage'), g('beverage_type'), BASE[cat] || 'fruit', null, 'New Hampshire', null);
  }
  const bcode = c.val('SELECT code FROM batch WHERE id=?', bid);
  const year = Number(g('vintage')) || Number(day.slice(0, 4));
  const now = nowIso();
  // this batch's formulation: fill in the one already made for it (same name, not linked elsewhere), else a new one from the chosen past formulation
  const calc = F.calc({ ...P, sweetener: sw }, F.constants(c));
  const fruitTxt = (existing ? existing.fruit.map(x => `${x.item} ${x.lb} lb`) : []).concat(lots.map(l => `${l.item} ${g('amt_' + l.id)} lb`)).join(', ');
  const r1 = v => Math.round(v * 10) / 10;
  const diff = Math.abs(calc.water_l - water_l) > 0.5 || Math.abs(calc.lb - sweet_lb) > 0.5;
  const src = `Started ${day} as batch ${bcode}${base ? ` from ${base.name} (${base.year || '?'})` : ''}: water ${water_l} L, ${sw === 'none' ? 'no sweetener' : `${sw} ${sweet_lb} lb`}` +
    (diff && base && base.brix_desired ? ` (formula calc ${r1(Math.max(calc.water_l, 0))} L, ${r1(calc.lb)} lb)` : '');
  let tf = null;
  if (f0 && (!f0.batch_id || f0.batch_id === bid) && norm(f0.name) === norm(code)) tf = f0;
  if (!tf) tf = c.one("SELECT * FROM formula WHERE deleted=0 AND COALESCE(is_master,0)=0 AND lower(replace(name,' ',''))=? AND (batch_id IS NULL OR batch_id=?) ORDER BY id DESC", norm(code), bid);
  const model = P.brix_fruit !== null && P.brix_desired !== null ? 'brix' : ((base && base.model) || 'brix');
  const fnote = fruitTxt ? `Fruit used ${day}: ${fruitTxt}` : '';
  let formula_id;
  if (tf) {
    const keep = k => (tf[k] !== null && tf[k] !== '' ? tf[k] : (base ? base[k] : null));
    c.run(`UPDATE formula SET year=?, category=?, type=?, sweetener=?, model=?, ${F.FIELDS.map(k => k + '=?').join(', ')}, wine=?, yeast=?, fermenter=?, family=?, prep=?, lessons=?,
           sweet_lb_per_gal=?, fruit_notes=?, source=?, batch_id=?, updated_at=? WHERE id=?`,
      year, cat, cat, sw, model, ...F.FIELDS.map(k => P[k]), keep('wine'), keep('yeast'), keep('fermenter'), keep('family'), keep('prep'), keep('lessons'),
      base ? base.sweet_lb_per_gal : tf.sweet_lb_per_gal, [tf.fruit_notes, fnote].filter(x => x).join('\n') || null,
      [tf.source, src].filter(x => x).join(' · '), bid, now, tf.id);
    formula_id = tf.id;
  } else {
    const b = base || {};
    const cols = ['wine', 'family', 'role', 'liquid', 'blend_into', 'yeast', 'fermenter', 'prep', 'lessons', 'sweet_lb_per_gal', 'fruit_mix'];
    const vals = [bcode, year, cat, cat, sw, model, ...F.FIELDS.map(k => P[k]), ...cols.map(k => (b[k] === undefined ? null : b[k])),
      fnote || null, bid, b.family ? 'confirmed' : null, 'app', src, now, now];
    const cur = c.run(`INSERT INTO formula(name, year, type, category, sweetener, model, ${F.FIELDS.join(', ')}, ${cols.join(', ')}, fruit_notes, batch_id, family_status, origin, source, created_at, updated_at)
                       VALUES (${vals.map(() => '?').join(',')})`, ...vals);
    formula_id = cur.id;
  }
  // fruit off the on-hand list, into the batch
  for (const l of lots) {
    const [ok, err] = onhand.post_lot(c, { action: ['use'], id: [String(l.id)], use_amount: [g('amt_' + l.id)], use_unit: ['lb'], batch_id: [String(bid)],
      when: [day > today() ? today() : day], note: [`into ${bcode}`] });
    if (!ok) return [null, `${l.item}: ${err}`];
  }
  // vessel: the must, then the water and sweetener bringing it up to the total
  const v = existing ? String(existing.vessel_id) : g('vessel_id');
  if (v) {
    let fill;
    if (existing) {
      const st = entry.current_contents(c).find(x => x.vessel_id === existing.vessel_id);
      fill = st ? st.volume_l : existing.vol;
    } else {
      fill = numOrNull(g('fill_l'));
      if (!(fill > 0)) return [null, 'Enter the litres of fruit/must going into the vessel (or set the vessel to "not yet").'];
      const notes = g('notes') || null;
      captured(c, '/record/fill', { when: [when], batch_id: [String(bid)], fv: [v], fl: [String(fill)], notes: [g('notes')] },
        () => { e2.record_fill(c, when, bid, [[v, String(fill)]], notes); return ['ok', null]; });
    }
    if (g('rec_add')) {
      const later = m => { const d = new Date(when.replace(' ', 'T') + 'Z'); d.setUTCMinutes(d.getUTCMinutes() + m); return d.toISOString().slice(0, 19).replace('T', ' '); };
      const C = F.constants(c);
      let vol = fill;
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
        vol = r1(vol + sweet_lb * (sw === 'honey' ? 1 / C.honeyLbPerGal : C.sugarVol) * C.lPerGal);
        add(later(2), m.id, sweet_lb, 'lb', vol);
      }
    }
  }
  return [`/batch/${bid}?saved=1`, null];
}
