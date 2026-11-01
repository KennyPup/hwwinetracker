// v1.22 — Dispatch (BOL) as a list of lines: one header (date, type) + many wine lines, built for the phone and for 15–20 wines a time.
// Same data model as before (dispatch + dispatch_line + stock_event, written by entry2.record_dispatch in one transaction).
// Over-stock and duplicate wines are flagged, not blocked; duplicates are summed into one line at save. Draft kept in the browser until saved.
import { tip as HELP } from './help.js';
import { E } from './lib/py.js';

const arr = (f, k) => { const v = f[k]; return v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]; };
const one = (f, k, d = '') => { const v = f[k]; return v === undefined || v === null ? d : Array.isArray(v) ? (v[0] ?? d) : v; };
export const DEFAULT_TYPE = 'Tasting room Samples';

export function page_dispatch(c, token, f = null, err = '') {
  f = f || {};
  const types = c.all('SELECT name, ttb_line FROM dispatch_type WHERE active=1 ORDER BY sort');
  const tsel = one(f, 'dispatch_type', types.some(t => t.name === DEFAULT_TYPE) ? DEFAULT_TYPE : (types[0] || {}).name);
  const to = types.map(t => `<option ${tsel === t.name ? 'selected' : ''}>${E(t.name)}</option>`).join('');
  const dests = c.col('SELECT destination FROM dispatch WHERE destination IS NOT NULL GROUP BY destination ORDER BY COUNT(*) DESC LIMIT 30').map(d => `<option value="${E(d)}">`).join('');
  const nb = (c.val("SELECT MAX(CAST(bol AS INTEGER)) FROM dispatch WHERE bol GLOB '[0-9]*'") || 0) + 1;
  const stock = new Map(c.all('SELECT item_id, SUM(quantity) q FROM stock_event GROUP BY item_id').map(r => [r.item_id, r.q]));
  const last = new Map(c.all('SELECT dl.item_id, MAX(d.occurred_at) t FROM dispatch_line dl JOIN dispatch d ON d.id=dl.dispatch_id WHERE d.reversed=0 GROUP BY dl.item_id').map(r => [r.item_id, r.t]));
  const items = c.all('SELECT id, code, description, name, unit FROM stock_item WHERE is_finished=1 AND inactive=0')
    .map(r => ({ id: r.id, c: r.code, d: r.description || r.name || '', oh: Math.round(stock.get(r.id) || 0), t: last.get(r.id) || '' }))
    .sort((a, b) => ((b.oh > 0) - (a.oh > 0)) || (a.t < b.t ? 1 : a.t > b.t ? -1 : 0) || (a.c < b.c ? -1 : 1));
  const I = arr(f, 'it'), Q = arr(f, 'iq');
  const posted = I.map((id, i) => ({ id: Number(id) || 0, q: String(Q[i] ?? '') })).filter(x => x.id || x.q);
  const data = { items, posted, d: one(f, 'd', ''), types: types.map(t => t.name) };
  const body = `<h1>New dispatch${HELP('dispatch')}</h1>${err}
<form class="dsp" method="post" action="/record/dispatch" id="dspf" autocomplete="off"><input type="hidden" name="_t" value="${E(token)}">
<input type="hidden" name="ui" value="lines"><input type="hidden" name="allow_negative" value="1"><input type="hidden" name="when" id="dwhen">
<div class="dh"><label>Date<input type="date" name="d" id="dd" required></label><label>Type<select name="dispatch_type" id="dt">${to}</select></label></div>
<details class="dmore"><summary>To, BOL #, notes</summary><div class="dh"><label>To<input name="destination" id="ddest" list="dests" value="${E(one(f, 'destination', 'Hermit Woods Winery'))}"><datalist id="dests">${dests}</datalist></label>
<label>BOL #<input name="bol" id="dbol" value="${E(one(f, 'bol', String(nb)))}" style="width:7em"></label><label class="wide">Notes<input name="notes" id="dnotes" value="${E(one(f, 'notes', ''))}"></label></div></details>
<div id="dmsg"></div>
<div class="dlh"><span>Wine</span><span>Bottles</span><span></span></div>
<div id="dl"></div>
<div class="dbar"><button type="button" id="dadd">＋ Add line</button><span id="dsum" class="dsum"></span></div>
<div class="dact"><button id="dsave">Save dispatch</button><button type="button" id="ddiscard" class="dsec">Discard draft</button><a href="/dispatches">Cancel</a></div>
</form>
<div id="dpl" class="dpl" hidden></div>
<script>window.DSP=${JSON.stringify(data).replace(/</g, '\\u003c')};</script><script>${CLIENT}</script><style>${CSS}</style>`;
  return body;
}

// POST: merge duplicate wines, whole bottles only, never blocked by stock (flagged on screen instead)
export function lines_from_post(f) {
  const I = f.it || [], Q = f.iq || [];
  const m = new Map(), bad = [];
  I.forEach((id, i) => {
    const q = String(Q[i] ?? '').trim();
    if (!id && !q) return;
    if (!id) { bad.push('a line has bottles but no wine'); return; }
    if (!/^[0-9]+$/.test(q) || Number(q) <= 0) { bad.push('bottles must be a whole number above 0'); return; }
    m.set(String(id), (m.get(String(id)) || 0) + Number(q));
  });
  return { lines: [...m.entries()].map(([id, q]) => [id, String(q)]), bad: [...new Set(bad)] };
}

const CSS = `.dsp{max-width:760px}.dsp label{display:flex;flex-direction:column;gap:3px;font-size:13px;color:var(--mut)}
.dsp input,.dsp select{font-size:16px;padding:8px;border:1px solid var(--line2);border-radius:6px;background:var(--card);color:var(--fg2)}
.dh{display:flex;flex-wrap:wrap;gap:10px 14px;margin:6px 0 8px}.dh .wide{flex:1 1 260px}.dmore summary{cursor:pointer;color:var(--mut);font-size:13px;padding:4px 0}
.dlh,.dr{display:grid;grid-template-columns:minmax(0,1fr) 6.5em 2.6em;gap:8px;align-items:start}.dlh{font-size:12px;color:var(--mut);margin-top:10px;padding:0 2px}
.dr{padding:8px 0;border-bottom:1px solid var(--line)}.dr .pk{position:relative;min-width:0}.dr .wq{width:100%;box-sizing:border-box}.dr .bq{width:100%;box-sizing:border-box;text-align:right}
.dr .x{background:none;border:1px solid var(--line2);color:var(--mut);border-radius:6px;font-size:20px;line-height:1;padding:7px 0;width:100%;cursor:pointer;margin:0}
.dr .inf{grid-column:1/-1;font-size:12.5px;color:var(--mut);min-height:0}.dr .inf b{color:var(--fg)}.dr .fl{color:#d29922}.dr.warn .wq,.dr.warn .bq{border-color:#9e6a03}
.dbar{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin:10px 0}.dbar button,.dact button{font-size:15px;padding:9px 16px;border-radius:7px;cursor:pointer;width:auto;margin:0}
#dadd{background:var(--card);color:var(--fg2);border:1px solid var(--line2)}.dsum{font-size:14px;color:var(--fg)}.dsum .fl{color:#d29922}
.dact{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin:14px 0 30px}.dact .dsec{background:none;border:1px solid var(--line2);color:var(--mut)}
#dmsg .ok,#dmsg .err{margin:6px 0}.dpl{position:absolute;z-index:60;background:var(--card);border:1px solid var(--line2);border-radius:8px;max-height:46vh;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.dpl div{padding:9px 10px;border-bottom:1px solid var(--line);cursor:pointer;font-size:15px;color:var(--fg2);display:flex;justify-content:space-between;gap:10px}
.dpl div span{color:var(--mut);font-size:13px;white-space:nowrap}.dpl div.on,.dpl div:hover{background:#1f2937}.dpl .hd{cursor:default;font-size:12px;color:var(--mut);background:none!important}
.dpl div.z{color:var(--mut)}
@media(max-width:560px){.dlh{display:none}.dr{grid-template-columns:minmax(0,1fr) 6em 2.6em}}`;

// client: no backticks or dollar-brace in here (it sits inside a template literal)
const CLIENT = `(function(){
var D=window.DSP,KEY='hwt_dispatch_draft_v1',items=D.items,byId={},rows=[],act=null,hi=0,dirty=false;
items.forEach(function(it){byId[it.id]=it});
var dl=document.getElementById('dl'),pl=document.getElementById('dpl'),form=document.getElementById('dspf'),dd=document.getElementById('dd'),ddest=document.getElementById('ddest'),dbol=document.getElementById('dbol'),dnotes=document.getElementById('dnotes'),dt=document.getElementById('dt'),msg=document.getElementById('dmsg');
function p2(n){return(n<10?'0':'')+n}
function todayLocal(){var d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
function lbl(it){return it.c+(it.d?' · '+it.d:'')}
function esc(s){return String(s).replace(/[&<>"]/g,function(ch){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]})}
function ls(fn){try{return fn()}catch(e){return null}}
function addRow(id,q,focus){
  var r=document.createElement('div');r.className='dr';
  r.innerHTML='<div class="pk"><input class="wq" placeholder="Wine — type code or name" autocomplete="off" autocapitalize="characters" spellcheck="false"><input type="hidden" name="it"></div>'+
   '<input class="bq" name="iq" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off"><button type="button" class="x" title="Remove this line" aria-label="Remove line">×</button><div class="inf"></div>';
  dl.appendChild(r);var o={el:r,wq:r.querySelector('.wq'),hid:r.querySelector('[name=it]'),bq:r.querySelector('.bq'),inf:r.querySelector('.inf'),id:0};rows.push(o);
  if(id&&byId[id]){o.id=id;o.hid.value=id;o.wq.value=lbl(byId[id])}
  if(q)o.bq.value=q;
  o.wq.addEventListener('focus',function(){openPick(o)});
  o.wq.addEventListener('input',function(){o.id=0;o.hid.value='';openPick(o);trail();refresh()});
  o.wq.addEventListener('keydown',function(e){pickKey(e,o)});
  o.wq.addEventListener('blur',function(){setTimeout(function(){if(act===o)closePick();if(!o.id&&o.wq.value.trim()){var m=match(o.wq.value);if(m.length===1)choose(o,m[0],false)}refresh()},180)});
  o.bq.addEventListener('input',function(){trail();refresh()});
  o.bq.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();var nx=rows[rows.indexOf(o)+1];if(nx){nx.wq.focus()}else{addRow(0,'',true)}}});
  o.bq.setAttribute('enterkeyhint','next');o.wq.setAttribute('enterkeyhint','next');
  r.querySelector('.x').addEventListener('click',function(){removeRow(o)});
  if(focus)o.wq.focus();
  refresh();return o;
}
function removeRow(o){var i=rows.indexOf(o);if(i<0)return;if(act===o)closePick();o.el.remove();rows.splice(i,1);trail();refresh()}
// always one empty line at the bottom, so the phone keyboard's next arrow (or Enter) goes straight to the next wine
function trail(){var l=rows[rows.length-1];if(!l||l.id||l.bq.value.trim()||l.wq.value.trim())addRow(0,'',false)}
function match(t){t=(t||'').toLowerCase().trim();var w=t.split(/[ ]+/).filter(Boolean);
  return items.filter(function(it){var s=(it.c+' '+it.d).toLowerCase();for(var i=0;i<w.length;i++)if(s.indexOf(w[i])<0)return false;return w.length?true:it.oh>0}).filter(function(it){return it.oh>0||t.length>=2})}
function openPick(o){act=o;hi=0;var m=match(o.wq.value).slice(0,60);
  if(!m.length){pl.innerHTML='<div class="hd">'+(o.wq.value.trim()?'No bottled wine matches “'+esc(o.wq.value)+'”':'No bottled stock on hand')+'</div>'}
  else{var h='',z=false;m.forEach(function(it,i){if(it.oh<=0&&!z){z=true;h+='<div class="hd">Not in stock</div>'}h+='<div data-i="'+it.id+'" class="'+(i===0?'on ':'')+(it.oh>0?'':'z')+'">'+esc(lbl(it))+'<span>'+it.oh+' on hand</span></div>'});pl.innerHTML=h}
  var r=o.wq.getBoundingClientRect();pl.style.left=(r.left+window.scrollX)+'px';pl.style.top=(r.bottom+window.scrollY+2)+'px';pl.style.width=Math.max(r.width,Math.min(420,window.innerWidth-24))+'px';
  if(r.left+Math.max(r.width,Math.min(420,window.innerWidth-24))>window.innerWidth-8)pl.style.left=(window.scrollX+8)+'px';
  pl.hidden=false}
function closePick(){pl.hidden=true;act=null}
pl.addEventListener('mousedown',function(e){e.preventDefault()});
pl.addEventListener('click',function(e){var d=e.target.closest('[data-i]');if(d&&act)choose(act,byId[d.dataset.i],true)});
function opts(){return pl.querySelectorAll('[data-i]')}
function pickKey(e,o){var os=opts();
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(pl.hidden)openPick(o);if(!os.length)return;os[hi].classList.remove('on');hi=(hi+(e.key==='ArrowDown'?1:-1)+os.length)%os.length;os[hi].classList.add('on');os[hi].scrollIntoView({block:'nearest'})}
  else if(e.key==='Enter'){e.preventDefault();if(!pl.hidden&&os.length)choose(o,byId[os[hi].dataset.i],true);else if(o.id)o.bq.focus()}
  else if(e.key==='Escape'){closePick()}}
function choose(o,it,focusQty){o.id=it.id;o.hid.value=it.id;o.wq.value=lbl(it);closePick();trail();refresh();if(focusQty){o.bq.focus();o.bq.select&&o.bq.select()}}
function refresh(){var n=0,b=0,fl=0,seen={};
  rows.forEach(function(o,i){var it=o.id?byId[o.id]:null,q=o.bq.value.trim(),qn=/^[0-9]+$/.test(q)?Number(q):NaN,f=[];
    if(it){if(seen[it.id])f.push('also on line '+seen[it.id]+' — will be added together');else seen[it.id]=i+1}
    if(it&&q&&qn>it.oh)f.push('more than on hand ('+it.oh+')');
    if(q&&!(qn>0))f.push('bottles must be a whole number above 0');
    if(!it&&o.wq.value.trim())f.push('pick a wine from the list');
    if(!it&&q)f.push('no wine picked');
    if(it||q){n++;if(qn>0)b+=qn}
    if(f.length)fl++;
    o.el.classList.toggle('warn',f.length>0);
    o.inf.innerHTML=(it?'<b>'+it.oh+'</b> on hand':'')+(f.length?(it?' · ':'')+'<span class="fl">⚠ '+esc(f.join(' · '))+'</span>':'')});
  document.getElementById('dsum').innerHTML=n?('<b>'+n+'</b> line'+(n===1?'':'s')+' · <b>'+b+'</b> bottle'+(b===1?'':'s')+(fl?' · <span class="fl">⚠ '+fl+' flagged</span>':'')):'No lines yet';
  save()}
function state(){return{d:dd.value,t:dt.value,to:ddest.value,bol:dbol.value,notes:dnotes.value,lines:rows.filter(function(o){return o.id||o.bq.value.trim()}).map(function(o){return{id:o.id,q:o.bq.value.trim()}}),at:new Date().toISOString()}}
var ready=false;
function save(){if(!ready)return;var s=state();ls(function(){if(s.lines.length)localStorage.setItem(KEY,JSON.stringify(s));else localStorage.removeItem(KEY)})}
['change','input'].forEach(function(ev){[dd,dt,ddest,dbol,dnotes].forEach(function(x){x.addEventListener(ev,save)})});
document.getElementById('dadd').addEventListener('click',function(){addRow(0,'',true)});
document.getElementById('ddiscard').addEventListener('click',function(){var n=state().lines.length;if(n&&!confirm('Discard this draft ('+n+' line'+(n===1?'':'s')+')?'))return;
  ls(function(){localStorage.removeItem(KEY)});rows.slice().forEach(function(o){o.el.remove()});rows=[];dd.value=todayLocal();dt.value=D.types.indexOf('${DEFAULT_TYPE}')>=0?'${DEFAULT_TYPE}':dt.value;dnotes.value='';addRow(0,'',true);msg.innerHTML='<div class="ok">Draft discarded.</div>'});
form.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.tagName==='INPUT')e.preventDefault()});
form.addEventListener('submit',function(e){
  var live=rows.filter(function(o){return o.id||o.bq.value.trim()}),bad=[];
  live.forEach(function(o,i){var q=o.bq.value.trim();if(!o.id)bad.push('line '+(rows.indexOf(o)+1)+': pick a wine');else if(!/^[0-9]+$/.test(q)||Number(q)<=0)bad.push('line '+(rows.indexOf(o)+1)+': bottles must be a whole number above 0')});
  if(!live.length){e.preventDefault();alert('Add at least one wine and its bottles.');return}
  if(bad.length){e.preventDefault();alert('Fix before saving:\\n'+bad.join('\\n'));return}
  if(!dd.value){e.preventDefault();alert('Set the date.');return}
  var pr=dd.value.split('-'),dlab=new Date(+pr[0],+pr[1]-1,+pr[2]).toDateString(),now=new Date();
  var tm=dd.value===todayLocal()?p2(now.getHours())+':'+p2(now.getMinutes()):'12:00';
  var bt=live.reduce(function(s,o){return s+Number(o.bq.value)},0);
  if(!confirm('Save '+live.length+' line'+(live.length===1?'':'s')+' ('+bt+' bottles), '+dt.value+', '+dlab+'?')){e.preventDefault();return}
  document.getElementById('dwhen').value=dd.value+' '+tm;
  rows.forEach(function(o){if(live.indexOf(o)<0){o.hid.disabled=true;o.bq.disabled=true}});
  var b=document.getElementById('dsave');setTimeout(function(){b.disabled=true;b.textContent='Saving…'},0);
});
// start: lines posted back after an error win; otherwise the browser draft; otherwise one empty line
var dr=ls(function(){return JSON.parse(localStorage.getItem(KEY)||'null')});
if(D.posted.length){dd.value=D.d||todayLocal();D.posted.forEach(function(x){addRow(x.id,x.q,false)});addRow(0,'',false)}
else if(dr&&dr.lines&&dr.lines.length){dd.value=dr.d||todayLocal();if(dr.t&&D.types.indexOf(dr.t)>=0)dt.value=dr.t;if(dr.to)ddest.value=dr.to;if(dr.notes)dnotes.value=dr.notes;
  dr.lines.forEach(function(x){addRow(x.id,x.q,false)});addRow(0,'',false);
  var at=new Date(dr.at);msg.innerHTML='<div class="ok">Draft restored: '+dr.lines.length+' line'+(dr.lines.length===1?'':'s')+(isNaN(at)?'':' (last change '+at.toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'})+')')+'. Keep going, or “Discard draft” to start over.</div>'}
else{dd.value=D.d||todayLocal();addRow(0,'',false)}
ready=true;refresh();
window.addEventListener('scroll',function(){if(act)openPick(act)},{passive:true});
window.addEventListener('pageshow',function(e){if(e.persisted){var b=document.getElementById('dsave');b.disabled=false;b.textContent='Save dispatch'}});
})()`;
