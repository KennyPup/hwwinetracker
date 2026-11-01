"""Push a SQLite database into the HWWineTracker Worker (Durable Object SQLite) via /_admin/sql.
Tables in foreign-key order: schema first, then rows (parents before children), then indexes."""
import sqlite3, json, sys, urllib.request, urllib.error, time
src, url, tok = sys.argv[1], sys.argv[2], sys.argv[3]
c = sqlite3.connect(src)
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
deps = {t: {r[2] for r in c.execute(f'PRAGMA foreign_key_list("{t}")') if r[2] != t} for t in tables}
order, seen = [], set()
def visit(t):
    if t in seen: return
    seen.add(t)
    for d in sorted(deps[t]):
        if d in deps: visit(d)
    order.append(t)
for t in sorted(tables): visit(t)
schema = [r[0] for r in c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
schema = sorted(schema, key=lambda s: order.index(next(t for t in order if s.split('(')[0].split()[-1].strip('"') == t)))
other = [r[0] for r in c.execute("SELECT sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL")]
def q(v):
    if v is None: return 'NULL'
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, bytes): return "X'" + v.hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"
INST = sys.argv[4] if len(sys.argv) > 4 else 'main'
def send(b, reset=False):
    r = urllib.request.Request(url + '/_admin/sql', data=json.dumps({'stmts': b, 'reset': reset}).encode(),
                               headers={'x-admin': tok, 'x-instance': INST, 'content-type': 'application/json', 'user-agent': 'HWWineTracker-loader/1.0'})
    try:
        return json.loads(urllib.request.urlopen(r, timeout=600).read())
    except urllib.error.HTTPError as e:
        sys.exit('FAILED: ' + e.read().decode()[:800])
t0 = time.time()
print(send(schema, reset=True))
total = 0
for t in order:
    cols = [r[1] for r in c.execute(f'PRAGMA table_info("{t}")')]
    head = f'INSERT INTO "{t}"({",".join(chr(34) + x + chr(34) for x in cols)}) VALUES '
    stmts, cur, clen, size = [], [], 0, 0
    def flush_stmt():
        global cur, clen
    for row in c.execute(f'SELECT * FROM "{t}"'):
        v = '(' + ','.join(q(x) for x in row) + ')'
        if cur and (clen + len(v) > 80_000 or len(cur) >= 200):   # also few rows per INSERT: Cloudflare limits compound VALUES      # Durable Object SQL: statements must stay under 100 KB
            stmts.append(head + ','.join(cur)); size += clen; cur, clen = [], 0
        cur.append(v); clen += len(v) + 1; total += 1
        if size > 1_500_000:
            send(stmts); stmts, size = [], 0
    if cur:
        stmts.append(head + ','.join(cur))
    if stmts:
        send(stmts)
out = send(other)
print('rows', total, 'tables', len(order), out, round(time.time() - t0, 1), 's')
