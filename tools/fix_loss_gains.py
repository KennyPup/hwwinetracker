"""Vintrace loss/gain history: restore the gain direction and keep the full Vintrace report (decided by Ken 2026-10-06).

The first import stored every Vintrace loss/gain event in op_loss as a positive 'loss'. Vintrace's Wine production loss report
(vintrace_archive/reports/WineProductionLoss_2019-12_to_2026-10-02_all_events.csv, 3,147 events) gives the sign: a negative
volume is a gain. This script
  1. adds op_loss.gain (0/1) if missing,
  2. matches every report row to its op_loss row (same time ±2 min, same reason, same litres) and sets gain=1 where Vintrace
     shows a gain; tracker rows before the report starts (30 Nov 2019 opening dips) take the sign from the vessel volumes,
  3. stores the whole report, every column, as table vt_loss_report (with the matched op_loss id), so nothing from Vintrace is lost,
  4. logs each change in data_correction (re-runs change nothing).
Usage: python fix_loss_gains.py sqlite <db> <report.csv> | cloud <admin url> <token file> <main|practice> <report.csv>"""
import sys, json, csv, sqlite3, urllib.request, urllib.parse, datetime, collections, re

MODE = sys.argv[1]
if MODE == 'sqlite':
    con = sqlite3.connect(sys.argv[2]); con.row_factory = sqlite3.Row; REP = sys.argv[3]
    Q = lambda s: [dict(r) for r in con.execute(s)]
    def RUN(st):
        with con:
            for s in st: con.execute(s)
else:
    URL, TOK, INST, REP = sys.argv[2], open(sys.argv[3]).read().strip(), sys.argv[4], sys.argv[5]
    H = {'x-admin': TOK, 'x-instance': INST, 'User-Agent': 'hwt-fix', 'content-type': 'application/json'}
    Q = lambda s: json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/q?q=' + urllib.parse.quote(s), headers=H), timeout=120).read())
    def RUN(st):
        for i in range(0, len(st), 40):
            r = json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/sql', data=json.dumps({'stmts': st[i:i + 40]}).encode(), headers=H), timeout=300).read())
            if 'error' in r: raise SystemExit(r)

lit = lambda v: 'NULL' if v is None else (repr(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'")
now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
cols = [r['name'] for r in Q("PRAGMA table_info('op_loss')")]
pre = ["""CREATE TABLE IF NOT EXISTS data_correction(id INTEGER PRIMARY KEY, tbl TEXT, row_id INTEGER, field TEXT, old_value TEXT, new_value TEXT,
         reason TEXT, applied_at TEXT, UNIQUE(tbl, row_id, field))"""]
if 'gain' not in cols: pre.append('ALTER TABLE op_loss ADD COLUMN gain INTEGER NOT NULL DEFAULT 0')
RUN(pre)

# ---- the Vintrace report
f = open(REP, encoding='utf-8-sig'); f.readline()
V = list(csv.DictReader(f))
P = lambda s, fmt: datetime.datetime.strptime(s, fmt)
for v in V: v['_t'] = P(v['Date'], '%m/%d/%Y %H:%M'); v['_vol'] = float(v['Volume (L)'] or 0)
T = Q("""SELECT l.id, l.volume_l, l.reason, l.gain, o.occurred_at, o.op_type, b.code batch,
  (SELECT vol_before_l FROM op_vessel ov WHERE ov.op_id=l.op_id AND ov.vessel_id=l.vessel_id LIMIT 1) vb,
  (SELECT vol_after_l FROM op_vessel ov WHERE ov.op_id=l.op_id AND ov.vessel_id=l.vessel_id ORDER BY role='to' DESC LIMIT 1) va
  FROM op_loss l JOIN operation o ON o.id=l.op_id LEFT JOIN batch b ON b.id=l.batch_id WHERE o.source='vintrace'""")
for t in T: t['_t'] = P(t['occurred_at'][:16], '%Y-%m-%d %H:%M')
idx = collections.defaultdict(list)
for t in T: idx[(t['_t'], t['reason'].lower())].append(t)
used = set()
def tryv(v, kt):
    c = [t for t in idx.get((kt, v['Loss/gain Reason'].lower()), []) if t['id'] not in used and abs(t['volume_l'] - abs(v['_vol'])) <= max(1.01, 0.03 * abs(v['_vol']))]
    if not c: return
    c.sort(key=lambda t: (t['batch'] != v['Batch'], abs(t['volume_l'] - abs(v['_vol']))))
    used.add(c[0]['id']); v['_m'] = c[0]
for v in V: tryv(v, v['_t'])
for dm in (1, -1, 2, -2):
    for v in V:
        if '_m' not in v: tryv(v, v['_t'] + datetime.timedelta(minutes=dm))

done = {(r['tbl'], r['row_id'], r['field']) for r in Q('SELECT tbl, row_id, field FROM data_correction')}
gain_ids, log = [], []
for v in V:
    t = v.get('_m')
    if t and v['_vol'] < 0 and not t['gain'] and ('op_loss', t['id'], 'gain') not in done:
        gain_ids.append(t['id']); log.append((t['id'], f"Vintrace loss report: gain of {-v['_vol']:g} L ({v['Loss/gain Reason']}) — imported as a loss"))
pre_rep = min(v['_t'] for v in V)
for t in T:
    if t['id'] in used or t['_t'] >= pre_rep or t['gain'] or ('op_loss', t['id'], 'gain') in done: continue
    if t['op_type'] == 'Measurement' and t['vb'] is not None and t['va'] is not None and t['va'] - t['vb'] > 0.5:
        gain_ids.append(t['id']); log.append((t['id'], f"Before the Vintrace loss report: vessel went {t['vb']:g} -> {t['va']:g} L, a gain"))
st = []
for i in range(0, len(gain_ids), 200):
    st.append(f"UPDATE op_loss SET gain=1 WHERE id IN ({','.join(map(str, gain_ids[i:i + 200]))})")
for i in range(0, len(log), 150):
    st.append('INSERT OR IGNORE INTO data_correction(tbl,row_id,field,old_value,new_value,reason,applied_at) VALUES ' +
              ','.join(f"('op_loss',{rid},'gain','0','1',{lit(why)},{lit(now)})" for rid, why in log[i:i + 150]))

# ---- full Vintrace report kept as a table
have = Q("SELECT 1 x FROM sqlite_master WHERE name='vt_loss_report'")
hdr = [k for k in V[0].keys() if not k.startswith('_')]
cn = lambda k: re.sub(r'[^a-z0-9]+', '_', k.lower()).strip('_')
if not have:
    st.append('CREATE TABLE vt_loss_report(id INTEGER PRIMARY KEY, ' + ', '.join(f'{cn(k)} {"REAL" if k in ("Volume (L)",) else "TEXT"}' for k in hdr) +
              ', occurred_at TEXT, op_loss_id INTEGER)')
    rows = [[v[k] if k != 'Volume (L)' else v['_vol'] for k in hdr] + [v['_t'].strftime('%Y-%m-%d %H:%M'), v['_m']['id'] if '_m' in v else None] for v in V]
    cols2 = [cn(k) for k in hdr] + ['occurred_at', 'op_loss_id']
    for i in range(0, len(rows), 100):
        st.append(f"INSERT INTO vt_loss_report({','.join(cols2)}) VALUES " + ','.join('(' + ','.join(lit(x) for x in r) + ')' for r in rows[i:i + 100]))
RUN(st)
um = [v for v in V if '_m' not in v]
print(json.dumps({'report_rows': len(V), 'matched': len(V) - len(um), 'unmatched_report_rows': len(um), 'unmatched_litres': round(sum(abs(v['_vol']) for v in um), 1),
                  'largest_unmatched_L': max([abs(v['_vol']) for v in um] or [0]), 'gains_set': len(gain_ids), 'report_table_created': not have}))
