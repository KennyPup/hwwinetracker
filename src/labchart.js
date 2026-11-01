// v1.37 — the wine page's Lab tab as charts instead of a list (Ken, 2026-10-13: the list repeated History). Every reading is
// still on History and in the lab grid (/lab?batch=). Shows the latest value of each measurement, then a fermentation chart
// (Brix on the left axis, temperature °C on the right, °F in the hover) and one small chart for each other measurement the
// wine has (SG, free SO₂, pH, TA, alcohol, …) — new measurements appear by themselves once recorded. Opens on the last
// 90 days of readings (or all of them when those 90 days hold fewer than 6); "All" shows the whole history.
// v1.39 — a blended wine also shows the readings of the wines that went into it (traced back through transfers, blends,
// presses and batch changes, up to 3 steps): each source wine in its own colour, up to the day it was blended in. Sources
// that gave at least 10% of everything blended in are shown at first; the rest (topping wine etc.) can be ticked on. A source's
// readings are shown up to its main blend-in (the largest single transfer), since a source vessel can later hold other wine.
// A wine that was split off this one and later poured back (a reused carboy, a topping carboy) is not counted as a source.
// v1.40 — two charts, each with its own date axis (Ken, 2026-10-13: stacked charts with different date spans read as the same
// dates). Fermentation: Brix and temperature, with any other readings from that period in strips below on the same dates.
// Élevage: one strip per measurement (SG, free SO₂, pH, temperature, …), all on the same dates. The split is the wine's Stop
// ferment entry; without one, its first SO₂ reading after the last Brix. Opens on All (Recent is still a click away).
import { E, num } from './lib/py.js';

const NAME = { TempC: 'Temperature', 'Titratable Acidity': 'TA', 'Free SO2': 'Free SO₂', 'Total SO2': 'Total SO₂', 'Volatile acidity': 'VA' };
const UNIT = { Brix: '°Bx', TempC: '°C', 'Free SO2': 'mg/L', 'Total SO2': 'mg/L', 'Titratable Acidity': 'g/L', Alcohol: '%', 'Volatile acidity': 'g/L', SG: '', pH: '' };
const ORDER = ['Brix', 'TempC', 'SG', 'Free SO2', 'Total SO2', 'pH', 'Titratable Acidity', 'Alcohol', 'Volatile acidity'];
const DEC = { SG: 3, pH: 2, 'Titratable Acidity': 1, Alcohol: 1, 'Volatile acidity': 2, TempC: 1, Brix: 1, 'Free SO2': 0, 'Total SO2': 0 };
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = s => { const t = String(s || '').slice(0, 10); return t ? `${M[+t.slice(5, 7) - 1]} ${+t.slice(8, 10)}, ${t.slice(0, 4)}` : ''; };

export function blend_sources(c, bid) {
  // BFS back from this wine; each source is kept once, at its shortest path, with the volume that left it for its child
  // when each wine first took in this one (directly or via others): wine it sends back after that is a reused carboy, not a source
  const key = (t, id) => `${String(t).slice(0, 19)}#${String(id).padStart(9, '0')}`;
  const down = new Map([[bid, '']]);
  let fw = [bid];
  for (let d = 0; d < 6 && fw.length; d++) {
    const nx = [];
    for (const x of fw) for (const r of c.all(`SELECT DISTINCT COALESCE(t.batch_after_id, t.batch_id) z, o.occurred_at t, o.id id FROM op_vessel s JOIN operation o ON o.id=s.op_id AND o.reversed=0
                     JOIN op_vessel t ON t.op_id=s.op_id AND t.role='to'
                     WHERE (s.role='from' AND s.batch_id=?) OR (s.id=t.id AND t.batch_id=? AND t.batch_after_id IS NOT NULL)`, x, x)) {
      const k = key(r.t, r.id);
      if (!r.z || r.z === x || k < down.get(x)) continue;
      if (!down.has(r.z) || k < down.get(r.z)) { down.set(r.z, k); nx.push(r.z); }
    }
    fw = [...new Set(nx)];
  }
  const got = new Map();   // source -> { L, last, depth, child }
  let frontier = [[bid, 0]];
  const seen = new Set([bid]);
  while (frontier.length) {
    const next = [];
    for (const [y, depth] of frontier) {
      if (depth >= 3) continue;
      const ops = c.col(`SELECT DISTINCT ov.op_id FROM op_vessel ov JOIN operation o ON o.id=ov.op_id
                         WHERE o.reversed=0 AND ov.role='to' AND COALESCE(ov.batch_after_id, ov.batch_id)=?`, y);
      const here = new Map();
      for (const oid of ops) {
        const rs = c.all(`SELECT ov.role, ov.batch_id b, COALESCE(ov.batch_after_id, ov.batch_id) a, ov.vol_before_l vb, ov.vol_after_l va, o.occurred_at t
                          FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE ov.op_id=?`, oid);
        const to = rs.filter(r => r.role === 'to'), toY = to.filter(r => r.a === y);
        const add = (x, L, t) => {
          if (!x || x === y || x === bid || down.has(x) && down.get(x) <= key(t, oid) || seen.has(x) && !here.has(x) || !(L > 0.05)) return;
          const g = here.get(x) || { L: 0, last: '', bigL: 0 };
          g.L += L; if (L > g.bigL) { g.bigL = L; g.last = String(t); } here.set(x, g);   // "last" = the main blend-in, not a later top-up
        };
        for (const f of rs.filter(r => r.role === 'from' && r.b !== y)) add(f.b, ((f.vb || 0) - (f.va || 0)) * (toY.length / Math.max(1, to.length)), f.t);
        for (const t of toY) if (t.b && t.b !== y) add(t.b, t.vb || 0, t.t);
      }
      const tot = [...here.values()].reduce((s0, g) => s0 + g.L, 0);
      for (const [x, g] of here) {
        if (got.has(x)) continue;
        got.set(x, { ...g, depth: depth + 1, child: y, share: tot > 0 ? g.L / tot : 0 });
        seen.add(x); next.push([x, depth + 1]);
      }
    }
    frontier = next;
  }
  const code = x => c.val('SELECT code FROM batch WHERE id=?', x) || `#${x}`;
  const out = [...got.entries()].map(([x, g]) => ({ bid: x, code: code(x), ...g, childCode: g.child === bid ? null : code(g.child) }));
  // shown at first: direct sources with ≥ 10% of what went in, and their own ≥ 10% sources
  const on = new Set([bid]);
  for (const d of [1, 2, 3]) for (const s of out) if (s.depth === d && on.has(s.child) && s.share >= 0.1) { s.on = true; on.add(s.bid); }
  return out.sort((a, b) => a.depth - b.depth || b.L - a.L);
}

const PAL = ['#f0883e', '#a371f7', '#3fb950', '#d29922', '#ff7b72', '#79c0ff', '#e3b341', '#56d4dd'];
// v1.43 — colour = the measurement (same colour on every chart, strip label and hover key); line style + marker = the wine
// (this wine solid with dots; each blended-in wine its own dash and marker). Palette checked for colour-blind separation on the
// dark card surface (#161b22).
const PCOL = { Brix: '#3987e5', TempC: '#d95926', SG: '#199e70', 'Free SO2': '#c98500', 'Total SO2': '#d55181', pH: '#9085e9', 'Titratable Acidity': '#008300', Alcohol: '#e66767' };
const DASH = ['6 4', '2 3', '9 3 2 3', '4 2'], MK = ['sq', 'tri', 'dia', 'ring'];
const sty = i => ({ dash: DASH[i % 4], mk: MK[(i + Math.floor(i / 4)) % 4] });
const mkSvg = (mk, x, y, c) => mk === 'sq' ? `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="${c}"/>` : mk === 'tri' ? `<path d="M${x},${y - 4}L${x + 4},${y + 3}L${x - 4},${y + 3}Z" fill="${c}"/>`
  : mk === 'dia' ? `<path d="M${x},${y - 4}L${x + 4},${y}L${x},${y + 4}L${x - 4},${y}Z" fill="${c}"/>` : mk === 'ring' ? `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>` : `<circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`;
const sample = (dash, mk) => `<svg class="lc-ls" width="30" height="10" viewBox="0 0 30 10"><line x1="1" x2="29" y1="5" y2="5" stroke="#c9d1d9" stroke-width="1.6"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${mkSvg(mk, 15, 5, '#c9d1d9')}</svg>`;
const readings = (c, bid, upto = null) => c.all(`SELECT o.occurred_at t, a.metric m, a.value v FROM op_analysis a JOIN operation o ON o.id=a.op_id
                      WHERE a.batch_id=? AND o.reversed=0 AND a.value IS NOT NULL ${upto ? 'AND o.occurred_at<=?' : ''} ORDER BY o.occurred_at`, ...(upto ? [bid, upto] : [bid]));

export function lab_tab(c, bid) {
  const rows = readings(c, bid);
  const code = c.val('SELECT code FROM batch WHERE id=?', bid) || '';
  const links = `<p class="lc-links"><a href="/lab?batch=${bid}">＋ Record lab readings · see every reading in a grid</a> · every reading is also on the <a href="/batch/${bid}?tab=history">History</a> tab</p>`;
  // wines blended into this one, with their readings up to the day they went in
  const srcs = blend_sources(c, bid).map((s, i) => {
    const upto = s.last ? new Date(Date.parse(s.last.replace(' ', 'T') + 'Z') + 864e5).toISOString().slice(0, 19).replace('T', ' ') : null;
    return { ...s, rows: readings(c, s.bid, upto), color: PAL[i % PAL.length] };
  });
  const withData = srcs.filter(s => s.rows.length);
  if (!rows.length && !withData.length) return `<p class="muted">No lab readings on this wine yet.</p>${links}`;
  const allRows = [...rows, ...withData.flatMap(s => s.rows)];
  const mets = [...new Set(allRows.map(r => r.m))].sort((a, b) => ((ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  const last = new Map();
  for (const r of rows) last.set(r.m, r);
  const tiles = [...last.keys()].sort((a, b) => ((ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))).map(m => {
    const r = last.get(m), v = num(r.v, DEC[m] ?? 2);
    return `<div><span><i style="background:${PCOL[m] || '#8b949e'}"></i>${E(NAME[m] || m)}</span><b>${v}<small> ${E(UNIT[m] ?? '')}</small></b><em>${m === 'TempC' ? `${num(r.v * 9 / 5 + 32, 0)} °F · ` : ''}${E(day(r.t))}</em></div>`;
  }).join('');
  // recent = the 90 days up to the newest reading (this wine), unless thin — or the wine has blended-in sources to show
  const ts = [...new Set((rows.length ? rows : allRows).map(r => r.t))].sort();
  const cut = new Date(Date.parse(ts[ts.length - 1].replace(' ', 'T') + 'Z') - 90 * 864e5).toISOString().slice(0, 16).replace('T', ' ');
  let start = [...new Set(allRows.map(r => r.t))].sort()[0];
  const recentOK = rows.filter(r => r.t >= cut).length >= 6 && allRows.some(r => r.t < cut);
  const recentStart = recentOK ? ts.find(t => t >= cut) : start;
  const wines = [{ key: 'w0', code, dash: '', mk: 'dot', on: true, self: true }, ...withData.map((s, i) => ({ key: 'w' + (i + 1), code: s.code, ...sty(i), on: !!s.on, bid: s.bid }))];
  // fermentation vs élevage: split at the wine's Stop ferment entry; without one, at its first SO2 reading after the last Brix
  const stop = c.val(`SELECT MAX(o.occurred_at) FROM operation o JOIN op_vessel v ON v.op_id=o.id WHERE o.reversed=0 AND o.op_type='Stop ferment' AND (v.batch_id=? OR v.batch_after_id=?)`, bid, bid);
  const bx = (rows.some(r => r.m === 'Brix') ? rows : allRows).filter(r => r.m === 'Brix').map(r => r.t).sort().pop() || '';
  const so2 = stop ? null : rows.filter(r => /SO2$/.test(r.m) && r.t > bx).map(r => r.t).sort()[0] || null;
  const isE = t => stop ? t > stop : so2 ? t >= so2 : false;
  const splitNote = stop ? `Fermentation ends at the Stop ferment entry, ${day(stop)}; élevage readings follow.` : so2 ? `Élevage starts at the first SO₂ reading after fermentation, ${day(so2)}.` : '';
  const data = {};
  const put = (k, rs) => { data[k] = { f: {}, e: {} }; for (const r of rs) { const o = data[k][isE(r.t) ? 'e' : 'f']; (o[r.m] = o[r.m] || []).push([r.t.slice(0, 16), r.v]); } };
  put('w0', rows); withData.forEach((s, i) => put('w' + (i + 1), s.rows));
  const multi = withData.length > 0, defRecent = false;   // fermentation and élevage get their own charts, so All is the default; Recent stays one click away
  const noData = srcs.filter(s => !s.rows.length);
  const srcBox = multi || srcs.length ? `<div class="lc-src"><b>Blended into ${E(code)}</b> — readings of these wines are shown up to the day each was blended in. Tick to show or hide. On the charts, colour is the measurement and the line style is the wine.<div class="lc-wl"><span class="lc-self">${sample('', 'dot')}<b>${E(code)}</b> <small>this wine</small></span>
${withData.map((s, i) => `<label title="${E(`${num(s.L, 0)} L left ${s.code} for ${s.childCode || code} (as recorded, before press and transfer losses) — ${num(100 * s.share, 0)}% of what went into ${s.childCode || code}`)}"><input type="checkbox" data-w="w${i + 1}" ${s.on ? 'checked' : ''}>${sample(sty(i).dash, sty(i).mk)}<a href="/batch/${s.bid}?tab=lab">${E(s.code)}</a> <small>${num(s.L, 0)} L (${num(s.L / 3.785411784, 0)} gal) sent · ${num(100 * s.share, 0)}%${s.childCode ? ` of ${E(s.childCode)}` : ''} · to ${E(day(s.last))}</small></label>`).join('')}
${noData.length ? `<span class="muted" style="font-size:12px">Also blended in, no lab readings: ${noData.map(s => `<a href="/batch/${s.bid}">${E(s.code)}</a> (${num(s.L, 0)} L${s.childCode ? ` into ${E(s.childCode)}` : ''})`).join(', ')}</span>` : ''}</div></div>` : '';
  return `<div class="lc-tiles">${tiles || '<div><span>This wine</span><b>—</b><em>no readings of its own yet</em></div>'}</div>
${srcBox}
<div class="lc-bar"><span id="lcr">${defRecent ? `Showing the most recent readings, from ${E(day(recentStart))}` : 'All readings'}</span>${recentOK ? `<span class="lc-rng"><button data-r="recent" class="${defRecent ? 'on' : ''}">Recent</button><button data-r="all" class="${defRecent ? '' : 'on'}">All</button></span>` : ''}</div>
<div class="lc-card"><div class="lc-h"><b>Fermentation <small class="lc-rg"></small></b><span class="lc-lg"><i style="background:${PCOL.Brix}"></i>Brix <i style="background:${PCOL.TempC}"></i>Temperature °C (right axis)</span></div><div class="lc-c" data-p="f"></div></div>
<div class="lc-card"><div class="lc-h"><b>Élevage <small class="lc-rg"></small></b></div><div class="lc-c" data-p="e"></div></div>
${splitNote ? `<p class="lc-note">${E(splitNote)}</p>` : ''}
${links}<div id="lct" class="lc-tip" hidden></div>
<script>window.LCD=${JSON.stringify({ d: data, w: wines, multi, mode: defRecent ? 'recent' : 'all', start: recentStart.slice(0, 16), dec: DEC, name: NAME, unit: UNIT, order: ORDER, pc: PCOL }).replace(/</g, '\\u003c')};</script><script>${LCJS}</script>
<style>${LCCSS}</style>`;
}

const LCCSS = `.lc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:6px 0 12px}.lc-tiles div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
.lc-tiles span{display:block;font-size:11.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}.lc-tiles b{display:block;font-size:22px;color:var(--fg2);margin:1px 0}.lc-tiles b small{font-size:12px;font-weight:400;color:var(--mut)}.lc-tiles span i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:0}.lc-tiles em{font-style:normal;font-size:12px;color:var(--mut)}
.lc-src{background:var(--card);border:1px solid var(--line);border-left:4px solid #a371f7;border-radius:8px;padding:8px 12px;margin:0 0 10px;font-size:13px;color:var(--mut)}.lc-src>b{color:var(--fg2)}
.lc-wl{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:6px}.lc-wl label{display:flex;align-items:center;gap:6px;color:var(--fg);flex-direction:row;font-size:13px}.lc-wl i{display:inline-block;width:12px;height:12px;border-radius:2px}.lc-wl small{color:var(--mut)}
.lc-k{color:var(--fg2);letter-spacing:-1px;margin-left:10px}
.lc-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;color:var(--mut);font-size:13px;margin:4px 0 8px}
.lc-rng button{background:none;border:1px solid var(--line2);color:var(--mut);padding:4px 12px;font-size:12.5px;cursor:pointer;width:auto;margin:0 0 0 -1px}.lc-rng button:first-child{border-radius:6px 0 0 6px}.lc-rng button:last-child{border-radius:0 6px 6px 0}.lc-rng button.on{background:var(--line2);color:var(--fg2)}
.lc-card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px 6px;margin:0 0 12px}.lc-h{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}.lc-h b{color:var(--fg2)}.lc-h b small{color:var(--mut);font-weight:400}
.lc-h span{font-size:12.5px;color:var(--mut)}.lc-h i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 5px 0 10px;vertical-align:-1px}
.lc-c svg{display:block;width:100%}.lc-c text.lc-tl{fill:var(--fg2);font-size:11.5px}.lc-note{font-size:12.5px;color:var(--mut);margin:-4px 0 10px}.lc-c text{fill:var(--mut);font-size:11px}.lc-links{font-size:13px;color:var(--mut)}
.lc-wl .lc-ls{flex:none}.lc-self{display:flex;align-items:center;gap:6px;color:var(--fg);font-size:13px}.lc-tip .lc-sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:0}.lc-tip{position:fixed;z-index:50;background:#0d1117;border:1px solid var(--line2);border-radius:6px;padding:7px 10px;font-size:12.5px;color:var(--fg2);pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.5)}`;

// v1.65: the Fermentation chart alone, for the General tab while the wine ferments (replaces the daily table there)
export function ferm_chart(c, bid) {
  // only this fermentation: readings after the wine's latest Stop ferment entry, if it has one (a wine fermenting again)
  const stop = c.val(`SELECT MAX(o.occurred_at) FROM operation o JOIN op_vessel v ON v.op_id=o.id WHERE o.reversed=0 AND o.op_type='Stop ferment' AND (v.batch_id=? OR v.batch_after_id=?)`, bid, bid);
  const rows = readings(c, bid).filter(r => (r.m === 'Brix' || r.m === 'TempC' || r.m === 'SG') && (!stop || r.t > stop));
  if (!rows.length) return '';
  const code = c.val('SELECT code FROM batch WHERE id=?', bid) || '';
  const f = {};
  for (const r of rows) (f[r.m] = f[r.m] || []).push([r.t.slice(0, 16), r.v]);
  const D = { d: { w0: { f, e: {} } }, w: [{ key: 'w0', code, dash: '', mk: 'dot', on: true, self: true }], multi: false, mode: 'all', start: rows[0].t.slice(0, 16), dec: DEC, name: NAME, unit: UNIT, order: ORDER, pc: PCOL };
  return `<div class="lc-card" style="margin-top:10px"><div class="lc-h"><b>Fermentation <small class="lc-rg"></small></b><span class="lc-lg"><i style="background:${PCOL.Brix}"></i>Brix <i style="background:${PCOL.TempC}"></i>Temperature °C (right axis)</span></div><div class="lc-c" data-p="f"></div></div>
<div id="lct" class="lc-tip" hidden></div><script>window.LCD=${JSON.stringify(D).replace(/</g, '\\u003c')};</script><script>${LCJS}</script><style>${LCCSS}</style>`;
}

// charts drawn in the browser: one Fermentation chart and one Élevage chart, each with its own date axis shared by its tracks; no backticks or dollar-braces in here
const LCJS = `(function(){var D=window.LCD,tip=document.getElementById('lct'),NS='http://www.w3.org/2000/svg',mode=D.mode;
function P(s){return Date.parse(s.replace(' ','T')+':00Z')}
function el(n,a,p){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
function fmt(v,d){return Number(v).toFixed(d)}
var MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dl(t){var d=new Date(t);return MO[d.getUTCMonth()]+' '+d.getUTCDate()}
function dy(t){return dl(t)+', '+new Date(t).getUTCFullYear()}
function rng(a,b){var ya=new Date(a).getUTCFullYear(),yb=new Date(b).getUTCFullYear();if(dl(a)===dl(b)&&ya===yb)return dy(a);return (ya===yb?dl(a):dy(a))+' – '+dy(b)}
function ser(w,ph,k){var s=(((D.d[w]||{})[ph]||{})[k]||[]).map(function(p){return [P(p[0]),p[1],p[0]]});if(mode==='recent'){var t0=P(D.start);s=s.filter(function(p){return p[0]>=t0})}return s}
function ticks(lo,hi,n){var st=Math.pow(10,Math.floor(Math.log10((hi-lo)/n||1)));[1,2,5,10].some(function(k){if((hi-lo)/(st*k)<=n){st*=k;return true}});var out=[];for(var v=Math.ceil(lo/st)*st;v<=hi+1e-9;v+=st)out.push(v);return out}
function xt(t0,t1,w){var days=(t1-t0)/864e5,room=Math.max(2,Math.floor(w/72)),out=[],d=new Date(t0);
 if(days<=120){var st=[1,2,3,7,14,21,30].filter(function(s){return days/s<=room})[0]||30;d.setUTCHours(0,0,0,0);for(var t=d.getTime();t<=t1;t+=st*864e5)if(t>=t0)out.push([t,dl(t)]);return out}
 var k=[1,2,3,6,12,24].filter(function(s){return days/30.4/s<=room})[0]||24,y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
 for(;;m++){var tt=Date.UTC(y,m,1);if(tt>t1)break;var dd=new Date(tt);if((dd.getUTCMonth()+12*dd.getUTCFullYear())%k)continue;out.push([tt,MO[dd.getUTCMonth()]+(dd.getUTCMonth()===0||!out.length?' '+dd.getUTCFullYear():'')])}return out}
function on(){return D.w.filter(function(w){return w.on})}
function mark(m,cx,cy,c,svg){if(m==='sq')el('rect',{x:cx-3,y:cy-3,width:6,height:6,fill:c},svg);else if(m==='tri')el('path',{d:'M'+cx+','+(cy-4)+'L'+(cx+4)+','+(cy+3)+'L'+(cx-4)+','+(cy+3)+'Z',fill:c},svg);else if(m==='dia')el('path',{d:'M'+cx+','+(cy-4)+'L'+(cx+4)+','+cy+'L'+cx+','+(cy+4)+'L'+(cx-4)+','+cy+'Z',fill:c},svg);else if(m==='ring')el('circle',{cx:cx,cy:cy,r:3,fill:'#161b22',stroke:c,'stroke-width':1.5},svg);else el('circle',{cx:cx,cy:cy,r:3,fill:c},svg)}
function draw(box){box.innerHTML='';var ph=box.dataset.p,card=box.closest('.lc-card'),ws=on(),mets=[];
 ws.forEach(function(w){var o=(D.d[w.key]||{})[ph]||{};for(var m in o)if(mets.indexOf(m)<0&&ser(w.key,ph,m).length)mets.push(m)});
 mets.sort(function(a,b){return (((D.order.indexOf(a)+1)||99)-((D.order.indexOf(b)+1)||99))||(a<b?-1:1)});
 if(!mets.length){card.style.display='none';return}card.style.display='';
 var main=ph==='f'&&(mets.indexOf('Brix')>=0||mets.indexOf('TempC')>=0),lg=card.querySelector('.lc-lg');if(lg)lg.style.display=main?'':'none';
 var TR=[];if(main)TR.push({main:1,h:230,keys:['Brix','TempC']});
 mets.forEach(function(m){if(!(main&&(m==='Brix'||m==='TempC')))TR.push({h:84,keys:[m]})});
 var pts=[];TR.forEach(function(tr){tr.S=[];ws.forEach(function(w){tr.keys.forEach(function(k){var p=ser(w.key,ph,k);if(!p.length)return;var t2=tr.main&&k==='TempC';
  tr.S.push({w:w,k:k,ax:t2?1:0,c:D.pc[k]||'#8b949e',dash:w.dash||'',mk:w.mk||'dot',p:p});pts=pts.concat(p)})})});
 var t0=Math.min.apply(null,pts.map(function(p){return p[0]})),t1=Math.max.apply(null,pts.map(function(p){return p[0]}));
 var rg=card.querySelector('.lc-rg');if(rg)rg.textContent='· '+rng(t0,t1);
 if(t1-t0<864e5){t0-=432e5;t1+=432e5}else{var pd=(t1-t0)*0.02;t0-=pd;t1+=pd}
 var W=Math.max(320,box.clientWidth),ml=50,mr=main?46:14,LB=17,G=10,mb=24,y0=4;
 TR.forEach(function(tr){tr.top=y0+(tr.main?0:LB);y0=tr.top+tr.h+G});var H=y0-G+mb;
 var x=function(t){return ml+(t-t0)/(t1-t0)*(W-ml-mr)},svg=el('svg',{viewBox:'0 0 '+W+' '+H,height:H},box);
 xt(t0,t1,W-ml-mr).forEach(function(q){TR.forEach(function(tr){el('line',{x1:x(q[0]),x2:x(q[0]),y1:tr.top,y2:tr.top+tr.h,stroke:'#21262d'},svg)});var tx=el('text',{x:x(q[0]),y:H-6,'text-anchor':'middle'},svg);tx.textContent=q[1]});
 TR.forEach(function(tr){var top=tr.top;
  if(!tr.main){var k0=tr.keys[0];el('rect',{x:ml,y:top-14,width:9,height:9,rx:2,fill:D.pc[k0]||'#8b949e'},svg);var lab=el('text',{x:ml+14,y:top-5,'class':'lc-tl'},svg);lab.textContent=(D.name[k0]||k0)+(D.unit[k0]?' ('+D.unit[k0]+')':'')}
  el('rect',{x:ml,y:top,width:W-ml-mr,height:tr.h,fill:'none',stroke:'#30363d'},svg);
  [0,1].forEach(function(ax){var SS=tr.S.filter(function(s){return s.ax===ax});if(!SS.length)return;var vs=[].concat.apply([],SS.map(function(s){return s.p.map(function(p){return p[1]})}));
   var lo=Math.min.apply(null,vs),hi=Math.max.apply(null,vs);if(SS.some(function(s){return s.k==='Brix'})&&lo>0)lo=0;var pad=(hi-lo)*0.12||(Math.abs(hi)*0.02||1);lo-=pad;hi+=pad;
   var y=function(v){return top+(hi-v)/(hi-lo)*tr.h};tr['y'+ax]=y;var tk=ticks(lo,hi,tr.main?5:3);if(tk.length<2)tk=ticks(lo,hi,6);var stp=tk.length>1?tk[1]-tk[0]:1,dec=Math.max(stp>=1?0:stp>=0.1?1:stp>=0.01?2:3,SS[0].k==='SG'?3:0);
   tk.forEach(function(v){if(ax===0)el('line',{x1:ml,x2:W-mr,y1:y(v),y2:y(v),stroke:'#21262d'},svg);var t=el('text',{x:ax===0?ml-6:W-mr+6,y:y(v)+4,'text-anchor':ax===0?'end':'start'},svg);t.textContent=fmt(v,dec)})});
  tr.S.forEach(function(s){var y=tr['y'+s.ax];var a={d:s.p.map(function(p,i){return (i?'L':'M')+x(p[0]).toFixed(1)+','+y(p[1]).toFixed(1)}).join(''),fill:'none',stroke:s.c,'stroke-width':s.dash?1.6:2,'stroke-linejoin':'round'};if(s.dash)a['stroke-dasharray']=s.dash;el('path',a,svg);
   s.p.forEach(function(p){mark(s.mk,x(p[0]),y(p[1]),s.c,svg)})})});
 var hl=el('line',{y1:4,y2:H-mb,stroke:'#8b949e','stroke-dasharray':'3 3',opacity:0},svg),hit=el('rect',{x:ml,y:0,width:W-ml-mr,height:H-mb,fill:'transparent'},svg);
 var times=[];pts.forEach(function(p){if(times.indexOf(p[0])<0)times.push(p[0])});times.sort(function(a,b){return a-b});
 function mv(ev){var r=svg.getBoundingClientRect(),mx=(ev.clientX-r.left)*W/r.width,best=-1,bd=1e9;times.forEach(function(t,i){var dd=Math.abs(x(t)-mx);if(dd<bd){bd=dd;best=i}});
  if(best<0||bd>40){tip.hidden=true;hl.setAttribute('opacity',0);return}var t=times[best];hl.setAttribute('x1',x(t));hl.setAttribute('x2',x(t));hl.setAttribute('opacity',.6);
  var lines=[],when='';TR.forEach(function(tr){tr.S.forEach(function(s){s.p.forEach(function(p){if(p[0]===t){when=p[2];var v=fmt(p[1],D.dec[s.k]==null?2:D.dec[s.k]);lines.push('<i class="lc-sw" style="background:'+s.c+'"></i>'+(D.multi?s.w.code+' ':'')+(D.name[s.k]||s.k)+' '+v+' '+(D.unit[s.k]||'')+(s.k==='TempC'?' ('+Math.round(p[1]*9/5+32)+' °F)':''))}})})});
  tip.innerHTML='<b>'+when+'</b><br>'+lines.join('<br>');tip.hidden=false;var w=tip.offsetWidth,xx=ev.clientX+14;if(xx+w>innerWidth-8)xx=ev.clientX-w-14;tip.style.left=xx+'px';tip.style.top=(ev.clientY+14)+'px'}
 hit.addEventListener('mousemove',mv);hit.addEventListener('pointerdown',mv);hit.addEventListener('mouseleave',function(){tip.hidden=true;hl.setAttribute('opacity',0)})}
function all(){document.querySelectorAll('.lc-c').forEach(draw)}
document.querySelectorAll('.lc-rng button').forEach(function(b){b.addEventListener('click',function(){mode=b.dataset.r;document.querySelectorAll('.lc-rng button').forEach(function(x){x.classList.toggle('on',x===b)});
 var r=document.getElementById('lcr');if(r)r.textContent=mode==='all'?'All readings':'Showing the most recent readings, from '+dl(P(D.start))+', '+D.start.slice(0,4);all()})});
document.querySelectorAll('.lc-wl input').forEach(function(cb){cb.addEventListener('change',function(){D.w.forEach(function(w){if(w.key===cb.dataset.w)w.on=cb.checked});all()})});
all();var rt=0;addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(all,150)});
})();`;
