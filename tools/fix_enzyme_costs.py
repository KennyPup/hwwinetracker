"""Re-price the pectic enzymes in the Vintrace cost ledger (decided by Ken 2026-10-02: "forget those false costs and
just go with the correct ones").

Vintrace charged Scottzyme HC and PEC5L at $89/ml (May-Jun 2022), then $4.58 (HC) and $12.68 (PEC5L) per ml until
2023-24, instead of the real price. Every enzyme addition is re-priced at the current Scott Laboratories list price
(1 kg = 890 ml for $100.63, scottlab.com, checked 2026-10-02 -> $0.1131/ml for both), and the difference is taken out
of every downstream row the same way Vintrace moved it: replaying the ledger in time order, each outflow (transfer,
press, blend, bottling, loss) carries the batch's share of the error (outflow cost / batch cost balance), and each
paired inflow receives what its source sent. Only cost_total and cost_additive change (enzyme cost is an additive
cost). Old values are logged in data_correction; stock_item.unit_cost of the two enzymes is set to the new price.
Re-running is a no-op (the re-priced rows carry no error).

Usage: python fix_enzyme_costs.py sqlite <db> [--dry] | cloud <admin url> <token file> <main|practice> [--dry]"""
import sys, json, re, sqlite3, urllib.request, urllib.parse, datetime, collections

PRICE = {'Pec Enzyme HC': 100.63 / 890, 'Pec Enzyme PEC5L': 100.63 / 890}
SRC = 'Scott Laboratories list price $100.63 per 1 kg (890 ml), scottlab.com 2026-10-02'
MODE, DRY = sys.argv[1], '--dry' in sys.argv
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
        for i in range(0, len(st), 150):
            r = json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/sql', data=json.dumps({'stmts': st[i:i + 150]}).encode(), headers=H), timeout=300).read())
            if 'error' in r: raise SystemExit(r)

rows = Q('SELECT id, activity_id, activity_type t, batch_code b, target2, cost_total c, cost_additive a, summary s FROM cost_txn ORDER BY activity_date, vt_posted_id, id')
rx = re.compile(r'Consumed ([\d.]+)\s*ml x (Pec Enzyme (?:HC|PEC5L)) ')
B, E = collections.defaultdict(float), collections.defaultdict(float)
pend, delta = collections.defaultdict(float), collections.defaultdict(float)
for r in rows:
    c, b = r['c'] or 0.0, r['b']
    if r['t'] == 'Additive':
        m = rx.search(r['s'] or '')
        if m:
            d = c - (1 if c >= 0 else -1) * float(m.group(1)) * PRICE[m.group(2)]
            E[b] += d; delta[r['id']] += d
        B[b] += c
        continue
    if c < 0:                                    # outflow carries its share of the batch's error
        eo = (min(1.0, -c / B[b]) if B[b] > 1e-9 else 0.0) * E[b]
        E[b] -= eo; B[b] += c; delta[r['id']] -= eo
        if r['target2']:
            pend[(r['activity_id'], b, r['target2'])] += eo
    else:
        B[b] += c
        if r['target2']:
            eo = pend.pop((r['activity_id'], r['target2'], b), 0.0)
            E[b] += eo; delta[r['id']] += eo

byid = {r['id']: r for r in rows}
chg = {i: d for i, d in delta.items() if abs(d) >= 0.005}
now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
why = f'enzyme re-priced at ${PRICE["Pec Enzyme HC"]:.4f}/ml ({SRC}); Vintrace had $4.58-$89/ml'
q = lambda v: 'NULL' if v is None else repr(float(v))
st = ['''CREATE TABLE IF NOT EXISTS data_correction(id INTEGER PRIMARY KEY, tbl TEXT, row_id INTEGER, field TEXT, old_value TEXT, new_value TEXT,
         reason TEXT, applied_at TEXT, UNIQUE(tbl, row_id, field))''']
for i, d in chg.items():
    r = byid[i]; nc = (r['c'] or 0) - d; na = (r['a'] or 0) - d
    st.append(f"UPDATE cost_txn SET cost_total={nc!r}, cost_additive={na!r} WHERE id={i}")
    for f, o, n in (('cost_total', r['c'], nc), ('cost_additive', r['a'], na)):
        st.append(f"INSERT OR IGNORE INTO data_correction(tbl,row_id,field,old_value,new_value,reason,applied_at) VALUES ('cost_txn',{i},'{f}',{q(o)},{q(n)},'{why}','{now}')")
for name, p in PRICE.items():
    st.append(f"UPDATE stock_item SET unit_cost={p!r}, cost_as_of='{now}' WHERE code='{name}'")
by_t = collections.defaultdict(float)
for i, d in chg.items(): by_t[byid[i]['t']] += d
print(json.dumps({'rows_changed': len(chg), 'enzyme_excess_removed': round(sum(d for i, d in chg.items() if byid[i]['t'] == 'Additive'), 2),
                  'by_activity': {k: round(v, 2) for k, v in sorted(by_t.items(), key=lambda kv: -abs(kv[1]))}, 'dry': DRY}))
if not DRY and chg:
    RUN(st)
