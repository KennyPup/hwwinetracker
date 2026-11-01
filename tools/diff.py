import json, sys, re, urllib.request, concurrent.futures as cf, difflib
U = json.load(open(sys.argv[1])); A, B = sys.argv[2], sys.argv[3]
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedir)
def get(base, u):
    try:
        r = op.open(base + u, timeout=120); return r.status, r.read().decode('utf-8', 'replace'), r.headers.get('Location')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), e.headers.get('Location')
def norm(s):
    s = re.sub(r'name="_t" value="[0-9a-f]+"', 'name="_t" value="T"', s)
    s = re.sub(r'<div class="banner">.*?</div>', '<div class="banner">B</div>', s)
    s = re.sub(r'<pre>Error.*', 'ERR', s, flags=re.S)
    return s
def one(u):
    a, b = get(A, u), get(B, u)
    same = a[0] == b[0] and norm(a[1]) == norm(b[1]) and a[2] == b[2]
    return u, same, a, b
bad = []
with cf.ThreadPoolExecutor(6) as ex:
    for u, same, a, b in ex.map(one, U):
        if not same: bad.append((u, a, b))
print('pages', len(U), 'different', len(bad))
for u, a, b in bad[:int(sys.argv[4]) if len(sys.argv) > 4 else 8]:
    print('==', u, a[0], b[0], a[2], b[2])
    if 'ERR' in norm(b[1]): print('   JS error:', re.search(r'<pre>(.{0,400})', b[1], re.S).group(1).replace('\n', ' | ')); continue
    if 'ERR' in norm(a[1]): print('   PY error:', re.search(r'<pre>(.{0,400})', a[1], re.S).group(1)[-400:].replace('\n', ' | ')); continue
    x, y = norm(a[1]), norm(b[1])
    sm = difflib.SequenceMatcher(None, x, y, autojunk=False)
    for tag, i1, i2, j1, j2 in [o for o in sm.get_opcodes() if o[0] != 'equal'][:3]:
        print('   ', tag, repr(x[max(0, i1 - 60):i2 + 30])[:220], '\n     ->', repr(y[max(0, j1 - 60):j2 + 30])[:220])
json.dump([u for u, a, b in bad], open('/tmp/claude-0/-home-claude/a0bab8cc-f243-5a8e-95bf-ceb92f034c80/scratchpad/bad.json', 'w'))
