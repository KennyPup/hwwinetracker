"""Correct Vintrace readings entered in the wrong unit (decided by Ken 2026-10-02). Every change is logged in
table data_correction (old and new value, reason) so it can be re-applied after a re-import and audited.

Usage: python fix_units.py sqlite <db> | cloud <admin url> <token file> <main|practice>"""
import sys, json, sqlite3, urllib.request, urllib.parse, datetime

MODE = sys.argv[1]
if MODE == 'sqlite':
    con = sqlite3.connect(sys.argv[2]); con.row_factory = sqlite3.Row
    Q = lambda s: [dict(r) for r in con.execute(s)]
    def RUN(st):
        with con:
            for s in st: con.execute(s)
else:
    URL, TOK, INST = sys.argv[2], open(sys.argv[3]).read().strip(), sys.argv[4]
    H = {'x-admin': TOK, 'x-instance': INST, 'User-Agent': 'hwt-fix', 'content-type': 'application/json'}
    Q = lambda s: json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/q?q=' + urllib.parse.quote(s), headers=H), timeout=120).read())
    def RUN(st):
        r = json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/sql', data=json.dumps({'stmts': st}).encode(), headers=H), timeout=300).read())
        if 'error' in r: raise SystemExit(r)

st = ['''CREATE TABLE IF NOT EXISTS data_correction(id INTEGER PRIMARY KEY, tbl TEXT, row_id INTEGER, field TEXT, old_value TEXT, new_value TEXT,
         reason TEXT, applied_at TEXT, UNIQUE(tbl, row_id, field))''']
done = {(r['tbl'], r['row_id'], r['field']) for r in Q('SELECT tbl, row_id, field FROM data_correction')} if Q("SELECT 1 x FROM sqlite_master WHERE name='data_correction'") else set()
now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
fix = []
def add(rid, old, new, why):
    if ('op_analysis', rid, 'value') in done:
        return
    fix.append((rid, old, new, why))
base = "SELECT a.id, a.value, o.occurred_at FROM op_analysis a JOIN operation o ON o.id=a.op_id WHERE o.source='vintrace' AND "
for r in Q(base + "a.metric='TempC' AND o.occurred_at<'2020-03-01'"):
    add(r['id'], r['value'], round((r['value'] - 32) * 5 / 9, 2), 'Temperature entered in °F (Nov 2019–Feb 2020): converted to °C')
for r in Q(base + "a.metric='SG' AND a.value BETWEEN 950 AND 1200"):
    add(r['id'], r['value'], round(r['value'] / 1000, 4), 'SG entered ×1000')
for r in Q(base + "a.metric='SG' AND a.value>=0.9 AND a.value<0.98"):
    add(r['id'], r['value'], round(0.99 + (r['value'] - 0.9) / 10, 5), 'SG missing a 9 after the decimal (e.g. 0.92 for 0.992)')
for r in Q(base + "a.metric='SG' AND abs(a.value-0.093)<1e-9"):
    add(r['id'], r['value'], 0.993, 'SG typed 0.093 for 0.993')
q = lambda v: "'" + str(v).replace("'", "''") + "'"
for rid, old, new, why in fix:
    st.append(f"UPDATE op_analysis SET value={new!r}, text_value={q(new)} WHERE id={rid}")
    st.append(f"INSERT OR IGNORE INTO data_correction(tbl,row_id,field,old_value,new_value,reason,applied_at) VALUES ('op_analysis',{rid},'value',{q(old)},{q(new)},{q(why)},{q(now)})")
RUN(st)
print(json.dumps({'corrected': len(fix), 'by_reason': {w: sum(1 for f in fix if f[3] == w) for w in sorted({f[3] for f in fix})}}, ensure_ascii=False))
