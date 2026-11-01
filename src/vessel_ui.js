// v1.23 — vessels by name: scanned sticker text → vessel (exact, then ignoring case and spaces), barrel/vessel details,
// "Unknown vessel — add it?", and the QR label sheet (plain vessel name, high error correction, logo in the middle).
import { tip as HELP } from './help.js';
import { E, nowIso } from './lib/py.js';
import { ctx } from './core.js';

export function ensure_schema(c) {
  c.run(`CREATE TABLE IF NOT EXISTS vessel_info(vessel_id INTEGER PRIMARY KEY, year INTEGER, oak TEXT, location TEXT, uses_before INTEGER,
         notes TEXT, at TEXT, by TEXT)`);
  // v1.23.1 which physical barrels make up a barrel group (Vintrace's API does not say; set on the group's page)
  c.run('CREATE TABLE IF NOT EXISTS barrel_group_member(vessel_id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, at TEXT, by TEXT)');
  // v1.24.2 fixed-capacity tanks (headspace matters); variable-lid tanks leave it empty. Barrels are always fixed.
  try { c.run('ALTER TABLE vessel_info ADD COLUMN fixed INTEGER'); } catch (e) { /* already there */ }
}
export function is_fixed(c, v) {
  if (v.kind === 'barrel' || v.kind === 'barrel_group') return true;
  return c.val('SELECT fixed FROM vessel_info WHERE vessel_id=?', v.id) === 1;
}

// barrel groups whose barrels hold wine now (for "whole group" entries): [{gid, code, ids, vol, cap, batch}]
export function wine_groups(c, cont) {
  const by = new Map();
  for (const x of cont) {
    if (x.kind !== 'barrel' || !(x.volume_l > 0)) continue;
    const g = group_of(c, x.vessel_id);
    if (!g) continue;
    if (!by.has(g.id)) by.set(g.id, { gid: g.id, code: g.code, ids: [], vol: 0, cap: 0, batch: new Set() });
    const e = by.get(g.id); e.ids.push(x.vessel_id); e.vol += x.volume_l; e.cap += x.capacity_l || 0; if (x.batch) e.batch.add(x.batch);
  }
  return [...by.values()].map(e => ({ ...e, batch: [...e.batch].join(', ') }));
}
export const group_opts = (gs, sel) => gs.length ? `<optgroup label="Barrel groups — split across the barrels">${gs.map(g => `<option value="g${g.gid}" ${String(sel) === 'g' + g.gid ? 'selected' : ''}>${E(g.code)} · ${E(g.batch)} · ${g.ids.length} barrels · ${Math.round(g.vol)} L</option>`).join('')}</optgroup>` : '';

export function group_of(c, vid) {   // the group a barrel belongs to, with all its members
  const g = c.one('SELECT v.id, v.code FROM barrel_group_member m JOIN vessel v ON v.id=m.group_id WHERE m.vessel_id=?', vid);
  return g ? { ...g, members: members(c, g.id) } : null;
}
export function members(c, gid) {
  return c.all('SELECT v.id, v.code, v.capacity_l FROM barrel_group_member m JOIN vessel v ON v.id=m.vessel_id WHERE m.group_id=?', gid)
    .sort((a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true }));
}
export function group_block(c, gid, token, next) {
  const ms = members(c, gid), cap = ms.reduce((t, m) => t + (m.capacity_l || 0), 0);
  return `<h2>Barrels in this group${HELP('groups')}</h2><div class="card vi"><div><span>${ms.length} barrel${ms.length === 1 ? '' : 's'}</span><b>${ms.map(m => `<a href="/m/v/${m.id}">${E(m.code)}</a>`).join(' · ') || '<i class="muted">not set</i>'}</b></div>
${cap ? `<div><span>Total capacity</span><b>${num(cap, 0)} L</b></div>` : ''}
<details class="vi-ed" ${ms.length ? '' : 'open'}><summary>✎ ${ms.length ? 'Change' : 'Set'} the barrels</summary><form method="post" action="/v/${gid}/members"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="_next" value="${E(next)}">
<label>Barrel names, separated by commas<input name="names" value="${E(ms.map(m => m.code).join(', '))}" placeholder="e.g. B34, B35, B53, B54" autocapitalize="characters"></label><button>Save barrels</button></form></details></div>`;
}
// the old way (Vintrace): the wine sits on the group's own virtual record. One Transfer moves it into the barrels, by capacity.
export function towine_form(c, gid, token, next = '') {
  const vol = c.val('SELECT volume_l FROM bulk_snapshot WHERE vessel_id=? AND snap_date=(SELECT MAX(snap_date) FROM bulk_snapshot)', gid) || 0;
  const ms = members(c, gid);
  if (!(vol > 0) || !ms.length) return '';
  const cap = ms.reduce((t, m) => t + (m.capacity_l || 0), 0);
  let left = vol;
  const sh = ms.map((m, i) => { const v = i === ms.length - 1 ? left : Math.round(vol * (m.capacity_l || 0) / cap * 10) / 10; left = Math.round((left - v) * 10) / 10; return [m, v]; });
  return `<div class="card vi" style="border-color:#9e6a03"><div style="display:block;border:0"><b style="color:#f0b84a">${num(vol, 1)} L is on the group record itself</b> (how Vintrace kept barrel groups). Move it into the barrels so each barrel has its own volume:</div>
<form method="post" action="/v/${gid}/towine" class="vi-ed"><input type="hidden" name="_t" value="${E(token)}">${next ? `<input type="hidden" name="_next" value="${E(next)}">` : ''}${sh.map(([m, v]) => `<label>${E(m.code)} <small>(${num(m.capacity_l || 0, 0)} L barrel)</small><input name="b_${m.id}" value="${v}" inputmode="decimal"></label>`).join('')}
<button>Move ${num(vol, 1)} L into the ${ms.length} barrels</button></form></div>`;
}
export function post_towine(c, gid, f, e2) {
  const g = c.one("SELECT id, code FROM vessel WHERE id=? AND kind='barrel_group'", gid);
  if (!g) return [null, 'That is not a barrel group.'];
  const ms = members(c, gid);
  if (!ms.length) return [null, 'Set the barrels of this group first.'];
  const dests = ms.map(m => [String(m.id), String((f['b_' + m.id] || ['0'])[0] || '0')]).filter(([, l]) => Number(l) > 0);
  const op = e2.record_split(c, null, gid, dests, 0, 'Lees', `${g.code} → ${ms.map(m => m.code).join(', ')}: the wine moves from the group record into the barrels`, 'Barrel group → barrels');
  const nx = String((f._next || [''])[0] || '');
  return [`${/^\/vessel\/\d+$/.test(nx) ? nx : '/v/' + encodeURIComponent(g.code)}?saved=1&op=${op}`, null];
}

export function post_members(c, gid, f) {
  const g = c.one("SELECT id, code FROM vessel WHERE id=? AND kind='barrel_group'", gid);
  if (!g) return [null, 'That is not a barrel group.'];
  const names = String((f.names || [''])[0] || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
  const ids = [], bad = [];
  for (const n of names) {
    const h = find_vessels(c, n).filter(v => !v.is_virtual && v.kind === 'barrel');
    if (h.length === 1) ids.push(h[0].id); else bad.push(n);
  }
  if (bad.length) return [null, `No single barrel matches: ${bad.join(', ')}.`];
  const elsewhere = ids.map(i => c.one('SELECT v.code b, g.code gc FROM barrel_group_member m JOIN vessel v ON v.id=m.vessel_id JOIN vessel g ON g.id=m.group_id WHERE m.vessel_id=? AND m.group_id<>?', i, gid)).filter(Boolean);
  c.run('DELETE FROM barrel_group_member WHERE group_id=?', gid);
  for (const i of ids) c.run('INSERT INTO barrel_group_member(vessel_id, group_id, at, by) VALUES (?,?,?,?) ON CONFLICT(vessel_id) DO UPDATE SET group_id=excluded.group_id, at=excluded.at, by=excluded.by', i, gid, nowIso(), ctx.user || 'HARDCASTLE, Ken');
  const nx = String((f._next || [''])[0] || '');
  return [`${/^\/(m\/v\/\d+|vessel\/\d+|v\/[^?#]+)$/.test(nx) ? nx : '/m/v/' + gid}?saved=1${elsewhere.length ? '&moved=' + encodeURIComponent(elsewhere.map(x => `${x.b} (was in ${x.gc})`).join(', ')) : ''}`, null];
}

const nws = s => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const loose = s => String(s ?? '').replace(/[\s\-_./]/g, '').toUpperCase();
const num = (x, d = 0) => (x === null || x === undefined || Number.isNaN(Number(x)) ? '' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const GAL = 3.785411784;
export const KINDS = [['barrel', 'Barrel'], ['tank', 'Tank'], ['keg', 'Keg'], ['tote', 'Tote'], ['press', 'Press container'], ['other', 'Other']];

// the text on a sticker (or a future …/v/<name> URL) → matching vessels (real ones before Vintrace-era virtual records)
export function sticker_text(raw) {
  let t = String(raw ?? '').trim();
  const m = t.match(/\/v\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (m) { try { t = decodeURIComponent(m[1]); } catch (e) { t = m[1]; } }
  return t.trim();
}
export function find_vessels(c, raw) {
  const t = sticker_text(raw);
  if (!t) return [];
  const vs = c.all('SELECT id, code, kind, capacity_l, is_virtual, vt_id FROM vessel ORDER BY is_virtual, id');
  const pick = a => { const r = a.filter(v => !v.is_virtual); return r.length ? r : a; };
  let h = pick(vs.filter(v => v.code === t));
  if (h.length) return h;
  h = pick(vs.filter(v => nws(v.code) === nws(t)));
  if (h.length) return h;
  return pick(vs.filter(v => loose(v.code) === loose(t)));   // last resort: dashes, dots and underscores ignored too
}
export const vhref = code => `/v/${encodeURIComponent(code)}`;

// fills (empty → filled) and what it held, from the tracker's records (Vintrace history starts Dec 2019)
function history(c, vid) {
  const fills = c.val(`SELECT COUNT(*) FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE ov.vessel_id=? AND o.reversed=0
                       AND COALESCE(ov.vol_before_l,0) < 0.5 AND COALESCE(ov.vol_after_l,0) >= 0.5`, vid) || 0;
  const held = c.all(`SELECT b.code, b.description, MAX(o.occurred_at) t FROM op_vessel ov JOIN operation o ON o.id=ov.op_id
                      JOIN batch b ON b.id=COALESCE(ov.batch_after_id, ov.batch_id)
                      WHERE ov.vessel_id=? AND o.reversed=0 AND COALESCE(ov.vol_after_l, ov.vol_before_l, 0) >= 0.5 GROUP BY b.id ORDER BY t DESC LIMIT 3`, vid);
  const first = c.val('SELECT MIN(o.occurred_at) FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE ov.vessel_id=? AND o.reversed=0', vid);
  return { fills, held, first };
}

// details block on the vessel page: year, oak, location (editable), fills and last contained (from the records)
export function details(c, v, token, next, current_batch = null) {
  const i = c.one('SELECT * FROM vessel_info WHERE vessel_id=?', v.id) || {};
  const h = history(c, v.id);
  const barrel = v.kind === 'barrel';
  const last = h.held.find(x => x.code !== current_batch);
  const uses = (h.fills || 0) + (Number(i.uses_before) || 0);
  const R = (k, val) => (val === '' || val === null || val === undefined ? '' : `<div><span>${k}</span><b>${val}</b></div>`);
  const rows = [
    barrel ? R('Year', i.year ? E(String(i.year)) : '<i class="muted">not set</i>') : '',
    barrel ? R('Oak', i.oak ? E(i.oak) : '<i class="muted">not set</i>') : '',
    R('Location', i.location ? E(i.location) : '<i class="muted">not set</i>'),
    barrel ? '' : R('Capacity', i.fixed === 1 ? 'fixed — headspace matters' : 'variable lid'),
    R(barrel ? 'Fills' : 'Times filled', `${uses}${i.uses_before ? ` <small>(${h.fills} recorded + ${i.uses_before} earlier)</small>` : h.first ? ` <small>since ${E(String(h.first).slice(0, 7))}</small>` : ''}`),
    R('Last contained', last ? `${E(last.code)} <small>${E(last.description || '')} · ${E(String(last.t).slice(0, 10))}</small>` : '<i class="muted">—</i>'),
    i.notes ? R('Notes', E(i.notes)) : '',
  ].join('');
  const f = (n, lab, val, extra = '') => `<label>${lab}<input name="${n}" value="${E(val ?? '')}" ${extra}></label>`;
  const form = `<details class="vi-ed"><summary>✎ Edit details</summary><form method="post" action="/v/${v.id}/info"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="_next" value="${E(next)}">
${barrel ? f('year', 'Year', i.year, 'inputmode="numeric" placeholder="e.g. 2019"') + f('oak', 'Oak type', i.oak, 'placeholder="e.g. French, medium toast" list="oaks"') : ''}${f('location', 'Location', i.location, 'placeholder="e.g. cellar row 2"')}
${f('uses_before', barrel ? 'Fills before the records (optional)' : 'Earlier fills (optional)', i.uses_before, 'inputmode="numeric"')}${f('notes', 'Notes', i.notes)}
${barrel ? '' : `<input type="hidden" name="fixed_shown" value="1"><label style="flex-direction:row;align-items:center;gap:8px;color:var(--fg2);font-size:15px"><input type="checkbox" name="fixed" value="1" ${i.fixed === 1 ? 'checked' : ''} style="width:auto"> Fixed capacity (headspace matters — not a variable-lid tank)</label>`}
<datalist id="oaks"><option value="French oak"><option value="American oak"><option value="Hungarian oak"><option value="Neutral oak"></datalist><button>Save details</button></form></details>`;
  return `<h2>${barrel ? 'Barrel' : 'Details'}</h2><div class="card vi">${rows}${form}</div>`;
}
export const DETAILS_CSS = `.vi>div{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--line);font-size:15px}.vi>div span{color:var(--mut)}.vi>div b{color:var(--fg2);font-weight:600;text-align:right}
.vi small{color:var(--mut);font-weight:400}.vi-ed summary{color:var(--acc);padding:8px 0 2px;cursor:pointer;font-size:14px}.vi-ed form{display:flex;flex-direction:column;gap:8px;margin-top:6px}
.vi-ed label{display:flex;flex-direction:column;gap:3px;font-size:13px;color:var(--mut)}.vi-ed input{font-size:16px;padding:8px;border:1px solid var(--line2);border-radius:6px;background:var(--bg);color:var(--fg2)}
.vi-ed button{font-size:15px;padding:9px;border-radius:7px;background:var(--acc);color:#fff;border:0}
.qk{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}.qk a{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px;border:1px solid var(--line2);border-radius:10px;background:var(--card);color:var(--fg2);text-decoration:none;font-size:13px;text-align:center}.qk a span{font-size:20px}
.vadd label{display:flex;flex-direction:column;gap:3px;font-size:13px;color:var(--mut);margin:8px 0}.vadd input,.vadd select{font-size:16px;padding:9px;border:1px solid var(--line2);border-radius:6px;background:var(--card);color:var(--fg2)}
.vadd .row{display:flex;gap:8px}.vadd .row input{flex:1;min-width:0}.vadd button{font-size:16px;padding:11px;border-radius:8px;background:var(--acc);color:#fff;border:0;width:100%;margin-top:8px}`;

export function post_info(c, vid, f) {
  if (!c.one('SELECT 1 x FROM vessel WHERE id=?', vid)) return [null, 'No such vessel.'];
  const g = k => String((f[k] || [''])[0] || '').trim();
  const yr = g('year'), ub = g('uses_before');
  if (yr && !/^(19|20)\d\d$/.test(yr)) return [null, 'Year should look like 2019.'];
  if (ub && !/^\d{1,3}$/.test(ub)) return [null, 'Earlier fills should be a whole number.'];
  const fx = g('fixed_shown') ? (g('fixed') ? 1 : null) : (c.val('SELECT fixed FROM vessel_info WHERE vessel_id=?', vid) ?? null);
  c.run(`INSERT INTO vessel_info(vessel_id, year, oak, location, uses_before, notes, fixed, at, by) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(vessel_id) DO UPDATE SET year=excluded.year, oak=excluded.oak, location=excluded.location, uses_before=excluded.uses_before, notes=excluded.notes, fixed=excluded.fixed, at=excluded.at, by=excluded.by`,
  vid, yr ? Number(yr) : null, g('oak') || null, g('location') || null, ub ? Number(ub) : null, g('notes') || null, fx, nowIso(), ctx.user || 'HARDCASTLE, Ken');
  const nx = g('_next');
  return [/^\/(m\/v\/\d+|vessel\/\d+|v\/[^?#]+)$/.test(nx) ? `${nx}?saved=1` : `/m/v/${vid}?saved=1`, null];
}

// several vessels answer to the same text (e.g. "Cute Brute" and "CuteBrute")
export function chooser_body(text, list) {
  return `<div class="err">“${E(text)}” matches ${list.length} vessels. Which one?</div>` +
    list.map(v => `<a class="r" href="/m/v/${v.id}"><div class="m"><b>${E(v.code)}</b> <span class="muted">· ${E(v.kind || '')}${v.capacity_l ? ' · ' + num(v.capacity_l, 0) + ' L' : ''}${v.vt_id ? ' · Vintrace #' + v.vt_id : ''}</span></div></a>`).join('');
}

// sticker text that matches nothing
export function unknown_body(text, token, readonly) {
  const t = sticker_text(text);
  return `<div class="err">Unknown vessel <b>${E(t || '(empty label)')}</b> — add it?</div>
${readonly ? '<p class="muted">The real records are read-only right now.</p>' : `<form class="vadd" method="post" action="/vessels/add"><input type="hidden" name="_t" value="${E(token)}">
<label>Name (as on the sticker)<input name="code" value="${E(t)}" required autocapitalize="characters" autocomplete="off"></label>
<label>Type<select name="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${k === (/^B\d/i.test(t) ? 'barrel' : 'tank') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
<label>Capacity<div class="row"><input name="cap" inputmode="decimal" placeholder="e.g. 225" required><select name="unit"><option value="L">L</option><option value="gal">gal</option></select></div></label>
<button>Add vessel</button></form>`}
<p class="muted" style="font-size:14px;margin-top:14px">Or <a href="/search?q=${encodeURIComponent(t)}">search for “${E(t)}”</a> · <a href="/m">back to the cellar</a></p>`;
}

export function post_add(c, f) {
  const g = k => String((f[k] || [''])[0] || '').trim();
  const code = g('code').replace(/\s+/g, ' ');
  if (!code) return [null, 'Give the vessel a name.'];
  if (code.length > 40) return [null, 'That name is too long for a label (40 characters at most).'];
  const clash = c.all('SELECT code FROM vessel').find(v => nws(v.code) === nws(code));
  if (clash) return [null, `${clash.code} already exists.`];
  const kind = KINDS.some(k => k[0] === g('kind')) ? g('kind') : 'tank';
  let cap = Number(g('cap').replace(',', '.'));
  if (!(cap > 0)) return [null, 'Enter the capacity.'];
  if (g('unit') === 'gal') cap *= GAL;
  if (cap > 50000) return [null, 'That capacity looks wrong.'];
  c.run('INSERT INTO vessel(code, kind, capacity_l, is_virtual, active, notes) VALUES (?,?,?,0,1,?)', code, kind, Math.round(cap * 10) / 10, `added in the tracker ${nowIso().slice(0, 10)}`);
  return [`${vhref(code)}?added=1`, null];
}

// ---------------------------------------------------------------- labels
const LOGO_KEY = 'label_logo';
export function logo(c) {
  const d = c.val('SELECT value FROM app_meta WHERE key=?', LOGO_KEY);
  const m = d && /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(d);
  return m ? { type: m[1], b64: m[2] } : null;
}
export function post_logo(c, f) {
  const d = String((f.logo || [''])[0] || '');
  if ((f.remove || [''])[0]) { c.run('DELETE FROM app_meta WHERE key=?', LOGO_KEY); return ['/labels?logo=removed', null]; }
  if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(d)) return [null, 'Pick a PNG, JPEG or SVG image.'];
  if (d.length > 700000) return [null, 'That image is too large — use one under 500 KB.'];
  c.run("INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", LOGO_KEY, d);
  return ['/labels?logo=saved', null];
}

export function page_labels(c, token, q) {
  const vs = c.all('SELECT id, code, kind, capacity_l FROM vessel WHERE is_virtual=0 AND active=1');
  const order = KINDS.map(k => k[0]);
  const nat = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  vs.sort((a, b) => (order.indexOf(a.kind) - order.indexOf(b.kind)) || nat(a.code, b.code));
  const sel = new Set(String((q.ids || [''])[0] || '').split(',').filter(Boolean).map(Number));
  const groups = KINDS.map(([k, l]) => {
    const g = vs.filter(v => (order.includes(v.kind) ? v.kind : 'other') === k);
    return g.length ? `<fieldset class="lg"><legend>${l}s · ${g.length} <button type="button" class="lnk" onclick="this.closest('fieldset').querySelectorAll('label:not([hidden]) input').forEach(i=>i.checked=true);cnt()">select all</button></legend>
${g.map(v => `<label data-s="${E(v.code.toLowerCase())}"><input type="checkbox" name="v" value="${v.id}" ${sel.has(v.id) ? 'checked' : ''}> ${E(v.code)}</label>`).join('')}</fieldset>` : '';
  }).join('');
  const lg = logo(c);
  const msg = q.logo ? `<div class="ok">${q.logo[0] === 'removed' ? 'Logo removed.' : 'Logo saved — it is now in the middle of every label.'}</div>` : '';
  return `<h1>Vessel labels${HELP('scan')}</h1>${msg}<p class="sub">Each label is about 3.4″ square: a QR code holding just the vessel name (the same plain text as the Vintrace stickers), high error correction, the Hermit Woods logo in the middle, and the name printed underneath. 6 per letter page. Each vessel page also has a Print label button.</p>
<div class="lgo">${lg ? `<img src="/labels/logo?${Date.now() % 100000}" alt="Label logo">` : '<span class="muted">No logo yet — labels print without one.</span>'}
<form method="post" action="/labels/logo" id="lgf"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="logo" id="lgd">
<label class="lnk">${lg ? 'Replace' : 'Upload'} the snail logo (PNG, JPEG or SVG)<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" id="lgi" hidden></label>
${lg ? '<button name="remove" value="1" class="lnk">Remove</button>' : ''}</form></div>
<form action="/labels/print" id="lf" target="_blank" onsubmit="var v=[...document.querySelectorAll('input[name=v]:checked')].map(i=>i.value);if(!v.length){alert('Tick at least one vessel.');return false}document.getElementById('ids').value=v.join(',')">
<input type="hidden" name="ids" id="ids"><div class="lbar"><input id="lq" placeholder="Find a vessel" oninput="flt(this.value)"><button>Print labels</button><span id="lc" class="muted"></span>
<button type="button" class="lnk" onclick="document.querySelectorAll('input[name=v]').forEach(i=>i.checked=false);cnt()">clear</button></div>${groups}</form>
<script>function cnt(){var n=document.querySelectorAll('input[name=v]:checked').length;document.getElementById('lc').textContent=n?n+' selected · '+Math.ceil(n/6)+' page'+(n>6?'s':''):''}
function flt(t){t=t.toLowerCase().replace(/\\s+/g,'');document.querySelectorAll('.lg label').forEach(function(l){l.hidden=t&&l.dataset.s.replace(/\\s+/g,'').indexOf(t)<0})}
document.addEventListener('change',function(e){if(e.target.name==='v')cnt()});cnt();
document.getElementById('lgi').addEventListener('change',function(){var f=this.files[0];if(!f)return;var r=new FileReader();r.onload=function(){
 if(f.type==='image/svg+xml'){document.getElementById('lgd').value=r.result;document.getElementById('lgf').submit();return}
 var im=new Image();im.onload=function(){var k=Math.min(1,600/Math.max(im.width,im.height)),cv=document.createElement('canvas');cv.width=Math.round(im.width*k);cv.height=Math.round(im.height*k);
 cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);document.getElementById('lgd').value=cv.toDataURL('image/png');document.getElementById('lgf').submit()};im.src=r.result};r.readAsDataURL(f)});</script>
<style>.lgo{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:10px 0 16px;padding:10px;border:1px solid var(--line);border-radius:8px}.lgo img{height:70px;background:#fff;border-radius:6px;padding:4px}
.lgo form{display:flex;gap:12px;align-items:center}.lnk{background:none;border:0;color:var(--acc);cursor:pointer;font-size:13px;padding:0;width:auto;margin:0}
.lbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0 10px}.lbar input{font-size:15px;padding:7px;border:1px solid var(--line2);border-radius:6px;background:var(--card);color:var(--fg2)}
.lbar button:not(.lnk){font-size:15px;padding:8px 16px;width:auto;margin:0}.lg{border:1px solid var(--line);border-radius:8px;margin:0 0 12px;padding:8px 12px;display:flex;flex-wrap:wrap;gap:4px 16px}
.lg legend{font-size:13px;color:var(--mut);padding:0 6px}.lg label{display:flex;gap:6px;align-items:center;min-width:8.5em;font-size:14px;color:var(--fg2)}.lg label[hidden]{display:none}</style>`;
}

// stand-alone printable sheet (no app frame). The QR is drawn in the browser by qrcode-generator (error correction H).
export function page_print(c, q, ver) {
  const ids = String((q.ids || [''])[0] || '').split(',').map(Number).filter(n => n > 0).slice(0, 300);
  const vs = ids.length ? c.all(`SELECT id, code FROM vessel WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const byId = new Map(vs.map(v => [v.id, v]));
  const list = ids.map(i => byId.get(i)).filter(Boolean);
  const lg = !!logo(c);
  const fs = s => Math.min(0.46, 2.8 / Math.max(1, s.length * 0.68)).toFixed(3);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Labels · ${E(list.map(v => v.code).slice(0, 4).join(', '))}${list.length > 4 ? ' …' : ''}</title>
<style>@page{size:letter;margin:0.25in}*{box-sizing:border-box}body{margin:0;background:#fff;color:#000;font-family:Helvetica,Arial,sans-serif}
.bar{position:sticky;top:0;padding:10px 14px;background:#f1f1f1;border-bottom:1px solid #ccc;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;font-size:14px}.bar button{font-size:15px;padding:7px 16px}
.sheet{display:grid;grid-template-columns:repeat(2,3.4in);grid-auto-rows:3.4in;gap:0.1in 0.4in;justify-content:center;padding:0.1in 0}
.lab{width:3.4in;height:3.4in;border:1px dashed #c8c8c8;display:flex;flex-direction:column;align-items:center;justify-content:center;break-inside:avoid;page-break-inside:avoid;overflow:hidden}
.qr{position:relative;width:2.55in;height:2.55in}.qr svg{display:block;width:100%;height:100%}
.qr .lo{position:absolute;left:50%;top:50%;width:23%;height:23%;transform:translate(-50%,-50%);background:#fff;border-radius:10%;padding:3%;display:flex;align-items:center;justify-content:center}.qr .lo img{max-width:100%;max-height:100%}
.nm{font-weight:700;line-height:1.05;margin-top:0.06in;white-space:nowrap;letter-spacing:0.01em}
@media print{.bar{display:none}.sheet{padding:0}.lab:nth-child(6n){break-after:page;page-break-after:always}}
@media screen and (max-width:760px){.sheet{transform-origin:top center;zoom:0.55}}</style></head><body>
<div class="bar"><b>${list.length} label${list.length === 1 ? '' : 's'}</b> · ${Math.ceil(list.length / 6) || 0} page${list.length > 6 ? 's' : ''} (letter, 6 per page, cut on the dashed lines)${lg ? '' : ' · <span style="color:#a40">no logo uploaded yet</span>'}
<button onclick="window.print()">Print</button><a href="/labels?ids=${ids.join(',')}">change selection</a></div>
<div class="sheet">${list.map(v => `<div class="lab"><div class="qr" data-t="${E(v.code)}">${lg ? `<div class="lo"><img src="/labels/logo" alt=""></div>` : ''}</div><div class="nm" style="font-size:${fs(v.code)}in">${E(v.code)}</div></div>`).join('') || '<p style="padding:20px">No vessels picked. <a href="/labels">Pick vessels</a></p>'}</div>
<script src="/m/qrgen.js?v=${E(ver)}"></script><script>document.querySelectorAll('.qr').forEach(function(el){var q=qrcode(0,'H');q.addData(el.dataset.t);q.make();
var n=q.getModuleCount(),m=2,s=n+2*m,p='';for(var r=0;r<n;r++)for(var k=0;k<n;k++)if(q.isDark(r,k))p+='M'+(k+m)+' '+(r+m)+'h1v1h-1z';
el.insertAdjacentHTML('afterbegin','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+s+' '+s+'" shape-rendering="crispEdges"><rect width="'+s+'" height="'+s+'" fill="#fff"/><path d="'+p+'" fill="#000"/></svg>')});</script>
</body></html>`;
}
