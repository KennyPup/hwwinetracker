// Port of ui_entry.py — entry screens for HWWineTracker (milestone 2). Pages are plain HTML forms; each POST calls a function in entry.js.
import { tip as HELP } from './help.js';
import { E, pyStr, fxc, nowIso, today, thisYear } from './lib/py.js';
import * as entry from './entry.js';
import * as notes from './notes.js';
import * as photos from './photos.js';
import { EntryError, pyInt, pyStrip, pyReplace, cmpStr } from './entry.js';
import { ui_entry as K } from './gen/strings.js';
import * as carb from './carb.js';
import * as VU from './vessel_ui.js';
import * as S2 from './so2.js';
import * as DIP from './dips.js';

export { E };
export const GAL = entry.GAL;

// dict.get(k, d) on the flat form dict
const _has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const G = (f, k, d = null) => (_has(f, k) ? f[k] : d);

// repr(float) as Python prints it (json.dumps uses the same digits)
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  const neg = x < 0 || Object.is(x, -0);
  const [mant, ex] = Math.abs(x).toExponential().split('e');
  const exp = Number(ex);
  const digits = mant.replace('.', '');
  let s;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const ip = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits.padEnd(exp + 1, '0');
      const fp = digits.length > exp + 1 ? digits.slice(exp + 1) : '0';
      s = ip + '.' + fp;
    } else {
      s = '0.' + '0'.repeat(-exp - 1) + digits;
    }
  } else {
    s = (digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits) + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  }
  return (neg ? '-' : '') + s;
}

// json.dumps(x) with Python's default separators and ensure_ascii. Every number is treated as a Python float
// (true for the data embedded here: volumes and unit factors). Map keeps insertion order for integer keys.
function jsonStr(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], c = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c > 0x7e) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}
export function pyJson(x) {
  if (x === null || x === undefined) return 'null';
  if (x === true) return 'true';
  if (x === false) return 'false';
  if (typeof x === 'number') {
    if (Number.isNaN(x)) return 'NaN';
    if (x === Infinity) return 'Infinity';
    if (x === -Infinity) return '-Infinity';
    return pyFloatRepr(x);
  }
  if (typeof x === 'string') return jsonStr(x);
  if (Array.isArray(x)) return '[' + x.map(pyJson).join(', ') + ']';
  const ents = x instanceof Map ? [...x.entries()] : Object.entries(x);
  return '{' + ents.map(([k, v]) => jsonStr(typeof k === 'string' ? k : pyStr(k)) + ': ' + pyJson(v)).join(', ') + '}';
}

export function _now_local() {
  return nowIso().slice(0, 16);
}

export function _vlabel(c) {
  const st = c.tax_state === 'BONDED' ? `declared ${pyStr(c.tax_class)}` : 'in fermenter';
  return `${pyStr(c.vessel)} · ${pyStr(c.batch)} · ${fxc(c.volume_l, 0)} L · ${st}`;
}

export function _vessel_select(name, contents, all_vessels = null, selected = null, empty_label = '— pick —') {
  const o = [`<option value="">${empty_label}</option>`];
  const occ = new Map(contents.map(c => [c.vessel_id, c]));
  if (all_vessels === null || all_vessels === undefined) {
    for (const c of contents) {
      o.push(`<option value="${c.vessel_id}" ${pyStr(selected) === pyStr(c.vessel_id) ? 'selected' : ''}>${E(_vlabel(c))}</option>`);
    }
  } else {
    for (const v of all_vessels) {
      const c = occ.has(v.id) ? occ.get(v.id) : null;
      const lab = c ? _vlabel(c) : `${pyStr(v.code)} · empty · ${v.capacity_l ? pyFloatRepr(v.capacity_l) : '?'} L`;
      o.push(`<option value="${v.id}" ${pyStr(selected) === pyStr(v.id) ? 'selected' : ''}>${E(lab)}</option>`);
    }
  }
  return `<select name="${name}" required>${o.join('')}</select>`;
}

export function _form(action, token, inner, submit = 'Save') {
  return `<form class="entry" method="post" action="${action}"><input type="hidden" name="_t" value="${token}">${inner}
      <div class="actions"><button>${E(submit)}</button> <a href="/record">Cancel</a></div></form>`;
}

export function _when_field(value = null) {
  return `<label>When<input type="datetime-local" name="when" value="${E(value || _now_local())}" required></label>`;
}

export function _notes_field(value = '') {
  return `<label class="wide">Notes<input name="notes" value="${E(value)}" placeholder="optional"></label>`;
}

export const ENTRY_CSS = K.ENTRY_CSS;
export const TILES = K.TILES.map(t => (t[0] === '/record/batch' ? ['/formulas?start=1', 'New batch', 'Start from the wine’s ★ master: ▶ Start a batch, adjust, ② Make this a batch'] : t));
let TILES2 = [];
export function setTiles2(t) { TILES2 = t; }

export function page_hub(c, token, msg = '') {
  const rows = c.all(`SELECT o.id, o.occurred_at, o.op_type, o.treatment, o.reversed, o.created_at, GROUP_CONCAT(DISTINCT v.code) vs, GROUP_CONCAT(DISTINCT b.code) bs
                        FROM operation o LEFT JOIN op_vessel ov ON ov.op_id=o.id LEFT JOIN vessel v ON v.id=ov.vessel_id LEFT JOIN batch b ON b.id=COALESCE(ov.batch_after_id, ov.batch_id)
                        WHERE o.source='app' AND o.id NOT IN (SELECT old_op FROM op_change WHERE kind IN ('correct','replay')) GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT 40`);
  const tr = rows.map(r => `<tr><td><a href="/op/${r.id}">${E(r.occurred_at.slice(0, 16))}</a></td><td>${E(r.op_type + (r.treatment ? ' · ' + r.treatment : ''))}</td>
        <td>${E(r.bs)}</td><td>${E(r.vs)}</td><td>${r.reversed ? '<span class=tag>reversed</span>' : `<span style="display:flex;gap:6px"><a class="btn btn2" href="/correct/${r.id}" style="padding:2px 8px;font-size:12px">Correct</a><form method="post" action="/reverse/${r.id}" style="margin:0" onsubmit="return confirm(&quot;Reverse this entry? Later entries on the same tanks or stock are replayed without it.&quot;)"><input type="hidden" name="_t" value="${token}"><button style="padding:2px 8px;font-size:12px">Reverse</button></form></span>`}</td></tr>`).join('');
  const tiles = [...TILES, ...TILES2].map(([h, t, d]) => `<a href="${h}"><b>${E(t)}</b><span>${E(d)}</span></a>`).join('');
  return `<h1>My entries</h1>${msg}<h2>Entered in HWWineTracker (latest 40)</h2>
      <table><thead><tr><th>When</th><th>Operation</th><th>Batch</th><th>Vessels</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan=5 class=muted>Nothing entered yet.</td></tr>'}</tbody></table>
      <p class="muted">Correct opens the entry’s form with what was saved: change any figure or the time, and later entries on the same tanks, barrels or stock are replayed from the corrected figures. Reverse removes an entry the same way. The original is always kept on file. Entries made before v1.1 can only be reversed latest-first; imported Vintrace history is read-only.</p>
      <details style="margin-top:18px"><summary class="muted" style="cursor:pointer">Start an entry without opening a wine first</summary><div class="tiles" style="margin-top:10px">${tiles}</div></details>`;
}

// sort key (tax_state == 'BONDED', batch, vessel)
const fermFirst = (a, b) => ((a.tax_state === 'BONDED') - (b.tax_state === 'BONDED')) || cmpStr(a.batch, b.batch) || cmpStr(a.vessel, b.vessel);

export function _occupied_checks(contents, name = 'vessels', only_ferm_first = true, selected = []) {
  const items = only_ferm_first ? [...contents].sort(fermFirst) : contents;
  const sel = (selected || []).map(x => pyStr(x));
  return '<div class="chk">' + items.map(c => `<label><input type="checkbox" name="${name}" value="${c.vessel_id}" ${sel.includes(pyStr(c.vessel_id)) ? 'checked' : ''}> ${E(_vlabel(c))}</label>`).join('') + '</div>';
}

// treatments: the built-in list plus every name already used (Vintrace history or added here), one spelling each
export function treatment_names(c) {
  const seen = new Map();
  const add = t => { const k = String(t).toLowerCase().replace(/\s+/g, ' ').trim(); if (k && !seen.has(k)) seen.set(k, String(t).trim()); };
  entry.TREATMENTS.forEach(add);
  c.col("SELECT treatment FROM operation WHERE treatment IS NOT NULL AND op_type='Treatment (Product)' GROUP BY treatment ORDER BY COUNT(*) DESC").forEach(add);
  return [...seen.values()];
}
function treatment_name(c, t, nt) {
  t = pyStrip(t === '__new' ? nt || '' : t || '');
  if (!t) throw new EntryError('Pick a treatment, or choose ＋ New treatment… and type its name.');
  if (t.length > 40) throw new EntryError('Treatment name is too long (40 characters max).');
  const same = treatment_names(c).find(x => x.toLowerCase().replace(/\s+/g, ' ') === t.toLowerCase().replace(/\s+/g, ' '));
  return same || t;
}

export function page_treatment(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const cur = G(f, 'treatment', '');
  const names = treatment_names(c);
  const opts = names.map(t => `<option ${cur === t ? 'selected' : ''}>${E(t)}</option>`).join('') + (cur && cur !== '__new' && !names.includes(cur) ? `<option selected>${E(cur)}</option>` : '')
    + `<option value="__new" ${cur === '__new' ? 'selected' : ''}>＋ New treatment…</option>`;
  const showC = cur === 'Carbonate';
  const csel = (n, items, v) => `<select name="${n}">${items.map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${E(t)}</option>`).join('')}</select>`;
  const carbF = `<div id="carbf" style="display:${showC ? 'contents' : 'none'}"><label>CO₂ level<input name="co2" inputmode="decimal" size="6" value="${E(G(f, 'co2', ''))}" placeholder="e.g. 1.8"></label>
      <label>Unit${csel('co2_unit', carb.UNITS, G(f, 'co2_unit', 'vol'))}</label><label>Where${csel('co2_where', carb.WHERE, G(f, 'co2_where', 'inhouse'))}</label>
      <p class="muted" style="flex-basis:100%;font-size:12px;margin:0">Still wine is ≤ 0.392 g CO₂/100 mL (about 2 volumes, 3.9 g/L); hard cider up to 0.64 g. Packaging uses this to pick the tax class — Flag Hill (injected) → (d).</p></div>`;
  const js = `onchange="var n=this.form.treatment_new;n.parentNode.style.display=this.value==='__new'?'':'none';n.required=this.value==='__new';document.getElementById('carbf').style.display=this.value==='Carbonate'?'contents':'none';if(this.value==='__new')n.focus()"`;
  const inner = `${_when_field(G(f, 'when'))}<label>Treatment<select name="treatment" ${js}>${opts}</select></label>
      <label style="${cur === '__new' ? '' : 'display:none'}">New treatment<input name="treatment_new" size="16" value="${E(G(f, 'treatment_new', ''))}" ${cur === '__new' ? 'required' : ''}></label>${carbF}${_notes_field(G(f, 'notes', ''))}
      <label class="wide">Vessels (fermenters listed first)</label>${_occupied_checks(cont, undefined, undefined, G(f, 'vessels'))}`;
  return `<h1>Punch down / pump over / treatment</h1>${err}` + _form('/record/treatment', token, inner);
}

export function page_lab(c, token, f = null, err = '') {
  f = f || {};
  // v1.20.2: opened from a batch's ＋ Record menu → only that batch's vessels (declared or not)
  const bsel = G(f, 'batch', '');
  let cont = entry.current_contents(c).sort(fermFirst);
  const bcode = bsel ? c.val('SELECT code FROM batch WHERE id=?', Number(bsel)) : null;
  if (bsel) cont = cont.filter(x => String(x.batch_id) === String(bsel));
  const cols = entry.METRICS.map(([m]) => m);
  const SH = { TempC: 'Temp', 'Free SO2': 'Free SO₂', 'Total SO2': 'Total SO₂', 'Titratable Acidity': 'TA', 'Volatile acidity': 'VA', 'Residual sugar': 'RS' };
  const head = cols.map(m => `<th title="${E(m)} — allowed ${entry.LIMITS[m] ? entry.LIMITS[m][0] + ' to ' + entry.LIMITS[m][1] + ' ' + entry.LIMITS[m][2] : ''}">${E(SH[m] || m)}</th>`).join('');
  const cell = (x, m) => {
    const key = `r_${x.vessel_id}_${m}`;
    return `<td><input name="${key}" inputmode="decimal" value="${E(G(f, key, ''))}"></td>`;
  };
  const rows = cont.map(x => `<tr class="${x.tax_state === 'BONDED' && !bsel ? 'decl' : ''}" style="${x.tax_state === 'BONDED' && !bsel ? 'display:none' : ''}"><td>${E(x.vessel)}</td><td>${E(x.batch)}</td><td class="n">${fxc(x.volume_l, 0)}</td><td>${x.tax_state === 'BONDED' ? 'declared' : 'fermenter'}</td>` +
    cols.map(m => cell(x, m)).join('') + '</tr>').join('');
  const tu = G(f, 'temp_unit', 'C');
  const inner = `${_when_field(G(f, 'when'))}<label>Temperature in<select name="temp_unit"><option value="C">°C</option><option value="F" ${tu === 'F' ? 'selected' : ''}>°F (converted to °C)</option></select></label>
      ${_notes_field(G(f, 'notes', ''))}${bsel ? `<input type="hidden" name="batch" value="${E(bsel)}"><span class="muted" style="align-self:center">${E(bcode || '')} only · <a href="/record/lab">all vessels</a></span>` : `<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="onlyf" checked onchange="document.querySelectorAll('tr.decl').forEach(r=>r.style.display=this.checked?'none':'')"> fermenters only</label>`}
      <div style="flex:1 1 100%;overflow:auto"><table class="grid"><thead><tr><th>Vessel</th><th>Batch</th><th>L</th><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  return `<h1>Lab readings${bcode ? ' · ' + E(bcode) : ''}</h1><p class="sub">` + 'Fill only the cells you measured; blank cells are ignored. Values outside a sensible range (hover a column heading) are refused — e.g. pH 2.5–5, Brix −5–42, SG 0.950–1.200, Temp −10–45 °C. Set When to the time the sample was taken.</p>' + err + _form('/record/lab', token, inner);
}

export function page_addition(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const mats = c.all("SELECT id, name, kind, base_unit FROM material WHERE COALESCE(retired,0)=0 ORDER BY CASE kind WHEN 'honey' THEN 0 WHEN 'sugar' THEN 1 WHEN 'water' THEN 2 ELSE 3 END, name");
  const mo = '<option value="">— pick —</option>' + mats.map(m => `<option value="${m.id}" data-kind="${E(m.kind)}" data-base="${E(m.base_unit)}" ${pyStr(G(f, 'material_id')) === pyStr(m.id) ? 'selected' : ''}>${E(m.name)} (${E(m.kind)}, ${E(m.base_unit)})</option>`).join('');
  const units = ['g', 'kg', 'lb', 'oz', 'ml', 'L', 'gal', 'units'].map(u => `<option ${G(f, 'unit') === u ? 'selected' : ''}>${u}</option>`).join('');
  const vol = new Map(cont.map(x => [x.vessel_id, x.volume_l]));
  const WG = VU.wine_groups(c, cont);
  for (const g of WG) vol.set('g' + g.gid, g.vol);
  const vb = new Map(cont.filter(x => x.batch_id).map(x => [x.vessel_id, x.batch_id]));   // v1.30 KMS panel: which wine a choice holds
  for (const g of WG) vb.set('g' + g.gid, [...g.batch][0]);
  const inner = `${_when_field(G(f, 'when'))}<label>Vessel${_vessel_select('vessel_id', cont, null, G(f, 'vessel_id')).replace('</select>', VU.group_opts(WG, G(f, 'vessel_id')) + '</select>')}</label>
      ${WG.length ? '<span class="muted" style="font-size:12px;align-self:center">A barrel group splits the amount across its barrels by volume (evenly when they match).' + HELP('groups') + '</span>' : ''}
      <label>Material<select name="material_id" required id="mat">${mo}</select></label>
      <label>Amount<input name="amount" inputmode="decimal" required value="${E(G(f, 'amount', ''))}" id="amt" size="8"></label><label>Unit<select name="unit" id="unit">${units}</select></label>
      <label>Lot #<input name="lot" size="8" value="${E(G(f, 'lot', ''))}" placeholder="optional"></label>
      <label>Volume after (L)<input name="volume_after" inputmode="decimal" value="${E(G(f, 'volume_after', ''))}" id="va" size="8" placeholder="unchanged"></label>
      <span class="muted" id="hint" style="font-size:12px"></span>
      ${[2, 3, 4].map(i => `<span style="flex:1 1 100%;height:0"></span><label>Also added (${i})<select name="material_id_${i}"><option value="">(none)</option>${mats.map(m => `<option value="${m.id}" ${pyStr(G(f, 'material_id_' + i)) === pyStr(m.id) ? 'selected' : ''}>${E(m.name)} (${E(m.kind)}, ${E(m.base_unit)})</option>`).join('')}</select></label>
      <label>Amount<input name="amount_${i}" inputmode="decimal" size="8" value="${E(G(f, 'amount_' + i, ''))}"></label><label>Unit<select name="unit_${i}">${['g', 'kg', 'lb', 'oz', 'ml', 'L', 'gal', 'units'].map(u => `<option ${G(f, 'unit_' + i) === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label><label>Lot #<input name="lot_${i}" size="8" value="${E(G(f, 'lot_' + i, ''))}"></label>`).join('')}
      ${_notes_field(G(f, 'notes', ''))}
      <script>const VOL=${pyJson(vol)};const DISP=${pyJson(entry.DISPLACEMENT_L_PER_KG)};const U=${pyJson(entry.UNIT_TO_BASE)};
      function sug(){const v=document.querySelector('[name=vessel_id]').value,o=document.getElementById('mat').selectedOptions[0];const a=parseFloat(document.getElementById('amt').value),u=U[document.getElementById('unit').value];
        if(!v||!o||!o.dataset.kind||!a||!u)return;const vb=VOL[v]||0;let add=0;
        if(o.dataset.kind==='water'&&u[0]==='L')add=a*u[1];else if(DISP[o.dataset.kind]&&u[0]==='kg')add=a*u[1]*DISP[o.dataset.kind];
        const h=document.getElementById('hint');if(add>0){document.getElementById('va').value=(vb+add).toFixed(0);h.textContent='suggested: '+vb.toFixed(0)+' L + '+add.toFixed(0)+' L ('+o.dataset.kind+') — edit to your dip reading';}else h.textContent='now '+vb.toFixed(0)+' L';}
      ['change','input'].forEach(e=>document.querySelector('form.entry').addEventListener(e,sug));</script>`;
  const kinds = ['honey', 'sugar', 'water', 'yeast', 'nutrient', 'enzyme', 'acid', 'sulfite', 'sorbate', 'fining', 'oak', 'bacteria', 'flavour', 'other'].map(k => `<option>${k}</option>`).join('');
  const mform = ('<label>Name<input name="name" required></label><label>Kind<select name="kind">' + kinds + '</select></label>' +
    '<label>Measured in<select name="base_unit"><option value="kg">weight (kg)</option><option value="L">volume (L)</option><option value="units">units</option></select></label>');
  const newmat = '<h2>New material</h2>' + _form('/record/material', token, mform, 'Add material');
  const panel = `<script>(function(){var VB=${pyJson(vb)},box=document.getElementById('so2panel'),cur='';
function upd(){var o=document.getElementById('mat').selectedOptions[0],v=document.querySelector('[name=vessel_id]').value,b=VB[v];
if(!o||o.dataset.kind!=='sulfite'||!b){box.innerHTML='';cur='';box.hidden=true;return}
box.hidden=false;if(cur===String(b))return;cur=String(b);box.innerHTML='<p class="muted">Working out SO₂…</p>';
fetch('/so2/panel?fill=1&b='+b,{credentials:'same-origin'}).then(function(r){return r.text()}).then(function(t){if(cur===String(b))box.innerHTML=t}).catch(function(){box.innerHTML='<p class="muted">Could not load the SO₂ panel.</p>'})}
box.addEventListener('click',function(e){var td=e.target.closest('.so2t');if(!td)return;var sel=document.querySelector('[name=vessel_id]');sel.value=td.dataset.v;document.getElementById('amt').value=td.dataset.g;document.getElementById('unit').value='g';
box.querySelectorAll('.so2t.on').forEach(function(x){x.classList.remove('on')});td.classList.add('on');sel.dispatchEvent(new Event('change',{bubbles:true}))});
['change','input'].forEach(function(ev){document.querySelector('form.entry').addEventListener(ev,function(e){if(e.target.name==='vessel_id'||e.target.id==='mat')upd()})});upd()})()</script>
<style>.addg{display:grid;gap:12px}@media (min-width:1100px){.addg:has(#so2panel:not([hidden])){grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);align-items:start}}.addg>*{min-width:0}</style>${S2.CSS}`;
  return '<h1>Addition</h1><p class="sub">Honey, sugar and water change the volume; the suggested new volume uses 0.70 L/kg honey, 0.62 L/kg sugar, 1 L/L water.</p>' + err + `<div class="addg"><div>${_form('/record/addition', token, inner)}</div><div id="so2panel" hidden></div></div>` + panel + newmat;
}

export function page_transfer(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const allv = c.all("SELECT id, code, capacity_l FROM vessel WHERE is_virtual=0 AND kind NOT IN ('press') AND active=1 ORDER BY kind, code");
  const batches = c.all('SELECT id, code FROM batch ORDER BY production_year DESC, code');
  const bo = '<option value="">(default: destination\'s batch, or source\'s if empty)</option>' + batches.map(b => `<option value="${b.id}" ${pyStr(G(f, 'result_batch_id')) === pyStr(b.id) ? 'selected' : ''}>${E(b.code)}</option>`).join('');
  const ro = entry.LOSS_REASONS.map(r => `<option ${G(f, 'loss_reason') === r ? 'selected' : ''}>${E(r)}</option>`).join('');
  const ops = ['Transfer', 'Racking', 'Press cycle', 'Blend', 'Rack & Return'].map(t => `<option ${G(f, 'op_type') === t ? 'selected' : ''}>${t}</option>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>Kind<select name="op_type">${ops}</select></label>
      <label>From${_vessel_select('from_id', cont, null, G(f, 'from_id'))}</label><label>To${pyReplace(_vessel_select('to_id', cont, allv, G(f, 'to_id'), '— pick — (Rack &amp; Return: leave blank)'), ' required', '')}</label>
      <label>Litres moved<input name="volume" inputmode="decimal" value="${E(G(f, 'volume', ''))}" size="8"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="empty_source" value="1" ${G(f, 'empty_source') ? 'checked' : ''}> empty the source (moves everything minus loss)</label>
      <label>Loss (L)<input name="loss" inputmode="decimal" value="${E(G(f, 'loss', '0'))}" size="6"></label><label>Loss reason<select name="loss_reason">${ro}</select></label>
      <label>Treatment<select name="treatment"><option value="">(none)</option>${entry.TREATMENTS.filter(t => /FILTER|Cold|Degas|Carbonate|Heat|Cool|Other/.test(t)).map(t => `<option ${G(f, 'treatment') === t ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></label>
      <label>Resulting batch<select name="result_batch_id">${bo}</select></label>
      <label>Resulting TTB status<select name="result_state"><option value="">(default: destination's, or source's if empty)</option><option value="NON_DECLARED" ${G(f, 'result_state') === 'NON_DECLARED' ? 'selected' : ''}>in fermenter / undeclared</option><option value="BONDED" ${G(f, 'result_state') === 'BONDED' ? 'selected' : ''}>declared</option></select></label>
      ${_notes_field(G(f, 'notes', ''))}`;
  return '<h1>Transfer / rack / press</h1><p class="sub">One vessel to one vessel. Several sources into one: <a href="/record/blend">Blend / combine</a>; one into several: <a href="/record/split">Split</a>; barrels: <a href="/record/topping">Topping</a>. Rack &amp; Return / filter in place: pick that kind, leave To blank and enter the loss. Moving undeclared wine into declared wine counts it as produced (Section A line 2) on that date.</p>' + err + _form('/record/transfer', token, inner);
}

export function page_measure(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const used = new Map(c.all('SELECT reason, COUNT(*) n FROM op_loss GROUP BY reason').map(r => [String(r.reason).toLowerCase(), r.n]));
  const sel = G(f, 'reason', '');
  const ro = entry.ADJUST_REASONS.map(([r, dir, hint]) => {
    const n = used.get(r.toLowerCase()) || 0;
    return `<option value="${E(r)}" data-dir="${dir}" ${sel === r ? 'selected' : ''}>${E(r)} — ${E(hint)}${dir === 'gain' ? ' (gain)' : dir === 'loss' ? ' (loss)' : ''}${n ? ` · used ${n}×` : ''}</option>`;
  }).join('');
  const info = {};
  const vtid = new Map(c.all('SELECT id, vt_id FROM vessel').map(r => [r.id, r.vt_id]));
  for (const x of cont) info[x.vessel_id] = { dip: (DIP.chart(vtid.get(x.vessel_id)) || {}).pts || null, v: Math.round(x.volume_l * 100) / 100, cap: x.capacity_l || null, b: x.batch || '', bid: x.batch_id || null, st: x.tax_state === 'BONDED' ? `declared, class ${x.tax_class}` : 'in fermenter (undeclared)', dec: x.tax_state === 'BONDED' ? 1 : 0 };
  if (f.__before !== undefined && info[G(f, 'vessel_id')]) Object.assign(info[G(f, 'vessel_id')], { v: Math.round(Number(f.__before) * 100) / 100, pre: 1 });   // correcting: compare with the volume before that entry
  const WG = VU.wine_groups(c, cont);
  for (const g of WG) info['g' + g.gid] = { v: Math.round(g.vol * 100) / 100, cap: g.cap || null, b: g.batch, bid: null, st: `barrel group of ${g.ids.length} — the change is spread evenly`, dec: cont.some(y => g.ids.includes(y.vessel_id) && y.tax_state === 'BONDED') ? 1 : 0 };
  const inner = `${_when_field(G(f, 'when'))}<label>Vessel${_vessel_select('vessel_id', cont, null, G(f, 'vessel_id')).replace('</select>', VU.group_opts(WG, G(f, 'vessel_id')) + '</select>')}</label>
      <div class="wide adjnow" id="adjnow" data-nouc></div>
      <label id="dipW" hidden>Dip (cm from the top)<input name="dip" id="adjD" data-uc="1" inputmode="decimal" size="6" autocomplete="off" value="${E(G(f, 'dip', ''))}"></label>
      <label>New volume (L)<input name="new_volume" id="adjL" data-uc="1" inputmode="decimal" required value="${E(G(f, 'new_volume', ''))}" size="8" autocomplete="off"></label>
      <label>or in gallons<input id="adjG" data-uc="1" inputmode="decimal" size="8" autocomplete="off"></label>
      <div class="wide adjdip" id="adjdh" data-nouc></div>
      <div class="wide adjdiff" id="adjdiff" data-nouc></div>
      <label class="wide">Reason<select name="reason" id="adjR">${ro}</select></label><div class="wide adjttb" id="adjttb" data-nouc></div>
      <label class="wide">Notes<input name="notes" id="adjN" value="${E(G(f, 'notes', ''))}" placeholder="optional"></label>`;
  const js = `<style>.adjnow{font-size:15px;padding:8px 10px;border:1px solid var(--line,#30363d);border-radius:8px;background:var(--card,#161b22)}
.adjnow b{font-size:18px}.adjdiff{font-size:16px;font-weight:600;min-height:20px}.adjdip{font-size:13.5px;color:var(--mut,#8b949e);min-height:0;margin-top:-4px}.adjttb{font-size:13.5px;color:var(--mut,#8b949e);min-height:18px;margin-top:-4px}.adjdiff.loss{color:#f0883e}.adjdiff.gain{color:#3fb950}
select option:disabled{color:#6e7681}#dipW[hidden]{display:none}</style>
<script>(function(){var I=${JSON.stringify(info).replace(/</g, '\\u003c')},G=3.785411784;var vs=document.querySelector('select[name=vessel_id]'),L=document.getElementById('adjL'),Ga=document.getElementById('adjG'),
R=document.getElementById('adjR'),now=document.getElementById('adjnow'),df=document.getElementById('adjdiff'),TT=document.getElementById('adjttb'),NB=document.getElementById('adjN'),DD=0,DI=document.getElementById('adjD'),DW=document.getElementById('dipW'),DH=document.getElementById('adjdh');
function dipL(p,t){if(!p||!isFinite(t)||t<p[0][0]||t>p[p.length-1][0])return null;for(var i=1;i<p.length;i++)if(t<=p[i][0]){var a=p[i-1],b=p[i];return b[0]===a[0]?b[1]:a[1]+(b[1]-a[1])*(t-a[0])/(b[0]-a[0]);}return p[p.length-1][1];}
function dipShow(){var x=cur(),p=x&&x.dip;DW.hidden=!p;if(!p){DI.value='';DH.textContent='';return;}var s=(DI.value||'').trim(),t=/^[0-9]+([.,][0-9]+)?$/.test(s)?Number(s.replace(',','.')):NaN;
 if(DI.value===''){if(DH.dataset.filled){delete DH.dataset.filled;L.value=x.v;Ga.value=Math.round(x.v/G*100)/100;auto=false;diff();}DH.textContent='Dip chart for this tank: '+p[0][0]+' cm = '+f(p[0][1],0)+' L (full) … '+p[p.length-1][0]+' cm = '+f(p[p.length-1][1],0)+' L. Type a dip to fill the new volume.';return;}
 var l=dipL(p,t);if(l===null){DH.textContent=isNaN(t)?'Dip '+DI.value+' is not a number.':'Dip '+DI.value+' cm is outside this tank\u2019s chart ('+p[0][0]+'\u2013'+p[p.length-1][0]+' cm).';return;}
 DH.textContent='Dip '+t+' cm \u2192 '+f(l,1)+' L ('+f(l/G,1)+' gal) from the tank\u2019s dip chart.';L.value=Math.round(l*10)/10;Ga.value=Math.round(l/G*100)/100;DH.dataset.filled='1';auto=false;diff();}
DI.addEventListener('input',dipShow);
function h(t){return String(t).replace(/[&<>"]/g,function(c){return'&#'+c.charCodeAt(0)+';'});}function f(x,d){return x.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function cur(){return I[vs.value]||null;}
function show(){var x=cur();if(!x){now.innerHTML='Pick the vessel to see what is in it now.';return;}
 now.innerHTML=(x.pre?'Before this entry: <b>':'Now in this vessel: <b>')+f(x.v,1)+' L</b> ('+f(x.v/G,1)+' gal)'+(x.b?' of <b>'+h(x.b)+'</b>':'')+(x.cap?' · capacity '+f(x.cap,0)+' L ('+f(x.cap/G,0)+' gal), '+Math.round(100*x.v/x.cap)+'% full':'')+' · '+h(x.st);}
function diff(){var x=cur(),n=parseFloat((L.value||'').replace(/,/g,''));df.className='wide adjdiff';
 if(!x||!isFinite(n)){df.textContent='';dir(0);return;}var d=n-x.v;
 if(Math.abs(d)<0.0005){df.textContent='No change — saves a volume check with no loss or gain.';dir(0);return;}
 df.className+=d<0?' loss':' gain';df.textContent=(d<0?'Loss of ':'Gain of ')+f(Math.abs(d),1)+' L ('+f(Math.abs(d)/G,2)+' gal)'+(x.cap&&n>x.cap*1.02?' — more than the vessel holds!':'');dir(d<0?-1:1);}
function ttb(){var x=cur(),r=R.value||'';if(!x||DD===0){TT.textContent='';return;}
 if(!x.dec){TT.textContent='TTB: not on the report yet — this wine is still in the fermenter (undeclared); the change is kept on the batch.';return;}
 var t=r==='TTB - Used for testing'?'Section A line 23 (used for testing)':r==='TTB - Destroyed'?'Section A line 24 (destroyed)':r==='TTB - Casualty loss'?'Section A line 29 (casualty loss)':r==='TTB - Water addition'?'Section A line 6 (produced by amelioration)':DD<0?'Section A line 30 (inventory loss)':'Section A line 9 (inventory gain)';
 TT.textContent='TTB: this '+(DD<0?'loss':'gain')+' goes to '+t+'.';}
R.addEventListener('change',ttb);
function dir(s){DD=s;var bad=s<0?'gain':s>0?'loss':'';for(var i=0;i<R.options.length;i++){var o=R.options[i];o.disabled=!!bad&&o.dataset.dir===bad;}
 if(R.selectedOptions[0]&&R.selectedOptions[0].disabled){for(var j=0;j<R.options.length;j++)if(!R.options[j].disabled){R.selectedIndex=j;break;}}ttb();}
L.addEventListener('input',function(){var n=parseFloat((L.value||'').replace(/,/g,''));Ga.value=isFinite(n)?(Math.round(n/G*100)/100):'';diff();});
Ga.addEventListener('input',function(){var n=parseFloat((Ga.value||'').replace(/,/g,''));L.value=isFinite(n)?(Math.round(n*G*10)/10):'';diff();});
var auto=!L.value;function pre(){var x=cur();if(auto&&x){L.value=x.v;}var n=parseFloat(L.value);Ga.value=isFinite(n)?Math.round(n/G*100)/100:'';}
L.addEventListener('focus',function(){if(auto){L.select();}});L.addEventListener('input',function(){auto=false;});Ga.addEventListener('input',function(){auto=false;});
vs.addEventListener('change',function(){DI.value='';show();pre();diff();dipShow();});
L.addEventListener('input',function(){if(DI.value){DI.value='';dipShow();}});Ga.addEventListener('input',function(){if(DI.value){DI.value='';dipShow();}});
show();pre();diff();dipShow();})();</script>`;
  return `<h1>⚖ Adjust volume</h1><p class="sub">Enter what is in the vessel now (a dip or a corrected figure). The difference is recorded on the batch as a loss or a gain with its reason — the same 14 reasons used in your records since 2019. On declared wine: TTB reasons go to Section A line 23 (testing), 24 (destroyed) or 29 (casualty); other drops are inventory losses (line 30) and rises inventory gains (line 9). Correct or reverse it later from the operation page.</p>` + err + _form('/record/measure', token, inner) + js;
}

export function page_declare(c, token, f = null, err = '') {
  f = f || {};
  const cont = [...entry.current_contents(c)];
  const co = entry.TAX_CLASSES.map(([k, n]) => `<option value="${k}" ${G(f, 'tax_class') === k ? 'selected' : ''}>(${k}) ${E(n)}</option>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>Tax class<select name="tax_class" required><option value="">— pick —</option>${co}</select></label>${_notes_field(G(f, 'notes', ''))}
      <label class="wide">Vessels to declare (already-declared vessels change class only)</label>${_occupied_checks(cont, undefined, undefined, G(f, 'vessels'))}`;
  return '<h1>Declare wine (TTB)</h1><p class="sub">Use when fermentation is complete. The volume moves from Part VII (in fermenters) into Section A as "produced by fermentation" on this date.</p>' + err + _form('/record/declare', token, inner);
}

export function page_batch(c, token, f = null, err = '') {
  f = f || {};
  const y = String(thisYear());
  const bt = entry.BEVERAGE_TYPES.map(b => `<option ${G(f, 'beverage_type') === b ? 'selected' : ''}>${b}</option>`).join('');
  const bi = entry.BASE_INGREDIENTS.map(b => `<option ${G(f, 'base_ingredient') === b ? 'selected' : ''}>${b}</option>`).join('');
  const vars_ = c.col('SELECT DISTINCT variety FROM batch WHERE variety IS NOT NULL UNION SELECT DISTINCT variety FROM intake WHERE variety IS NOT NULL ORDER BY 1').map(v => `<option value="${E(v)}">`).join('');
  const regions = c.col('SELECT DISTINCT region FROM batch WHERE region IS NOT NULL ORDER BY 1').map(v => `<option value="${E(v)}">`).join('');
  const inner = `<label>Batch code<input name="code" required value="${E(G(f, 'code', y.slice(2)))}" size="12" placeholder="${y.slice(2)}NecTom"></label>
      <label>Description<input name="description" value="${E(G(f, 'description', ''))}" size="30" placeholder="${y} Nectarine Tomato"></label>
      <label>Vintage<input name="vintage" value="${E(G(f, 'vintage', y))}" size="6"></label>
      <label>Type<select name="beverage_type">${bt}</select></label><label>Based on<select name="base_ingredient">${bi}</select></label>
      <label>Main variety / ingredient<input name="variety" list="vars" value="${E(G(f, 'variety', ''))}"><datalist id="vars">${vars_}</datalist></label>
      <label>Region<input name="region" list="regs" value="${E(G(f, 'region', 'New Hampshire'))}"><datalist id="regs">${regions}</datalist></label>${_notes_field(G(f, 'notes', ''))}`;
  return `<h1>New batch</h1>${err}` + _form('/record/batch', token, inner, 'Create batch');
}

// Fruit / ingredient names for the Intake form: everything delivered before (fruit and bulk), one spelling per name.
// A new name typed on the form joins this list as soon as that delivery is saved.
export function intake_varieties(c) {
  const seen = new Map();
  for (const v of c.col("SELECT variety FROM intake WHERE variety IS NOT NULL AND kind IN ('fruit','bulk') AND lower(variety)<>'water' ORDER BY id")) {
    const k = v.toLowerCase().replace(/[\s\-]/g, '');
    if (!seen.has(k) || (/^[a-z]/.test(seen.get(k)) && /^[A-Z]/.test(v))) seen.set(k, v);
  }
  return [...seen.values()].map(v => v.charAt(0).toUpperCase() + v.slice(1)).sort((a, b) => a.localeCompare(b));
}
function intake_variety(c, v, nv) {
  v = pyStrip(v === '__new' ? nv || '' : v || '');
  if (!v) throw new EntryError('Pick the fruit / ingredient, or choose ＋ New fruit / ingredient… and type its name.');
  if (v.length > 40) throw new EntryError('Fruit / ingredient name is too long (40 characters max).');
  const k = v.toLowerCase().replace(/[\s\-]/g, '');
  const same = intake_varieties(c).find(x => x.toLowerCase().replace(/[\s\-]/g, '') === k);
  return same || v.charAt(0).toUpperCase() + v.slice(1);
}

export function page_intake(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const allv = c.all("SELECT id, code, capacity_l FROM vessel WHERE is_virtual=0 AND kind NOT IN ('press') AND active=1 ORDER BY kind, code");
  const batches = c.all('SELECT id, code, description FROM batch WHERE production_year>=? OR id IN (SELECT batch_id FROM bulk_snapshot WHERE snap_date=(SELECT MAX(snap_date) FROM bulk_snapshot)) ORDER BY id DESC',
    Number(today().slice(0, 4)) - 1);
  const bo = '<option value="">— none: hold on hand (fruit) —</option>' + batches.map(b => `<option value="${b.id}" ${pyStr(G(f, 'batch_id')) === pyStr(b.id) ? 'selected' : ''}>${E(b.code)} · ${E(b.description || '')}</option>`).join('');
  const vcur = G(f, 'variety', '');
  const vlist = intake_varieties(c);
  const vknown = !vcur || vcur === '__new' || vlist.includes(vcur);
  const vopts = '<option value="">— pick —</option>' + vlist.map(v => `<option ${v === vcur ? 'selected' : ''}>${E(v)}</option>`).join('')
    + (vknown ? '' : `<option selected>${E(vcur)}</option>`) + `<option value="__new" ${vcur === '__new' ? 'selected' : ''}>＋ New fruit / ingredient…</option>`;
  const sup = c.col('SELECT DISTINCT supplier FROM intake WHERE supplier IS NOT NULL UNION SELECT name FROM party ORDER BY 1').map(v => `<option value="${E(v)}">`).join('');
  const ko = [['fruit', 'Fruit (by weight)'], ['bulk', 'Bulk juice / cider (by volume)']].map(([k, t]) => `<option value="${k}" ${G(f, 'kind') === k ? 'selected' : ''}>${t}</option>`).join('');
  const uo = ['lb', 'kg', 'L', 'gal'].map(u => `<option ${G(f, 'unit') === u ? 'selected' : ''}>${u}</option>`).join('');
  const vsel = pyReplace(_vessel_select('vessel_id', cont, allv, G(f, 'vessel_id'), '(no vessel yet)'), ' required', '');
  const inner = `${_when_field(G(f, 'when'))}<label>What<select name="kind">${ko}</select></label><label>Batch<select name="batch_id">${bo}</select></label>
      <label>Variety / ingredient<select name="variety" required onchange="var n=this.form.variety_new;n.parentNode.style.display=this.value==='__new'?'':'none';n.required=this.value==='__new';if(this.value==='__new')n.focus()">${vopts}</select></label>
      <label style="${vcur === '__new' ? '' : 'display:none'}">New name<input name="variety_new" size="14" placeholder="e.g. Grapes" value="${E(G(f, 'variety_new', ''))}" ${vcur === '__new' ? 'required' : ''}></label>
      <label>Supplier / grower<input name="supplier" list="sups" value="${E(G(f, 'supplier', ''))}"><datalist id="sups">${sup}</datalist></label>
      <label>Region<input name="region" value="${E(G(f, 'region', 'New Hampshire'))}"></label>
      <label>Amount<input name="amount" inputmode="decimal" required value="${E(G(f, 'amount', ''))}" size="8"></label><label>Unit<select name="unit">${uo}</select></label>
      <label>Docket / invoice<input name="docket" value="${E(G(f, 'docket', ''))}" size="10"></label><label>Booking #<input name="booking_no" value="${E(G(f, 'booking_no', ''))}" size="6"></label><label>Cost ($, total)<input name="cost" inputmode="decimal" value="${E(G(f, 'cost', ''))}" size="8"></label>
      <label>Into vessel${vsel}</label><label>Litres into vessel (fruit must)<input name="fill_litres" inputmode="decimal" value="${E(G(f, 'fill_litres', ''))}" size="8" placeholder="bulk: = amount"></label>
      ${_notes_field(G(f, 'notes', ''))}`;
  return '<h1>Intake</h1><p class="sub">Fruit: leave Batch blank and it goes on the <a href="/intakes">on-hand list</a>; pick a batch only if it goes straight in (then it is recorded as used). Bulk juice/cider needs a batch (<a href="/record/batch">create it first</a>). Honey is a material: receive it on <a href="/materials">Materials</a>. Fruit goes to TTB Part IV by weight; bulk juice/cider by gallons.</p>' + err + _form('/record/intake', token, inner);
}

export function page_note(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const inb = new Set(cont.filter(x => x.batch_id).map(x => x.batch_id));
  let batches = c.all('SELECT id, code, description FROM batch ORDER BY production_year DESC, code');
  batches = [...batches].sort((a, b) => (!inb.has(a.id)) - (!inb.has(b.id)));
  const bo = '<option value="">— pick —</option>' + batches.map(b => `<option value="${b.id}" ${pyStr(G(f, 'batch_id')) === pyStr(b.id) ? 'selected' : ''}>${E(b.code)} · ${E(b.description || '')}${inb.has(b.id) ? '' : ' (not in cellar)'}</option>`).join('');
  const vo = '<option value="">(whole batch / no vessel)</option>' + cont.map(x => `<option value="${x.vessel_id}" data-b="${x.batch_id || ''}" ${pyStr(G(f, 'vessel_id')) === pyStr(x.vessel_id) ? 'selected' : ''}>${E(x.vessel)} · ${E(x.batch)}</option>`).join('');
  const inner = `${_when_field(G(f, 'when'))}<label>Batch<select name="batch_id" required id="nb">${bo}</select></label><label>Vessel<select name="vessel_id" id="nv">${vo}</select></label>
      <label class="wide">Note <span class="muted" style="font-weight:400">— starts with its date and time; change the time in When above if you're writing it up later</span><textarea name="text" id="nt" rows="8" style="font:inherit;padding:8px;border:1px solid var(--line);border-radius:4px;background:var(--card);color:var(--fg)" required>${E(G(f, 'text', ''))}</textarea></label>
      <script>(function(){const b=document.getElementById('nb'),v=document.getElementById('nv');function f(){[...v.options].forEach(o=>{if(o.value)o.hidden=b.value&&o.dataset.b!==b.value})};b.onchange=f;f();
       const w=document.querySelector('input[name=when]'),t=document.getElementById('nt'),rx=/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} — /;
       function st(){const s=(w.value||'').slice(0,16).replace('T',' ')+' — ';if(!t.value.trim())t.value=s;else if(rx.test(t.value))t.value=t.value.replace(rx,s);}
       w.addEventListener('change',st);st();t.focus();t.setSelectionRange(t.value.length,t.value.length);})();</script>${photos.picker()}`;
  return `<h1>Add note</h1>${err}` + _form('/record/note', token, inner, 'Save note');
}

// ------------------------------------------------------------------ POST handlers -> [redirect_url | null, error_message]
export function _ids(v) {
  return v.filter(x => pyStrip(pyStr(x))).map(x => pyInt(x));
}

// str.split(sep, maxsplit)
function pySplit(s, sep, max) {
  const parts = s.split(sep);
  return parts.length > max + 1 ? [...parts.slice(0, max), parts.slice(max).join(sep)] : parts;
}

const NOTE_VALUE_ERRORS = new Set(['The note is empty.', 'Pick a batch.']);   // notes.add_note raised ValueError for these

// f: parse_qs(body, keep_blank_values=True) — object of arrays
export function post(c, path, f) {
  const g = (k, d = '') => (_has(f, k) && f[k] && f[k].length ? f[k] : [d])[0];
  try {
    let op;
    if (path === '/record/treatment') {
      const tname = treatment_name(c, g('treatment'), g('treatment_new'));
      let k = null;
      if (tname === 'Carbonate') { try { k = carb.from_form(g); } catch (e) { throw new EntryError(e.message); } }
      const nt = [g('notes'), k ? carb.describe(k) : ''].filter(x => x).join(' · ');
      op = entry.record_treatment(c, g('when'), tname, _ids(G(f, 'vessels', [])), nt || null);
      if (k) c.run('UPDATE operation SET details=? WHERE id=?', JSON.stringify({ carb: k }), op);
    } else if (path === '/record/lab') {
      const rd = new Map();
      for (const [k, v] of Object.entries(f)) {
        if (k.startsWith('r_')) {
          const parts = pySplit(k, '_', 2);
          if (parts.length !== 3) {
            const e = new Error(`not enough values to unpack (expected 3, got ${parts.length})`);
            throw e;
          }
          const [, vid, m] = parts;
          const id = pyInt(vid);
          if (!rd.has(id)) rd.set(id, new Map());
          rd.get(id).set(m, v[0]);
        }
      }
      op = entry.record_analysis(c, g('when'), rd, g('notes'), g('temp_unit', 'C'));
    } else if (path === '/record/addition') {
      const extra = [2, 3, 4].filter(i => g('material_id_' + i)).map(i => [pyInt(g('material_id_' + i)), g('amount_' + i), g('unit_' + i), g('lot_' + i)]);
      if (/^g\d+$/.test(g('vessel_id'))) {   // v1.27 a whole barrel group
        const grp = VU.wine_groups(c, entry.current_contents(c)).find(x => 'g' + x.gid === g('vessel_id'));
        if (!grp) throw new EntryError('That barrel group holds no wine now.');
        op = entry.record_addition_group(c, g('when'), grp.ids, pyInt(g('material_id') || 0), g('amount'), g('unit'), g('volume_after'), g('notes'), extra, g('lot'), grp.code);
      } else
      op = entry.record_addition(c, g('when'), pyInt(g('vessel_id') || 0), pyInt(g('material_id') || 0), g('amount'), g('unit'), g('volume_after'), g('notes'), extra, g('lot'));
    } else if (path === '/record/press') {
      const tos = f.to_id || [], js = f.juice || [];
      const dests = tos.map((v, k) => [v, js[k]]);
      // the must tank is empty after a finished press: go back to the (first) receiving vessel's page/card instead
      if (g('done') && f._next && f._next[0] && tos[0]) f._next[0] = String(f._next[0]).replace(new RegExp(`^/(m/v|vessel)/${pyInt(g('from_id') || 0)}$`), `/$1/${pyInt(tos[0] || 0)}`);
      op = entry.record_press(c, g('when'), pyInt(g('from_id') || 0), dests, !!g('done'), g('press') || null, g('fraction') || 'Combined', g('result_batch_id') || null, g('notes'));
    } else if (path === '/record/transfer') {
      op = entry.record_transfer(c, g('when'), pyInt(g('from_id') || 0), pyInt(g('to_id') || 0), g('volume') || 0, g('loss') || 0, g('loss_reason'),
        !!g('empty_source'), g('result_batch_id') || null, g('result_state') || null, g('op_type', 'Transfer'), g('notes'), g('treatment') || null);
    } else if (path === '/record/measure') {
      const why = false;   // v1.72.2 (Ken): notes are optional again (v1.70 required a Why)
      if (/^g\d+$/.test(g('vessel_id'))) {   // v1.27 a whole barrel group
        const grp = VU.wine_groups(c, entry.current_contents(c)).find(x => 'g' + x.gid === g('vessel_id'));
        if (!grp) throw new EntryError('That barrel group holds no wine now.');
        op = entry.record_measurement_group(c, g('when'), grp.ids, g('new_volume'), g('reason'), g('notes'), grp.code, why);
      } else
      {   // v1.72: a dip reading sets the new volume from the tank's dip chart (Vintrace calibration)
        const vid = pyInt(g('vessel_id') || 0), dipRaw = String(g('dip') || '').trim();
        if (dipRaw && !/^[0-9]+([.,][0-9]+)?$/.test(dipRaw)) throw new EntryError(`Dip "${dipRaw}" is not a number.`);
        const dip = dipRaw.replace(',', '.');
        let nv = g('new_volume'), nt = g('notes');
        if (dip) {
          const ch = DIP.chart(c.val('SELECT vt_id FROM vessel WHERE id=?', vid));
          if (!ch) throw new EntryError('This tank has no dip chart — enter the new volume instead.');
          const L = DIP.litres(ch, dip);
          if (L === null) throw new EntryError(`Dip ${dip} cm is outside this tank's chart (${ch.pts[0][0]}–${ch.pts[ch.pts.length - 1][0]} cm).`);
          nv = String(Math.round(L * 10) / 10);
          if (String(nt || '').trim()) nt = `Dip ${dip} cm (= ${fxc(L, 1)} L from the dip chart). ${nt}`;
        }
        op = entry.record_measurement(c, g('when'), vid, nv, g('reason'), nt, why);
        if (dip && !String(nt || '').trim() && op) c.run('UPDATE operation SET notes=? WHERE id=?', `Dip ${dip} cm (= ${nv} L from the dip chart)`, op);   // a no-change dip check keeps its reading
      }
    } else if (path === '/record/declare') {
      op = entry.record_declare(c, g('when'), _ids(G(f, 'vessels', [])), g('tax_class'), g('notes'));
    } else if (path === '/record/batch') {
      const bid = entry.create_batch(c, g('code'), g('description'), g('vintage'), g('beverage_type'), g('base_ingredient'), g('variety'), g('region'), g('notes'));
      return [`/batch/${bid}`, null];
    } else if (path === '/record/intake') {
      op = entry.record_intake(c, g('when'), g('kind'), pyInt(g('batch_id') || 0), intake_variety(c, g('variety'), g('variety_new')), g('supplier'), g('region'), g('amount'), g('unit'), g('docket'),
        g('vessel_id') ? pyInt(g('vessel_id')) : null, g('fill_litres'), g('notes'), g('booking_no'), g('cost'));
    } else if (path === '/record/material') {
      const name = pyStrip(g('name'));
      if (!name) throw new EntryError('Material name is required.');
      if (c.one('SELECT 1 FROM material WHERE name=?', name)) throw new EntryError(`${name} already exists.`);
      c.run('INSERT INTO material(name,kind,base_unit,ttb_part_iv) VALUES (?,?,?,?)', name, g('kind'), g('base_unit'),
        g('kind') === 'sugar' ? 'sugar_dry' : (g('kind') === 'honey' ? 'others' : null));
      c.commit();
      return ['/record/addition', null];
    } else if (path === '/record/note') {
      try {
        const nid = notes.add_note(c, pyReplace(g('when'), ' ', 'T'), pyInt(g('batch_id') || 0), g('vessel_id') ? pyInt(g('vessel_id')) : null, g('text'));
        photos.attach_posted(c, nid, f);
      } catch (e) {
        if (e && e.constructor === Error && NOTE_VALUE_ERRORS.has(e.message)) throw new EntryError(e.message);
        throw e;
      }
      return [`/batch/${pyInt(g('batch_id'))}?tab=notes`, null];
    } else if (path.startsWith('/reverse/')) {
      entry.reverse_operation(c, pyInt(path.slice(path.lastIndexOf('/') + 1)));
      return ['/record?done=reversed', null];
    } else {
      return [null, 'Unknown form.'];
    }
    return [`/record?done=${op}`, null];
  } catch (e) {
    if (typeof c.rollback === 'function') c.rollback();
    if (e instanceof EntryError) return [null, e.message];
    return [null, `Unexpected error: ${e && e.message !== undefined ? e.message : pyStr(e)}`];
  }
}

export function page_press(c, token, f = null, err = '') {
  f = f || {};
  const cont = entry.current_contents(c);
  const allv = c.all("SELECT id, code, capacity_l FROM vessel WHERE is_virtual=0 AND kind NOT IN ('press') AND active=1 ORDER BY kind, code");
  const batches = c.all('SELECT id, code FROM batch ORDER BY production_year DESC, code');
  const bo = '<option value="">(default: the must\'s batch, or the destination\'s if it holds wine)</option>' + batches.map(b => `<option value="${b.id}" ${pyStr(G(f, 'result_batch_id')) === pyStr(b.id) ? 'selected' : ''}>${E(b.code)}</option>`).join('');
  const used = c.col("SELECT json_extract(details,'$.press') p FROM operation WHERE op_type='Press cycle' AND details IS NOT NULL ORDER BY occurred_at DESC");
  const presses = [...new Set([...entry.PRESSES, ...used.filter(Boolean)])];
  const pr = presses.map(p => `<option ${(G(f, 'press') || used[0] || '') === p ? 'selected' : ''}>${E(p)}</option>`).join('');
  const fr = entry.FRACTIONS.map(x => `<option ${(G(f, 'fraction') || 'Combined') === x ? 'selected' : ''}>${E(x)}</option>`).join('');
  const done = f.juice === undefined ? true : !!G(f, 'done');
  const info = {};
  for (const x of cont) info[x.vessel_id] = { v: Math.round(x.volume_l * 10) / 10, b: x.batch || '' };
  const inner = `${_when_field(G(f, 'when'))}
      <label>Must from (tank)${_vessel_select('from_id', cont, null, G(f, 'from_id'))}</label><div id="prinfo" class="muted" style="font-size:13px;margin:-4px 0 6px"></div>
      <div id="prd"><div class="prrow"><label>Juice into${pyReplace(_vessel_select('to_id', cont, allv, G(f, 'to_id'), '— pick the receiving vessel —'), ' required', '')}</label>
      <label>Litres<input name="juice" inputmode="decimal" value="${E(G(f, 'juice', ''))}" size="7"></label></div></div>
      <div><button type="button" id="pradd" class="btn" style="width:auto">＋ Add another container</button> <span id="prtot" class="muted" style="font-size:13px"></span></div>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="done" value="1" ${done ? 'checked' : ''}> Press done — empty the must tank (what's left is pomace, booked as press loss)</label>
      <label>Press<select name="press">${pr}</select></label><label>Fraction<select name="fraction">${fr}</select></label>
      <label>Resulting batch<select name="result_batch_id">${bo}</select></label>
      ${_notes_field(G(f, 'notes', ''))}
<script>(function(){var I=${JSON.stringify(info).replace(/</g, '\\u003c')},s=document.querySelector('[name=from_id]'),o=document.getElementById('prinfo');function u(){var x=I[s.value];o.textContent=x?(x.b+' · '+x.v+' L on record in this tank'):''}s.addEventListener('change',u);u();
var d=document.getElementById('prd'),T=document.getElementById('prtot');function tot(){var n=0,k=0;d.querySelectorAll('[name=juice]').forEach(function(e){var v=parseFloat(e.value);if(v>0){n+=v;k++}});T.textContent=k>1?('Total juice '+Math.round(n*10)/10+' L in '+k+' containers'):''}
d.addEventListener('input',tot);document.getElementById('pradd').onclick=function(){var r=d.querySelector('.prrow').cloneNode(true);r.querySelectorAll('select').forEach(function(x){x.selectedIndex=0;x.required=false});r.querySelectorAll('input').forEach(function(x){x.value=''});
var b=document.createElement('button');b.type='button';b.textContent='✕';b.className='btn';b.style.cssText='width:auto;align-self:end';b.title='Remove this container';b.onclick=function(){r.remove();tot()};r.appendChild(b);d.appendChild(r)}})()</script>
<style>.prrow{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;margin:4px 0}</style>`;
  return '<h1>Press</h1><p class="sub">Must through the press into one or more containers (＋ Add another container). With "press done" ticked, the litres on record for the must minus the total juice out are booked as press loss (pomace); if more juice came out than was on record, the extra is booked first as a press gain. Untick it to move only a first fraction (e.g. free run) and press the rest later.</p>' + err + _form('/record/press', token, inner);
}

export const PAGES = {
  '/record/press': page_press,
  '/record/treatment': page_treatment, '/record/lab': page_lab, '/record/addition': page_addition, '/record/transfer': page_transfer,
  '/record/measure': page_measure, '/record/declare': page_declare, '/record/batch': page_batch, '/record/intake': page_intake, '/record/note': page_note,
};
