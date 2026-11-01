// v1.21 — a batch's stage, set by Ken with one click at the top of the batch page: Fermenting → Élevage → Ready for packaging.
// Every change is kept (batch_stage_log) so the page can say "since <date>"; the latest row is the current stage.
// v1.21.1 — set automatically too: a yeast addition recorded in the tracker → Fermenting; a STERILE FILTER treatment or transfer
// → Ready for packaging. The stage is whichever happened last — Ken's click, the yeast addition or the sterile filtration —
// so a click after the event overrides it, and a reversed entry no longer counts. Vintrace-era history is not used.
import { tip as HELP } from './help.js';
import { E, nowIso } from './lib/py.js';
import { ctx } from './core.js';

export const STAGES = [['fermenting', 'Fermenting', '#d29922'], ['elevage', 'Élevage', '#a371f7'], ['ready', 'Ready for packaging', '#3fb950']];

export function ensure_schema(c) {
  c.run('CREATE TABLE IF NOT EXISTS batch_stage_log(id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL, stage TEXT, at TEXT, by TEXT)');
}

function manual(c, bid) {
  try {
    return c.one('SELECT stage, at FROM batch_stage_log WHERE batch_id=? ORDER BY id DESC LIMIT 1', bid);
  } catch (e) {
    return null;
  }
}

const YEAST_SQL = `SELECT a.batch_id AS bid, MAX(o.occurred_at) AS at FROM op_addition a JOIN material m ON m.id=a.material_id JOIN operation o ON o.id=a.op_id
                   WHERE m.kind='yeast' AND o.reversed=0 AND o.source='app'`;
const STERILE_SQL = `SELECT ov.bid AS bid, MAX(o.occurred_at) AS at FROM operation o JOIN (SELECT op_id, batch_id AS bid FROM op_vessel UNION SELECT op_id, batch_after_id FROM op_vessel) ov ON ov.op_id=o.id
                     WHERE ov.bid IS NOT NULL AND o.reversed=0 AND o.source='app' AND upper(COALESCE(o.treatment,'')) LIKE '%STERILE%'`;

// latest of: Ken's click, the last yeast addition (→ fermenting), the last sterile filtration (→ ready)
function pick(man, yeast, sterile) {
  const c = [];
  if (man) c.push({ stage: man.stage || '', at: man.at, src: 'manual' });
  if (yeast) c.push({ stage: 'fermenting', at: yeast, src: 'yeast' });
  if (sterile) c.push({ stage: 'ready', at: sterile, src: 'sterile' });
  if (!c.length) return null;
  c.sort((a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0));
  return c[c.length - 1];
}

export function current(c, bid) {
  let y = null, s = null;
  try { y = (c.one(YEAST_SQL + ' AND a.batch_id=?', bid) || {}).at || null; s = (c.one(STERILE_SQL + ' AND ov.bid=?', bid) || {}).at || null; } catch (e) { /* older schema */ }
  return pick(manual(c, bid), y, s);
}

export function current_map(c) {
  const man = new Map(), y = new Map(), s = new Map(), m = new Map();
  try {
    for (const r of c.all('SELECT l.batch_id, l.stage, l.at FROM batch_stage_log l JOIN (SELECT batch_id, MAX(id) mid FROM batch_stage_log GROUP BY batch_id) x ON x.mid=l.id')) man.set(r.batch_id, r);
    for (const r of c.all(YEAST_SQL + ' GROUP BY a.batch_id')) y.set(r.bid, r.at);
    for (const r of c.all(STERILE_SQL + ' GROUP BY ov.bid')) s.set(r.bid, r.at);
  } catch (e) { return m; }
  for (const bid of new Set([...man.keys(), ...y.keys(), ...s.keys()])) {
    const r = pick(man.get(bid), y.get(bid), s.get(bid));
    if (r && r.stage) m.set(bid, r);
  }
  return m;
}

export function label(stage) {
  const s = STAGES.find(x => x[0] === stage);
  return s ? s[1] : '';
}

export function pill(stage) {
  const s = STAGES.find(x => x[0] === stage);
  return s ? `<span class="stpill" style="--sc:${s[2]}">${E(s[1])}</span>` : '';
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = t => (t ? `${MON[+String(t).slice(5, 7) - 1]} ${+String(t).slice(8, 10)}, ${String(t).slice(0, 4)}` : '');

export const CSS = `<style>.stbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0 4px}.stbar form{margin:0;display:flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}
.stbar button{background:var(--card);color:var(--mut);border:0;border-right:1px solid var(--line2);padding:7px 14px;font-size:14px;font-weight:600;cursor:pointer;width:auto;margin:0;border-radius:0}
.stbar button:last-child{border-right:0}.stbar button:hover{color:var(--fg2)}.stbar button.on{background:var(--sc);color:#0d1117}.stbar .stsince{font-size:12.5px;color:var(--mut)}
.stpill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;color:var(--sc);border:1px solid var(--sc);white-space:nowrap}</style>`;

// the click-to-set bar under the batch name
export function bar(c, bid, token, next = '', compact = false) {   // next: /m/v/<id> to come back to the phone card
  const cur = current(c, bid);
  const st = cur && cur.stage ? cur.stage : '';
  const btns = STAGES.map(([k, t, col]) => `<button name="stage" value="${st === k ? '' : k}" class="${st === k ? 'on' : ''}" style="--sc:${col}" title="${st === k ? 'Click again to clear' : 'Set the stage to ' + t}">${st === k ? '✓ ' : ''}${E(compact && k === 'ready' ? 'Ready' : t)}</button>`).join('');
  const nx = /^\/m\/v\/\d+$/.test(next) ? `<input type="hidden" name="_next" value="${E(next)}">` : '';
  return `${CSS}<div class="stbar"><span class="muted" style="font-size:13px">Stage</span><form method="post" action="/batch/${bid}/stage"><input type="hidden" name="_t" value="${E(token)}">${nx}${btns}</form>` +
    `<span class="stsince">${st ? 'since ' + day(cur.at) + (cur.src === 'yeast' ? ' · set by the yeast addition' : cur.src === 'sterile' ? ' · set by sterile filtration' : '') : (compact ? 'not set' : 'not set — click one (yeast added → Fermenting, sterile filtration → Ready, automatically)')}</span>${HELP('stage')}</div>`;
}

export function post_stage(c, bid, f) {
  if (!c.one('SELECT 1 x FROM batch WHERE id=?', bid)) return [null, 'No such batch.'];
  const s = String((f.stage || [''])[0] || '');
  if (s && !STAGES.some(x => x[0] === s)) return [null, 'Unknown stage.'];
  const cur = current(c, bid);
  if ((cur && cur.stage ? cur.stage : '') !== s || (cur && cur.src !== 'manual')) c.run('INSERT INTO batch_stage_log(batch_id, stage, at, by) VALUES (?,?,?,?)', bid, s || null, nowIso().replace('T', ' ').slice(0, 19), ctx.user || 'HARDCASTLE, Ken');
  const nx = String((f._next || [''])[0] || '');
  return [/^\/m\/v\/\d+$/.test(nx) ? `${nx}?saved=1` : `/batch/${bid}`, null];
}
