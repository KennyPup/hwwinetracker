import sqlite3, json, sys, urllib.parse
c = sqlite3.connect(sys.argv[1])
ids = lambda sql: [r[0] for r in c.execute(sql)]
U = ['/', '/batches', '/batches?in=0', '/batches?year=2024', '/batches?q=Straw&in=0', '/vessels', '/vessels?st=inuse', '/vessels?st=empty', '/ops', '/ops?year=2023',
     '/ops?year=2022&type=Additive', '/lab', '/lab?metric=pH', '/lab?year=2022&q=25', '/lab?n=600', '/notes', '/notes?order=old', '/materials', '/intakes', '/intakes?year=2023',
     '/stock', '/stock?date=2024-12-31', '/dispatches', '/dispatches?year=2024&unit=gal', '/reports', '/reports?year=2024', '/reports?year=2021',
     '/ttb.csv?year=2024', '/ttb.csv?year=2021', '/dispatched_stock.csv?from=2024-01-01&to=2024-12-31', '/stock.csv?date=2025-12-31',
     '/search?q=crab', '/search?q=25c', '/search?q=t1', '/api/search?q=25', '/record', '/formulas', '/formulas?cat=Mead', '/prototypes', '/additions', '/additions?vol=1000',
     '/additions?vol=500&cider=1', '/constants', '/record/note', '/record/note?batch=327']
U += ['/record/' + p for p in ('treatment', 'lab', 'addition', 'transfer', 'measure', 'declare', 'batch', 'intake')]
for b in ids('SELECT id FROM batch'):
    U.append(f'/batch/{b}')
for b in ids('SELECT id FROM batch ORDER BY id DESC LIMIT 60') + [327]:
    for t in ('lab', 'adds', 'notes', 'history', 'ttb'):
        U.append(f'/batch/{b}?tab={t}')
U += [f'/vessel/{v}' for v in ids('SELECT id FROM vessel')]
U += [f'/op/{o}' for o in ids('SELECT id FROM operation ORDER BY id DESC LIMIT 200')]
U += [f'/material/{m}' for m in ids('SELECT id FROM material')]
U += [f'/item/{i}' for i in ids('SELECT id FROM stock_item LIMIT 150')]
U += [f'/dispatch/{d}' for d in ids('SELECT id FROM dispatch ORDER BY id DESC LIMIT 150')]
U += [f'/formula/{f}' for f in ids('SELECT id FROM formula WHERE deleted=0')]
U += ['/prototype?' + urllib.parse.urlencode({'f': f}) for f in ids('SELECT DISTINCT family FROM formula WHERE family IS NOT NULL')]
json.dump(U, open(sys.argv[2], 'w'))
print(len(U))
