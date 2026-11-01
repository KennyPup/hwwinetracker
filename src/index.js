// HWWineTracker on Cloudflare: Worker entry (sign-in check, real vs practice copy) + the Durable Object that holds the database.
import { DurableObject } from 'cloudflare:workers';
import { makeDb, usage } from './lib/db.js';
import { ctx, VERSION } from './core.js';
import * as backup from './backup.js';
import { runBackup, backupsPage } from './backup_r2.js';
import { startup, handleGet, handlePost, errorPage } from './app.js';
import { accessUser } from './lib/access.js';
import * as photos from './photos.js';
import * as reports from './reports.js';
import * as ttbpdf from './ttbpdf.js';
import * as onhand from './onhand.js';
import { today } from './lib/py.js';

// the filled TTB F 5120.17 (editable PDF) for a year; marked DRAFT while the year is not over
async function ttbPdfResponse(c, u) {
  const now = today(), y = parseInt(u.searchParams.get('year') || String(Number(now.slice(0, 4)) - 1), 10);
  const draft = y >= Number(now.slice(0, 4));
  const fruit = { begin: onhand.fruit_on_hand_at(c, `${y - 1}-12-31`), end: onhand.fruit_on_hand_at(c, draft ? now : `${y}-12-31`) };
  const kinds = u.searchParams.get('kinds') ? c.all(`SELECT variety k, SUM(amount)/0.45359237 lb FROM intake WHERE kind='fruit' AND reversed=0 AND unit='kg'
      AND lower(variety) NOT IN ('apple','apples') AND substr(occurred_at,1,4)=? GROUP BY lower(variety) ORDER BY lb DESC`, String(y)).map(r => [r.k, r.lb]) : null;
  const { bytes, notes } = await ttbpdf.build(reports.ttb_5120(c, y), { draft, asOf: now, fruit, kinds });
  return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-ttb-notes': encodeURIComponent(notes.join(' | ')),
    'content-disposition': `attachment; filename="TTB_F5120.17_${y}_HermitWoods${draft ? '_DRAFT' : ''}.pdf"` } });
}

const NOT_SET_UP = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#0d1117;color:#c9d1d9;font:16px -apple-system,Segoe UI,Arial;padding:40px">
<h2 style="color:#e6edf3">HWWineTracker</h2><p>Sign-in is not switched on yet, so nothing is shown here.</p></body>`;

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    let inst = /(?:^|;\s*)hwt_inst=practice/.test(req.headers.get('cookie') || '') ? 'practice' : 'main';
    if (u.pathname.startsWith('/_admin/')) {
      // data loading / backups from the laptop: token only (no browser sign-in); instance chosen by header
      if (!env.ADMIN_TOKEN || req.headers.get('x-admin') !== env.ADMIN_TOKEN) return new Response('forbidden', { status: 403 });
      inst = req.headers.get('x-instance') === 'practice' ? 'practice' : 'main';
    } else {
      const user = await accessUser(req, env);
      if (!user) return new Response(NOT_SET_UP, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (u.pathname === '/backups' || u.pathname.startsWith('/backups/')) return backupsPage(req, env, u);
      if (u.pathname === '/practice/on' || u.pathname === '/practice/off') {
        const on = u.pathname.endsWith('on');
        const nx = u.searchParams.get('next') || '';
        return new Response(null, { status: 303, headers: { location: /^\/(?![\/\\])/.test(nx) ? nx : (on ? '/' : '/'), 'set-cookie': `hwt_inst=${on ? 'practice' : 'main'}; Path=/; Max-Age=${on ? 31536000 : 0}; Secure; HttpOnly; SameSite=Lax` } });
      }
      req = new Request(req, { headers: new Headers([...req.headers, ['x-hwt-user', user]]) });
    }
    const stub = env.CELLAR.get(env.CELLAR.idFromName(inst));
    const fwd = new Request(req, { headers: new Headers([...req.headers, ['x-hwt-instance', inst]]) });
    return stub.fetch(fwd);
  },
  // nightly backup to R2 (cron in wrangler.toml)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBackup(env, 'scheduled'));
  },
};

export class Cellar extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.db = makeDb(state.storage);
  }

  async fetch(req) {
    const u = new URL(req.url);
    const inst = req.headers.get('x-hwt-instance') || 'main';
    const body = req.method === 'POST' ? await req.text() : '';
    // ---- from here on everything is synchronous: one request at a time
    if (u.pathname.startsWith('/_admin/')) return this.admin(u, req, body);
    globalThis.__hwt_instance = inst;
    ctx.instance = inst;
    ctx.mode = inst === 'practice' ? 'practice' : (this.env.MODE || 'readonly');
    ctx.user = req.headers.get('x-hwt-user') || '';
    globalThis.__hwt_view = ((req.headers.get('cookie') || '').match(/(?:^|;\s*)hwt_view=(cellar|full)/) || [])[1] || '';   // v1.33 Cellar / Full app choice (per device)
    const c = this.db;
    try {
      if (!c.val("SELECT 1 FROM sqlite_master WHERE name='batch'"))
        return new Response('<h1>No data loaded yet</h1>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
      startup(c);
      ctx.backup = { lb: c.val("SELECT value FROM app_meta WHERE key='last_backup'"), le: c.val("SELECT value FROM app_meta WHERE key='last_backup_error'") };
      ctx.token = c.val("SELECT value FROM app_meta WHERE key='csrf'");
      usage.read = 0; usage.written = 0; usage.log = this.env.DEV_NOAUTH === '1' ? [] : null;
      if (req.method === 'GET' && u.pathname === '/ttb.pdf') return await ttbPdfResponse(c, u);
      const resp = req.method === 'POST' ? handlePost(c, u, body) : handleGet(c, u);
      resp.headers.set('x-rows', `${usage.read}/${usage.written}`);   // database rows read/written for this page (for keeping an eye on usage)
      if (usage.log) console.log('ROWS ' + u.pathname + ' ' + JSON.stringify(usage.log.sort((a, b) => b[0] - a[0]).slice(0, 6)));
      return resp;
    } catch (e) {
      return errorPage(e);
    }
  }

  admin(u, req, body) {
    const sql = this.ctx.storage.sql;
    try {
      if (u.pathname === '/_admin/sql' && req.method === 'POST') {
        const b = JSON.parse(body);
        let n = 0;
        if (b.reset) {   // drop everything; children before parents (retry until none left)
          for (let pass = 0; pass < 20; pass++) {
            const left = sql.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray();
            if (!left.length) break;
            for (const r of left) { try { sql.exec(`DROP ${r.type.toUpperCase()} IF EXISTS "${r.name}"`); } catch (e) { /* retry next pass */ } }
          }
        }
        try {
          this.ctx.storage.transactionSync(() => { for (const s of b.stmts) { sql.exec(s); n++; } });
        } catch (e) {
          return Response.json({ error: String(e), at: n, stmt: String(b.stmts[n] || '').slice(0, 300) }, { status: 500 });
        }
        return Response.json({ ok: n, size: sql.databaseSize });
      }
      if (u.pathname === '/_admin/put_file' && req.method === 'POST') {   // one photo (JSON with base64 data + thumb), bound as BLOBs
        const b = JSON.parse(body);
        photos.ensure_schema(this.db);
        const id = photos.put_file(this.db, b.note_id, { name: b.name, mime: b.mime || 'image/jpeg', data: photos.b64(b.data), thumb: photos.b64(b.thumb),
          width: b.width, height: b.height, vt_file_id: b.vt_file_id ?? null, orig_bytes: b.orig_bytes, taken_at: b.taken_at, source: b.source || 'vintrace' });
        return Response.json({ ok: id });
      }
      if (u.pathname === '/_admin/q') {   // read-only query
        const q = u.searchParams.get('q') || '';
        if (!/^\s*(select|with|pragma\s+table_info)\b/i.test(q)) return new Response('read-only queries only', { status: 400 });
        return Response.json(sql.exec(q).toArray());
      }
      if (u.pathname === '/_admin/ttb_pdf') {   // the same PDF the Reports page downloads — for checking
        globalThis.__hwt_instance = req.headers.get('x-instance') === 'practice' ? 'practice' : 'main';
        ctx.instance = globalThis.__hwt_instance;
        startup(this.db);
        return ttbPdfResponse(this.db, u).catch(e => new Response(String(e && e.stack || e), { status: 500 }));
      }
      if (u.pathname === '/_admin/post' && req.method === 'POST') {   // v1.32: submit a form as Ken would — same code path, same checks
        // v1.66: also New dispatch (/record/dispatch, incl. Correct & replay with _correct=<entry>) and Reverse of a Dispatch entry,
        // so Claude can book Jen's monthly sales after Ken's OK and fix them later; every entry stays correctable/reversible in the app.
        const target = new URL(u.searchParams.get('path') || '/', 'https://x');
        const rev = target.pathname.match(/^\/reverse\/(\d+)$/);
        if (!/^\/item\/\d+\/(adjust|status)$/.test(target.pathname) && target.pathname !== '/record/dispatch' && !rev)
          return new Response('only /item/<id>/adjust|status, /record/dispatch, /reverse/<dispatch entry>', { status: 400 });
        globalThis.__hwt_instance = req.headers.get('x-instance') === 'practice' ? 'practice' : 'main';
        ctx.instance = globalThis.__hwt_instance;
        ctx.mode = ctx.instance === 'practice' ? 'practice' : (this.env.MODE || 'readonly');
        ctx.user = 'HARDCASTLE, Ken (via Claude)';   // v1.66.1: ctx is shared; never credit an admin-route change to the last app user
        startup(this.db);
        if (rev && this.db.val('SELECT op_type FROM operation WHERE id=?', Number(rev[1])) !== 'Dispatch')
          return new Response('reverse: only Dispatch entries', { status: 400 });
        ctx.token = this.db.val("SELECT value FROM app_meta WHERE key='csrf'");
        const r = handlePost(this.db, target, body + '&_t=' + encodeURIComponent(ctx.token));
        return r;
      }
      if (u.pathname === '/_admin/render') {   // render a page exactly as a signed-in browser would get it (GET only) — for checking
        const target = new URL(u.searchParams.get('path') || '/', 'https://x');
        globalThis.__hwt_instance = req.headers.get('x-instance') === 'practice' ? 'practice' : 'main';
        ctx.instance = globalThis.__hwt_instance;
        ctx.mode = ctx.instance === 'practice' ? 'practice' : (this.env.MODE || 'readonly');
        startup(this.db);
        ctx.backup = { lb: this.db.val("SELECT value FROM app_meta WHERE key='last_backup'"), le: this.db.val("SELECT value FROM app_meta WHERE key='last_backup_error'") };
        ctx.token = this.db.val("SELECT value FROM app_meta WHERE key='csrf'");
        try { return handleGet(this.db, target); } catch (e) { return errorPage(e); }
      }
      if (u.pathname.startsWith('/_admin/backup')) {   // daily Google Drive backup (see backup.js)
        const inst = req.headers.get('x-instance') === 'practice' ? 'practice' : 'main';
        const run = q => { const cur = sql.exec(q); return { columns: cur.columnNames, rows: cur.raw() }; };
        if (u.pathname === '/_admin/backup') {
          const now = new Date().toISOString();
          const parts = backup.dump(run, { instance: inst, created: now, version: VERSION, db_bytes: sql.databaseSize });
          return backup.gzipResponse(parts, `HWWineTracker_${inst}_${now.slice(0, 10)}.ndjson.gz`);
        }
        if (u.pathname === '/_admin/backup_photos')
          return Response.json(backup.photos(run, u.searchParams.get('after'), u.searchParams.get('limit')));
        if (u.pathname === '/_admin/backup_done' && req.method === 'POST') {
          const b = JSON.parse(body || '{}');
          sql.exec('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT)');
          if (b.error) {
            sql.exec("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('last_backup_error', ?)", JSON.stringify({ at: new Date().toISOString(), error: String(b.error).slice(0, 300) }));
            return Response.json({ ok: true });
          }
          sql.exec("DELETE FROM app_meta WHERE key='last_backup_error'");
          const rec = JSON.stringify({ at: new Date().toISOString(), file: String(b.file || '').slice(0, 200), bytes: Number(b.bytes) || 0, photos: Number(b.photos) || 0, folder: String(b.folder || '').slice(0, 200) });
          sql.exec('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT)');
          sql.exec("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('last_backup', ?)", rec);
          return Response.json({ ok: true });
        }
      }
      if (u.pathname === '/_admin/tables') {
        return Response.json(sql.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray());
      }
      return new Response('unknown', { status: 404 });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }
}
