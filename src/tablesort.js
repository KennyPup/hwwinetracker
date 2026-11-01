// v0.9.9 — click any table header to sort that column: numbers and money highest first, text A→Z; click again to
// reverse. Blank cells always go last. v1.16: a cell's data-v (if any) is its sort value; one-cell group rows (e.g. a vintage
// heading spanning the table) no longer block sorting — they are hidden once the table is sorted. Entry grids inside forms and tables marked class="nosort" are left alone.
export const TABLESORT = `<style>th.srt{cursor:pointer;user-select:none;white-space:normal}th.srt:hover{color:var(--fg,#e6edf3)}
th.srt[data-dir]::after{content:' \\25BC';font-size:10px;opacity:.8}th.srt[data-dir=asc]::after{content:' \\25B2'}</style>
<script>(function(){
var NUM=/^[\\u2212\\u2013\\-+]?\\$?\\s*\\d[\\d,]*(\\.\\d+)?\\s*(%|L|kg|g|ml|gal|lb)?$|^[\\u2212\\u2013\\-+]?\\$?\\s*\\.\\d+$/;
function txt(td){return td?(td.dataset.v!==undefined?td.dataset.v:(td.textContent||'')).trim():''}
function val(s){return parseFloat(s.replace(/[\\u2212\\u2013]/g,'-').replace(/[^0-9.\\-]/g,''))}
function setup(t){
  if(t.dataset.srt||t.classList.contains('nosort')||t.closest('form'))return;
  var head=t.tHead,body=t.tBodies[0];if(!head||!body||!head.rows.length)return;
  function grp(r){return r.cells.length===1&&r.cells[0].colSpan>1}
  var rows=[].slice.call(body.rows).filter(function(r){return !grp(r)});if(rows.length<2||rows.some(function(r){return [].some.call(r.cells,function(c){return c.colSpan>1||c.rowSpan>1})}))return;
  t.dataset.srt='1';
  [].forEach.call(head.rows[head.rows.length-1].cells,function(th,ci){
    th.classList.add('srt');th.title='Sort';
    th.addEventListener('click',function(){
      [].forEach.call(body.rows,function(r){if(grp(r))r.style.display='none'});var rs=[].slice.call(body.rows).filter(function(r){return !grp(r)}),vs=rs.map(function(r){return txt(r.cells[ci])}),ne=vs.filter(function(v){return v!==''});
      var isNum=ne.length&&ne.filter(function(v){return NUM.test(v)}).length>=ne.length*0.8;
      var dir=th.dataset.dir?(th.dataset.dir==='desc'?'asc':'desc'):(isNum?'desc':'asc');
      [].forEach.call(head.querySelectorAll('th'),function(h){delete h.dataset.dir});th.dataset.dir=dir;
      var m=dir==='asc'?1:-1,ix=rs.map(function(r,i){return i});
      ix.sort(function(a,b){var x=vs[a],y=vs[b];if(x===''&&y==='')return a-b;if(x==='')return 1;if(y==='')return -1;
        var d;if(isNum){var p=val(x),q=val(y);d=(isNaN(p)?-Infinity:p)-(isNaN(q)?-Infinity:q)}else d=x.localeCompare(y,undefined,{numeric:true,sensitivity:'base'});
        return d?d*m:a-b});
      var f=document.createDocumentFragment();ix.forEach(function(i){f.appendChild(rs[i])});body.appendChild(f);
    });
  });
}
function all(){[].forEach.call(document.querySelectorAll('table'),setup)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',all);else all();
})()</script>`;
