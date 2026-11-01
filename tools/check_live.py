"""Compare every page of the live Cloudflare app with the laptop app (Python) on the same database.
usage: python check_live.py urls.json http://127.0.0.1:PORT admin_token_file [instance]"""
import json, sys, re, urllib.request, urllib.parse, concurrent.futures as cf, difflib
U = json.load(open(sys.argv[1])); A = sys.argv[2]; T = open(sys.argv[3]).read().strip(); INST = sys.argv[4] if len(sys.argv) > 4 else 'main'
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
local = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedir)
remote = urllib.request.build_opener(NoRedir)
def get(op, url, hdr={}):
    try:
        r = op.open(urllib.request.Request(url, headers=hdr), timeout=120); return r.status, r.read().decode('utf-8', 'replace'), r.headers.get('Location')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), e.headers.get('Location')
def norm(s):
    s = re.sub(r'name="_t" value="[0-9a-f]+"', 'name="_t" value="T"', s)
    s = re.sub(r'<div class="banner">.*?</div>', '<div class="banner">B</div>', s)
    return s
def one(u):
    a = get(local, A + u)
    b = get(remote, 'https://hwwinetracker-admin.ken-7ec.workers.dev/_admin/render?path=' + urllib.parse.quote(u, safe=''),
            {'x-admin': T, 'x-instance': INST, 'user-agent': 'HWWineTracker-check/1.0'})
    return u, (a[0] == b[0] and norm(a[1]) == norm(b[1]) and a[2] == b[2]), a, b
bad = []
with cf.ThreadPoolExecutor(6) as ex:
    for u, same, a, b in ex.map(one, U):
        if not same: bad.append((u, a, b))
print('pages', len(U), 'different', len(bad))
for u, a, b in bad[:10]:
    print('==', u, a[0], b[0])
    x, y = norm(a[1]), norm(b[1])
    sm = difflib.SequenceMatcher(None, x, y, autojunk=False)
    for tag, i1, i2, j1, j2 in [o for o in sm.get_opcodes() if o[0] != 'equal'][:2]:
        print('   ', tag, repr(x[max(0, i1 - 60):i2 + 30])[:200], '\n     ->', repr(y[max(0, j1 - 60):j2 + 30])[:200])
