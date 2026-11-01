import json, sys, urllib.request, urllib.parse, datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York')
URL = 'https://hwwinetracker-admin.ken-7ec.workers.dev'; TOK = open(sys.argv[2]).read().strip(); INST = sys.argv[1]
H = {'x-admin': TOK, 'x-instance': INST, 'User-Agent': 'hwt-sync', 'content-type': 'application/json'}
Q = lambda s: json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/q?q=' + urllib.parse.quote(s), headers=H), timeout=120).read())
def RUN(st):
    r = json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/sql', data=json.dumps({'stmts': st}).encode(), headers=H), timeout=300).read())
    if 'error' in r: raise SystemExit(r)
T = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, ET).strftime('%Y-%m-%d %H:%M:%S')
q = lambda v: 'NULL' if v is None else ("'" + str(v).replace("'", "''") + "'")
now = {r['id']: r for r in json.load(open('disp_now.json'))}
item = {r['code']: r['id'] for r in Q('SELECT id, code FROM stock_item')}
st = ['''CREATE TABLE IF NOT EXISTS data_correction(id INTEGER PRIMARY KEY, tbl TEXT, row_id INTEGER, field TEXT, old_value TEXT, new_value TEXT,
         reason TEXT, applied_at TEXT, UNIQUE(tbl, row_id, field))''']
# 1. dispatches changed in Vintrace after the 1 Oct pull: reversed flags and new ones
have = {r['vt_id']: r for r in Q('SELECT id, vt_id, reversed FROM dispatch WHERE vt_id IS NOT NULL')}
maxbol = max(int(r['bol']) for r in Q("SELECT bol FROM dispatch WHERE bol GLOB '[0-9]*'"))
nrev = nnew = 0
for vid, r in sorted(now.items()):
    h = have.get(vid)
    if h and bool(h['reversed']) != bool(r['reversed']):
        st.append(f"UPDATE dispatch SET reversed={1 if r['reversed'] else 0}, modified_at={q(T(r['modifiedTime']))} WHERE vt_id={vid}")
        if r['reversed']:
            st.append(f"DELETE FROM stock_event WHERE vt_ref={vid} AND action='Dispatch' AND source='vintrace'")
        nrev += 1
    elif not h:
        maxbol += 1
        st.append(f"INSERT INTO dispatch(occurred_at,bol,dispatch_type,destination,operator,reversed,modified_at,source,vt_id) VALUES ({q(T(r['occurredTime']))},{q(maxbol)},{q(r['dispatchType']['name'])},{q((r.get('destination') or {}).get('name') if isinstance(r.get('destination'), dict) else r.get('destination'))},{q((r.get('operator') or {}).get('name') if isinstance(r.get('operator'), dict) else r.get('operator'))},{1 if r['reversed'] else 0},{q(T(r['modifiedTime']))},'vintrace',{vid})")
        for i in r['stockItems']:
            iid = item[i['item']['code']]; qty = i['quantity']['value']
            st.append(f"INSERT INTO dispatch_line(dispatch_id,item_id,quantity,unit) VALUES ((SELECT id FROM dispatch WHERE vt_id={vid}),{iid},{qty!r},{q(i['quantity'].get('unit'))})")
            if not r['reversed']:
                st.append(f"INSERT INTO stock_event(item_id,occurred_at,action,quantity,source,vt_ref) VALUES ({iid},{q(T(r['occurredTime']))},'Dispatch',{-qty!r},'vintrace',{vid})")
        nnew += 1
RUN(st)
# 2. phantom stock: inactive items Vintrace shows at 0 but whose history does not net to 0 -> zeroing correction
inv = json.load(open('inv_now.json'))['inventorySummaries']
vt = {}
for i in inv:
    if i['type'] != 'Wine Batch':
        vt[i['code']] = vt.get(i['code'], 0) + (i['quantity'] or 0)
rows = Q("SELECT si.id, si.code, si.inactive, SUM(se.quantity) q FROM stock_item si JOIN stock_event se ON se.item_id=si.id GROUP BY si.id HAVING ABS(SUM(se.quantity))>1e-6")
st, nph, tot = [], 0, 0
for r in rows:
    if abs(vt.get(r['code'], 0)) < 1e-6 and r['code'] not in [x for x in vt if vt[x]]:
        if Q(f"SELECT 1 x FROM data_correction WHERE tbl='stock_item' AND row_id={r['id']} AND field='on_hand'"):
            continue
        st.append(f"INSERT INTO stock_event(item_id,occurred_at,action,quantity,notes,source) VALUES ({r['id']},'2026-10-02 12:00:00','Correction',{-r['q']!r},'Zeroed: Vintrace shows 0 on hand but its history did not net to 0 (decided 2026-10-02)','app')")
        st.append(f"INSERT OR IGNORE INTO data_correction(tbl,row_id,field,old_value,new_value,reason,applied_at) VALUES ('stock_item',{r['id']},'on_hand',{q(r['q'])},'0','Phantom stock: Vintrace on hand is 0','2026-10-02 12:00')")
        nph += 1; tot += r['q']; print('  zero', r['code'], r['q'], 'inactive' if r['inactive'] else 'ACTIVE')
if st: RUN(st)
print(INST, {'dispatch_reversed_flag_changes': nrev, 'new_dispatches': nnew, 'phantom_items_zeroed': nph, 'units': tot})
