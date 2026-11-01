// Port of ui_formula.py — Formulations, Additions and Constants pages (HWWineTracker).
import { tip as HELP } from './help.js';
import { LIMITS as SO2_LIMITS } from './so2const.js';
import { E, fx, fxc, median, nowIso, thisYear, qv, urlencode } from './lib/py.js';
import { ui_formula as S } from './gen/strings.js';
import * as F from './formulation.js';
import { ValueError, TypeError_, pyFloat, pyInt, pyStrip, isPyFloat, markFloat } from './formulation.js';
import * as entry from './entry.js';
import * as hw_ui from './hw_ui.js';
import { batch_target, parse_mix } from './target.js';

// ------------------------------------------------------------------ Python-compatibility helpers
// Python truthiness (NaN is truthy; empty list/dict falsy)
function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

// dict.get(k) -> value or null
function get(o, k) {
  return o !== null && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null;
}

function intStr(v) {
  return Math.abs(v) < 1e21 ? String(v) : BigInt(v).toString();
}

// repr(float) / str(float)
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const neg = x < 0;
  const [m, e] = Math.abs(x).toExponential().split('e');
  const digits = m.replace('.', '');
  const exp = Number(e);
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

// str(v) — float-aware when the value sits in a container whose Python types are known (PYFLOATS)
function pstr(v, parent, key) {
  if (typeof v === 'number') {
    const f = parent !== undefined ? isPyFloat(parent, key) : !Number.isInteger(v);
    return f ? pyFloatRepr(v) : intStr(v);
  }
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null || v === undefined) return 'None';
  return String(v);
}

// json.dumps string (ensure_ascii=True)
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

// json.dumps(v) with Python's default formatting (', ' and ': ' separators, ensure_ascii, float repr, NaN/Infinity)
export function pyJson(v, parent, key) {
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    const f = parent !== undefined ? isPyFloat(parent, key) : !Number.isInteger(v);
    if (!f) return intStr(v);
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    return pyFloatRepr(v);
  }
  if (typeof v === 'string') return jsonStr(v);
  if (Array.isArray(v)) return '[' + v.map((x, i) => pyJson(x, v, i)).join(', ') + ']';
  if (v instanceof Map) return '{' + [...v].map(([k, x]) => jsonStr(String(k)) + ': ' + pyJson(x)).join(', ') + '}';
  return '{' + Object.keys(v).map(k => jsonStr(k) + ': ' + pyJson(v[k], v, k)).join(', ') + '}';
}

// json.loads(text): like JSON.parse, plus NaN/Infinity, and it records which numbers were floats (1.0 vs 1) in PYFLOATS
export function pyLoads(text) {
  let i = 0;
  const t = String(text);
  const err = m => { throw new ValueError(`${m}: line 1 column ${i + 1} (char ${i})`); };
  const ws = () => { while (i < t.length && ' \t\n\r'.includes(t[i])) i++; };
  const NUM = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;
  const STR = /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  function value(parent, key) {
    ws();
    const ch = t[i];
    if (ch === '{') {
      i++;
      const o = {};
      ws();
      if (t[i] === '}') { i++; return o; }
      for (;;) {
        ws();
        STR.lastIndex = i;
        const m = STR.exec(t);
        if (!m) err('Expecting property name enclosed in double quotes');
        i = STR.lastIndex;
        const k = JSON.parse(m[0]);
        ws();
        if (t[i] !== ':') err("Expecting ':' delimiter");
        i++;
        const v = value(o, k);
        if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
        else o[k] = v;
        ws();
        if (t[i] === ',') { i++; continue; }
        if (t[i] === '}') { i++; return o; }
        err("Expecting ',' delimiter");
      }
    }
    if (ch === '[') {
      i++;
      const a = [];
      ws();
      if (t[i] === ']') { i++; return a; }
      for (;;) {
        a.push(value(a, a.length));
        ws();
        if (t[i] === ',') { i++; continue; }
        if (t[i] === ']') { i++; return a; }
        err("Expecting ',' delimiter");
      }
    }
    if (ch === '"') {
      STR.lastIndex = i;
      const m = STR.exec(t);
      if (!m) err('Invalid string');
      i = STR.lastIndex;
      return JSON.parse(m[0]);
    }
    if (t.startsWith('null', i)) { i += 4; return null; }
    if (t.startsWith('true', i)) { i += 4; return true; }
    if (t.startsWith('false', i)) { i += 5; return false; }
    if (t.startsWith('NaN', i)) { i += 3; if (parent !== undefined) markFloat(parent, key); return NaN; }
    if (t.startsWith('Infinity', i)) { i += 8; if (parent !== undefined) markFloat(parent, key); return Infinity; }
    if (t.startsWith('-Infinity', i)) { i += 9; if (parent !== undefined) markFloat(parent, key); return -Infinity; }
    NUM.lastIndex = i;
    const m = NUM.exec(t);
    if (m && m[0]) {
      i = NUM.lastIndex;
      if (m[1] || m[2]) { if (parent !== undefined) markFloat(parent, key); return Number(m[0]); }
      return Number(m[0]);
    }
    err('Expecting value');
  }
  const v = value();
  ws();
  if (i !== t.length) err('Extra data');
  return v;
}

// Python str slicing by code points
function cpSlice(s, a, b) {
  return Array.from(s).slice(a, b).join('');
}

// Python min()/max() of a list (first extreme wins)
function pmin(vs) {
  let m = vs[0];
  for (const v of vs.slice(1)) if (v < m) m = v;
  return m;
}
function pmax(vs) {
  let m = vs[0];
  for (const v of vs.slice(1)) if (v > m) m = v;
  return m;
}

// ------------------------------------------------------------------ formatting
export function n(v, d = 1) {
  if (v === null || v === undefined || v === '') return '';
  let x;
  try {
    x = pyFloat(v);
  } catch (e) {
    if (e instanceof ValueError || e instanceof TypeError_) return E(v);
    throw e;
  }
  return fxc(x, d);
}

export function val(v) {
  // value for an <input>: plain number without thousands separators
  if (v === null || v === undefined || v === '') return '';
  v = pyFloat(v);
  return fx(v, 6).replace(/0+$/, '').replace(/\.+$/, '');
}

export const CSS = S.CSS;

export function _batches(c) {
  const sd = c.val('SELECT MAX(snap_date) FROM bulk_snapshot');
  return c.all(`SELECT b.id, b.code, b.description, b.production_year yr, (SELECT SUM(volume_l) FROM bulk_snapshot s WHERE s.batch_id=b.id AND s.snap_date=?) L
                        FROM batch b ORDER BY (L IS NULL), b.production_year DESC, b.code`, sd);
}

// ------------------------------------------------------------------ helpers
export function _tokens(s) {
  const low = (s || '').toLowerCase();
  const out = new Set((low.match(/[a-z]+/g) || []).filter(t => t.length >= 2));
  for (const t of low.replace(/\p{Nd}/gu, ' ').match(/[a-z]{2,}/g) || []) out.add(t);
  return out;
}

const STOP = new Set(['half', 'third', 'model', 'for', 'and', 'the', 'wine', 'of', 'control', 'barrel', 'new', 'old']);

export function _batch_options(c, f) {
  // All batches, with the likeliest matches for this formula (same year, shared name parts) first.
  const rows = _batches(c);
  const ft = new Set([..._tokens(`${pstr(f.name)} ${pstr(f.wine)} ${f.tab || ''}`)].filter(t => !STOP.has(t)));
  function score(b) {
    const s = f.year && b.yr && pyInt(b.yr) === pyInt(f.year) ? 3 : 0;
    let k = 0;
    for (const t of _tokens(`${pstr(b.code)} ${pstr(b.description)}`)) if (ft.has(t)) k++;
    return s + 2 * k;
  }
  const sugg = rows.map(b => [score(b), b]).sort((x, y) => -x[0] - -y[0]).filter(([s]) => s >= 5).map(([, b]) => b).slice(0, 8);
  const opt = (b, sel) => `<option value="${pstr(b.id)}" ${sel && b.id === f.batch_id ? 'selected' : ''}>${E(b.code)} · ${E(b.description || '')}${b.L ? '' : ' (not in cellar)'}</option>`;
  let o = '<option value="">— not linked —</option>';
  if (sugg.length) {
    o += '<optgroup label="Likely matches">' + sugg.map(b => opt(b, false)).join('') + '</optgroup><optgroup label="All batches">';
  }
  o += rows.map(b => opt(b, true)).join('') + (sugg.length ? '</optgroup>' : '');
  return o;
}

export function _families(c) {
  return c.col("SELECT DISTINCT family FROM formula WHERE deleted=0 AND family IS NOT NULL AND family<>'' ORDER BY family");
}

export function sheet_og_abv(r, x = null) {
  // OG and ABV to show for a formula: the model's for Brix formulas, the sheet's (or its log) for older recipes.
  if ((r.model || 'brix') === 'brix' && x !== null && x !== undefined) return [x.og, x.abv];
  const s = pyLoads(r.sheet || '{}');
  const og0 = get(s, 'og');
  const og = truthy(og0) ? og0 : get(s, 'logFirstSG');
  return [og, get(s, 'abv')];
}

export function _cat_options(cur) {
  const cats = F.CATEGORIES.concat(cur === 'Grape (historic)' ? ['Grape (historic)'] : []);
  const o = cats.includes(cur) ? '' : '<option value="" selected disabled>— choose —</option>';
  return o + cats.map(k => `<option ${cur === k ? 'selected' : ''}>${k}</option>`).join('');
}

// ------------------------------------------------------------------ masters (v1.14)
// One current, undated recipe per prototype wine (is_master=1, retired_at NULL). Each season's batch starts from a copy of it
// (▶ Start a batch → 26Name, with the vintage). A formulation that turned out well is promoted (★ Make this the master):
// that writes a new master version from it and keeps the old one as an earlier version (retired_at set). Masters never link to a batch.
const MCOLS = ['wine', 'type', 'category', 'sweetener', 'model', 'sweet_lb_per_gal'].concat(F.FIELDS, ['yeast', 'fermenter', 'fruit_notes', 'lessons', 'prep', 'family', 'liquid', 'blend_into', 'fruit_mix']);

export function current_master(c, fam) {
  if (!fam) return null;
  return c.one('SELECT * FROM formula WHERE deleted=0 AND is_master=1 AND retired_at IS NULL AND family=? ORDER BY master_version DESC, id DESC LIMIT 1', fam);
}

export function master_versions(c, fam) {
  return c.all(`SELECT f.id, f.name, f.master_version, f.retired_at, f.created_at, s.name sname, s.year syear, b.code sbcode
                FROM formula f LEFT JOIN formula s ON s.id=f.derived_from LEFT JOIN batch b ON b.id=s.batch_id
                WHERE f.deleted=0 AND f.is_master=1 AND f.family=? ORDER BY f.master_version DESC, f.id DESC`, fam);
}

// "PB / PBR — Petite Blue" → "Petite Blue" (a capital-letter code before the dash gives way to the name after it);
// "Kittens — heirloom cider blend" → "Kittens"; "3Honey (mead)" → "3Honey"; "Rhubarb" → "Rhubarb"
export function master_name(fam) {
  const f = String(fam || '');
  let x = f;
  if (f.includes(' — ')) {
    const [a, ...b] = f.split(' — ');
    x = a === a.toUpperCase() && b.length ? b.join(' — ') : a;
  }
  return pyStrip(x.split(' (')[0]) || f;
}

function _from_txt(sname, syear, sbcode) {
  if (!sname) return '';
  return `${sname}${syear ? ` (${syear})` : ''}${sbcode && sbcode !== sname ? `, batch ${sbcode}` : ''}`;
}

export function promote(c, r, now) {
  if (!r.family) throw new ValueError('set the Prototype wine on this formulation first (and save), so the app knows which wine it becomes the master for');
  const old = current_master(c, r.family);
  if (old && old.id === r.id) return r.id;
  const ver = (c.val('SELECT MAX(master_version) AS v FROM formula WHERE deleted=0 AND is_master=1 AND family=?', r.family) || 0) + 1;
  const name = old ? old.name : master_name(r.family);
  const bcode = r.batch_id ? c.val('SELECT code FROM batch WHERE id=?', r.batch_id) : null;
  const from = r.is_master ? `earlier master v${r.master_version || '?'}` : _from_txt(r.name, r.year, bcode);
  if (old) c.run('UPDATE formula SET retired_at=?, updated_at=? WHERE id=?', now, now, old.id);
  const cur = c.run(`INSERT INTO formula(name, year, ${MCOLS.join(', ')}, role, family_status, origin, source, is_master, master_version, derived_from, created_at, updated_at)
                     VALUES (?,NULL,${MCOLS.map(() => '?').join(',')},'batch','confirmed','app',?,1,?,?,?,?)`,
    ...[name].concat(MCOLS.map(k => r[k]), [`Master v${ver} for ${r.family}, from ${from} on ${now.slice(0, 10)}`, ver, r.id, now, now]));
  c.commit();
  return cur.id;
}

export function tiers(c) {
  try {
    return new Map(c.all('SELECT family, tier FROM wine_tier').map(t => [t.family, t.tier]));
  } catch (e) {
    return new Map();
  }
}

// one-click Core ⇄ Occasional for a prototype wine; back = the page to return to
export function tier_toggle(fam, tier, token, back) {
  const core = tier === 'core';
  return `<form method="post" action="/prototype/tier" class="tierf"><input type="hidden" name="_t" value="${token}"><input type="hidden" name="family" value="${E(fam)}">` +
    `<input type="hidden" name="tier" value="${core ? 'occasional' : 'core'}"><input type="hidden" name="_back" value="${E(back)}">` +
    `<button class="btn2" title="${core ? 'Move to Occasional (lower on the list)' : 'Move to Core (made most years, top of the list)'}">${core ? '↓ occasional' : '↑ core'}</button></form>`;
}

function _nums(r, C) {
  const x = F.calc({ ...r }, C);
  const [og, abv] = sheet_og_abv(r, x);
  const sw = r.sweetener === 'sugar' || r.sweetener === 'honey' ? r.sweetener : '';
  const slg = (r.model || 'brix') === 'brix' && x.gal ? x.lb / x.gal : (r.sweet_lb_per_gal || 0);
  return `<td class="n">${n(r.target_l, 0)}</td><td class="n">${n(r.fruit_lb_per_gal, 2)}</td><td class="n" data-v="${slg ? fx(slg, 2) : ''}">${slg ? n(slg, 2) : ''}<small>${sw}</small></td>
          <td class="n">${n(r.brix_desired, 1)}</td><td class="n">${truthy(og) ? fx(og, 3) : ''}</td><td class="n">${n(abv, 1)}</td>`;
}

function _list_head(view, total, token) {
  const cats = F.CATEGORIES.map(k => `<option>${k}</option>`).join('');
  const nw = (`<form method="post" action="/formula/new" class="bar" style="margin:0"><input type="hidden" name="_t" value="${token}">` +
    `<select name="category" required><option value="" selected disabled>Category…</option>${cats}</select><input name="name" placeholder="name, e.g. Rhubarb" required><button>+ New formula</button></form>`);
  const tab = (v, t) => `<a href="/formulas${v === 'all' ? '?view=all' : ''}" class="${view === v ? 'on' : ''}">${t}</a>`;
  const sw = `<div class="chips">${tab('masters', '★ Masters')}${tab('all', `All formulations (${total})`)}</div>`;
  return [nw, sw];
}

export function masters_list(c, q, token) {
  const C = F.constants(c);
  const ty = thisYear();
  const total = c.val('SELECT COUNT(*) AS n FROM formula WHERE deleted=0');
  const fams = c.all(`SELECT family, MAX(year) y1, COUNT(*) n FROM formula WHERE deleted=0 AND COALESCE(is_master,0)=0 AND family IS NOT NULL AND family<>''
                      AND COALESCE(role,'batch')='batch' GROUP BY family`);
  const masters = new Map();
  for (const m of c.all(`SELECT f.*, s.name sname, s.year syear, b.code sbcode FROM formula f LEFT JOIN formula s ON s.id=f.derived_from LEFT JOIN batch b ON b.id=s.batch_id
                          WHERE f.deleted=0 AND f.is_master=1 AND f.retired_at IS NULL ORDER BY f.master_version, f.id`)) masters.set(m.family, m);
  for (const fam of masters.keys()) if (!fams.some(x => x.family === fam)) fams.push({ family: fam, y1: null, n: 0 });
  const sk = f => (masters.has(f.family) ? masters.get(f.family).name : master_name(f.family)).toLowerCase();
  fams.sort((a, b) => sk(a).localeCompare(sk(b)));
  const plink = fam => `<a href="/prototype?f=${E(fam)}">${E(fam.split(' — ')[0])}</a>`;
  const T = tiers(c);
  const core = [], recent = [], older = [];
  let nm = 0;
  for (const f of fams) {
    const m = masters.get(f.family);
    let tr;
    if (m) {
      nm++;
      const from = _from_txt(m.sname, m.syear, m.sbcode);
      tr = `<tr><td style="width:30px">${hw_ui.kind_badge(m.category)}</td><td data-v="${E(m.name)}"><a href="/formula/${m.id}"><b>★ ${E(m.name)}</b></a><small>v${pstr(m.master_version || 1)}${from ? ' · from ' + E(from) : ''}</small></td>
        <td>${plink(f.family)}</td>${_nums(m, C)}
        <td><form method="post" action="/formula/${m.id}/copy" style="margin:0"><input type="hidden" name="_t" value="${token}"><button class="btn2" style="padding:2px 8px;white-space:nowrap" title="Make this season's copy (${String(ty).slice(2)}${E(m.name).replace(/[\s/]+/g, '')}) to adjust and turn into a batch; the master stays as it is">▶ Start ${ty} batch</button></form></td>
        <td>${tier_toggle(f.family, T.get(f.family), token, '/formulas')}</td></tr>`;
    } else {
      const cands = c.all(`SELECT f.*, b.code bcode FROM formula f LEFT JOIN batch b ON b.id=f.batch_id WHERE f.deleted=0 AND COALESCE(f.is_master,0)=0 AND f.family=?
                           AND COALESCE(f.role,'batch')='batch' AND f.year=? ORDER BY f.name COLLATE NOCASE`, f.family, f.y1);
      const cat = cands.length ? cands[cands.length - 1].category : null;
      const cs = cands.slice(0, 8).map(r => `<span class="cand"><a href="/formula/${r.id}">${E(r.name)}</a>${r.bcode ? `<small>batch ${E(r.bcode)}</small>` : ''}` +
        `<form method="post" action="/formula/${r.id}/master" onsubmit="return confirm('Make ${E(r.name).replace(/'/g, '&#39;')} (${pstr(r.year)}) the master for ${E(master_name(f.family)).replace(/'/g, '&#39;')}?')"><input type="hidden" name="_t" value="${token}"><button class="btn2" title="Make this the master">★</button></form></span>`).join('');
      const rep = cands.reduce((a, r) => (!a || r.id > a.id ? r : a), null);   // the latest formulation stands in for the numbers until a master is set
      const nums = rep ? _nums(rep, C).replace(/<td class="n"/g, `<td class="n muted" title="${E(rep.name)} (${pstr(rep.year)}) — latest formulation; no master yet"`) : '<td></td>'.repeat(6);
      tr = `<tr><td style="width:30px">${hw_ui.kind_badge(cat)}</td><td data-v="${E(master_name(f.family))}"><span class="muted">no master yet</span><small>${E(master_name(f.family))}</small>` +
        `<div class="cands"><span class="muted" style="font-size:12px">${pstr(f.y1)}:</span> ${cs}${cands.length > 8 ? ` <a href="/formulas?view=all&fam=${encodeURIComponent(f.family)}">+${cands.length - 8} more</a>` : ''}</div></td><td>${plink(f.family)}</td>
        ${nums}<td></td>
        <td>${tier_toggle(f.family, T.get(f.family), token, '/formulas')}</td></tr>`;
    }
    (T.get(f.family) === 'core' ? core : (m || (f.y1 || 0) >= ty - 3 ? recent : older)).push(tr);
  }
  const thead = '<thead><tr><th></th><th>Master</th><th>Prototype</th><th class="n">Target L</th><th class="n">Fruit lb/gal</th><th class="n">Sweetener lb/gal</th><th class="n">Brix desired</th><th class="n">OG</th><th class="n">ABV %</th><th></th><th>Tier</th></tr></thead>';
  const table = `<h2>Core wines <span class="muted" style="font-size:13px;font-weight:normal">made most years (${core.length})</span></h2>` +
    `<table class="mtab">${thead}<tbody>${core.join('') || '<tr><td colspan=11 class=muted>No core wines yet — press ↑ core on a wine below.</td></tr>'}</tbody></table>` +
    `<h2>Occasional ferments and one-offs <span class="muted" style="font-size:13px;font-weight:normal">(${recent.length})</span></h2>` +
    `<table class="mtab">${thead}<tbody>${recent.join('') || '<tr><td colspan=11 class=muted>None.</td></tr>'}</tbody></table>`;
  const old = older.length ? `<details style="margin-top:14px"><summary class="muted">Older occasional wines, not made since ${ty - 4} (${older.length})</summary><table class="mtab">${thead}<tbody>${older.join('')}</tbody></table></details>` : '';
  const [nw, sw] = _list_head('masters', total, token);
  const css = `<style>.cand{display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;white-space:nowrap}
.cand form{display:inline;margin:0}.tierf{margin:0}.cands{font-size:12.5px;margin-top:2px}.tierf button{padding:0 6px;font-size:12px;white-space:nowrap}.cand button{padding:0 6px;line-height:1.5}.mtab td small{display:block}</style>`;
  return (`<h1>Formulations</h1><p class="sub">★ Masters: the current recipe for each wine, with no vintage (${nm} set). Click a column heading to sort; grey numbers are the latest formulation of a wine with no master yet. Start each season's batch from the master; when a batch turns out well, ` +
    `open its formulation and press <b>★ Make this the master</b>. For a wine with no master yet, press ★ beside the formulation that should be it. <a href="/prototypes">Prototype wines →</a></p>` +
    `${sw}<div class="bar" style="margin-bottom:10px">${nw}</div>` +
    `<form class="f" action="/formulas"><input type="hidden" name="view" value="all"><label>Find<input name="q" placeholder="wine, fruit, notes — searches all formulations"></label><button class="btn2">Find</button></form>` +
    table + old + css);
}

// ------------------------------------------------------------------ list
export function formulas_list(c, q, token) {
  {
    const v = qv(q, 'view', '');
    const filt = qv(q, 'q', '') || qv(q, 'cat', '') || qv(q, 'year', '') || qv(q, 'fam', '');
    if (v === 'masters' || (v !== 'all' && !filt)) return masters_list(c, q, token);
  }
  const C = F.constants(c);
  const text = pyStrip(qv(q, 'q', '') || '').toLowerCase();
  const cat = qv(q, 'cat', ''), yr = qv(q, 'year', ''), fam = qv(q, 'fam', '');
  let rows = c.all('SELECT f.*, b.code bcode FROM formula f LEFT JOIN batch b ON b.id=f.batch_id WHERE f.deleted=0 ORDER BY COALESCE(f.is_master,0) DESC, f.retired_at IS NOT NULL, f.year DESC, f.name COLLATE NOCASE');
  const years = [...new Set(rows.filter(r => r.year).map(r => r.year))].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const total = rows.length;
  if (text) rows = rows.filter(r => `${pstr(r.name)} ${pstr(r.wine)} ${pstr(r.year)} ${pstr(r.family)} ${pstr(r.fruit_notes)} ${pstr(r.lessons)}`.toLowerCase().includes(text));
  if (cat) rows = rows.filter(r => (r.category || '') === cat);
  if (yr) rows = rows.filter(r => pstr(r.year) === yr);
  if (fam) rows = rows.filter(r => (r.family || '') === fam);
  const keep = { view: 'all', q: text, cat, year: yr, fam };
  const chips = hw_ui.chips([['', 'All']].concat(F.CATEGORIES.concat(['Grape (historic)']).map(k => [k, k])), cat, 'cat', '/formulas', keep);
  const yo = '<option value="">all years</option>' + years.map(y => `<option ${pstr(y) === yr ? 'selected' : ''}>${pstr(y)}</option>`).join('');
  const fo = '<option value="">all prototypes</option>' + _families(c).map(x => `<option ${x === fam ? 'selected' : ''}>${E(x)}</option>`).join('');
  const filt = (`<div style="display:flex;flex-wrap:wrap;align-items:flex-start">${chips}</div><form class="f"><input type="hidden" name="cat" value="${E(cat)}">` +
    `<input type="hidden" name="view" value="all"><label>Find<input name="q" value="${E(text)}" placeholder="wine, fruit, notes"></label><label>Year<select name="year" onchange="this.form.submit()">${yo}</select></label>` +
    `<label>Prototype<select name="fam" onchange="this.form.submit()">${fo}</select></label><button class="btn2">Filter</button></form>`);
  const tr = [];
  let yr0 = null;
  for (const r of rows.slice(0, 1500)) {
    const x = F.calc({ ...r }, C);
    const [og, abv] = sheet_og_abv(r, x);
    const chk = ({ Y: '<span class="ok2" title="reproduces the sheet">✔</span>', N: '<span class="no2" title="differs from the sheet — see the formula">✗</span>' })[r.verified || ''] || '<span class="muted" title="older layout or cider model — not checkable">·</span>';
    const grp = r.is_master ? (r.retired_at ? 'Earlier master versions' : '★ Masters (no vintage)') : (r.year || 'No vintage');
    if (grp !== yr0) {
      yr0 = grp;
      tr.push(`<tr><td colspan="12" class="yr" style="background:var(--bg)">${E(yr0)}</td></tr>`);
    }
    const sw = r.sweetener === 'sugar' || r.sweetener === 'honey' ? r.sweetener : '';
    const slg = (r.model || 'brix') === 'brix' && x.gal ? x.lb / x.gal : (r.sweet_lb_per_gal || 0);
    tr.push(`<tr><td style="width:30px">${hw_ui.kind_badge(r.category)}</td><td><a href="/formula/${pstr(r.id)}"><b>${r.is_master && !r.retired_at ? '★ ' : ''}${E(r.name)}</b></a><small>${r.is_master ? `master v${pstr(r.master_version || 1)}${r.wine ? ' · ' : ''}` : ''}${E(r.wine || '')}</small></td>
          <td>${r.family ? `<a href="/prototype?f=${E(r.family)}">${E((r.family || '').split(' — ')[0])}</a>` : ''}${r.role === 'component' ? '<small>component</small>' : ''}</td>
          <td class="n">${n(r.target_l, 0)}</td><td class="n">${n(r.fruit_lb_per_gal, 2)}</td><td class="n" data-v="${slg ? fx(slg, 2) : ''}">${slg ? n(slg, 2) : ''}<small>${sw}</small></td>
          <td class="n">${n(r.brix_desired, 1)}</td><td class="n">${truthy(og) ? fx(og, 3) : ''}</td><td class="n">${n(abv, 1)}</td><td>${chk}</td>
          <td>${r.batch_id ? `<a href="/batch/${pstr(r.batch_id)}">${E(r.bcode)}</a>` : ''}</td></tr>`);
  }
  const table = ('<table><thead><tr><th></th><th>Formula</th><th>Prototype</th><th class="n">Target L</th><th class="n">Fruit lb/gal</th><th class="n">Sweetener lb/gal</th>' +
    '<th class="n">Brix desired</th><th class="n">OG</th><th class="n">ABV %</th><th>Sheet</th><th>Batch</th></tr></thead><tbody>' +
    (tr.join('') || '<tr><td colspan=12 class=muted>No formulas.</td></tr>') + '</tbody></table>');
  const [nw, sw] = _list_head('all', total, token);
  return (`<h1>Formulations</h1><p class="sub">${rows.length} of ${total} formulas · masters, HWRecipes10–26 and your own, by vintage. ✔ = reproduces the sheet; · = older layout or cider model.` +
    ` <a href="/prototypes">Prototype wines →</a></p>${sw}<div class="bar" style="margin-bottom:10px">${nw}</div>${filt}${table}`);
}

// ------------------------------------------------------------------ detail
export function _row(label, inner, unit = '') {
  return `<div class="frow"><span class="l">${label}</span>${inner}<span class="u">${unit}</span></div>`;
}

export function _ed(key, v, step = 'any') {
  return `<input class="ed" name="${key}" data-k="${key}" inputmode="decimal" value="${E(val(v))}">`;
}

export function _out(id_, big = false) {
  return `<span class="v" id="${id_}"></span>`;
}

export function _actual_block(c, r, C) {
  if (!r.batch_id) return '';
  const b = c.one('SELECT code, description, beverage_type FROM batch WHERE id=?', r.batch_id);
  if (!b) return '';
  const a = F.actuals(c, r.batch_id);
  const x = F.calc({ ...r }, C);
  const gal_a = a.peak_l ? a.peak_l / F.GAL : null;
  const sw = r.sweetener === 'honey' ? 'Honey' : 'Sugar';
  const sw_a = r.sweetener === 'honey' ? a.honey_lb : a.sugar_lb;
  const og_a = a.sg_start;
  const rows = [['Volume (largest total in vessels)', n(r.target_l, 0) + ' L', a.peak_l ? n(a.peak_l, 0) + ' L' : '—'],
    ['Fruit', n(x.fruit) + ' lb', a.fruit_lb ? n(a.fruit_lb) + ' lb' : '— (no fruit intake on this batch)'],
    ['Fruit per gallon', n(r.fruit_lb_per_gal, 2) + ' lb/gal', a.fruit_lb && gal_a ? n(a.fruit_lb / gal_a, 2) + ' lb/gal' : '—'],
    [sw, n(x.lb) + ' lb', sw_a ? n(sw_a) + ' lb' : '—'],
    ['Water added', n(x.water) + ' gal', a.water_gal ? n(a.water_gal) + ' gal' : '—'],
    ['Starting gravity', fx(x.og, 3), og_a ? `${fx(og_a[0], 3)} (${E(og_a[2])}, ${E(og_a[1])})` : '—'],
    ['Final gravity', n(r.fg, 3), a.sg_end ? `${fx(a.sg_end[0], 3)} (${E(a.sg_end[1])})` : '—'],
    ['Alcohol', n(x.abv, 2) + ' %', a.alcohol ? `${fx(a.alcohol[0], 2)} % (${E(a.alcohol[1])})` : '—']];
  const t = rows.map(([k, p, qq]) => `<tr><td>${E(k)}</td><td class="n">${p}</td><td class="n">${qq}</td></tr>`).join('');
  return (`<h2>Planned vs actual — <a href="/batch/${pstr(r.batch_id)}">${E(b.code)}</a> <span class="muted" style="font-weight:400">${E(b.description || '')} · ${E(b.beverage_type || '')}</span></h2>` +
    '<p class="sub">Actual from the cellar records: fruit intakes, sugar/honey/water additions, the first Brix or SG reading, the last SG and alcohol readings.</p>' +
    `<table style="max-width:760px"><thead><tr><th>Quantity</th><th class="n">Formula</th><th class="n">Actual</th></tr></thead><tbody>${t}</tbody></table>`);
}

// v1.20: the fruit mix — which fruits make up the fruit, as % of the total (e.g. MBW: kiwi 50, peach 30, rhubarb 20).
// Pounds follow the Fruit total live; the batch page checks each fruit off as it goes in.
export function _mix_block(r) {
  const mix = parse_mix(r.fruit_mix);
  const rows = (mix.length ? mix : []).concat([{ fruit: '', pct: '' }, { fruit: '', pct: '' }]).slice(0, Math.max(mix.length + 1, 2));
  const tr = rows.map(m => `<div class="mixr"><input name="mix_fruit" value="${E(m.fruit)}" placeholder="fruit, e.g. Kiwi" list="mixfruits"><input name="mix_pct" class="ed" value="${E(m.pct === '' ? '' : val(m.pct))}" inputmode="decimal" placeholder="%"><span class="mixlb muted"></span></div>`).join('');
  return `<div id="mix" class="mixbox"><div class="mixh">Fruit mix <span class="muted">% of the fruit — leave empty for a single fruit</span></div>${tr}
   <div class="mixf"><a href="#" id="mixadd">＋ another fruit</a><span id="mixsum" class="muted"></span></div>
   <datalist id="mixfruits">${['Kiwi', 'Peach', 'Rhubarb', 'Plum', 'Nectarine', 'Apricot', 'Quince', 'Rosehip', 'Strawberry', 'Blueberry', 'Black Raspberry', 'Raspberry', 'Blackberry', 'Elderberry', 'Cranberry', 'Apple', 'Crabapple', 'Pear', 'Cantaloupe', 'Tomato', 'Grapes', 'Currant'].map(x => `<option value="${x}">`).join('')}</datalist></div>
<style>.mixbox{margin-top:8px;padding-top:6px;border-top:1px dashed var(--line2)}.mixh{font-size:12.5px;font-weight:600;margin-bottom:4px}.mixh span{font-weight:400;font-size:11.5px}
.mixr{display:grid;grid-template-columns:1fr 58px 76px;gap:5px;margin:3px 0;align-items:center}.mixr input{width:100%;background:var(--bg);color:var(--fg2);border:1px solid var(--line2);border-radius:5px;padding:3px 6px;font-size:13px}
.mixr .mixlb{font-size:12px;text-align:right}.mixf{display:flex;justify-content:space-between;font-size:12px;margin-top:3px}</style>
<script>(function(){var box=document.getElementById('mix');function upd(){var F=parseFloat((document.getElementById('o_fruit')||{}).value)||0,s=0,rs=box.querySelectorAll('.mixr');
rs.forEach(function(r){var p=parseFloat(r.children[1].value)||0;s+=p});rs.forEach(function(r){var p=parseFloat(r.children[1].value)||0;r.children[2].textContent=p>0&&F>0?(F*p/(s||100)).toFixed(1)+' lb':''});
var e=document.getElementById('mixsum');e.textContent=s?('total '+(+s.toFixed(2))+'%'+(Math.abs(s-100)>0.05?' — will be scaled to 100%':'')):'';e.style.color=s&&Math.abs(s-100)>0.05?'#d29922':''}
box.addEventListener('input',upd);document.addEventListener('input',function(ev){if(ev.target&&(ev.target.id==='o_fruit'||ev.target.closest&&ev.target.closest('.fgrid')))setTimeout(upd,0)});
document.getElementById('mixadd').addEventListener('click',function(ev){ev.preventDefault();var r=box.querySelector('.mixr').cloneNode(true);r.querySelectorAll('input').forEach(function(i){i.value=''});r.children[2].textContent='';box.insertBefore(r,box.querySelector('.mixf'))});
window.addEventListener('load',function(){setTimeout(upd,50)});setTimeout(upd,50)})()</script>`;
}

export function formula_page(c, fid, token, msg = '') {
  const r = c.one('SELECT * FROM formula WHERE id=? AND deleted=0', fid);
  if (!r) return [null, null];
  const C = F.constants(c);
  const sheet = pyLoads(r.sheet || '{}');
  const flags = pyLoads(r.flags || '[]');
  const sfx = pyLoads(r.sheet_formulas || '{}');
  const model = r.model || 'brix';
  const swo = F.SWEETENERS.map(([k, t]) => `<option value="${k}" ${(r.sweetener || 'none') === k ? 'selected' : ''}>${t}</option>`).join('');
  const fams = _families(c);
  const fdl = fams.map(x => `<option value="${E(x)}">`).join('');
  const role = [['batch', 'the wine itself'], ['component', 'a component (blended in)']].map(([k, t]) => `<option value="${k}" ${(r.role || 'batch') === k ? 'selected' : ''}>${t}</option>`).join('');
  const proposed = r.family_status === 'proposed' ? ' <span class="tag u" title="from the automatic grouping; waiting for your review">proposed</span>' : '';
  const stemsOf = t => String(t || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4).map(w => (w.endsWith('ies') ? w.slice(0, -3) : (w.endsWith('s') ? w.slice(0, -1) : w)));
  const mine = stemsOf(`${r.name} ${r.wine || ''} ${r.family || ''}`);
  const hit = t => stemsOf(t).some(w => mine.some(m => m.includes(w) || w.includes(m)));
  let onh = '';
  try {
    const lots = c.all("SELECT id, item, amount_kg FROM ingredient_lot WHERE status='on_hand' AND kind='fruit' ORDER BY item");
    const m = lots.filter(l => hit(l.item));
    if (lots.length) onh = `<div class="frow"><span class="l">On hand</span><span style="text-align:right">${m.length ? m.map(l => `<a href="#" class="useoh" data-lb="${Math.round(l.amount_kg / 0.45359237 * 10) / 10}" title="use this amount">${E(l.item)} ${n(l.amount_kg / 0.45359237, 1)} lb</a>`).join(' · ') : '<a href="/intakes" class="muted">none of this fruit — see Intakes</a>'}</span><span class="u"></span></div>`;
  } catch (e) { /* no lots table */ }
  const srcs = c.all('SELECT id, name, wine, year, family, is_master, retired_at FROM formula WHERE deleted=0 AND id<>? AND fruit_lb_per_gal>0 ORDER BY is_master DESC, year DESC, name', fid)
    .filter(x => (r.family && x.family === r.family) || hit(`${x.name} ${x.wine || ''} ${x.family || ''}`)).slice(0, 40);
  const fillsel = srcs.length ? `<label>Fill from <select class="ed" name="src" form="ffill"><option value="">— a past formulation —</option>${srcs.map(x => `<option value="${x.id}">${E(x.name)} (${x.is_master ? (x.retired_at ? 'earlier master' : '★ master') : pstr(x.year)})${x.wine ? ' · ' + E(x.wine) : ''}</option>`).join('')}</select>
    <button class="btn2" form="ffill" onclick="return this.form.src.value!==''||(alert('Pick a formulation to fill from.'),false)" style="padding:2px 8px">Fill</button></label>` : '';
  const steps = `<div class="fgrid">
 <div class="step"><div class="hd"><i>1</i>Target</div>
  ${_row('Target volume', _ed('target_l', r.target_l), 'litres')}${_row('Wine volume', _out('o_gal'), 'gallons')}
  ${_row('Makes about', _out('o_bottles'), 'bottles')}${_row('or about', _out('o_cases'), 'cases')}</div>
 <div class="step"><div class="hd"><i>2</i>Fruit</div>
  ${_row('Brix measured from fruit', _ed('brix_fruit', r.brix_fruit), '°Brix')}${_row('Fruit per gallon', _ed('fruit_lb_per_gal', r.fruit_lb_per_gal), 'lb/gal')}
  ${_row('Juice yield', _ed('juice_gal_per_lb', r.juice_gal_per_lb), 'gal/lb')}
  <div class="frow big"><span class="l">Fruit</span><input class="edb" id="o_fruit" inputmode="decimal" title="Type here to change it — the rest follows"><span class="u">lb</span></div>${onh}${_row('Boxes', _out('o_boxes'), `${n(C.boxLb, 0)}-lb`)}
  ${_row('Fruit juice', _out('o_juice'), 'gallons')}${_row('Brix from fruit', _out('o_bf'), '<span id="o_sgf"></span>')}
  ${_mix_block(r)}</div>
 <div class="step"><div class="hd"><i>3</i><span id="t_sw">Sugar</span></div>
  ${_row('<span id="t_bd">Brix desired</span>', _ed('brix_desired', r.brix_desired), '°Brix')}${_row('<span id="t_fac">Sugar factor</span>', _ed('factor', r.factor), 'per 16')}
  ${_row('<span id="t_bs">Brix from sugar</span>', _out('o_bs'), '<span id="o_sgs"></span>')}
  <div class="frow big"><span class="l" id="t_lb">Sugar</span><input class="edb" id="o_lb" inputmode="decimal" title="Type here to change it — the rest follows"><span class="u">lb</span></div>${_row('adds volume', _out('o_vol'), 'gallons')}</div>
 <div class="step"><div class="hd"><i>4</i><span id="t_w">Water</span></div>
  <div class="frow big"><span class="l" id="t_wl">Water addition</span><input class="edb" id="o_water" inputmode="decimal" title="Type here to change it — the rest follows"><span class="u">gallons</span></div>${_row('', '<input class="edb" id="o_waterl" inputmode="decimal" title="Type here to change it — the rest follows">', 'litres')}
  <div id="cider_rows">${_row('Cider SG', _ed('liquid_sg', r.liquid_sg), '<span id="o_bcl"></span>')}${_row('Brix from the cider', _out('o_bc'), '<span id="o_sgc"></span>')}
   <div id="w_sg" class="infobox" style="display:none">Enter the cider's SG (e.g. 1.050) to get the OG and alcohol. With a sweetener, Brix desired is the total target and the sugar/honey makes up the difference.</div></div>
  ${_row('Fruit juice volume', _out('o_juice2'), 'gallons')}${_row('<span id="t_vol">Sugar volume</span>', _out('o_vol2'), 'gallons')}
  <div id="w_neg" class="warnbox" style="display:none">Fruit juice and sweetener volume are more than the target. Lower the fruit per gallon or the Brix desired, or raise the target volume.</div></div>
 <div class="step"><div class="hd"><i>5</i>Result</div>
  <div class="frow big"><span class="l">OG</span>${_out('o_og')}<span class="u"></span></div>${_row('FG (expected)', _ed('fg', r.fg), '')}
  <div class="frow big"><span class="l">Alcohol</span>${_out('o_abv')}<span class="u">% ABV</span></div>${_row('Alcohol, alternate formula', _out('o_abv2'), '% ABV')}</div>
</div>`;
  const texts = `<div class="ftext">
  <label>Fruit sources / character<textarea name="fruit_notes">${E(r.fruit_notes || '')}</textarea></label>
  <label>Key changes / lessons learned<textarea name="lessons">${E(r.lessons || '')}</textarea></label>
  <label>Preparation — pre-pitch combination and processing<textarea name="prep">${E(r.prep || '')}</textarea></label>
  <label>Yeast<input name="yeast" value="${E(r.yeast || '')}">Fermenter<input name="fermenter" value="${E(r.fermenter || '')}"></label></div>`;
  let older = '';
  if (model === 'rate') {
    older = (`<div class="infobox"><b>Older recipe layout (${E(r.book || r.year)}).</b> The sheet set sugar or honey as a rate ` +
      `(${n(r.sweet_lb_per_gal, 2)} lb per gallon) and didn't use Brix targets, so the steps below can't reproduce it until you fill in ` +
      'Brix from fruit and Brix desired. The recipe as written is in the table further down.</div>');
  }
  let cmp_ = '';
  if (truthy(sheet)) {
    let log = '';
    if (truthy(get(sheet, 'logN'))) {
      log = (`<tr><td>Fermentation log in the sheet</td><td class="n">${pstr(sheet.logN, sheet, 'logN')} SG readings: first ${n(get(sheet, 'logFirstSG'), 3)} ` +
        `(${E(get(sheet, 'logFirstDate') || '')}), last ${n(get(sheet, 'logLastSG'), 3)} (${E(get(sheet, 'logLastDate') || '')})</td><td></td><td></td></tr>`);
    }
    const vols = [['actualPrimaryL', "Actual primary volume (sheet's TTB box)"], ['afterPressL', 'After press (TTB box)'], ['finalL', 'Final volume (TTB box)']]
      .filter(([k]) => truthy(get(sheet, k))).map(([k, lab]) => `<tr><td>${lab}</td><td class="n">${n(get(sheet, k), 0)} L</td><td></td><td></td></tr>`).join('');
    // sv as [value, its Python str()]; `x or 0` gives the int 0
    const orZero = k => (truthy(get(sheet, k)) ? [sheet[k], pstr(sheet[k], sheet, k)] : [0, '0']);
    const plain = k => { const v = get(sheet, k); return [v, v === null ? '' : pstr(v, sheet, k)]; };
    const items = [['Fruit', 'fruit', orZero('lbFruit'), 1, 'lb'], ['Fruit juice', 'juice', orZero('juiceGal'), 1, 'gal'],
      ['Sugar / honey', 'lb', orZero('lbSweetener'), 1, 'lb'], ['Water / cider', 'water', plain('waterOrCiderGal'), 1, 'gal'],
      ['OG', 'og', plain('og'), 3, ''], ['ABV', 'abv', plain('abv'), 2, '%'], ['ABV alternate', 'abv2', plain('abvAlt'), 2, '%']];
    let head, body;
    if (model === 'brix') {
      head = ('<h2>Check against the sheet</h2><p class="sub">Values the sheet showed on 1 Oct 2026, beside what the app calculates now. ✔ = same to the sheet\'s displayed digits.</p>' +
        '<table style="max-width:760px"><thead><tr><th>Quantity</th><th class="n">Sheet</th><th class="n">App</th><th></th></tr></thead><tbody>');
      body = items.map(([lab, k, [sv, svs], d, u]) => `<tr><td>${lab}</td><td class="n">${sv !== null ? n(sv, d) : '—'} ${u}</td><td class="n"><span id="c_${k}"></span> ${u}</td><td id="m_${k}" data-sv="${svs}" data-d="${d}"></td></tr>`).join('');
    } else {
      head = ('<h2>The recipe as written in the sheet</h2><table style="max-width:760px"><thead><tr><th>Quantity</th><th class="n">Sheet</th><th></th><th></th></tr></thead><tbody>');
      body = items.filter(([, , [sv]]) => !(sv === null || sv === 0 || sv === false)).map(([lab, k, [sv], d, u]) => `<tr><td>${lab}</td><td class="n">${n(sv, d)} ${u}</td><td></td><td></td></tr>`).join('');
    }
    cmp_ = head + body + log + vols + '</tbody></table>';
    if (truthy(sfx)) {
      cmp_ += ('<details style="margin-top:8px"><summary class="muted">Sheet formulas for this tab</summary><table style="max-width:900px"><tbody>' +
        Object.keys(sfx).filter(k => truthy(sfx[k])).map(k => `<tr><td>${E(k)}</td><td><code>${E(pstr(sfx[k], sfx, k))}</code></td></tr>`).join('') + '</tbody></table></details>');
    }
  }
  const warn = x => r.verified === 'N' || x.includes('no sugar/honey weighed') || x.includes('not in E4');
  const fl = flags.map(x => (warn(x) ? `<div class="warnbox">${E(x)}</div>` : `<div class="infobox">${E(x)}</div>`)).join('');
  const js = ('<script>' + F.JS_CALC + 'const C=' + pyJson(C) + `;
const fm=document.getElementById('fform');const q=k=>fm.querySelector('[name='+k+']');
const fmt=(v,d)=>(v===null||!isFinite(v))?'—':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const r2=(v,d)=>Math.round((v+Number.EPSILON)*Math.pow(10,d))/Math.pow(10,d);
const set=(id,t)=>{const e=document.getElementById(id);if(!e)return;if(e.tagName==='INPUT'){if(e!==document.activeElement)e.value=(t==='—'?'':String(t).replace(/,/g,''))}else e.textContent=t};
function upd(){const f={};['target_l','brix_fruit','fruit_lb_per_gal','juice_gal_per_lb','brix_desired','factor','fg','liquid_sg'].forEach(k=>f[k]=q(k).value);
 f.sweetener=q('sweetener').value;const cat=q('category').value;const x=fcalc(f,C);const none=f.sweetener==='none',cider=cat==='Cider';
 const sw=f.sweetener==='honey'?'Honey':(none?'No sweetener':'Sugar');
 set('t_sw',sw);set('t_lb',none?'Sugar / honey (none)':sw);set('t_fac',(none?'Sweetener':sw)+' factor');
 const lsg=parseFloat(f.liquid_sg)>0;document.getElementById('cider_rows').style.display=(cider||lsg)?'':'none';document.getElementById('w_sg').style.display=(cider&&!lsg)?'':'none';
 set('t_bd',lsg&&none?'Brix desired (used only with a sweetener)':'Brix desired');
 set('t_bs',none?(lsg?'Brix from sweetener (none)':(cider?'Brix supplied by the cider':'Brix still to add (no sweetener chosen)')):'Brix from '+sw.toLowerCase());
 set('o_bcl',lsg?'= '+x.bcl.toFixed(1)+' °Bx':'');set('o_bc',lsg?fmt(x.bc,2):'—');set('o_sgc',lsg?'SG '+x.sgc.toFixed(4):'');
 set('t_vol',none?'Sweetener volume':sw+' volume');set('t_w',cider?'Cider':'Water');set('t_wl',cider?'Cider addition':'Water addition');
 set('o_gal',fmt(x.gal,1));set('o_bottles',fmt(x.bottles,0));set('o_cases',fmt(x.cases,1));set('o_fruit',fmt(x.fruit,1));set('o_boxes',fmt(x.boxes,1));
 set('o_juice',fmt(x.juice,1));set('o_juice2',fmt(x.juice,1));set('o_bf',fmt(x.bf,2));set('o_sgf','SG '+x.sgf.toFixed(4));set('o_bs',fmt(x.bs,2));set('o_sgs','SG '+x.sgs.toFixed(4));
 set('o_lb',fmt(x.lb,1));set('o_vol',fmt(x.vol,1));set('o_vol2',fmt(x.vol,1));set('o_water',fmt(x.water,1));set('o_waterl',fmt(x.water_l,0));
 set('o_og',x.og.toFixed(3));set('o_abv',fmt(x.abv,2));set('o_abv2',fmt(x.abv2,2));document.getElementById('w_neg').style.display=x.water<0?'':'none';
 ['fruit','juice','lb','water','og','abv','abv2'].forEach(k=>{const m=document.getElementById('m_'+k);if(!m)return;const d=+m.dataset.d;set('c_'+k,fmt(x[k],d));
  if(m.dataset.sv===''){m.textContent='';return}const same=r2(+m.dataset.sv,d)===r2(x[k]||0,d);m.innerHTML=same?'<span class=ok2>✔</span>':'<span class=no2>✗</span>'});}
const DEF={'Fruit wine':'sugar','Mead':'honey','Cider':'none'};q('category').addEventListener('change',e=>{const s=q('sweetener');if(DEF[e.target.value]&&!dirtyS)s.value=DEF[e.target.value];upd()});
let dirtyS=false;q('sweetener').addEventListener('change',()=>{dirtyS=true});
let dirty=false;fm.addEventListener('input',()=>{upd();if(!dirty){dirty=true;document.getElementById('dirty').style.display=''}});fm.addEventListener('change',upd);
fm.addEventListener('submit',()=>{dirty=false});window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
// fruit, sugar and water are editable too: type one and the plan follows (fruit → fruit per gallon; sugar → Brix desired; water → batch size, same fruit)
function fv(){const f={};['target_l','brix_fruit','fruit_lb_per_gal','juice_gal_per_lb','brix_desired','factor','fg','liquid_sg'].forEach(k=>f[k]=q(k).value);f.sweetener=q('sweetener').value;return f}
function solve(fn,x0,goal){let a=x0>0?x0:1,b=a*1.1+0.5,fa=fn(a)-goal,fb=fn(b)-goal;for(let i=0;i<40&&Math.abs(fb)>1e-7;i++){if(fb===fa)break;const c=b-fb*(b-a)/(fb-fa);a=b;fa=fb;b=c;fb=fn(b)-goal}return b}
const putv=(k,v,d)=>{if(isFinite(v)&&v>0)q(k).value=String(Math.round(v*Math.pow(10,d))/Math.pow(10,d))};
function edOut(id,fn){const e=document.getElementById(id);if(e)e.addEventListener('input',()=>{const v=parseFloat(e.value);if(isFinite(v)&&v>=0)fn(v)})}
edOut('o_fruit',v=>{const g=(parseFloat(q('target_l').value)||0)/C.lPerGal;if(g>0)putv('fruit_lb_per_gal',v/g,3)});
edOut('o_lb',v=>{const f=fv();if(f.sweetener==='none'||!(parseFloat(f.factor)>0))return;putv('brix_desired',solve(b=>fcalc(Object.assign({},f,{brix_desired:b}),C).lb,parseFloat(f.brix_desired)||20,v),2)});
function byWater(galGoal){const f=fv(),L0=parseFloat(f.target_l)||100,F=fcalc(f,C).fruit;const fn=L=>fcalc(Object.assign({},f,{target_l:L,fruit_lb_per_gal:F/(L/C.lPerGal)}),C).water;
 const L=solve(fn,L0,galGoal);if(L>0){putv('target_l',L,1);putv('fruit_lb_per_gal',F/(L/C.lPerGal),3)}}
edOut('o_water',v=>byWater(v));edOut('o_waterl',v=>byWater(v/C.lPerGal));
document.querySelectorAll('.useoh').forEach(a=>a.addEventListener('click',ev=>{ev.preventDefault();const e=document.getElementById('o_fruit');e.value=a.dataset.lb;e.focus();e.dispatchEvent(new Event('input',{bubbles:true}))}));
const mk=document.getElementById('mkbatch');if(mk)mk.addEventListener('click',ev=>{if(+q('year').value<${thisYear()}&&!confirm('This is a '+q('year').value+' formulation. Usually you Copy for this season first and make the batch from the copy. Make the batch from this one anyway?')){ev.preventDefault();return}if(!dirty)return;ev.preventDefault();const h=document.createElement('input');h.type='hidden';h.name='_go';h.value='makebatch';fm.appendChild(h);dirty=false;fm.submit()});
upd();
</script>`);
  const ty = thisYear();
  const isM = !!r.is_master, live = isM && !r.retired_at;
  let mbox = '', mlink = '';
  if (isM) {
    const vs = master_versions(c, r.family);
    const me = vs.find(v => v.id === r.id) || {};
    const from = _from_txt(me.sname, me.syear, me.sbcode);
    const fromA = from ? ` from <a href="/formula/${pstr(r.derived_from)}">${E(from)}</a>` : '';
    const others = vs.filter(v => v.id !== r.id).map(v => `<a href="/formula/${v.id}">v${pstr(v.master_version || 1)}</a>${v.retired_at ? '' : ' (current)'}`).join(', ');
    if (live) {
      mbox = `<div class="infobox"><b>★ Master formulation</b> for <a href="/prototype?f=${E(r.family)}">${E(r.family)}</a> · v${pstr(r.master_version || 1)}, made ${E((r.created_at || '').slice(0, 10))}${fromA}. ` +
        `No vintage: each season press <b>▶ Start a ${ty} batch</b> to make this season's copy (${String(ty).slice(2)}${E(r.name)}), adjust the copy, then make the batch from it. ` +
        `Changes you save here change the master itself.${others ? ` Earlier versions: ${others}.` : ''}</div>`;
    } else {
      const cur = current_master(c, r.family);
      mbox = `<div class="warnbox"><b>Earlier master</b> for ${E(r.family)} · v${pstr(r.master_version || 1)}${fromA}, replaced ${E((r.retired_at || '').slice(0, 10))}` +
        `${cur ? ` by <a href="/formula/${cur.id}">v${pstr(cur.master_version || 1)}</a>` : ''}. Kept for the record. <button class="btn2" form="fmaster" style="padding:2px 8px">★ Make this the master again</button></div>`;
    }
  } else if (r.family) {
    const cur = current_master(c, r.family);
    if (cur) mlink = ` <span class="muted" style="font-size:12px">★ master: <a href="/formula/${cur.id}">${E(cur.name)}</a></span>`;
    const mf = r.derived_from ? c.one('SELECT id, name, is_master, master_version FROM formula WHERE id=?', r.derived_from) : null;
    if (mf && mf.is_master && !r.batch_id) {
      mbox = `<div class="infobox">This is the ${pstr(r.year || ty)} copy of master <a href="/formula/${mf.id}">★ ${E(mf.name)}</a> (v${pstr(mf.master_version || 1)}). ` +
        'Adjust the fruit, sugar and water for this season, save, then <b>② Make this a batch</b>. The master stays as it was.</div>';
    }
  }
  const btns = isM
    ? (live ? `<button class="btn" form="fcopy" style="margin-left:8px" title="Make this season's copy of the master (it stays as it is); adjust the copy, then make the batch from it">▶ Start a ${ty} batch</button>` : '')
    : `<button class="${Number(r.year) < ty ? 'btn' : 'btn2'}" form="fcopy" style="margin-left:8px" title="Step 1 — make a new formulation for ${ty} from this recipe (this one stays as it is); adjust the copy, then Make it a batch">① Copy for this season (${ty})</button>
   <a class="btn ${Number(r.year) < ty ? 'btn2' : ''}" id="mkbatch" href="/makebatch?f=${pstr(fid)}" title="Step 2 — turn THIS formulation into this season's batch (saves your changes first)">② Make this a batch</a>`;
  const vint = isM ? '<label>Vintage <span class="muted" style="font-size:12px">none — master</span><input type="hidden" name="year" value=""></label>'
    : `<label>Vintage <input class="ed" name="year" value="${E(r.year || '')}" style="width:5em" inputmode="numeric"></label>`;
  const bsel = isM ? '<input type="hidden" name="batch_id" value="">' : `<label>Batch <select name="batch_id" style="max-width:340px">${_batch_options(c, r)}</select></label>`;
  const head = `<form id="fform" method="post" action="/formula/${pstr(fid)}/save"><input type="hidden" name="_t" value="${token}">
  <div class="tbar">${hw_ui.kind_badge(r.category, true)}<input class="name" name="name" value="${E(r.name)}" aria-label="Formula name">
   <span class="dirty" id="dirty" style="display:none">Unsaved changes</span><button>Save changes</button>
   ${btns}</div>
  <div class="meta">${vint}
   <label>Wine <input class="ed" name="wine" value="${E(r.wine || '')}" style="width:15em;text-align:left"></label>
   <label>Category <select class="ed" name="category" required>${_cat_options(r.category)}</select></label>
   <label>Sweetener <select class="ed" name="sweetener">${swo}</select></label>${fillsel}</div>
  <div class="meta"><label>Prototype wine <input class="ed" name="family" list="fams" value="${E(r.family || '')}" style="width:20em;text-align:left" placeholder="e.g. PB / PBR — Petite Blue"${isM ? ' readonly title="A master belongs to its prototype wine"' : ''}>${proposed}${mlink}</label>
   <datalist id="fams">${fdl}</datalist><label>as <select class="ed" name="role">${role}</select></label>
   <label>Blended into <input class="ed" name="blend_into" value="${E(r.blend_into || '')}" style="width:16em;text-align:left" placeholder="e.g. Hermitage, LHR — Lake House Red" title="End wine(s) this ferment went into; comma-separated"></label>
   ${bsel}</div>
  ${msg}${mbox}${older}${steps}${texts}</form>`;
  const actions = `<form id="ffill" method="post" action="/formula/${pstr(fid)}/fillfrom" onsubmit="return confirm('Replace this formulation\'s numbers with the chosen one? (Batch size stays.)')"><input type="hidden" name="_t" value="${token}"></form><div class="bar" style="margin-top:14px">
  <form id="fcopy" method="post" action="/formula/${pstr(fid)}/copy" style="display:none"><input type="hidden" name="_t" value="${token}"></form>
  <form id="fmaster" method="post" action="/formula/${pstr(fid)}/master" onsubmit="return confirm('Make this formulation the ★ master for ${E(master_name(r.family)).replace(/'/g, '&#39;')}? The current master is kept as an earlier version.')"><input type="hidden" name="_t" value="${token}">${!isM && r.family ? `<button class="btn2" title="This recipe becomes the undated master that each new season starts from">★ Make this the master</button>` : ''}</form>
  <form method="post" action="/formula/${pstr(fid)}/copy"><input type="hidden" name="_t" value="${token}"><input type="hidden" name="same" value="1"><button class="btn2">Duplicate</button></form>
  ${r.family ? `<a class="btn btn2" href="/prototype?f=${E(r.family)}">Prototype: ${E((r.family || '').split(' — ')[0])}</a>` : ''}
  ${r.batch_id ? `<a class="btn btn2" href="/additions?batch=${pstr(r.batch_id)}">Additions for this batch</a>` : `<a class="btn btn2" href="/additions?vol=${val(r.target_l)}${r.category === 'Cider' ? '&cider=1' : ''}">Additions for ${n(r.target_l, 0)} L</a>`}
  <form method="post" action="/formula/${pstr(fid)}/delete" onsubmit="return confirm('Delete this ${live ? 'master' : 'formula'}? It can be restored only from a backup.')"><input type="hidden" name="_t" value="${token}"><button class="btnw">Delete</button></form></div>
  <p class="muted" style="font-size:12px;margin-top:10px">${E(r.source || '')}${r.updated_at ? ' · updated ' + E((r.updated_at || '').slice(0, 16).replaceAll('T', ' ')) : ''}</p>`;
  return [r.name, head + fl + _actual_block(c, r, C) + cmp_ + actions + js];
}

// ------------------------------------------------------------------ prototypes
export const NUMS = S.NUMS;

export function _proto_rows(c, fam, C, fed = false) {
  let rows;
  if (fed) {   // ferments of other prototype wines that were blended into this one
    rows = c.all('SELECT f.*, b.code bcode FROM formula f LEFT JOIN batch b ON b.id=f.batch_id WHERE f.deleted=0 AND COALESCE(f.is_master,0)=0 AND f.family<>? ' +
      'AND instr(f.blend_into, ?) > 0 ORDER BY f.year, f.family, f.name', fam, fam)  // Durable Object SQLite limits LIKE pattern length; exact membership is checked below anyway
      .filter(r => (r.blend_into || '').split(',').map(x => pyStrip(x)).includes(fam));
  } else {
    rows = c.all('SELECT f.*, b.code bcode FROM formula f LEFT JOIN batch b ON b.id=f.batch_id WHERE f.deleted=0 AND COALESCE(f.is_master,0)=0 AND f.family=? ORDER BY f.year, f.name', fam);
  }
  const out = [];
  for (const r of rows) {
    const x = F.calc({ ...r }, C);
    const [og, abv] = sheet_og_abv(r, x);
    const brix = (r.model || 'brix') === 'brix';
    const d = {
      r, target_l: r.target_l, fruit_lb_per_gal: r.fruit_lb_per_gal || null, juice_gal_per_lb: r.juice_gal_per_lb,
      brix_fruit: r.brix_fruit, brix_desired: r.brix_desired, slg: (brix && x.gal ? x.lb / x.gal : r.sweet_lb_per_gal) || null,
      factor: r.factor, water_pct: (brix && x.gal ? 100 * x.water / x.gal : null), og, fg: r.fg, abv,
    };
    if (!brix) {
      const s = pyLoads(r.sheet || '{}');
      if (get(s, 'waterOrCiderGal') !== null && x.gal) d.water_pct = 100 * s.waterOrCiderGal / x.gal;
    }
    if (r.batch_id) d.act = F.actuals(c, r.batch_id);
    out.push(d);
  }
  return out;
}

export function prototypes_page(c, q) {
  const C = F.constants(c);
  const fams = c.all(`SELECT family, COUNT(*) n, SUM(role='component') comp, MIN(year) y0, MAX(year) y1, MAX(family_status='proposed') prop, MAX(category) cat
                        FROM formula WHERE deleted=0 AND COALESCE(is_master,0)=0 AND family IS NOT NULL AND family<>'' GROUP BY family ORDER BY n DESC`);
  const mst = new Map(c.all('SELECT id, family, name FROM formula WHERE deleted=0 AND is_master=1 AND retired_at IS NULL').map(m => [m.family, m]));
  const T = tiers(c);
  const anyprop = fams.some(f => f.prop);
  const mode = new Map();   // badge = the category most of the family's formulas have
  for (const r of c.all('SELECT family, category, COUNT(*) FROM formula WHERE deleted=0 AND COALESCE(is_master,0)=0 AND family IS NOT NULL GROUP BY 1, 2 ORDER BY 3')) mode.set(r.family, r.category);
  const fedn = new Map();
  for (const bi of c.col("SELECT blend_into FROM formula WHERE deleted=0 AND COALESCE(is_master,0)=0 AND blend_into IS NOT NULL AND blend_into<>''")) {
    for (const x of bi.split(',')) {
      const k = pyStrip(x);
      fedn.set(k, (fedn.get(k) || 0) + 1);
    }
  }
  const tr = fams.map(f => `<tr><td style="width:30px">${hw_ui.kind_badge(mode.has(f.family) ? mode.get(f.family) : f.cat)}</td><td><a href="/prototype?f=${E(f.family)}"><b>${E(f.family)}</b></a></td><td class="n">${f.n - (f.comp || 0)}</td>
       <td class="n">${f.comp || ''}</td><td class="n">${fedn.get(f.family) || ''}</td><td>${pstr(f.y0)}–${pstr(f.y1)}</td><td>${f.prop ? '<span class="tag u">proposed</span>' : '<span class="tag b">confirmed</span>'}</td><td>${mst.has(f.family) ? `<a href="/formula/${mst.get(f.family).id}">★ ${E(mst.get(f.family).name)}</a>` : ''}</td><td>${T.get(f.family) === 'core' ? 'Core' : '<span class="muted">occasional</span>'}</td></tr>`).join('');
  const note = anyprop ? ('<div class="infobox">Your answers of 1 Oct 2026 are applied: ferments made for a blend (Black, Elder, Blue, Quince, Peach-Rhubarb …) are batches of their own fruit wine, ' +
    'and the end wine lists them under “Ferments blended into this wine”; Melange and Melange Blanc are separate. Families you settled are <b>confirmed</b>; ' +
    'the rest stay <b>proposed</b> until you move or save one (Prototype wine field on a formula).</div>') : '';
  return (`<h1>Prototype wines</h1><p class="sub">Each key wine across all years: its formulas side by side, the range of fruit, sweetener, water and results, ` +
    `and (when batches are linked) what actually happened.</p>${note}<table style="max-width:900px"><thead><tr><th></th><th>Prototype wine</th><th class="n">Batches</th>` +
    `<th class="n">Blend portions</th><th class="n">Ferments blended in</th><th>Years</th><th>Grouping</th><th>Master</th><th>Tier</th></tr></thead><tbody>${tr || '<tr><td colspan=9 class=muted>No prototype wines yet.</td></tr>'}</tbody></table>`);
}

export function prototype_page(c, q, token) {
  const fam = qv(q, 'f', '');
  const C = F.constants(c);
  const rows = _proto_rows(c, fam, C);
  const fed = _proto_rows(c, fam, C, true);
  if (!rows.length && !fed.length) return [fam, `<h1>${E(fam)}</h1><p class="muted">No formulas in this prototype.</p>`];
  const batches = rows.filter(d => (d.r.role || 'batch') === 'batch');
  const comps = rows.filter(d => d.r.role === 'component');
  function fmt(k, v, d) {
    if (v === null || v === undefined || v === '') return '';
    return k === 'og' || k === 'fg' ? fx(v, 3) : n(v, d);
  }
  function tbl(ds, title, pick = false) {
    if (!ds.length) return '';
    const head = NUMS.map(([k, lab, d]) => `<th class="n">${E(lab)}</th>`).join('');
    let body = '';
    for (const d of ds) {
      const r = d.r, a = d.act;
      let act = '';
      if (truthy(a)) {
        const bits = [];
        if (a.sg_start) bits.push(`start ${fx(a.sg_start[0], 3)}`);
        if (a.sg_end) bits.push(`end ${fx(a.sg_end[0], 3)}`);
        if (a.alcohol) bits.push(`${fx(a.alcohol[0], 1)} %`);
        act = `<a href="/batch/${pstr(r.batch_id)}">${E(r.bcode)}</a><small>${E(bits.join(', '))}</small>`;
      }
      body += (`<tr>${pick ? `<td><input type="checkbox" name="ids" value="${pstr(r.id)}" form="fmove" aria-label="tick ${E(r.name)}"></td>` : ''}<td>${pstr(r.year || '')}</td><td><a href="/formula/${pstr(r.id)}"><b>${E(r.name)}</b></a><small>${E(r.wine || '')}${(r.model || 'brix') === 'rate' ? ' · older layout' : ''}${r.family !== fam ? ' · ' + E(r.family.split(' — ')[0].split(' (')[0]) : ''}${r.blend_into && r.family === fam ? ' → ' + E(r.blend_into) : ''}</small></td>` +
        NUMS.map(([k, lab, dd]) => `<td class="n">${fmt(k, d[k], dd)}</td>`).join('') + `<td>${E(r.yeast || '')}</td><td>${act}</td></tr>`);
    }
    let stats = '';
    for (const [lab, fn] of [['min', pmin], ['median', median], ['max', pmax]]) {
      let cells = '';
      for (const [k, l2, dd] of NUMS) {
        const vs = ds.map(d => d[k]).filter(v => typeof v === 'number' && (!(k === 'fruit_lb_per_gal' || k === 'slg') || v > 0));
        cells += `<td class="n"><b>${vs.length ? fmt(k, fn(vs), dd) : ''}</b></td>`;
      }
      stats += `<tr style="height:36px">${pick ? '<td></td>' : ''}<td></td><td class="muted"><b>${lab}</b> (${ds.length} formulas)</td>${cells}<td></td><td></td></tr>`;
    }
    return (`<h2>${E(title)}</h2><div class="pscroll"><table class="ptab" style="margin:0"><thead><tr>${pick ? '<th title="tick to move">☐</th>' : ''}<th>Year</th><th>Formula</th>${head}<th>Yeast</th><th>Actual (linked batch)</th></tr></thead>` +
      `<tbody>${body}</tbody><tfoot>${stats}</tfoot></table></div>`);
  }
  const prop = rows.some(d => d.r.family_status === 'proposed');
  const ny = pmax(rows.concat(fed).map(d => d.r.year || 0)) + 1;
  const nw = (`<form method="post" action="/prototype/new" class="bar" style="margin:10px 0"><input type="hidden" name="_t" value="${token}"><input type="hidden" name="family" value="${E(fam)}">` +
    `<button>+ New ${ny} formula from the medians</button><span class="muted" style="font-size:12px">Uses the median fruit lb/gal, juice yield, Brix, factor and FG of the batches above (2013 onward), ` +
    'and the latest target volume, category, sweetener and yeast. Or open any year and use “Copy for new vintage”.</span></form>');
  let notes = '';
  for (const d of batches.slice(-6).reverse()) {
    const r = d.r;
    if (r.lessons) notes += `<div class="ncard"><div class="h"><span>${pstr(r.year)} · ${E(r.name)}</span></div><div class="t">${E(cpSlice(r.lessons, 0, 900))}</div></div>`;
  }
  const cm = current_master(c, fam);
  const tier = tiers(c).get(fam) === 'core' ? 'core' : 'occasional';
  const tline = `<p class="sub" style="display:flex;gap:8px;align-items:center">Tier: <b>${tier === 'core' ? 'Core — made most years' : 'Occasional'}</b>${tier_toggle(fam, tier, token, '/prototype?f=' + encodeURIComponent(fam))}</p>`;
  const mline = cm ? `<div class="infobox">★ Master: <a href="/formula/${cm.id}"><b>${E(cm.name)}</b></a> v${pstr(cm.master_version || 1)} — the undated recipe each season starts from. ` +
      `<form method="post" action="/formula/${cm.id}/copy" style="display:inline;margin:0"><input type="hidden" name="_t" value="${token}"><button class="btn2" style="padding:2px 8px">▶ Start a ${thisYear()} batch</button></form></div>`
    : '<div class="infobox">No ★ master yet. Open the formulation below that should be the current recipe and press <b>★ Make this the master</b>.</div>';
  const pfl = _families(c).filter(x => x !== fam).map(x => `<option value="${E(x)}">`).join('');
  const nmo = rows.length;
  const edit = `<details class="pedit" style="margin:8px 0 12px"><summary class="btn2" style="display:inline-block;cursor:pointer">✎ Rename or split this wine</summary>
   <form method="post" action="/prototype/rename" class="bar" style="margin:10px 0 4px;flex-wrap:wrap" onsubmit="return this.new.value.trim()!==''&&(this.new.value.trim()==='${E(fam).replace(/'/g, '&#39;')}'||confirm('Rename to '+this.new.value.trim()+' on all ${nmo} formulations of this wine?'))">
    <input type="hidden" name="_t" value="${token}"><input type="hidden" name="old" value="${E(fam)}">
    <label>Name <input name="new" value="${E(fam)}" list="pfams" style="width:30em" required></label><button>Rename</button>
    <span class="muted" style="font-size:12px;flex-basis:100%">Changes it on every formulation of this wine, its ★ master, its tier and any “blended into” lists. Typing the name of another prototype wine merges the two. Short name = the part before “ — ”.</span></form>
   <form id="fmove" method="post" action="/prototype/move" class="bar" style="margin:10px 0 4px;flex-wrap:wrap" onsubmit="var n=document.querySelectorAll('input[name=ids][form=fmove]:checked').length;if(!n){alert('Tick the formulations to move first (☐ column in the tables below).');return false}return confirm('Move '+n+' formulation(s) to '+this.to.value.trim()+'?')">
    <input type="hidden" name="_t" value="${token}"><input type="hidden" name="old" value="${E(fam)}">
    <label>Move the ticked formulations to <input name="to" list="pfams" style="width:24em" required placeholder="another prototype wine, or a new name"></label><button>Move ticked</button>
    <span class="muted" style="font-size:12px;flex-basis:100%">Tick them in the ☐ column below. A new name makes a new prototype wine (it starts as Occasional).</span></form>
   <datalist id="pfams">${pfl}</datalist></details>`;
  const body = (`<h1>${E(fam)}</h1><p class="sub">${batches.length} batch formulas · ${comps.length} blend portions · ${fed.length} ferments blended in · ${pmin(rows.concat(fed).map(d => d.r.year || 9999))}–${ny - 1}` +
    (prop ? ' · <span class="tag u">proposed grouping</span>' : '') + '</p>' + tline + edit + mline + nw +
    tbl(batches, 'Batches by year', true) + tbl(comps, 'Blend portions (concentrate / cider part of this wine)', true) +
    tbl(fed, 'Ferments blended into this wine (their own batches, under their own fruit)') +
    (notes ? `<h2>Key changes / lessons — latest years</h2><div class="ncards">${notes}</div>` : ''));
  return [fam, body];
}

export function new_from_medians(c, fam) {
  const C = F.constants(c);
  const ds = _proto_rows(c, fam, C).filter(d => (d.r.role || 'batch') === 'batch');
  const brs = ds.filter(d => (d.r.model || 'brix') === 'brix');
  const br = brs.length ? brs : ds;
  const med = k => {
    const vs = br.map(d => d.r[k]).filter(v => !(v === null || v === undefined || v === 0 || v === false));
    return vs.length ? median(vs) : null;
  };
  if (!ds.length) throw new ValueError('max() arg is an empty sequence');
  let last = ds[0];
  const key = d => [d.r.year || 0, d.r.id];
  for (const d of ds.slice(1)) {
    const [a0, a1] = key(d), [b0, b1] = key(last);
    if (a0 > b0 || (a0 === b0 && a1 > b1)) last = d;
  }
  last = last.r;
  const y = (last.year || thisYear()) + 1;
  const short = fam.split(' — ')[0].replaceAll(' / ', '-').replaceAll(' ', '');
  const now = nowIso();
  const cur = c.run(`INSERT INTO formula(name,wine,year,type,category,sweetener,model,target_l,brix_fruit,fruit_lb_per_gal,juice_gal_per_lb,brix_desired,factor,fg,
                       yeast,fermenter,family,family_status,role,origin,source,created_at,updated_at) VALUES (?,?,?,?,?,?,'brix',?,?,?,?,?,?,?,?,?,?,'confirmed','batch','app',?,?,?)`,
    `${String(y).slice(2)}${short}`, last.wine, y, last.category, last.category, last.sweetener, last.target_l, med('brix_fruit'), med('fruit_lb_per_gal'),
    med('juice_gal_per_lb'), med('brix_desired'), med('factor'), med('fg'), last.yeast, last.fermenter, fam,
    `New ${y} formula from the medians of ${br.length} ${fam} formulas, ${now.slice(0, 10)}`, now, now);
  c.commit();
  return cur.id;
}

// ------------------------------------------------------------------ additions
export function additions_page(c, q, token) {
  const C = F.constants(c);
  const cont = entry.current_contents(c);
  const vsel = qv(q, 'vessel', ''), bsel = qv(q, 'batch', ''), volq = qv(q, 'vol', '');
  let cider = qv(q, 'cider', '') === '1';
  let V = null, src = '';
  if (vsel) {
    const x = cont.find(x => pstr(x.vessel_id) === vsel);
    if (x) {
      V = x.volume_l;
      src = `${pstr(x.vessel)} · ${pstr(x.batch)}`;
    }
  } else if (bsel) {
    const xs = cont.filter(x => pstr(x.batch_id ?? null) === bsel);
    if (xs.length) {
      V = xs.reduce((s, x) => s + x.volume_l, 0);
      src = `${pstr(xs[0].batch)} in ${xs.length} vessel${xs.length > 1 ? 's' : ''}`;
    } else {
      const b = c.one('SELECT code FROM batch WHERE id=?', bsel);
      src = `${b ? pstr(b.code) : 'batch'} is not in any vessel now`;
    }
  }
  // v1.18: a batch still being built is dosed on its formulation's target volume (switchable to what is in the vessel now)
  let T = null, basis = qv(q, 'basis', ''), tnote = '';
  if (V !== null && V !== undefined && (vsel || bsel)) {
    const bidT = bsel || (cont.find(x => pstr(x.vessel_id) === vsel) || {}).batch_id;
    const nves = bidT ? cont.filter(x => pstr(x.batch_id ?? null) === pstr(bidT)).length : 0;
    T = bidT && (bsel || nves === 1) ? batch_target(c, bidT) : null;
    if (T) {
      if (basis !== 'now' && basis !== 'target') basis = 'target';
      const keepq = Object.entries({ vessel: vsel, batch: bsel, cider: cider ? '1' : '' }).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const sw = `<span class="chips" style="display:inline-flex;margin:0 0 0 8px;vertical-align:middle"><a class="${basis === 'target' ? 'on' : ''}" href="/additions?${keepq}&basis=target">Formulation target ${fxc(T.target_l, 0)} L</a>` +
        `<a class="${basis === 'now' ? 'on' : ''}" href="/additions?${keepq}&basis=now">Now in the vessel ${fxc(V, 1)} L</a></span>`;
      tnote = `<p class="sub">Doses figured on: ${sw}<br><span class="muted" style="font-size:12px">${E(T.name)} targets ${fxc(T.target_l, 0)} L; ${fxc(V, 1)} L is in the vessel now (water in ${fxc(T.water_in, 1)} of ${fxc(T.water_l, 1)} L). After pressing or once the volume is final, switch to “Now in the vessel”.</span></p>`;
      if (basis === 'target') V = T.target_l;
    }
  }
  if (V === null || V === undefined) {
    try {
      V = volq ? pyFloat(volq) : 870.0;
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      V = 870.0;
    }
  }
  if (!cider && (vsel || bsel)) {
    let bid = bsel;
    if (!bid) {
      const x = cont.find(x => pstr(x.vessel_id) === vsel);
      bid = x ? pstr(x.batch_id ?? null) : null;
    }
    const r = bid ? c.one('SELECT beverage_type FROM batch WHERE id=?', bid) : null;
    cider = !!(r && (r.beverage_type || '').toLowerCase() === 'cider');
  }
  const mats = new Map();
  for (const m of c.all('SELECT id, name FROM material')) mats.set(m.name, m.id);
  const vo = '<option value="">—</option>' + cont.map(x => `<option value="${pstr(x.vessel_id)}" ${pstr(x.vessel_id) === vsel ? 'selected' : ''}>${E(x.vessel)} · ${E(x.batch)} · ${fxc(x.volume_l, 0)} L</option>`).join('');
  const seen = new Set(), bopts = [];
  for (const x of cont) {
    if (x.batch_id && !seen.has(x.batch_id)) {
      seen.add(x.batch_id);
      bopts.push(x);
    }
  }
  const bo = '<option value="">—</option>' + [...bopts].sort((a, b) => (a.batch < b.batch ? -1 : a.batch > b.batch ? 1 : 0)).map(x => `<option value="${pstr(x.batch_id)}" ${pstr(x.batch_id) === bsel ? 'selected' : ''}>${E(x.batch)}</option>`).join('');
  const top = `<form class="f" id="pick"><label>Vessel<select name="vessel" onchange="this.form.batch.value='';this.form.vol.value='';this.form.submit()">${vo}</select></label>
      <label>or batch<select name="batch" onchange="this.form.vessel.value='';this.form.vol.value='';this.form.submit()">${bo}</select></label>
      <label>or volume (L)<input name="vol" id="vol" value="${E(val(V))}" class="edb" inputmode="decimal"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="cider" value="1" ${cider ? 'checked' : ''} onchange="this.form.submit()"> Cider (half nutrient)</label>
      ${T ? `<input type="hidden" name="basis" value="${E(basis)}">` : ''}<button class="btn2">Show</button><span class="muted" id="galv"></span></form>
      ${src ? `<p class="sub">Volume from ${E(src)}.</p>` : ''}${tnote}`;
  const rows = F.doses(V, C, cider);
  const tr = [];
  for (const [key, name, rate, dose, unit, mat, note] of rows) {
    const mid = mat ? (mats.has(mat) ? mats.get(mat) : null) : null;
    let rec = '';
    if (vsel && mid) {
      rec = `<a class="btn btn2" style="padding:3px 10px" data-rec="${key}" href="/record/addition?vessel_id=${E(vsel)}&material_id=${pstr(mid)}&amount=${fx(dose, 1)}&unit=${unit === 'mL' ? 'ml' : 'g'}">Record</a>`;
    }
    const ORDER = { kmsStart: 'BSG', pecHC: 'Scott Labs', pec5L: 'Scott Labs', yeast: 'Scott Labs', goferm: 'Scott Labs', fk1: 'Scott Labs', fk2: 'Scott Labs', bent: 'BSG', kmsEnd: 'BSG', so2: 'BSG' };
    const ord = ORDER[key] ? ` <small>Order from <a href="/contacts?q=${encodeURIComponent(ORDER[key])}">${E(ORDER[key])}</a> (cookbook)</small>` : '';
    tr.push(`<tr data-key="${key}"><td><b>${E(name)}</b><small>${E(note.replace(/ ?Order from (BSG|Scott Labs)\./, ''))}</small>${ord}</td>
          <td><input class="ed" style="width:6em" data-rate="${rate}" value="${E(val(C[rate]))}" inputmode="decimal"> <span class="muted" style="font-size:12px">${E(F.CONSTANTS[rate][2])}</span></td>
          <td class="n"><b id="d_${key}">${fxc(dose, 1)}</b> ${E(unit)}</td><td>${rec}</td></tr>`);
  }
  const table = ('<table><thead><tr><th>Addition</th><th>Rate</th><th class="n">Dose</th><th></th></tr></thead><tbody>' + tr.join('') + '</tbody></table>' +
    `<form method="post" action="/constants/save" id="rateform" class="bar" style="margin-top:8px"><input type="hidden" name="_t" value="${token}"><input type="hidden" name="_back" value="/additions?${E(_qs(q))}">
             <button class="btn2">Save these rates as the defaults</button><span class="muted" style="font-size:12px">Rates change the doses on this page at once; saving makes them the defaults (also on Constants).</span></form>`);
  const [g0, simple, exact] = F.backsweeten(V, 25, 13);
  void g0; void simple; void exact;
  const cards = `<div class="fgrid" style="margin-top:14px">
 <div class="step"><div class="hd" style="color:var(--acc)">Free SO₂ target from pH</div>
  ${_row('pH', '<input class="edb" id="ph" value="3.5" inputmode="decimal">')}${_row('Molecular SO₂ wanted', `<input class="edb" id="mol" value="${val(C.molSO2)}" inputmode="decimal">`, 'mg/L')}
  <div class="frow big"><span class="l">Free SO₂ needed</span><span class="v" id="free"></span><span class="u">ppm</span></div>
  <div class="frow"><button type="button" class="btn2" id="usefree">Use as SO₂ addition target</button></div>
  <p class="muted" style="font-size:12px;margin:6px 0 0"><a href="https://www.enartis.com/wp-content/uploads/2020/04/Distribution-of-Free-SO2.pdf" target="_blank" rel="noopener">Free SO₂ &amp; pH table (Enartis PDF)</a></p></div>
 <div class="step"><div class="hd" style="color:var(--acc)">Back-sweetening (cookbook)</div>
  ${_row('Sugar wanted', '<input class="edb" id="bsg" value="25" inputmode="decimal">', 'g/L')}
  <div class="frow big"><span class="l">Dry sugar for the batch</span><span class="v" id="bs_g"></span><span class="u">g</span></div>${_row('', '<span class="v" id="bs_lb"></span>', 'lb')}
  ${_row('or juice at', '<input class="edb" id="bsb" value="13" inputmode="decimal">', '°Brix')}
  <div class="frow big"><span class="l">Juice, cookbook formula</span><span class="v" id="bs_j"></span><span class="u">L</span></div>
  ${_row('Juice, allowing for the added volume', '<span class="v" id="bs_x"></span>', 'L')}${_row('cookbook result after dilution', '<span class="v" id="bs_r"></span>', 'g/L')}
  <p class="muted" style="font-size:12px;margin:6px 0 0"><a href="https://www.vinolab.hr/calculator/gravity-density-sugar-conversions-en19" target="_blank" rel="noopener">Gravity / density / sugar conversions (Vinolab)</a> · <a href="https://winemakermag.com/technique/1468-adding-sugar-to-your-must" target="_blank" rel="noopener">Adding sugar to your must (WineMaker)</a></p></div>
 <div class="step"><div class="hd" style="color:var(--acc)">Blend ABV</div><div id="blend"></div>
  <div class="frow"><button type="button" class="btn2" id="addw">Add a wine</button><span class="l"></span><span class="v" id="blendout"></span></div>
  <p class="muted" style="font-size:12px;margin:6px 0 0"><a href="https://www.winebusiness.com/calculator/winemaking/section/8/" target="_blank" rel="noopener">ABV blend calculator (Wine Business)</a> · <a href="https://www.calculator.net/ratio-calculator.html?t1=10&amp;b1=350&amp;t2=&amp;b2=50&amp;ctype=1&amp;x=Calculate" target="_blank" rel="noopener">Ratio calculator</a></p></div>
</div>`;
  const js = ('<script>const C=' + pyJson(C) + ';const KEYS=' + pyJson(rows.map(([k, , r, , u]) => [k, r, u])) + `;
const $=id=>document.getElementById(id);const f1=(v,d)=>isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
function rate(k){const i=document.querySelector('[data-rate="'+k+'"]');return i?parseFloat(i.value)||0:C[k]}
function upd(){const V=parseFloat($('vol').value)||0,cider=document.querySelector('[name=cider]').checked,k=rate('kmsSO2')||C.kmsSO2||0.576;
 $('galv').textContent=f1(V/C.lPerGal,1)+' gal';const nut=rate('fermaidK')*(cider?C.ciderNutrient:1);
 const D={kmsStart:V*rate('kmsStartPpm')/1000/k,pecHC:V/100*rate('pecHC'),pec5L:V/100*rate('pec5L'),yeast:V*rate('yeast'),goferm:V*rate('goferm'),fk1:V*nut,fk2:V*nut,bent:V*rate('bentonite'),kmsEnd:V*rate('kmsEndPpm')/1000/k,so2:V*rate('so2Ppm')/1000/k,sorb:V*rate('sorbate')*1.25};
 for(const [key] of KEYS){if($('d_'+key))$('d_'+key).textContent=f1(D[key],1);const a=document.querySelector('[data-rec="'+key+'"]');if(a){const u=new URL(a.href,location.href);u.searchParams.set('amount',D[key].toFixed(1));a.href=u.pathname+u.search}}
 const ph=parseFloat($('ph').value),mol=parseFloat($('mol').value);$('free').textContent=f1(mol*(1+Math.pow(10,ph-1.81)),0);
 const g=parseFloat($('bsg').value)||0,b=parseFloat($('bsb').value)||0,G=g*V;$('bs_g').textContent=f1(G,0);$('bs_lb').textContent=f1(G/453.592,1);
 const j=b?G/(b*10):NaN;$('bs_j').textContent=f1(j,1);$('bs_x').textContent=(b*10>g)?f1(V*g/(b*10-g),1):'juice too dilute';$('bs_r').textContent=f1(G/(V+j),1);blendOut();}
document.querySelectorAll('[data-rate]').forEach(i=>i.addEventListener('input',()=>{const h=document.querySelector('#rateform [name="'+i.dataset.rate+'"]');if(h)h.value=i.value;else{const x=document.createElement('input');x.type='hidden';x.name=i.dataset.rate;x.value=i.value;$('rateform').append(x)}upd()}));
['vol','ph','mol','bsg','bsb'].forEach(id=>$(id).addEventListener('input',upd));
$('usefree').onclick=()=>{const v=Math.round(parseFloat($('free').textContent.replace(/,/g,'')));const i=document.querySelector('[data-rate="so2Ppm"]');if(v&&i){i.value=v;i.dispatchEvent(new Event('input'))}};
let BL=[[100,12],[100,14]];function blend(){const el=$('blend');el.innerHTML='';BL.forEach((b,i)=>{const d=document.createElement('div');d.className='frow';
 d.innerHTML='<input class="edb" placeholder="L" value="'+b[0]+'"> L at <input class="edb" placeholder="%" value="'+b[1]+'"> % <button type="button" class="btn2" style="padding:1px 8px">×</button>';
 const [v,a]=d.querySelectorAll('input');v.oninput=()=>{b[0]=+v.value;blendOut()};a.oninput=()=>{b[1]=+a.value;blendOut()};d.querySelector('button').onclick=()=>{BL.splice(i,1);blend()};el.append(d)});blendOut()}
function blendOut(){const tv=BL.reduce((s,b)=>s+(+b[0]||0),0),ta=BL.reduce((s,b)=>s+(+b[0]||0)*(+b[1]||0),0);$('blendout').textContent=tv?f1(ta/tv,2)+' % in '+f1(tv,0)+' L':'—'}
$('addw').onclick=()=>{BL.push([0,0]);blend()};blend();upd();
</script>`);
  const hint = vsel ? '' : '<p class="muted" style="font-size:12px">Pick a vessel to get “Record” buttons that open the Addition entry with the amount filled in.</p>';
  return ('<h1>Additions' + HELP('formulation') + '</h1><p class="sub">Doses from the <a href="https://docs.google.com/spreadsheets/d/1Wp0fCRAR-Zl93V3C7jAvtXUxH99H31Rhe7lceKpR2i8/edit" target="_blank" rel="noopener">HW winemaking cookbook</a> (BASIC ADDS), scaled to the batch. Amber rates are editable. Suppliers: <a href="/contacts">Contacts</a> (includes the cookbook SOURCES tab).</p>' +
    top + hint + table + cards + js);
}

export function _qs(q) {
  const o = {};
  for (const [k, v] of Object.entries(q)) if (v && v.length && v[0]) o[k] = v[0];
  return urlencode(o);
}

// ------------------------------------------------------------------ constants
export function constants_page(c, token, msg = '') {
  const C = F.constants(c);
  const groups = new Map();
  for (const [k, [d, lab, unit, note, grp]] of Object.entries(F.CONSTANTS)) {
    if (!groups.has(grp)) groups.set(grp, []);
    groups.get(grp).push(
      `<tr><td>${E(lab)}</td><td><input class="ed" name="${k}" value="${E(val(C[k]))}" inputmode="decimal"> <span class="muted" style="font-size:12px">${E(unit)}</span></td>` +
      `<td class="muted">${E(note)}${pyFloat(C[k]) === pyFloat(d) ? '' : ` <b style=color:var(--amber)>(default ${val(d)})</b>`}</td></tr>`);
  }
  const body = [...groups].map(([g, rows]) => `<h2>${E(g)}${g.startsWith('SO₂') ? ' <a style="font-size:13px;font-weight:400" href="/so2/calibration">what the data say</a>' : ''}</h2><table><thead><tr><th>Constant</th><th>Value</th><th>Note</th></tr></thead><tbody>${rows.join('')}</tbody></table>`).join('');
  return (`<h1>Constants</h1><p class="sub">Used by every formulation and dose. Change with care.</p>${msg}` +
    `<form method="post" action="/constants/save"><input type="hidden" name="_t" value="${token}">${body}` +
    `<div class="bar" style="margin-top:12px"><button>Save constants</button></div></form>` +
    `<form method="post" action="/constants/reset" style="margin-top:8px" onsubmit="return confirm('Restore every constant to its default?')"><input type="hidden" name="_t" value="${token}"><button class="btn2">Restore defaults</button></form>`);
}

// ------------------------------------------------------------------ POST
export function _num(v) {
  v = pyStrip(v || '').replaceAll(',', '');
  if (v === '') return null;
  return pyFloat(v);
}

// str.isdigit() for the first characters of a name (ASCII/Unicode decimal digits and super/subscript digits)
function isdigit(s) {
  return s.length > 0 && /^[\p{Nd}²³¹⁰⁴-⁹₀-₉]+$/u.test(s);
}

// v1.20 fruit mix rows from the formulation form (mix_fruit[], mix_pct[]) → JSON, blank rows dropped
function mixOf(f) {
  const nm = f.mix_fruit || [], pc = f.mix_pct || [];
  const out = [];
  for (let i = 0; i < nm.length; i++) {
    const fr = String(nm[i] || '').trim(), p = parseFloat(String(pc[i] || '').replace(',', '.'));
    if (fr && p > 0) out.push({ fruit: fr, pct: Math.round(p * 100) / 100 });
  }
  return out.length ? JSON.stringify(out) : null;
}

export function post(c, path, f) {
  const g = (k, d = '') => (Object.prototype.hasOwnProperty.call(f, k) && f[k] && f[k].length ? f[k][0] : d);
  const now = nowIso();
  try {
    if (path === '/formula/new') {
      const C = F.constants(c);
      const cat = g('category');
      if (!F.CATEGORIES.includes(cat)) return [null, 'Choose a category (Fruit wine, Mead or Cider).'];
      const sw = F.DEFAULT_SWEETENER[cat];
      const fac = sw === 'honey' ? C.honeyFactor : (sw === 'sugar' ? C.sugarFactor : null);
      const cur = c.run(`INSERT INTO formula(name,wine,year,type,category,sweetener,model,target_l,brix_fruit,fruit_lb_per_gal,juice_gal_per_lb,brix_desired,factor,fg,
                               origin,source,role,created_at,updated_at) VALUES (?,?,?,?,?,?,'brix',100,NULL,NULL,NULL,NULL,?,NULL,'app','Created in HWWineTracker','batch',?,?)`,
        pyStrip(g('name')) || 'New formula', '', thisYear(), cat, cat, sw, fac, now, now);
      c.commit();
      return [`/formula/${cur.id}`, null];
    }
    if (path === '/prototype/rename') {   // rename a prototype wine everywhere it is named; an existing name merges the two
      const old = g('old'), nw = pyStrip(g('new'));
      if (!old || !nw) return [null, 'Give the new name.'];
      if (nw === old) return [`/prototype?f=${encodeURIComponent(old)}`, null];
      const mo = current_master(c, old), mn = current_master(c, nw);
      if (mo && mn) return [null, `Both ${old} and ${nw} have a ★ master. Open the one you don't want, make the other the master (or delete it), then merge.`];
      c.run("UPDATE formula SET family=?, family_status='confirmed', updated_at=? WHERE family=?", nw, now, old);
      for (const r of c.all("SELECT id, blend_into FROM formula WHERE blend_into IS NOT NULL AND instr(blend_into, ?) > 0", old)) {
        const parts = r.blend_into.split(',').map(x => pyStrip(x));
        if (parts.includes(old)) c.run('UPDATE formula SET blend_into=?, updated_at=? WHERE id=?', [...new Set(parts.map(x => (x === old ? nw : x)))].join(', '), now, r.id);
      }
      const T = tiers(c), to = T.get(old), tn = T.get(nw);
      if (to !== undefined) {
        c.run('DELETE FROM wine_tier WHERE family=?', old);
        c.run('INSERT INTO wine_tier(family, tier, updated_at) VALUES (?,?,?) ON CONFLICT(family) DO UPDATE SET tier=excluded.tier, updated_at=excluded.updated_at',
          nw, to === 'core' || tn === 'core' ? 'core' : 'occasional', now);
      }
      c.commit();
      return [`/prototype?f=${encodeURIComponent(nw)}`, null];
    }
    if (path === '/prototype/move') {   // split: ticked formulations (never a master) go to another or a new prototype wine
      const old = g('old'), to = pyStrip(g('to'));
      const ids = (f.ids || []).map(x => pyInt(x));
      if (!to) return [null, 'Give the prototype wine to move them to.'];
      if (!ids.length) return [null, 'Tick the formulations to move first.'];
      for (const id of ids) c.run("UPDATE formula SET family=?, family_status='confirmed', updated_at=? WHERE id=? AND family=? AND COALESCE(is_master,0)=0", to, now, id, old);
      c.commit();
      const left = c.val('SELECT COUNT(*) AS n FROM formula WHERE deleted=0 AND family=?', old);
      return [`/prototype?f=${encodeURIComponent(left ? old : to)}`, null];
    }
    if (path === '/prototype/tier') {
      const fam = pyStrip(g('family'));
      if (!fam) return [null, 'No prototype wine given.'];
      const tier = g('tier') === 'core' ? 'core' : 'occasional';
      c.run('INSERT INTO wine_tier(family, tier, updated_at) VALUES (?,?,?) ON CONFLICT(family) DO UPDATE SET tier=excluded.tier, updated_at=excluded.updated_at', fam, tier, now);
      c.commit();
      const back = g('_back');
      return [back.startsWith('/formulas') || back.startsWith('/prototype') ? back : '/formulas', null];
    }
    if (path === '/prototype/new') {
      const fam = g('family');
      if (!fam) return [null, 'No prototype wine given.'];
      return [`/formula/${new_from_medians(c, fam)}`, null];
    }
    const parts = path.replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] === 'formula' && parts.length === 3) {
      const fid = pyInt(parts[1]), act = parts[2];
      const r = c.one('SELECT * FROM formula WHERE id=? AND deleted=0', fid);
      if (!r) return [null, 'That formula no longer exists.'];
      if (act === 'save') {
        const vals = {};
        for (const k of F.FIELDS) vals[k] = _num(g(k));
        const cat = g('category') || r.category;
        const sw = ['sugar', 'honey', 'none'].includes(g('sweetener')) ? g('sweetener') : 'none';
        const name = pyStrip(g('name')) || 'Untitled';
        const yv = _num(g('year'));
        const year = r.is_master ? null : (pyInt(truthy(yv) ? yv : 0) || null);
        const bid = r.is_master ? null : (g('batch_id') ? pyInt(g('batch_id')) : null);
        const fam = r.is_master ? r.family : (pyStrip(g('family')) || null);
        const status = fam === r.family ? r.family_status : (fam ? 'confirmed' : null);
        const role = r.is_master ? 'batch' : (['batch', 'component'].includes(g('role')) ? g('role') : 'batch');
        c.run(`UPDATE formula SET name=?, wine=?, year=?, type=?, category=?, sweetener=?, ${F.FIELDS.map(k => k + '=?').join(', ')},
                              yeast=?, fermenter=?, fruit_notes=?, lessons=?, prep=?, batch_id=?, family=?, family_status=?, role=?, blend_into=?, fruit_mix=?,
                              model=CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN 'brix' ELSE model END, updated_at=? WHERE id=?`,
          ...[name, pyStrip(g('wine')), year, cat, cat, sw], ...F.FIELDS.map(k => vals[k]),
          ...[pyStrip(g('yeast')), pyStrip(g('fermenter')), g('fruit_notes'), g('lessons'), g('prep'), bid, fam, status, role, pyStrip(g('blend_into')) || null, mixOf(f),
            vals.brix_fruit, vals.brix_desired, now, fid]);
        c.commit();
        return [g('_go') === 'makebatch' ? `/makebatch?f=${fid}` : `/formula/${fid}?saved=1`, null];
      }
      if (act === 'fillfrom') {   // take the recipe numbers (and notes where this one has none) from another formulation
        const src = c.one('SELECT * FROM formula WHERE id=? AND deleted=0', pyInt(g('src') || 0));
        if (!src) return [null, 'Pick the formulation to fill from.'];
        const keep = k => (r[k] !== null && r[k] !== '' ? r[k] : src[k]);
        const vals = F.FIELDS.map(k => (k === 'target_l' && r.target_l ? r.target_l : src[k]));
        c.run(`UPDATE formula SET category=?, type=?, sweetener=?, model=?, sweet_lb_per_gal=?, liquid=?, ${F.FIELDS.map(k => k + '=?').join(', ')},
               wine=?, family=?, yeast=?, fermenter=?, prep=?, lessons=?, fruit_notes=?, fruit_mix=?, source=?, updated_at=? WHERE id=?`,
          src.category, src.type, src.sweetener, src.model, src.sweet_lb_per_gal, src.liquid, ...vals, keep('wine'), keep('family'), keep('yeast'), keep('fermenter'),
          keep('prep'), keep('lessons'), keep('fruit_notes'), keep('fruit_mix'), [r.source, `Numbers from ${pstr(src.name)} (${pstr(src.year || '?')}) on ${now.slice(0, 10)}`].filter(x => x).join(' · '), now, fid);
        c.commit();
        return [`/formula/${fid}?saved=1`, null];
      }
      if (act === 'master') {   // ★ promote: a new master version from this formulation (the old master is kept, retired)
        if (r.is_master && !r.retired_at) return [`/formula/${fid}`, null];
        if (!r.family) return [null, 'Set the Prototype wine on this formulation first (and save), so the app knows which wine it becomes the master for.'];
        return [`/formula/${promote(c, r, now)}?promoted=1`, null];
      }
      if (act === 'copy') {
        const same = g('same') === '1';
        const y = same ? (r.year || thisYear()) : thisYear();   // this season, whatever year it is copied from
        let name = r.name;
        if (!same) {
          const nm = r.is_master ? name.replace(/[\s/]+/g, '') : (isdigit(cpSlice(name, 0, 2)) ? cpSlice(name, 2) : name);
          const stem = `${String(y).slice(2)}${nm}`;
          name = stem;
          for (let i = 2; c.one('SELECT 1 x FROM formula WHERE deleted=0 AND year=? AND lower(name)=lower(?)', y, name); i++) name = `${stem}${i}`;
        } else {
          name = name + ' (copy)';
        }
        const cols = ['wine', 'type', 'category', 'sweetener', 'model', 'sweet_lb_per_gal'].concat(F.FIELDS, ['yeast', 'fermenter', 'fruit_notes', 'lessons', 'prep', 'family', 'role', 'liquid', 'blend_into', 'fruit_mix']);
        const what = r.is_master ? `master ${pstr(r.name)} v${pstr(r.master_version || 1)}` : `${pstr(r.name)} (${pstr(r.year || '?')})`;
        const cur = c.run(`INSERT INTO formula(name, year, ${cols.join(', ')}, family_status, origin, source, derived_from, created_at, updated_at) VALUES (?,?,${cols.map(() => '?').join(',')},?,?,?,?,?,?)`,
          ...[name, y].concat(cols.map(k => k === 'role' && r.is_master ? 'batch' : r[k]), [r.family ? 'confirmed' : null, 'app', `Copied from ${what} on ${now.slice(0, 10)}`, r.id, now, now]));
        c.commit();
        return [`/formula/${cur.id}`, null];
      }
      if (act === 'delete') {
        c.run('UPDATE formula SET deleted=1, updated_at=? WHERE id=?', now, fid);
        c.commit();
        return ['/formulas', null];
      }
    }
    if (path === '/constants/save') {
      const vals = {};
      for (const k of Object.keys(F.CONSTANTS)) {
        if (Object.prototype.hasOwnProperty.call(f, k) && pyStrip(g(k)) !== '') vals[k] = _num(g(k));
      }
      for (const [k, [lo, hi]] of Object.entries(SO2_LIMITS)) if (k in vals && !(vals[k] >= lo && vals[k] <= hi)) return [`/constants?bad=${encodeURIComponent(F.CONSTANTS[k][1])}&lo=${lo}&hi=${hi}`, null];   // v1.30 range checks
      F.save_constants(c, vals);
      const back = g('_back');
      return [back.startsWith('/additions') ? back : '/constants?saved=1', null];
    }
    if (path === '/constants/reset') {
      F.reset_constants(c);
      return ['/constants?saved=1', null];
    }
    return [null, 'Unknown form.'];
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
    // Python calls c.rollback() here; every ValueError above is raised before the first write, so there is nothing to undo.
    return [null, `Please check the numbers (${e.message}).`];
  }
}
