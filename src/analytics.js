// v1.3 — Analytics: fermentations of one wine across vintages, side by side.
// Sugar (°Brix; SG readings converted so each curve runs on) and temperature (°F) against days since the ferment's first
// sugar reading — two charts on one shared day axis (never a dual axis), additions and notes on an event strip under them,
// a per-vintage summary table, and an outcome rating per batch (Excellent / Good / Issues + reason) that Ken sets.
// Notes are also flagged automatically by words that usually mean a problem (H2S, stuck, VA, film yeast …) or a success.
import { E, nowIso } from './lib/py.js';
import { ctx, page } from './core.js';
import { TABS as FTABS } from './film.js';

export function ensure_schema(db) {
  db.run('CREATE TABLE IF NOT EXISTS batch_outcome(batch_id INTEGER PRIMARY KEY, rating TEXT, reason TEXT, updated_at TEXT, by TEXT)');
}

const stem = code => String(code || '').replace(/^\d+/, '').toUpperCase().replace(/[^A-Z]/g, '');
// SG → °Brix (standard cubic fit; below 1.000 it goes negative, as a hydrometer in finished wine does)
const sg2bx = sg => ((182.4601 * sg - 775.6821) * sg + 1262.7794) * sg - 669.5622;
const dayOf = (t, t0) => (Date.parse(String(t).replace(' ', 'T') + 'Z') - Date.parse(String(t0).replace(' ', 'T') + 'Z')) / 864e5;
const r1 = x => Math.round(x * 10) / 10;

const ISSUE = /\b(h2s|sulfide|sulphide|rotten egg|reduc(ed|tive|tion)|stuck|sluggish|stall(ed|ing)?|va|volatile|acetic|vinegar|film yeast|kahm|mou?ld(y)?|brett\w*|mous(y|iness)|oxidi[sz]\w*|off[- ]?(flavou?rs?|aromas?|odou?rs?)|spoil\w*|infect\w*|geranium|bitter(ness)?|harsh|problems?|issues?|not good|bad)\b/gi;
const GOOD = /\b(excellent|great|beautiful|delicious|lovely|best|wonderful|amazing|outstanding|fantastic|superb|gorgeous)\b/gi;
function flag(text) {
  const t = String(text || '');
  const hit = rx => {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(t))) {   // skip "no H2S", "not stuck", "without VA"
      if (!/\b(no|not|without|free of|zero)\s+(\w+\s+)?$/i.test(t.slice(Math.max(0, m.index - 16), m.index))) return m[0];
    }
    return null;
  };
  const i = hit(ISSUE), g = hit(GOOD);
  return i ? ['issue', i] : g ? ['good', g] : null;
}

// wine families: batches with at least 3 sugar readings, grouped by the code without its year
export function families(c) {
  const rows = c.all(`SELECT b.id, b.code, b.description, COUNT(*) n FROM op_analysis a JOIN operation o ON o.id=a.op_id JOIN batch b ON b.id=a.batch_id
                      WHERE o.reversed=0 AND a.metric IN ('Brix','SG') AND a.value IS NOT NULL GROUP BY b.id HAVING COUNT(*)>=3`);
  const fam = new Map();
  for (const r of rows) {
    const s = stem(r.code);
    if (!s) continue;
    if (!fam.has(s)) fam.set(s, { stem: s, n: 0, desc: r.description || '' });
    const f = fam.get(s); f.n++; if (!f.desc && r.description) f.desc = r.description;
  }
  return { rows, fam };
}

function batch_data(c, b, span) {
  const rd = c.all(`SELECT o.occurred_at t, a.metric m, a.value v FROM op_analysis a JOIN operation o ON o.id=a.op_id
                    WHERE a.batch_id=? AND o.reversed=0 AND a.value IS NOT NULL AND a.metric IN ('Brix','SG','TempC','Alcohol','pH') ORDER BY o.occurred_at, o.id`, b.id);
  const sug = rd.filter(r => (r.m === 'Brix' && r.v > -6 && r.v < 45) || (r.m === 'SG' && r.v > 0.97 && r.v < 1.2));
  if (!sug.length) return null;
  const t0 = sug[0].t;
  const inw = d => d >= -7 && (span <= 0 || d <= span);
  const sugar = [], temp = [];
  for (const r of sug) { const d = dayOf(r.t, t0); if (inw(d)) sugar.push(r.m === 'Brix' ? [r1(d * 10) / 10, r1(r.v), 0, r.v] : [r1(d * 10) / 10, r1(sg2bx(r.v)), 1, r.v]); }
  for (const r of rd.filter(x => x.m === 'TempC' && x.v > -10 && x.v < 45)) { const d = dayOf(r.t, t0); if (inw(d)) temp.push([r1(d * 10) / 10, r1(r.v * 9 / 5 + 32)]); }
  const adds = c.all(`SELECT o.occurred_at t, m.name, a.amount, a.unit FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
                      WHERE a.batch_id=? AND o.reversed=0 ORDER BY o.occurred_at`, b.id)
    .map(a => [r1(dayOf(a.t, t0) * 10) / 10, `${a.name} ${a.amount ?? ''} ${a.unit || ''}`.trim(), String(a.t).slice(0, 10)]).filter(a => inw(a[0]));
  const notes = c.all('SELECT id, noted_at, detail FROM batch_note WHERE batch_id=? ORDER BY noted_at', b.id).map(n => {
    const d = r1(dayOf(String(n.noted_at).replace('T', ' ') + (String(n.noted_at).length <= 16 ? ':00' : ''), t0) * 10) / 10;
    const f = flag(n.detail);
    return { id: n.id, at: String(n.noted_at).replace('T', ' ').slice(0, 16), d: inw(d) ? d : null, day: d, text: String(n.detail || '').trim(), f: f ? f[0] : '', w: f ? f[1] : '' };
  });
  // summary
  const sgs = sug.filter(r => r.m === 'SG'), bx = r => (r.m === 'Brix' ? r.v : sg2bx(r.v));
  const dry = sug.find(r => (r.m === 'Brix' ? r.v <= 0 : r.v <= 1.0));
  const tps = rd.filter(x => x.m === 'TempC' && dayOf(x.t, t0) >= -7 && dayOf(x.t, t0) <= 60);
  const pk = tps.reduce((a, x) => (!a || x.v > a.v ? x : a), null);
  const last = m => { const x = rd.filter(r => r.m === m).pop(); return x ? x.v : null; };
  const end = new Date(Date.parse(String(t0).slice(0, 10) + 'T00:00:00Z') + 60 * 864e5).toISOString().slice(0, 10);   // largest volume during the ferment (later blends excluded)
  const L = c.val('SELECT MAX(t) FROM (SELECT SUM(volume_l) t FROM bulk_snapshot WHERE batch_id=? AND snap_date BETWEEN ? AND ? GROUP BY snap_date)', b.id, String(t0).slice(0, 10), end);
  const o = c.one('SELECT rating, reason FROM batch_outcome WHERE batch_id=?', b.id) || {};
  return {
    id: b.id, code: b.code, desc: b.description || '', start: String(t0).slice(0, 10), sugar, temp, adds, notes,
    sum: { bx0: r1(bx(sug[0])), peakF: pk ? r1(pk.v * 9 / 5 + 32) : null, peakD: pk ? Math.round(dayOf(pk.t, t0)) : null,
      dry: dry ? Math.round(dayOf(dry.t, t0)) : null, fsg: sgs.length ? sgs[sgs.length - 1].v : null, alc: last('Alcohol'), ph: last('pH'), L: L ? Math.round(L) : null,
      ni: notes.filter(n => n.f === 'issue').length, ng: notes.filter(n => n.f === 'good').length },
    rating: o.rating || '', reason: o.reason || '',
  };
}

export function page_analytics(c, q) {
  const qv = (k, d = '') => (q[k] && q[k].length ? q[k][0] : d);
  const { rows, fam } = families(c);
  const stems = [...fam.values()].sort((a, b) => a.stem.localeCompare(b.stem));
  let w = stem(qv('w', '')) || (fam.has('CRAB') ? 'CRAB' : (stems[0] || {}).stem || '');
  const span = parseInt(qv('span', '45'), 10) || 0;
  const members = rows.filter(r => stem(r.code).startsWith(w))
    .map(r => ({ ...r, exact: stem(r.code) === w, yr: parseInt(String(r.code).match(/^\d+/)?.[0] || '0', 10) }))
    .sort((a, b) => (b.exact - a.exact) || (a.yr - b.yr) || a.code.localeCompare(b.code));
  const data = members.map(m => batch_data(c, m, span)).filter(Boolean);
  const want = new Set((q.b || []).map(Number));
  const exact = data.filter(d => stem(d.code) === w);
  const def = want.size ? data.filter(d => want.has(d.id)) : (exact.length ? exact : data).slice(-8);
  const opts = stems.map(f => `<option value="${E(f.stem)}" ${f.stem === w ? 'selected' : ''}>${E(f.stem)}${f.desc ? ' · ' + E(f.desc.replace(/^\d{4}\s*/, '')) : ''} (${f.n})</option>`).join('');
  const sp = [[30, '30 days'], [45, '45 days'], [60, '60 days'], [120, '120 days'], [0, 'whole record']].map(([v, t]) => `<option value="${v}" ${v === span ? 'selected' : ''}>${t}</option>`).join('');
  const RT = { excellent: '★ Excellent', good: 'Good', issues: '⚠ Issues' };
  const outRow = d => `<form method="post" action="/analytics/outcome" class="oc"><input type="hidden" name="_t" value="${E(ctx.token)}"><input type="hidden" name="batch_id" value="${d.id}"><input type="hidden" name="back" value="${E('/analytics?w=' + encodeURIComponent(w) + '&span=' + span)}">
    <select name="rating"><option value="">—</option>${Object.entries(RT).map(([k, t]) => `<option value="${k}" ${d.rating === k ? 'selected' : ''}>${t}</option>`).join('')}</select><input name="reason" value="${E(d.reason)}" placeholder="why — e.g. H2S day 6, best crab yet" maxlength="200"><button>Save</button></form>`;
  const S = d => d.sum;
  const trs = data.map(d => `<tr data-id="${d.id}"><td><span class="sw" data-sw="${d.id}"></span><a href="/batch/${d.id}">${E(d.code)}</a><small>${E(d.desc)}</small></td><td>${E(d.start)}</td>
    <td class="n">${S(d).L ?? ''}</td><td class="n">${S(d).bx0 ?? ''}</td><td class="n">${S(d).peakF ?? ''}${S(d).peakD !== null ? `<small>day ${S(d).peakD}</small>` : ''}</td><td class="n">${S(d).dry ?? ''}</td>
    <td class="n">${S(d).fsg !== null ? S(d).fsg.toFixed(3) : ''}</td><td class="n">${S(d).alc ?? ''}</td><td class="n">${S(d).ph ?? ''}</td><td class="n">${S(d).ni ? `<span class="fi">⚠ ${S(d).ni}</span>` : ''} ${S(d).ng ? `<span class="fg">★ ${S(d).ng}</span>` : ''}</td><td>${outRow(d)}</td></tr>`).join('');
  const saved = q.saved ? '<div class="ok">Outcome saved.</div>' : '';
  const body = `${FTABS('ferm')}<h1>Analytics · fermentations compared</h1>${saved}
<p class="sub">Every vintage of a wine on one time line: day 0 = its first Brix/SG reading. SG readings are converted to °Brix (hollow points) so each curve runs on to dry. Rate each batch below, and notes are flagged automatically — ⚠ for words like H2S, stuck, VA, film yeast, bitter; ★ for great, excellent, best.</p>
<form class="f" method="get" action="/analytics"><label>Wine<select name="w" onchange="this.form.submit()">${opts}</select></label><label>Days shown<select name="span" onchange="this.form.submit()">${sp}</select></label><noscript><button>Show</button></noscript></form>
${data.length ? `<div id="an-leg" class="an-leg"></div>
<div class="an-zoom"><span class="muted">Zoom:</span><button type="button" data-z="-2,5">day 0–5</button><button type="button" data-z="-2,10">0–10</button><button type="button" data-z="0,20">0–20</button><button type="button" data-z="">all</button>
<label>from day <input id="zf" type="number" step="1"></label><label>to <input id="zt" type="number" step="1"></label><button type="button" id="za">Apply</button><span class="muted">or drag across a chart to zoom in · double-click to zoom out</span></div>
<div class="an-chart"><h2>Sugar (°Brix) by day</h2><div id="an-bx"></div></div>
<div class="an-chart"><h2>Temperature (°F) by day</h2><div id="an-tp"></div></div>
<div class="an-chart"><h2>Additions ◆ and notes ● by day <span class="muted" style="font-weight:400">— point at a mark to read it, click a note to jump to it below</span></h2><div id="an-ev"></div></div>
<div id="an-tip" class="an-tip" hidden></div>
<h2>Vintages</h2><div class="an-tw"><table><thead><tr><th>Batch</th><th>First reading</th><th class="n">Litres in ferment</th><th class="n">Start °Bx</th><th class="n">Peak °F</th><th class="n">Days to dry</th><th class="n">Last SG</th><th class="n">Alc %</th><th class="n">pH</th><th class="n">Flagged notes</th><th>Outcome (yours)</th></tr></thead><tbody>${trs}</tbody></table></div>
<h2>Notes <label class="muted" style="font-weight:400;font-size:13px"><input type="checkbox" id="an-fo" checked> flagged ⚠/★ only — untick to see every note</label></h2><div id="an-notes"></div>` : `<p class="muted">No batches with at least 3 Brix/SG readings for ${E(w)}.</p>`}
<script>window.AN=${JSON.stringify({ data, sel: def.map(d => d.id), span, w }).replace(/</g, '\\u003c')};</script><script>${CLIENT}</script>`;
  return page('Analytics', body + `<style>${CSS}</style>`, '/analytics');
}

export function post_outcome(c, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]) : '');
  const bid = parseInt(g('batch_id') || '0', 10);
  if (!c.one('SELECT 1 x FROM batch WHERE id=?', bid)) return [null, 'No such batch.'];
  const rating = ['excellent', 'good', 'issues'].includes(g('rating')) ? g('rating') : '';
  const reason = g('reason').trim().slice(0, 200);
  if (!rating && !reason) c.run('DELETE FROM batch_outcome WHERE batch_id=?', bid);
  else c.run(`INSERT INTO batch_outcome(batch_id, rating, reason, updated_at, by) VALUES (?,?,?,?,?)
              ON CONFLICT(batch_id) DO UPDATE SET rating=excluded.rating, reason=excluded.reason, updated_at=excluded.updated_at, by=excluded.by`, bid, rating || null, reason || null, nowIso(), ctx.user || 'HARDCASTLE, Ken');
  const back = g('back');
  return [/^\/analytics\?[A-Za-z0-9_=&%.-]*$/.test(back) ? back + '&saved=' + bid : '/analytics', null];
}

const CSS = `.an-leg{display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0 4px}.an-leg label{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--fg2);cursor:pointer;padding:3px 8px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.an-leg label.off{color:var(--mut);opacity:.75}.an-leg input{margin:0}.an-leg i{width:18px;height:3px;border-radius:2px;display:inline-block}.an-leg small{color:var(--mut)}
.an-zoom{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:8px 0;font-size:13px}.an-zoom button{padding:3px 10px;font-size:12.5px}.an-zoom input{width:64px;padding:3px 6px}.an-zoom label{display:flex;gap:4px;align-items:center;color:var(--mut)}.an-zoom button.on{background:var(--blue-t);border-color:var(--acc);color:var(--fg2)}
.an-chart{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 10px 6px;margin:10px 0}.an-chart h2{margin:8px 0 2px;font-size:13px}
.an-chart svg{display:block;width:100%;overflow:visible}.an-chart text{fill:var(--mut);font-size:11px}.an-chart .lab{fill:var(--fg2);font-size:11.5px;font-weight:600}
.an-tip{position:fixed;z-index:50;background:#0d1117;border:1px solid var(--line2);border-radius:6px;padding:8px 10px;font-size:12.5px;color:var(--fg2);max-width:360px;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.5);white-space:pre-wrap}
.an-tip b{color:#fff}.an-tip i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.an-tw table td small{display:block;color:var(--faint);font-size:11px}.sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px;background:var(--line2)}
.fi{color:#ec835a;white-space:nowrap}.fg{color:#3fb950;white-space:nowrap}form.oc{display:flex;gap:6px;align-items:center;margin:0}form.oc input{width:210px;padding:4px 8px}form.oc select{padding:4px 6px}form.oc button{padding:4px 10px}
.an-nb{margin:10px 0 4px;font-weight:600;color:var(--fg2);display:flex;align-items:center;gap:8px}.an-n{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line2);border-radius:4px;padding:7px 10px;margin:5px 0;font-size:13px;white-space:pre-wrap}
.an-n.issue{border-left-color:#d03b3b}.an-n.good{border-left-color:#0ca30c}.an-n .h{color:var(--mut);font-size:12px;margin-bottom:3px;white-space:normal}.an-n.hl{outline:2px solid var(--acc)}
@media(max-width:640px){form.oc{flex-wrap:wrap}form.oc input{width:100%}}`;

// ---------------------------------------------------------------- browser side (inline SVG, no libraries)
const CLIENT = `(function(){var A=window.AN;if(!A||!A.data.length)return;
var PAL=['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'],ST={issue:'#d03b3b',good:'#0ca30c'};
var byId={},slot={},sel=[];A.data.forEach(function(d){byId[d.id]=d});
function free(){for(var i=0;i<8;i++){var u=false;for(var k in slot)if(slot[k]===i)u=true;if(!u)return i}return -1}
A.sel.forEach(function(id){if(byId[id]&&sel.length<8){slot[id]=free();sel.push(id)}});
var tip=document.getElementById('an-tip'),NS='http://www.w3.org/2000/svg';
function el(n,a,p){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function col(id){return PAL[slot[id]]}
function legend(){var L=document.getElementById('an-leg');L.innerHTML='';A.data.forEach(function(d){var on=sel.indexOf(d.id)>=0,lb=document.createElement('label');lb.className=on?'':'off';
lb.innerHTML='<input type="checkbox" '+(on?'checked':'')+'><i style="background:'+(on?col(d.id):'transparent')+';border:1px solid '+(on?col(d.id):'#30363d')+'"></i>'+esc(d.code)+(d.rating?' <small>'+(d.rating==='excellent'?'★':d.rating==='issues'?'⚠':'·')+'</small>':'');
lb.querySelector('input').onchange=function(){if(this.checked){if(sel.length>=8){this.checked=false;alertTip('Up to 8 vintages at once — untick one first.');return}slot[d.id]=free();sel.push(d.id)}else{sel.splice(sel.indexOf(d.id),1);delete slot[d.id]}draw()};L.appendChild(lb)});
document.querySelectorAll('[data-sw]').forEach(function(s){var id=+s.dataset.sw;s.style.background=sel.indexOf(id)>=0?col(id):'#30363d'})}
function alertTip(m){tip.hidden=false;tip.textContent=m;tip.style.left='20px';tip.style.top='80px';setTimeout(function(){tip.hidden=true},2500)}
function nice(lo,hi,n){var st=Math.pow(10,Math.floor(Math.log10((hi-lo)/n||1)));[1,2,5,10].some(function(m){if((hi-lo)/(st*m)<=n){st*=m;return true}});var a=[];for(var v=Math.ceil(lo/st)*st;v<=hi+1e-9;v+=st)a.push(Math.round(v*100)/100);return a}
var X={},Z=null;function xdom(){if(Z)return Z;var lo=0,hi=A.span>0?A.span:1;sel.forEach(function(id){var d=byId[id];d.sugar.concat(d.temp).forEach(function(p){if(p[0]<lo)lo=p[0];if(A.span<=0&&p[0]>hi)hi=p[0]})});return[Math.floor(lo),Math.ceil(hi)]}
function chart(host,key,unit,yfix){host.innerHTML='';var W=host.clientWidth||800,H=key==='ev'?Math.max(40,sel.length*24+30):230,m={l:44,r:84,t:10,b:24},iw=W-m.l-m.r,ih=H-m.t-m.b;
var s=el('svg',{viewBox:'0 0 '+W+' '+H,height:H},host),xd=X.d,xs=function(v){return m.l+(v-xd[0])/(xd[1]-xd[0])*iw};
var cid='cp'+key+Math.random().toString(36).slice(2,7),cp=el('clipPath',{id:cid},el('defs',{},s));el('rect',{x:m.l-6,y:m.t-6,width:iw+12,height:ih+12},cp);var g=el('g',{},s);nice(xd[0],xd[1],10).forEach(function(v){el('line',{x1:xs(v),x2:xs(v),y1:m.t,y2:m.t+ih,stroke:'#21262d'},g);var t=el('text',{x:xs(v),y:H-6,'text-anchor':'middle'},g);t.textContent=v===0?'day 0':v});
var ys=null;if(key!=='ev'){var lo=yfix[0],hi=yfix[1];sel.forEach(function(id){byId[id][key].forEach(function(p){if(p[0]<xd[0]||p[0]>xd[1])return;if(p[1]<lo)lo=p[1];if(p[1]>hi)hi=p[1]})});lo=Math.floor(lo);hi=Math.ceil(hi);
ys=function(v){return m.t+ih-(v-lo)/(hi-lo)*ih};nice(lo,hi,6).forEach(function(v){el('line',{x1:m.l,x2:m.l+iw,y1:ys(v),y2:ys(v),stroke:v===0?'#484f58':'#21262d'},g);var t=el('text',{x:m.l-6,y:ys(v)+4,'text-anchor':'end'},g);t.textContent=v});
var labs=[];sel.forEach(function(id){var d=byId[id],pts=d[key].filter(function(p){return p[0]>=xd[0]&&p[0]<=xd[1]});if(!pts.length)return;
var pts2=d[key].filter(function(p){return p[0]>=xd[0]-3&&p[0]<=xd[1]+3});el('polyline',{'clip-path':'url(#'+cid+')',points:pts2.map(function(p){return xs(p[0])+','+ys(p[1])}).join(' '),fill:'none',stroke:col(id),'stroke-width':2,'stroke-linejoin':'round'},s);
pts.forEach(function(p){el('circle',{cx:xs(p[0]),cy:ys(p[1]),r:3.5,fill:p[2]?'#161b22':col(id),stroke:col(id),'stroke-width':1.6},s)});var lp=pts[pts.length-1];labs.push({y:ys(lp[1]),x:xs(lp[0]),id:id,t:d.code})});
labs.sort(function(a,b){return a.y-b.y});for(var i=1;i<labs.length;i++)if(labs[i].y-labs[i-1].y<13)labs[i].y=labs[i-1].y+13;var bot=m.t+ih;for(var j=labs.length-1;j>=0;j--){var lim=j===labs.length-1?bot:labs[j+1].y-13;if(labs[j].y>lim)labs[j].y=lim}if(labs.length&&labs[0].y<m.t+10){labs[0].y=m.t+10;for(var k=1;k<labs.length;k++)if(labs[k].y-labs[k-1].y<13)labs[k].y=labs[k-1].y+13}
labs.forEach(function(L){el('circle',{cx:m.l+iw+8,cy:L.y-4,r:4,fill:col(L.id)},s);var t=el('text',{x:m.l+iw+16,y:L.y,'class':'lab'},s);t.textContent=L.t})}
else{sel.forEach(function(id,i){var d=byId[id],y=m.t+12+i*24;el('line',{x1:m.l,x2:m.l+iw,y1:y,y2:y,stroke:'#21262d'},s);el('circle',{cx:m.l+iw+8,cy:y,r:4,fill:col(id)},s);var t=el('text',{x:m.l+iw+16,y:y+4,'class':'lab'},s);t.textContent=d.code;
d.adds.forEach(function(a){if(a[0]<xd[0]||a[0]>xd[1])return;var x=xs(a[0]);var r=el('rect',{x:x-4,y:y-4,width:8,height:8,transform:'rotate(45 '+x+' '+y+')',fill:'#8b949e'},s);r.dataset.tip='◆ '+d.code+' · day '+a[0]+' ('+a[2]+')\\n'+a[1]});
d.notes.forEach(function(n){if(n.d===null||n.d<xd[0]||n.d>xd[1])return;var x=xs(n.d);var c=el('circle',{cx:x,cy:y,r:n.f?6:4.5,fill:n.f?ST[n.f]:'#161b22',stroke:n.f?'#161b22':col(id),'stroke-width':2},s);c.style.cursor='pointer';
c.dataset.tip=(n.f==='issue'?'⚠ ':n.f==='good'?'★ ':'● ')+d.code+' · day '+n.d+' ('+n.at+')'+(n.w?' · “'+n.w+'”':'')+'\\n'+n.text.slice(0,420)+(n.text.length>420?'…':'');c.onclick=function(){var e=document.getElementById('nt'+n.id);if(e){e.scrollIntoView({behavior:'smooth',block:'center'});e.classList.add('hl');setTimeout(function(){e.classList.remove('hl')},2200)}}})})}
var band=el('rect',{y:m.t,height:ih,fill:'rgba(56,139,253,.15)',stroke:'#388bfd',visibility:'hidden'},s),d0=null;
s.addEventListener('mousedown',function(ev){var r=s.getBoundingClientRect(),px=(ev.clientX-r.left)*W/r.width;if(px<m.l||px>m.l+iw)return;d0=px;ev.preventDefault()});
s.addEventListener('mouseup',function(ev){if(d0===null)return;var r=s.getBoundingClientRect(),px=Math.max(m.l,Math.min(m.l+iw,(ev.clientX-r.left)*W/r.width));band.setAttribute('visibility','hidden');
if(Math.abs(px-d0)>10){var a=s._inv(Math.min(px,d0)),b=s._inv(Math.max(px,d0));d0=null;setZoom([Math.floor(a*2)/2,Math.ceil(b*2)/2])}else d0=null});
s.addEventListener('dblclick',function(){setZoom(null)});
var cross=el('line',{y1:m.t,y2:m.t+ih,stroke:'#8b949e','stroke-dasharray':'3 3',visibility:'hidden'},s);s._cross=cross;s._xs=xs;s._inv=function(px){return xd[0]+(px-m.l)/iw*(xd[1]-xd[0])};
s.addEventListener('mousemove',function(ev){var r=s.getBoundingClientRect(),px=(ev.clientX-r.left)*W/r.width;if(d0!==null){band.setAttribute('x',Math.min(d0,px));band.setAttribute('width',Math.abs(px-d0));band.setAttribute('visibility','visible')}if(px<m.l||px>m.l+iw){hide();return}var day=s._inv(px);
var t=ev.target&&ev.target.dataset&&ev.target.dataset.tip;show(ev,t?esc(t):readout(day),day)});s.addEventListener('mouseleave',hide);
s.addEventListener('click',function(ev){if(ev.target&&ev.target.dataset&&ev.target.dataset.tip)return;var r=s.getBoundingClientRect(),px=(ev.clientX-r.left)*W/r.width;if(px>=m.l&&px<=m.l+iw){var day=s._inv(px);show(ev,readout(day),day)}});
return s}
function near(arr,day){var b=null;arr.forEach(function(p){if(Math.abs(p[0]-day)<=1.5&&(!b||Math.abs(p[0]-day)<Math.abs(b[0]-day)))b=p});return b}
function readout(day){var h='<b>Day '+Math.round(day)+'</b>';sel.forEach(function(id){var d=byId[id],b=near(d.sugar,day),t=near(d.temp,day);if(!b&&!t)return;
h+='\\n<i style="background:'+col(id)+'"></i>'+esc(d.code)+': '+(b?(b[2]?'SG '+b[3].toFixed(3)+' (≈'+b[1]+' °Bx)':b[1]+' °Bx'):'—')+(t?' · '+t[1]+' °F':'')});return h}
var svgs=[];function show(ev,html,day){tip.hidden=false;tip.innerHTML=html;var x=ev.clientX+14,y=ev.clientY+14;if(x+370>innerWidth)x=ev.clientX-370;tip.style.left=Math.max(4,x)+'px';tip.style.top=Math.min(y,innerHeight-tip.offsetHeight-6)+'px';
svgs.forEach(function(s){var x=s._xs(day);s._cross.setAttribute('x1',x);s._cross.setAttribute('x2',x);s._cross.setAttribute('visibility','visible')})}
function hide(){tip.hidden=true;svgs.forEach(function(s){s._cross.setAttribute('visibility','hidden')})}
function notes(){var fo=document.getElementById('an-fo').checked,N=document.getElementById('an-notes'),h='';sel.forEach(function(id){var d=byId[id],ns=d.notes.filter(function(n){return!fo||n.f});
h+='<div class="an-nb"><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:'+col(id)+'"></i>'+esc(d.code)+' <span class="muted" style="font-weight:400">'+esc(d.desc)+' · '+ns.length+' note'+(ns.length===1?'':'s')+'</span></div>';
ns.forEach(function(n){h+='<div class="an-n '+n.f+'" id="nt'+n.id+'"><div class="h">'+(n.f==='issue'?'⚠ ':n.f==='good'?'★ ':'')+esc(n.at)+' · day '+Math.round(n.day)+(n.w?' · “'+esc(n.w)+'”':'')+' · <a href="/notes/edit?note='+n.id+'">edit</a></div>'+esc(n.text)+'</div>'})});N.innerHTML=h||'<p class="muted">No notes.</p>'}
function draw(){legend();X.d=xdom();svgs=[chart(document.getElementById('an-bx'),'sugar','°Bx',[-2,24]),chart(document.getElementById('an-tp'),'temp','°F',[55,80]),chart(document.getElementById('an-ev'),'ev')];notes()}
function setZoom(z){Z=z&&z[1]>z[0]?z:null;document.getElementById('zf').value=Z?Z[0]:'';document.getElementById('zt').value=Z?Z[1]:'';document.querySelectorAll('.an-zoom [data-z]').forEach(function(b){b.className=(b.dataset.z===(Z?Z.join(','):''))?'on':''});hide();draw()}
document.querySelectorAll('.an-zoom [data-z]').forEach(function(b){b.onclick=function(){setZoom(b.dataset.z?b.dataset.z.split(',').map(Number):null)}});
document.getElementById('za').onclick=function(){var a=parseFloat(document.getElementById('zf').value),b=parseFloat(document.getElementById('zt').value);if(isNaN(a)||isNaN(b)||b<=a){alertTip('Enter a from day lower than the to day.');return}setZoom([a,b])};
document.getElementById('an-fo').onchange=notes;var rt;addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(draw,150)});draw()})()`;
