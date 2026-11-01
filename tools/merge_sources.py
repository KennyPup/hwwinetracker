"""Merge the SOURCES tab of the "HW winemaking cookbook" (Google Sheet, exported to .xlsx) into the tracker's contacts
(table party), plus the suppliers named on the BASIC ADDS tab. Existing Vintrace contacts are matched and enriched;
the rest are added. Re-runnable: a contact merged before is updated, not duplicated.

Usage: python merge_sources.py <cookbook.xlsx> sqlite <db> | cloud <admin url> <token file> <main|practice>"""
import sys, json, re, sqlite3, urllib.request, urllib.parse
import openpyxl

XLSX, MODE = sys.argv[1], sys.argv[2]
if MODE == 'sqlite':
    con = sqlite3.connect(sys.argv[3]); con.row_factory = sqlite3.Row
    Q = lambda s: [dict(r) for r in con.execute(s)]
    def RUN(st):
        with con:
            for s in st: con.execute(s)
else:
    URL, TOK, INST = sys.argv[3], open(sys.argv[4]).read().strip(), sys.argv[5]
    H = {'x-admin': TOK, 'x-instance': INST, 'User-Agent': 'hwt-merge', 'content-type': 'application/json'}
    Q = lambda s: json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/q?q=' + urllib.parse.quote(s), headers=H), timeout=120).read())
    def RUN(st):
        r = json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/_admin/sql', data=json.dumps({'stmts': st}).encode(), headers=H), timeout=300).read())
        if 'error' in r: raise SystemExit(r)

q = lambda v: 'NULL' if v in (None, '') else "'" + str(v).replace("'", "''") + "'"
clean = lambda s: re.sub(r'[ \t]+', ' ', re.sub(r'\s*\n\s*', '\n', str(s or '').strip())) or None
have = {r['name'] for r in Q("SELECT name FROM pragma_table_info('party')")}
st = [f'ALTER TABLE party ADD COLUMN {c} TEXT' for c in ('contact_person', 'products', 'website', 'ship_to', 'aka', 'source') if c not in have]
if st: RUN(st)

# cookbook vendor name -> existing (Vintrace) contact name; None = add as a new contact
MATCH = {
    'Merrill Blueberry Farm': 'Merrill Wild Blueberries', 'Bluewater Farms': 'Bluewater Farms', 'Apple Hill Farm': 'Apple Hill Farm',
    'Cape Cod Select': 'Cape Cod Select', 'Hemingway Farms': 'Hemingway Farms', 'Steve Cybulski': 'Blackwater Mustard Co',
    'Brookdale Farm, NH': 'Brookdale Fruit Farm', 'Autumnview Farm': 'Bob Perkins', 'Hall Apiary': 'Hall Apiaries',
    'Stone Mountain Farms': 'Stone Mountain Farm', 'Wayside Farm & Great Northern Berries': 'Great Northern Berries',
    "Alyson's Orchard": "Alyson's Orchard", 'Scott Farm': 'Scott Farm', 'Woodman Research Farm': 'UNH',
    'Gino Pinto - NJ Farm broker': 'Gino Pinto', 'Dixieland Farm': 'Dixieland Organics', 'Fisher Brothers Farm': 'Fisher Brothers Farm',
}
EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
PHONE = re.compile(r'(?:\(?\d{3}\)?[ .-]?)?\d{3}[ .-]\d{4}(?:\s*(?:x|#)\s*\d+)?')
URLRX = re.compile(r'(?:https?://|www\.)\S+')

ws = openpyxl.load_workbook(XLSX)['SOURCES']
recs = []
for row in ws.iter_rows(min_row=2):
    cells = {c.column_letter: c for c in row}
    a = clean(cells['A'].value) if 'A' in cells else None
    b = clean(cells['B'].value) if 'B' in cells else None
    c = clean(cells['C'].value) if 'C' in cells else None
    d = clean(cells['D'].value) if 'D' in cells else None
    e = clean(cells['E'].value) if 'E' in cells else None
    f = cells.get('F')
    link = (f.hyperlink.target if f is not None and f.hyperlink else None) or (clean(f.value) if f is not None else None)
    if not (a or b):
        continue
    if not a and b and URLRX.match(b):            # rows 28-30: herb farm links only
        host = re.sub(r'^(https?://)?(www\.)?', '', b).split('/')[0]
        recs.append({'vendor': host, 'products': 'dried herbs / botanicals', 'website': b})
        continue
    lines = (a or '').split('\n')
    vendor, person = lines[0].strip(), '; '.join(x.strip() for x in lines[1:] if x.strip()) or None
    text = '\n'.join(x for x in (c, d, e) if x)
    m = re.match(r'^([A-Z][a-z]+(?: [A-Z][a-z]+)+)[,.]?\s', c or '')   # "Chris Hemingway, 603-..." -> person
    if not person and m and not PHONE.match(c):
        person = m.group(1)
    emails = list(dict.fromkeys(x.rstrip('.') for x in EMAIL.findall(c or '') or EMAIL.findall(e or '')))
    phones = list(dict.fromkeys(p.strip() for p in PHONE.findall(c or '')))
    web = link or (URLRX.search(text).group(0) if URLRX.search(text) else None)
    recs.append({'vendor': vendor, 'contact_person': person, 'products': b, 'phone': ', '.join(phones) or None, 'email': ', '.join(emails) or None,
                 'contact_text': c, 'ship_to': d, 'notes': e, 'website': web})
# suppliers named on BASIC ADDS ("order from BSG" / "order from Scott Labs")
recs.append({'vendor': 'Scott Labs', 'products': 'Scottzyme HC and Pec5L pectic enzymes, yeast, GoFerm, FermaidK (cookbook BASIC ADDS)'})
recs.append({'vendor': 'BSG', 'products': 'KMS (metabisulfite), bentonite (cookbook BASIC ADDS)'})

existing = {r['name']: r for r in Q('SELECT id, name, phone, email, address, notes, roles, source FROM party')}
def fmt_addr(s):
    if s and s.strip().startswith('{'):
        try:
            a = json.loads(s)
            return ', '.join(x for x in [a.get('street1'), a.get('street2'), a.get('city'), a.get('state'), a.get('postalCode') or a.get('zipcode'), a.get('country')] if x and str(x).strip()) or None
        except ValueError:
            return s
    return s
st, n_upd, n_new = [], 0, 0
for r in existing.values():                         # tidy addresses imported as raw JSON
    if r['address'] and r['address'].strip().startswith('{'):
        st.append(f"UPDATE party SET address={q(fmt_addr(r['address']))} WHERE id={r['id']}")
for r in recs:
    target = MATCH.get(r['vendor'], r['vendor'] if r['vendor'] in existing else None)
    notes = '\n'.join(x for x in [r.get('notes'), (('Contact: ' + r['contact_text']) if r.get('contact_text') and not r.get('phone') and not r.get('email') else None)] if x) or None
    if target and target in existing:
        ex = existing[target]
        merged = 'cookbook' in (ex.get('source') or '')      # already merged once: keep what is there
        phone = ex['phone'] if merged else (r.get('phone') or ex['phone'])
        if not merged and r.get('phone') and ex['phone'] and re.sub(r'\D', '', ex['phone'])[-7:] not in re.sub(r'\D', '', r['phone']):
            phone = f"{r['phone']}; Vintrace: {ex['phone']}"
        email = ex['email'] if merged else (r.get('email') or ex['email'])
        if not merged and r.get('email') and ex['email'] and ex['email'].lower() not in r['email'].lower():
            email = f"{r['email']}, {ex['email']}"
        roles = ex['roles'] or ''
        if 'SUPPLIER' not in roles.upper():
            roles = ','.join(x for x in [roles, 'SUPPLIER'] if x)
        st.append(f"UPDATE party SET aka={q(r['vendor'] if r['vendor'] != target else None)}, contact_person={q(r.get('contact_person'))}, products={q(r.get('products'))}, "
                  f"website={q(r.get('website'))}, ship_to={q(r.get('ship_to'))}, phone={q(phone)}, email={q(email)}, roles={q(roles)}, "
                  f"notes={q(notes or ex['notes'])}, source={q(ex.get('source') if merged else ('cookbook SOURCES' if (ex.get('source') or '') == 'cookbook SOURCES' else 'Vintrace + cookbook SOURCES'))} WHERE id={ex['id']}")
        n_upd += 1
    else:
        st.append(f"INSERT INTO party(name, roles, contact_person, products, phone, email, website, ship_to, notes, source) VALUES ({q(r['vendor'])}, 'SUPPLIER', "
                  f"{q(r.get('contact_person'))}, {q(r.get('products'))}, {q(r.get('phone'))}, {q(r.get('email'))}, {q(r.get('website'))}, {q(r.get('ship_to'))}, {q(notes)}, 'cookbook SOURCES')")
        existing[r['vendor']] = {'id': None, 'name': r['vendor'], 'phone': None, 'email': None, 'address': None, 'notes': None, 'roles': 'SUPPLIER', 'source': 'cookbook SOURCES'}
        n_new += 1
RUN(st)
print(json.dumps({'cookbook_rows': len(recs), 'matched_existing': n_upd, 'added': n_new}))
