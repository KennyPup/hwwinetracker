// TTB F 5120.17 (Report of Wine Premises Operations, 01/2018 rev.) filled from the tracker's TTB figures (reports.ttb_5120),
// as an editable PDF: every field stays fillable so Ken can review, correct, sign and print it.
// Field names are the official form's (1A.<line>.<class>, 1B.…, 4.<line>.<col>, 7.1.<col>). Whole gallons / pounds.
// Totals are re-added from the rounded lines so every column balances: A12 = lines 1–11, A32 = A12 with line 30 (inventory
// losses) as the balancing line; B7 = lines 1–6, B21 = B7 with line 20 (on hand end) = line 7 minus removals.
// A negative line 30 (net gain) is shown as a line 9 inventory gain; a negative B19 as a B5 inventory gain.
import { PDFDocument, PDFName, PDFBool, StandardFonts } from 'pdf-lib';
import { TTB_TEMPLATE } from './gen/ttb_template.js';

const CLS = ['a', 'b', 'c', 'd', 'e', 'f'];
const A_IN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], A_OUT = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31];
const B_IN = [1, 2, 3, 4, 5, 6], B_OUT = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const OPERATED_BY = 'Hermit Woods Winery\n72 Main Street, MEREDITH, NH 03253 UNITED STATES\n\nTelephone: 603-253-7968';
export const REGISTRY = 'BWN-NH-15024';

const b64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
const R = v => Math.round(Number(v) || 0);

// rounded, balanced figures per section and class -> { 'A12': {a: 4564, …}, … }
export function figures(rep) {
  const out = {}, used = { A: new Set(), B: new Set() };
  const get = (k, c) => { const m = rep.gal.get(k); return m ? m.get(c) || 0 : 0; };
  const put = (k, c, v) => { (out[k] = out[k] || {})[c] = v; };
  for (const c of CLS) {
    // Section A
    const a = {};
    for (const n of [...A_IN, ...A_OUT, 30]) a[n] = R(get('A' + n, c));
    if (a[30] < 0) { a[9] += -a[30]; a[30] = 0; }
    const a12 = A_IN.reduce((s, n) => s + a[n], 0);
    a[30] = a12 - A_OUT.reduce((s, n) => s + a[n], 0);
    if (a[30] < 0) { a[9] += -a[30]; a[30] = 0; }
    const A12 = A_IN.reduce((s, n) => s + a[n], 0);
    if (A12 || A_OUT.some(n => a[n]) || a[30]) {
      used.A.add(c);
      for (const n of [...A_IN, ...A_OUT, 30]) if (a[n]) put('A' + n, c, a[n]);
      put('A1', c, a[1]); put('A12', c, A12); put('A31', c, a[31]); put('A32', c, A12);
    }
    // Section B
    const b = {};
    for (const n of [...B_IN, ...B_OUT]) b[n] = R(get('B' + n, c));
    if (b[19] < 0) { b[5] += -b[19]; b[19] = 0; }
    const B7 = B_IN.reduce((s, n) => s + b[n], 0);
    const b20 = B7 - B_OUT.reduce((s, n) => s + b[n], 0);
    if (B7 || B_OUT.some(n => b[n]) || b20) {
      used.B.add(c);
      for (const n of [...B_IN, ...B_OUT]) if (b[n]) put('B' + n, c, b[n]);
      put('B1', c, b[1]); put('B7', c, B7); put('B20', c, b20); put('B21', c, B7);
    }
  }
  return { out, used };
}

export async function build(rep, { draft = false, asOf = '', fruit = null, kinds = null } = {}) {
  const pdf = await PDFDocument.load(b64(TTB_TEMPLATE));
  const form = pdf.getForm();
  const has = n => { try { form.getField(n); return true; } catch (e) { return false; } };
  const T = (n, v) => { if (v === null || v === undefined || v === '') return; try { form.getTextField(n).setText(String(v)); } catch (e) { /* field not on form */ } };
  // column headings: a kind name too wide for its box wraps onto two lines in a smaller type, so nothing is cut off
  const HV = StandardFonts.Helvetica, hv = await pdf.embedFont(HV);
  const H = (n, text) => {
    let f; try { f = form.getTextField(n); } catch (e) { return; }
    const r = f.acroField.getWidgets()[0].getRectangle(), W = r.width - 4;
    if (hv.widthOfTextAtSize(text, 9) <= W) { f.setText(text); return; }
    const words = text.split(' ');
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '), w = Math.max(hv.widthOfTextAtSize(a, 1), hv.widthOfTextAtSize(b, 1));
      if (!best || w < best.w) best = { t: a + '\n' + b, w };
    }
    const lines = best ? 2 : 1, wUnit = best ? best.w : hv.widthOfTextAtSize(text, 1);
    const size = Math.max(5, Math.min(8, W / wUnit, (r.height - 2) / (lines * 1.16)));
    f.enableMultiline(); f.setFontSize(Math.floor(size * 2) / 2); f.setText(best ? best.t : text);
  };
  const fieldFor = (sec, line, c) => { const n = `1${sec}.${line}.${c}`; return has(n) ? n : (c === 'e' && has(n + '.BP') ? n + '.BP' : null); };   // sparkling: bulk process (tank), never BF

  T('YEAR', rep.year);
  T('OPERATED_BY', OPERATED_BY);
  T('REGISTRY_NUMBER', REGISTRY);
  try { form.getCheckBox('VERSION_ORIGINAL').check(); } catch (e) { /* */ }

  const { out } = figures(rep);
  const notes = [];
  for (const [key, byc] of Object.entries(out)) {
    const sec = key[0], line = key.slice(1);
    for (const [c, v] of Object.entries(byc)) {
      const f = fieldFor(sec, line, c);
      if (f) T(f, v); else if (v) notes.push(`${key} ${c} ${v} gal has no box on the form`);
    }
  }
  if (out.B5 && Object.values(out.B5).some(v => v)) try { form.getDropdown('1B.5.item').select('INVENTORY GAINS'); } catch (e) { /* */ }

  // Part IV — materials received and used
  const iv = rep.part_iv;
  // other-than-grape materials: kind stated in each header (form footnote 6). Used = on hand at start + received − on hand at end.
  const col = (letter, header, begin, received, endq) => {
    const b = R(begin), r = R(received), e = R(endq), tot = b + r;
    if (!tot && !e) return;
    H(`4.${letter}.header`, header);
    T(`4.1.${letter}`, b); T(`4.2.${letter}`, r); T(`4.4.${letter}`, tot); T(`4.5.${letter}`, Math.max(0, tot - e));
    T(`4.9.${letter}`, Math.min(e, tot)); T(`4.10.${letter}`, tot);
  };
  const LBK = 1 / 0.45359237, fb = (fruit && fruit.begin) || { apple: 0, other: 0 }, fe = (fruit && fruit.end) || { apple: 0, other: 0 };
  col('e', 'APPLE JUICE (gallons)', 0, iv.cider_gal, 0);
  col('f', 'OTHER FRUIT (pounds)', fb.other * LBK, iv.fruit_lb - (iv.apple_lb || 0), fe.other * LBK);
  col('g', 'APPLES (pounds)', fb.apple * LBK, iv.apple_lb || 0, fe.apple * LBK);
  {   // sugar, dry (lb); a count gain is shown as received
    let begin = R(iv.sugar_begin_lb), rec = R(iv.sugar_received_lb), used = R(iv.sugar_used_lb), rem = R(iv.sugar_removed_lb);
    if (rem < 0) { rec += -rem; rem = 0; }
    const tot = begin + rec;
    if (tot || used) {
      T('4.1.h', begin); T('4.2.h', rec); T('4.4.h', tot); T('4.5.h', used); if (rem) T('4.8.h', rem);
      T('4.9.h', tot - used - rem); T('4.10.h', tot);
    }
  }
  // Part VII — in fermenters end of period
  const vii = Object.entries(rep.part_vii || {}).filter(([, v]) => R(v)).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  vii.slice(0, 5).forEach(([k, v], i) => { const L = 'abcde'[i]; H(`7.${L}.header`, k.toUpperCase()); T(`7.1.${L}`, R(v)); });
  if (vii.length) T('7.1.total', vii.reduce((s, [, v]) => s + R(v), 0));
  if (vii.length > 5) notes.push(`Part VII has ${vii.length} kinds; only 5 columns on the form`);

  const remarks = [];
  if (draft) remarks.push(`DRAFT — ${rep.year} to date as of ${asOf}. Not for filing until the year is complete.`);
  if (kinds && kinds.length) remarks.push(`Part IV other fruit received (lb): ${kinds.map(([k, lb]) => `${String(k).charAt(0).toUpperCase() + String(k).slice(1)} ${R(lb).toLocaleString('en-US')}`).join('; ')}.`);
  if (remarks.length) T('REMARKS', remarks.join('\n'));
  form.updateFieldAppearances(hv);   // visible in every viewer and when printed
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);          // viewers redraw a box when Ken edits it
  const bytes = await pdf.save();
  return { bytes, notes };
}
