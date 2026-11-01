// v1.35 — table headers stay in view while the page scrolls, on every desktop page. Plain CSS sticky headers (th top:58px,
// under the top bar) stop working when a table sits in a box that scrolls sideways (Stock, a wine's history, SO₂, lab
// grids…), so for those tables the header row is slid down with the page instead. Tables in their own tall scroll box
// (formulation tables, dispatch grid) are left alone — their headers already stick inside that box.
export const STICKYHEAD = `<script>(function(){
var L=[],raf=0;
function barBottom(){var t=document.querySelector('.top');if(!t)return 0;var b=t.getBoundingClientRect().bottom;return b>0?b:0}
function scroller(el){for(var p=el;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){var cs=getComputedStyle(p);
 if(/(auto|scroll|hidden|clip)/.test(cs.overflowX+' '+cs.overflowY))return p}return null}
function scan(){L.forEach(function(o){o.cells.forEach(function(c){c.style.transform=''})});L=[];
 document.querySelectorAll('table').forEach(function(tb){var h=tb.tHead;if(!h||!h.rows.length||!tb.offsetParent)return;
  var sc=scroller(tb);if(!sc)return;if(sc.scrollHeight>sc.clientHeight+2)return;
  var cells=[];for(var i=0;i<h.rows.length;i++)for(var j=0;j<h.rows[i].cells.length;j++)cells.push(h.rows[i].cells[j]);
  cells.forEach(function(c){c.style.setProperty('position','relative','important');c.style.setProperty('top','0','important');c.style.setProperty('z-index','3','important');c.style.willChange='transform'});
  L.push({tb:tb,h:h,cells:cells})});upd()}
function upd(){raf=0;var top=barBottom();L.forEach(function(o){var r=o.tb.getBoundingClientRect(),hh=o.h.offsetHeight,
  d=Math.max(0,Math.min(top-r.top,r.height-hh-(o.tb.tBodies[0]&&o.tb.tBodies[0].rows.length?24:0)));
  var v=d>0.5?'translateY('+d.toFixed(1)+'px)':'';o.cells.forEach(function(c){if(c.style.transform!==v)c.style.transform=v});
  o.h.classList.toggle('stuck',d>0.5)})}
function q(){if(!raf)raf=requestAnimationFrame(upd)}
var st=0;function rescan(){clearTimeout(st);st=setTimeout(scan,60)}
addEventListener('scroll',q,{passive:true});addEventListener('resize',rescan);document.addEventListener('toggle',rescan,true);
document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('summary,button,.tabs a'))rescan()},true);
var s=document.createElement('style');s.textContent='thead.stuck th{box-shadow:0 2px 4px rgba(0,0,0,.45),0 1px 0 var(--line2,#30363d)}';document.head.appendChild(s);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();addEventListener('load',scan);
})();</script>`;
