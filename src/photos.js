// v0.9.6 — photos on notes. Vintrace note photos (imported) and photos added in HWWineTracker are stored in the
// database as a web-size JPEG (longest side ≤ 1600 px) plus a 320 px thumbnail; the full originals stay in
// claude_work/vintrace_archive/note_photos on the laptop.
import { E, nowIso } from './lib/py.js';
import { page } from './core.js';

export const MAX_BYTES = 1_900_000;   // Durable Object SQLite value limit is 2 MB

export function ensure_schema(c) {
  c.run(`CREATE TABLE IF NOT EXISTS note_file(id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL, vt_file_id INTEGER UNIQUE, file_name TEXT,
    mime TEXT, width INTEGER, height INTEGER, bytes INTEGER, orig_bytes INTEGER, taken_at TEXT, data BLOB, thumb BLOB, source TEXT, created_at TEXT)`);
  c.run('CREATE INDEX IF NOT EXISTS ix_note_file_note ON note_file(note_id)');
}

export function put_file(c, note_id, { name, mime = 'image/jpeg', data, thumb, width = null, height = null, vt_file_id = null, orig_bytes = null, taken_at = null, source = 'app' }) {
  if (!data || !data.byteLength) throw new Error('Empty photo.');
  if (data.byteLength > MAX_BYTES) throw new Error(`Photo too large (${Math.round(data.byteLength / 1024)} KB).`);
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('Photos must be JPEG, PNG or WebP.');
  if (vt_file_id !== null) c.run('DELETE FROM note_file WHERE vt_file_id=?', vt_file_id);
  const id = c.run(`INSERT INTO note_file(note_id, vt_file_id, file_name, mime, width, height, bytes, orig_bytes, taken_at, data, thumb, source, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, note_id, vt_file_id, name || 'photo.jpg', mime, width, height, data.byteLength, orig_bytes, taken_at,
    data, thumb || null, source, nowIso()).id;
  return id;
}

// thumbnails + links for a note (Vintrace attachments resolve by their Vintrace file id)
export function strip(n) {
  let at = [];
  try { at = n.attachments ? JSON.parse(n.attachments) : []; } catch (e) { at = []; }
  if (!at.length) return '';
  const imgs = at.map(a => {
    const base = a.local ? `/notefile/${a.id}` : `/notefile/vt/${a.id}`;
    return `<a href="${base}" target="_blank" rel="noopener" title="${E(a.fileName || '')}"><img src="${base}/thumb" loading="lazy" alt="${E(a.fileName || 'photo')}" style="height:84px;width:auto;border-radius:6px;border:1px solid var(--line,#30363d);margin:4px 6px 0 0"></a>`;
  }).join('');
  return `<div class="nphotos">${imgs}</div>`;
}

export function serve(c, path) {
  let m = path.match(/^\/notefile\/(vt\/)?(\d+)(\/thumb)?$/);
  if (!m) return null;
  const r = c.one(`SELECT mime, ${m[3] ? 'COALESCE(thumb, data)' : 'data'} AS b FROM note_file WHERE ${m[1] ? 'vt_file_id' : 'id'}=?`, Number(m[2]));
  if (!r || !r.b) return new Response('Photo not found', { status: 404 });
  return new Response(r.b, { headers: { 'content-type': r.mime || 'image/jpeg', 'cache-control': 'private, max-age=2592000' } });
}

// base64 (from the browser, already resized) -> Uint8Array
export function b64(s) {
  s = String(s || '').replace(/^data:[^,]*,/, '');
  if (!s) return null;
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// photos posted with a note form: photo_data / photo_thumb / photo_name / photo_wh (repeated, same order)
export function attach_posted(c, note_id, f) {
  const D = f.photo_data || [], T = f.photo_thumb || [], N = f.photo_name || [], WH = f.photo_wh || [];
  const added = [];
  for (let i = 0; i < D.length; i++) {
    const data = b64(D[i]);
    if (!data) continue;
    const [w, h] = String(WH[i] || '').split('x').map(Number);
    const id = put_file(c, note_id, { name: N[i] || `photo${i + 1}.jpg`, data, thumb: b64(T[i]), width: w || null, height: h || null });
    added.push({ id, local: 1, fileName: N[i] || `photo${i + 1}.jpg`, contentType: 'image/jpeg' });
  }
  if (added.length) {
    const row = c.one('SELECT attachments FROM batch_note WHERE id=?', note_id);
    let at = [];
    try { at = row && row.attachments ? JSON.parse(row.attachments) : []; } catch (e) { at = []; }
    c.run('UPDATE batch_note SET attachments=? WHERE id=?', JSON.stringify([...at, ...added]), note_id);
  }
  return added.length;
}

// file picker that resizes in the browser (≤1600 px JPEG + 320 px thumbnail) and adds hidden fields to the form
export function picker(label = 'Photos') {
  return `<label class="wide">${E(label)} <span class="muted" style="font-weight:400">— take or choose photos; they are resized before upload</span>
    <input type="file" accept="image/*" multiple class="phpick" style="margin-top:4px"></label><div class="phprev" style="flex:1 1 100%"></div>
  <script>(function(){const inp=document.currentScript.previousElementSibling.previousElementSibling.querySelector('.phpick'),prev=document.currentScript.previousElementSibling,form=inp.closest('form');
  function shrink(img,max,q){const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return [c.toDataURL('image/jpeg',q),c.width+'x'+c.height]}
  function hid(n,v){const i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;form.appendChild(i);return i}
  inp.onchange=()=>{[...inp.files].forEach(f=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const [d,wh]=shrink(img,1600,0.82),[t]=shrink(img,320,0.7);
    const box=document.createElement('span');box.style.cssText='display:inline-block;margin:4px 8px 0 0;text-align:center;font-size:11px';
    const th=new Image();th.src=t;th.style.cssText='height:72px;border-radius:6px;display:block';box.append(th);
    const hs=[hid('photo_data',d),hid('photo_thumb',t),hid('photo_name',f.name.replace(/\\.[^.]+$/,'')+'.jpg'),hid('photo_wh',wh)];
    const x=document.createElement('a');x.href='#';x.textContent='remove';x.onclick=e=>{e.preventDefault();hs.forEach(h=>h.remove());box.remove()};box.append(x);prev.append(box)};img.src=r.result};r.readAsDataURL(f)});inp.value=''};})();</script>`;
}

// add photos to an existing note
export function page_add(c, note_id, token, err = '') {
  const n = c.one('SELECT n.*, b.code bcode FROM batch_note n LEFT JOIN batch b ON b.id=n.batch_id WHERE n.id=?', note_id);
  if (!n) return null;
  const body = `<h1>Add photos to a note</h1>${err}<p class="sub">${E(n.bcode || '')} · ${E(String(n.noted_at).replace('T', ' '))}</p>
    <div class="ncard"><div class="t">${E((n.detail || '').trim())}</div>${strip(n)}</div>
    <form class="entry" method="post" action="/notes/photo"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="note" value="${n.id}">
    ${picker()}<div class="actions"><button>Save photos</button> <a href="${n.batch_id ? `/batch/${n.batch_id}?tab=notes` : '/notes'}">Cancel</a></div></form>`;
  return page('Add photos', body, '/notes', [['Notes', '/notes'], ['Add photos', null]]);
}
