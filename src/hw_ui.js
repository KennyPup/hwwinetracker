// Port of hw_ui.py — HWWineTracker look (icon rail, quick search, breadcrumbs, tabs, badges, note cards).
import { E, fx, naiveMs, nowMs, strftime, today, pyRound } from './lib/py.js';
import { hw_ui as S } from './gen/strings.js';
import { CONVERTER } from './convert.js';

export const GAL = S.GAL;
export const KIND = S.KIND;
export const BEV_TO_KIND = S.BEV_TO_KIND;
const _NAV0 = [...S.NAV.slice(0, S.NAV.findIndex(n => n[0] === '/dispatches') + 1), ['/costs', 'Costs', 'cost'], ['/contacts', 'Contacts', 'people'],
  ...S.NAV.slice(S.NAV.findIndex(n => n[0] === '/dispatches') + 1)];
const _ri = _NAV0.findIndex(n => n[0] === '/reports') + 1;
// Lab, Notes and Operations are reached from each batch's tabs (History = every operation on that wine), not the rail.
// /ops still works (dashboard card "Operations, last 7 days"); intakes and stock counts show on Intakes and Materials.
export const NAV = [['/view/cellar', 'Cellar view', 'phone'], ..._NAV0.slice(0, _ri), ['/analytics', 'Analytics', 'chart'], ..._NAV0.slice(_ri)].filter(n => !['/lab', '/notes', '/ops', '/record'].includes(n[0])).concat([['/help', 'Help', 'help']]);
// v1.33: Record left the rail (entries start from the wine's ＋ Record menu); its page stays as "My entries" for crumbs and the dashboard link
export const SECTIONS = [...NAV.filter(n => n[0] !== '/view/cellar'), ['/record', 'My entries', 'record']];   // v1.31
// v1.75: desktop has no left rail — four drop-down menus sit in the breadcrumb row instead (the rail stays as the phone drawer).
// Every NAV entry must land in a menu or in the top bar (Cellar view, Help); anything not listed here goes into the last menu.
const _GROUPS = [['Cellar', ['/batches', '/vessels', '/']], ['Winemaking', ['/formulas', '/prototypes', '/additions', '/constants']],
  ['Inventory', ['/stock', '/materials', '/intakes', '/dispatches']], ['Business', ['/analytics', '/reports', '/costs', '/contacts']]];
const _TOPBAR = ['/view/cellar', '/help'];
export const MENUS = (() => {
  const by = new Map(NAV.map(n => [n[0], n])), used = new Set(_TOPBAR);
  const out = _GROUPS.map(([g, ps]) => [g, ps.filter(p => by.has(p)).map(p => { used.add(p); return by.get(p); })]);
  out[out.length - 1][1].push(...NAV.filter(n => !used.has(n[0])));
  return out;
})();
const _DESC = { '/batches': 'In-cellar wines, latest tended first', '/vessels': 'Tanks and barrels, QR labels', '/': 'Cellar totals, vessels in use, recent activity',
  '/formulas': 'Masters and this season\u2019s formulas', '/prototypes': 'Each key wine across all years', '/additions': 'Cookbook doses by batch size', '/constants': 'Rates and defaults behind every dose',
  '/stock': 'Bottled wine and packaging on hand, pace', '/materials': 'Additives, sugar and honey on hand', '/intakes': 'Fruit on hand, then deliveries', '/dispatches': 'Bills of lading by month and type',
  '/analytics': 'Fermentations, film yeast, reductones, sales', '/reports': 'TTB 5120.17, dispatched stock, backups', '/costs': 'Cost ledger and cost per bottle', '/contacts': 'Growers, suppliers and carriers' };
const _isOn = (p, path) => (p === '/' && path === '/') || (p !== '/' && path.startsWith(p));
const _CHEV = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
function menus_html(path) {
  return '<div class="menus">' + MENUS.map(([g, items], i) => `<div class="mn${items.some(([p]) => _isOn(p, path)) ? ' cur' : ''}"><button type="button" aria-haspopup="true" aria-expanded="false" aria-controls="mn${i}">${E(g)}${_CHEV}</button>` +
    `<div class="mnp" id="mn${i}">${items.map(([p, t]) => `<a class="${_isOn(p, path) ? 'on' : ''}" href="${p}"><b>${E(t)}</b>${_DESC[p] ? `<span>${E(_DESC[p])}</span>` : ''}</a>`).join('')}${i === MENUS.length - 1 ? '<a href="#" onclick="hwtSplash();return false"><b>About</b><span>Version and last backup</span></a>' : ''}</div></div>`).join('') + '</div>';
}
const _DESK = `<style>.tlogo,.tbtns,.menus{display:none}
@media(min-width:641px){.rail{display:none!important}.top .ham{display:none}
.top,.crumbs,main,.banner,body.min .top,body.min .crumbs,body.min main,body.min .banner{margin-left:0!important}
.tlogo{display:flex;align-items:center;gap:10px;color:var(--fg2);font-weight:650;white-space:nowrap;flex:none}.tlogo:hover{text-decoration:none}
.tlogo i{width:30px;height:30px;border-radius:7px;background:var(--amber);color:#0d1117;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:12px;font-weight:700}
.tbtns{display:flex;align-items:center;gap:10px;flex:none;margin-left:auto}.top .who{margin-left:0;cursor:pointer}
.tbtns .vsw{display:flex;align-items:center;gap:6px;color:#d29922;border:1px solid rgba(210,153,34,.5);border-radius:6px;padding:5px 10px;font-size:13px;white-space:nowrap}.tbtns .vsw:hover{text-decoration:none;background:var(--amber-t)}
.tbtns .hlp{display:flex;color:var(--mut);padding:4px}.tbtns .hlp:hover{color:var(--fg2)}
.crumbs{display:flex;align-items:center;gap:4px;padding:0 20px;min-height:40px;position:relative;z-index:15}.crumbs .crt{margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.menus{display:flex;align-items:center;gap:2px;flex:none}.mn{position:relative}.mn:last-child .mnp{left:auto;right:auto}@media(max-width:760px){.mn:last-child .mnp{left:auto;right:-60px}}
.mn>button{display:flex;align-items:center;gap:5px;background:none;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--fg);padding:10px 12px 8px;font-weight:600;cursor:pointer}
.mn>button:hover{filter:none;color:var(--fg2);background:var(--hi)}.mn.cur>button{border-bottom-color:var(--amber);color:var(--fg2)}.mn.open>button{background:var(--hi);color:var(--fg2)}
.mnp{display:none;position:absolute;left:0;top:100%;width:320px;padding:6px;background:var(--card);border:1px solid var(--line2);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.6)}.mn.open .mnp{display:block}
.mnp a{display:block;padding:8px 14px;border-radius:5px;color:var(--fg2)}.mnp a:hover{text-decoration:none;background:var(--hi)}.mnp a.on{background:var(--blue-t)}
.mnp a b{display:block;font-weight:600}.mnp a span{display:block;font-size:12px;color:var(--mut)}}
@media(min-width:641px) and (max-width:1180px){.tlogo span{display:none}.top .who{display:none}}
@media(min-width:641px) and (max-width:760px){.tbtns .vsw span{display:none}}</style>`;
const _MENUJS = `<script>(function(){var ms=[].slice.call(document.querySelectorAll('.mn'));if(!ms.length)return;
function shut(x){ms.forEach(function(m){if(m!==x){m.classList.remove('open');m.firstElementChild.setAttribute('aria-expanded','false')}})}
ms.forEach(function(m){m.firstElementChild.addEventListener('click',function(e){e.stopPropagation();shut(m);var o=m.classList.toggle('open');this.setAttribute('aria-expanded',o?'true':'false')})});
document.addEventListener('click',function(e){if(!e.target.closest||!e.target.closest('.mnp'))shut(null)});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var o=document.querySelector('.mn.open');shut(null);if(o)o.firstElementChild.focus()}});
document.querySelector('.menus').addEventListener('focusout',function(e){if(!e.relatedTarget||!e.relatedTarget.closest||!e.relatedTarget.closest('.menus'))setTimeout(function(){if(!document.activeElement.closest||!document.activeElement.closest('.menus'))shut(null)},0)})})()</script>`;
export const CSS = S.CSS;
export const ICONS = { ...S.ICONS, chart: '<path d="M3 20h18"/><path d="M4 16l5-6 4 3 6-8"/><circle cx="9" cy="10" r="1.2"/><circle cx="13" cy="13" r="1.2"/>', cost: '<path d="M12 3v18M16 7.5C16 5.6 14.2 4.5 12 4.5S8 5.6 8 7.5s1.8 3 4 3.5 4 1.6 4 3.5-1.8 3-4 3-4-1.1-4-3"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.5 18.5h3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9"/><circle cx="12" cy="17" r=".6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c2.9.3 5.5 2.6 5.5 5.8"/>' };

export function kind_badge(kind, big = false) {
  const [l, bg, fg] = KIND[kind || ''] || ['·', '#30363d', '#8b949e'];
  const [w, h, fs] = big ? [40, 32, 15] : [26, 20, 10.5];
  return `<span class="bdg" title="${E(kind || 'no category')}" style="background:${bg};color:${fg};width:${w}px;height:${h}px;` +
    `line-height:${h}px;font-size:${fs}px">${E(l)}</span>`;
}

export function badge(bev, big = false) {
  const k = BEV_TO_KIND[bev || ''];
  return kind_badge(k !== undefined ? k : (bev in KIND ? bev : null), big);
}

export function ago(ts) {
  if (!ts) return '';
  // calendar days, not 24-hour periods: a reading from yesterday afternoon is "yesterday" this morning
  const d = Math.round((naiveMs(today()) - naiveMs(String(ts).slice(0, 10))) / 86400000);
  if (d < 1) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 45) return `${d} day${d > 1 ? 's' : ''} ago`;
  if (d < 540) { const m = pyRound(d / 30.4); return `${m} month${m === 1 ? '' : 's'} ago`; }   // Python round(): ties to even
  return `${fx(d / 365.25, 1)} years ago`;
}

export function icon(k) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
}

export function shell(title, body, path, crumbs, banner, search_widget, css = '') {
  const nav = NAV.map(([p, t, k]) => p === '/view/cellar'
    ? `<a class="vsw" href="/view/cellar" onclick="this.href='/view/cellar?from='+encodeURIComponent(location.pathname+location.search)" title="Switch to the cellar (phone) view — this device will open in it until you switch back">${icon(k)}<span>${E(t)}</span></a>`
    : `<a class="${(p === '/' && path === '/') || (p !== '/' && path.startsWith(p)) ? 'on' : ''}" href="${p}" title="${E(t)}">${icon(k)}<span>${E(t)}</span></a>`).join('');
  const cr = '<a href="/" title="Home">⌂</a>' + crumbs.map(([t, h]) => ' &nbsp;›&nbsp; ' + (h ? `<a href="${E(h)}">${E(t)}</a>` : E(t))).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" type="image/png" href="/icon-192.png"><link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="HW Tracker"><meta name="theme-color" content="#0d1117">
${path === '/' && !globalThis.__hwt_view ? "<script>try{if(innerWidth<=640&&location.search.indexOf('full=1')<0)location.replace('/view/cellar')}catch(e){}</script>" : ''}<title>${E(title)} · HWWineTracker</title><style>${CSS}${css}</style></head><body>
<script>try{if(localStorage.getItem('hwc_min')==='1')document.body.classList.add('min')}catch(e){}</script>
<style>.rail a.vsw{color:#d29922;border-bottom:1px solid var(--line);margin-bottom:4px}</style><nav class="rail"><div class="logo" onclick="hwtSplash()" title="About" style="cursor:pointer"><i>HW</i><span>HWWineTracker</span></div>${nav}</nav>
<div id="scrim" onclick="document.body.classList.remove('navopen')"></div>
${_DESK}<div class="top"><a class="tlogo" href="/batches" title="Batches (home)"><i>HW</i><span>HWWineTracker</span></a><button class="ham" title="Menu" onclick="if(window.innerWidth<=640){document.body.classList.toggle('navopen');return}document.body.classList.toggle('min');try{localStorage.setItem('hwc_min',document.body.classList.contains('min')?'1':'0')}catch(e){}">
<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
${search_widget}${CONVERTER}<div class="tbtns"><a class="vsw" href="/view/cellar" onclick="this.href='/view/cellar?from='+encodeURIComponent(location.pathname+location.search)" title="Switch to the cellar (phone) view — this device will open in it until you switch back">${icon('phone')}<span>Cellar view</span></a><a class="hlp" href="/help" title="Help" aria-label="Help">${icon('help')}</a></div><div class="who" onclick="hwtSplash()" title="About HWWineTracker"><b>Hermit Woods</b>${E(strftime(naiveMs(today()), '%a %d %b %Y'))}</div></div>
${banner}<div class="crumbs">${menus_html(path)}<div class="crt">${cr}</div></div>${_MENUJS}<main>${body}</main>
</body></html>`;
}

export function chips(items, current, param, base, keep) {
  const q = Object.entries(keep).filter(([k, v]) => v && k !== param).map(([k, v]) => `${k}=${E(v)}`).join('&');
  return '<div class="chips">' + items.map(([val, lab]) => `<a class="${String(current) === String(val) ? 'on' : ''}" href="${base}?${q}${q ? '&' : ''}${param}=${E(val)}">${E(lab)}</a>`).join('') + '</div>';
}

export function latest_metric(c, bid, metric) {
  return c.one(`SELECT a.value, o.occurred_at FROM op_analysis a JOIN operation o ON o.id=a.op_id
                WHERE a.batch_id=? AND a.metric=? AND o.reversed=0 ORDER BY o.occurred_at DESC LIMIT 1`, bid, metric);
}

const _BEV = {};
// batch_id -> beverage type (batch record, else the latest snapshot's type). Cached per data version.
export function bev_map(c) {
  const k = c.one('SELECT MAX(snap_date) a, (SELECT MAX(id) FROM operation) b, (SELECT MAX(id) FROM batch) c FROM bulk_snapshot');
  const key = JSON.stringify(k) + '|' + (globalThis.__hwt_instance || '');
  if (_BEV.key !== key) {
    const m = new Map();
    for (const r of c.all('SELECT batch_id, beverage_type FROM bulk_snapshot WHERE beverage_type IS NOT NULL ORDER BY snap_date')) m.set(r.batch_id, r.beverage_type);
    for (const r of c.all('SELECT id, beverage_type FROM batch WHERE beverage_type IS NOT NULL')) m.set(r.id, r.beverage_type);
    _BEV.key = key; _BEV.m = m;
  }
  return _BEV.m;
}

export function tabs(items, current, base) {
  return '<div class="tabs">' + items.map(([k, t]) => `<a class="${k === current ? 'on' : ''}" href="${base}?tab=${k}">${E(t)}</a>`).join('') + '</div>';
}

// Vintrace-style note card. n: row with id, noted_at, who, detail, bcode, batch_id, container, attachments, source.
export function note_card(n, bid = null) {
  const att = n.attachments ? JSON.parse(n.attachments).length : 0;
  const origin = `${n.bcode || '?'}` + (n.container ? ` in ${n.container}` : '');
  const inh = bid !== null && bid !== undefined && n.batch_id !== bid;
  const olink = inh && n.batch_id ? `<a href="/batch/${n.batch_id}">${E(origin)}</a>` : E(origin);
  const who = [...new Set([n.who || '', n.source === 'app' ? 'HWWineTracker' : ''].filter(x => x))].join(' · ');
  return `<div class="ncard${inh ? ' inh' : ''}"><div class="h"><span>${E(stamp(n.noted_at))}</span>` +
    `<span class="muted" style="font-weight:400">${E(who)}${att ? ` · 📷 ${att}` : ''}</span></div>` +
    `<div class="t">${E((n.detail || '').trim())}</div>${note_photos(n)}` +
    `<div class="f"><b>${olink}</b>${inh ? ' · carried in from a blended/racked wine' : ''} · ${E(ago(n.noted_at))}${n.edited_at ? ' · edited' : ''} · <a href="/notes/edit?note=${n.id}">edit</a> · <a href="/notes/photo?note=${n.id}">＋ photo</a></div></div>`;
}

// thumbnails of a note's photos; Vintrace photos resolve by their Vintrace file id, HWWineTracker photos by their own id
export function note_photos(n) {
  let at = [];
  try { at = n.attachments ? JSON.parse(n.attachments) : []; } catch (e) { at = []; }
  if (!at.length) return '';
  return '<div class="nphotos" style="margin:6px 0 2px">' + at.map(a => {
    const base = a.local ? `/notefile/${a.id}` : `/notefile/vt/${a.id}`;
    return `<a href="${base}" target="_blank" rel="noopener" title="${E(a.fileName || '')}"><img src="${base}/thumb" loading="lazy" alt="${E(a.fileName || 'photo')}" style="height:84px;max-width:140px;object-fit:cover;border-radius:6px;border:1px solid #30363d;margin:0 6px 4px 0"></a>`;
  }).join('') + '</div>';
}

// '2026-10-01T14:05' -> 'Thu 2026-10-01 14:05'
export function stamp(ts) {
  try {
    return strftime(naiveMs(String(ts).slice(0, 16)), '%a %Y-%m-%d %H:%M');
  } catch (e) {
    return String(ts || '').replace('T', ' ');
  }
}
