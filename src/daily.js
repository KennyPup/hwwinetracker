// Daily fermentation log on the batch page: Brix, temperature, punch downs / pump overs — one box, one save.
// Saved as ordinary entries (lab reading, treatments), so they show in the history, the chart and Correct.
import { E, nowIso } from './lib/py.js';
import * as entry from './entry.js';
import { captured } from './correct.js';
import { _when_field } from './ui_entry.js';
import { ferm_chart } from './labchart.js';

const cToF = c => c * 9 / 5 + 32;
const f1 = v => (v === null || v === undefined || !isFinite(v) ? '' : (Math.round(v * 10) / 10).toFixed(1));

function vessels_of(c, bid) { return entry.current_contents(c).filter(x => x.batch_id === bid); }

export function daily_box(c, bid, token, err = '') {
  const vs = vessels_of(c, bid);
  if (!vs.length) return '';
  const vpick = vs.length > 1
    ? `<label style="flex-basis:100%;flex-direction:row;gap:12px;flex-wrap:wrap">Vessels ${vs.map(v => `<span style="white-space:nowrap"><input type="checkbox" name="vessels" value="${v.vessel_id}" checked style="width:auto"> ${E(v.vessel)}</span>`).join(' ')}</label>`
    : `<input type="hidden" name="vessels" value="${vs[0].vessel_id}">`;
  const cnt = n => `<select name="${n}">${[0, 1, 2, 3, 4].map(i => `<option value="${i}">${i ? i + '×' : '—'}</option>`).join('')}</select>`;
  // last 10 days for this batch
  const days = new Map();
  const day = d => { if (!days.has(d)) days.set(d, { brix: null, t: null, pd: 0, po: 0 }); return days.get(d); };
  for (const r of c.all(`SELECT substr(o.occurred_at,1,10) d, a.metric, a.value FROM op_analysis a JOIN operation o ON o.id=a.op_id
                         WHERE a.batch_id=? AND o.reversed=0 AND a.metric IN ('Brix','TempC','SG') ORDER BY o.occurred_at`, bid)) {
    const x = day(r.d); if (r.metric === 'Brix') x.brix = r.value; else if (r.metric === 'TempC') x.t = r.value; else x.sg = r.value;
  }
  for (const r of c.all(`SELECT DISTINCT o.id, substr(o.occurred_at,1,10) d, o.treatment, o.notes FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
                         WHERE (ov.batch_id=? OR ov.batch_after_id=?) AND o.reversed=0 AND o.treatment IN ('Punch down','Pump over')`, bid, bid)) {
    const n = Number((/^(\d+)×/.exec(r.notes || '') || [0, 1])[1]);
    const x = day(r.d); if (r.treatment === 'Punch down') x.pd += n; else x.po += n;
  }
  const rows = [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 10);
  // v1.65: the chart goes under the inputs; the day-by-day numbers stay one click away
  const log = rows.length ? `<details style="margin-top:4px"><summary class="muted" style="cursor:pointer;font-size:13px">Day-by-day numbers (last ${rows.length} day${rows.length === 1 ? '' : 's'})</summary><table style="max-width:640px;margin-top:8px"><thead><tr><th>Day</th><th class="n">Brix</th><th class="n">SG</th><th class="n">Temp</th><th class="n">Punch down</th><th class="n">Pump over</th></tr></thead><tbody>${
    rows.map(([d, x]) => `<tr><td>${E(d)}</td><td class="n">${x.brix !== null ? f1(x.brix) : ''}</td><td class="n">${x.sg ? Number(x.sg).toFixed(3) : ''}</td><td class="n">${x.t !== null ? `${f1(x.t)} °C <span class="muted">(${f1(cToF(x.t))} °F)</span>` : ''}</td><td class="n">${x.pd || ''}</td><td class="n">${x.po || ''}</td></tr>`).join('')}</tbody></table></details>` : '';
  return `<h2>Fermentation reading <span class="muted" style="font-size:13px;font-weight:400">— set When to the time of the sample · <a href="/record/lab?batch=${bid}&_next=${encodeURIComponent('/batch/' + bid)}">all lab readings (pH, SO₂, TA …)</a></span></h2>${err}
    <form class="entry" method="post" action="/batch/${bid}/daily" id="daily"><input type="hidden" name="_t" value="${E(token)}">
      ${_when_field()}${vpick}
      <label>Brix<input name="brix" inputmode="decimal" size="6" data-uc="1" placeholder="e.g. 18.5"></label>
      <label>SG<input name="sg" inputmode="decimal" size="6" placeholder="e.g. 1.072"></label>
      <label>Temperature<input name="temp" inputmode="decimal" size="6" data-uc="1"><span class="muted" id="d_tc" style="font-size:12px"></span></label>
      <label>in<select name="temp_unit"><option value="C">°C</option><option value="F">°F</option></select></label>
      <label>Punch down${cnt('pd')}</label><label>Pump over${cnt('po')}</label>
      <div class="actions"><button>Save today</button></div></form>${ferm_chart(c, bid)}${log}
    <script>(function(){const f=document.getElementById('daily');if(!f)return;const t=f.temp,u=f.temp_unit,h=document.getElementById('d_tc');
     try{const s=localStorage.getItem('hwt_tu2');if(s)u.value=s}catch(e){}
     function up(){const v=parseFloat(t.value);h.textContent=isFinite(v)?(u.value==='F'?' = '+((v-32)*5/9).toFixed(1)+' °C':' = '+(v*9/5+32).toFixed(1)+' °F'):'';try{localStorage.setItem('hwt_tu2',u.value)}catch(e){}}
     t.addEventListener('input',up);u.addEventListener('change',up);up()})();</script>`;
}

export function post_daily(c, bid, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  if (!c.one('SELECT 1 x FROM batch WHERE id=?', bid)) return [null, 'No such batch.'];
  const mine = new Set(vessels_of(c, bid).map(v => v.vessel_id));
  const vids = (f.vessels || []).map(Number).filter(v => mine.has(v));
  if (!vids.length) return [null, 'Pick at least one vessel holding this batch.'];
  const when = entry._when(g('when'));
  const brix = g('brix'), sg = g('sg'), temp = g('temp'), tu = g('temp_unit') === 'F' ? 'F' : 'C';   // v1.20.1: °C is the default
  const pd = Number(g('pd') || 0), po = Number(g('po') || 0);
  if (!brix && !sg && !temp && !pd && !po) return [null, 'Enter a Brix, an SG, a temperature or a punch down / pump over.'];
  if (brix || sg || temp) {
    const rd = new Map(), form = { when: [when], temp_unit: [tu], notes: [''] };
    for (const v of vids) {
      const m = new Map();
      if (brix) { m.set('Brix', brix); form[`r_${v}_Brix`] = [brix]; }
      if (sg) { m.set('SG', sg); form[`r_${v}_SG`] = [sg]; }
      if (temp) { m.set('TempC', temp); form[`r_${v}_TempC`] = [temp]; }
      rd.set(v, m);
    }
    captured(c, '/record/lab', form, () => { entry.record_analysis(c, when, rd, null, tu); return ['ok', null]; });
  }
  for (const [t, n] of [['Punch down', pd], ['Pump over', po]]) {
    if (!(n > 0)) continue;
    const notes = n > 1 ? `${n}× today` : null;
    captured(c, '/record/treatment', { when: [when], treatment: [t], vessels: vids.map(String), notes: [notes || ''] },
      () => { entry.record_treatment(c, when, t, vids, notes); return ['ok', null]; });
  }
  return [`/batch/${bid}?saved=1`, null];
}
