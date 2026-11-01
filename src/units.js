// Mixed units everywhere: Ken works in both. A small script on every page adds the other unit beside each amount:
// kg ⇄ lb, L ⇄ gal, °C ⇄ °F — in text ("13.6 kg" → "13.6 kg (30 lb)"), in table columns (an Amount + Unit pair, or a
// column headed "(L)", "Gal", "°C", "In kg" …) and as a live hint under amount inputs. Display only — nothing stored changes.
export const UNITS = `<style>.uc{color:var(--mut,#8b949e);font-size:.85em;margin-left:4px;white-space:nowrap;font-weight:normal}.uch{display:block;color:var(--mut,#8b949e);font-size:12px;min-height:14px;margin-top:2px}</style>
<script>(function(){
var LB=0.45359237,GAL=3.785411784;
function f(x){var a=Math.abs(x),d=a<10?2:a<100?1:0;var s=x.toFixed(d);if(d)s=s.replace(/\\.?0+$/,'');var p=s.split('.');p[0]=p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');return p.join('.');}
function norm(u){u=(u||'').trim().toLowerCase();if(u==='lbs'||u==='pounds')return'lb';if(u==='kilograms')return'kg';if(u==='litres'||u==='liters'||u==='l')return'l';if(u==='gallons')return'gal';if(u==='tempc'||u==='c')return'°c';if(u==='f')return'°f';return u;}
function conv(v,u){u=norm(u);if(!isFinite(v))return null;
 if(u==='kg')return f(v/LB)+' lb';if(u==='lb')return f(v*LB)+' kg';if(u==='l')return f(v/GAL)+' gal';if(u==='gal')return f(v*GAL)+' L';
 if(u==='°c')return Math.round(v*9/5+32)+' °F';if(u==='°f')return f((v-32)*5/9)+' °C';return null;}
function numOf(t){t=(t||'').replace(/,/g,'').trim();var m=t.match(/^[-−]?\\d+(\\.\\d+)?/);return m?parseFloat(m[0].replace('−','-')):NaN;}
function tag(txt){var s=document.createElement('span');s.className='uc';s.textContent='('+txt+')';return s;}
var SKIP='script,style,textarea,select,option,input,button,.uc,.uch,.ncard,.note,[data-nouc]';
var RX=/(^|[^\\w.\\-])(?:([-−]?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|[-−]?\\d+(?:\\.\\d+)?)\\s?[–-]\\s?)?([-−]?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|[-−]?\\d+(?:\\.\\d+)?)(?:\\s(kg|lbs?|L|gal)|\\s?(°C|°F))(?![\\w\\-°])/g;
var PAIR_AFTER=/^\\s*(?:\\(|[·\\/]\\s*[-−]?[\\d,.]+\\s?(?:kg|lbs?|L|gal|°C|°F))/,PAIR_BEFORE=/(?:kg|lbs?|L|gal|°C|°F)\\s*[·\\/]\\s*$/;
function textPass(root){
 var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),nodes=[],n;
 while(n=w.nextNode()){if(!n.nodeValue||!/\\d/.test(n.nodeValue))continue;var p=n.parentElement;if(p&&p.closest&&p.closest(SKIP))continue;if(p&&p.closest&&p.closest('td')&&p.closest('table').dataset.ucDone)continue;nodes.push(n);}
 nodes.forEach(function(n){var t=n.nodeValue,out=[],last=0,m;RX.lastIndex=0;var any=false;
  while(m=RX.exec(t)){var end=m.index+m[0].length,rest=t.slice(end),before=t.slice(0,m.index+m[1].length);
   var nextEl=n.nextSibling;var already=PAIR_AFTER.test(rest)||(!rest.trim()&&nextEl&&nextEl.nodeType===1&&/^\\s*\\(/.test(nextEl.textContent||''))
     ||/\\(\\s*$/.test(before)||PAIR_BEFORE.test(before)||(!before.trim()&&n.previousSibling&&/\\(\\s*$/.test(n.previousSibling.textContent||''));
   if(already)continue;var u=m[4]||m[5],P=function(s){return parseFloat(s.replace(/,/g,'').replace('−','-'))};var c=conv(P(m[3]),u);if(!c)continue;
   if(m[2]){var c0=conv(P(m[2]),u);if(c0)c=c0.replace(/\\s\\S+$/,'')+'–'+c;}
   out.push(document.createTextNode(t.slice(last,end)));out.push(tag(c));last=end;any=true;}
  if(!any)return;out.push(document.createTextNode(t.slice(last)));var fr=document.createDocumentFragment();out.forEach(function(x){fr.appendChild(x)});n.parentNode.replaceChild(fr,n);});}
function colUnit(h){h=(h||'').replace(/\\s+/g,' ').trim().toLowerCase();var m=h.match(/\\((kg|l|lb|gal|°c|°f)\\)\\s*$/);if(m)return m[1];
 if(/^(gal|kg|lb|°c|°f|tempc|temp °c|temp)$/.test(h))return h==='temp'||h==='tempc'||h==='temp °c'?'°c':h;m=h.match(/^in (kg|l|lb|gal)$/);if(m)return m[1];
 var nm={litres:'l',liters:'l',l:'l',gallons:'gal',lbs:'lb',pounds:'lb',kilograms:'kg'};return nm[h]||null;}
var OPP={kg:'lb',lb:'kg',l:'gal',gal:'l','°c':'°f','°f':'°c'};
function tablePass(root){(root.querySelectorAll?root.querySelectorAll('table'):[]).forEach(function(tb){if(tb.closest('[data-nouc]'))return;var hr=tb.tHead&&tb.tHead.rows[0];if(!hr)return;
 var hs=[].map.call(hr.cells,function(c){return c.textContent});var unitCol=-1,cols={};
 hs.forEach(function(h,i){if(/^\\s*unit\\s*$/i.test(h))unitCol=i;var u=colUnit(h);if(u)cols[i]=u;});
 for(var ci in cols){var j=+ci+1;if(cols[j]&&OPP[cols[ci]]===cols[j]){delete cols[ci];delete cols[j];}}
 if(unitCol<1&&!Object.keys(cols).length)return;
 [].forEach.call(tb.tBodies,function(b){[].forEach.call(b.rows,function(r){
  function add(cell,u){if(!cell||cell.querySelector('.uc')||/\\(/.test(cell.textContent))return;var v=numOf(cell.textContent);var c=conv(v,u);if(c)cell.appendChild(tag(c));}
  if(unitCol>0&&r.cells[unitCol])add(r.cells[unitCol-1],r.cells[unitCol].textContent);
  for(var i in cols)add(r.cells[i],cols[i]);});});
 tb.dataset.ucDone='1';});}
function inputPass(root){(root.querySelectorAll?root.querySelectorAll('input[inputmode=decimal],input[type=number]'):[]).forEach(function(inp){
 if(inp.dataset.uc)return;var lab=inp.closest('label');if(!lab)return;var lt=(lab.childNodes[0]&&lab.childNodes[0].nodeValue)||lab.textContent;var fixed=null;
 if(/\\(L\\)|^\\s*litres|litres moved|or volume \\(L\\)/i.test(lt))fixed='l';else if(/\\(kg\\)/i.test(lt))fixed='kg';else if(/\\(gal\\)/i.test(lt))fixed='gal';else if(/\\(lb\\)/i.test(lt))fixed='lb';
 var sel=null;if(!fixed){var nx=lab.nextElementSibling;var s=nx&&nx.querySelector&&nx.querySelector('select[name$=unit]');if(s&&/^(lb|kg|L|gal)$/.test(s.value||s.options[0].value))sel=s;}
 if(!fixed&&!sel)return;inp.dataset.uc='1';var h=document.createElement('span');h.className='uch';lab.appendChild(h);
 function upd(){var v=numOf(inp.value);var c=inp.value.trim()?conv(v,fixed||sel.value):null;h.textContent=c?'= '+c:'';}
 inp.addEventListener('input',upd);if(sel)sel.addEventListener('change',upd);upd();});}
function run(root){try{tablePass(root);textPass(root);inputPass(root);}catch(e){}}
function all(){run(document.body);document.querySelectorAll('template').forEach(function(t){run(t.content)});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',all);else all();
window.hwtUnits=run;})();</script>`;
