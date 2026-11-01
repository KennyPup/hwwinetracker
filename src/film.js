// v1.4 — Analytics › Film yeast (range-bar summary per factor): every film-yeast episode in the notes, the cellar conditions just before it, what was done
// afterwards and whether it came back — and the same conditions for wines that never got film yeast, compared as
// individual points on continuous scales (no bins). Ken can overrule the automatic detection per note (note edit page).
import { tip as HELP } from './help.js';
import { E, nowIso } from './lib/py.js';
import { ctx, page } from './core.js';

export function ensure_schema(db) {
  db.run('CREATE TABLE IF NOT EXISTS note_film(note_id INTEGER PRIMARY KEY, film INTEGER NOT NULL, at TEXT, by TEXT)');
}

export const FILM = /\bfilm\b|\bfilmy\b|\bkahm|\bflor\b|surface yeast|pellicle|mycoderma|candida|pichia|snowflake/i;
const NEG = /\b(no|without|free of|zero|not any)\s+(\w+\s+){0,2}(film|flor|kahm|pellicle|surface yeast)/i;
export const auto_film = t => !!(t && FILM.test(t) && !NEG.test(t));
const TOP = /\b(topp?ed|topping|top(ped)? up|purg\w*|argon|blanket\w*|co2 (filled|headspace|purge)|gassed)\b/i;

const D = s => Date.parse(String(s).replace('T', ' ').slice(0, 19).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00:00Z' : 'Z'));
const days = (a, b) => (D(a) - D(b)) / 864e5;
const r = (x, n = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
const mso2 = (f, ph) => (f === null || ph === null ? null : f / (1 + 10 ** (ph - 1.81)));
const stem = code => String(code || '').replace(/^\d+/, '').toUpperCase().replace(/[^A-Z]/g, '');
const addDays = (d, n) => new Date(D(String(d).slice(0, 10)) + n * 864e5).toISOString().slice(0, 10);

// conditions of batch b (vessel v, or its fullest-headspace vessel) at date t
function conditions(c, b, t, v) {
  const at = String(t).replace('T', ' ').slice(0, 10) + ' 00:00:00';   // conditions before that day: what was done on the day itself is usually the response
  const last = (m, within) => c.one(`SELECT a.value v, o.occurred_at t FROM op_analysis a JOIN operation o ON o.id=a.op_id
     WHERE a.batch_id=? AND a.metric=? AND o.reversed=0 AND a.value IS NOT NULL AND o.occurred_at<=? AND o.occurred_at>=? ORDER BY o.occurred_at DESC LIMIT 1`,
    b, m, at, within ? addDays(at, -within) : '0000');
  const fs = last('Free SO2', 90), ph = last('pH', 365), al = last('Alcohol', 0) || c.one(`SELECT a.value v, o.occurred_at t FROM op_analysis a JOIN operation o ON o.id=a.op_id
     WHERE a.batch_id=? AND a.metric='Alcohol' AND o.reversed=0 AND a.value IS NOT NULL ORDER BY o.occurred_at LIMIT 1`, b), tp = last('TempC', 30);
  // vessel fill on that day
  const day = at.slice(0, 10);
  const sd = c.val('SELECT MAX(snap_date) FROM bulk_snapshot WHERE batch_id=? AND snap_date<=? AND snap_date>=?', b, day, addDays(day, -10));
  let fill = null, vcode = null, vkind = null, vid = v || null;
  if (sd) {
    const rows = c.all('SELECT s.vessel_id id, s.volume_l L, v.code, v.kind, v.capacity_l cap FROM bulk_snapshot s JOIN vessel v ON v.id=s.vessel_id WHERE s.batch_id=? AND s.snap_date=?', b, sd);
    let pick = v ? rows.find(x => x.id === v) : null;
    if (!pick) pick = rows.filter(x => x.cap).sort((x, y) => x.L / x.cap - y.L / y.cap)[0] || rows[0];
    if (pick) { vid = pick.id; vcode = pick.code; vkind = pick.kind; fill = pick.cap ? Math.min(1.05, pick.L / pick.cap) : null; }
  }
  if (!vcode && v) { const x = c.one('SELECT code, kind FROM vessel WHERE id=?', v); if (x) { vcode = x.code; vkind = x.kind; } }
  const so2 = c.val(`SELECT MAX(o.occurred_at) FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
     WHERE a.batch_id=? AND o.reversed=0 AND m.kind='sulfite' AND o.occurred_at<=?`, b, at);
  const top1 = c.val(`SELECT MAX(o.occurred_at) FROM operation o JOIN op_vessel ov ON ov.op_id=o.id WHERE o.reversed=0 AND o.op_type IN ('Multi topping','Topping')
     AND (ov.batch_id=? OR ov.batch_after_id=?${vid ? ' OR ov.vessel_id=' + Number(vid) : ''}) AND o.occurred_at<=?`, b, b, at);
  const top2 = c.all("SELECT noted_at, detail FROM batch_note WHERE batch_id=? AND noted_at<=? AND noted_at>=? ORDER BY noted_at DESC", b, at.replace(' ', 'T').slice(0, 16), addDays(at, -365))
    .find(n => TOP.test(n.detail || ''));
  const tops = [top1, top2 && top2.noted_at].filter(Boolean).map(x => String(x).replace('T', ' ')).sort().pop();
  return {
    fso2: fs ? r(fs.v, 0) : null, fso2_age: fs ? Math.round(days(at, fs.t)) : null, ph: ph ? r(ph.v, 2) : null,
    mso2: fs && ph ? r(mso2(fs.v, ph.v), 2) : null, alc: al ? r(al.v, 1) : null, tF: tp ? r(tp.v * 9 / 5 + 32, 0) : null, tC: tp ? r(tp.v, 1) : null,
    fill: fill === null ? null : r(fill * 100, 0), vessel: vcode, vkind, vid,
    dso2: so2 ? Math.round(days(at, so2)) : null, dtop: tops ? Math.round(days(at, tops)) : null, month: Number(at.slice(5, 7)),
  };
}

const ferment_start = (c, b) => c.val(`SELECT MIN(o.occurred_at) FROM op_analysis a JOIN operation o ON o.id=a.op_id
  WHERE a.batch_id=? AND o.reversed=0 AND a.metric IN ('Brix','SG')`, b);

export function film_data(c) {
  const over = new Map(c.all('SELECT note_id, film FROM note_film').map(x => [x.note_id, x.film]));
  const notes = c.all(`SELECT n.id, n.noted_at, n.detail, n.batch_id, n.vessel_id, b.code, b.description, b.beverage_type FROM batch_note n JOIN batch b ON b.id=n.batch_id
                       WHERE n.detail LIKE '%film%' OR n.detail LIKE '%flor%' OR n.detail LIKE '%kahm%' OR n.detail LIKE '%pellicle%' OR n.detail LIKE '%candida%'
                          OR n.detail LIKE '%pichia%' OR n.detail LIKE '%snowflake%' OR n.detail LIKE '%mycoderma%' OR n.detail LIKE '%surface yeast%'
                          OR n.id IN (SELECT note_id FROM note_film WHERE film=1) ORDER BY n.noted_at`)
    .filter(n => (over.has(n.id) ? over.get(n.id) === 1 : auto_film(n.detail)));
  // episodes: film notes of a batch more than 21 days apart
  const eps = [], byB = new Map();
  for (const n of notes) {
    const prev = byB.get(n.batch_id);
    if (prev && days(n.noted_at, prev.notes[prev.notes.length - 1].noted_at) <= 21) { prev.notes.push(n); continue; }
    const e = { batch_id: n.batch_id, code: n.code, desc: n.description || '', type: n.beverage_type || '', at: String(n.noted_at).replace('T', ' ').slice(0, 16), notes: [n], vessel_id: n.vessel_id };
    eps.push(e); byB.set(n.batch_id, e);
  }
  const nByB = new Map();
  for (const e of eps) nByB.set(e.batch_id, (nByB.get(e.batch_id) || 0) + 1);
  const seen = new Map();
  for (const e of eps) {
    Object.assign(e, conditions(c, e.batch_id, e.at, e.vessel_id));
    const st = ferment_start(c, e.batch_id);
    e.age = st ? Math.round(days(e.at, st)) : null;
    seen.set(e.batch_id, (seen.get(e.batch_id) || 0) + 1);
    e.k = seen.get(e.batch_id); e.n = nByB.get(e.batch_id);
    const after = addDays(e.at, 10);
    e.acts = c.all(`SELECT o.occurred_at t, o.op_type, o.treatment, (SELECT GROUP_CONCAT(m.name) FROM op_addition a JOIN material m ON m.id=a.material_id WHERE a.op_id=o.id) mats
                    FROM operation o JOIN op_vessel ov ON ov.op_id=o.id WHERE o.reversed=0 AND (ov.batch_id=? OR ov.batch_after_id=?) AND o.occurred_at>=? AND o.occurred_at<=?
                    AND o.op_type NOT IN ('Analysis') GROUP BY o.id ORDER BY o.occurred_at LIMIT 8`, e.batch_id, e.batch_id, e.at.slice(0, 10), after)
      .map(a => `${String(a.t).slice(5, 10)} ${a.mats || a.treatment || a.op_type}`);
    e.notes = e.notes.map(n => ({ id: n.id, at: String(n.noted_at).replace('T', ' ').slice(0, 16), text: String(n.detail || '').trim(), ov: over.has(n.id) }));
    e.stem = stem(e.code);
  }
  // unaffected wines: same years, in bulk at a comparable age after their ferment started
  const caseB = new Set(eps.map(e => e.batch_id));
  const ages = eps.map(e => e.age).filter(a => a !== null && a > 20).sort((a, b) => a - b);
  const medAge = ages.length ? ages[Math.floor(ages.length / 2)] : 150;
  const yrs = eps.map(e => Number(e.at.slice(0, 4)));
  const y0 = Math.min(...yrs) - 1, y1 = Math.max(...yrs);
  const ctl = [];
  for (const b of c.all(`SELECT b.id, b.code, b.description, b.beverage_type, MIN(o.occurred_at) st FROM batch b JOIN op_analysis a ON a.batch_id=b.id JOIN operation o ON o.id=a.op_id
                         WHERE o.reversed=0 AND a.metric IN ('Brix','SG') GROUP BY b.id`)) {
    if (caseB.has(b.id) || !b.st) continue;
    const yr = Number(String(b.st).slice(0, 4));
    if (yr < y0 || yr > y1) continue;
    let ref = addDays(b.st, medAge);
    const inBulk = d => c.val('SELECT 1 FROM bulk_snapshot WHERE batch_id=? AND snap_date=? LIMIT 1', b.id, d);
    if (!inBulk(ref)) {   // not in bulk at that age: use the middle of its time in bulk after the ferment (at least 30 days in)
      const span = c.one('SELECT MIN(snap_date) a, MAX(snap_date) z FROM bulk_snapshot WHERE batch_id=? AND snap_date>=?', b.id, addDays(b.st, 30));
      if (!span || !span.a || days(span.z, span.a) < 14) continue;
      ref = addDays(span.a, Math.round(days(span.z, span.a) / 2));
    }
    ctl.push({ batch_id: b.id, code: b.code, desc: b.description || '', type: b.beverage_type || '', at: ref, age: Math.round(days(ref, b.st)), stem: stem(b.code), ...conditions(c, b.id, ref + ' 12:00:00', null) });
  }
  return { eps, ctl, medAge, years: [y0 + 1, y1] };
}

export function page_film(c, q) {
  const { eps, ctl, medAge, years } = film_data(c);
  const nb = new Set(eps.map(e => e.batch_id)).size;
  const fst = new Set(eps.map(e => e.stem)), nfam = ctl.filter(x => fst.has(x.stem)).length;
  const byV = new Map();
  for (const e of eps) if (e.vessel) byV.set(e.vessel, (byV.get(e.vessel) || 0) + 1);
  const topV = [...byV.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const rows = eps.slice().reverse().map(e => `<tr><td>${E(e.at.slice(0, 10))}</td><td><a href="/batch/${e.batch_id}">${E(e.code)}</a><small>${E(e.type)}</small></td><td>${E(e.vessel || '')}${e.vkind ? `<small>${E(e.vkind)}</small>` : ''}</td>
    <td class="n">${e.fill ?? ''}</td><td class="n">${e.fso2 ?? ''}${e.fso2_age !== null ? `<small>${e.fso2_age} d before</small>` : ''}</td><td class="n">${e.ph ?? ''}</td><td class="n">${e.mso2 ?? ''}</td>
    <td class="n">${e.dso2 ?? ''}</td><td class="n">${e.dtop ?? ''}</td><td class="n">${e.alc ?? ''}</td><td class="n">${e.tC ?? ''}</td><td class="n">${e.age ?? ''}</td>
    <td class="n">${e.k} of ${e.n}</td><td class="fn">${e.notes.map(n => `<div><b>${E(n.at)}</b> ${E(n.text.length > 260 ? n.text.slice(0, 260) + '…' : n.text)} <a href="/notes/edit?note=${n.id}&amp;back=/analytics/film" title="Open the note — set “Film yeast” to No if this isn’t one">${n.ov ? 'edited' : 'edit / not film'}</a></div>`).join('')}</td>
    <td class="fn">${E(e.acts.join(' · '))}</td></tr>`).join('');
  const body = `${TABS('film')}<h1>Film yeast${HELP('film')}</h1>
<p class="sub">${eps.length} episodes in ${nb} wines, ${years[0]}–${years[1]}, found in the notes (film, Kahm, flor, Pichia, Candida, pellicle, snowflake; “no film” is ignored). Notes within 21 days count as one episode. Conditions are the latest readings and actions before the day of each episode (same-day work is usually the response); free SO₂ counts if read within 90 days. Molecular SO₂ = free SO₂ ÷ (1 + 10<sup>pH − 1.81</sup>). Unaffected wines are measured ${medAge} days after their ferment started (the median age of the episodes), while in bulk.</p>
<div class="fy-ctl"><span>Compare with</span><label><input type="radio" name="cmp" value="fam" checked> unaffected vintages of the same wines (${nfam})</label><label><input type="radio" name="cmp" value="all"> all unaffected wines in bulk (${ctl.length})</label></div>
<div class="fy-leg"><span><b style="color:#d95926">●</b> film yeast · ${eps.length} episodes</span><span><b style="color:#3987e5">●</b> unaffected · <span id="fy-nu"></span> wines</span></div>
<p class="fy-how">Thick bar = middle half of the wines · dot = median · thin line = lowest to highest. Orange left of blue means film-yeast wines ran lower. Verdict: pair every film-yeast wine with every unaffected wine; lower in 40–60% of pairings = no clear difference, 30–40 / 60–70% = slightly, beyond that = clearly. Fewer than 8 readings in either group: too few to judge. Hover a bar for the numbers.</p>
<div id="fy-grid" class="fy-card"></div><div id="fy-tip" class="an-tip" hidden></div>
<h2>Tanks and barrels with the most episodes</h2><p>${topV.map(([v, n]) => `${E(v)} <b>${n}</b>`).join(' · ') || '—'}</p>
<h2>Episodes (newest first)</h2><div class="an-tw"><table><thead><tr><th>Date</th><th>Wine</th><th>Vessel</th><th class="n">Fill %</th><th class="n">Free SO₂</th><th class="n">pH</th><th class="n">Mol. SO₂</th><th class="n">Days since SO₂ add</th><th class="n">Days since top/purge</th><th class="n">Alc %</th><th class="n">°C</th><th class="n">Days since ferment</th><th class="n">Episode</th><th>Notes</th><th>Done in the next 10 days</th></tr></thead><tbody>${rows}</tbody></table></div>
<script>window.FY=${JSON.stringify({ eps: eps.map(e => ({ code: e.code, at: e.at.slice(0, 10), stem: e.stem, ...pick(e) })), ctl: ctl.map(e => ({ code: e.code, at: String(e.at).slice(0, 10), stem: e.stem, ...pick(e) })) }).replace(/</g, '\\u003c')};</script><script>${CLIENT}</script>`;
  return page('Film yeast', body + `<style>${CSS}</style>`, '/analytics', [['Analytics', '/analytics'], ['Film yeast', null]]);
}
const pick = e => ({ mso2: e.mso2, fso2: e.fso2, ph: e.ph, fill: e.fill, dso2: e.dso2, dtop: e.dtop, alc: e.alc, tF: e.tF, tC: e.tC, month: e.month, type: e.type });

export const TABS = on => `<div class="tabs" style="margin-top:0"><a href="/analytics" class="${on === 'ferm' ? 'on' : ''}">Fermentations</a><a href="/analytics/film" class="${on === 'film' ? 'on' : ''}">Film yeast</a><a href="/analytics/reductones" class="${on === 'red' ? 'on' : ''}">Reductones</a></div>`;

const CSS = `.fy-ctl{display:flex;flex-wrap:wrap;gap:6px 18px;margin:6px 0 10px;font-size:13px}.fy-ctl label{display:flex;gap:6px;align-items:center}
.fy-ctl>span{color:var(--mut)}.fy-leg{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:13px;color:var(--fg)}.fy-how{font-size:12.5px;color:var(--mut);max-width:100ch;margin:6px 0 10px}
.fy-card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 16px 8px;max-width:1100px}
.fy-r{padding:10px 0 6px;border-bottom:1px solid var(--line)}.fy-r:last-child{border-bottom:0}
.fy-h{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 16px;align-items:baseline}.fy-n{font-weight:600;color:var(--fg2);font-size:14px}.fy-n i{font-style:normal;font-weight:400;color:var(--mut);font-size:12px}
.fy-v{font-size:13px;font-weight:600}.fy-v.clear{color:var(--fg2)}.fy-v.clear::before{content:"●● ";font-size:9px;color:var(--mut)}.fy-v.slight{color:var(--fg);font-weight:500}.fy-v.slight::before{content:"● ";font-size:9px;color:var(--mut)}.fy-v.none,.fy-v.na{color:var(--mut);font-weight:400}
.fy-r svg{display:block;width:100%}.fy-r text{fill:var(--mut);font-size:10.5px;font-variant-numeric:tabular-nums}.fy-r text.ref{fill:#8fc29a}.fy-f{font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.an-tip{position:fixed;z-index:50;background:#0d1117;border:1px solid var(--line2);border-radius:6px;padding:8px 10px;font-size:12.5px;color:var(--fg2);max-width:360px;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.5)}
.an-tw table td small{display:block;color:var(--faint);font-size:11px}td.fn{font-size:12px;min-width:240px;max-width:460px}td.fn div{margin:2px 0}td.fn b{color:var(--mut);font-weight:500}`;

// range bars: one row per factor — middle half of the wines (bar), median (dot), lowest–highest (thin line); film yeast orange, unaffected blue.
// Verdict from all pairings (one film-yeast wine × one unaffected wine): share where the film-yeast wine is lower; 50% = no difference.
const CLIENT = `(function(){var F=window.FY;if(!F)return;var NS='http://www.w3.org/2000/svg',CA='#d95926',CU='#3987e5',tip=document.getElementById('fy-tip');
var FAC=[{k:'mso2',name:'Molecular SO₂',unit:'mg/L',dom:[0,2],band:[0.5,0.8],dec:2,note:'shaded: 0.5–0.8 mg/L, the usual protective range'},
{k:'fso2',name:'Free SO₂',unit:'ppm',dom:[0,100],dec:0,note:'latest reading within 90 days before'},
{k:'ph',name:'pH',unit:'',dom:[3,4.3],ref:3.5,refL:'pH 3.5',dec:2,note:'higher pH = less of the free SO₂ is active'},
{k:'fill',name:'Vessel fill',unit:'%',dom:[10,100],ref:95,refL:'95%',dec:0,note:'below ~95% leaves headspace'},
{k:'dso2',name:'Days since last SO₂ addition',unit:'days · log scale',log:1,dom:[0,500],dec:0,note:''},
{k:'dtop',name:'Days since last topping or gas purge',unit:'days · log scale',log:1,dom:[0,2000],dec:0,note:'from topping records and notes'},
{k:'alc',name:'Alcohol',unit:'% ABV',dom:[4,18],dec:1,note:''},
{k:'tC',name:'Cellar temperature',unit:'°C',dom:[6,24],dec:1,note:'latest reading within 30 days'}];
function el(n,a,p){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
function q(s,p){var i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo)}
function st(v){var s=v.slice().sort(function(a,b){return a-b});return{n:s.length,min:s[0],q1:q(s,.25),med:q(s,.5),q3:q(s,.75),max:s[s.length-1]}}
function sep(a,u){var w=0;a.forEach(function(x){u.forEach(function(y){w+=x<y?1:x===y?.5:0})});return w/(a.length*u.length)}
function verdict(a,u){if(a.length<8||u.length<8)return{c:'na',t:'Too few readings to judge',s:null};var s=sep(a,u),d=Math.abs(s-.5),dir=s>.5?'lower':'higher';
if(d<.1)return{c:'none',t:'No clear difference',s:s};return{c:d<.2?'slight':'clear',t:(d<.2?'Slightly ':'Clearly ')+dir+' in film-yeast wines',s:s}}
function fmt(f,v){var n=v.toFixed(f.dec);return f.unit===''?n:f.unit==='%'?n+'%':f.log?n+' d':n+' '+f.unit}
function nice(lo,hi){var s=Math.pow(10,Math.floor(Math.log10((hi-lo)/5||1)));[1,2,5,10].some(function(m){if((hi-lo)/(s*m)<=7){s*=m;return true}});var t=[];for(var v=Math.ceil(lo/s-1e-9)*s;v<=hi+1e-9;v+=s)t.push(Math.round(v*1000)/1000);return t}
function tl(f,t){return f.log?(t>=1000?(t/1000)+'k':String(t)):String(t)}
function tipAt(h,ev){tip.innerHTML=h;tip.hidden=false;var w=tip.offsetWidth,x=ev.clientX+14;if(x+w>innerWidth-8)x=ev.clientX-w-14;tip.style.left=Math.max(8,x)+'px';tip.style.top=(ev.clientY+14)+'px'}
function draw(){var fam=document.querySelector('input[name=cmp]:checked').value==='fam',stems={};F.eps.forEach(function(e){stems[e.stem]=1});
var U=F.ctl.filter(function(c){return!fam||stems[c.stem]}),G=document.getElementById('fy-grid');G.innerHTML='';
document.getElementById('fy-nu').textContent=U.length;
FAC.forEach(function(f){var k=f.k,ok=function(e){return e[k]!==null&&e[k]!==undefined},av=F.eps.filter(ok).map(function(e){return e[k]}),bv=U.filter(ok).map(function(e){return e[k]});
var row=document.createElement('div');row.className='fy-r';G.appendChild(row);
if(!av.length||!bv.length){row.innerHTML='<div class="fy-h"><span class="fy-n">'+f.name+' <i>'+f.unit+'</i></span><span class="fy-v na">No readings to compare</span></div>';return}
var A=st(av),B=st(bv),v=verdict(av,bv);
row.innerHTML='<div class="fy-h"><span class="fy-n">'+f.name+' <i>'+f.unit+'</i></span><span class="fy-v '+v.c+'">'+v.t+'</span></div>';
var lo=Math.min(f.dom[0],A.min,B.min),hi=Math.max(f.dom[1],A.max,B.max),tr=f.log?function(x){return Math.log10(Math.max(0,x)+1)}:function(x){return x};
var W=Math.max(280,row.clientWidth),H=82,x0=6,x1=W-6,d0=tr(lo),d1=tr(hi),xs=function(x){return x0+(tr(x)-d0)/(d1-d0)*(x1-x0)};
var svg=el('svg',{viewBox:'0 0 '+W+' '+H,height:H,role:'img','aria-label':f.name+': film yeast median '+fmt(f,A.med)+', unaffected median '+fmt(f,B.med)},row);
if(f.band){el('rect',{x:xs(f.band[0]),y:14,width:xs(f.band[1])-xs(f.band[0]),height:42,fill:'#1d3022'},svg);var bt=el('text',{x:(xs(f.band[0])+xs(f.band[1]))/2,y:10,'text-anchor':'middle','class':'ref'},svg);bt.textContent='protective'}
var ticks=f.log?[0,1,3,10,30,100,300,1000,3000].filter(function(t){return t<=hi}):nice(lo,hi),last=-1e9;
ticks.forEach(function(t){var x=xs(t);if(x-last<30)return;last=x;el('line',{x1:x,x2:x,y1:14,y2:56,stroke:'#21262d'},svg);var tx=el('text',{x:x,y:72,'text-anchor':x>W-16?'end':x<16?'start':'middle'},svg);tx.textContent=tl(f,t)});
if(f.ref!=null){el('line',{x1:xs(f.ref),x2:xs(f.ref),y1:14,y2:56,stroke:'#8fc29a','stroke-dasharray':'3 3'},svg);var rt=el('text',{x:xs(f.ref)-3,y:10,'text-anchor':'end','class':'ref'},svg);rt.textContent=f.refL}
[[A,26,CA,'Film yeast'],[B,44,CU,'Unaffected']].forEach(function(g){var S=g[0],y=g[1],c=g[2];
el('line',{x1:xs(S.min),x2:xs(S.max),y1:y,y2:y,stroke:c,'stroke-width':1.5,'stroke-opacity':.55},svg);
el('rect',{x:xs(S.q1),y:y-5,width:Math.max(3,xs(S.q3)-xs(S.q1)),height:10,rx:4,fill:c,'fill-opacity':.85},svg);
el('circle',{cx:xs(S.med),cy:y,r:5.5,fill:c,stroke:'#161b22','stroke-width':2},svg);
var hit=el('rect',{x:0,y:y-9,width:W,height:18,fill:'transparent'},svg),h='<b style="color:'+c+'">●</b> <b>'+g[3]+'</b> · n '+S.n+'<br>median <b>'+fmt(f,S.med)+'</b><br>middle half '+fmt(f,S.q1)+' – '+fmt(f,S.q3)+'<br>range '+fmt(f,S.min)+' – '+fmt(f,S.max);
hit.addEventListener('mousemove',function(ev){tipAt(h,ev)});hit.addEventListener('mouseleave',function(){tip.hidden=true})});
var ft=document.createElement('div');ft.className='fy-f';ft.textContent='medians '+fmt(f,A.med)+' vs '+fmt(f,B.med)+' · n '+A.n+' vs '+B.n+(v.s!==null?' · film-yeast wine lower in '+Math.round(v.s*100)+'% of pairings':'')+(f.note?' · '+f.note:'');row.appendChild(ft)})}
document.querySelectorAll('input[name=cmp]').forEach(function(r){r.onchange=draw});var rt,lw=0;addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(function(){var w=document.getElementById('fy-grid').clientWidth;if(Math.abs(w-lw)>4){lw=w;draw()}},150)});draw()})()`;

// note edit page: "Film yeast episode" auto / yes / no
export function note_flag_field(c, nid, text) {
  const o = c.one('SELECT film FROM note_film WHERE note_id=?', nid);
  const cur = o ? String(o.film) : '';
  const auto = auto_film(text) ? 'yes' : 'no';
  return `<label style="flex:0 1 300px">Film yeast episode<select name="film"><option value="" ${cur === '' ? 'selected' : ''}>automatic (now: ${auto})</option><option value="1" ${cur === '1' ? 'selected' : ''}>yes</option><option value="0" ${cur === '0' ? 'selected' : ''}>no</option></select></label>`;
}
export function save_note_flag(c, nid, v) {
  if (v === '1' || v === '0') c.run('INSERT INTO note_film(note_id, film, at, by) VALUES (?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET film=excluded.film, at=excluded.at, by=excluded.by', nid, Number(v), nowIso(), ctx.user || 'HARDCASTLE, Ken');
  else c.run('DELETE FROM note_film WHERE note_id=?', nid);
}
