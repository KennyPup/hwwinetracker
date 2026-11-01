# Porting HWWineTracker (Python) to a Cloudflare Worker (JavaScript)

Source (read-only): `/home/claude/cellar/app/*.py`. Target: `/home/claude/cf/hwt/src/*.js` (ES modules, no npm deps).
Goal: **byte-for-byte the same HTML** for the same database, so a page-by-page diff against the Python app passes.
Port line by line, keep the same function names, argument order, SQL text, HTML text, CSS classes and wording.
Do not "improve" anything. When Python and JS differ in a library behaviour, use the helpers below.

## Runtime
- Runs inside a Durable Object; the database is SQLite and the API is **synchronous** — no async/await anywhere in ported code.
- Database handle `c` / `db` (see `src/lib/db.js`):
  - `c.all(sql, ...params)` → array of plain row objects (Python `fetchall()`); iterate with `for (const r of c.all(...))`.
  - `c.one(sql, ...params)` → row object or `null` (Python `fetchone()`).
  - `c.val(sql, ...params)` → first column of first row or `null` (Python `fetchone()[0]`).
  - `c.col(sql, ...params)` → array of the first column (Python `[r[0] for r in ...]`).
  - `c.run(sql, ...params)` → `{ id, changes }` (Python `cursor.lastrowid`, `rowcount`).
  - `c.script(sqlText)` → Python `executescript`.  `c.commit()` → no-op (keep the calls; harmless).
  - `c.columns(table)` → column names (Python `PRAGMA table_info` names).
  - Params are passed as separate arguments, not a tuple/list. Spread arrays: `c.all(sql, ...args)`.
- Rows are objects keyed by column name. Python positional access `r[0]`, `r[1]` must become named access:
  add `AS` aliases to the SQL where a column has no plain name (e.g. `SUM(x) AS s`, `substr(occurred_at,1,4) AS y`).
  Changing only aliases is fine; do not change anything else in the SQL.
- `dict(r)` → `{...r}`. `r.keys()` → `Object.keys(r)`. `r['x'] or ''` → `r.x || ''` — careful: Python `or` treats 0 and '' as falsy,
  same as JS `||`, but `None`→`null`. `x if x is not None else y` → `x ?? y` only when that is the Python meaning.
- Python dicts used as maps with non-string keys → `Map`. Tuple keys → string keys `` `${a}|${b}` `` (generated constants already use `a|b`).

## Helpers (import from `./lib/py.js` — path relative to `src/`)
- `E(s)` = Python `E` (html.escape, None → '').
- `num(v, d)` = app.py `num`.  `fx(x, d)` = f`{x:.{d}f}`.  `fxc(x, d)` = f`{x:,.{d}f}`.  `fg(x, p)` = f`{x:.{p}g}`.
  Never use `toFixed`/`toLocaleString` directly for output — Python rounding of exact ties differs.
- `pyRound(x, d)` = Python `round` (half-even). `median(arr)` = `statistics.median`.
- `pyStr(v)` = `str(v)` for booleans/None. Plain `${v}` for ints/strings is fine. (A float like 5.0 prints '5' in JS — unavoidable; acceptable.)
- Time — Hermit Woods local time (America/New_York), naive strings exactly like Python's:
  `nowIso()` = `datetime.now().isoformat(timespec='seconds')`; `today()` = `date.today().isoformat()`; `thisYear()`;
  `naiveMs(s)` parses 'YYYY-MM-DD[THH:MM[:SS]]' (or with a space) to ms on a naive clock; `addDays(day, n)`; `strftime(ms, fmt)` supports %a %d %b %Y %m %H %M %S.
  Python `(dt.datetime.now() - x).days` → `Math.floor((nowMs() - naiveMs(x)) / 86400000)`.
- `parseQs(s, keepBlank)` = `urllib.parse.parse_qs` (GET uses keepBlank=false; POST bodies use true). `qv(q, k, d)` = `q.get(k, [d])[0]`.
  `urlencode(obj)` = `urllib.parse.urlencode`. `quote(s, safe)` = `urllib.parse.quote`.
- `UserError` class exists if you need one; but keep each module's own error class name (e.g. `EntryError`) as an exported class.

## Constants
`src/gen/strings.js` holds every UPPERCASE module constant of the Python app, generated from Python (exact strings: CSS, JS snippets,
lists, dicts). Import them, e.g. `import { entry as K } from './gen/strings.js'; const TAX_CLASSES = K.TAX_CLASSES;`
Never retype a long CSS/JS/HTML constant by hand. Tuples became arrays; dict keys that were tuples became `"a|b"` strings.

## Already ported (import, don't redo)
- `src/vt_ui.js`: kind_badge, badge, ago, icon, shell, chips, latest_metric, bev_map (returns a `Map`; use `.get(id)`), tabs, note_card, stamp, KIND, BEV_TO_KIND, NAV, GAL.
- `src/search.js`: search, results_page, api, WIDGET, CSS.
- `src/notes.js`: ensure_schema, add_note, has_notes, for_batch, recent, search, listing, stats, APP_BASE. (`import_notes` is not ported — laptop-side.)
- `src/core.js` (app.py helpers): `E, num, GAL, ctx, READONLY(), PRACTICE(), opts, link, page, table, line_chart, latest_snap, years, bdg,
  status_tag, latest_labs (returns Map keyed "batchId|metric"), labcell, snap_near, TABS, LAB_CARDS, SHORT`.
  `table(cols, rows, numeric)` — `numeric` is an array of column indexes (Python tuple `(3, 4)` → `[3, 4]`).
  READONLY/PRACTICE are functions: `READONLY()`.

## Module contracts (same names/signatures as Python)
- Python tuple returns become arrays: `return [title, body]`, `return [url, err]`.
- Keyword/default arguments become positional parameters with the same defaults, in the same order.
- Python `f.get(k) or [d]` on parsed form dicts: forms are objects of arrays (like parse_qs with keep_blank_values=True).
- Exceptions: throw the same class with the same message text. Python `int(x)`/`float(x)` raising ValueError on bad input:
  replicate with a helper that throws the same way the Python code would have been caught (read the surrounding try/except).
- `json.dumps(x)` used in stored DB text → `JSON.stringify(x)` (spacing differs from Python; acceptable only for stored JSON,
  but HTML that embeds `json.dumps` output must match Python formatting: write a `pyJson` helper that emits ', ' and ': ' separators
  and ensure_ascii escapes — put it in your module if you need it).
- Files on disk (seed JSON, raw notes, backups) don't exist in the Worker: skip functions whose only job is loading files from disk
  (`seed`, `import_history`, `regroup`, `import_notes`) — leave a one-line comment saying they run on the laptop.

## Don'ts
- No `await`, no `fetch`, no Node APIs, no npm packages.
- Don't change behaviour, text or SQL. Don't reformat CSS/HTML. Don't add features.
- Don't touch files other than the ones assigned to you.

## Self-check before you finish
- `cd /home/claude/cf/hwt && node --check src/<file>.js` for each file (syntax), and
  `node -e "import('./src/<file>.js').then(m=>console.log(Object.keys(m)))"` must load without error
  (imports of `cloudflare:workers` are not used in your modules).
- List every place where you were unsure the output matches Python byte-for-byte.
