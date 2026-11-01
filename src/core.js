// Port of the shared helpers at the top of app.py (page frame, tables, small formatters, chart).
import { GLOBAL as HELPG } from './help.js';
import { E, num, fx, fg, naiveMs, strftime, today, pyFloatStr, localToEpoch, epochToLocalMs } from './lib/py.js';
import * as hw_ui from './hw_ui.js';
import * as search from './search.js';
import { splash } from './splash.js';
import { TABLESORT } from './tablesort.js';
import { UNITS } from './units.js';
import { DICTATE } from './dictate.js';
import { STICKYHEAD } from './stickyhead.js';
import { NAVBACK } from './opmenu.js';
import { ui_entry as UE, ui_formula as UF, app as A } from './gen/strings.js';

export { E, num };
export const GAL = 3.785411784;
export const VERSION = '1.72.3-cloud';

// per-request context, set by the router: { mode: 'readonly' | 'practice' | 'live', token, user }
export const ctx = { mode: 'readonly', token: '', user: '' };
export const READONLY = () => ctx.mode === 'readonly';
export const PRACTICE = () => ctx.mode === 'practice';

export function opts(values, current, blank = null) {
  const o = blank !== null ? `<option value="">${blank}</option>` : '';
  return o + values.map(v => `<option ${String(v) === String(current) ? 'selected' : ''}>${E(v)}</option>`).join('');
}

export function link(href, text) {
  return `<a href="${E(href)}">${E(text)}</a>`;
}

const SECTION = Object.fromEntries(hw_ui.SECTIONS.map(([p, t]) => [p, t]));

export function page(title, body, path = '/', crumbs = null) {
  if (crumbs === null) {
    let sec = (hw_ui.SECTIONS.find(([p]) => p !== '/' && path.startsWith(p)) || [null])[0];
    if (path.startsWith('/formula/')) sec = '/formulas';
    crumbs = sec ? [[SECTION[sec], sec]] : [];
    if (title && (!sec || title !== SECTION[sec]) && path !== '/') crumbs.push([title, null]);
  }
  let banner = '';
  if (PRACTICE()) banner = '<div class="banner">PRACTICE COPY — entries here do not touch the real cellar database · <a href="/practice/off">back to the real records</a></div>';
  else if (READONLY() && path === '/record/intake') banner = '<div class="banner">Real records: fruit deliveries save here now (they feed the on-hand list). Bulk juice/cider and filling vessels wait for cutover — <a href="/practice/on">practice copy</a></div>';
  else if (READONLY() && path.startsWith('/record')) banner = '<div class="banner">READ-ONLY until cutover from Vintrace — <a href="/practice/on">switch to the practice copy</a> to try the entry screens</div>';
  return hw_ui.shell(title, body, path, crumbs, banner, search.WIDGET, UE.ENTRY_CSS + search.CSS + UF.CSS).replace('</body></html>', () => TABLESORT + UNITS + DICTATE + STICKYHEAD + NAVBACK + HELPG + splash(VERSION, ctx.backup) + '</body></html>');
}

// cols: header labels; rows: arrays of HTML cell strings; numeric: Set/array of column indexes right-aligned
export function table(cols, rows, numeric = []) {
  const isN = i => numeric.includes(i);
  const h = cols.map((c, i) => `<th class="${isN(i) ? 'n' : ''}">${E(c)}</th>`).join('');
  const b = rows.map(r => '<tr>' + r.map((v, i) => `<td class="${isN(i) ? 'n' : ''}">${v}</td>`).join('') + '</tr>').join('');
  return `<table><thead><tr>${h}</tr></thead><tbody>${b || '<tr><td colspan=99 class=muted>No records</td></tr>'}</tbody></table>`;
}

// series: { name: [[iso_datetime, value], ...] } -> inline SVG
export function line_chart(series, w = 900, h = 220) {
  const pts = [];
  for (const s of Object.values(series)) for (const [t, v] of s) if (v !== null && v !== undefined) pts.push([t, v]);
  if (!pts.length) return '<p class="muted">No data</p>';
  const ts = pts.map(([t]) => localToEpoch(t) / 1000);
  let t0 = Math.min(...ts), t1 = Math.max(...ts) || 1;
  if (t1 === t0) t1 = t0 + 86400;
  const vs = pts.map(([, v]) => v);
  let v0 = Math.min(...vs), v1 = Math.max(...vs);
  if (v1 === v0) v1 = v0 + 1;
  const pad = 36;
  const X = t => pad + (localToEpoch(t) / 1000 - t0) / (t1 - t0) * (w - pad - 10);
  const Y = v => h - 22 - (v - v0) / (v1 - v0) * (h - 34);
  const colors = ['#00ADA8', '#e5533d', '#b07a1e', '#3d5a8a', '#7a4a8a'];
  const out = [`<svg viewBox="0 0 ${w} ${h}" width="100%" role="img">`];
  for (let i = 0; i < 5; i++) {
    const v = v0 + (v1 - v0) * i / 4;
    out.push(`<line x1="${pad}" x2="${w - 10}" y1="${fx(Y(v), 1)}" y2="${fx(Y(v), 1)}" stroke="currentColor" stroke-opacity=".08"/><text x="2" y="${fx(Y(v) + 4, 1)}">${fg(v, 4)}</text>`);
  }
  out.push(`<text x="${pad}" y="${h - 4}">${strftime(epochToLocalMs(t0 * 1000), '%Y-%m-%d')}</text><text x="${w - 80}" y="${h - 4}">${strftime(epochToLocalMs(t1 * 1000), '%Y-%m-%d')}</text>`);
  Object.entries(series).forEach(([name, s0], k) => {
    const s = s0.filter(([, v]) => v !== null && v !== undefined);
    if (!s.length) return;
    const c = colors[k % colors.length];
    const d = s.map(([t, v], i) => `${i === 0 ? 'M' : 'L'}${fx(X(t), 1)},${fx(Y(v), 1)}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="1.6"/>`);
    for (const [t, v] of s) out.push(`<circle cx="${fx(X(t), 1)}" cy="${fx(Y(v), 1)}" r="2" fill="${c}"><title>${String(t).slice(0, 16)} ${name} ${typeof v === 'number' ? pyFloatStr(v) : v}</title></circle>`);
    out.push(`<text x="${pad + 8 + k * 110}" y="12" style="fill:${c};font-weight:600">${E(name)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

export function latest_snap(c) {
  return c.val('SELECT MAX(snap_date) FROM bulk_snapshot');
}

export function years(c) {
  return c.col('SELECT DISTINCT substr(occurred_at,1,4) y FROM operation ORDER BY y DESC');
}

export function bdg(c, bid, big = false) {
  return hw_ui.badge(hw_ui.bev_map(c).get(bid), big);
}

export function status_tag(state, cls) {
  if (state === 'BONDED') return `<span class="tag b">declared · ${E(cls)}</span>`;
  return state ? '<span class="tag u">in fermenter</span>' : '';
}

// Map "batch_id|metric" -> [value, occurred_at] — newest non-reversed reading per batch
export function latest_labs(c, metrics = ['Free SO2', 'pH']) {
  const ph = metrics.map(() => '?').join(',');
  const m = new Map();
  for (const r of c.all(`SELECT batch_id, metric, value, occurred_at FROM (
        SELECT a.batch_id, a.metric, a.value, o.occurred_at, ROW_NUMBER() OVER (PARTITION BY a.batch_id, a.metric ORDER BY o.occurred_at DESC) rn
        FROM op_analysis a JOIN operation o ON o.id=a.op_id WHERE o.reversed=0 AND a.value IS NOT NULL AND a.metric IN (${ph})) WHERE rn=1`, ...metrics))
    m.set(`${r.batch_id}|${r.metric}`, [r.value, r.occurred_at]);
  return m;
}

export function labcell(v, d = 1) {
  if (!v) return '';
  return `${num(v[0], d)}<small>${E(hw_ui.ago(v[1]))}</small>`;
}

export function snap_near(c, day) {
  return c.val('SELECT MAX(snap_date) FROM bulk_snapshot WHERE snap_date<=?', day);
}

export const TABS = A.TABS;
export const LAB_CARDS = A.LAB_CARDS;
export const SHORT = A.SHORT;
export { today, strftime, naiveMs };

// v1.53: bottled stock packaged from a batch. App packaging links the stock event to its operation (op_id);
// Vintrace-era Package events carry no op_id, so they are matched to the batch's Packaging operation at the same time
// (all 327 imported events match exactly one batch that way).
export function bottled_from(c, bid) {
  return c.all(`SELECT s.id, s.code, s.description, s.litres_per_unit l, s.inactive, SUM(e.quantity) packed, COUNT(*) runs,
                  MIN(substr(e.occurred_at,1,10)) first, MAX(substr(e.occurred_at,1,10)) last,
                  (SELECT COALESCE(SUM(quantity),0) FROM stock_event x WHERE x.item_id=s.id) onhand
                FROM stock_event e JOIN stock_item s ON s.id=e.item_id
                WHERE e.action='Package' AND e.quantity>0 AND s.is_finished=1 AND (
                  e.op_id IN (SELECT ov.op_id FROM op_vessel ov JOIN operation o ON o.id=ov.op_id WHERE ov.batch_id=? AND o.reversed=0)
                  OR (e.op_id IS NULL AND e.occurred_at IN (SELECT o.occurred_at FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
                        WHERE ov.batch_id=? AND o.op_type='Packaging' AND o.reversed=0)))
                GROUP BY s.id ORDER BY MAX(e.occurred_at) DESC`, bid, bid);
}
export function pack_size(l) {
  if (!l) return '';
  return l >= 1 ? `${+l.toFixed(2)} L` : `${Math.round(l * 1000)} ml`;
}
// batch for each Package event of an item without an op_id (Vintrace-era), keyed by time
export function package_batches_by_time(c, iid) {
  const m = new Map();
  for (const r of c.all(`SELECT DISTINCT e.occurred_at t, b.id, b.code FROM stock_event e JOIN operation o ON o.occurred_at=e.occurred_at AND o.op_type='Packaging' AND o.reversed=0
                           JOIN op_vessel ov ON ov.op_id=o.id JOIN batch b ON b.id=ov.batch_id
                         WHERE e.item_id=? AND e.action='Package' AND e.op_id IS NULL`, iid)) if (!m.has(r.t)) m.set(r.t, r);
  return m;
}
