// v1.18 — a batch's formulation target. While a wine is being built, water and sugar/honey go in a little at a time, so the
// vessel holds less than the batch will be; doses (KMS and the like) are figured on the formulation's target volume.
// batch_target(c, bid) → null, or the linked formulation's target and plan, and how much water and sweetener are in so far.
// v1.20 — batch_plan(c, bid): the whole formulation as a checklist against what has been recorded on the batch:
// fruit (by fruit when the formulation has a fruit mix), water, sugar/honey (each addition listed), and the cookbook's start
// additions (KMS, pectic enzymes, yeast, GoFerm) and the two FermaidK additions, all dosed on the target volume.
import * as F from './formulation.js';

const LB = 0.45359237;

export function batch_target(c, bid) {
  if (!bid) return null;
  let r;
  try {
    r = c.one('SELECT * FROM formula WHERE batch_id=? AND deleted=0 AND COALESCE(is_master,0)=0 AND target_l>0 ORDER BY id DESC LIMIT 1', bid);
  } catch (e) {
    return null;
  }
  if (!r) return null;
  const C = F.constants(c);
  const x = F.calc({ ...r }, C);
  const sw = r.sweetener || 'none';
  let lb = sw === 'none' ? 0 : x.lb;
  if (sw !== 'none' && !(r.brix_desired > 0) && r.sweet_lb_per_gal > 0) lb = r.sweet_lb_per_gal * x.gal;   // older rate recipes (same as makebatch.plan_of)
  const k = sw === 'honey' ? 1 / C.honeyLbPerGal : C.sugarVol;
  const sweet_l = lb * k * C.lPerGal, juice_l = x.juice * C.lPerGal;
  const water_l = Math.max((r.target_l || 0) - juice_l - sweet_l, 0);
  const adds = additions(c, bid);
  const water_in = adds.filter(a => a.kind === 'water').reduce((s, a) => s + a.l, 0);
  const sweet_in = adds.filter(a => a.kind === 'sugar' || a.kind === 'honey').reduce((s, a) => s + a.lb, 0);
  return { r, C, x, fid: r.id, name: r.name, target_l: r.target_l, sw, water_l, sweet_lb: sw === 'none' ? 0 : lb, fruit_lb: x.fruit || 0, water_in, sweet_in, adds };
}

// every addition on the batch (not reversed), oldest first, in g / ml / lb / L
function additions(c, bid) {
  return c.all(`SELECT o.occurred_at AS t, m.name AS name, m.kind AS kind, m.base_unit AS bu, a.amount AS amount, a.unit AS unit, a.amount_base AS base
                FROM op_addition a JOIN operation o ON o.id=a.op_id JOIN material m ON m.id=a.material_id
                WHERE a.batch_id=? AND o.reversed=0 ORDER BY o.occurred_at, a.id`, bid).map(a => {
    const u = String(a.unit || '').toLowerCase();
    const mass = { g: 1, kg: 1000, mg: 0.001, lb: 1000 * LB, oz: 1000 * LB / 16 }[u];
    const vol = { ml: 1, l: 1000 }[u];
    let g = mass !== undefined ? a.amount * mass : null, ml = vol !== undefined ? a.amount * vol : null;
    if (g === null && ml === null && a.base !== null && a.base !== undefined) {   // fall back on the base amount
      if (a.bu === 'kg') g = a.base * 1000; else if (a.bu === 'L') ml = a.base * 1000;
    }
    return { t: a.t, name: a.name, kind: a.kind, g, ml, lb: g !== null ? g / 1000 / LB : 0, l: ml !== null ? ml / 1000 : (a.kind === 'water' && g !== null ? g / 1000 : 0) };
  });
}

// fruit that went into the batch, by item (on-hand lots used + direct intakes), in lb
function fruit_in(c, bid) {
  const m = new Map();
  const put = (item, lb) => m.set(item || 'Fruit', (m.get(item || 'Fruit') || 0) + lb);
  try {
    for (const r of c.all(`SELECT i.item AS item, SUM(CASE WHEN l.action='use undone' THEN -l.amount_kg ELSE l.amount_kg END) AS kg
                           FROM ingredient_lot_log l JOIN ingredient_lot i ON i.id=l.lot_id WHERE l.batch_id=? AND l.action IN ('used','used up','use undone') GROUP BY i.item`, bid))
      if (Math.abs(r.kg || 0) > 1e-6) put(r.item, r.kg / LB);
  } catch (e) { /* no lots table */ }
  for (const r of c.all("SELECT variety AS item, SUM(amount) AS kg FROM intake WHERE batch_id=? AND reversed=0 AND kind='fruit' AND unit='kg' GROUP BY variety", bid)) put(r.item, (r.kg || 0) / LB);
  return m;
}

const stems = t => String(t || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3).map(w => (w.endsWith('ies') ? w.slice(0, -3) : (w.endsWith('es') && w.length > 5 ? w.slice(0, -2) : (w.endsWith('s') ? w.slice(0, -1) : w))));
const hits = (a, b) => { const A = stems(a), B = stems(b); return A.some(x => B.some(y => x.startsWith(y) || y.startsWith(x))); };

export function parse_mix(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.filter(x => x && String(x.fruit || '').trim() && Number(x.pct) > 0).map(x => ({ fruit: String(x.fruit).trim(), pct: Number(x.pct) })) : [];
  } catch (e) {
    return [];
  }
}

export function batch_plan(c, bid) {
  const T = batch_target(c, bid);
  if (!T) return null;
  const { r, C } = T;
  const b = c.one('SELECT beverage_type FROM batch WHERE id=?', bid) || {};
  const cider = r.category === 'Cider' || String(b.beverage_type || '').toLowerCase().includes('cider');
  const V = T.target_l;
  const D = new Map(F.doses(V, C, cider).map(d => [d[0], d]));
  const A = T.adds;
  const sections = [];
  const row = (label, plan, done, unit, extra = {}) => ({ label, plan, done, unit, ...extra });

  // fruit
  const fin = fruit_in(c, bid);
  const fruitDone = [...fin.values()].reduce((s, v) => s + v, 0);
  const mix = parse_mix(r.fruit_mix);
  const fr = [row('Fruit, total', T.fruit_lb, fruitDone, 'lb', { strong: true })];
  if (mix.length) {
    const tot = mix.reduce((s, x) => s + x.pct, 0) || 100;
    const used = new Set();
    for (const m of mix) {
      let d = 0;
      for (const [item, lb] of fin) if (!used.has(item) && hits(m.fruit, item)) { d += lb; used.add(item); }
      fr.push(row(`${m.fruit} <small>${+(100 * m.pct / tot).toFixed(1)}%</small>`, T.fruit_lb * m.pct / tot, d, 'lb', { sub: true }));
    }
    for (const [item, lb] of fin) if (!used.has(item)) fr.push(row(`${item} <small>not in the mix</small>`, null, lb, 'lb', { sub: true }));
  } else if (fin.size > 1 || (fin.size === 1 && ![...fin.keys()][0].match(/^fruit$/i))) {
    for (const [item, lb] of fin) fr.push(row(item, null, lb, 'lb', { sub: true }));
  }
  sections.push(['Fruit', fr]);

  // water and sweetener
  const wat = A.filter(a => a.kind === 'water');
  const swA = A.filter(a => a.kind === 'sugar' || a.kind === 'honey');
  const lq = [row('Water', T.water_l, T.water_in, 'L', { events: wat.map(a => [a.t, a.l, 'L']) })];
  if (T.sw !== 'none') lq.push(row(T.sw === 'honey' ? 'Honey' : 'Sugar', T.sweet_lb, T.sweet_in, 'lb', { events: swA.map(a => [a.t, a.lb, 'lb']), split: true }));
  sections.push(['Water and ' + (T.sw === 'honey' ? 'honey' : T.sw === 'sugar' ? 'sugar' : 'sweetener'), lq]);

  // start additions: first KMS, pectic enzymes, yeast, GoFerm
  const kms = A.filter(a => a.kind === 'sulfite' || /kms|metabisulfite/i.test(a.name));
  const isGo = a => /go\s*-?ferm/i.test(a.name);
  const pec = re => A.filter(a => a.kind === 'enzyme' && re.test(a.name));
  const yeast = A.filter(a => a.kind === 'yeast');
  const go = A.filter(isGo);
  const st = [
    row('KMS at start', D.get('kmsStart')[3], kms.length ? kms[0].g : 0, 'g', { events: kms.slice(0, 1).map(a => [a.t, a.g, 'g']) }),
    row('Pectic enzyme HC', D.get('pecHC')[3], pec(/\bHC\b/i).reduce((s, a) => s + (a.ml || 0), 0), 'ml'),
    row('Pectic enzyme PEC5L', D.get('pec5L')[3], pec(/5\s*L/i).reduce((s, a) => s + (a.ml || 0), 0), 'ml'),
    row('Yeast' + (yeast.length ? ` <small>${[...new Set(yeast.map(a => a.name.replace(/^Yeast\s*/i, '')))].join(', ')}</small>` : (r.yeast ? ` <small>${r.yeast}</small>` : '')), D.get('yeast')[3], yeast.reduce((s, a) => s + (a.g || 0), 0), 'g'),
    row('GoFerm', D.get('goferm')[3], go.reduce((s, a) => s + (a.g || 0), 0), 'g'),
  ];
  const otherPec = A.filter(a => a.kind === 'enzyme' && !/\bHC\b/i.test(a.name) && !/5\s*L/i.test(a.name));
  if (otherPec.length) st.push(row(`Other enzyme <small>${[...new Set(otherPec.map(a => a.name))].join(', ')}</small>`, null, otherPec.reduce((s, a) => s + (a.ml || 0), 0), 'ml'));
  sections.push(['Start', st]);

  // nutrient: the 1st FermaidK-type addition, then the rest (GoFerm is the hydration nutrient, counted above)
  const nut = A.filter(a => a.kind === 'nutrient' && !isGo(a));
  const first = nut.length ? nut[0] : null;
  const firstDay = first ? String(first.t).slice(0, 10) : null;
  const n1 = nut.filter(a => String(a.t).slice(0, 10) === firstDay), n2 = nut.filter(a => String(a.t).slice(0, 10) !== firstDay);
  const nm = list => (list.length ? ` <small>${[...new Set(list.map(a => a.name === 'nutrient' ? 'FermaidK' : a.name))].join(', ')}</small>` : '');
  sections.push(['Nutrient', [
    row('1st nutrient' + nm(n1), D.get('fk1')[3], n1.reduce((s, a) => s + (a.g || 0), 0), 'g', { events: n1.map(a => [a.t, a.g, 'g']) }),
    row('2nd nutrient' + nm(n2), D.get('fk2')[3], n2.reduce((s, a) => s + (a.g || 0), 0), 'g', { events: n2.map(a => [a.t, a.g, 'g']) }),
  ]]);
  return { T, V, cider, sections, mix };
}

// done when the recorded amount reaches the plan (2% allowance for rounding the dose)
export function state(p) {
  if (p.plan === null || p.plan === undefined || !(p.plan > 0)) return p.done > 0 ? 'info' : 'none';
  if (p.done >= p.plan * 0.98) return 'done';
  return p.done > 0 ? 'part' : 'none';
}
