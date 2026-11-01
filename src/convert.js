// v1.68: two quick converters in the desktop top bar (right of quick search) — volume (US gal <-> L) and mass (lb <-> kg).
// Type a number; the ⇄ button between your number and the answer reverses the direction (your number stays).
// Direction remembered per browser. Pure client-side. Hidden on narrow screens; not on phone (cellar) pages.
const one = (id, a, b, f, title) => `<div class="qcv" id="${id}" data-a="${a}" data-b="${b}" data-f="${f}" title="${title}">
<input class="qci" inputmode="decimal" autocomplete="off" aria-label="Amount in ${a}"><span class="qcf">${a}</span>
<button type="button" class="qcx" title="Reverse direction" aria-label="Reverse direction">⇄</button>
<span class="qcr" aria-live="polite"><b>–</b> <span class="qct">${b}</span></span></div>`;
export const CONVERTER = `<div class="qconv">${one('qcvol', 'gal', 'L', '3.785411784', 'Volume: US gallons ⇄ litres')}${one('qcmass', 'lb', 'kg', '0.45359237', 'Mass: pounds ⇄ kilograms')}</div>
<style>.qconv{display:flex;align-items:center;gap:10px;flex:none;margin-left:4px;padding-left:12px;border-left:1px solid var(--line)}
.qcv{display:flex;align-items:center;gap:4px;border:1px solid var(--line2);border-radius:6px;background:var(--card);padding:2px 8px 2px 3px}
.qcv:focus-within{border-color:var(--acc)}
.qcv .qci{width:64px;border:1px solid rgba(210,153,34,.55);border-radius:4px;background:rgba(210,153,34,.16);color:var(--fg2);padding:4px 6px;text-align:right;font-size:14px;margin:1px 0}.qcv .qci:hover{background:rgba(210,153,34,.22)}.qcv .qci:focus{outline:none;border-color:#d29922;background:rgba(210,153,34,.24)}
.qcv .qcf,.qcv .qct{color:var(--mut);font-size:12.5px;min-width:16px}
.qcv .qcx{background:none;border:1px solid var(--line2);color:var(--acc);border-radius:5px;padding:1px 6px;font-size:14px;line-height:1.3;cursor:pointer;font-weight:400}
.qcv .qcx:hover{background:var(--hi);filter:none}
.qcv .qcr{min-width:78px;white-space:nowrap;font-size:13px}.qcv .qcr b{color:var(--fg2);font-weight:600;font-size:14px}
@media(max-width:1100px){.qconv{gap:6px}.qcv .qci{width:52px}.qcv .qcr{min-width:64px}}
@media(max-width:900px){.qconv{display:none}}</style>
<script>(function(){
function fmt(x){var a=Math.abs(x),d=a>=1000?1:a>=10?2:a>=1?3:4;return x.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:d})}
function parse(s){var t=String(s||'').replace(/ /g,'');if(t==='')return null;if(/^-?[0-9]{1,3}(,[0-9]{3})+([.][0-9]+)?$/.test(t))t=t.replace(/,/g,'');else if(/^-?[0-9]*,[0-9]+$/.test(t))t=t.replace(',','.');var n=Number(t);return isFinite(n)?n:NaN}
['qcvol','qcmass'].forEach(function(id){
 var el=document.getElementById(id);if(!el)return;
 var a=el.getAttribute('data-a'),b=el.getAttribute('data-b'),f=Number(el.getAttribute('data-f'));
 var inp=el.querySelector('.qci'),from=el.querySelector('.qcf'),to=el.querySelector('.qct'),res=el.querySelector('.qcr b'),rev=false,key='hwt_conv_'+id;
 
 function go(){var u=rev?b:a,v=rev?a:b;from.textContent=u;to.textContent=v;inp.setAttribute('aria-label','Amount in '+u);
  var n=parse(inp.value);if(n===null){res.textContent='–';res.style.color='';return}
  if(isNaN(n)){res.textContent='?';res.style.color='#d29922';return}
  res.style.color='';res.textContent=fmt(rev?n/f:n*f)}
 inp.addEventListener('input',go);
 inp.addEventListener('keydown',function(e){if(e.key==='Escape'){inp.value='';go();inp.blur()}});
 el.querySelector('.qcx').addEventListener('click',function(){rev=!rev;go();inp.focus()});
 go();
});
})()</script>`;
