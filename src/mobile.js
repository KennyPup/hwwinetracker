// Phone screens (v0.9): cellar list -> wine card -> ferment check. Modelled on the Vintrace iPhone app; entries go to the practice copy until cutover.
// v1.1: home = search + Scan (vessel barcode/QR labels, /m/scan), the 3 most recently active wines, fermenting, all vessels.
import { GLOBAL as HELPG } from './help.js';
import { UNITS } from './units.js';
import { DICTATE } from './dictate.js';
import { E, num, nowIso, today, addDays, naiveMs, strftime } from './lib/py.js';
import { ctx, READONLY, PRACTICE, bdg, line_chart, latest_labs, VERSION } from './core.js';
import { splash } from './splash.js';
import { TABLESORT } from './tablesort.js';
import * as hw_ui from './hw_ui.js';
import * as entry from './entry.js';
import * as notes from './notes.js';
import { batch_target } from './target.js';
import * as stage from './stage.js';
import { JSQR_VER } from './gen/jsqr.js';
import * as VU from './vessel_ui.js';
import { search as qsearch } from './search.js';
import { pack_size } from './core.js';

const GAL = 3.785411784;
const TILES = [['Brix', '°Bx', 1], ['SG', 'SG', 3], ['TempC', 'Temp', 1], ['Free SO2', 'Free SO₂', 0], ['pH', 'pH', 2], ['Alcohol', 'Alc %', 1]];
const CAP = ['Punch down', 'Pump over', 'Stir / batonnage'];

const CSS = `:root{--bg:#0d1117;--fg:#c9d1d9;--fg2:#e6edf3;--mut:#8b949e;--line:#21262d;--line2:#30363d;--acc:#388bfd;--amber:#d29922;--green:#3fb950;--red:#f85149;--card:#161b22;--hi:#1c2128}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--acc);text-decoration:none}
.mt{position:sticky;top:0;z-index:5;background:#010409;border-bottom:1px solid var(--line);padding:calc(env(safe-area-inset-top) + 10px) 14px 10px;display:flex;align-items:center;gap:10px}
.mt .bk{font-size:17px;white-space:nowrap}.mt h1{flex:1;margin:0;font-size:18px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt .x{font-size:13px;color:var(--mut)}.mt .fa{font-size:13px;color:#58a6ff;white-space:nowrap;border:1px solid var(--line);border-radius:14px;padding:4px 10px;text-decoration:none}
.pb{background:#3b2e0a;color:#f0c75e;font-size:13px;padding:6px 14px}.pb a{color:#f0c75e;text-decoration:underline}
.rb{background:#2d1517;color:#ffa198;font-size:14px;padding:10px 14px}.rb a{color:#fff;text-decoration:underline;font-weight:600}
.w{padding:12px 14px calc(env(safe-area-inset-bottom) + 90px)}
.srch{width:100%;font-size:17px;padding:11px 12px;border-radius:10px;border:1px solid var(--line2);background:var(--card);color:var(--fg2);margin-bottom:12px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:18px 2px 8px}
.r{display:flex;align-items:center;gap:11px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 12px;margin-bottom:8px;color:var(--fg)}
.r .m{flex:1;min-width:0}.r b{color:var(--fg2);font-size:16px}.r .d{color:var(--mut);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.r .v{text-align:right;font-size:17px;color:var(--fg2);font-variant-numeric:tabular-nums}.r .v small{display:block;font-size:11px;color:var(--mut)}
.r.f{border-left:4px solid var(--amber)}
.bdg{display:inline-block;border-radius:5px;text-align:center;font-weight:700;flex:none}
.hd{display:flex;gap:12px;align-items:center;margin:4px 0 12px}.hd b{font-size:20px;color:var(--fg2)}.hd .d{color:var(--mut);font-size:14px}
.tag{font-size:12px;border-radius:10px;padding:2px 8px;border:1px solid var(--line2)}.tag.u{color:var(--amber);border-color:#5a4410}.tag.b{color:var(--green);border-color:#1f4d2a}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.tl{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 8px;text-align:center}
.tl i{display:block;font-style:normal;font-size:12px;color:var(--mut)}.tl b{display:block;font-size:22px;color:var(--fg2);font-variant-numeric:tabular-nums;margin:2px 0}
.tl small{font-size:11px;color:var(--mut)}.tl.e b{color:var(--line2)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:10px 0}
.card svg text{fill:var(--mut);font-size:20px}
.ops div{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}.ops div:last-child{border:0}.ops span{color:var(--mut);white-space:nowrap}
.ncard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0;font-size:14px}.ncard .h{display:flex;justify-content:space-between;gap:6px;font-weight:600;font-size:12.5px;color:var(--mut)}
.ncard .t{white-space:pre-wrap;margin:6px 0;color:var(--fg2)}.ncard .f{font-size:12px;color:var(--mut)}.muted{color:var(--mut)}
.go{position:fixed;left:14px;right:14px;bottom:calc(env(safe-area-inset-bottom) + 14px);display:block;text-align:center;background:var(--acc);color:#fff;font-size:18px;font-weight:600;border:0;border-radius:14px;padding:15px;z-index:6;width:calc(100% - 28px)}
.sh{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;z-index:9}.sh.on{display:block}
.sh .p{position:absolute;left:0;right:0;bottom:0;background:var(--hi);border-radius:16px 16px 0 0;padding:8px 0 calc(env(safe-area-inset-bottom) + 10px)}
.sh .p a{display:flex;gap:14px;align-items:center;padding:15px 22px;font-size:18px;color:var(--fg2);border-bottom:1px solid var(--line)}.sh .p a span{font-size:22px;width:28px;text-align:center}
.sh .p a.cx{justify-content:center;color:var(--mut);border:0}
form .sec{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4px 12px;margin:10px 0}
.sw{display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:17px;color:var(--fg2)}
.sw input{appearance:none;-webkit-appearance:none;width:52px;height:31px;border-radius:16px;background:var(--line2);position:relative;transition:.2s;flex:none;margin:0}
.sw input:before{content:"";position:absolute;width:27px;height:27px;border-radius:50%;background:#fff;top:2px;left:2px;transition:.2s}
.sw input:checked{background:var(--green)}.sw input:checked:before{left:23px}
.fl{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)}
.fl label{flex:0 0 78px;font-size:16px;color:var(--fg2)}.fl .last{flex:1;text-align:right;font-size:12px;line-height:1.25;color:var(--mut)}
.fl input,.fl select,.blk{font-family:inherit;font-size:18px;padding:9px 10px;border-radius:9px;border:1px solid var(--line2);background:var(--bg);color:var(--fg2);min-width:0}
.fl input{width:100px}.fl select{flex:1}.blk{width:100%;display:block;margin:6px 0 10px}
.seg{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}.seg label{flex:none;padding:7px 12px;font-size:15px;color:var(--mut)}
.seg input{display:none}.seg label:has(input:checked){background:var(--acc);color:#fff}
.hid{display:none}.ok{background:#12261a;border:1px solid #1f4d2a;color:#7ee2a0;border-radius:10px;padding:10px 12px;margin:8px 0}
.err{background:#2d1517;border:1px solid #5c2328;color:#ffa198;border-radius:10px;padding:10px 12px;margin:8px 0}
.lk{display:flex;gap:16px;justify-content:center;margin:22px 0 4px;font-size:14px}
.sbar{display:flex;gap:8px;align-items:stretch;margin-bottom:6px}.sbar .srch{flex:1;margin:0;min-width:0}
.sbtn{display:flex;align-items:center;gap:6px;background:var(--acc);color:#fff;border:0;border-radius:10px;padding:0 14px;font:600 16px/1 inherit;font-family:inherit}
.rc{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:9px;color:var(--fg)}
.rc .m{flex:1;min-width:0}.rc b{font-size:18px;color:var(--fg2)}.rc .d{color:var(--mut);font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rc .la{font-size:13px;color:var(--fg);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rc .ch{font-size:26px;color:var(--mut)}
details.all{margin-top:18px}details.all summary{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);padding:8px 2px;cursor:pointer}
.fab{position:fixed;right:18px;bottom:calc(env(safe-area-inset-bottom) + 18px);width:62px;height:62px;border-radius:50%;border:0;background:var(--acc);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.5);z-index:6}
.fab svg{width:28px;height:28px}.go svg{vertical-align:-4px}
pre.raw{background:var(--card);border:1px solid var(--line2);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-all;color:var(--fg2);font-size:15px}
.scn{position:fixed;inset:0;z-index:20;background:#000;display:flex;flex-direction:column}.scn[hidden]{display:none}
.scn video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scn .aim{position:absolute;left:8%;right:8%;top:30%;height:26%;border:3px solid rgba(255,255,255,.85);border-radius:16px;box-shadow:0 0 0 100vmax rgba(0,0,0,.35)}
.scn .aim i{position:absolute;left:6%;right:6%;top:50%;height:2px;background:#f85149;opacity:.8}
.scn .sch{position:absolute;left:16px;right:16px;top:calc(env(safe-area-inset-top) + 18px);margin:0;text-align:center;color:#fff;font-size:16px;text-shadow:0 1px 3px #000}
.scn .scb{position:absolute;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom) + 84px);display:flex;gap:10px}
.scn .scb button{flex:1;padding:14px;border-radius:12px;border:0;font:600 17px/1 inherit;font-family:inherit;background:rgba(255,255,255,.92);color:#111}
.scn .scf{position:absolute;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom) + 20px)}
.scn .scf input{width:100%;font-size:17px;padding:12px;border-radius:12px;border:0;background:rgba(22,27,34,.92);color:#fff}.scn .scf input.hl{outline:3px solid #d29922;background:rgba(22,27,34,.97)}`;

function shell(title, body, back = null, extra = '') {
  const bk = back ? `<a class="bk" href="${E(back[1])}">‹ ${E(back[0])}</a>` : '<span class="bdg" onclick="hwtSplash()" title="About" style="background:#7a1f2b;color:#fff;width:30px;height:24px;line-height:24px;font-size:12px;cursor:pointer">HW</span>';
  const pb = PRACTICE() ? '<div class="pb">PRACTICE COPY — safe to try anything · <a href="/practice/off?next=/m">real records</a></div>' : READONLY() ? '<div class="pb" style="background:#161b22;color:#8b949e">Real records · read-only · <a href="/practice/on?next=/m" style="color:#58a6ff">switch to practice copy</a></div>' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black"><meta name="apple-mobile-web-app-title" content="HW Tracker"><meta name="theme-color" content="#010409">
<title>${E(title)} · HW Tracker</title><style>${CSS}</style></head><body>
<div class="mt">${bk}<h1>${E(title)}</h1><a class="x fa" href="/view/full" onclick="this.href='/view/full?from='+encodeURIComponent(location.pathname+location.search)" title="Switch to the full app — this device will open in it until you switch back">Full app ›</a></div>${pb}<div class="w">${body}</div>${extra}${HELPG}${TABLESORT}${UNITS}${DICTATE}${splash(VERSION, ctx.backup)}</body></html>`;
}

const RO_MSG = next => `<div class="rb">These are the real records — read-only until we switch over from Vintrace. <a href="/practice/on?next=${encodeURIComponent(next)}">Use the practice copy</a> to record.</div>`;

function vol(l) {
  return `${num(l, 0)} L · ${num(l / GAL, 0)} gal`;
}

function tile(v, lab, d, unit_f = false) {
  if (!v) return `<div class="tl e"><i>${E(lab)}</i><b>–</b><small>&nbsp;</small></div>`;
  const shown = unit_f ? `${num(v[0], d)}°` : num(v[0], d);
  const f = unit_f ? `<small> / ${num(v[0] * 9 / 5 + 32, 0)}°F</small>` : '';
  return `<div class="tl"><i>${E(lab)}</i><b>${shown}${f}</b><small>${E(hw_ui.ago(v[1]))}</small></div>`;
}

// batch_id -> {start, stop} of alcoholic fermentation (from Vintrace's Start/Stop ferment ops and Start Ferment additions)
function ferment_dates(c) {
  const m = new Map();
  for (const r of c.all(`SELECT COALESCE(ov.batch_after_id, ov.batch_id) b,
        MAX(CASE WHEN o.op_type='Stop ferment' THEN o.occurred_at END) sp,
        MAX(CASE WHEN o.op_type='Start ferment' OR o.treatment LIKE 'Start Ferment (ALC)%' THEN o.occurred_at END) st
      FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
      WHERE o.reversed=0 AND (o.op_type IN ('Start ferment','Stop ferment') OR o.treatment LIKE 'Start Ferment (ALC)%') GROUP BY 1`))
    m.set(r.b, { start: r.st, stop: r.sp });
  return m;
}

function is_fermenting(fd, labs, x, stg) {
  // v1.21.5: the batch stage decides when one is set (yeast added → Fermenting; Élevage or Ready = ferment over).
  const s = stg && stg.get(x.batch_id);
  if (x.batch_id && s && s.stage) return s.stage === 'fermenting';
  // active = a gravity reading (or a ferment start) in the last 3 weeks, with no Stop ferment after it.
  // Vintrace history rarely has Stop ferment ops, so an old start on its own does not count.
  if (x.tax_state === 'BONDED' || !x.batch_id) return false;
  const f = fd.get(x.batch_id) || {}, cut = addDays(today(), -21);
  const bx = labs.get(`${x.batch_id}|Brix`), sg = labs.get(`${x.batch_id}|SG`);
  const g = [bx, sg].filter(v => v).map(v => v[1]).sort().pop();
  const last = [g, f.start].filter(v => v).sort().pop();
  return !!(last && last.slice(0, 10) >= cut && (!f.stop || f.stop < last));
}

// occupied vessels in phone order: fermenting first (newest reading first), then the rest by batch code
function cellar(c) {
  const cont = entry.current_contents(c);
  const labs = latest_labs(c, TILES.map(t => t[0]));
  const fd = ferment_dates(c);
  const stg = stage.current_map(c);
  for (const x of cont) x.ferm = is_fermenting(fd, labs, x, stg);
  const key = x => {
    const g = labs.get(`${x.batch_id}|Brix`) || labs.get(`${x.batch_id}|SG`);
    return g ? g[1] : '';
  };
  const f = cont.filter(x => x.ferm).sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
  return { list: [...f, ...cont.filter(x => !x.ferm)], labs, fd };
}

// ---- v1.1 phone home (modelled on the Vintrace app): search + Scan, the 3 most recently active wines, fermenting, all vessels
const norm = t => String(t ?? '').toUpperCase().replace(/[\s\-_./]/g, '');

// the 3 wines (batches now in a vessel) with the newest operation; each links to its vessel with the latest activity
function recent3(c, list) {
  const last = new Map();
  for (const r of c.all(`SELECT ov.vessel_id v, MAX(o.occurred_at) t FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
                          WHERE o.reversed=0 AND o.occurred_at<=? GROUP BY ov.vessel_id`, nowIso())) last.set(r.v, r.t);
  const by = new Map();
  for (const x of list) {
    if (!x.batch_id) continue;
    const t = last.get(x.vessel_id) || '';
    const g = by.get(x.batch_id) || { x, t: '', n: 0, l: 0 };
    g.n++; g.l += x.volume_l || 0;
    if (t > g.t) { g.t = t; g.x = x; }
    by.set(x.batch_id, g);
  }
  return [...by.values()].filter(g => g.t).sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 3).map(g => {
    const op = c.one(`SELECT o.op_type, o.treatment FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
                      WHERE ov.vessel_id=? AND o.reversed=0 AND o.occurred_at=? ORDER BY o.id DESC LIMIT 1`, g.x.vessel_id, g.t);
    return { ...g, op: op ? (op.treatment || op.op_type) : '' };
  });
}

export function home(c, q) {
  const { list, labs } = cellar(c);
  const grav = x => {
    const bx = labs.get(`${x.batch_id}|Brix`), sg = labs.get(`${x.batch_id}|SG`);
    return bx && (!sg || bx[1] >= sg[1]) ? [num(bx[0], 1) + '°Bx', bx[1]] : sg ? [num(sg[0], 3) + ' SG', sg[1]] : null;
  };
  const row = x => {
    const g = grav(x), so = labs.get(`${x.batch_id}|Free SO2`);
    const v = x.ferm && g ? `${g[0]}<small>${E(hw_ui.ago(g[1]))}</small>` : so ? `${num(so[0], 0)} FSO₂<small>${E(hw_ui.ago(so[1]))}</small>` : '';
    const s = `${x.batch || ''} ${x.description || ''} ${x.vessel} ${norm(x.batch)} ${norm(x.vessel)}`.toLowerCase();
    return `<a class="r${x.ferm ? ' f' : ''}" href="/m/v/${x.vessel_id}" data-s="${E(s)}">${bdg(c, x.batch_id)}<div class="m"><b>${E(x.batch || '(no batch)')}</b> <span class="muted">· ${E(x.vessel)}</span>
<div class="d">${x.description ? E(x.description) + ' · ' : ''}${vol(x.volume_l)}</div></div><div class="v">${v}</div></a>`;
  };
  const rc = recent3(c, list).map(r => {
    const x = r.x, g = grav(x);
    return `<a class="rc" href="/m/v/${x.vessel_id}">${bdg(c, x.batch_id, true)}<div class="m"><b>${E(x.batch)}</b>
<div class="d">${E(x.description || '')}</div>
<div class="d">${E(x.vessel)}${r.n > 1 ? ` +${r.n - 1} more` : ''} · ${vol(r.l)}${x.ferm && g ? ` · <span style="color:var(--amber)">${E(g[0])}</span>` : ''}</div>
<div class="la">${E(r.op)} · ${E(hw_ui.ago(r.t))}</div></div><span class="ch">›</span></a>`;
  }).join('');
  const f = list.filter(x => x.ferm);
  const saved = q.saved ? '<div class="ok">Saved. That was the last fermenting vessel.</div>' : '';
  const body = `${saved}<form class="sbar" action="/m/scan" onsubmit="return hwtGo(this)"><input type="hidden" name="typed" value="1">
<input class="srch" name="code" type="search" autocomplete="off" autocapitalize="characters" placeholder="Search batch, vessel, wine" oninput="hwtFilter(this.value)">
<button type="button" class="sbtn" onclick="hwtScan()" aria-label="Scan a vessel barcode">${SCAN_ICON}<span>Scan</span></button></form>
<div style="margin:2px 2px 4px;font-size:15px"><a href="/record/dispatch">＋ New dispatch</a></div>
<div id="res" hidden><h2>Matches</h2><div id="resl"></div><p class="muted" style="font-size:13px;margin:4px 2px">Press Go / Search to open the best match or search everything.</p></div>
<div id="hm"><h2>Recently active</h2>${rc || '<p class="muted" style="font-size:14px">No recent activity.</p>'}
<h2>Fermenting · ${f.length}</h2>${f.length ? f.map(row).join('') : '<p class="muted" style="font-size:14px;margin:0 2px">None right now. A wine joins this list when its yeast addition is recorded, or when you set its stage to Fermenting (wild ferments); setting Élevage takes it off.</p>'}
<details class="all"><summary>All tanks &amp; barrels · ${list.length}</summary>${list.map(row).join('')}</details>
<div class="lk"><a href="/view/full">Full app</a><a href="/notes">Notes</a><a href="/lab">Lab</a></div></div>
<script>(function(){var tm=null,seq=0,last='';window.hwtFilter=function(v){var t=v.trim(),res=document.getElementById('res'),l=document.getElementById('resl');
document.getElementById('hm').hidden=!!t;res.hidden=!t;if(!t){last='';clearTimeout(tm);seq++;l.dataset.q='';return}if(t===last)return;last=t;clearTimeout(tm);
tm=setTimeout(function(){var my=++seq;fetch('/m/qs?q='+encodeURIComponent(t),{credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(h){if(my!==seq)return;l.innerHTML=h;
var k=l.querySelectorAll('.r').length;l.dataset.q=t;res.querySelector('h2').textContent=k?'Matches · '+k:'No matches'}).catch(function(){if(my===seq)res.querySelector('h2').textContent='Search failed — check the connection'})},180)};
window.hwtGo=function(f){var t=f.querySelector('[name=code]').value.trim(),l=document.getElementById('resl'),a=l.querySelector('a.r');if(!t)return false;if(a&&l.dataset.q===t){location.href=a.href;return false}return true}})()</script>`;
  return shell('HW Tracker', body, null, SCAN_UI('', vnames(c)) + `<button class="fab" onclick="hwtScan()" aria-label="Scan a vessel barcode">${SCAN_ICON}</button>`);
}

// ---- scanning: /m/scan?code=<text>  (from the camera, or typed=1 from the search box)
const SCAN_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>';

// which vessel (or batch) a scanned / typed text points to. Returns a link, or null.
export function resolve_code(c, raw, typed = false) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const cands = [text];
  if (/^[a-z]+:\/\//i.test(text) || text.includes('?') || text.includes('/')) {   // a URL or path: try its query values and path parts
    try {
      const u = new URL(text, 'https://x.invalid');
      for (const [, v] of u.searchParams) cands.push(v);
      cands.push(...u.pathname.split('/').filter(Boolean).reverse());
      if (u.hash) cands.push(u.hash.slice(1));
    } catch (e) { cands.push(...text.split(/[/?&=#]/).filter(Boolean).reverse()); }
  }
  const vessels = c.all('SELECT id, code, vt_id, is_virtual, active FROM vessel ORDER BY is_virtual, active DESC, id');
  const batches = c.all('SELECT id, code, vt_id FROM batch');
  const cont = entry.current_contents(c);
  const vhref = id => `/m/v/${id}`;
  const bhref = bid => {   // a batch: its fullest vessel, else its batch page
    const v = cont.filter(x => x.batch_id === bid).sort((a, b) => (b.volume_l || 0) - (a.volume_l || 0))[0];
    return v ? vhref(v.vessel_id) : `/batch/${bid}`;
  };
  for (const t of cands) {   // 1. vessel name (exact, then ignoring case and spaces; several → chooser)  2. batch code
    const hits = VU.find_vessels(c, t);
    if (hits.length === 1) return VU.vhref(hits[0].code);
    if (hits.length > 1) return '/v/' + encodeURIComponent(VU.sticker_text(t));
    const b = batches.find(x => x.code === t) || batches.find(x => norm(x.code) === norm(t));
    if (b) return bhref(b.id);
    const al = c.all('SELECT batch_id, code FROM batch_alias ORDER BY id DESC').find(x => norm(x.code) === norm(t));   // a renamed batch's old name
    if (al) return bhref(al.batch_id);
  }
  if (!typed) for (const t of cands) {   // 3. digits only: a Vintrace vessel id (the stickers hold names, so letters+digits like "B95" are never read as an id)
    const m = String(t).trim().match(/^0*(\d{1,7})$/);
    if (!m) continue;
    const n = Number(m[1]);
    const v = vessels.find(x => x.vt_id === n);
    if (v) return vhref(v.id);
  }
  return null;
}

// remembers the last 25 scans (text and result) so an unknown label format can be checked later
function log_scan(c, raw, hit) {
  try {
    let a = [];
    try { a = JSON.parse(c.val("SELECT value FROM app_meta WHERE key='scan_log'") || '[]'); } catch (e) { a = []; }
    a.unshift({ at: nowIso(), raw: String(raw).slice(0, 300), hit: hit || null });
    c.run("INSERT INTO app_meta(key, value) VALUES('scan_log', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(a.slice(0, 25)));
  } catch (e) { /* never block a scan on the log */ }
}

export function scan(c, q) {
  const raw = (q.code || [''])[0], typed = !!q.typed;
  const hit = resolve_code(c, raw, typed);
  if (!typed) log_scan(c, raw, hit);
  if (hit) return { redirect: hit };
  if (typed) return { redirect: '/search?q=' + encodeURIComponent(raw) };
  const body = VU.unknown_body(raw, ctx.token, READONLY()) + `<button class="go" onclick="hwtScan()">${SCAN_ICON} Scan again</button><style>${VU.DETAILS_CSS}</style>`;
  return { html: shell('Unknown vessel', body, ['Cellar', '/m'], SCAN_UI(raw, vnames(c))) };
}

// full-screen camera view. The decoder (zxing, ~100 KB zipped) loads only when Scan is pressed.
const vnames = c => c.col('SELECT code FROM vessel WHERE is_virtual=0 AND active=1 ORDER BY code');
export const SCAN_UI = (raw = '', names = []) => `<div id="scn" class="scn" hidden><video id="scv" playsinline muted autoplay></video><div class="aim"><i></i></div>
<p class="sch" id="scm">Starting the camera…</p>
<div class="scb"><button type="button" id="sct" hidden>Light</button><button type="button" id="scx">Cancel</button></div>
<form class="scf" action="/m/scan"><input type="hidden" name="typed" value="1"><input name="code" id="scq" placeholder="…or type the vessel name (e.g. B32)" autocapitalize="characters" autocomplete="off" list="scvl"><datalist id="scvl">${names.map(n => `<option value="${E(n)}">`).join('')}</datalist></form></div>
<script>(function(){var o=document.getElementById('scn'),v=document.getElementById('scv'),m=document.getElementById('scm'),cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true}),fr=0,t0=0,hinted=false,st=null,run=false,rd=null,tk=null,lit=false;
function load(){return window.jsQR?Promise.resolve():new Promise(function(ok,no){var s=document.createElement('script');s.src='/m/jsqr.js?v=${JSQR_VER}';s.onload=ok;s.onerror=function(){no(new Error('The scanner did not load — check the connection.'))};document.head.appendChild(s)})}
function stop(){run=false;if(st)st.getTracks().forEach(function(t){t.stop()});st=null;v.srcObject=null}
function close(){stop();o.hidden=true}
function done(t){run=false;try{navigator.vibrate&&navigator.vibrate(60)}catch(e){}m.textContent='Found: '+t;stop();location.href='/m/scan?code='+encodeURIComponent(t)}
function tick(){if(!run)return;try{if(v.readyState>=2&&v.videoWidth){var w=v.videoWidth,h=v.videoHeight,f=fr%3,c=[1,0.6,0.4][f],sw=Math.round(w*c),sh=Math.round(h*c),sx=Math.round((w-sw)/2),sy=Math.round((h-sh)/2);fr++;
var k=Math.min(1,960/Math.max(sw,sh));cv.width=Math.round(sw*k);cv.height=Math.round(sh*k);cx.drawImage(v,sx,sy,sw,sh,0,0,cv.width,cv.height);
var id=cx.getImageData(0,0,cv.width,cv.height),r=jsQR(id.data,cv.width,cv.height,{inversionAttempts:fr%6===0?'attemptBoth':'dontInvert'});if(r&&r.data&&r.data.trim()){done(r.data.trim());return}
if(!hinted&&Date.now()-t0>3500){hinted=true;m.textContent='Still looking… press a creased sticker flat with your fingers, hold the phone a little further back, tilt it slightly — or type the name below.';document.getElementById('scq').classList.add('hl')}}}catch(e){}setTimeout(tick,60)}
window.hwtScan=function(){o.hidden=false;m.textContent='Starting the camera…';
if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){m.textContent='This browser can’t use the camera here. Type the code below.';return}
load().then(function(){
return navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}})})
.then(function(s){st=s;v.srcObject=s;return v.play()}).then(function(){if(o.hidden){stop();return}run=true;m.textContent='Point at the label on the tank or barrel';
tk=st.getVideoTracks()[0];var cp=tk.getCapabilities?tk.getCapabilities():{};if(cp.focusMode&&cp.focusMode.indexOf('continuous')>=0)tk.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(function(){});t0=Date.now();hinted=false;document.getElementById('sct').hidden=!cp.torch;tick()})
.catch(function(e){stop();m.textContent=(e&&e.name==='NotAllowedError')?'Camera access was blocked. Allow the camera for this site (iPhone: Settings › Safari › Camera), or type the code below.':((e&&e.message)||'The camera could not start')+' — type the code below.'})};
document.getElementById('scx').onclick=close;
document.getElementById('sct').onclick=function(){lit=!lit;tk&&tk.applyConstraints({advanced:[{torch:lit}]}).catch(function(){})};
document.addEventListener('visibilitychange',function(){if(document.hidden&&!o.hidden)close()});
window.addEventListener('pageshow',function(e){if(e.persisted)close()})})()</script>`;

function recent_ops(c, vid) {
  return c.all(`SELECT o.id, o.occurred_at, o.op_type, o.treatment FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
                WHERE ov.vessel_id=? AND o.reversed=0 ORDER BY o.occurred_at DESC, o.id DESC LIMIT 6`, vid);
}

export function card(c, vid, q, via = null) {
  const { list, labs, fd } = cellar(c);
  const x = list.find(r => r.vessel_id === vid);
  if (!x && !via) {   // an empty barrel that belongs to a barrel group holding wine: show the group's wine
    const g = VU.group_of(c, vid);
    if (g && list.some(r => r.vessel_id === g.id)) return card(c, g.id, q, { id: vid, code: c.val('SELECT code FROM vessel WHERE id=?', vid), g });
  }
  if (!x) {
    const v = c.one('SELECT id, code, kind, capacity_l FROM vessel WHERE id=?', vid);
    if (!v) return null;
    if (v.kind === 'barrel_group') {   // v1.26 a barrel group is a label over real barrels: show them
      const ms = VU.members(c, vid), rows = ms.map(m => list.find(r => r.vessel_id === m.id) || { vessel_id: m.id, vessel: m.code, volume_l: 0, capacity_l: m.capacity_l, batch: '' });
      const tot = rows.reduce((t, r) => t + (r.volume_l || 0), 0), bs = [...new Set(rows.map(r => r.batch).filter(Boolean))];
      const bg = `${q.saved ? '<div class="ok">Saved.</div>' : ''}<div class="hd"><div><b>${E(v.code)}</b> <span class="tag">barrel group</span><div class="d">${ms.length} barrels${bs.length ? ' · ' + bs.map(E).join(', ') : ''} · ${num(tot, 0)} L</div></div></div>
<div class="card ops">${rows.map(r => `<div><a href="/m/v/${r.vessel_id}">${E(r.vessel)}</a><span>${r.batch ? E(r.batch) + ' · ' : ''}${num(r.volume_l || 0, 0)}${r.capacity_l ? ' / ' + num(r.capacity_l, 0) : ''} L</span></div>`).join('') || '<span class="muted">No barrels set</span>'}</div>
${tot > 0 ? `<div class="qk"><a href="/record/addition?vessel_id=g${vid}&amp;_next=/m/v/${vid}"><span>🧪</span>Addition (split)</a><a href="/record/measure?vessel_id=g${vid}&amp;_next=/m/v/${vid}"><span>⚖</span>Adjust volume (split)</a><a href="/labels/print?ids=${ms.map(m => m.id).join(',')}"><span>🏷</span>Labels</a></div>` : ''}
${VU.group_block(c, vid, ctx.token, `/m/v/${vid}`)}<div class="lk"><a href="/labels/print?ids=${ms.map(m => m.id).join(',')}">🏷 Print the barrel labels</a></div><style>${VU.DETAILS_CSS}</style>`;
      return shell(v.code, bg, ['Cellar', '/m']);
    }
    const ops0 = recent_ops(c, vid).map(o => `<div><a href="/op/${o.id}">${E(o.treatment || o.op_type)}</a><span>${E(strftime(naiveMs(String(o.occurred_at).slice(0, 16)), '%d %b %H:%M'))}</span></div>`).join('');
    const msg0 = q.added ? '<div class="ok">Vessel added.</div>' : q.saved ? '<div class="ok">Saved.</div>' : '';
    const b0 = `${msg0}<div class="hd"><div><b>${E(v.code)}</b> <span class="tag">Empty</span><div class="d">${E(v.kind || '')}</div></div></div>
<div class="muted" style="font-size:14px">Capacity <b style="color:var(--fg2)">${num(v.capacity_l || 0, 0)} L</b></div>
${VU.details(c, v, ctx.token, `/m/v/${vid}`)}<h2>Recent in this vessel</h2><div class="card ops">${ops0 || '<span class="muted">Nothing yet</span>'}</div>
<div class="lk"><a href="/labels/print?ids=${vid}">🏷 Print label</a><a href="/vessel/${vid}">Vessel page</a></div><style>${VU.DETAILS_CSS}</style>`;
    return shell(v.code, b0, ['Cellar', '/m']);
  }
  const bid = x.batch_id;
  const L = k => labs.get(`${bid}|${k}`);
  const tiles = TILES.map(([k, lab, d]) => tile(L(k), lab, d, k === 'TempC')).join('');
  const f = fd.get(bid) || {};
  let fs = '';
  if (x.tax_state === 'BONDED') fs = `<span class="tag b">declared · ${E(x.tax_class || '')}</span>`;
  // fermentation curve: since start of ferment (or the last 60 days)
  const from = f.start && (!f.stop || f.stop < f.start) ? f.start : addDays(today(), -60);
  const ser = {};
  for (const m of ['Brix', 'SG']) {
    const pts = c.all(`SELECT o.occurred_at t, a.value v FROM op_analysis a JOIN operation o ON o.id=a.op_id
                       WHERE a.batch_id=? AND a.metric=? AND o.reversed=0 AND a.value IS NOT NULL AND o.occurred_at>=? ORDER BY o.occurred_at`, bid, m, from);
    if (pts.length) ser[m] = pts.map(p => [p.t, p.v]);
  }
  const curve = Object.keys(ser).length ? `<div class="card">${line_chart(ser.Brix && ser.SG ? (ser.SG.length > ser.Brix.length ? { SG: ser.SG } : { Brix: ser.Brix }) : ser, 640, 260)}</div>` : '';
  const ns = notes.for_batch(c, bid).slice(0, 3).map(n => hw_ui.note_card(n, bid)).join('');
  const ops = recent_ops(c, vid).map(o => `<div><a href="/op/${o.id}">${E(o.treatment || o.op_type)}</a><span>${E(strftime(naiveMs(String(o.occurred_at).slice(0, 16)), '%d %b %H:%M'))}</span></div>`).join('');
  const msg = (q.added ? '<div class="ok">Vessel added.</div>' : q.saved ? '<div class="ok">Saved.</div>' : '') + (q.moved ? `<div class="ok">Moved from another group: ${E(q.moved[0])}.</div>` : '') +
    (via ? `<div class="ok" style="border-color:var(--acc)">You scanned <b>${E(via.code)}</b> — one of ${via.g.members.length} barrels in <b>${E(via.g.code)}</b>: ${via.g.members.map(m => m.code === via.code ? `<b>${E(m.code)}</b>` : E(m.code)).join(' · ')}. Entries here go on the whole group.</div>` : '');
  const isGroup = c.val('SELECT kind FROM vessel WHERE id=?', vid) === 'barrel_group';
  const myG = !isGroup && !via ? VU.group_of(c, vid) : null;
  const stg = (() => { const r = stage.current(c, bid); return r && r.stage ? stage.CSS + ' ' + stage.pill(r.stage) : ''; })();
  const body = `${msg}<div class="hd">${bdg(c, bid, true)}<div><b>${E(x.batch)}</b>${stg}<div class="d">${E(x.description || '')}</div></div></div>
<div class="muted" style="font-size:14px">${E(x.vessel)} · ${E(x.kind || '')} · <b style="color:var(--fg2)">${vol(x.volume_l)}</b>${x.capacity_l ? ` of ${num(x.capacity_l, 0)} L` : ''}</div>${(() => { const T = batch_target(c, bid); return T ? `<div class="muted" style="font-size:14px">Formulation target <b style="color:var(--fg2)">${num(T.target_l, 0)} L</b> · water in ${num(T.water_in, 1)} of ${num(T.water_l, 1)} L${T.sw === 'none' ? '' : ` · ${T.sw} ${num(T.sweet_in, 1)} of ${num(T.sweet_lb, 1)} lb`}</div>` : ''; })()}
${stage.bar(c, bid, ctx.token, `/m/v/${vid}`, true)}<div class="qk"><a href="/m/check?v=${vid}"><span>🌡</span>Brix · temp</a><a href="/m/check?v=${vid}&amp;cap=1"><span>✊</span>Punch down / pump over</a><a href="/record/addition?vessel_id=${vid}&amp;_next=/m/v/${vid}"><span>🧪</span>Addition</a><a href="/record/press?from_id=${vid}&amp;_next=/m/v/${vid}"><span>🍇</span>Press</a><a href="/record/transfer?from_id=${vid}&amp;op_type=Racking&amp;_next=/m/v/${vid}"><span>↪</span>Rack</a><a href="/record/lab?batch=${bid}&amp;_next=/m/v/${vid}"><span>🔬</span>Lab</a></div>${fs ? `<div style="margin-top:8px">${fs}</div>` : ''}<div class="tiles">${tiles}</div>${curve}
${recent_steps(c, bid)}${ns ? `<h2>Latest notes</h2>${ns}` : ''}<details><summary class="muted" style="padding:10px 0;font-size:14px">Everything recorded in this vessel (incl. readings)</summary><div class="card ops">${ops || '<span class="muted">Nothing yet</span>'}</div></details>
${myG ? `<div class="ok" style="border-color:var(--acc)">In barrel group <a href="/m/v/${myG.id}"><b>${E(myG.code)}</b></a>: ${myG.members.map(m => m.id === vid ? `<b>${E(m.code)}</b>` : `<a href="/m/v/${m.id}">${E(m.code)}</a>`).join(' · ')}</div>` : ''}${isGroup ? VU.towine_form(c, vid, ctx.token) + VU.group_block(c, vid, ctx.token, `/m/v/${vid}`) : VU.details(c, { id: vid, code: x.vessel, kind: x.kind }, ctx.token, `/m/v/${vid}`, x.batch)}
<div class="lk"><a href="/batch/${bid}">Batch ${E(x.batch)}</a><a href="/labels/print?ids=${via ? via.id : vid}">🏷 Print label${via ? ' ' + E(via.code) : ''}</a><a href="/vessel/${vid}">Vessel page</a></div><style>${VU.DETAILS_CSS}</style>`;
  const A = (ic, t, h) => `<a href="${E(h)}"><span>${ic}</span>${E(t)}</a>`;
  const sheet = `<button class="go" onclick="document.getElementById('sh').classList.add('on')">＋ Actions</button>
<div class="sh" id="sh" onclick="if(event.target===this)this.classList.remove('on')"><div class="p">
${A('🌡', 'Ferment check', `/m/check?v=${vid}`)}${A('🧪', 'Addition', `/record/addition?vessel_id=${vid}&_next=/m/v/${vid}`)}${A('📝', 'Note', `/record/note?batch=${bid}&vessel=${vid}&_next=/m/v/${vid}`)}
${A('⚖', 'Adjust volume', `/record/measure?vessel_id=${vid}&_next=/m/v/${vid}`)}${A('📦', 'Packaging', `/record/bottling?vessel_id=${vid}&batch=${bid}&_next=/m/v/${vid}`)}${A('🍇', 'Press', `/record/press?from_id=${vid}&_next=/m/v/${vid}`)}${A('↪', 'Transfer / rack', `/record/transfer?from_id=${vid}&_next=/m/v/${vid}`)}${A('🔬', 'Lab results', `/record/lab?batch=${bid}&_next=/m/v/${vid}`)}
<a class="cx" href="#" onclick="document.getElementById('sh').classList.remove('on');return false">Cancel</a></div></div>`;
  return shell(`${x.batch} · ${x.vessel}`, body, ['Cellar', '/m'], sheet);
}

export function check_form(c, vid, f = {}, err = '') {
  const { list, labs } = cellar(c);
  const x = list.find(r => r.vessel_id === vid);
  if (!x) return shell('Ferment check', '<p class="muted">That vessel is empty.</p>', ['Cellar', '/m']);
  const bid = x.batch_id, G = k => (f[k] !== undefined ? f[k] : '');
  const last = (k, d) => {
    const v = labs.get(`${bid}|${k}`);
    return v ? `${num(v[0], d)}${k === 'TempC' ? '°C' : ''}<br>${E(hw_ui.ago(v[1]))}` : '';
  };
  const fld = (k, lab, d, ph) => `<div class="fl"><label>${lab}</label><input name="r_${k}" inputmode="decimal" autocomplete="off" placeholder="${ph}" value="${E(G('r_' + k))}"><span class="last">${last(k, d)}</span></div>`;
  const saved = f._saved ? `<div class="ok">Saved ${E(f._saved)}. Next fermenting vessel:</div>` : '';
  const ro = READONLY() ? RO_MSG(`/m/check?v=${vid}`) : '';
  const capOpts = [...CAP, ...entry.TREATMENTS.filter(t => !CAP.includes(t))].map(t => `<option ${G('treatment') === t ? 'selected' : ''}>${E(t)}</option>`).join('');
  const sw = (name, lab, on, target) => `<label class="sw">${lab}<input type="checkbox" name="${name}" value="1" ${on ? 'checked' : ''}${target ? ` onchange="document.getElementById('${target}').classList.toggle('hid',!this.checked)"` : ''}></label>`;
  const labOn = f.when === undefined || !!G('lab');
  const capOn = !!G('cap');
  const body = `${saved}${ro}${err}<div class="hd">${bdg(c, bid, true)}<div><b>${E(x.batch)} · ${E(x.vessel)}</b><div class="d">${E(x.description || '')} · ${vol(x.volume_l)}</div></div></div>
<form method="post" action="/m/check"><input type="hidden" name="_t" value="${E(ctx.token)}"><input type="hidden" name="v" value="${vid}">
<div class="sec">${sw('lab', 'Lab analysis', labOn, 'labf')}<div id="labf" class="${labOn ? '' : 'hid'}">
${fld('Brix', 'Brix', 1, '°Bx')}${fld('SG', 'SG', 3, '1.0xx')}
<div class="fl"><label>Temp</label><input name="r_TempC" inputmode="decimal" autocomplete="off" value="${E(G('r_TempC'))}"><span class="seg"><label><input type="radio" name="temp_unit" value="C" ${G('temp_unit') !== 'F' ? 'checked' : ''}>°C</label><label><input type="radio" name="temp_unit" value="F" ${G('temp_unit') === 'F' ? 'checked' : ''}>°F</label></span><span class="last">${last('TempC', 1)}</span></div>
<details ${G('r_pH') || G('r_Free SO2') ? 'open' : ''}><summary class="muted" style="padding:10px 0;font-size:14px">More readings (pH, SO₂)</summary>${fld('pH', 'pH', 2, '')}${fld('Free SO2', 'Free SO₂', 0, 'mg/L')}</details></div></div>
<div class="sec">${sw('cap', 'Cap management', capOn, 'capf')}<div id="capf" class="${capOn ? '' : 'hid'}">
<div class="fl"><label>Activity</label><select name="treatment">${capOpts}</select></div><div class="fl"><label>Duration</label><input name="duration" inputmode="numeric" placeholder="min" value="${E(G('duration'))}"></div></div></div>
<div class="sec"><div class="muted" style="font-size:13px;margin-top:8px">When (defaults to now)</div><input class="blk" type="datetime-local" name="when" value="${E(G('when') || nowIso().slice(0, 16))}">
<textarea class="blk" name="note" rows="2" placeholder="Note (optional) — smell, cap, foam, nutrients…">${E(G('note'))}</textarea></div>
<button class="go" type="submit" ${READONLY() ? 'disabled style="opacity:.4"' : ''}>Submit</button></form>
${recent_steps(c, bid)}
<script>try{var u=localStorage.getItem('hwt_tu2');if(u&&!${JSON.stringify(!!G('temp_unit'))})document.querySelector('[name=temp_unit][value='+u+']').checked=true;document.querySelectorAll('[name=temp_unit]').forEach(function(e){e.onchange=function(){localStorage.setItem('hwt_tu2',e.value)}})}catch(e){}</script>`;
  return shell('Ferment check', body, [x.batch, `/m/v/${vid}`]);
}

// POST /m/check -> [redirect url, null] or [null, error]
export function post_check(c, f) {
  const g = k => (f[k] && f[k].length ? f[k][0] : '');
  const vid = parseInt(g('v'), 10);
  try {
    const ferm = cellar(c).list.filter(r => r.ferm);   // order before saving (a stop flag takes this vessel out of the list)
    const st = ferm.find(r => r.vessel_id === vid) || entry.current_contents(c).find(r => r.vessel_id === vid);
    if (!st) throw new entry.EntryError('That vessel is empty.');
    const when = entry._when(g('when'));
    entry._check_date(c, when);
    let did = [];
    if (g('lab')) {
      const r = new Map();
      for (const m of ['Brix', 'SG', 'TempC', 'pH', 'Free SO2']) if (g('r_' + m).trim()) r.set(m, g('r_' + m).trim());
      if (r.size) { entry.record_analysis(c, when, new Map([[vid, r]]), null, g('temp_unit') === 'F' ? 'F' : 'C'); did.push('readings'); }
    }
    if (g('cap') && g('treatment')) {
      const d = g('duration').trim();
      entry.record_treatment(c, when, g('treatment'), [vid], d ? `${d} min` : null);
      did.push(g('treatment').toLowerCase());
    }
    if (g('started') && g('stopped')) throw new entry.EntryError('Pick started or stopped, not both.');
    if (g('started')) {
      const op = entry._new_op(c, when, 'Start ferment', 'StartFerment');
      const s0 = entry._state_at(c, vid, when);
      if (!s0) throw new entry.EntryError('The vessel is empty at that time.');
      entry._vessel_row(c, op, vid, 'to', s0, s0.volume_l);
      entry._finish(c, op);
      did.push('ferment started');
    }
    if (g('stopped')) {
      const op = entry._new_op(c, when, 'Stop ferment', 'StopFerment');
      const s = entry._state_at(c, vid, when);
      if (!s) throw new entry.EntryError('The vessel is empty at that time.');
      entry._vessel_row(c, op, vid, 'to', s, s.volume_l);
      entry._finish(c, op);
      did.push('ferment stopped');
    }
    if (g('note').trim()) {
      notes.add_note(c, when.slice(0, 16).replace(' ', 'T'), st.batch_id, vid, g('note'));
      did.push('note');
    }
    if (!did.length) throw new entry.EntryError('Nothing to save — enter a reading, cap management, start/stop or a note.');
    const i = ferm.findIndex(r => r.vessel_id === vid);
    const what = encodeURIComponent(`${st.batch} (${did.join(', ')})`);
    if (i < 0) return [`/m/v/${vid}?saved=1`, null];
    return [`/m/v/${vid}?saved=1`, null];   // v1.28.1: stay on the same wine (was: jump to the next fermenting vessel)
  } catch (e) {
    if (e instanceof entry.EntryError) return [null, e.message];
    return [null, `Not saved: ${e && e.message ? e.message : String(e)}`];
  }
}

export { RO_MSG, shell };

// /v/<name>: the vessel a sticker names (the scanner lands here)
export function vpage(c, name, q) {
  const hits = VU.find_vessels(c, name);
  if (hits.length === 1) return card(c, hits[0].id, q).replace('</body>', () => `<script>if(window.matchMedia&&matchMedia('(min-width:1000px) and (hover:hover) and (pointer:fine)').matches)location.replace('/vessel/${hits[0].id}'+(location.search||''))</script></body>`);
  if (hits.length > 1) return shell(VU.sticker_text(name), VU.chooser_body(VU.sticker_text(name), hits), ['Cellar', '/m']);
  return shell('Unknown vessel', VU.unknown_body(name, ctx.token, READONLY()) + `<style>${VU.DETAILS_CSS}</style>`, ['Cellar', '/m']);
}

// v1.60: below the ferment check — the wine's recent steps, newest first: every addition (what, how much) and other operations
// with date and time; punch downs / pump overs summarised in one line so the additions stand out. Readings are in the fields above.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function stamp(t) {
  const d = new Date(naiveMs(String(t).slice(0, 19)));
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()} · ${String(t).slice(11, 16)}`;
}
function recent_steps(c, bid) {
  const since = addDays(today(), -30);
  const ops = c.all(`SELECT o.id, o.occurred_at t, o.op_type ty, o.treatment tr, o.notes FROM operation o WHERE o.reversed=0 AND o.occurred_at>=? AND o.id IN
                       (SELECT op_id FROM op_vessel WHERE batch_id=? OR batch_after_id=? UNION SELECT op_id FROM op_addition WHERE batch_id=?)
                     ORDER BY o.occurred_at DESC, o.id DESC`, since, bid, bid, bid);
  const adds = new Map();
  for (const a of c.all(`SELECT a.op_id, m.name, a.amount, a.unit FROM op_addition a JOIN material m ON m.id=a.material_id JOIN operation o ON o.id=a.op_id
                         WHERE a.batch_id=? AND o.reversed=0 AND o.occurred_at>=? ORDER BY a.id`, bid, since)) {
    if (!adds.has(a.op_id)) adds.set(a.op_id, []);
    adds.get(a.op_id).push(`${E(a.name)} <b>${num(a.amount, a.amount % 1 ? 1 : 0)} ${E(a.unit || '')}</b>`);
  }
  const cap = ops.filter(o => o.tr && /punch|pump/i.test(o.tr));
  const rows = ops.filter(o => !/^Analysis$|^Measurement$/i.test(o.ty) && !(o.tr && /punch|pump/i.test(o.tr))).slice(0, 25).map(o => {
    const a = adds.get(o.id);
    const what = a ? a.join('<br>') : E(o.tr || o.ty);
    return `<div class="rs"><span class="rt">${E(stamp(o.t))}<small>${E(hw_ui.ago(o.t))}</small></span><span class="rw">${what}${o.notes ? `<small>${E(String(o.notes).slice(0, 120))}</small>` : ''}</span></div>`;
  }).join('');
  const d3 = addDays(today(), -2), c3 = cap.filter(o => o.t.slice(0, 10) >= d3).length;
  const capLine = cap.length ? `<div class="rs rc"><span class="rt">${E(stamp(cap[0].t))}<small>${E(hw_ui.ago(cap[0].t))}</small></span><span class="rw">Last ${E(String(cap[0].tr).toLowerCase())}<small>${c3} punch downs / pump overs in the last 3 days</small></span></div>` : '';
  if (!rows && !capLine) return '';
  return `<div class="sec"><h2 style="font-size:16px;margin:14px 0 6px">Recent steps <span class="muted" style="font-size:12px;font-weight:400">last 30 days, newest first</span></h2>${capLine}${rows || '<p class="muted">No additions in the last 30 days.</p>'}</div>
<style>.rs{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}.rt{flex:0 0 112px;color:var(--fg2);font-size:13px}.rt small,.rw small{display:block;color:var(--mut);font-size:12px}.rw{flex:1}.rw b{color:var(--fg2)}.rc .rw{color:var(--mut)}</style>`;
}


// ---- v1.69 phone quick search: the desktop's ranked groups (search.js), shown as phone rows. /m/qs?q=… returns the rows (HTML)
// cellar wines and tanks open the vessel page; bottled stock and materials open the phone item page (/m/i/<id>)
const CASE = l => (l && l < 1.5 ? 12 : 1);   // bottles/cans per case (3 L and kegs: 1)
function stock_info(c, ids) {
  if (!ids.length) return new Map();
  return new Map(c.all(`SELECT s.id, s.litres_per_unit l, s.location, s.unit, s.is_finished, s.category, s.inactive,
                          (SELECT COALESCE(SUM(quantity),0) FROM stock_event e WHERE e.item_id=s.id) oh
                        FROM stock_item s WHERE s.id IN (${ids.map(() => '?').join(',')})`, ...ids).map(r => [r.id, r]));
}
const oh_txt = (oh, s) => {
  if (Math.abs(oh) < 1e-6) return '<span style="color:var(--red)">out</span>';
  if (oh < 0) return `<span style="color:var(--red)">${num(oh, oh % 1 ? 1 : 0)}</span><small>below zero</small>`;
  const n = num(oh, oh % 1 ? 1 : 0), fin = s && (s.is_finished || s.category === 'Bottled-Canned Wine');
  const cs = fin && s.l && CASE(s.l) > 1 && oh >= 12 ? `<small>${num(oh / 12, oh % 12 ? 1 : 0)} cs</small>` : `<small>${fin ? (s.l >= 19 ? 'kegs' : 'on hand') : E(s && s.unit && s.unit !== 'x1' ? s.unit : 'on hand')}</small>`;
  return n + cs;
};
export function quick(c, q) {
  const t = String((q.q || [''])[0] || '').trim();
  if (!t) return '';
  const rows = qsearch(c, t, 40);
  let cont = [];
  try { cont = entry.current_contents(c); } catch (e) { /* contents unavailable */ }
  const fullest = bid => (cont.filter(x => x.batch_id === bid).sort((a, b) => (b.volume_l || 0) - (a.volume_l || 0))[0] || {}).vessel_id;
  const info = stock_info(c, rows.filter(r => r.type === 'Stock').map(r => Number(String(r.href).split('/').pop())));
  let g = '';
  return rows.map(r => {
    let href = r.href, v = '', d = r.sub || '', lab = `<b>${E(r.label)}</b>`;
    if (r.type === 'Vessel') {
      const vid = Number(String(r.vhref || r.href).split('/').pop());
      href = `/m/v/${vid}`;
      if (r.wine) lab += ` <b style="color:#58a6ff">${E(r.wine)}</b>`;
    } else if (r.type === 'Batch') {
      const bid = Number(String(r.href).split('/').pop()), vid = r.grp === 'In the cellar now' ? fullest(bid) : null;
      if (vid) href = `/m/v/${vid}`;
      lab = `<b style="color:#58a6ff">${E(r.label)}</b>`;
      const vs = cont.filter(x => x.batch_id === bid && x.volume_l > 0.05).sort((p, q2) => (q2.volume_l || 0) - (p.volume_l || 0)).map(x => x.vessel);
      if (vs.length) lab = `<b>${E(vs.slice(0, 3).join(', '))}${vs.length > 3 ? ` +${vs.length - 3}` : ''}</b> ` + lab;
    } else if (r.type === 'Stock') {
      const id = Number(String(r.href).split('/').pop()), s = info.get(id);
      href = `/m/i/${id}`;
      if (s) {
        v = oh_txt(s.oh, s);
        d = [String(d).split(' · ').filter(x => !/ on hand$/.test(x)).join(' · '), s.location ? `📍 ${s.location}` : ''].filter(x => x).join(' · ');
      }
    }
    const h = r.grp && r.grp !== g ? `<h3 class="qg">${E(r.grp)}</h3>` : '';
    g = r.grp;
    return `${h}<a class="r" href="${E(href)}"><span class="bdg" style="background:${r.bg};color:${r.fg};width:30px;height:24px;line-height:24px;font-size:11px">${E(r.l)}</span><div class="m">${lab}
<div class="d">${E(d)}</div></div>${v ? `<div class="v">${v}</div>` : ''}</a>`;
  }).join('') + '<style>.qg{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);margin:14px 2px 6px}</style>';
}

// ---- v1.69 phone item page: a bottled/canned product or a material — on hand, format, location, recent movements
export function item(c, iid) {
  const it = c.one('SELECT * FROM stock_item WHERE id=?', iid);
  if (!it) return shell('Not found', '<p class="muted">No such stock item.</p>', ['Cellar', '/m']);
  const ev = c.all(`SELECT e.occurred_at t, e.action, e.quantity v, e.notes, d.dispatch_type ty, d.bol, d.id did
                    FROM stock_event e LEFT JOIN dispatch d ON d.id=e.dispatch_id WHERE e.item_id=? ORDER BY e.occurred_at DESC, e.id DESC`, iid);
  const oh = ev.reduce((s, e) => s + (e.v || 0), 0);
  const fin = !!(it.is_finished || it.category === 'Bottled-Canned Wine');
  const y0 = addDays(today(), -365);
  const out12 = 0 - ev.filter(e => e.t >= y0 && e.action === 'Dispatch').reduce((s, e) => s + e.v, 0);
  const unitW = fin ? (it.litres_per_unit >= 19 ? 'kegs' : 'bottles / cans') : (it.unit && it.unit !== 'x1' ? it.unit : 'each');
  const what = e => e.action === 'Dispatch' ? (e.ty || 'Dispatch') + (e.bol ? ` · BOL ${e.bol}` : '') : e.action === 'Package' ? (fin ? 'Bottled' : 'Used in bottling') : e.action === 'Receive' ? 'Received'
    : e.action === 'Adjustment' ? 'Count / adjustment' : e.action === 'Correction' ? 'Records correction' : e.action === 'Create' ? 'Opening stock' : e.action;
  const big = Math.abs(oh) < 1e-6 ? '<span style="color:var(--red)">out</span>' : oh < 0 ? `<span style="color:var(--red)">${num(oh, oh % 1 ? 2 : 0)}</span> <small style="font-size:14px;color:var(--red)">below zero — check the records</small>` : num(oh, oh % 1 ? 2 : 0);
  const cs = fin && it.litres_per_unit && CASE(it.litres_per_unit) > 1 && oh >= 12 ? ` · ${num(oh / 12, oh % 12 ? 1 : 0)} cases` : '';
  const gal = fin && it.litres_per_unit && oh > 0 ? ` · ${num(oh * it.litres_per_unit / GAL, 1)} gal` : '';
  const facts = [it.category || '', it.litres_per_unit ? pack_size(it.litres_per_unit) : '', it.location ? `📍 ${it.location}` : '', it.inactive ? 'retired' : ''].filter(x => x);
  const body = `<div class="hd"><div><b>${E(it.code)}</b><div class="d">${E(it.description || it.name || '')}</div></div></div>
<div class="card" style="padding:12px 14px"><div style="font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em">On hand</div>
<div style="font-size:30px;color:var(--fg2);font-weight:600">${big}</div><div class="muted" style="font-size:14px">${E(unitW)}${cs}${gal}</div>
<div class="muted" style="font-size:14px;margin-top:6px">${facts.map(E).join(' · ')}</div>
${fin ? `<div class="muted" style="font-size:14px;margin-top:6px">Out in the last 12 months: ${num(Math.max(0, out12), 0)}</div>` : ''}</div>
<h2>Recent movements</h2><div class="card ops">${ev.slice(0, 12).map(e => `<div><span>${E(String(e.t).slice(0, 10))} · ${E(what(e))}</span><span style="color:${e.v < 0 ? '#f0883e' : '#3fb950'}">${e.v > 0 ? '+' : ''}${num(e.v, e.v % 1 ? 2 : 0)}</span></div>`).join('') || '<span class="muted">Nothing yet</span>'}</div>
<div class="lk"><a href="/item/${iid}">Full item page</a><a href="/record/dispatch">＋ New dispatch</a></div>`;
  return shell(it.code, body, ['Cellar', '/m']);
}
