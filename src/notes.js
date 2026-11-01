// Port of notes.py (runtime part). Importing Vintrace notes stays on the laptop (raw files); the sync pushes the tables.
import { nowIso } from './lib/py.js';
import { notes as S } from './gen/strings.js';

export const APP_BASE = S.APP_BASE;
export const STAMP_RX = /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?)/;

export function ensure_schema(db) {
  db.script(S.SCHEMA);
}

export function add_note(db, when, batch_id, vessel_id, text, who = 'HWWineTracker') {
  text = (text || '').trim();
  when = (when || nowIso().slice(0, 16)).slice(0, 16);
  if (!text || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*—?$/.test(text)) throw new Error('The note is empty.');
  if (!STAMP_RX.test(text)) text = `${when.replace('T', ' ')} — ${text}`;   // every note starts with its date and time
  if (!batch_id) throw new Error('Pick a batch.');
  ensure_schema(db);
  const nid = Math.max(APP_BASE, (db.val('SELECT MAX(id) FROM batch_note') || 0) + 1);
  const cont = vessel_id ? db.one('SELECT code FROM vessel WHERE id=?', vessel_id) : null;
  db.run("INSERT INTO batch_note(id,noted_at,who,detail,batch_id,vessel_id,container,source,created_at) VALUES (?,?,?,?,?,?,?,'app',?)",
    nid, when, who, text, batch_id, vessel_id || null, cont ? cont.code : null, nowIso());
  db.run('INSERT OR IGNORE INTO note_link VALUES (?,?)', nid, batch_id);
  return nid;
}

export function has_notes(db) {
  return !!db.one("SELECT 1 x FROM sqlite_master WHERE name='batch_note'");
}

// Notes Vintrace shows on this wine (own + carried in from wines blended/racked into it), newest first.
export function for_batch(db, bid) {
  if (!has_notes(db)) return [];
  return db.all(`SELECT n.*, b.code bcode FROM batch_note n LEFT JOIN batch b ON b.id=n.batch_id
                 WHERE n.batch_id=? OR n.id IN (SELECT note_id FROM note_link WHERE batch_id=?) ORDER BY n.noted_at DESC, n.id DESC`, bid, bid);
}

export function recent(db, limit = 15) {
  if (!has_notes(db)) return [];
  return db.all('SELECT n.*, b.code bcode FROM batch_note n LEFT JOIN batch b ON b.id=n.batch_id ORDER BY n.noted_at DESC, n.id DESC LIMIT ?', limit);
}

const likeEsc = q => '%' + q.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';

export function search(db, q, limit = 60) {
  if (!has_notes(db) || !q) return [];
  return db.all(`SELECT n.*, b.code bcode FROM batch_note n LEFT JOIN batch b ON b.id=n.batch_id WHERE n.detail LIKE ? ESCAPE '\\'
                 ORDER BY n.noted_at DESC LIMIT ?`, likeEsc(q), limit);
}

// All notes for the Notes page. Returns [rows, total].
export function listing(db, text = '', batch = '', year = '', source = '', order = 'new', limit = 200, offset = 0) {
  if (!has_notes(db)) return [[], 0];
  const w = ['1=1'], a = [];
  if (text) { w.push("n.detail LIKE ? ESCAPE '\\'"); a.push(likeEsc(text)); }
  if (batch) {
    w.push('(b.code LIKE ? OR n.id IN (SELECT l.note_id FROM note_link l JOIN batch b2 ON b2.id=l.batch_id WHERE b2.code LIKE ?))');
    a.push(`%${batch}%`, `%${batch}%`);
  }
  if (year) { w.push('substr(n.noted_at,1,4)=?'); a.push(year); }
  if (source === 'vintrace' || source === 'app') { w.push('n.source=?'); a.push(source); }
  if (source === 'nobatch') w.push('n.batch_id IS NULL');
  const ob = { old: 'n.noted_at, n.id', batch: 'b.code, n.noted_at DESC' }[order] || 'n.noted_at DESC, n.id DESC';
  const base = `FROM batch_note n LEFT JOIN batch b ON b.id=n.batch_id WHERE ${w.join(' AND ')}`;
  const total = db.val('SELECT COUNT(*) ' + base, ...a);
  const rows = db.all(`SELECT n.*, b.code bcode, (SELECT COUNT(*) FROM note_link l WHERE l.note_id=n.id) nlinks ${base} ORDER BY ${ob} LIMIT ? OFFSET ?`, ...a, limit, offset);
  return [rows, total];
}

export function stats(db) {
  if (!has_notes(db)) return {};
  return db.one(`SELECT COUNT(*) total, SUM(source='vintrace') vintrace, SUM(source='app') app, SUM(batch_id IS NULL) nobatch, SUM(attachments IS NOT NULL) att,
                 MIN(noted_at) first, MAX(noted_at) last FROM batch_note`);
}
