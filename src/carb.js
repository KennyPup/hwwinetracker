// Carbonation and the TTB tax class (27 CFR 24.10). Still wine: not more than 0.392 g CO2 per 100 mL (about 2 volumes).
// Artificially carbonated wine: CO2 injected, above 0.392 g → class (d). Hard cider keeps class (f) up to 0.64 g/100 mL
// (still, sparkling or artificially carbonated hard cider); above that it is artificially carbonated wine (d).
// Hermit Woods practice (Ken, 2026-10-05): in-house low-volume carbonation stays still (a) or hard cider (f);
// Flag Hill injects up to 5 bar → (d). A "Carbonate" treatment records the CO2 level and where it was done.
export const STILL_MAX = 0.392, CIDER_MAX = 0.64;
export const G_PER_VOL = 0.1977;   // g CO2 per 100 mL for 1 volume (1.977 g/L at 0 °C, 1 atm)
export const UNITS = [['vol', 'volumes'], ['gL', 'g/L'], ['bar', 'bar (gauge, injection pressure)']];
export const WHERE = [['inhouse', 'In-house'], ['flaghill', 'Flag Hill (injected)']];
const MAX = { vol: 6, gL: 12, bar: 8 };

// g CO2 per 100 mL from what was entered (bar is a pressure, not a CO2 content: no conversion)
export function g100(value, unit) {
  const v = Number(value);
  if (!isFinite(v)) return null;
  return unit === 'vol' ? v * G_PER_VOL : unit === 'gL' ? v / 10 : null;
}

// validate the carbonation fields of a Carbonate treatment form -> {value, unit, where, g100} or null if left blank
export function from_form(g) {
  const raw = String(g('co2') || '').trim(), unit = g('co2_unit') || 'vol', where = g('co2_where') || 'inhouse';
  if (!WHERE.some(([k]) => k === where)) throw new Error('Pick where it was carbonated.');
  if (raw === '') return where === 'flaghill' ? { value: null, unit: null, where, g100: null } : null;
  const v = Number(raw.replace(',', '.'));
  if (!isFinite(v) || v < 0) throw new Error('CO₂ level: enter a number.');
  if (!MAX[unit]) throw new Error('Pick the CO₂ unit.');
  if (v > MAX[unit]) throw new Error(`${v} ${unit === 'gL' ? 'g/L' : unit} is outside the sensible range (0–${MAX[unit]}) — check the number and unit.`);
  return { value: v, unit, where, g100: g100(v, unit) };
}

export function describe(k) {
  if (!k) return '';
  const u = { vol: 'vol', gL: 'g/L', bar: 'bar' }[k.unit] || '';
  const lvl = k.value !== null && k.value !== undefined ? `CO₂ ${k.value} ${u}${k.g100 !== null && k.g100 !== undefined ? ` (${k.g100.toFixed(2)} g/100 mL)` : ''}` : 'CO₂ level not recorded';
  return `${lvl} · ${k.where === 'flaghill' ? 'Flag Hill (injected)' : 'in-house'}`;
}

// tax class from a carbonation record and the wine type; null when it can't be decided
export function classify(k, isCider) {
  if (!k) return null;
  if (k.where === 'flaghill') return { cls: 'd', why: 'carbonated at Flag Hill (injected) — artificially carbonated' };
  if (k.g100 === null || k.g100 === undefined) return null;
  if (isCider) return k.g100 <= CIDER_MAX ? { cls: 'f', why: `${k.g100.toFixed(2)} g/100 mL — within the 0.64 hard-cider limit` }
    : { cls: 'd', why: `${k.g100.toFixed(2)} g/100 mL — over the 0.64 hard-cider limit` };
  return k.g100 <= STILL_MAX ? { cls: 'a', why: `${k.g100.toFixed(2)} g/100 mL — still wine (≤ 0.392)` }
    : { cls: 'd', why: `${k.g100.toFixed(2)} g/100 mL — over 0.392, artificially carbonated` };
}

// the latest Carbonate treatment on any vessel of this batch -> {when, ...carb} or null
export function latest_for_batch(c, bid) {
  const r = c.one(`SELECT o.occurred_at, o.details FROM operation o JOIN op_vessel ov ON ov.op_id=o.id
                   WHERE ov.batch_id=? AND o.treatment='Carbonate' AND o.reversed=0 ORDER BY o.occurred_at DESC, o.id DESC LIMIT 1`, bid);
  if (!r) return null;
  let d = null;
  try { d = r.details ? JSON.parse(r.details) : null; } catch (e) { d = null; }
  return d && d.carb ? { when: r.occurred_at, ...d.carb } : { when: r.occurred_at, value: null, unit: null, where: null, g100: null };
}
