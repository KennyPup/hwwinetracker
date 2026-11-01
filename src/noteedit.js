// v1.1.1 — edit an existing note (Vintrace-imported or HWWineTracker): text, date/time, batch, vessel.
// Notes are HWWineTracker's own data, so this works in the real records too. Every edit keeps the previous version in
// note_edit (who, when, old values), shown under the form; the card shows "edited".
import { E, nowIso, today, addDays } from './lib/py.js';
import { ctx, page } from './core.js';
import { note_flag_field, save_note_flag } from './film.js';

export function ensure_schema(db) {
  db.run(`CREATE TABLE IF NOT EXISTS note_edit(id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL, edited_at TEXT, by TEXT,
          old_noted_at TEXT, old_detail TEXT, old_batch_id INTEGER, old_vessel_id INTEGER)`);
  db.run('CREATE INDEX IF NOT EXISTS ix_note_edit_note ON note_edit(note_id)');
  if (db.one("SELECT 1 x FROM sqlite_master WHERE name='batch_note'") && !db.columns('batch_note').includes('edited_at')) db.run('ALTER TABLE batch_note ADD COLUMN edited_at TEXT');
}

const back_of = n => (n.batch_id ? `/batch/${n.batch_id}?tab=notes` : '/notes');

export function edit_page(c, nid, f = null, err = '', back = '') {
  const n = c.one('SELECT n.*, b.code bcode FROM batch_note n LEFT JOIN batch b ON b.id=n.batch_id WHERE n.id=?', nid);
  if (!n) return null;
  const v = f || { when: String(n.noted_at || '').slice(0, 16).replace(' ', 'T'), batch_id: n.batch_id, vessel_id: n.vessel_id, text: n.detail || '' };
  const bo = c.all('SELECT id, code, description FROM batch ORDER BY production_year DESC, code COLLATE NOCASE')
    .map(b => `<option value="${b.id}" ${String(b.id) === String(v.batch_id) ? 'selected' : ''}>${E(b.code)}${b.description ? ' · ' + E(b.description) : ''}</option>`).join('');
  const vo = '<option value="">—</option>' + c.all("SELECT id, code FROM vessel WHERE is_virtual=0 OR id=? ORDER BY code COLLATE NOCASE", n.vessel_id || 0)
    .map(x => `<option value="${x.id}" ${String(x.id) === String(v.vessel_id || '') ? 'selected' : ''}>${E(x.code)}</option>`).join('');
  const hist = c.all('SELECT * FROM note_edit WHERE note_id=? ORDER BY id DESC', nid);
  const hh = hist.length ? `<h2>Earlier versions (${hist.length})</h2>` + hist.map(h => `<div class="ncard"><div class="h"><span>Before the edit of ${E(String(h.edited_at).slice(0, 16).replace('T', ' '))}${h.by ? ' by ' + E(h.by) : ''}</span>
      <span class="muted" style="font-weight:400">${E(String(h.old_noted_at || '').replace('T', ' '))}</span></div><div class="t">${E((h.old_detail || '').trim())}</div></div>`).join('') : '';
  const ret = back || back_of(n);
  const body = `<h1>Edit note</h1>${err}<p class="sub">${n.source === 'vintrace' ? 'Imported from Vintrace' : 'Entered in HWWineTracker'} · the previous version is kept below the form after saving. Photos are kept as they are (add more with ＋ photo).</p>
<form class="entry" method="post" action="/notes/edit"><input type="hidden" name="_t" value="${E(ctx.token)}"><input type="hidden" name="note" value="${n.id}"><input type="hidden" name="back" value="${E(ret)}">
<label style="flex:0 1 220px">When<input type="datetime-local" name="when" value="${E(v.when)}" required></label>
<label style="flex:1 1 320px">Batch<select name="batch_id" required>${bo}</select></label>
<label style="flex:0 1 200px">Vessel<select name="vessel_id">${vo}</select></label>${note_flag_field(c, n.id, v.text)}
<label class="wide">Note<textarea name="text" rows="12" required style="font:inherit;line-height:1.45;padding:8px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg)">${E(v.text)}</textarea></label>
<div class="actions"><button>Save</button> <a href="${E(ret)}">Cancel</a></div></form>${hh}`;
  return page('Edit note', body, '/notes', [['Notes', '/notes'], ['Edit note', null]]);
}

export function post_edit(c, f) {
  const g = k => (f[k] && f[k].length ? String(f[k][0]) : '');
  const nid = parseInt(g('note') || '0', 10);
  const n = c.one('SELECT * FROM batch_note WHERE id=?', nid);
  if (!n) return [null, 'Note not found.'];
  const text = g('text').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (!text.trim()) return [null, 'The note is empty.'];
  const when = g('when').replace(' ', 'T').slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return [null, 'Date/time not understood.'];
  if (when.slice(0, 10) > addDays(today(), 1)) return [null, 'The date is in the future.'];
  const bid = parseInt(g('batch_id') || '0', 10);
  if (!bid || !c.one('SELECT 1 x FROM batch WHERE id=?', bid)) return [null, 'Pick a batch.'];
  const vid = g('vessel_id') ? parseInt(g('vessel_id'), 10) : null;
  const vc = vid ? c.one('SELECT code FROM vessel WHERE id=?', vid) : null;
  if (vid && !vc) return [null, 'Unknown vessel.'];
  save_note_flag(c, nid, g('film'));   // the film-yeast override is saved even when nothing else changed
  const same = text === (n.detail || '').replace(/\s+$/, '') && when === String(n.noted_at).slice(0, 16) && bid === n.batch_id && (vid ?? null) === (n.vessel_id ?? null);
  const back = /^\/[A-Za-z0-9/_?=&.-]*$/.test(g('back')) ? g('back') : `/batch/${bid}?tab=notes`;
  if (same) return [back, null];
  c.run('INSERT INTO note_edit(note_id, edited_at, by, old_noted_at, old_detail, old_batch_id, old_vessel_id) VALUES (?,?,?,?,?,?,?)',
    nid, nowIso(), ctx.user || 'HARDCASTLE, Ken', n.noted_at, n.detail, n.batch_id, n.vessel_id);
  const cont = (vid ?? null) === (n.vessel_id ?? null) ? n.container : (vc ? vc.code : null);
  c.run('UPDATE batch_note SET detail=?, noted_at=?, batch_id=?, vessel_id=?, container=?, edited_at=? WHERE id=?', text, when, bid, vid, cont, nowIso(), nid);
  if (bid !== n.batch_id) {   // the note's own link moves with it; links carried in from blends stay
    if (n.batch_id) c.run('DELETE FROM note_link WHERE note_id=? AND batch_id=?', nid, n.batch_id);
    c.run('INSERT OR IGNORE INTO note_link VALUES (?,?)', nid, bid);
  }
  return [bid !== n.batch_id ? `/batch/${bid}?tab=notes` : back, null];
}
