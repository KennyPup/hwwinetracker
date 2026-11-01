// sqlite3-like access to the Durable Object's SQLite database (synchronous, like the Python app).
//   db.all(sql, ...params) -> [row objects]      (Python: c.execute(...).fetchall())
//   db.one(sql, ...params) -> row object | null  (fetchone())
//   db.val(sql, ...params) -> first column of the first row | null   (fetchone()[0])
//   db.col(sql, ...params) -> [first column of every row]
//   db.run(sql, ...params) -> { id: last_insert_rowid, changes }      (cursor.lastrowid / rowcount)
//   db.script(sql)         -> runs several ';'-separated statements   (executescript)
//   db.tx(fn)              -> runs fn() in one transaction (commit on return, roll back on throw)
// commit() is a no-op: each request is its own transaction unless db.tx is used.

function clean(p) {
  // BLOBs: Durable Object SQLite binds ArrayBuffer
  return p.map(v => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v));
}

// Durable Object SQLite allows at most 100 bound parameters per statement. Long IN (...) lists exceed that,
// so above the limit the values are written into the SQL as properly quoted literals instead.
const MAXP = 100;
function lit(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function prep(q, p) {
  p = clean(p);
  if (p.length <= MAXP) return [q, p];
  let out = '', i = 0, quote = null;
  for (const ch of q) {
    if (quote) { out += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    if (ch === '?') { if (i >= p.length) throw new Error('not enough parameters'); out += lit(p[i++]); continue; }
    out += ch;
  }
  if (i !== p.length) throw new Error('too many parameters');
  return [out, []];
}
export const usage = { read: 0, written: 0 };
const ex = (sql, q, p) => {
  const [a, b] = prep(q, p);
  const cur = sql.exec(a, ...b);
  const arr = cur.toArray();          // run now so the cursor's row counters are final
  usage.read += cur.rowsRead; usage.written += cur.rowsWritten;
  if (usage.log) usage.log.push([cur.rowsRead, a.replace(/\s+/g, ' ').slice(0, 160)]);
  return { toArray: () => arr, rowsWritten: cur.rowsWritten };
};

export function makeDb(storage) {
  const sql = storage.sql;
  const db = {
    raw: sql,
    all(q, ...p) {
      return ex(sql, q, p).toArray();
    },
    one(q, ...p) {
      const a = ex(sql, q, p).toArray();
      return a.length ? a[0] : null;
    },
    val(q, ...p) {
      const r = db.one(q, ...p);
      if (!r) return null;
      const k = Object.keys(r);
      return k.length ? r[k[0]] : null;
    },
    col(q, ...p) {
      return db.all(q, ...p).map(r => r[Object.keys(r)[0]]);
    },
    run(q, ...p) {
      const cur = ex(sql, q, p);
      cur.toArray();
      const id = sql.exec('SELECT last_insert_rowid() AS id').one().id;
      return { id, changes: cur.rowsWritten };
    },
    script(text) {
      for (const s of splitSql(text)) sql.exec(s);
    },
    tx(fn) {
      return storage.transactionSync(fn);
    },
    commit() {},
    columns(table) {
      return sql.exec(`PRAGMA table_info("${table}")`).toArray().map(r => r.name);
    },
  };
  return db;
}

// split a schema script on ';' outside quotes and comments
export function splitSql(text) {
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '-' && text[i + 1] === '-') { while (i < text.length && text[i] !== '\n') i++; cur += '\n'; continue; }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
