// v1.1 — Correct & replay (Vintrace's "correct and replay"), and batch rename.
//
// Every entry form that records operations is kept with its operations (op_input: the form as submitted, with the time
// filled in). To correct an entry, its form opens again with the saved values; on Save:
//   1. the original operations are reversed (kept on file, marked reversed, linked to their replacement in op_change);
//   2. every later entry that shares a tank, barrel or stock item with the change is replayed in time order from its own
//      saved form, so volumes, contents, TTB and stock flow forward from the corrected figures. A later dip or stock count
//      stays as measured (it was a measurement); an addition's "volume after" moves by the same amount it did originally;
//   3. if any replayed entry no longer works (e.g. a transfer would take more than the tank now holds), nothing is saved
//      and the message names that entry.
// Entries that don't touch an affected vessel or stock item are left exactly as they are. Reverse uses the same replay,
// so any entry can be reversed, not only the latest on each vessel.
// Imported Vintrace history and entries made before v1.1 have no saved form: those keep the old rules.
import { E, nowIso } from './lib/py.js';
import { ctx, page } from './core.js';
import * as entry from './entry.js';
import { EntryError, pyInt } from './entry.js';
import * as ui_entry from './ui_entry.js';
import * as ui_entry2 from './ui_entry2.js';
import * as mobile from './mobile.js';

export const PATHS = new Set(['/record/press', '/record/treatment', '/record/lab', '/record/addition', '/record/transfer', '/record/measure', '/record/declare',
  '/record/intake', '/record/fill', '/record/changebatch', '/record/ferment', '/record/blend', '/record/split', '/record/topping',
  '/record/bottling', '/record/dispatch', '/record/stock', '/m/check']);

export function ensure_schema(db) {
  db.run('CREATE TABLE IF NOT EXISTS op_input(op_id INTEGER PRIMARY KEY, grp INTEGER NOT NULL, path TEXT NOT NULL, form TEXT NOT NULL)');
  db.run('CREATE INDEX IF NOT EXISTS ix_op_input_grp ON op_input(grp)');
  db.run('CREATE TABLE IF NOT EXISTS op_change(id INTEGER PRIMARY KEY, old_op INTEGER NOT NULL, new_op INTEGER, kind TEXT NOT NULL, at TEXT, by TEXT)');
  db.run('CREATE INDEX IF NOT EXISTS ix_op_change_old ON op_change(old_op)');
  db.run('CREATE INDEX IF NOT EXISTS ix_op_change_new ON op_change(new_op)');
  db.run('CREATE TABLE IF NOT EXISTS batch_alias(id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL, code TEXT NOT NULL, renamed_at TEXT, by TEXT)');
}

const maxOp = db => db.val('SELECT COALESCE(MAX(id), 0) FROM operation') || 0;
const who = () => ctx.user || 'HARDCASTLE, Ken';
const IN = ids => ids.map(Number).join(',') || '0';

// run a saved/corrected form through the same code as the Record pages -> [url, error]
function run_form(db, path, f) {
  try {
    if (path === '/m/check') return mobile.post_check(db, f);
    if (path in ui_entry2.PAGES) return ui_entry2.post(db, path, f) || [null, 'Unknown form.'];
    return ui_entry.post(db, path, f);
  } catch (e) {
    if (e instanceof EntryError) return [null, e.message];
    throw e;
  }
}

// keep the form with the operations it just created
function capture(db, path, f, before) {
  const ops = db.col('SELECT id FROM operation WHERE id>? ORDER BY id', before);
  if (!ops.length || !PATHS.has(path)) return null;
  const form = {};
  for (const [k, v] of Object.entries(f)) if (!['_t', '_correct', '_next'].includes(k)) form[k] = v;
  form.when = [db.val('SELECT occurred_at FROM operation WHERE id=?', ops[0])];
  if (path === '/m/check') delete form.note;   // the note is saved once, as a note; a replay must not add it again
  if (path === '/record/addition' && form.volume_after && String(form.volume_after[0] || '').trim()) {
    const r = db.one('SELECT vol_before_l b, vol_after_l a FROM op_vessel WHERE op_id=? AND vessel_id=?', ops[0], pyInt(form.vessel_id[0]));
    if (r) form._dvol = [String(r.a - r.b)];
  }
  const js = JSON.stringify(form);
  for (const id of ops) db.run('INSERT OR REPLACE INTO op_input(op_id, grp, path, form) VALUES (?,?,?,?)', id, ops[0], path, js);
  return ops[0];
}

// wraps a normal Save: runs it and keeps the form for later corrections
export function captured(db, path, f, fn) {
  const before = maxOp(db);
  const r = fn();
  if (r && r[0]) capture(db, path, f, before);
  return r;
}

export function group_of(db, op_id) {
  const i = db.one('SELECT grp, path, form FROM op_input WHERE op_id=?', op_id);
  if (!i) return null;
  const ops = db.col('SELECT op_id FROM op_input WHERE grp=? ORDER BY op_id', i.grp);
  return { grp: i.grp, path: i.path, form: JSON.parse(i.form), ops };
}

// vessels and stock items an entry touches, and the ones whose contents it changes
function touches(db, ids) {
  const t = { v: new Set(), i: new Set(), cv: new Set(), ci: new Set() };
  for (const r of db.all(`SELECT vessel_id, batch_id, batch_after_id, vol_before_l, vol_after_l, tax_state_before, tax_state_after, tax_class_before, tax_class_after
                          FROM op_vessel WHERE op_id IN (${IN(ids)})`)) {
    t.v.add(r.vessel_id);
    if (Math.abs((r.vol_after_l || 0) - (r.vol_before_l || 0)) > 0.0005 || (r.batch_id ?? null) !== (r.batch_after_id ?? null)
        || (r.tax_state_before ?? null) !== (r.tax_state_after ?? null) || (r.tax_class_before ?? null) !== (r.tax_class_after ?? null)) t.cv.add(r.vessel_id);
  }
  for (const r of db.all(`SELECT DISTINCT item_id FROM stock_event WHERE op_id IN (${IN(ids)})`)) { t.i.add(r.item_id); t.ci.add(r.item_id); }
  return t;
}

// what reversing does (entry.reverse_operation without its "latest operation only" rule)
function undo(db, op_id) {
  db.run('UPDATE operation SET reversed=1 WHERE id=?', op_id);
  db.run("UPDATE dispatch SET reversed=1 WHERE source='app' AND reference=?", `op:${op_id}`);
  db.run("DELETE FROM tax_event WHERE op_id=? AND source='app'", op_id);
  db.run("DELETE FROM stock_event WHERE op_id=? AND source='app'", op_id);
  db.run("UPDATE intake SET reversed=1 WHERE source='app' AND op_id=?", op_id);
}

const label = (db, id) => {
  const o = db.one('SELECT occurred_at, op_type, treatment FROM operation WHERE id=?', id);
  const vs = db.col(`SELECT DISTINCT v.code FROM op_vessel ov JOIN vessel v ON v.id=ov.vessel_id WHERE ov.op_id=?`, id).join(', ');
  return `${o.op_type}${o.treatment ? ' · ' + o.treatment : ''}${vs ? ' (' + vs + ')' : ''} on ${String(o.occurred_at).slice(0, 16)}`;
};

// Correct the entry `grp` with form f (f = null: reverse it), replaying what depends on it. Returns {grp, replayed}.
export function correct(db, grp, path, f) {
  const g = group_of(db, grp);
  if (!g || g.grp !== grp) throw new EntryError('That entry has no saved form, so it can’t be corrected here.');
  const old = db.all(`SELECT id, occurred_at, reversed, source FROM operation WHERE id IN (${IN(g.ops)})`);
  if (!old.length || old.some(o => o.source !== 'app')) throw new EntryError('Imported Vintrace history can’t be corrected here.');
  if (old.some(o => o.reversed)) throw new EntryError('That entry was already reversed or corrected.');
  const tOld = old.map(o => o.occurred_at).sort()[0];
  if (f) {
    f = { ...f };
    const w = String((f.when || [''])[0] || '').trim();
    f.when = [w ? entry._when(w) : tOld];
    entry._check_date(db, f.when[0]);
  }
  const tNew = f ? f.when[0] : tOld;
  const T = tNew < tOld ? tNew : tOld;
  const told = touches(db, g.ops);
  const affV = new Set(told.cv), affI = new Set(told.ci);

  // later entries, as groups, in time order
  const rows = db.all(`SELECT o.id, o.occurred_at, i.grp, i.path, i.form FROM operation o LEFT JOIN op_input i ON i.op_id=o.id
                       WHERE o.source='app' AND o.reversed=0 AND o.occurred_at>=? AND o.id NOT IN (${IN(g.ops)}) ORDER BY o.occurred_at, o.id`, T);
  const groups = new Map();
  for (const r of rows) {
    const k = r.grp ? 'g' + r.grp : 'o' + r.id;
    if (!groups.has(k)) groups.set(k, { t: r.occurred_at, first: r.grp || r.id, ids: [], path: r.path, form: r.form ? JSON.parse(r.form) : null });
    groups.get(k).ids.push(r.id);
  }
  const events = [...groups.values()];
  if (f) events.push({ corrected: true, t: tNew, first: grp });
  events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.first - b.first));

  for (const o of g.ops) undo(db, o);
  const winIds = rows.map(r => r.id);
  if (winIds.length) db.run(`UPDATE operation SET reversed=2 WHERE id IN (${IN(winIds)})`);   // hidden until their turn
  const stamp = nowIso().replace('T', ' ');
  let newGrp = null, replayed = 0;
  entry.deferSnapshots(true);
  try {
    for (const ev of events) {
      if (ev.corrected) {
        const before = maxOp(db);
        const [, err] = run_form(db, path, f);
        if (err) throw new EntryError(err);
        newGrp = capture(db, path, f, before);
        if (!newGrp) throw new EntryError('The corrected entry recorded nothing.');
        const tn = touches(db, db.col('SELECT op_id FROM op_input WHERE grp=?', newGrp));
        for (const v of tn.cv) affV.add(v);
        for (const i of tn.ci) affI.add(i);
        for (const o of g.ops) db.run("INSERT INTO op_change(old_op, new_op, kind, at, by) VALUES (?,?,'correct',?,?)", o, newGrp, stamp, who());
        continue;
      }
      const t = touches(db, ev.ids);
      const hit = [...t.v].some(v => affV.has(v)) || [...t.i].some(i => affI.has(i));
      if (!hit) { db.run(`UPDATE operation SET reversed=0 WHERE id IN (${IN(ev.ids)})`); continue; }
      if (!ev.form) {
        // an entry without a saved form: only readings / treatments (no change to contents) can follow along
        if (t.cv.size || t.ci.size) throw new EntryError(`${label(db, ev.ids[0])} was entered before corrections were possible and depends on this change. Reverse it first, then correct this entry.`);
        for (const id of ev.ids) {
          const at = db.val('SELECT occurred_at FROM operation WHERE id=?', id);
          const st = entry.vessel_state(db, at);
          for (const r of db.all('SELECT id, vessel_id FROM op_vessel WHERE op_id=?', id)) {
            const s = st.get(r.vessel_id);
            if (!s) throw new EntryError(`After this change, ${label(db, id)} would be on an empty vessel.`);
            db.run(`UPDATE op_vessel SET batch_id=?, batch_after_id=?, vol_before_l=?, vol_after_l=?, tax_state_before=?, tax_state_after=?,
                    tax_class_before=?, tax_class_after=? WHERE id=?`, s.batch_id, s.batch_id, s.volume_l, s.volume_l, s.tax_state, s.tax_state, s.tax_class, s.tax_class, r.id);
            db.run('UPDATE op_analysis SET batch_id=? WHERE op_id=? AND vessel_id=?', s.batch_id, id, r.vessel_id);
          }
          db.run('UPDATE operation SET reversed=0 WHERE id=?', id);
        }
        continue;
      }
      const what = label(db, ev.ids[0]);
      for (const id of ev.ids) undo(db, id);
      const fm = { ...ev.form };
      if (ev.path === '/record/addition' && fm._dvol && String((fm.volume_after || [''])[0]).trim()) {
        const s = entry._state_at(db, pyInt(fm.vessel_id[0]), fm.when[0]);
        if (s) fm.volume_after = [String(Math.round((s.volume_l + Number(fm._dvol[0])) * 1000) / 1000)];
      }
      fm._replay = ['1'];   // v1.70: replayed entries skip the Why-box check
      const before = maxOp(db);
      const [, err] = run_form(db, ev.path, fm);
      if (err) throw new EntryError(`With this change, a later entry no longer works — ${what}: ${err}`);
      const ng = capture(db, ev.path, fm, before);
      const tn = touches(db, db.col('SELECT op_id FROM op_input WHERE grp=?', ng));
      for (const v of [...t.cv, ...tn.cv]) affV.add(v);
      for (const i of [...t.ci, ...tn.ci]) affI.add(i);
      for (const id of ev.ids) db.run("INSERT INTO op_change(old_op, new_op, kind, at, by) VALUES (?,?,'replay',?,?)", id, ng, stamp, who());
      replayed++;
    }
    if (!f) for (const o of g.ops) db.run("INSERT INTO op_change(old_op, new_op, kind, at, by) VALUES (?,NULL,'reverse',?,?)", o, stamp, who());
    db.run('UPDATE operation SET reversed=0 WHERE reversed=2');   // safety: nothing should be left hidden
  } finally {
    entry.deferSnapshots(false);
  }
  entry.rebuild_snapshots(db);
  return { grp: newGrp, replayed };
}

// ---------------------------------------------------------------- pages

// the entry's own form, filled with what was saved (or what was just submitted), marked as a correction
export function correct_page(c, op_id, f = null, err = '') {
  const g = group_of(c, op_id);
  const o = c.one('SELECT id, reversed, source FROM operation WHERE id=?', op_id);
  if (!o) return null;
  if (!g || o.reversed) {
    const why = o.reversed ? 'This entry was already reversed or corrected.' : o.source !== 'app' ? 'This is imported Vintrace history, which stays as it was recorded there.'
      : 'This entry was made before corrections were recorded (v1.1). Use Reverse on the Record page, then enter it again.';
    return page('Correct', `<h1>Can’t correct this entry</h1><p>${why}</p><p><a href="/op/${op_id}">‹ Back to the operation</a></p>`, '/record');
  }
  const src = f || g.form;
  const banner = `<div class="cbanner"><b>Correcting an entry</b> — ${E(label(c, g.grp))}. Change what was wrong (any figure, or the time) and save. The original stays on file, marked corrected, and later entries on the same tanks, barrels or stock are replayed from the corrected figures.</div>${err}`;
  const flat = {}, fl = {};
  const multi = ['vessels', 'fv', 'fl', 'sv', 'sl', 'sx', 'dv', 'dl', 'dry', 'dq', 'it', 'iq'];
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('_')) continue;
    const val = k === 'when' ? [String(v[0]).replace(' ', 'T').slice(0, 16)] : v;
    flat[k] = k === 'vessels' ? val : val[0];
    fl[k] = val.length > 1 || multi.includes(k) ? val : val[0];
  }
  if (g.path === '/record/measure') {   // the adjust-volume form shows the loss/gain against the volume before this entry, not today's
    const vb = c.val("SELECT vol_before_l FROM op_vessel WHERE op_id=? AND role='to' LIMIT 1", op_id);
    if (vb !== null && vb !== undefined) flat.__before = vb;
  }
  let html;
  if (g.path === '/m/check') html = mobile.check_form(c, pyInt(flat.v || 0), flat, banner);
  else if (g.path in ui_entry2.PAGES) html = page('Correct', ui_entry2.PAGES[g.path](c, ctx.token, fl, banner), '/record');
  else html = page('Correct', ui_entry.PAGES[g.path](c, ctx.token, flat, banner), '/record');
  const css = '<style>.cbanner{background:#2a2410;border:1px solid #6b5514;color:#f0d68a;border-radius:8px;padding:10px 12px;margin:10px 0;font-size:14px}.cbanner b{color:#fff}</style>';
  const re = new RegExp(`(<form[^>]*action="${g.path.replace(/\//g, '\\/')}"[^>]*>\\s*<input type="hidden" name="_t" value="[^"]*">)`);
  return html.replace(re, `$1<input type="hidden" name="_correct" value="${g.grp}">`).replace('</head>', css + '</head>');
}

export function post_correct(c, path, f) {
  const grp = pyInt((f._correct || ['0'])[0] || 0);
  const g = group_of(c, grp);
  if (!g || g.path !== path) return [null, 'That entry can’t be corrected from this form.'];
  const r = correct(c, grp, path, f);
  return [`/op/${r.grp}?corrected=${r.replayed}`, null];
}

export function post_reverse(c, op_id) {
  const g = group_of(c, op_id);
  if (!g) { entry.reverse_operation(c, op_id); return ['/record?done=reversed', null]; }   // older entries: the old rule
  const r = correct(c, g.grp, g.path, null);
  return [`/record?done=reversed${r.replayed ? '&replayed=' + r.replayed : ''}`, null];
}

// what happened to an operation, for its page
export function history_html(c, op_id, q) {
  const out = [];
  const n = q && q.corrected ? Number(q.corrected[0]) : null;
  if (n !== null && !Number.isNaN(n)) out.push(`<div class="ok">Corrected.${n ? ` ${n} later ${n === 1 ? 'entry was' : 'entries were'} replayed from the corrected figures.` : ''}</div>`);
  for (const r of c.all("SELECT old_op, new_op, kind, at, by FROM op_change WHERE old_op=? ORDER BY id DESC LIMIT 1", op_id))
    out.push(`<div class="cbanner">${r.kind === 'reverse' ? 'Reversed' : r.kind === 'correct' ? 'Corrected' : 'Replayed after an earlier correction'} on ${E(String(r.at).slice(0, 16))}${r.by ? ' by ' + E(r.by) : ''}${r.new_op ? ` — current version: <a href="/op/${r.new_op}">#${r.new_op}</a>` : ''}.</div>`);
  const prev = c.all("SELECT old_op, kind FROM op_change WHERE new_op=? ORDER BY old_op", op_id);
  if (prev.length) out.push(`<p class="muted">${prev[0].kind === 'correct' ? 'Correction of' : 'Replayed version of'} ${[...new Set(prev.map(p => p.old_op))].map(x => `<a href="/op/${x}">#${x}</a>`).join(', ')}.</p>`);
  const o = c.one('SELECT source, reversed FROM operation WHERE id=?', op_id);
  if (o && o.source === 'app' && !o.reversed && ctx.mode !== 'readonly')
    out.push(`<p><a class="btn" href="/correct/${op_id}">Correct this entry</a> <span class="muted" style="font-size:13px">${group_of(c, op_id) ? 'Change any figure or the time; later entries follow.' : 'Made before corrections were recorded — reverse and re-enter instead.'}</span></p>`);
  return out.length ? '<style>.cbanner{background:#2a2410;border:1px solid #6b5514;color:#f0d68a;border-radius:8px;padding:10px 12px;margin:10px 0}</style>' + out.join('') : '';
}

// ---------------------------------------------------------------- batch rename
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,39}$/;

export function rename_page(c, bid, f = {}, err = '') {
  const b = c.one('SELECT id, code, description FROM batch WHERE id=?', bid);
  if (!b) return null;
  const items = c.all('SELECT id, code, name FROM stock_item WHERE batch_id=? AND code=?', bid, b.code);
  const al = c.all('SELECT code, renamed_at FROM batch_alias WHERE batch_id=? ORDER BY id DESC', bid);
  const ro = ctx.mode === 'readonly';
  const body = `<h1>Edit name · ${E(b.code)}</h1><p class="sub">${E(b.description || '')}</p>${err}
${ro ? '<div class="err">The real records are read-only until cutover from Vintrace. Use the practice copy to try a rename.</div>' : ''}
<form class="entry" method="post" action="/batch/${bid}/rename"><input type="hidden" name="_t" value="${E(ctx.token)}">
<label>Batch code<input name="code" value="${E(f.code ?? b.code)}" required maxlength="40" autocapitalize="characters" style="max-width:220px"></label>
<label>Description<input name="description" value="${E(f.description ?? (b.description || ''))}" maxlength="120" style="min-width:22em"></label>
${items.length ? `<label class="chk"><input type="checkbox" name="items" value="1" ${f.items ? 'checked' : ''}> Also rename the bottled stock item${items.length > 1 ? 's' : ''} ${items.map(i => `<b>${E(i.code)}</b>`).join(', ')} — leave unticked to keep the sales reports’ product names unchanged</label>` : ''}
<p class="muted" style="font-size:13px">Everything is linked to the batch itself, so all history, readings, costs, notes and formulas follow the new name. The old name stays searchable and scannable.</p>
<div class="actions"><button ${ro ? 'disabled' : ''}>Save</button> <a href="/batch/${bid}">Cancel</a></div></form>
${al.length ? `<h2>Earlier names</h2><p>${al.map(a => `${E(a.code)} <span class="muted">(until ${E(String(a.renamed_at).slice(0, 10))})</span>`).join(' · ')}</p>` : ''}`;
  return page(`Rename ${b.code}`, body, '/batches');
}

export function post_rename(c, bid, f) {
  const b = c.one('SELECT id, code, description FROM batch WHERE id=?', bid);
  if (!b) return [null, 'No such batch.'];
  const code = String((f.code || [''])[0] || '').trim().replace(/\s+/g, ' ');
  const desc = f.description ? String(f.description[0] || '').trim().replace(/\s+/g, ' ') : null;   // v1.19: the description is edited here too
  if (desc !== null && desc !== (b.description || '')) c.run('UPDATE batch SET description=? WHERE id=?', desc || null, bid);
  if (code === b.code && desc !== null && desc !== (b.description || '')) return [`/batch/${bid}?saved=1`, null];
  if (!CODE_RE.test(code)) return [null, 'Use 1–40 letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit (e.g. 26NecTom).'];
  if (code === b.code) return [null, 'That is already its name.'];
  const clash = c.one('SELECT code FROM batch WHERE lower(code)=lower(?) AND id<>?', code, bid);
  if (clash) return [null, `${clash.code} is another batch — pick a different name.`];
  const now = nowIso().replace('T', ' ');
  c.run('UPDATE batch SET code=? WHERE id=?', code, bid);
  if (c.val("SELECT 1 FROM sqlite_master WHERE name='cost_txn'")) {
    c.run('UPDATE cost_txn SET batch_code=? WHERE batch_code=?', code, b.code);
    c.run('UPDATE cost_txn SET target2=? WHERE target2=?', code, b.code);
  }
  if ((f.items || [''])[0]) c.run('UPDATE stock_item SET code=? WHERE batch_id=? AND code=?', code, bid, b.code);
  c.run('DELETE FROM batch_alias WHERE batch_id=? AND lower(code)=lower(?)', bid, code);   // renamed back
  if (code.toLowerCase() !== b.code.toLowerCase() && !c.one('SELECT 1 FROM batch_alias WHERE batch_id=? AND lower(code)=lower(?)', bid, b.code))
    c.run('INSERT INTO batch_alias(batch_id, code, renamed_at, by) VALUES (?,?,?,?)', bid, b.code, now, who());   // a change of capitals only is not a new name
  return [`/batch/${bid}?renamed=1`, null];
}
