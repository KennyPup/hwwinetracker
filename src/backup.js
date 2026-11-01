// v1.0 — daily backup to Google Drive. A Google Apps Script in Ken's Drive calls the admin Worker once a day with the
// backup token and saves what it gets:
//   /_admin/backup        → the whole database (all tables, schema and indexes) as gzipped NDJSON (one JSON object per line):
//        {"hwt_backup":1, instance, created, version}       header
//        {"table":name, "sql":CREATE…, "columns":[…]}         one per table, followed by
//        {"rows":[[…],…]}                                     up to 2,000 rows per line
//        {"index":CREATE INDEX…}                              indexes
//        {"end":true, "counts":{table:n}}                     trailer (a missing trailer = incomplete file)
//      Photo bytes (note_file.data / thumb) are left out here and saved separately as JPEG files:
//   /_admin/backup_photos?after=<id>&limit=<n>  → [{id, note_id, vt_file_id, file_name, mime, width, height, taken_at, data:b64}]
//   /_admin/backup_done (POST {file, bytes, photos})  → records the last successful backup in app_meta (shown on Reports)
// Everything is read in one synchronous pass, so the copy is a consistent snapshot. tools/restore_backup.py turns a
// backup (+ the photos folder) back into a SQLite file.
const SKIP_BLOB = { note_file: ['data', 'thumb'] };
const enc = new TextEncoder();

function b64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const val = v => (v instanceof ArrayBuffer ? { $b64: b64(v) } : v instanceof Uint8Array ? { $b64: b64(v) } : typeof v === 'bigint' ? Number(v) : v);

// run(q) must return { columns: [...], rows: iterable of arrays }
export function dump(run, meta) {
  const parts = [];
  const line = o => parts.push(enc.encode(JSON.stringify(o) + '\n'));
  line({ hwt_backup: 1, ...meta });
  const tables = run("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid").rows;
  const counts = {};
  for (const [name, sql] of [...tables]) {
    const cols = [...run(`SELECT name FROM pragma_table_info('${name.replace(/'/g, "''")}')`).rows].map(r => r[0]);
    const keep = cols.filter(c => !(SKIP_BLOB[name] || []).includes(c));
    line({ table: name, sql, columns: keep, omitted: cols.filter(c => !keep.includes(c)) });
    let buf = [], n = 0;
    for (const r of run(`SELECT ${keep.map(c => `"${c}"`).join(', ')} FROM "${name}" ORDER BY rowid`).rows) {
      buf.push(r.map(val)); n++;
      if (buf.length >= 2000) { line({ rows: buf }); buf = []; }
    }
    if (buf.length) line({ rows: buf });
    counts[name] = n;
  }
  for (const [sql] of [...run("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND tbl_name NOT LIKE '_cf_%' ORDER BY rowid").rows])
    line({ index: sql });
  line({ end: true, counts });
  return parts;
}

export function photos(run, after, limit) {
  const r = run(`SELECT id, note_id, vt_file_id, file_name, mime, width, height, taken_at, data FROM note_file WHERE id > ${Number(after) || 0} AND data IS NOT NULL ORDER BY id LIMIT ${Math.min(Number(limit) || 20, 50)}`);
  return [...r.rows].map(x => Object.fromEntries(r.columns.map((c, i) => [c, c === 'data' ? b64(x[i]) : val(x[i])])));
}

export function gzipResponse(parts, filename) {
  const rs = new ReadableStream({
    start(ctl) { for (const p of parts) ctl.enqueue(p); ctl.close(); },
  });
  return new Response(rs.pipeThrough(new CompressionStream('gzip')), {
    headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' },
  });
}
