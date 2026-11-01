"""Turn a HWWineTracker Google Drive backup back into a SQLite database file.

  python restore_backup.py <HWWineTracker_main_YYYY-MM-DD.ndjson.gz> <out.db> [<photos folder>]

The backup holds every table (schema, rows, indexes) except the photo bytes, which the backup script saves as JPEG
files named <id>__<file name> in the Drive folder "photos". Point the third argument at a downloaded copy of that folder
to put the photos back. The result opens in any SQLite tool, or can be loaded into the cloud app with tools/load.py.
Checks: the file must end with the {"end":true} trailer and every table's row count must match it."""
import sys, os, re, gzip, json, base64, sqlite3

src, out = sys.argv[1], sys.argv[2]
pdir = sys.argv[3] if len(sys.argv) > 3 else None
if os.path.exists(out):
    raise SystemExit(f'{out} already exists — choose a new file name')
con = sqlite3.connect(out)
dec = lambda v: base64.b64decode(v['$b64']) if isinstance(v, dict) and '$b64' in v else v
head, table, cols, counts, got, end = None, None, None, {}, {}, None
with gzip.open(src, 'rt', encoding='utf-8') as f, con:
    for ln in f:
        o = json.loads(ln)
        if 'hwt_backup' in o:
            head = o
        elif 'table' in o:
            table, cols = o['table'], o['columns']
            con.execute(o['sql'])
            got[table] = 0
        elif 'rows' in o:
            q = f'INSERT INTO "{table}" ({", ".join(chr(34) + c + chr(34) for c in cols)}) VALUES ({", ".join("?" * len(cols))})'
            con.executemany(q, [[dec(v) for v in r] for r in o['rows']])
            got[table] += len(o['rows'])
        elif 'index' in o:
            con.execute(o['index'])
        elif o.get('end'):
            end = o
if not head or not end:
    raise SystemExit('INCOMPLETE backup file (no header or no end trailer) — use an earlier day')
bad = {t: (got.get(t), n) for t, n in end['counts'].items() if got.get(t) != n}
if bad:
    raise SystemExit(f'row counts do not match the trailer: {bad}')
nph = 0
if pdir:
    with con:
        for fn in sorted(os.listdir(pdir)):
            m = re.match(r'^(\d+)__', fn)
            if m:
                con.execute('UPDATE note_file SET data=? WHERE id=?', (open(os.path.join(pdir, fn), 'rb').read(), int(m.group(1))))
                nph += 1
print(json.dumps({'instance': head.get('instance'), 'created': head.get('created'), 'version': head.get('version'),
                  'tables': len(got), 'rows': sum(got.values()), 'photos_restored': nph, 'out': out}))
