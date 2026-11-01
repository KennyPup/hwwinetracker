"""Store a filed TTB 5120.17 (Vintrace's report PDF, or the values as JSON) in table ttb_filed, so the next year's
report carries its closing lines (A31, B20) forward as line 1, as TTB requires.

Usage:
  python load_ttb_filed.py <year> <report.pdf | values.json> sqlite <db file>
  python load_ttb_filed.py <year> <report.pdf | values.json> cloud <admin url> <token file> <main|practice>
"""
import sys, json, re, sqlite3, urllib.request

year, src, mode = int(sys.argv[1]), sys.argv[2], sys.argv[3]
if src.lower().endswith('.pdf'):
    from pypdf import PdfReader
    f = PdfReader(src).get_fields() or {}
    vals = {k: (v.get('/V') if isinstance(v, dict) else v) for k, v in f.items()}
else:
    vals = json.load(open(src))
    vals = vals.get(str(year), vals)
rows = []
for k, v in vals.items():
    m = re.fullmatch(r'1([AB])\.(\d+)\.([a-f])', str(k))
    if not m or v in (None, '', ' '):
        continue
    try:
        g = float(str(v).replace(',', ''))
    except ValueError:
        continue
    line = m.group(1) + m.group(2)
    if line == 'B18':          # breakage is folded into B19 in HWWineTracker
        line = 'B19'
    rows.append((line, m.group(3), g))
agg = {}
for line, c, g in rows:
    agg[(line, c)] = agg.get((line, c), 0) + g
stmts = ['CREATE TABLE IF NOT EXISTS ttb_filed(year INTEGER NOT NULL, line TEXT NOT NULL, cls TEXT NOT NULL, gal REAL, source TEXT, PRIMARY KEY(year, line, cls))',
         f'DELETE FROM ttb_filed WHERE year={year}']
srcname = src.replace('\\', '/').split('/')[-1].replace("'", "''")
stmts += [f"INSERT INTO ttb_filed VALUES ({year},'{l}','{c}',{g!r},'{srcname}')" for (l, c), g in sorted(agg.items())]
if mode == 'sqlite':
    con = sqlite3.connect(sys.argv[4])
    with con:
        for s in stmts:
            con.execute(s)
else:
    url, tok, inst = sys.argv[4], open(sys.argv[5]).read().strip(), sys.argv[6]
    r = urllib.request.Request(url + '/_admin/sql', data=json.dumps({'stmts': stmts}).encode(),
                               headers={'x-admin': tok, 'x-instance': inst, 'content-type': 'application/json', 'User-Agent': 'hwt-ttb'})
    print(urllib.request.urlopen(r, timeout=120).read().decode())
print(f'{year}: {len(agg)} line values stored; A31', {c: g for (l, c), g in agg.items() if l == 'A31'}, 'B20', {c: g for (l, c), g in agg.items() if l == 'B20'})
