// v1.2 — "＋ Record" on a batch page: one menu of every entry form for this wine. Every entry form opens with the batch and
// the chosen tank already filled in, and returns to this batch page after saving (_next).
import { E } from './lib/py.js';
import { ctx, READONLY } from './core.js';
import * as carb from './carb.js';

// [group, [[label, url template, kind]]]  kind: 'v' = one vessel, 'vs' = one or all vessels, '' = no vessel needed
// {v} vessel id, {vs} repeated &vessels=, {b} batch id
const MENU = [
  ['Admin', [['Change batch', '/record/changebatch?{vs}', 'vs'], ['Rename batch', '/batch/{b}/rename', ''], ['Note', '/record/note?batch={b}', '']]],
  ['General', [['Addition', '/record/addition?vessel_id={v}', 'v'], ['Lab readings (Brix, SG, temp, pH, SO₂ …)', '/record/lab?batch={b}', ''], ['Ferment check (phone screen)', '/m/check?v={v}', 'v'],
    ['Punch down / pump over', '/record/treatment?{vs}', 'vs'], ['⚖ Adjust volume (loss / gain)', '/record/measure?vessel_id={v}', 'v'],
    ['Start / stop ferment', '/record/ferment?{vs}', 'vs'], ['Declare (TTB)', '/record/declare?{vs}', 'vs'], ['Packaging (bottle / can / keg)', '/record/bottling?vessel_id={v}&batch={b}', 'v'],
    ['Intake (fruit, honey, juice)', '/record/intake?batch_id={b}&vessel_id={v}', 'v'], ['Fill / extraction', '/record/fill?batch_id={b}', '']]],
  ['Transfers', [['Press (must → juice)', '/record/press?from_id={v}', 'v'], ['Transfer', '/record/transfer?from_id={v}&op_type=Transfer', 'v'], ['Racking', '/record/transfer?from_id={v}&op_type=Racking', 'v'],
    ['Rack & Return', '/record/transfer?from_id={v}&op_type=Rack%20%26%20Return', 'v'], ['Blend (many into one)', '/record/blend?sv={v}', 'v'],
    ['Split (one into many)', '/record/split?from_id={v}', 'v'], ['Topping (barrels from a tank)', '/record/topping?from_id={v}', 'v']]],
];

// vessels: [{id, code, volume_l}] the batch is in now
export function batch_menu(bid, code, vessels, bgroups = []) {
  const next = `/batch/${bid}`;
  const vsel = vessels.length
    ? `<label class="om-v">Tank / barrel <select id="omv">${vessels.map(v => `<option value="${v.id}">${E(v.code)} · ${Math.round(v.volume_l || 0)} L</option>`).join('')}${bgroups.map(g => `<option value="g${g.gid}" data-ms="${g.ids.join(',')}">Barrel group ${E(g.code)} · ${g.ids.length} barrels · ${Math.round(g.vol)} L</option>`).join('')}${vessels.length > 1 ? `<option value="all">All ${vessels.length} vessels</option>` : ''}</select></label>`
    : '<p class="muted" style="margin:0 0 8px">Not in any vessel now — only the entries that don’t need a vessel are shown.</p>';
  // v1.62: the everyday cellar steps as big buttons at the top (press, lab, addition, rack, transfer, packaging, punch down, note)
  const COMMON = [['🍇', 'Press', '/record/press?from_id={v}', 'v'], ['🔬', 'Lab readings', '/record/lab?batch={b}', ''], ['🧪', 'Addition', '/record/addition?vessel_id={v}', 'v'],
    ['↪', 'Rack', '/record/transfer?from_id={v}&op_type=Racking', 'v'], ['⇄', 'Transfer', '/record/transfer?from_id={v}&op_type=Transfer', 'v'],
    ['📦', 'Packaging', '/record/bottling?vessel_id={v}&batch={b}', 'v'], ['✊', 'Punch down', '/record/treatment?{vs}', 'vs'], ['📝', 'Note', '/record/note?batch={b}', '']];
  const common = COMMON.filter(([, , , k]) => !k || vessels.length).map(([ic, t, u, k]) => `<a href="#" class="om-c" data-u="${E(u)}" data-k="${k}"><span>${ic}</span>${E(t)}</a>`).join('');
  const groups = MENU.map(([g, items]) => {
    const li = items.filter(([, , k]) => !k || vessels.length).map(([t, u, k]) => `<a href="#" data-u="${E(u)}" data-k="${k}">${E(t)}</a>`).join('');
    return li ? `<div class="om-g"><b>${E(g)}</b>${li}</div>` : '';
  }).join('');
  const ro = READONLY() ? `<p class="om-ro">The real records are read-only until cutover from Vintrace — these forms save only in the <a href="/practice/on?next=${encodeURIComponent(next)}">practice copy</a>.</p>` : '';
  return `<button type="button" class="om-btn" onclick="document.getElementById('om').showModal()" title="Record something on ${E(code)}">＋ Record</button>
<dialog id="om" class="om"><form method="dialog"><button class="om-x" aria-label="Close">×</button></form><h2>Record on ${E(code)}</h2>${ro}${vsel}<div class="om-com">${common}</div><div class="om-more">Everything else</div><div class="om-cols">${groups}</div></dialog>
<style>.om-btn{background:#d29922;color:#1a0e00;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer;margin-left:10px;vertical-align:middle}
dialog.om{background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:10px;padding:18px 22px;max-width:760px;width:calc(100% - 32px)}dialog.om::backdrop{background:rgba(0,0,0,.55)}
.om h2{margin:0 0 10px;font-size:18px;color:#e6edf3}.om-x{position:absolute;right:12px;top:8px;background:none;border:0;color:#8b949e;font-size:24px;cursor:pointer}
.om-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px 22px}.om-g b{display:block;margin:10px 0 4px;color:#e6edf3}.om-g a{display:block;padding:3px 0;color:#58a6ff;text-decoration:none}.om-g a:hover{text-decoration:underline}
.om-com{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:12px 0 4px}.om-com a.om-c{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;font-weight:600;text-decoration:none}.om-com a.om-c:hover{border-color:#58a6ff}.om-com span{font-size:18px}.om-more{margin-top:12px;color:#8b949e;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.om-v{display:flex;gap:8px;align-items:center;font-size:14px}.om-v select{background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:5px 8px}
.om-ro{background:#2a2410;border:1px solid #6b5514;color:#f0d68a;border-radius:8px;padding:8px 10px;font-size:13px}.om-ro a{color:#fff}</style>
<script>(function(){var d=document.getElementById('om'),all=${JSON.stringify(vessels.map(v => v.id))},b=${bid},tb=(location.search.match(/[?&]tab=([a-z]+)/)||[])[1],nx=${JSON.stringify(next)}+(tb&&tb!=='general'?'?tab='+tb:'');
d.querySelectorAll('a[data-u]').forEach(function(a){a.onclick=function(e){e.preventDefault();var s=document.getElementById('omv'),v=s?s.value:'',k=a.dataset.k;
var gm=v.charAt(0)==='g'?s.selectedOptions[0].dataset.ms.split(','):null,whole=a.dataset.u.indexOf('/record/addition')===0||a.dataset.u.indexOf('/record/measure')===0;
var one=v==='all'?all[0]:gm?(whole?v:gm[0]):v,vs=(v==='all'?all:gm||[v]).map(function(x){return 'vessels='+x}).join('&');
var u=a.dataset.u.replace('{v}',one).replace('{vs}',vs).replace('{b}',b);if(u.indexOf('/record/')===0)u+=(u.indexOf('?')<0?'?':'&')+'_next='+encodeURIComponent(nx);location.href=u}})})()</script>`;
}

// hidden _next field in a Record form opened from a batch page / phone card
// where an entry form may send you back to: a batch page (with its tab), a vessel page, a phone tank card, a /v/<name> page, Intakes
export const NEXT_RX = /^(\/(batch|vessel|m\/v)\/\d+(\?tab=[a-z]+)?|\/v\/[^?#/]+|\/intakes)$/;
export function with_next(html, path, next) {
  if (!next || !NEXT_RX.test(next)) return html;
  const re = new RegExp(`(<form[^>]*action="${path.replace(/\//g, '\\/')}"[^>]*>\\s*<input type="hidden" name="_t" value="[^"]*">)`);
  return html.replace(re, `$1<input type="hidden" name="_next" value="${E(next)}">`).replace('<a href="/record">Cancel</a>', `<a href="${E(next)}">Cancel</a>`);
}

// after a successful save: back to the batch page / phone card instead of the Record hub
export function after_save(url, f) {
  const nx = f && f._next ? String(f._next[0] || '') : '';
  if (!NEXT_RX.test(nx)) return url;
  const j = nx.includes('?') ? '&' : '?';
  const m = /^\/record\?done=(\d+)$/.exec(url || '');
  if (m) return `${nx}${j}saved=1&op=${m[1]}`;
  if (/^\/batch\/\d+\?tab=notes$/.test(url || '') || url === '/record?done=reversed') return `${nx}${j}saved=1`;   // a note, a reversal
  return url;
}

// a guess at the tax class for a new bottled product of this batch
// the tax class for a new bottled product of this batch, and why: a Carbonate treatment decides it (Flag Hill → d,
// measured CO2 vs the 0.392 / 0.64 g/100 mL limits); otherwise the class the wine was declared in; else still wine / hard cider
export function class_reason(c, bid) {
  const b = c.one('SELECT beverage_type FROM batch WHERE id=?', bid);
  const isCider = /cider/i.test((b && b.beverage_type) || '');
  const k = carb.latest_for_batch(c, bid);
  const r = carb.classify(k, isCider);
  if (r) return { cls: r.cls, why: `Carbonate treatment ${String(k.when).slice(0, 10)}: ${r.why}`, carb: k };
  return { cls: guess_class(c, bid), why: k ? `Carbonate treatment ${String(k.when).slice(0, 10)} has no CO₂ level — set the class by hand` : 'no carbonation recorded — still wine' + (isCider ? ' / hard cider' : ''), carb: k };
}
export function guess_class(c, bid) {
  const s = c.one("SELECT tax_class FROM bulk_snapshot WHERE batch_id=? AND tax_state='BONDED' AND tax_class IS NOT NULL ORDER BY snap_date DESC LIMIT 1", bid);
  if (s) return s.tax_class;
  const b = c.one('SELECT beverage_type FROM batch WHERE id=?', bid);
  return /cider/i.test((b && b.beverage_type) || '') ? 'f' : 'a';
}

// v1.24.1 on every page: a Record form opened from a batch / vessel page (any link or menu) goes back there after Save and on
// Cancel — from ?_next=, or else from the page you came from.
export const NAVBACK = `<script>(function(){var ok=${NEXT_RX.toString()};
function from(){var q=new URLSearchParams(location.search).get('_next');if(q&&ok.test(q))return q;
try{var r=new URL(document.referrer);if(r.origin!==location.origin)return null;var t=(r.search.match(/[?&]tab=([a-z]+)/)||[])[1],p=r.pathname+(t&&t!=='general'?'?tab='+t:'');return ok.test(p)?p:null}catch(e){return null}}
var nx=from();document.querySelectorAll('form[method=post]').forEach(function(f){var a=f.getAttribute('action')||'';if(a.indexOf('/record/')!==0)return;
var h=f.querySelector('input[name=_next]');if(!h&&nx){h=document.createElement('input');h.type='hidden';h.name='_next';h.value=nx;f.appendChild(h)}
var v=h&&h.value;if(v&&ok.test(v))f.querySelectorAll('a[href="/record"]').forEach(function(c){c.href=v})})})()</script>`;
