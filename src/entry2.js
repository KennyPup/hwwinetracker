// v0.9.1 — the rest of the Vintrace activities: fill/extraction, change batch, start/stop ferment, many-to-one blends,
// one-to-many splits, topping, bottling (packaging run), dispatch (BOL) and stock receive/adjust.
// Same state model as entry.js: every op writes op_vessel rows (vol/batch/tax state after), then _finish() rebuilds snapshots.
import { fx, pyStr } from './lib/py.js';
import {
  EntryError, _when, _check_date, _new_op, _state_at, _vessel_row, _finish, _num, _tax_event, _cap_check, pyInt, pyStrip, TAX_CLASSES,
} from './entry.js';

const ids = a => (a || []).filter(x => x !== '' && x !== null && x !== undefined).map(x => pyInt(x));
const code = (db, vid) => (db.one('SELECT code FROM vessel WHERE id=?', vid) || {}).code || `#${vid}`;
const LOSS = (db, op, vid, bid, l, reason) => {
  if (l > 0) db.run('INSERT INTO op_loss(op_id,vessel_id,batch_id,volume_l,reason) VALUES (?,?,?,?,?)', op, vid, bid, l, reason);
};

// ---------------------------------------------------------------- fill / extraction
// Juice or must from fruit (pressed, extracted, drained) goes into vessels of a batch. Vintrace "Extraction".
export function record_fill(db, when, batch_id, lines, notes = null) {
  when = _when(when); _check_date(db, when);
  batch_id = pyInt(batch_id || 0);
  if (!batch_id || !db.one('SELECT 1 FROM batch WHERE id=?', batch_id)) throw new EntryError('Pick the batch.');
  lines = lines.filter(([v, l]) => v && pyStrip(pyStr(l)) !== '');
  if (!lines.length) throw new EntryError('Enter at least one vessel and litres.');
  const op = _new_op(db, when, 'Extraction', 'Transfer', null, undefined, notes);
  const seen = new Set();
  for (const [v, l] of lines) {
    const vid = pyInt(v);
    if (seen.has(vid)) throw new EntryError(`${code(db, vid)} is listed twice.`);
    seen.add(vid);
    const litres = _num(l, `Litres into ${code(db, vid)}`);
    const t = _state_at(db, vid, when);
    if (t && t.batch_id !== batch_id) throw new EntryError(`${code(db, vid)} holds another batch; use an empty vessel or one holding this batch.`);
    const nv = (t ? t.volume_l : 0) + litres;
    _cap_check(db, vid, nv);
    _vessel_row(db, op, vid, 'to', t, nv, batch_id, (t && t.tax_state) || 'NON_DECLARED', t ? t.tax_class : null);
  }
  return _finish(db, op);
}

// ---------------------------------------------------------------- change batch (Vintrace MoveToBatch)
export function record_change_batch(db, when, vessel_ids, batch_id, notes = null) {
  when = _when(when); _check_date(db, when);
  batch_id = pyInt(batch_id || 0);
  if (!batch_id || !db.one('SELECT 1 FROM batch WHERE id=?', batch_id)) throw new EntryError('Pick the new batch.');
  vessel_ids = ids(vessel_ids);
  if (!vessel_ids.length) throw new EntryError('Pick at least one vessel.');
  const op = _new_op(db, when, 'Change batch', 'MoveToBatch', null, undefined, notes);
  for (const vid of vessel_ids) {
    const s = _state_at(db, vid, when);
    if (!s) throw new EntryError(`${code(db, vid)} is empty at that time.`);
    if (s.batch_id === batch_id) throw new EntryError(`${code(db, vid)} already holds that batch.`);
    _vessel_row(db, op, vid, 'to', s, s.volume_l, batch_id);
  }
  return _finish(db, op);
}

// ---------------------------------------------------------------- start / stop ferment
export function record_ferment(db, when, vessel_ids, which, notes = null) {
  when = _when(when); _check_date(db, when);
  const t = { start: ['Start ferment', 'StartFerment'], stop: ['Stop ferment', 'StopFerment'] }[which];
  if (!t) throw new EntryError('Pick start or stop.');
  vessel_ids = ids(vessel_ids);
  if (!vessel_ids.length) throw new EntryError('Pick at least one vessel.');
  const op = _new_op(db, when, t[0], t[1], null, undefined, notes);
  for (const vid of vessel_ids) {
    const s = _state_at(db, vid, when);
    if (!s) throw new EntryError(`${code(db, vid)} is empty at that time.`);
    _vessel_row(db, op, vid, 'to', s, s.volume_l);
  }
  return _finish(db, op);
}

// TTB events for `vol` litres moving from source state s into a destination whose resulting state is rs/rc
function _ttb_move(db, when, op, s, t, vol, rb, rs, rc) {
  const src_b = s.tax_state === 'BONDED', dst_b = rs === 'BONDED';
  if (!src_b && dst_b) _tax_event(db, when, rb, rc, vol, 'blended_into_bonded', op);
  if (src_b && !dst_b) _tax_event(db, when, s.batch_id, s.tax_class, vol, 'undeclared', op);
  if (src_b && dst_b && s.tax_class !== rc) _tax_event(db, when, rb, rc, vol, 'class_change', op, s.tax_class);
}

// ---------------------------------------------------------------- many-to-one (blend / combine)
// sources: [[vessel_id, litres|'' (= all), loss]]. Each source keeps what is left; the destination gets the sum.
export function record_blend(db, when, to_id, sources, loss_reason = 'Lees', result_batch_id = null, result_state = null, notes = null, treatment = null) {
  when = _when(when); _check_date(db, when);
  to_id = pyInt(to_id || 0);
  if (!to_id) throw new EntryError('Pick the destination vessel.');
  sources = sources.filter(([v]) => v).map(([v, l, x]) => [pyInt(v), l, x]);
  if (sources.length < 1) throw new EntryError('Pick at least one source vessel.');
  const t = _state_at(db, to_id, when);
  let total = 0;
  const rows = [];
  const seen = new Set();
  for (const [vid, l, x] of sources) {
    if (vid === to_id) throw new EntryError(`${code(db, vid)} is both a source and the destination.`);
    if (seen.has(vid)) throw new EntryError(`${code(db, vid)} is listed twice.`);
    seen.add(vid);
    const s = _state_at(db, vid, when);
    if (!s) throw new EntryError(`${code(db, vid)} is empty at that time.`);
    const loss = _num(x || 0, `Loss from ${code(db, vid)}`, true);
    const vol = pyStrip(pyStr(l)) === '' ? s.volume_l - loss : _num(l, `Litres from ${code(db, vid)}`);
    if (vol <= 0) throw new EntryError(`${code(db, vid)}: nothing left to move after the loss.`);
    if (vol + loss > s.volume_l + 0.01) throw new EntryError(`Only ${fx(s.volume_l, 0)} L in ${code(db, vid)}.`);
    rows.push({ vid, s, vol, loss });
    total += vol;
  }
  const t_vol = t ? t.volume_l : 0;
  _cap_check(db, to_id, t_vol + total);
  const first = rows[0].s;
  const rb = result_batch_id ? pyInt(result_batch_id) : (t ? t.batch_id : first.batch_id);
  const rs = result_state || (t ? t.tax_state : first.tax_state);
  const rc = t && t.tax_state === 'BONDED' ? t.tax_class : (rows.find(r => r.s.tax_state === 'BONDED') || { s: first }).s.tax_class;
  if (rs === 'BONDED' && !rc) throw new EntryError('The result would be declared wine without a tax class; declare it first.');
  const op = _new_op(db, when, rows.length > 1 ? 'Multi transfer (many-to-one)' : 'Transfer', 'Transfer', treatment || null, undefined, notes);
  for (const r of rows) {
    let after = r.s.volume_l - r.vol - r.loss;
    if (after < 0.05) after = 0;
    _vessel_row(db, op, r.vid, 'from', r.s, after);
    LOSS(db, op, r.vid, r.s.batch_id, r.loss, loss_reason || 'Lees');
    _ttb_move(db, when, op, r.s, t, r.vol, rb, rs, rc);
  }
  _vessel_row(db, op, to_id, 'to', t, t_vol + total, rb, rs, rs === 'BONDED' ? rc : null);
  if (rs === 'BONDED' && t && t.tax_state !== 'BONDED') _tax_event(db, when, rb, rc, t_vol, 'declared', op);
  return _finish(db, op);
}

// ---------------------------------------------------------------- one-to-many (split / rack into several)
// dests: [[vessel_id, litres]]. Destinations keep their batch if they hold wine, else take the source's.
export function record_split(db, when, from_id, dests, loss = 0, loss_reason = 'Lees', notes = null, treatment = null) {
  when = _when(when); _check_date(db, when);
  from_id = pyInt(from_id || 0);
  const s = _state_at(db, from_id, when);
  if (!s) throw new EntryError('The source vessel is empty at that time.');
  dests = dests.filter(([v]) => v).map(([v, l]) => [pyInt(v), l]);
  if (!dests.length) throw new EntryError('Pick at least one destination vessel.');
  loss = _num(loss || 0, 'Loss', true);
  let total = 0;
  const rows = [], seen = new Set();
  for (const [vid, l] of dests) {
    if (vid === from_id) throw new EntryError(`${code(db, vid)} is both the source and a destination.`);
    if (seen.has(vid)) throw new EntryError(`${code(db, vid)} is listed twice.`);
    seen.add(vid);
    const vol = _num(l, `Litres into ${code(db, vid)}`);
    const t = _state_at(db, vid, when);
    _cap_check(db, vid, (t ? t.volume_l : 0) + vol);
    rows.push({ vid, t, vol });
    total += vol;
  }
  if (total + loss > s.volume_l + 0.01) throw new EntryError(`Only ${fx(s.volume_l, 0)} L in the source; this moves ${fx(total + loss, 0)} L.`);
  const op = _new_op(db, when, rows.length > 1 ? 'Multi transfer (one-to-many)' : 'Transfer', 'Transfer', treatment || null, undefined, notes);
  let after = s.volume_l - total - loss;
  if (after < 0.05) after = 0;
  _vessel_row(db, op, from_id, 'from', s, after);
  LOSS(db, op, from_id, s.batch_id, loss, loss_reason || 'Lees');
  for (const { vid, t, vol } of rows) {
    const rb = t ? t.batch_id : s.batch_id;
    const rs = t ? t.tax_state : s.tax_state;
    const rc = t && t.tax_state === 'BONDED' ? t.tax_class : s.tax_class;
    if (rs === 'BONDED' && !rc) throw new EntryError('The result would be declared wine without a tax class; declare it first.');
    _vessel_row(db, op, vid, 'to', t, (t ? t.volume_l : 0) + vol, rb, rs, rs === 'BONDED' ? rc : null);
    _ttb_move(db, when, op, s, t, vol, rb, rs, rc);
  }
  return _finish(db, op);
}

// ---------------------------------------------------------------- topping (Vintrace "Multi topping")
// The source gives `litres` to each barrel; each barrel is back to its recorded volume (it had lost that much to
// evaporation), so the barrel volume is unchanged and the evaporation is recorded as its loss.
export function record_topping(db, when, from_id, dests, notes = null) {
  when = _when(when); _check_date(db, when);
  from_id = pyInt(from_id || 0);
  const s = _state_at(db, from_id, when);
  if (!s) throw new EntryError('The topping wine vessel is empty at that time.');
  dests = dests.filter(([v]) => v).map(([v, l]) => [pyInt(v), l]);
  if (!dests.length) throw new EntryError('Pick at least one vessel to top.');
  let total = 0;
  const rows = [], seen = new Set();
  for (const [vid, l] of dests) {
    if (vid === from_id) throw new EntryError(`${code(db, vid)} can't top itself.`);
    if (seen.has(vid)) throw new EntryError(`${code(db, vid)} is listed twice.`);
    seen.add(vid);
    const t = _state_at(db, vid, when);
    if (!t) throw new EntryError(`${code(db, vid)} is empty — topping is for vessels holding wine (use Transfer to fill).`);
    const vol = _num(l, `Litres into ${code(db, vid)}`);
    if (vol > Math.max(t.volume_l * 0.1, 20)) throw new EntryError(`${fx(vol, 1)} L into ${code(db, vid)} is a lot for topping (it holds ${fx(t.volume_l, 0)} L) — use Transfer.`);
    rows.push({ vid, t, vol });
    total += vol;
  }
  if (total > s.volume_l + 0.01) throw new EntryError(`Only ${fx(s.volume_l, 0)} L of topping wine; this uses ${fx(total, 1)} L.`);
  const op = _new_op(db, when, 'Multi topping', 'Adjustment', null, undefined, notes);
  let after = s.volume_l - total;
  if (after < 0.05) after = 0;
  _vessel_row(db, op, from_id, 'from', s, after);
  for (const { vid, t, vol } of rows) {
    _vessel_row(db, op, vid, 'to', t, t.volume_l);
    LOSS(db, op, vid, t.batch_id, vol, 'Evaporation');
    _ttb_move(db, when, op, s, t, vol, t.batch_id, t.tax_state, t.tax_state === 'BONDED' ? t.tax_class : s.tax_class);
  }
  return _finish(db, op);
}

// ---------------------------------------------------------------- stock helpers
export function on_hand(db, item_id, at = '9999-12-31 23:59:59') {
  return db.val('SELECT COALESCE(SUM(quantity),0) FROM stock_event WHERE item_id=? AND occurred_at<=?', item_id, at) || 0;
}
function stock_ev(db, item, when, action, qty, op, dispatch_id = null, notes = null) {
  db.run("INSERT INTO stock_event(item_id,occurred_at,action,quantity,dispatch_id,op_id,notes,source) VALUES (?,?,?,?,?,?,?,'app')",
    item, when, action, qty, dispatch_id, op, notes);
}
const item = (db, id) => db.one('SELECT id, code, name, unit, litres_per_unit, tax_class, is_finished, batch_id FROM stock_item WHERE id=?', id);

// ---------------------------------------------------------------- bottling / canning / kegging (packaging run)
// units of a finished stock item filled from one vessel; optional dry goods used [[item_id, qty]].
export function record_bottling(db, when, vessel_id, item_id, units, loss = 0, empty_vessel = false, dry = [], notes = null) {
  when = _when(when); _check_date(db, when);
  vessel_id = pyInt(vessel_id || 0);
  const s = _state_at(db, vessel_id, when);
  if (!s) throw new EntryError('That vessel is empty at that time.');
  const it = item(db, pyInt(item_id || 0));
  if (!it || !it.is_finished) throw new EntryError('Pick the finished product (bottle/can/keg) being filled.');
  if (!it.litres_per_unit) throw new EntryError(`${it.code} has no litres per unit set; it can't be filled from bulk.`);
  units = _num(units, 'Units filled');
  if (Math.abs(units - Math.round(units)) > 1e-9) throw new EntryError('Units filled must be a whole number.');
  const bottled = units * it.litres_per_unit;
  loss = _num(loss || 0, 'Loss', true);
  if (empty_vessel) loss = s.volume_l - bottled;
  if (loss < -0.5) throw new EntryError(`${units} × ${it.litres_per_unit} L = ${fx(bottled, 1)} L, more than the ${fx(s.volume_l, 1)} L in the vessel.`);
  if (loss < 0) loss = 0;
  if (bottled + loss > s.volume_l + 0.5) throw new EntryError(`${fx(bottled, 1)} L bottled + ${fx(loss, 1)} L loss is more than the ${fx(s.volume_l, 1)} L in the vessel.`);
  if (loss > Math.max(0.15 * s.volume_l, 10)) throw new EntryError(`Loss of ${fx(loss, 1)} L is over 15% of the vessel — check the units filled, or leave "empty the vessel" unticked.`);
  const cls = it.tax_class;
  if (!cls) throw new EntryError(`${it.code} has no tax class; set one before bottling.`);
  const op = _new_op(db, when, 'Packaging', 'NewPackagingRun', null, undefined, notes);
  let after = s.volume_l - bottled - loss;
  if (after < 0.05) after = 0;
  _vessel_row(db, op, vessel_id, 'from', s, after);
  LOSS(db, op, vessel_id, s.batch_id, loss, 'Bottling');
  stock_ev(db, it.id, when, 'Package', units, op);
  if (s.tax_state === 'BONDED') {
    _tax_event(db, when, s.batch_id, cls, bottled, 'bottled_bulk', op);
    if (s.tax_class && s.tax_class !== cls) _tax_event(db, when, s.batch_id, cls, bottled, 'class_change', op, s.tax_class);
  } else {
    _tax_event(db, when, s.batch_id, cls, bottled, 'declared_at_bottling', op);
  }
  for (const [d, q] of (dry || []).filter(([d, q]) => d && pyStrip(pyStr(q)) !== '')) {
    const di = item(db, pyInt(d));
    if (!di || di.is_finished) throw new EntryError('Dry goods lines must be packaging/dry-goods items.');
    const qty = _num(q, `${di.code} used`);
    if (qty > units * 5 + 50) throw new EntryError(`${fx(qty, 0)} ${di.unit || ''} of ${di.code} for ${units} units looks wrong.`);
    stock_ev(db, di.id, when, 'Consume', -qty, op);
  }
  return _finish(db, op);
}

// ---------------------------------------------------------------- dispatch (BOL)
// lines: [[item_id, qty]] of finished goods. Removal from stock; the dispatch type decides the TTB line.
export function record_dispatch(db, when, dispatch_type, destination, bol, lines, notes = null, allow_negative = false) {
  when = _when(when); _check_date(db, when);
  const dt = db.one('SELECT name FROM dispatch_type WHERE name=? AND active=1', dispatch_type);
  if (!dt) throw new EntryError('Pick a dispatch type.');
  lines = lines.filter(([i, q]) => i && pyStrip(pyStr(q)) !== '');
  if (!lines.length) throw new EntryError('Enter at least one product and quantity.');
  const op = _new_op(db, when, 'Dispatch', 'Dispatch', null, undefined, notes);
  bol = pyStrip(pyStr(bol || '')) || `HW-${op}`;
  const did = db.run("INSERT INTO dispatch(occurred_at,bol,dispatch_type,destination,operator,reference,notes,source) VALUES (?,?,?,?,?,?,?,'app')",
    when, bol, dt.name, pyStrip(pyStr(destination || '')) || null, 'HARDCASTLE, Ken', `op:${op}`, notes || null).id;
  const seen = new Set();
  for (const [i, q] of lines) {
    const it = item(db, pyInt(i));
    if (!it) throw new EntryError('Unknown product.');
    if (seen.has(it.id)) throw new EntryError(`${it.code} is listed twice.`);
    seen.add(it.id);
    const qty = _num(q, `${it.code} quantity`);
    if (qty > 5000) throw new EntryError(`${fx(qty, 0)} units of ${it.code} on one BOL looks wrong.`);
    const have = on_hand(db, it.id, when);
    if (!allow_negative && qty > have + 1e-9) throw new EntryError(`Only ${fx(have, 0)} of ${it.code} in stock at that time (asked for ${fx(qty, 0)}). Record the bottling or a stock receive first, or tick "allow negative stock".`);
    db.run('INSERT INTO dispatch_line(dispatch_id,item_id,quantity,unit) VALUES (?,?,?,?)', did, it.id, qty, it.unit);
    stock_ev(db, it.id, when, 'Dispatch', -qty, op, did);
  }
  return _finish(db, op);
}

// ---------------------------------------------------------------- stock receive / count
// mode 'receive': qty > 0 arrives (dry goods delivery, wine returned or bottled elsewhere).
// mode 'count': qty = what is on hand now; the difference is booked as an adjustment.
export function record_stock(db, when, item_id, mode, qty, notes = null) {
  when = _when(when); _check_date(db, when);
  const it = item(db, pyInt(item_id || 0));
  if (!it) throw new EntryError('Pick a stock item.');
  // v1.32 mode 'correction': like a count, but the difference is a records fix (action Correction) — on no TTB line
  if (mode === 'correction' && !pyStrip(pyStr(notes || ''))) throw new EntryError('A records correction needs a note saying why.');
  const op = _new_op(db, when, 'Stock', mode === 'count' ? 'Adjustment' : mode === 'correction' ? 'Correction' : 'Receive', null, undefined, notes);
  if (mode === 'count' || mode === 'correction') {
    const n = _num(qty, 'Count on hand', true);
    const d = n - on_hand(db, it.id, when);
    if (Math.abs(d) < 1e-9) throw new EntryError(`${it.code} already shows ${fx(n, 2)} on hand — nothing to adjust.`);
    stock_ev(db, it.id, when, mode === 'count' ? 'Adjustment' : 'Correction', d, op, null, notes);
  } else if (mode === 'receive') {
    const n = _num(qty, 'Quantity received');
    if (n > 100000) throw new EntryError(`${fx(n, 0)} ${it.unit || ''} looks wrong — check the amount and unit.`);
    stock_ev(db, it.id, when, 'Receive', n, op, null, notes);
  } else {
    throw new EntryError('Pick receive, count or correction.');
  }
  return _finish(db, op);
}

export { TAX_CLASSES };
