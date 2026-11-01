// Intakes page: fruit, honey and other ingredients ON HAND first (received, not yet used in a batch), then recent deliveries,
// then all-years totals below the fold. Vintrace never tracked fruit on hand reliably, so the list starts from Ken's own count
// (2026-10-04). From then on there is ONE place fruit is entered: the delivery (Record > Intake). Every fruit/honey delivery
// becomes a lot here automatically (sync_lots); a delivery that goes straight into a batch is recorded as used. The lot page
// records use in a batch, count corrections, and can undo a mistaken delivery.
import { E, num, qv, today, nowIso } from './lib/py.js';
import { page, table, link, opts } from './core.js';

const LB = 0.45359237;
const KINDS = [['fruit', 'Fruit'], ['other', 'Other'], ['honey', 'Honey']];
const MAXKG = { fruit: 20000, honey: 3000, other: 5000 };
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ingredient_lot(id INTEGER PRIMARY KEY, item TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fruit', amount_kg REAL NOT NULL,
     unit TEXT NOT NULL DEFAULT 'lb', received_at TEXT, supplier TEXT, intake_id INTEGER, notes TEXT, status TEXT NOT NULL DEFAULT 'on_hand',
     used_at TEXT, used_batch_id INTEGER, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ingredient_lot_log(id INTEGER PRIMARY KEY, lot_id INTEGER NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL,
     amount_kg REAL, batch_id INTEGER, note TEXT)`,
];
export function ensure_schema(c) { for (const s of SCHEMA) c.run(s); }

export const START = '2026-10-04';   // deliveries from this day on become lots; earlier stock = the opening count
// Make a lot for every fruit/honey delivery that doesn't have one; retire on-hand lots whose delivery was undone.
export function sync_lots(c) {
  ensure_schema(c);
  const now = nowIso();
  const fresh = c.all(`SELECT i.* FROM intake i WHERE i.kind='fruit' AND i.reversed=0 AND i.unit='kg' AND i.occurred_at>=?
                         AND NOT EXISTS (SELECT 1 FROM ingredient_lot l WHERE l.intake_id=i.id) ORDER BY i.occurred_at, i.id`, START);
  for (const i of fresh) {
    const used = !!i.batch_id, d = i.occurred_at.slice(0, 10);
    const r = c.run(`INSERT INTO ingredient_lot(item, kind, amount_kg, unit, received_at, supplier, intake_id, notes, status, used_at, used_batch_id, created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, i.variety || '(unnamed)', i.kind, used ? 0 : i.amount, 'lb', d, i.supplier || null, i.id, null,
      used ? 'used' : 'on_hand', used ? d : null, used ? i.batch_id : null, now, now);
    c.run('INSERT INTO ingredient_lot_log(lot_id, at, action, amount_kg, batch_id, note) VALUES (?,?,?,?,?,?)', r.id, now, 'delivered', i.amount, null, i.docket ? `docket ${i.docket}` : null);
    if (used) c.run('INSERT INTO ingredient_lot_log(lot_id, at, action, amount_kg, batch_id, note) VALUES (?,?,?,?,?,?)', r.id, now, 'used up', i.amount, i.batch_id, 'went straight into the batch at delivery');
  }
  c.run(`UPDATE ingredient_lot SET status='reversed', updated_at=? WHERE status IN ('on_hand','used') AND intake_id IN (SELECT id FROM intake WHERE reversed=1)`, now);
}
const lot_op = (c, l) => (l.intake_id ? c.one("SELECT i.op_id, i.occurred_at, i.amount, i.docket, i.cost, i.source, o.reversed FROM intake i LEFT JOIN operation o ON o.id=i.op_id WHERE i.id=?", l.intake_id) : null);
// a delivery recorded here (app), into no vessel — the lot page may undo it
export function is_lot_delivery(c, op_id) {
  ensure_schema(c);
  return !!c.val(`SELECT 1 FROM intake i JOIN operation o ON o.id=i.op_id WHERE i.op_id=? AND i.source='app' AND i.kind IN ('fruit','honey') AND o.reversed=0
                  AND NOT EXISTS (SELECT 1 FROM op_vessel v WHERE v.op_id=o.id)`, op_id);
}
export function undo_delivery(c, op_id, reverse) {
  const l = c.one('SELECT l.* FROM ingredient_lot l JOIN intake i ON i.id=l.intake_id WHERE i.op_id=?', op_id);
  if (l && c.val("SELECT 1 FROM ingredient_lot_log WHERE lot_id=? AND action IN ('used','used up') AND COALESCE(note,'') NOT IN ('marked gone (no batch)','went straight into the batch at delivery')", l.id))
    return [null, 'Some of this fruit has been recorded as used in a batch. Correct those uses first (or correct the count) rather than undoing the delivery.'];
  try { reverse(); } catch (e) { return [null, e.message]; }
  sync_lots(c);
  if (l) c.run('INSERT INTO ingredient_lot_log(lot_id, at, action, amount_kg, batch_id, note) VALUES (?,?,?,?,?,?)', l.id, nowIso(), 'delivery undone', null, null, null);
  return ['/intakes?saved=1', null];
}

const trim = s => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
// "100 lb (45.4 kg)" in the unit the lot was entered in, the other unit muted
export function amt(kg, unit) {
  const lb = kg / LB;
  return unit === 'kg' ? `${trim(num(kg, 1))} kg <span class="muted">(${trim(num(lb, 0))} lb)</span>`
    : `${trim(num(lb, 1))} lb <span class="muted">(${trim(num(kg, 1))} kg)</span>`;
}
const sel = (name, cur, items) => `<select name="${name}">${items.map(([v, t]) => `<option value="${E(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${E(t)}</option>`).join('')}</select>`;
const datalists = c => {
  const it = c.col("SELECT DISTINCT item FROM ingredient_lot UNION SELECT DISTINCT variety FROM intake WHERE variety IS NOT NULL AND kind IN ('fruit','honey') ORDER BY 1");
  const sp = c.col("SELECT DISTINCT supplier FROM intake WHERE supplier IS NOT NULL UNION SELECT name FROM party ORDER BY 1");
  return `<datalist id="items">${it.map(v => `<option value="${E(v)}">`).join('')}</datalist><datalist id="sups">${sp.map(v => `<option value="${E(v)}">`).join('')}</datalist>`;
};
const recent_batches = c => c.all('SELECT id, code FROM batch WHERE production_year>=? ORDER BY id DESC', Number(today().slice(0, 4)) - 1);

function lot_fields(l, token) {
  return `<input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="id" value="${E(l.id || '')}">
    <label>Item<input name="item" list="items" required size="16" value="${E(l.item || '')}"></label>
    <label>Kind${sel('kind', l.kind || 'fruit', KINDS)}</label>
    <label>Amount on hand<input name="amount" inputmode="decimal" required size="7" value="${E(l.amount || '')}"></label>
    <label>Unit${sel('unit', l.unit || 'lb', [['lb', 'lb'], ['kg', 'kg']])}</label>
    <label>Received<input type="date" name="received_at" value="${E(l.received_at || '')}"></label>
    <label>From<input name="supplier" list="sups" size="18" value="${E(l.supplier || '')}"></label>
    <label class="wide">Notes (where it is, condition…)<input name="notes" size="40" value="${E(l.notes || '')}"></label>`;
}

// a lot that came from a delivery: the delivery holds item, supplier and date; here only the count and notes change
function linked_fields(l, token) {
  return `<input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="id" value="${E(l.id)}"><input type="hidden" name="linked" value="1">
    <label>Amount on hand now<input name="amount" inputmode="decimal" required size="7" value="${E(l.amount || '')}"></label>
    <label>Unit${sel('unit', l.unit || 'lb', [['lb', 'lb'], ['kg', 'kg']])}</label>
    <label class="wide">Notes (where it is, condition…)<input name="notes" size="40" value="${E(l.notes || '')}"></label>`;
}

export function p_intakes(c, q, token, msg = '') {
  sync_lots(c);
  const yr = qv(q, 'year', '');
  // ---- on hand now
  const lots = c.all("SELECT * FROM ingredient_lot WHERE status='on_hand' ORDER BY item COLLATE NOCASE, received_at");
  const onhand = lots.length ? table(['Item', 'Kind', 'On hand', 'Received', 'From', 'Notes', ''], lots.map(l => [
    `<b>${E(l.item)}</b>`, E(l.kind), amt(l.amount_kg, l.unit), E(l.received_at || ''), E(l.supplier || ''), E(l.notes || ''),
    `<a href="/intakes/lot?id=${l.id}">use / edit</a>`]), [2])
    : '<p class="muted">Nothing on hand.</p>';
  const tot = {};
  for (const l of lots) tot[l.kind] = (tot[l.kind] || 0) + l.amount_kg;
  const totline = Object.keys(tot).length ? `<p class="muted" style="margin-top:6px">Total: ${KINDS.filter(([k]) => tot[k]).map(([k, t]) => `${t.toLowerCase()} ${trim(num(tot[k] / LB, 0))} lb (${trim(num(tot[k], 0))} kg)`).join(' · ')}</p>` : '';
  const add = `<p style="margin-top:12px"><a class="btn" href="/record/intake?_next=/intakes&amp;kind=fruit&amp;unit=lb">＋ Record a delivery</a>
    <span class="muted" style="margin-left:8px">fruit with no batch lands here; every new delivery is entered only there · honey is on <a href="/materials">Materials</a></span></p>`;
  const used = c.all("SELECT l.*, b.code bc FROM ingredient_lot l LEFT JOIN batch b ON b.id=l.used_batch_id WHERE l.status='used' ORDER BY l.used_at DESC LIMIT 15");
  const usedt = used.length ? `<details style="margin-top:8px"><summary class="muted">Recently used up (${used.length})</summary>${table(['Item', 'Used', 'In batch', 'Received', 'From'],
    used.map(l => [link(`/intakes/lot?id=${l.id}`, l.item), E(l.used_at || ''), l.used_batch_id ? link(`/batch/${l.used_batch_id}`, l.bc) : '', E(l.received_at || ''), E(l.supplier || '')]))}</details>` : '';

  // ---- deliveries: last 12 months by default, or one year
  const since = String(Number(today().slice(0, 4)) - 1) + today().slice(4, 10);
  let sql = 'SELECT i.*, b.code bc FROM intake i LEFT JOIN batch b ON b.id=i.batch_id WHERE ';
  const args = [];
  if (yr) { sql += 'substr(i.occurred_at,1,4)=?'; args.push(yr); } else { sql += 'i.occurred_at>=?'; args.push(since); }
  const rows = c.all(sql + ' ORDER BY i.occurred_at DESC', ...args);
  const ys = c.col('SELECT DISTINCT substr(occurred_at,1,4) FROM intake ORDER BY 1 DESC');
  const f = `<form class="f"><label>Show<select name="year"><option value="">last 12 months</option>${ys.map(y => `<option ${y === yr ? 'selected' : ''}>${E(y)}</option>`).join('')}</select></label><button>Show</button></form>`;
  const dt = rows.length ? table(['Date', 'Kind', 'Variety', 'Supplier', 'Amount', 'Unit', 'Batch', 'Booking', 'Docket', 'Cost', ''], rows.map(r => [E(r.occurred_at.slice(0, 10)), E(r.kind), E(r.variety), E(r.supplier), num(r.amount, 1), E(r.unit),
    r.batch_id ? link(`/batch/${r.batch_id}`, r.bc) : '', E(r.booking_no || ''), E(r.docket), r.cost ? '$' + num(r.cost, 2) : '', r.reversed ? 'reversed' : '']), [4, 9])
    : '<p class="muted">No deliveries in this period.</p>';

  // ---- totals by year (below the fold)
  const tr = c.all('SELECT variety, kind, unit, substr(occurred_at,1,4) y, SUM(amount) s FROM intake WHERE reversed=0 GROUP BY variety, kind, unit, y');
  const yy = [...new Set(tr.map(r => r.y))].sort();
  const piv = new Map();
  for (const r of tr) {
    const k = JSON.stringify([r.variety, r.kind, r.unit]);
    if (!piv.has(k)) piv.set(k, { k: [r.variety, r.kind, r.unit], v: new Map(), t: 0 });
    const p = piv.get(k); p.v.set(r.y, r.s); p.t += r.s;
  }
  const items = [...piv.values()].sort((a, b) => (a.k[1] < b.k[1] ? -1 : a.k[1] > b.k[1] ? 1 : b.t - a.t));
  const pt = table(['Variety', 'Kind', 'Unit', ...yy], items.map(({ k, v }) => [E(k[0]), E(k[1]), E(k[2]), ...yy.map(y => num(v.get(y)))]), yy.map((_, i) => 3 + i));

  const body = `<h1>Intakes</h1>${msg}<p class="sub"><a href="/bookings">Fruit bookings</a> · <a href="/contacts">Growers &amp; suppliers</a></p>
    <h2>On hand now</h2><p class="muted" style="margin-top:-4px">Received and not yet used in a batch.</p>${onhand}${totline}${add}${usedt}
    <h2>Deliveries</h2>${f}${dt}
    <details style="margin-top:22px"><summary class="muted">Totals by year — all deliveries</summary>${pt}</details>`;
  return page('Intakes', body, '/intakes');
}

export function p_lot(c, q, token, err = '', f = null) {
  sync_lots(c);
  const l = c.one('SELECT * FROM ingredient_lot WHERE id=?', Number(qv(q, 'id', '0')));
  if (!l) return null;
  const d = lot_op(c, l);
  const v = f || { ...l, amount: trim(num(l.unit === 'kg' ? l.amount_kg : l.amount_kg / LB, 2)).replace(/,/g, '') };
  const bo = '<option value="">— none / not a batch —</option>' + recent_batches(c).map(b => `<option value="${b.id}">${E(b.code)}</option>`).join('');
  const log = c.all('SELECT g.*, b.code bc FROM ingredient_lot_log g LEFT JOIN batch b ON b.id=g.batch_id WHERE g.lot_id=? ORDER BY g.at DESC, g.id DESC', l.id);
  const undone = new Set(log.filter(g => g.action === 'use undone').map(g => Number((/#(\d+)/.exec(g.note || '') || [])[1])));
  const back = g => ((g.action === 'used' || g.action === 'used up') && g.amount_kg > 0 && !undone.has(g.id) && g.note !== 'went straight into the batch at delivery'
    ? `<form method="post" action="/intakes/lot" style="margin:0;display:inline" onsubmit="return confirm('Put ${amt(g.amount_kg, l.unit).replace(/<[^>]+>/g, '')} back on hand? The batch no longer counts it.')"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="id" value="${l.id}"><input type="hidden" name="action" value="unuse"><input type="hidden" name="log_id" value="${g.id}"><button class="btn2" style="padding:1px 8px;font-size:12px">Put back on hand</button></form>` : '');
  const logt = table(['When', 'What', 'Amount', 'Batch', 'Note', ''], log.map(g => [E(g.at.slice(0, 16).replace('T', ' ')), E(g.action), g.amount_kg !== null ? amt(g.amount_kg, l.unit) : '',
    g.batch_id ? link(`/batch/${g.batch_id}`, g.bc) : '', E(g.note || ''), back(g)]), [2]);
  const dline = d ? `<p class="sub">Delivered ${E(d.occurred_at.slice(0, 10))}${l.supplier ? ' from ' + E(l.supplier) : ''} — ${amt(d.amount, l.unit)}${d.docket ? ' · docket ' + E(d.docket) : ''}${d.cost ? ' · $' + num(d.cost, 2) : ''}${d.op_id ? ' · ' + link('/op/' + d.op_id, 'delivery entry') : ' · from Vintrace'}</p>`
    : `<p class="sub">Opening count (no delivery on file)${l.supplier ? ' · from ' + E(l.supplier) : ''}${l.received_at ? ' · received ' + E(l.received_at) : ''}</p>`;
  const undo = d && d.op_id && !d.reversed && d.source === 'app' ? `<form method="post" action="/reverse/${d.op_id}" style="margin-top:8px;display:inline-block" onsubmit="return confirm('Undo this delivery? It comes off the on-hand list and out of the TTB fruit totals.')"><input type="hidden" name="_t" value="${E(token)}"><button class="btn2">Undo this delivery (entered by mistake)</button></form>` : '';
  if (l.status !== 'on_hand') return page(l.item, `<h1>${E(l.item)} <span class="muted">${l.status === 'reversed' ? 'delivery undone' : 'used up'}</span></h1>${dline}${err}<h2>History</h2>${logt}`, '/intakes', [['Intakes', '/intakes'], [l.item, null]]);
  const body = `<h1>${E(l.item)} <span class="muted">${amt(l.amount_kg, l.unit)} on hand</span></h1>${dline}${err}
    <h2>Use in a batch</h2><form class="entry" method="post" action="/intakes/lot"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="id" value="${l.id}"><input type="hidden" name="action" value="use">
      <label>Amount used<input name="use_amount" inputmode="decimal" size="7" placeholder="blank = all"></label><label>Unit${sel('use_unit', l.unit, [['lb', 'lb'], ['kg', 'kg']])}</label>
      <label>Batch<select name="batch_id">${bo}</select></label><label>Date<input type="date" name="when" value="${today()}"></label>
      <label class="wide">Note<input name="note" size="40"></label><div class="actions"><button>Record use</button></div></form>
    <h2>Correct the record</h2><form class="entry" method="post" action="/intakes/lot">${l.intake_id ? linked_fields(v, token) : lot_fields(v, token) + datalists(c)}<input type="hidden" name="action" value="save">
      <div class="actions"><button>Save</button> <a href="/intakes">Cancel</a></div></form>
    <form method="post" action="/intakes/lot" style="margin-top:8px" onsubmit="return confirm('Remove this lot from the on-hand list?')"><input type="hidden" name="_t" value="${E(token)}"><input type="hidden" name="id" value="${l.id}"><input type="hidden" name="action" value="gone">
      <button class="btn2">Mark used up / gone (no batch)</button></form> ${undo}
    <h2>History</h2>${logt}`;
  return page(l.item, body, '/intakes', [['Intakes', '/intakes'], [l.item, null]]);
}

const toKg = (x, unit) => (unit === 'kg' ? x : x * LB);
function parseAmt(s, what) {
  const x = Number(String(s || '').replace(/,/g, '').trim());
  if (!isFinite(x) || String(s || '').trim() === '') throw new Error(`${what}: enter a number.`);
  if (x < 0) throw new Error(`${what} can't be negative.`);
  return x;
}

export function post_lot(c, f) {
  ensure_schema(c);
  const g = k => (f[k] && f[k].length ? String(f[k][0]).trim() : '');
  const id = Number(g('id') || 0), action = g('action') || 'save', now = nowIso();
  const log = (lot, a, kg, b, note) => c.run('INSERT INTO ingredient_lot_log(lot_id, at, action, amount_kg, batch_id, note) VALUES (?,?,?,?,?,?)', lot, now, a, kg, b || null, note || null);
  try {
    if (action === 'save' && !id) return [null, 'New fruit or honey is entered as a delivery (Record a delivery), so it is tracked in one place.'];
    if (action === 'save' && g('linked')) {
      const old = c.one("SELECT * FROM ingredient_lot WHERE id=? AND status='on_hand'", id);
      if (!old) return [null, 'That lot is not on hand.'];
      const unit = g('unit') === 'kg' ? 'kg' : 'lb', kg = toKg(parseAmt(g('amount'), 'Amount'), unit);
      if (kg > MAXKG[old.kind]) return [null, `${num(kg, 0)} kg is over the ${MAXKG[old.kind]} kg limit — check the amount and unit.`];
      c.run(`UPDATE ingredient_lot SET amount_kg=?, unit=?, notes=?, updated_at=?${kg === 0 ? ", status='used', used_at=?" : ''} WHERE id=?`, kg, unit, g('notes') || null, now, ...(kg === 0 ? [today()] : []), id);
      if (Math.abs(old.amount_kg - kg) > 1e-9) log(id, 'count corrected', kg, null, `was ${trim(num(old.unit === 'kg' ? old.amount_kg : old.amount_kg / LB, 1))} ${old.unit}`);
      else log(id, 'details edited', null, null, null);
      return [kg === 0 ? '/intakes?saved=1' : `/intakes/lot?id=${id}&saved=1`, null];
    }
    if (action === 'save') {
      const item = g('item'), kind = g('kind') || 'fruit', unit = g('unit') === 'kg' ? 'kg' : 'lb';
      if (!item) return [null, 'Item is required.'];
      if (!MAXKG[kind]) return [null, 'Pick fruit, honey or other.'];
      const kg = toKg(parseAmt(g('amount'), 'Amount'), unit);
      if (kg > MAXKG[kind]) return [null, `${num(kg, 0)} kg of ${kind} is over the ${MAXKG[kind]} kg limit — check the amount and unit.`];
      const rec = g('received_at') || null;
      if (rec && (!/^\d{4}-\d{2}-\d{2}$/.test(rec) || rec > today())) return [null, 'Received date must be a real date, not in the future.'];
      const vals = [item, kind, kg, unit, rec, g('supplier') || null, g('notes') || null];
      if (id) {
        const old = c.one('SELECT * FROM ingredient_lot WHERE id=?', id);
        if (!old) return [null, 'No such lot.'];
        c.run(`UPDATE ingredient_lot SET item=?, kind=?, amount_kg=?, unit=?, received_at=?, supplier=?, notes=?, updated_at=?${kg === 0 ? ", status='used', used_at=?" : ''} WHERE id=?`,
          ...vals, now, ...(kg === 0 ? [today()] : []), id);
        if (Math.abs(old.amount_kg - kg) > 1e-9) log(id, 'count corrected', kg, null, `was ${trim(num(old.unit === 'kg' ? old.amount_kg : old.amount_kg / LB, 1))} ${old.unit}`);
        else log(id, 'details edited', null, null, null);
        return [kg === 0 ? '/intakes?saved=1' : `/intakes/lot?id=${id}&saved=1`, null];
      }
      if (kg === 0) return [null, 'Amount must be more than zero.'];
      const r = c.run('INSERT INTO ingredient_lot(item, kind, amount_kg, unit, received_at, supplier, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', ...vals, now, now);
      log(r.id, 'added', kg, null, null);
      return ['/intakes?saved=1', null];
    }
    if (action === 'unuse') {
      const l = c.one('SELECT * FROM ingredient_lot WHERE id=?', id);
      if (!l) return [null, 'No such lot.'];   // a use recorded by mistake (or a batch start being redone): the fruit goes back on hand
      const u = c.one("SELECT * FROM ingredient_lot_log WHERE id=? AND lot_id=? AND action IN ('used','used up')", Number(g('log_id') || 0), id);
      if (!u || !(u.amount_kg > 0)) return [null, 'No such use to undo.'];
      if (c.one("SELECT 1 x FROM ingredient_lot_log WHERE lot_id=? AND action='use undone' AND note=?", id, `put back on hand (undoes #${u.id})`)) return [null, 'That use was already put back.'];
      if (l.status === 'reversed') return [null, 'The delivery of this lot was undone.'];
      c.run("UPDATE ingredient_lot SET amount_kg=?, status='on_hand', used_at=NULL, used_batch_id=NULL, updated_at=? WHERE id=?", (l.status === 'on_hand' ? l.amount_kg : 0) + u.amount_kg, now, id);
      log(id, 'use undone', u.amount_kg, u.batch_id, `put back on hand (undoes #${u.id})`);
      return [`/intakes/lot?id=${id}&saved=1`, null];
    }
    const l = c.one("SELECT * FROM ingredient_lot WHERE id=? AND status='on_hand'", id);
    if (!l) return [null, 'That lot is not on hand.'];
    if (action === 'gone') {
      c.run("UPDATE ingredient_lot SET status='used', used_at=?, amount_kg=0, updated_at=? WHERE id=?", today(), now, id);
      log(id, 'used up', l.amount_kg, null, 'marked gone (no batch)');
      return ['/intakes?saved=1', null];
    }
    if (action === 'use') {
      const when = g('when') || today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(when) || when > today()) return [null, 'Date must be a real date, not in the future.'];
      const b = Number(g('batch_id') || 0) || null;
      if (b && !c.one('SELECT 1 x FROM batch WHERE id=?', b)) return [null, 'No such batch.'];
      const kg = g('use_amount') === '' ? l.amount_kg : toKg(parseAmt(g('use_amount'), 'Amount used'), g('use_unit') === 'kg' ? 'kg' : 'lb');
      if (kg <= 0) return [null, 'Amount used must be more than zero.'];
      if (kg > l.amount_kg * 1.001 + 0.05) return [null, `Only ${trim(num(l.unit === 'kg' ? l.amount_kg : l.amount_kg / LB, 1))} ${l.unit} on hand — correct the count first if there was more.`];
      const left = Math.max(0, l.amount_kg - kg) < 0.05 ? 0 : l.amount_kg - kg;
      c.run(`UPDATE ingredient_lot SET amount_kg=?, updated_at=?${left === 0 ? ", status='used', used_at=?, used_batch_id=?" : ''} WHERE id=?`, left, now, ...(left === 0 ? [when, b] : []), id);
      log(id, left === 0 ? 'used up' : 'used', kg, b, [when !== today() ? `on ${when}` : '', g('note')].filter(x => x).join(' · '));
      return [left === 0 ? '/intakes?saved=1' : `/intakes/lot?id=${id}&saved=1`, null];
    }
    return [null, 'Unknown action.'];
  } catch (e) { return [null, e.message]; }
}

// Fruit on hand at the end of a day (kg), replaying each lot's log: delivered/added set the amount, used subtracts
// (a back-dated use carries "on YYYY-MM-DD" in its note), count corrected sets it, moved / delivery undone clear it.
// -> { apple: kg, other: kg } — apples kept apart for the TTB Part IV APPLES column.
export function fruit_on_hand_at(c, day) {
  ensure_schema(c);
  const end = day + 'T23:59:59';
  const out = { apple: 0, other: 0 };
  for (const l of c.all("SELECT * FROM ingredient_lot WHERE kind='fruit'")) {
    let q = 0;
    const ev = c.all('SELECT * FROM ingredient_lot_log WHERE lot_id=? ORDER BY at, id', l.id).map(g => {
      let t = g.at;
      const m = /on (\d{4}-\d{2}-\d{2})/.exec(g.note || '');
      if (m && (g.action === 'used' || g.action === 'used up')) t = m[1] + 'T12:00:00';
      if ((g.action === 'delivered') && l.received_at) t = l.received_at + 'T00:00:00';
      return { ...g, t };
    }).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id - b.id));
    for (const g of ev) {
      if (g.t > end) break;
      if (g.action === 'delivered' || g.action === 'added') q = g.amount_kg || 0;
      else if (g.action === 'used' || g.action === 'used up') q = Math.max(0, q - (g.amount_kg || 0));
      else if (g.action === 'use undone') q += g.amount_kg || 0;
      else if (g.action === 'count corrected') q = g.amount_kg || 0;
      else if (g.action === 'moved' || g.action === 'delivery undone') q = 0;
    }
    out[/^apples?$/i.test(l.item.trim()) ? 'apple' : 'other'] += q;
  }
  return out;
}
