// Port of app.py's request handling (do_GET / do_POST) for the Durable Object. Synchronous after the body is read.
import { E, parseQs, qv, today, nowIso } from './lib/py.js';
import { page, ctx } from './core.js';
import * as P from './pages.js';
import * as search from './search.js';
import * as notes from './notes.js';
import * as reports from './reports.js';
import * as hw_ui from './hw_ui.js';
import * as ui_entry from './ui_entry.js';
import * as ui_formula from './ui_formula.js';
import * as formulation from './formulation.js';
import * as entry from './entry.js';
import * as e2 from './entry2.js';
import * as mobile from './mobile.js';
import { ZXING } from './gen/zxing.js';
import { JSQR, JSQR_VER } from './gen/jsqr.js';
import { QRGEN, QRGEN_VER } from './gen/qrgen.js';
import * as VU from './vessel_ui.js';
import * as TU from './topping_ui.js';
import * as SU from './stock_ui.js';
import * as S2 from './so2.js';
import * as HP from './help.js';
import * as correct from './correct.js';
import * as noteedit from './noteedit.js';
import * as opmenu from './opmenu.js';
import * as analytics from './analytics.js';
import * as film from './film.js';
import * as RD from './reductones.js';
import * as ui_entry2 from './ui_entry2.js';
import * as extras from './extras.js';
import * as photos from './photos.js';
import * as onhand from './onhand.js';
import * as matstock from './matstock.js';
import * as startbatch from './startbatch.js';
import * as makebatch from './makebatch.js';
import * as daily from './daily.js';
import * as stage from './stage.js';
ui_entry.setTiles2(ui_entry2.TILES);
import { ICON_PNG, ICON_192, ICON_512 } from './gen/icon.js';

const ROUTES = [
  [/^\/$/, P.p_dashboard], [/^\/batches$/, P.p_batches], [/^\/batch\/(\d+)$/, P.p_batch], [/^\/vessels$/, P.p_vessels], [/^\/vessel\/(\d+)$/, P.p_vessel],
  [/^\/ops$/, P.p_ops], [/^\/op\/(\d+)$/, P.p_op], [/^\/lab$/, P.p_lab], [/^\/notes$/, P.p_notes], [/^\/materials$/, P.p_materials], [/^\/material\/(\d+)$/, P.p_material],
  [/^\/intakes$/, P.p_intakes], [/^\/stock$/, SU.p_stock], [/^\/item\/(\d+)$/, SU.p_item], [/^\/dispatches$/, P.p_dispatches], [/^\/dispatch\/(\d+)$/, P.p_dispatch],
  [/^\/reports$/, P.p_reports],
];

class Rollback extends Error { constructor(result) { super('rollback'); this.result = result; } }

const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const redirect = url => new Response(null, { status: 303, headers: { location: url } });
const file = (body, ctype, fname) => new Response(body, { headers: { 'content-type': ctype, 'content-disposition': `attachment; filename="${fname}"` } });

const _ready = new Set();
export function startup(c) {
  // formulations, constants and notes are HWWineTracker's own data: tables exist even in read-only mode
  if (_ready.has(ctx.instance)) return;
  formulation.ensure_schema(c);
  notes.ensure_schema(c);
  if (c.val("SELECT 1 FROM sqlite_master WHERE name='operation'")) extras.ensure_schema(c);
  photos.ensure_schema(c);
  onhand.ensure_schema(c);
  matstock.ensure_schema(c);
  c.run('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT)');
  correct.ensure_schema(c);
  noteedit.ensure_schema(c);
  analytics.ensure_schema(c);
  stage.ensure_schema(c);
  VU.ensure_schema(c);
  TU.ensure_schema(c);
  film.ensure_schema(c);
  if (!c.val("SELECT value FROM app_meta WHERE key='csrf'")) {
    const t = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    c.run("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('csrf', ?)", t);
  }
  if (ctx.mode !== 'readonly' && c.val("SELECT 1 FROM sqlite_master WHERE name='operation'")) {
    entry.ensure_schema(c);
    entry.rebuild_snapshots(c);
  }
  _ready.add(ctx.instance);
}

export function handleGet(c, u) {
  const path = u.pathname, q = parseQs(u.search, false), TOKEN = ctx.token;
  let m;
  if (['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.ico', '/icon-192.png', '/icon-512.png'].includes(path)) {
    const src = path === '/icon-512.png' ? ICON_512 : path === '/icon-192.png' ? ICON_192 : ICON_PNG;
    const b = Uint8Array.from(atob(src), ch => ch.charCodeAt(0));
    return new Response(b, { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=604800' } });
  }
  if (path === '/manifest.webmanifest') {   // lets Chrome/Edge (laptop) install it as an app with its own window and icon
    return new Response(JSON.stringify({ name: 'HWWineTracker', short_name: 'HW Tracker', start_url: '/', scope: '/', display: 'standalone',
      background_color: '#0d1117', theme_color: '#0d1117',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }),
      { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'max-age=86400' } });
  }
  if (path === '/ttb.csv') {
    const y = parseInt(qv(q, 'year', '2023'), 10);
    return file(reports.ttb_csv(reports.ttb_5120(c, y)), 'text/csv', `TTB5120_${y}_HWCellar.csv`);
  }
  if (path === '/dispatched_stock.csv') {
    const a = qv(q, 'from', '2021-01-01'), b = qv(q, 'to', today());
    return file(reports.dispatched_stock_csv(c, a, b), 'text/csv', `HWCellar_DispatchedStock_${a}_${b}.csv`);
  }
  if (path === '/stock.csv') {
    const day = qv(q, 'date', today());
    return file(reports.stock_csv(c, day), 'text/csv', `HWCellar_Stock_${day}.csv`);
  }
  if (path === '/api/search') return new Response(search.api(c, qv(q, 'q', '')), { headers: { 'content-type': 'application/json' } });
  if (path === '/search') {
    const qq = qv(q, 'q', '');
    const res = search.search(c, qq, 2);
    if (res.length === 1 && !q.type && !notes.search(c, qq, 1).length) return redirect(res[0].href);
    let body = search.results_page(c, qq, qv(q, 'type', ''));
    const ns = qq.trim().length >= 3 && ['', 'Note'].includes(qv(q, 'type', '')) ? notes.search(c, qq) : [];
    if (ns.length) body += `<h2>Notes mentioning “${E(qq)}” (${ns.length}${ns.length >= 60 ? '+' : ''})</h2><div class="ncards">` + ns.map(n => hw_ui.note_card(n)).join('') + '</div>';
    return html(page('Search', body, '/search', [['Search results', null]]));
  }
  if (path === '/record') {
    const d = qv(q, 'done', '');
    const rp = Number(qv(q, 'replayed', '0')) || 0;
    const msg = d === 'reversed' ? `<div class="ok">Reversed.${rp ? ` ${rp} later ${rp === 1 ? 'entry was' : 'entries were'} replayed.` : ''}</div>` : (d ? `<div class="ok">Saved — <a href="/op/${E(d)}">view operation</a>.</div>` : '');
    return html(page('Record', ui_entry.page_hub(c, TOKEN, msg), '/record'));
  }
  if (path === '/formulas') {
    let body = ui_formula.formulas_list(c, q, TOKEN);
    if (q.start) {   // "new batch": start from a formulation
      let lots = [];
      try { lots = c.all("SELECT item, amount_kg FROM ingredient_lot WHERE status='on_hand' AND kind='fruit' ORDER BY item"); } catch (e) { /* none */ }
      const ban = `<div class="infobox" style="font-size:13.5px"><b>Starting a new wine:</b> press <b>▶ Start a batch</b> beside the wine's ★ master (or open any formulation under All formulations and press <b>Copy for this season</b>), adjust the fruit, sugar and water, save, then <b>② Make this a batch</b>.${lots.length ? ` Fruit on hand: ${lots.map(l => `<a href="/formulas?start=1&q=${encodeURIComponent(String(l.item).toLowerCase())}">${E(l.item)} ${Math.round(l.amount_kg / 0.45359237)} lb</a>`).join(' · ')} — click one to find its formulations.` : ''}</div>`;
      body = body.replace('</h1>', '</h1>' + ban);
    }
    return html(page('Formulations', body, '/formulas'));
  }
  m = path.match(/^\/formula\/(\d+)$/);
  if (m) {
    const msg = q.saved ? '<div class="ok">Saved.</div>' : q.promoted ? '<div class="ok">★ This is now the master. Any previous master is kept as an earlier version.</div>' : '';
    const [title, body] = ui_formula.formula_page(c, Number(m[1]), TOKEN, msg);
    if (body === null || body === undefined) return html(page('Not found', '<h1>Formula not found</h1>', '/formulas'), 404);
    return html(page(title, body, '/formula/'));
  }
  if (path === '/prototypes') return html(page('Prototype wines', ui_formula.prototypes_page(c, q), '/prototypes'));
  if (path === '/prototype') {
    const [title, body] = ui_formula.prototype_page(c, q, TOKEN);
    return html(page(title || 'Prototype', body, '/prototypes', [['Prototype wines', '/prototypes'], [title, null]]));
  }
  if (path === '/help') return html(page('Help', HP.page_index(), '/help'));
  if (path.startsWith('/help/')) { const t = HP.page_topic(decodeURIComponent(path.slice(6))); return t ? html(page(t[0], t[1], '/help', [['Help', '/help'], [t[0], null]])) : html(page('Not found', '<h1>No such help page</h1><p><a href="/help">All help</a></p>', '/help'), 404); }
  if (path === '/so2/panel') return html(S2.CSS + S2.table(c, +qv(q, 'b', '0') || 0, { fill: qv(q, 'fill', '') === '1' }));
  if (path === '/so2/calibration') return html(page('SO₂ calibration', S2.page_calibration(c), '/constants', [['Constants', '/constants'], ['SO₂ calibration', null]]));
  if (path === '/additions') return html(page('Additions', ui_formula.additions_page(c, q, TOKEN), '/additions'));
  if (path === '/constants') {
    const msg = q.saved ? '<div class="ok">Saved.</div>' : q.bad ? `<div class="err">Not saved: ${E(qv(q, 'bad', ''))} must be between ${E(qv(q, 'lo', ''))} and ${E(qv(q, 'hi', ''))}.</div>` : '';
    return html(page('Constants', ui_formula.constants_page(c, TOKEN, msg), '/constants'));
  }
  if (path.startsWith('/notefile/')) return photos.serve(c, path) || html(page('Not found', '<h1>Not found</h1>'), 404);
  if (path === '/analytics') return html(analytics.page_analytics(c, q));
  if (path === '/analytics/film') return html(film.page_film(c, q));
  if (path === '/analytics/reductones') return html(page('Reductones', RD.page_red(c, film.TABS), '/analytics', [['Analytics', '/analytics'], ['Reductones', null]]));   // v1.38
  if (path === '/notes/edit') { const out = noteedit.edit_page(c, parseInt(qv(q, 'note', '0'), 10), null, '', qv(q, 'back', '')); return out ? html(out) : html(page('Not found', '<h1>Note not found</h1>'), 404); }
  if (path === '/notes/photo') { const out = photos.page_add(c, parseInt(qv(q, 'note', '0'), 10), TOKEN); return out ? html(out) : html(page('Not found', '<h1>Note not found</h1>'), 404); }
  if (path === '/startbatch') {   // the main way is now formulation → Make this a batch
    const fq = parseInt(qv(q, 'f', '0'), 10);
    if (fq) return redirect(`/makebatch?f=${fq}`);
    if (!q.old) return redirect('/formulas?start=1');
    const out = startbatch.start_page(c, 0, TOKEN); return out ? html(out) : html(page('Not found', '<h1>Not found</h1>'), 404);
  }
  if (path === '/makebatch') { const out = makebatch.make_page(c, parseInt(qv(q, 'f', '0'), 10), TOKEN); return out ? html(out) : html(page('Not found', '<h1>Formulation not found</h1>'), 404); }
  if (path === '/materials') return html(matstock.p_materials(c, q, TOKEN, q.saved ? '<div class="ok">Saved.</div>' : ''));
  if (path === '/materials/stock') return redirect(`/material/${parseInt(qv(q, 'm', '0'), 10)}`);
  if (path === '/materials/new') return html(matstock.p_new(c, q, TOKEN));
  if ((m = path.match(/^\/material\/(\d+)$/))) { const out = matstock.p_material(c, Number(m[1]), q, TOKEN, q.saved ? '<div class="ok">Saved.</div>' : ''); return out ? html(out) : html(page('Not found', '<h1>Not found</h1>'), 404); }
  if (path === '/intakes') return html(onhand.p_intakes(c, q, TOKEN, q.saved ? '<div class="ok">Saved.</div>' : ''));
  if (path === '/intakes/lot') { const out = onhand.p_lot(c, q, TOKEN, q.saved ? '<div class="ok">Saved.</div>' : ''); return out ? html(out) : html(page('Not found', '<h1>Not found</h1>'), 404); }
  if (path === '/costs') return html(extras.p_costs(c, q));
  if (path === '/workorders') return html(extras.p_workorders(c, q));
  if (path === '/bookings') return html(extras.p_bookings(c, q));
  if (path === '/contacts') return html(extras.p_contacts(c, q, TOKEN, q.saved ? '<div class="ok">Saved.</div>' : ''));
  if ((m = path.match(/^\/correct\/(\d+)$/))) { const out = correct.correct_page(c, Number(m[1])); return out ? html(out) : html(page('Not found', '<h1>Not found</h1>'), 404); }
  if ((m = path.match(/^\/batch\/(\d+)\/rename$/))) { const out = correct.rename_page(c, Number(m[1])); return out ? html(out) : html(page('Not found', '<h1>Not found</h1>'), 404); }
  if (path === '/view/cellar' || path === '/view/full') {   // v1.33 Cellar / Full app switch: remembered per device (cookie), lands on the same wine where it can
    const to = path.endsWith('cellar') ? 'cellar' : 'full', from = /^\/(?![\/\\])/.test(qv(q, 'from', '')) ? qv(q, 'from', '') : '';
    const vNow = vid => c.one(`SELECT batch_id FROM bulk_snapshot WHERE vessel_id=? AND snap_date=(SELECT MAX(snap_date) FROM bulk_snapshot)`, vid);
    let dest = to === 'cellar' ? '/m' : '/', mm;
    if (to === 'cellar') {
      if ((mm = from.match(/^\/vessel\/(\d+)/))) dest = `/m/v/${mm[1]}`;
      else if ((mm = from.match(/^\/batch\/(\d+)/))) {
        const v = c.val(`SELECT s.vessel_id FROM bulk_snapshot s JOIN vessel v ON v.id=s.vessel_id WHERE s.batch_id=? AND s.snap_date=(SELECT MAX(snap_date) FROM bulk_snapshot)
                         ORDER BY (v.kind='barrel_group'), s.volume_l DESC LIMIT 1`, Number(mm[1]));
        if (v) dest = `/m/v/${v}`;
      }
    } else if ((mm = from.match(/^\/m\/v\/(\d+)/) || from.match(/^\/m\/check\?v=(\d+)/))) {
      const r = vNow(Number(mm[1]));
      dest = r && r.batch_id ? `/batch/${r.batch_id}` : `/vessel/${mm[1]}`;
    }
    return new Response(null, { status: 303, headers: { location: dest, 'set-cookie': `hwt_view=${to}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`, 'cache-control': 'no-store' } });
  }
  if (path === '/' && globalThis.__hwt_view === 'cellar' && qv(q, 'full', '') !== '1') return redirect('/m');
  if (path === '/m') return html(mobile.home(c, q));
  if (path === '/m/qs') return new Response(mobile.quick(c, q), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  if ((m = path.match(/^\/m\/i\/(\d+)$/))) return html(mobile.item(c, Number(m[1])));
  if (path === '/m/scan') { const r = mobile.scan(c, q); return r.redirect ? redirect(r.redirect) : html(r.html); }
  if (path === '/m/scanner.js') return new Response(ZXING, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' } });
  if ((m = path.match(/^\/m\/v\/(\d+)$/))) { const out = mobile.card(c, Number(m[1]), q); return out ? html(out) : html(page('Not found', '<h1>Not found</h1>'), 404); }
  if (path === '/m/check') return html(mobile.check_form(c, parseInt(qv(q, 'v', '0'), 10), q.saved ? { _saved: q.saved[0] } : q.cap ? { cap: '1' } : {}));
  if (path === '/m/jsqr.js') return new Response(JSQR, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' } });
  if (path === '/m/qrgen.js') return new Response(QRGEN, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' } });
  if ((m = path.match(/^\/v\/(.+)$/))) {   // v1.23 vessel by name (sticker text)
    let nm = m[1]; try { nm = decodeURIComponent(nm); } catch (e) { /* keep raw */ }
    return html(mobile.vpage(c, nm, q));
  }
  if (path === '/labels') return html(page('Vessel labels', VU.page_labels(c, TOKEN, q), '/vessels'));
  if (path === '/labels/print') return html(VU.page_print(c, q, QRGEN_VER));
  if (path === '/labels/logo') {
    const lg = VU.logo(c);
    if (!lg) return new Response('no logo', { status: 404 });
    const bin = Uint8Array.from(atob(lg.b64), ch => ch.charCodeAt(0));
    return new Response(bin, { headers: { 'content-type': lg.type, 'cache-control': 'no-cache' } });
  }
  if (path === '/record/note') return html(opmenu.with_next(page('Add note', ui_entry.page_note(c, TOKEN, { batch_id: qv(q, 'batch', ''), vessel_id: qv(q, 'vessel', '') }), '/notes'), path, qv(q, '_next', '')));
  if (path in ui_entry2.PAGES || path in ui_entry.PAGES) {   // prefilled from the query (batch ＋ Record menu, phone card); _next = where to go after saving
    const MULTI = ['vessels', 'fv', 'fl', 'sv', 'sl', 'sx', 'dv', 'dl', 'dry', 'dq', 'it', 'iq'];
    let pre = null;
    for (const [k, v] of Object.entries(q)) { pre = pre || {}; pre[k] = MULTI.includes(k) ? v : v[0]; }
    const nx = qv(q, '_next', '');
    if (path in ui_entry2.PAGES) {
      const msg = q.created && path === '/record/stock' ? '<div class="ok">Stock item created.</div>' : '';
      return html(opmenu.with_next(page('Record', ui_entry2.PAGES[path](c, TOKEN, pre || {}, msg), '/record'), path, nx));
    }
    return html(opmenu.with_next(page('Record', ui_entry.PAGES[path](c, TOKEN, pre), path === '/record/intake' ? path : '/record'), path, nx));
  }
  for (const [rx, fn] of ROUTES) {
    m = path.match(rx);
    if (m) {
      const out = fn(c, ...m.slice(1).map(Number), q);
      if (out === null || out === undefined) return html(page('Not found', '<h1>Not found</h1>'), 404);
      return html(out);
    }
  }
  return html(page('Not found', '<h1>Not found</h1>'), 404);
}

export function handlePost(c, u, bodyText) {
  const path = u.pathname, f = parseQs(bodyText, true), TOKEN = ctx.token;
  const g = k => (f[k] && f[k].length ? f[k][0] : '');
  if (path.startsWith('/formula') || path.startsWith('/constants') || path.startsWith('/prototype')) {
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p>Go back, reload the page and save again.</p>'), 403);
    const [url, err] = inTx(c, () => ui_formula.post(c, path, f));
    if (url) return redirect(url);
    return html(page('Not saved', `<h1>Not saved</h1><div class="err">${E(err)}</div><p><a href="javascript:history.back()">Go back</a></p>`), 400);
  }
  let rm0 = null;
  const rmV = path.match(/^\/v\/(\d+)\/info$/), rmG = path.match(/^\/v\/(\d+)\/members$/), rmW = path.match(/^\/v\/(\d+)\/towine$/);
  if (rmV || rmG || rmW || path === '/vessels/add' || path === '/labels/logo') {   // v1.23 vessel details, add a vessel from an unknown sticker, label logo
    if (ctx.mode === 'readonly') return html(page('Read-only', '<h1>Read-only</h1><p>The real records are read-only. Use the practice copy.</p>'), 403);
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload and try again.</p>'), 403);
    const [url, err] = inTx(c, () => (rmW ? VU.post_towine(c, Number(rmW[1]), f, e2) : rmG ? VU.post_members(c, Number(rmG[1]), f) : rmV ? VU.post_info(c, Number(rmV[1]), f) : path === '/vessels/add' ? VU.post_add(c, f) : VU.post_logo(c, f)));
    if (url) return redirect(url);
    return html(page('Not saved', `<h1>Not saved</h1><div class="err">${E(err)}</div><p><a href="javascript:history.back()">Go back</a></p>`), 400);
  }
  const rmI = path.match(/^\/item\/(\d+)\/(adjust|status)$/);
  if (rmI) {   // v1.32 item page: adjust on hand (a stock entry) / retire or un-retire (HWWineTracker's own flag)
    if (ctx.mode === 'readonly' && rmI[2] === 'adjust') return html(page('Read-only', '<h1>Read-only</h1><p>The real records are read-only. Use the practice copy.</p>'), 403);
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload and try again.</p>'), 403);
    const iid = Number(rmI[1]);
    const [url, err] = inTx(c, () => { try { return SU.post_item(c, iid, rmI[2], f, e2, correct.captured); } catch (e) { if (e instanceof entry.EntryError) return [null, e.message]; throw e; } });
    if (url) return redirect(url);
    const out = SU.p_item(c, iid, {}, `<div class="err">Not saved — ${E(err)}</div>`);
    return out ? html(out, 400) : html(page('Not found', '<h1>Not found</h1>'), 404);
  }
  const rmS = path.match(/^\/batch\/(\d+)\/stage$/);
  if (rmS) {   // v1.21 batch stage (Fermenting / Élevage / Ready for packaging)
    if (ctx.mode === 'readonly') return html(page('Read-only', '<h1>Read-only</h1><p>The real records are read-only. Use the practice copy.</p>'), 403);
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload and try again.</p>'), 403);
    const [url, err] = inTx(c, () => stage.post_stage(c, Number(rmS[1]), f));
    if (url) return redirect(url);
    return html(page('Not saved', `<h1>Not saved</h1><div class="err">${E(err)}</div>`), 400);
  }
  if (path === '/makebatch' || (rm0 = path.match(/^\/batch\/(\d+)\/daily$/))) {   // formulation → batch (makebatch.js); daily fermentation readings (daily.js)
    if (ctx.mode === 'readonly') return html(page('Read-only', '<h1>Read-only</h1><p>The real records are read-only. Use the practice copy.</p>'), 403);
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload and save again.</p>'), 403);
    const fid = parseInt(qv(parseQs(u.search, false), 'f', '0'), 10);
    const run = () => { try { return rm0 ? daily.post_daily(c, Number(rm0[1]), f) : makebatch.post_make(c, fid, f); } catch (e) { if (e instanceof entry.EntryError) return [null, e.message]; throw e; } };
    const [url, err] = inTx(c, run);
    if (url) return redirect(url);
    if (rm0) return html(page('Not saved', `<h1>Not saved</h1><div class="err">${E(err)}</div><p><a href="javascript:history.back()">Go back</a></p>`), 400);
    const fl = {}; for (const [k, v] of Object.entries(f)) fl[k] = v[0];
    return html(makebatch.make_page(c, fid, TOKEN, `<div class="err">Not saved — ${E(err)}</div>`, fl) || page('Not found', '<h1>Not found</h1>'), 400);
  }
  if (path === '/startbatch') {   // formulation → batch, fruit, vessel in one go (startbatch.js)
    const fid = parseInt(qv(parseQs(u.search, false), 'f', '0'), 10);
    if (ctx.mode === 'readonly') return html(page('Read-only', '<h1>Read-only</h1><p>The real records are read-only. Use the practice copy.</p>'), 403);
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload and save again.</p>'), 403);
    const [url, err] = inTx(c, () => { try { return startbatch.post_start(c, fid, f); } catch (e) { if (e instanceof entry.EntryError) return [null, e.message]; throw e; } });
    if (url) return redirect(url);
    const fl = {}; for (const [k, v] of Object.entries(f)) fl[k] = v[0];
    return html(startbatch.start_page(c, fid, TOKEN, `<div class="err">Not saved — ${E(err)}</div>`, fl) || page('Not found', '<h1>Not found</h1>'), 400);
  }
  if (path === '/analytics/outcome') {   // outcome ratings are HWWineTracker's own data: allowed in the real copy too
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload and save again.</p>'), 403);
    const [url, err] = inTx(c, () => analytics.post_outcome(c, f));
    return url ? redirect(url) : html(page('Not saved', `<h1>Not saved</h1><div class="err">${E(err)}</div>`), 400);
  }
  if (path === '/notes/edit') {   // notes are HWWineTracker's own data: editable in the real copy too (noteedit.js)
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload and save again.</p>'), 403);
    const [url, err] = inTx(c, () => noteedit.post_edit(c, f));
    if (url) return redirect(url);
    const nid = parseInt(g('note') || '0', 10);
    const out = noteedit.edit_page(c, nid, { when: g('when'), batch_id: g('batch_id'), vessel_id: g('vessel_id'), text: g('text') }, `<div class="err">${E(err)}</div>`, g('back'));
    return out ? html(out, 400) : html(page('Not found', '<h1>Note not found</h1>'), 404);
  }
  if (path === '/notes/photo') {   // photos are notes data: allowed in the real copy too
    const nid = parseInt(g('note') || '0', 10);
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a> and save again.</p>'), 403);
    if (!c.one('SELECT 1 x FROM batch_note WHERE id=?', nid)) return html(page('Not found', '<h1>Note not found</h1>'), 404);
    let err = null;
    const [url] = inTx(c, () => {
      try {
        const n = photos.attach_posted(c, nid, f);
        if (!n) return [null, 'Choose at least one photo.'];
        const b = c.val('SELECT batch_id FROM batch_note WHERE id=?', nid);
        return [b ? `/batch/${b}?tab=notes` : '/notes', null];
      } catch (e) { err = e.message; return [null, e.message]; }
    });
    if (url) return redirect(url);
    return html(photos.page_add(c, nid, TOKEN, `<div class="err">${E(err || 'Choose at least one photo.')}</div>`), 400);
  }
  if (path === '/materials/stock') {   // supplies count / receipt: allowed in the real copy too (matstock.js)
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="/materials">Go back</a> and save again.</p>'), 403);
    const [url, err] = inTx(c, () => {
      if (ctx.mode === 'readonly') entry.deferSnapshots(true);
      try { return matstock.post_stock(c, f); }
      catch (e) { if (e instanceof entry.EntryError) return [null, e.message]; throw e; }
      finally { entry.deferSnapshots(false); }
    });
    if (url) return redirect(url);
    const fl = {}; for (const [k, v] of Object.entries(f)) fl[k] = v[0];
    return html(matstock.p_material(c, Number(g('m') || 0), {}, TOKEN, `<div class="err">Not saved — ${E(err)}</div>`, fl) || page('Not found', '<h1>Not found</h1>'), 400);
  }
  if (path === '/materials/save') {   // material definitions are HWWineTracker's own data: real copy too
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="/materials">Go back</a> and save again.</p>'), 403);
    const [url, err] = inTx(c, () => {
      if (ctx.mode === 'readonly') entry.deferSnapshots(true);
      try { return matstock.post_save(c, f); }
      catch (e) { if (e instanceof entry.EntryError) return [null, e.message]; throw e; }
      finally { entry.deferSnapshots(false); }
    });
    if (url) return redirect(url);
    const fl = {}; for (const [k, v] of Object.entries(f)) fl[k] = v[0];
    const e = `<div class="err">Not saved — ${E(err)}</div>`;
    return html((g('id') ? matstock.p_material(c, Number(g('id')), { edit: ['1'] }, TOKEN, e, fl) : matstock.p_new(c, {}, TOKEN, e, fl)) || page('Not found', '<h1>Not found</h1>'), 400);
  }
  if (path === '/intakes/lot') {   // on-hand fruit/honey lots are HWWineTracker's own data: editable in the real copy too (onhand.js)
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="/intakes">Go back</a> and save again.</p>'), 403);
    const [url, err] = inTx(c, () => onhand.post_lot(c, f));
    if (url) return redirect(url);
    const e = `<div class="err">Not saved — ${E(err)}</div>`;
    const out = g('id') ? onhand.p_lot(c, { id: [g('id')] }, TOKEN, e) : null;
    return html(out || onhand.p_intakes(c, { add: ['1'] }, TOKEN, e), 400);
  }
  if (path === '/contacts/save') {   // contacts are HWWineTracker's own data: editable in the real copy too
    if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="/contacts">Go back</a> and save again.</p>'), 403);
    const [url, err] = inTx(c, () => extras.post_contact(c, f));
    if (url) return redirect(url);
    return html(extras.p_contacts(c, {}, TOKEN, `<div class="err">${E(err)}</div>`), 400);
  }
  const RO = () => html(page('Read-only', '<h1>Read-only</h1><p>The real records are read-only until cutover from Vintrace. Use the practice copy to try entries.</p>', '/record'), 403);
  const EXP = () => html(page('Expired', '<h1>Form expired</h1><p><a href="javascript:history.back()">Go back</a>, reload the page and save again.</p>'), 403);
  if (g('_correct') && correct.PATHS.has(path)) {   // Correct & replay (correct.js)
    if (ctx.mode === 'readonly') return RO();
    if (g('_t') !== TOKEN) return EXP();
    const [url, err] = inTx(c, () => { try { return correct.post_correct(c, path, f); } catch (e) { if (e instanceof entry.EntryError) return [null, e.message]; throw e; } });
    if (url) return redirect(url);
    const flat = {};
    for (const [k, v] of Object.entries(f)) if (!k.startsWith('_')) flat[k] = v;
    return html(correct.correct_page(c, parseInt(g('_correct'), 10), flat, `<div class="err">Not saved — ${E(err)}</div>`), 400);
  }
  let rm = path.match(/^\/batch\/(\d+)\/rename$/);
  if (rm) {
    if (ctx.mode === 'readonly') return RO();
    if (g('_t') !== TOKEN) return EXP();
    const [url, err] = inTx(c, () => correct.post_rename(c, Number(rm[1]), f));
    if (url) return redirect(url);
    return html(correct.rename_page(c, Number(rm[1]), { code: g('code'), items: g('items') }, `<div class="err">${E(err)}</div>`), 400);
  }
  if ((rm = path.match(/^\/reverse\/(\d+)$/)) && onhand.is_lot_delivery(c, Number(rm[1]))) {   // undo a fruit/honey delivery (on-hand lot page): real copy too
    if (g('_t') !== TOKEN) return EXP();
    const [url, err] = inTx(c, () => onhand.undo_delivery(c, Number(rm[1]), () => {
      if (ctx.mode === 'readonly') entry.deferSnapshots(true);
      try { correct.post_reverse(c, Number(rm[1])); } finally { entry.deferSnapshots(false); }
    }));
    if (url) return redirect(url);
    return html(page('Not undone', `<h1>Not undone</h1><div class="err">${E(err)}</div><p><a href="javascript:history.back()">Go back</a></p>`), 400);
  }
  if ((rm = path.match(/^\/reverse\/(\d+)$/))) {
    if (ctx.mode === 'readonly') return RO();
    if (g('_t') !== TOKEN) return EXP();
    const [url, err] = inTx(c, () => { try { return correct.post_reverse(c, Number(rm[1])); } catch (e) { if (e instanceof entry.EntryError) return [null, e.message]; throw e; } });
    if (url) return redirect(url);
    return html(page('Record', ui_entry.page_hub(c, TOKEN, `<div class="err">Not reversed — ${E(err)}</div>`), '/record'), 400);
  }
  if (path === '/m/check') {
    const vid = parseInt(g('v') || '0', 10);
    if (ctx.mode === 'readonly') return html(mobile.shell('Read-only', mobile.RO_MSG(`/m/check?v=${vid}`), ['Back', `/m/v/${vid}`]), 403);
    if (g('_t') !== TOKEN) return html(mobile.shell('Expired', '<div class="err">Form expired — go back, reload and enter it again.</div>', ['Back', `/m/check?v=${vid}`]), 403);
    const [url, err] = inTx(c, () => correct.captured(c, path, f, () => mobile.post_check(c, f)));
    if (url) return redirect(url);
    const flat = {};
    for (const [k, v] of Object.entries(f)) flat[k] = v[0];
    return html(mobile.check_form(c, vid, flat, `<div class="err">${E(err)}</div>`), 400);
  }
  // fruit/honey deliveries feed the on-hand list, so they can be saved in the real copy before cutover (no vessel, no bulk)
  const lotIntake = path === '/record/intake' && g('kind') === 'fruit' && !g('vessel_id') && !g('fill_litres');
  if (ctx.mode === 'readonly' && path === '/record/intake' && !lotIntake)
    return html(page('Read-only', '<h1>Read-only</h1><p>In the real records only fruit and honey deliveries (not into a vessel) can be saved before cutover. Bulk juice/cider and filling a vessel: use the practice copy for now.</p><p><a href="javascript:history.back()">Go back</a></p>', '/record'), 403);
  if (ctx.mode === 'readonly' && path !== '/record/note' && !lotIntake)
    return html(page('Read-only', '<h1>Read-only</h1><p>The real records are read-only until cutover from Vintrace. Use the practice copy to try entries.</p>', '/record'), 403);
  if (g('_t') !== TOKEN) return html(page('Expired', '<h1>Form expired</h1><p><a href="/record">Go back</a> and enter it again.</p>'), 403);
  if (path in ui_entry2.PAGES) {
    const [url2, err2] = inTx(c, () => {
      try { return correct.captured(c, path, f, () => ui_entry2.post(c, path, f)); } catch (e) {
        if (e instanceof entry.EntryError) return [null, e.message];
        return [null, `Unexpected error: ${e && e.message ? e.message : String(e)}`];
      }
    });
    if (url2) return redirect(opmenu.after_save(url2, f));
    const fl = {};
    for (const [k, v] of Object.entries(f)) fl[k] = v.length > 1 || ['vessels', 'fv', 'fl', 'sv', 'sl', 'sx', 'dv', 'dl', 'dry', 'dq', 'it', 'iq'].includes(k) ? v : v[0];
    return html(opmenu.with_next(page('Record', ui_entry2.PAGES[path](c, TOKEN, fl, `<div class="err">${E(err2)}</div>`), '/record'), path, g('_next')), 400);
  }
  const [url, err] = inTx(c, () => {
    if (ctx.mode === 'readonly') entry.deferSnapshots(true);   // a held delivery moves no vessel; leave the imported snapshots alone
    try {
      const r = correct.captured(c, path, f, () => ui_entry.post(c, path, f));
      if (r[0] && path === '/record/intake') onhand.sync_lots(c);
      return r;
    } finally { entry.deferSnapshots(false); }
  });
  if (url) return redirect(opmenu.after_save(url, f));
  const flat = {};
  for (const [k, v] of Object.entries(f)) flat[k] = k === 'vessels' ? v : v[0];
  const pg = ui_entry.PAGES[path];
  const body = pg ? pg(c, TOKEN, flat, `<div class="err">${E(err)}</div>`) : ui_entry.page_hub(c, TOKEN, `<div class="err">${E(err)}</div>`);
  return html(opmenu.with_next(page('Record', body, '/record'), path, g('_next')), 400);
}

// Run a post handler in one transaction; if it reports an error, undo everything it wrote (Python never committed).
function inTx(c, fn) {
  try {
    return c.tx(() => {
      const r = fn();
      if (!r[0]) throw new Rollback(r);
      return r;
    });
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}

export function errorPage(e) {
  return html(page('Error', `<h1>Error</h1><pre>${E(e && e.stack ? e.stack : String(e))}</pre>`), 500);
}

export { nowIso };
