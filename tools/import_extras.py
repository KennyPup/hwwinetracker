"""Bring over the Vintrace data the first import left out (v0.9.2):
  cost ledger, work orders, fruit bookings, contact details, additive lot numbers,
  intake / extraction details (grower, booking, dockets, press, cost), stock-item costs and locations.

Reads the raw API pulls only (never calls Vintrace). Writes either straight into a SQLite file (for testing)
or into the cloud database through /_admin/sql. Safe to re-run: it replaces what it wrote before.

Usage:
  python import_extras.py <vintrace_inventory/raw> sqlite <db file>
  python import_extras.py <vintrace_inventory/raw> cloud <admin url> <token file> <main|practice>
"""
import sys, os, json, glob, re, sqlite3, collections, datetime as dt, urllib.request, urllib.parse
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
RAW, MODE = sys.argv[1], sys.argv[2]


def T(ms):
    return dt.datetime.fromtimestamp(ms / 1000, ET).strftime('%Y-%m-%d %H:%M:%S') if ms else None


def pages(slug, key):
    out = []
    for f in sorted(glob.glob(f'{RAW}/{slug}/p*.json')):
        b = json.load(open(f))
        out += (b.get(key) or []) if isinstance(b, dict) else []
    return out


# ---------------------------------------------------------------- target database access
if MODE == 'sqlite':
    con = sqlite3.connect(sys.argv[3]); con.row_factory = sqlite3.Row
    def Q(sql):
        return [dict(r) for r in con.execute(sql)]
    def RUN(stmts):
        with con:
            for s in stmts:
                con.execute(s)
else:
    URL, TOK, INST = sys.argv[3], open(sys.argv[4]).read().strip(), sys.argv[5]
    H = {'x-admin': TOK, 'x-instance': INST, 'User-Agent': 'hwt-import', 'content-type': 'application/json'}
    def Q(sql):
        r = urllib.request.Request(URL + '/_admin/q?q=' + urllib.parse.quote(sql), headers=H)
        return json.loads(urllib.request.urlopen(r, timeout=300).read())
    def RUN(stmts):
        batch, size = [], 0
        def go(b):
            r = urllib.request.Request(URL + '/_admin/sql', data=json.dumps({'stmts': b}).encode(), headers=H)
            res = json.loads(urllib.request.urlopen(r, timeout=600).read())
            if 'error' in res:
                raise SystemExit(f"FAILED: {res}")
        for s in stmts:
            if size + len(s) > 400_000 and batch:
                go(batch); batch, size = [], 0
            batch.append(s); size += len(s)
        if batch:
            go(batch)


def q(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    return "'" + str(v).replace("'", "''") + "'"


def inserts(table, cols, rows, chunk=150, maxlen=80_000):
    out, cur, size = [], [], 0
    head = f'INSERT INTO {table}({",".join(cols)}) VALUES '
    for r in rows:
        v = '(' + ','.join(q(r.get(c)) for c in cols) + ')'
        if cur and (len(cur) >= chunk or size + len(v) > maxlen):
            out.append(head + ','.join(cur)); cur, size = [], 0
        cur.append(v); size += len(v) + 1
    if cur:
        out.append(head + ','.join(cur))
    return out


def ensure_cols(table, cols):
    have = {r['name'] for r in Q(f'PRAGMA table_info("{table}")')}
    return [f'ALTER TABLE {table} ADD COLUMN {c} {t}' for c, t in cols if c not in have]


stmts = []
# ---------------------------------------------------------------- schema
stmts += ['''CREATE TABLE IF NOT EXISTS cost_txn(id INTEGER PRIMARY KEY, vt_posted_id INTEGER UNIQUE, activity_id TEXT, op_id INTEGER, activity_type TEXT,
  activity_date TEXT, posted_date TEXT, batch_code TEXT, batch_id INTEGER, target2 TEXT, vessel TEXT, location TEXT, volume_l REAL,
  cost_total REAL, cost_fruit REAL, cost_overhead REAL, cost_storage REAL, cost_additive REAL, cost_bulk REAL, cost_packaging REAL,
  cost_operation REAL, cost_freight REAL, cost_other REAL, customer TEXT, vendor TEXT, loss_reason TEXT, summary TEXT, correction INTEGER, source TEXT DEFAULT 'vintrace')''',
          'CREATE INDEX IF NOT EXISTS ix_cost_batch ON cost_txn(batch_id, activity_date)',
          'CREATE INDEX IF NOT EXISTS ix_cost_op ON cost_txn(op_id)',
          '''CREATE TABLE IF NOT EXISTS work_order(id INTEGER PRIMARY KEY, vt_id INTEGER UNIQUE, code TEXT, summary TEXT, status TEXT, assigned_to TEXT,
  issued_by TEXT, scheduled_at TEXT, finished_at TEXT, jobs TEXT, source TEXT DEFAULT 'vintrace')''',
          '''CREATE TABLE IF NOT EXISTS booking(id INTEGER PRIMARY KEY, vt_id INTEGER UNIQUE, booking_no TEXT, arrival_at TEXT, vintage INTEGER,
  weight_kg REAL, vineyard TEXT, block TEXT, grower TEXT, source TEXT DEFAULT 'vintrace')''']
stmts += ensure_cols('party', [('given_name', 'TEXT'), ('surname', 'TEXT'), ('is_org', 'INTEGER'), ('phone', 'TEXT'), ('email', 'TEXT'),
                               ('address', 'TEXT'), ('contacts', 'TEXT'), ('notes', 'TEXT')])
stmts += ensure_cols('op_addition', [('lot', 'TEXT'), ('change_to_state', 'TEXT')])
stmts += ensure_cols('operation', [('details', 'TEXT')])
stmts += ensure_cols('intake', [('booking_no', 'TEXT'), ('block', 'TEXT'), ('vineyard', 'TEXT'), ('carrier', 'TEXT'), ('gross_amount', 'REAL'),
                                ('tare_amount', 'REAL'), ('cost', 'REAL'), ('cost_rate', 'TEXT'), ('details', 'TEXT')])
stmts += ensure_cols('stock_item', [('unit_cost', 'REAL'), ('total_cost', 'REAL'), ('cost_detail', 'TEXT'), ('location', 'TEXT'),
                                    ('tax_state', 'TEXT'), ('cost_as_of', 'TEXT')])
RUN(stmts)          # schema first so the lookups below can see the new columns
stmts = []

# ---------------------------------------------------------------- lookups in the target database
batch_id = {r['code']: r['id'] for r in Q('SELECT id, code FROM batch')}
op_id = {r['vt_op_id']: r['id'] for r in Q('SELECT id, vt_op_id FROM operation WHERE vt_op_id IS NOT NULL')}
add_rows = collections.defaultdict(list)
for r in Q("SELECT a.id, a.op_id FROM op_addition a JOIN operation o ON o.id=a.op_id WHERE o.source='vintrace' ORDER BY a.op_id, a.id"):
    add_rows[r['op_id']].append(r['id'])
intake_id = {r['vt_id']: r['id'] for r in Q('SELECT id, vt_id FROM intake WHERE vt_id IS NOT NULL')}
party_id = {r['vt_id']: r['id'] for r in Q('SELECT id, vt_id FROM party WHERE vt_id IS NOT NULL')}
item_id = {r['code']: r['id'] for r in Q('SELECT id, code FROM stock_item')}

# ---------------------------------------------------------------- cost ledger
rows = []
for x in pages('v7_costs_business-unit-transactions', 'results'):
    cd = x.get('costDelta') or {}
    vd = x.get('volumeDelta') or {}
    vol = vd.get('value')
    if vol is not None and (vd.get('unit') or 'L') != 'L':
        vol = vol * 3.785411784 if vd.get('unit') in ('gal', 'Gallons') else vol
    if vol is not None and str(x.get('activityType') or '').startswith(('Package', 'Bulk dispatch')):
        vol = -abs(vol)          # Vintrace reports these volumes unsigned; they are wine leaving the batch
    m = re.match(r'OP:(\d+)', x.get('activityId') or '')
    rows.append({'vt_posted_id': x['postedId'], 'activity_id': x.get('activityId'), 'op_id': op_id.get(int(m.group(1))) if m else None,
                 'activity_type': x.get('activityType'), 'activity_date': T(x.get('activityDate')), 'posted_date': T(x.get('postedDate')),
                 'batch_code': x.get('primaryCostTarget'), 'batch_id': batch_id.get(x.get('wineBatch') or x.get('primaryCostTarget')),
                 'target2': x.get('secondaryCostTarget'), 'vessel': x.get('vessel'), 'location': x.get('location'), 'volume_l': vol,
                 **{f'cost_{k}': cd.get(k) for k in ('total', 'fruit', 'overhead', 'storage', 'additive', 'bulk', 'packaging', 'operation', 'freight', 'other')},
                 'customer': (x.get('customer') or {}).get('name') if isinstance(x.get('customer'), dict) else x.get('customer'),
                 'vendor': (x.get('vendor') or {}).get('name') if isinstance(x.get('vendor'), dict) else x.get('vendor'),
                 'loss_reason': x.get('lossReason'), 'summary': x.get('activitySummary'), 'correction': 1 if x.get('resultOfCorrection') else 0})
uniq = {r['vt_posted_id']: r for r in rows}
rows = list(uniq.values())
stmts.append("DELETE FROM cost_txn WHERE source='vintrace'")
stmts += inserts('cost_txn', list(rows[0].keys()), rows)
n_cost = len(rows)

# ---------------------------------------------------------------- work orders (v7 has all; v6 list adds the open ones)
wo = {}
for x in pages('v7_operation_work-orders', 'results'):
    jobs = x.get('jobs') or []
    fin = max([j.get('finishedTime') or 0 for j in jobs] or [0]) or None
    wo[x['id']] = {'vt_id': x['id'], 'code': x.get('name'), 'summary': x.get('summary'), 'status': x.get('status'),
                   'assigned_to': (x.get('assignedTo') or {}).get('name'), 'issued_by': (x.get('issuedBy') or {}).get('name'),
                   'scheduled_at': T(x.get('scheduledTime')), 'finished_at': T(fin),
                   'jobs': [{'n': j.get('jobNumber'), 'type': j.get('operationType'), 'status': j.get('status'), 'finished': T(j.get('finishedTime'))} for j in jobs]}
for x in pages('v6_workorders_list', 'workOrders'):
    if x['id'] not in wo:
        wo[x['id']] = {'vt_id': x['id'], 'code': x.get('code'), 'summary': x.get('summary'), 'status': x.get('statusDisplay') or x.get('status'),
                       'assigned_to': x.get('assignedTo'), 'issued_by': x.get('assignedBy'), 'scheduled_at': T(x.get('scheduledDate')),
                       'finished_at': None, 'jobs': [{'text': x.get('jobCountText')}]}
rows = list(wo.values())
stmts.append("DELETE FROM work_order WHERE source='vintrace'")
stmts += inserts('work_order', list(rows[0].keys()), rows)
n_wo = len(rows)

# ---------------------------------------------------------------- fruit intakes: details + bookings
grower_by_booking = {}
rows_i = []
for x in pages('v6_intake-operations_search', 'intakes'):
    iid = intake_id.get(f"fi{x['fruitIntakeId']}")
    bn = x.get('bookingNumber')
    if bn and (x.get('grower') or {}).get('name'):
        grower_by_booking[(bn, x.get('vintage'))] = x['grower']['name']
    if not iid:
        continue
    extra = {k: x.get(k) for k in ('mog', 'harvestMethod', 'intendedUse', 'growerContract', 'consignmentNote', 'driverName', 'truckRegistration',
                                    'externalWeighTag', 'area', 'metrics') if x.get(k) not in (None, '', [], 0, 0.0)}
    rows_i.append(f"UPDATE intake SET booking_no={q(bn)}, block={q((x.get('block') or {}).get('name') if isinstance(x.get('block'), dict) else x.get('block'))}, "
                  f"vineyard={q((x.get('vineyard') or {}).get('name') if isinstance(x.get('vineyard'), dict) else x.get('vineyard'))}, "
                  f"carrier={q((x.get('carrier') or {}).get('name'))}, gross_amount={q((x.get('grossAmount') or {}).get('value'))}, "
                  f"tare_amount={q((x.get('tareAmount') or {}).get('value'))}, cost={q(x.get('fruitCost'))}, cost_rate={q(x.get('fruitCostRateType'))}, "
                  f"details={q(extra or None)} WHERE id={iid}")
for x in pages('v7_operation_bulk-intakes', 'results'):
    iid = intake_id.get(f"bi{x['id']}")
    if not iid:
        continue
    c = x.get('cost') or {}
    dd = x.get('deliveryDetails') or {}
    extra = {k: v for k, v in dd.items() if v not in (None, '') and k not in ('receivedFrom', 'carrier')}
    w = x.get('wineDetails') or {}
    extra.update({k: w.get(k) for k in ('fractionType', 'fermentState', 'beverageType') if w.get(k)})
    rows_i.append(f"UPDATE intake SET carrier={q((dd.get('carrier') or {}).get('name'))}, cost={q(c.get('amount'))}, cost_rate={q(c.get('rate'))}, "
                  f"details={q(extra or None)} WHERE id={iid}")
stmts += rows_i
n_int = len(rows_i)

bk = []
for f in sorted(glob.glob(f'{RAW}/v7_operation_bookings_*/p*.json')):
    for x in (json.load(open(f)).get('results') or []):
        we = x.get('weightEstimate') or {}
        kg = we.get('value')
        if kg is not None and we.get('unit') in ('t', 'tonne'):
            kg *= 1000
        elif kg is not None and we.get('unit') in ('lb', 'Pounds'):
            kg *= 0.45359237
        bk.append({'vt_id': x['id'], 'booking_no': x.get('bookingNumber'), 'arrival_at': T(x.get('arrivalTime')), 'vintage': x.get('vintage'),
                   'weight_kg': kg, 'vineyard': (x.get('vineyard') or {}).get('name') if isinstance(x.get('vineyard'), dict) else x.get('vineyard'),
                   'block': (x.get('block') or {}).get('name') if isinstance(x.get('block'), dict) else x.get('block'),
                   'grower': grower_by_booking.get((x.get('bookingNumber'), x.get('vintage')))})
bk = list({b['vt_id']: b for b in bk}.values())
stmts.append("DELETE FROM booking WHERE source='vintrace'")
stmts += inserts('booking', list(bk[0].keys()), bk)
n_bk = len(bk)

# ---------------------------------------------------------------- transaction details + lot numbers
tx = []
for f in sorted(glob.glob(f'{RAW}/v6_transaction_search/*.json')):
    tx += json.load(open(f)).get('transactionSummaries') or []
tx = list({(r['operationId'], r.get('subOperationId'), r.get('date')): r for r in tx}.values())
ops = collections.OrderedDict()
for r in sorted(tx, key=lambda r: (r['date'], r['operationId'], r.get('subOperationId') or 0)):
    ops.setdefault(r['operationId'], []).append(r)
n_det = n_lot = n_lot_skip = 0
lot_upd = []
for vop, rs in ops.items():
    oid = op_id.get(vop)
    if not oid:
        continue
    det = {}
    steps = []
    for r in rs:
        st = r.get('subOperationTypeName')
        if st and st not in steps:
            steps.append(st)
        ad = r.get('additionalDetails') or {}
        for k, v in ad.items():
            if v in (None, '', [], {}):
                continue
            if k == 'summary':
                det.setdefault('summary', [])
                if v not in det['summary']:
                    det['summary'].append(v)
            elif k == 'dockets':
                det.setdefault('dockets', [])
                det['dockets'] += [d for d in v if d not in det['dockets']]
            elif k == 'extraction':
                det.setdefault('parcels', [])
                det['parcels'] += (v or {}).get('parcels') or []
            else:
                det.setdefault(k, v)
        if r.get('jobNumber'):
            det.setdefault('job', r['jobNumber'])
    if len(steps) > 1:
        det['steps'] = steps
    if det:
        stmts.append(f'UPDATE operation SET details={q(det)} WHERE id={oid}')
        n_det += 1
    adds = [r['additionOps'] for r in rs if isinstance(r.get('additionOps'), dict) and r['additionOps'].get('additive')]
    have = add_rows.get(oid, [])
    if any(a.get('lotNumbers') or a.get('changeToState') for a in adds):
        if len(adds) != len(have):
            n_lot_skip += 1
            continue
        for a, aid in zip(adds, have):
            lot = ', '.join(str(x) for x in (a.get('lotNumbers') or []) if x) or None
            if lot or a.get('changeToState'):
                lot_upd.append(f'UPDATE op_addition SET lot={q(lot)}, change_to_state={q(a.get("changeToState"))} WHERE id={aid}')
                n_lot += 1
stmts += lot_upd

# ---------------------------------------------------------------- contacts
v6p = {p['id']: p for p in pages('v6_party_list', 'parties')}
n_party = 0
for p in pages('v7_identity_parties', 'results'):
    pid = party_id.get(p['id'])
    if not pid:
        continue
    nums = [{'type': c.get('type'), 'number': ' '.join(filter(None, [c.get('areaCode'), c.get('number')])) + (f" x{c['extension']}" if c.get('extension') else '')}
            for c in (p.get('contactNumbers') or []) if c.get('number')]
    o = v6p.get(p['id']) or {}
    phone = o.get('phone') or (nums[0]['number'] if nums else None)
    def addr(a):
        a = a or {}
        return ', '.join(filter(None, [a.get('mailingName'), a.get('street1'), a.get('street2'), a.get('city'), a.get('state'), a.get('postalCode'), a.get('country')])) or None
    addrs = {k: addr(p.get(k)) for k in ('address', 'postalAddress', 'billingAddress') if addr(p.get(k))}
    stmts.append(f"UPDATE party SET given_name={q(p.get('givenName'))}, surname={q(p.get('surname'))}, is_org={q(1 if p.get('type') == 'ORGANIZATION' or o.get('isOrganization') else 0)}, "
                 f"phone={q(phone)}, email={q(p.get('email') or o.get('email'))}, address={q(addrs.get('address') or o.get('address') or next(iter(addrs.values()), None))}, "
                 f"contacts={q({'numbers': nums, 'addresses': addrs, 'government_no': p.get('governmentNumber')} if (nums or addrs) else None)} WHERE id={pid}")
    n_party += 1

# ---------------------------------------------------------------- stock item cost / location / tax state (Vintrace inventory snapshot)
inv = pages('v6_inventory', 'inventorySummaries')
asof = None
mf = glob.glob(f'{RAW}/v6_inventory/_meta.json')
by = collections.defaultdict(list)
for it in inv:
    by[it['code']].append(it)
n_item = 0
for code, its in by.items():
    iid = item_id.get(code)
    if not iid:
        continue
    qty = sum((i.get('quantity') or 0) for i in its)
    tot = sum((i.get('totalCost') or 0) for i in its)
    uc = its[0].get('unitCost')
    det = {k: sum((i.get(k) or 0) for i in its) for k in ('fruitCost', 'bulkCost', 'additiveCost', 'operationCost', 'packagingCost', 'storageCost', 'overheadCost', 'freightCost', 'otherCost')}
    det = {k: v for k, v in det.items() if v}
    loc = '; '.join(sorted({i.get('location') for i in its if i.get('location')})) or None
    ts = '; '.join(sorted({i.get('taxState') for i in its if i.get('taxState')})) or None
    stmts.append(f"UPDATE stock_item SET unit_cost={q(uc)}, total_cost={q(round(tot, 2))}, cost_detail={q(det or None)}, location={q(loc)}, tax_state={q(ts)}, "
                 f"cost_as_of={q(T(max((i.get('date') or 0) for i in its)) or None)} WHERE id={iid}")
    n_item += 1

RUN(stmts)
print(json.dumps({'cost_txn': n_cost, 'work_orders': n_wo, 'bookings': n_bk, 'intakes_detailed': n_int, 'ops_with_details': n_det,
                  'lot_lines': n_lot, 'lot_ops_skipped_count_mismatch': n_lot_skip, 'parties': n_party, 'stock_items_costed': n_item,
                  'statements': len(stmts)}))
