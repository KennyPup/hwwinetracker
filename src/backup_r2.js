// v1.0 — automatic daily backup inside Cloudflare (R2 bucket "hwwinetracker-backups").
// A Cron Trigger (wrangler.toml) runs runBackup() every night; "Back up now" on the Backups page runs it on demand.
//   daily/<inst>/HWWineTracker_<inst>_YYYY-MM-DD.ndjson.gz   whole database, main and practice (format: backup.js)
//   photos/<id>__<file name>                                  note photos (main), only new ones are added
//   state.json                                                last photo id saved
// Kept: 30 days of daily copies + the copy made on the 1st of every month, for good.
// The result (or the error) is recorded in app_meta of the real records and shown on Reports and /backups.
const KEEP_DAYS = 30;
const INSTANCES = ['main', 'practice'];
const doFetch = (env, inst, path, init = {}) =>
  env.CELLAR.get(env.CELLAR.idFromName(inst)).fetch(new Request('https://do' + path, { ...init, headers: { 'x-instance': inst, ...(init.headers || {}) } }));

async function ok(res, what) {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function runBackup(env, why = 'scheduled') {
  const day = new Date().toISOString().slice(0, 10);
  const saved = [];
  try {
    for (const inst of INSTANCES) {
      const buf = await (await ok(await doFetch(env, inst, '/_admin/backup'), `backup ${inst}`)).arrayBuffer();
      // check the copy is complete before keeping it: it must end with the {"end":true} trailer
      const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      if (!text.startsWith('{"hwt_backup":1') || !text.slice(-20000).includes('{"end":true')) throw new Error(`backup ${inst} is incomplete — not saved`);
      const key = `daily/${inst}/HWWineTracker_${inst}_${day}.ndjson.gz`;
      await env.BACKUPS.put(key, buf, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { why } });
      saved.push({ inst, key, bytes: buf.byteLength });
      await prune(env, inst);
    }
    const st = (await (await env.BACKUPS.get('state.json'))?.json()) || {};
    let after = st.last_photo_id || 0, nph = 0;
    for (let guard = 0; guard < 200; guard++) {
      const list = await (await ok(await doFetch(env, 'main', `/_admin/backup_photos?after=${after}&limit=20`), 'photos')).json();
      if (!list.length) break;
      for (const p of list) {
        const bin = Uint8Array.from(atob(p.data), ch => ch.charCodeAt(0));
        await env.BACKUPS.put(`photos/${p.id}__${String(p.file_name || 'photo.jpg').replace(/[\\/:*?"<>|]/g, '_')}`, bin, { httpMetadata: { contentType: p.mime || 'image/jpeg' } });
        after = p.id; nph++;
      }
      await env.BACKUPS.put('state.json', JSON.stringify({ ...st, last_photo_id: after }));
    }
    const m = saved[0];
    for (const inst of INSTANCES)   // recorded in both copies so the splash screen and Reports show it in either
      await doFetch(env, inst, '/_admin/backup_done', { method: 'POST', body: JSON.stringify({ file: m.key, bytes: m.bytes, photos: nph, folder: 'Cloudflare R2 · hwwinetracker-backups' }) });
    return { ok: true, saved, photos: nph };
  } catch (e) {
    for (const inst of INSTANCES)
      await doFetch(env, inst, '/_admin/backup_done', { method: 'POST', body: JSON.stringify({ error: String(e && e.message || e).slice(0, 300) }) }).catch(() => {});
    throw e;
  }
}

async function prune(env, inst) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  let cursor;
  do {
    const r = await env.BACKUPS.list({ prefix: `daily/${inst}/`, cursor });
    for (const o of r.objects) {
      const d = (o.key.match(/_(\d{4}-\d{2}-\d{2})\.ndjson\.gz$/) || [])[1];
      if (d && d < cutoff && !d.endsWith('-01')) await env.BACKUPS.delete(o.key);
    }
    cursor = r.truncated ? r.cursor : null;
  } while (cursor);
}

// ---------------------------------------------------------------- /backups page (signed-in users only; served by the Worker)
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function backupsPage(req, env, url) {
  if (url.pathname === '/backups/run' && req.method === 'POST') {
    const o = req.headers.get('origin');
    if (o && o !== url.origin) return new Response('bad origin', { status: 403 });
    let msg;
    try { const r = await runBackup(env, 'manual'); msg = `ok:${r.saved.map(s => s.inst).join('+')}:${r.photos}`; } catch (e) { msg = 'err'; }
    return new Response(null, { status: 303, headers: { location: '/backups?done=' + encodeURIComponent(msg) } });
  }
  if (url.pathname === '/backups/get') {
    const key = url.searchParams.get('key') || '';
    if (!/^daily\/(main|practice)\/HWWineTracker_[a-z]+_\d{4}-\d{2}-\d{2}\.ndjson\.gz$/.test(key)) return new Response('not found', { status: 404 });
    const o = await env.BACKUPS.get(key);
    if (!o) return new Response('not found', { status: 404 });
    return new Response(o.body, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${key.split('/').pop()}"`, 'cache-control': 'no-store' } });
  }
  const rows = [];
  for (const inst of INSTANCES) {
    const r = await env.BACKUPS.list({ prefix: `daily/${inst}/` });
    for (const o of r.objects) rows.push({ inst, key: o.key, size: o.size, up: o.uploaded });
  }
  rows.sort((a, b) => (a.key < b.key ? 1 : -1));
  let nph = 0, cur;
  do { const r = await env.BACKUPS.list({ prefix: 'photos/', cursor: cur }); nph += r.objects.length; cur = r.truncated ? r.cursor : null; } while (cur);
  const done = url.searchParams.get('done');
  const note = done ? (done.startsWith('ok') ? `<p class="ok">Backup made just now (${E(done.split(':')[1])}; ${E(done.split(':')[2])} new photo(s)).</p>` : '<p class="err">The backup failed — see Reports for the message.</p>') : '';
  const tr = rows.map(r => `<tr><td>${E(r.key.split('/').pop())}</td><td>${r.inst}</td><td class="n">${(r.size / 1e6).toFixed(2)} MB</td><td>${E(r.up.toISOString().replace('T', ' ').slice(0, 16))} UTC</td><td><a href="/backups/get?key=${encodeURIComponent(r.key)}">Download</a></td></tr>`).join('');
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Backups · HWWineTracker</title>
<style>body{background:#0d1117;color:#c9d1d9;font:15px -apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:24px;max-width:960px}a{color:#58a6ff}h1{color:#e6edf3;font-size:24px}
table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border-bottom:1px solid #30363d;padding:8px 10px;text-align:left}td.n{text-align:right}th{color:#8b949e;font-weight:600}
.muted{color:#8b949e}.ok{background:#12261a;border:1px solid #1f4d2a;color:#7ee2a0;border-radius:8px;padding:10px 12px}.err{background:#2d1517;border:1px solid #5c2328;color:#ffa198;border-radius:8px;padding:10px 12px}
button{background:#238636;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:600 15px inherit;cursor:pointer}</style></head><body>
<p><a href="/reports">‹ Reports</a></p><h1>Backups</h1>${note}
<p class="muted">Every night Cloudflare saves a full copy of the real records and the practice copy in its R2 storage (bucket hwwinetracker-backups), plus any new note photos (${nph} saved so far). Daily copies are kept 30 days; the copy from the 1st of each month is kept for good. Download one to keep a copy on your laptop or Google Drive; tools\\restore_backup.py turns it back into a database.</p>
<form method="post" action="/backups/run"><button>Back up now</button></form>
<table><thead><tr><th>File</th><th>Copy</th><th>Size</th><th>Saved</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan=5 class="muted">No backups yet.</td></tr>'}</tbody></table></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
