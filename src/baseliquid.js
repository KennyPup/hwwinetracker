// v1.75 — the base liquid of a formulation: water for most wines, cider for the ciders (Ken, 2026-11-19: "with all the
// ciders, I'm using cider as the base, no water"). The formulation maths already treats cider as the liquid when a cider SG
// is set (formulation.calc); this is the one place that says which it is, and records it the right way when a batch starts:
//   water → an Addition of the Water material (as before);
//   cider → a Bulk juice/cider intake into the vessel (kind 'bulk'), the same record the Intake page makes, so it counts
//           as cider received on TTB 5120.17 Part IV and shows on the batch's checklist.
import * as entry from './entry.js';
import { captured } from './correct.js';

export function is_cider(r) {
  return !!r && (r.category === 'Cider' || r.liquid === 'cider' || Number(r.liquid_sg) > 0);
}

export const word = r => (is_cider(r) ? 'Cider' : 'Water');

// record `litres` of the base liquid (`after` = vessel volume after; used for water only) into vessel v of batch bid at time t. Returns an error string or null.
export function record(c, { cider, t, bid, bcode, v, litres, after, supplier = '' }) {
  const note = `start of ${bcode}`;
  if (cider) {
    const form = { when: [t], kind: ['bulk'], batch_id: [String(bid)], variety: ['Cider'], variety_new: [''], supplier: [supplier || ''], region: [''],
      amount: [String(litres)], unit: ['L'], docket: [''], vessel_id: [String(v)], fill_litres: [''], notes: [note], booking_no: [''], cost: [''] };
    captured(c, '/record/intake', form, () => {
      entry.record_intake(c, t, 'bulk', bid, 'Cider', supplier || null, null, String(litres), 'L', null, Number(v), null, note);
      return ['ok', null];
    });
    return null;
  }
  const wmat = c.val("SELECT id FROM material WHERE kind='water' AND COALESCE(retired,0)=0 ORDER BY id LIMIT 1");
  if (!wmat) return 'No Water material — add one on Materials.';
  const form = { when: [t], vessel_id: [String(v)], material_id: [String(wmat)], amount: [String(litres)], unit: ['L'], volume_after: [String(after)], notes: [note], lot: [''] };
  captured(c, '/record/addition', form, () => { entry.record_addition(c, t, Number(v), wmat, String(litres), 'L', String(after), note, [], ''); return ['ok', null]; });
  return null;
}

// cider that went into a batch as bulk intakes (variety names cider), oldest first: [{t, l}]
export function cider_in(c, bid) {
  return c.all("SELECT occurred_at AS t, amount AS l FROM intake WHERE batch_id=? AND reversed=0 AND kind='bulk' AND unit='L' AND lower(COALESCE(variety,'')) LIKE '%cider%' ORDER BY occurred_at, id", bid);
}
