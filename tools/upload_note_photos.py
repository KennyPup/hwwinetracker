"""Upload the Vintrace note photos (claude_work/vintrace_archive/note_photos) into the tracker: web size (≤1600 px JPEG)
plus a 320 px thumbnail, linked to the note by Vintrace file id. Originals stay in the archive folder.
Usage: python upload_note_photos.py <photo dir> <admin url> <token file> <main|practice>"""
import sys, os, io, json, base64, urllib.request, urllib.parse, datetime
from PIL import Image, ImageOps
DIR, URL, TOK, INST = sys.argv[1], sys.argv[2], open(sys.argv[3]).read().strip(), sys.argv[4]
H = {'x-admin': TOK, 'x-instance': INST, 'User-Agent': 'hwt-photos', 'content-type': 'application/json'}
op = urllib.request.build_opener()
def Q(s): return json.loads(op.open(urllib.request.Request(URL + '/_admin/q?q=' + urllib.parse.quote(s), headers=H), timeout=120).read())
idx = json.load(open(os.path.join(DIR, '_index.json')))
note_of = {}
for r in Q("SELECT id, attachments FROM batch_note WHERE attachments IS NOT NULL AND attachments NOT IN ('[]','')"):
    for a in json.loads(r['attachments']):
        if not a.get('local'): note_of[a['id']] = r['id']
have = {r['vt_file_id'] for r in Q("SELECT vt_file_id FROM note_file WHERE vt_file_id IS NOT NULL")} if Q("SELECT 1 x FROM sqlite_master WHERE name='note_file'") else set()
def jpeg(im, maxside, q):
    im = im.copy(); im.thumbnail((maxside, maxside), Image.LANCZOS)
    b = io.BytesIO(); im.convert('RGB').save(b, 'JPEG', quality=q, optimize=True); return b.getvalue(), im.size
n = skip = 0; miss = []
for fid, (name, ctype, size, _nid) in sorted(idx.items(), key=lambda x: int(x[0])):
    fid = int(fid)
    if fid in have: skip += 1; continue
    nid = note_of.get(fid)
    if not nid: miss.append(fid); continue
    path = os.path.join(DIR, f"{fid:05d}_{(name or 'photo.jpg').replace('/', '_')}")
    im = Image.open(path); exif = im.getexif(); taken = exif.get(36867) or exif.get(306)
    im = ImageOps.exif_transpose(im)
    q = 82
    while True:
        data, (w, h) = jpeg(im, 1600, q)
        if len(data) < 1_800_000 or q <= 50: break
        q -= 8
    thumb, _ = jpeg(im, 320, 70)
    if taken: taken = str(taken).replace(':', '-', 2)
    body = {'note_id': nid, 'vt_file_id': fid, 'name': name, 'mime': 'image/jpeg', 'width': w, 'height': h, 'orig_bytes': os.path.getsize(path),
            'taken_at': taken, 'source': 'vintrace', 'data': base64.b64encode(data).decode(), 'thumb': base64.b64encode(thumb).decode()}
    r = json.loads(op.open(urllib.request.Request(URL + '/_admin/put_file', data=json.dumps(body).encode(), headers=H), timeout=120).read())
    if not r.get('ok'): raise SystemExit(f'failed {fid}: {r}')
    n += 1
print(json.dumps({'instance': INST, 'uploaded': n, 'already_there': skip, 'no_note_in_tracker': miss}))
