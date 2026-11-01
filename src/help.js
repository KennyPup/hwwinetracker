// v1.31 — Help: a "?" beside every number the tracker works out behind the scenes (hover or tap: a two-line summary and
// "More →"), and one help sheet per subject at /help/<key>. Each sheet says which tracker version it describes; update the
// sheet whenever the calculation changes.
import { E } from './lib/py.js';

const V = '1.31';
export const TOPICS = {
  stock: {
    t: 'Stock: pace and months left', v: '1.32',
    s: 'Pace = every vintage of the wine (same bottle size): bottles dispatched in the last 12 months ÷ the months it was actually in stock. Months left assumes the oldest vintage sells first.',
    b: `<h2>What the columns mean</h2>
<dl><dt>Out, last 12 mo</dt><dd>Bottles of <i>this vintage</i> dispatched in the 12 months before the “As of” date. A vintage bottled within the year shows “since &lt;date&gt;”.</dd>
<dt>Wine’s pace / mo</dt><dd>The selling rate of the <i>wine</i>, all vintages together: bottles dispatched in the last 12 months ÷ the months it was in stock in that time.</dd>
<dt>Months left</dt><dd>When this vintage runs out: (on hand of every older vintage + this one) ÷ the wine’s pace. “then 25PBR” / “after 22PBR” name the vintage that follows or comes before.</dd>
<dt>Last 12 months (sparkline)</dt><dd>On-hand balance at 13 monthly points, walked back from today’s balance.</dd></dl>
<h2>Which vintages count as one wine</h2>
<p>The code with the vintage digits, size suffixes (<code>_750ml</code>, <code>_3L</code>…), punctuation and a trailing CAN/CANS removed, <b>and</b> the same bottle size. So 22PBR and 25PBR are one wine; 25PBR_3L (3 L) is separate; 25BCCan and 25BC_CAN are one wine of cans. Order: vintage year from the code, then the date each was first stocked.</p>
<h2>Months in stock</h2>
<p>All vintages’ balances added up (none counted below zero). The wine is “in stock” while that total is more than a case: 12 bottles or cans, or 1 for 3 L bottles and kegs. A new release counts only from bottling; a wine that sold out and waited for the next vintage does not count the empty weeks. Under one month in stock is divided by one month, so a launch-week spike can’t run the pace up.</p>
<h2>What counts as “out”</h2>
<p>Every dispatch type: Wholesale, NH State LC, Vinoshipper sale, Eatery Transfer, Tasting Room Sales, Tasting room Samples, Family Use. Reversed dispatches are left out. Counts, corrections and bottling are not dispatches.</p>
<h2>Limits</h2>
<ul><li>Seasonal wines (mulled cider) are projected at their in-season pace all year, so months left runs short for them.</li>
<li>Tasting-room and eatery bottles count when a dispatch is entered for them, so between entries the pace lags.</li>
<li>First-in-first-out is an assumption; when two vintages are poured side by side, the older one’s months left is too long and the newer one’s too short.</li></ul>
<h2>Adjust on hand and retire (wine page)</h2>
<p>“Adjust on hand” sets what should be on hand and books the difference one of three ways: a <b>dispatch</b> of any type (default Family Use — TTB line of that type), a <b>count</b> (inventory loss on line 19 or gain on line 5), or a <b>records correction</b> (fixes a records error; on no TTB line; a note is required). Each is an ordinary entry, so it can be corrected or reversed later.</p>
<p><b>Retire</b> marks a wine or item as no longer on the shelves: it leaves the Stock list (it is listed under Retired at the bottom) and the dispatch and bottling pickers. Only an item at zero can be retired. Nothing in its history changes, so everything it did still counts on the TTB report and in pace. Un-retire from its page.</p>
<p class="hv">Settled: one row per vintage with the wine’s pace (Option B, v1.29); in-stock months instead of a flat 12 (v1.29.1); retire + adjust on hand (v1.32).</p>`,
  },
  so2: {
    t: 'SO₂ and KMS recommendations', v: '1.31',
    s: 'Target free SO₂ = molecular × (1 + 10^(pH − 1.81)). Estimate today = last free SO₂ decayed at the vessel’s rate, plus additions since. KMS g = (target − estimate) × L ÷ 1000 ÷ 0.576 ÷ retention.',
    b: `<h2>The targets</h2>
<p>Free SO₂ needed = M × (1 + 10<sup>(pH − 1.81)</sup>), with M = 0.5 or 0.8 mg/L molecular and 1.81 the pKa used throughout. At pH 3.5 that is 25 and 40 mg/L.</p>
<h2>Estimate today</h2>
<p>Free SO₂ falls first-order: F(t) = F₀ × e<sup>−k·t</sup>, t in days. The estimate starts from the vessel’s last free SO₂ reading <i>since this wine came into it</i>, decays it to today, and adds each KMS addition made since (ppm × retention, decayed from its own date). With no reading in that vessel, the wine’s latest reading from any vessel is used and marked “lot”. The range shown uses the middle half of the decay rates seen in that vessel type.</p>
<h2>Decay rate k</h2>
<p>Fitted from pairs of consecutive free SO₂ readings in one vessel, same wine, both above 0, 1–180 days apart, with no sulfite addition and no wine moved in between, and the first reading at least 2 days after any addition. Topping and volume measurements do not break a pair. k = Σ ln(F₀/F₁) ÷ Σ days.
Each vessel’s k is shrunk toward its type — barrel, fixed tank, variable-capacity (can): k = (n·k<sub>vessel</sub> + 3·k<sub>type</sub>)/(n + 3), n = its pairs. Each type is shrunk the same way toward the default on Constants (barrel 0.010, tank 0.004 per day).</p>
<h2>Retention R</h2>
<p>How much of an addition shows up as free SO₂. Measured from additions that have a free SO₂ reading before them and the next reading 2–14 days after, same vessel: R = (free after − reading before decayed to the addition date) ÷ ppm added, where ppm = g KMS × 576 ÷ litres. Tested against the number of earlier additions to the lot and the cumulative SO₂ added; a slope is used only if it holds up (|t| ≥ 2). Doses use <b>R from Constants (0.70)</b> unless “Use measured retention” is set to 1. The <a href="/so2/calibration">SO₂ calibration</a> page lists every pair and addition and the fitted values.</p>
<h2>Grams</h2>
<p>KMS g = (target − estimate) × litres ÷ 1000 ÷ 0.576 ÷ R. 0.576 g SO₂ per g KMS is the cookbook value (Constants). 0 g when the estimate already meets the target. A barrel group still on its group record shows the grams split per barrel; clicking a target on the Addition page fills in the vessel, grams and unit.</p>
<h2>Warnings</h2>
<ul><li>Reading older than 30 days: re-test recommended.</li><li>No free SO₂ or no pH, or pH outside 2.8–4.2: the row shows, no grams.</li>
<li>Target above 50 mg/L (high pH at 0.8 molecular).</li><li>Estimated total SO₂ (last total + every ppm added since) above 150 mg/L.</li></ul>
<p>All thresholds and defaults are on <a href="/constants">Constants</a>.</p>
<h2>Limits</h2><ul><li>Additions or readings never entered make k look lower and R look off; the calibration page shows the raw pairs.</li><li>Total SO₂ readings are scarce, so the total warning rarely has a starting point.</li></ul>`,
  },
  cellar: {
    t: 'The wine’s card (right side of the wine page)', v: '1.31',
    s: 'Where the wine is, how full each vessel is, molecular SO₂ from the latest free SO₂ and pH, days since the last sulfite and topping. Worked out from the records on every view.',
    b: `<h2>Where it is</h2><p>Every vessel holding the wine now. Barrels that belong to a group show as one group entry with their barrels listed; an older group that still holds the wine on the group record shows the same way, with a link to move it into the barrels. The line “in 2 vessels — 1 tank + barrel group …” counts a group as one vessel.</p>
<h2>Fill and headspace</h2><p>Fill = litres ÷ capacity. Headspace (capacity − litres) is shown only for <b>fixed-capacity</b> vessels: barrels, barrel groups, and the tanks marked fixed (T1–T4, 250A/B, 300A/B, Super Tanks 1 and 2, Super Bright, Bright). Variable-capacity tanks show “variable lid”. Below 95% full the bar turns amber.</p>
<h2>SO₂</h2><p>Latest free SO₂ and pH of the wine (any vessel). Molecular SO₂ = free ÷ (1 + 10<sup>(pH − 1.81)</sup>), compared with 0.5–0.8 mg/L. “Last sulfite” = the latest KMS (or other sulfite) addition. Per-vessel status and KMS doses are in the SO₂ table on the General tab (see <a href="/help/so2">SO₂ and KMS</a>).</p>
<h2>Topped</h2><p>Only for barrels and barrel groups: days since the last topping of that barrel (or any barrel of the group).</p>
<p class="hv">The card shows while the wine is in Élevage or Ready; while Fermenting the formulation checklist takes its place.</p>`,
  },
  groups: {
    t: 'Barrel groups', v: '1.31',
    s: 'A group is a label over real barrels. One entry for the group is split across its barrels: additions by volume (evenly when they match), volume changes evenly.',
    b: `<h2>What a group is</h2><p>A name (e.g. 25RS(BG)) over a set of barrels you choose on the group’s vessel page. Older Vintrace groups may still hold the wine on the group record itself; those show as one row until the wine is moved into the barrels.</p>
<h2>Additions to a group</h2><p>One operation; the amount is split across the barrels that hold wine, in proportion to each barrel’s litres (equal barrels → equal shares). Same on the phone and on the Addition page.</p>
<h2>Volume adjustment (Measure) on a group</h2><p>The new total is compared with the group’s litres; the difference is spread <b>evenly</b> over its barrels, booked as a loss or gain with the reason you pick. Refused if a barrel would go below empty or above capacity (2% allowance).</p>
<h2>Move into the barrels</h2><p>For a group whose wine is on the group record: the litres are split by barrel capacity (editable), anything left over is booked as lees, recorded as “Barrel group → barrels”.</p>
<p class="hv">Settled v1.26: groups as labels over real barrels; even splits for KMS and volume adjustments.</p>`,
  },
  topping: {
    t: 'Topping', v: '1.31',
    s: 'The source loses the litres; each topped vessel stays full and its share is booked as evaporation. A barrel group gets one total, split equally by default or fine-tuned per barrel.',
    b: `<h2>How it is recorded</h2><p>The source (the tank picked in ＋ Record) goes down by the total. Each topped vessel stays at its volume: the litres replace what evaporated, so its share is booked as an evaporation loss on that vessel.</p>
<h2>Barrel groups</h2><p>The group shows its barrels with one total; the default split is equal, and each barrel’s share can be changed. The split goes into the operation notes and the topping-split table. An older group still holding the wine on its record takes the total on the record, with the per-barrel split noted.</p>
<p class="hv">Topping dates feed the “topped” line on the wine’s card and the film-yeast analysis.</p>`,
  },
  stage: {
    t: 'Stage: Fermenting, Élevage, Ready', v: '1.31',
    s: 'The stage is whichever happened last: your click, a yeast addition (→ Fermenting) or a sterile filtration (→ Ready). Élevage or Ready means the ferment is over.',
    b: `<h2>Set automatically</h2><ul><li>A yeast addition entered in the tracker → <b>Fermenting</b>.</li><li>A treatment or transfer whose treatment name contains STERILE → <b>Ready for packaging</b>.</li></ul>
<h2>Set by you</h2><p>Click the stage under the wine’s name. The latest of your click, the yeast addition and the sterile filtration wins, so a click after the event overrides it; a reversed entry no longer counts. Use the click for a native-yeast ferment (nothing pitched, e.g. the old vine) and to move a wine to Élevage.</p>
<h2>What it changes</h2><ul><li>Phone: the ferment buttons (Brix·temp, punch down) show only while Fermenting; Élevage or Ready means the ferment is over. With no stage set, the phone falls back on a gravity reading or ferment start in the last 3 weeks.</li>
<li>Wine page: the formulation checklist while Fermenting; the wine’s card and the SO₂ table otherwise.</li></ul>
<p class="hv">Vintrace-era history is not used to set the stage.</p>`,
  },
  dispatch: {
    t: 'Dispatch', v: '1.31',
    s: 'Lines over on-hand stock and repeated wines are flagged, not blocked. Repeats are added together at save; the whole dispatch saves as one entry or not at all.',
    b: `<h2>Checks while you type</h2><ul><li>More bottles than on hand: flagged ⚠, still allowed (stock can go below zero and shows red on Stock).</li><li>The same wine on two lines: flagged; added together into one line when saved.</li><li>Bottles must be a whole number above 0.</li></ul>
<h2>Saving</h2><p>After the confirm step, every line is written in one transaction: the dispatch, its lines and the stock movements all save, or none do. Default type “Tasting room Samples”, date today.</p>
<h2>Draft</h2><p>Kept in this browser until saved or discarded, so a closed tab or lost signal does not lose the lines. It is not shared between devices.</p>
<p class="hv">Dispatches drive the Stock page’s pace and months left (<a href="/help/stock">Stock</a>) and Section B of the TTB report (<a href="/help/ttb">TTB</a>).</p>`,
  },
  red: {
    t: 'Reductones (Vinmetrica B run)', v: '1.38',
    s: 'Reductones are read from your SO₂ notes (apparent free SO₂, reductones, actual). Each row pools all vintages of a wine. Apparent, reductones and actual free SO₂ are medians in ppm; “% of apparent” is the median share of each reading that was reductones.',
    b: `<h2>Where the numbers come from</h2><p>Every note that gives a Vinmetrica peroxide result — “Apparent Free SO2 / Reductones / Free SO2”, “apparent … = · reductone test = · actual … =” and similar — is read; a note with several vessels gives one result each. Notes that only mention reductones in words are listed at the bottom to check.</p>
<h2>Wine families</h2><p>From the batch code: the vintage and size or lot suffixes and trailing numbers are dropped (25CranCider3 → CRANCIDER). Different codes for the same fruit stay separate rows.</p>
<h2>Verdict</h2><ul><li><b>Carries reductones</b>: median ≥ 8 ppm, or a quarter of the readings ≥ 10 ppm — run the B test every time.</li><li><b>Some</b>: median ≥ 2 ppm or any reading ≥ 10 ppm.</li><li><b>Low</b>: only small readings.</li><li><b>None found</b>: every B run was 0.</li></ul><p>Families with one or two readings are marked “confirm with another B run”. “Weighted mean” (the wine’s mean pulled toward the all-wine mean by 3 readings’ worth) only orders the table.</p><h2>Columns</h2><ul><li><b>Apparent free SO₂</b>: run A, as titrated — reductones included.</li><li><b>Reductones</b>: A − B.</li><li><b>Actual free SO₂</b>: apparent − reductones.</li><li><b>Reductones % of apparent</b>: for each B run, reductones ÷ apparent; the median of those. 58% means a little over half of a typical apparent reading was reductones.</li></ul><p>All figures are ppm (mg/L), each the median of its own column.</p>
<h2>Older readings</h2><p>Free SO₂ recorded before the first B run was never corrected. For families that carry reductones those readings are likely high by about the family’s median, and the SO₂ decay and retention calibration uses them.</p>
<p class="hv">Built 2026-10-13 (v1.38). Readings since then are corrected — the stored free SO₂ equals the note’s actual value in 102 of 111 checks where reductones were above 0.</p>`,
  },
  film: {
    t: 'Film-yeast analysis', v: '1.31',
    s: 'Each factor compares wines that got film yeast with ones that didn’t, from conditions just before. Verdict from all pairings: the share where the film-yeast wine is lower; near 50% = no difference.',
    b: `<h2>Episodes</h2><p>Film-yeast notes on a wine, counted as separate episodes when more than 21 days apart. The automatic detection can be overruled per note (note edit page: auto / yes / no).</p>
<h2>Conditions before</h2><p>Taken from the day before the note (what was done that day is usually the response): free SO₂ within 90 days, pH within a year, alcohol, cellar temperature within 30 days, vessel fill, days since the last SO₂ addition and since the last topping or gas purge, molecular SO₂ from free SO₂ and pH.</p>
<h2>Comparison wines</h2><p>Unaffected wines from the same years, in bulk at a comparable age after their ferment started. The default compares vintages of the same wines.</p>
<h2>Range bars</h2><p>Bar = middle half of the wines, dot = median, thin line = lowest to highest; film yeast orange, unaffected blue.</p>
<h2>Verdict</h2><p>Every film-yeast wine is paired with every unaffected wine; the share of pairings where the film-yeast wine is lower (ties count half). Within 10 points of 50%: no clear difference; within 20: slightly; beyond: clearly. Fewer than 8 in either group: too few to judge.</p>`,
  },
  formulation: {
    t: 'Formulation and additions', v: '1.31',
    s: 'Doses are the cookbook’s BASIC ADDS scaled to the formulation’s target volume, not what is in the vessel while the wine is being built.',
    b: `<h2>Doses</h2><p>From the HW winemaking cookbook (BASIC ADDS), rates on <a href="/constants">Constants</a>, scaled to the target volume. KMS grams = litres × ppm ÷ 1000 ÷ 0.576. Potassium sorbate dose = sorbate rate × 1.25. FermaidK in two equal additions (half each for ciders). GoFerm hydrated in its own water.</p>
<h2>Why the target volume</h2><p>While a wine is built, water and sugar or honey go in a little at a time, so the vessel holds less than the batch will be. Doses are figured on the formulation’s target; the checklist shows fruit, water, sugar/honey and the start additions against what has been recorded.</p>
<h2>Volume added by sweeteners</h2><p>Honey 0.70 L per kg, sugar 0.62 L per kg, water 1 L per L: used for the suggested “volume after” on the Addition page. Edit it to the dip reading.</p>
<h2>Back-sweetening</h2><p>Sugar g = g/L wanted × litres. Cookbook juice litres = g ÷ (Brix × 10). The dilution-corrected figure, allowing for the volume the juice adds, is litres × D ÷ (10·Brix − D), D = g/L wanted.</p>`,
  },
  ttb: {
    t: 'TTB 5120.17 and losses', v: '1.32',
    s: 'Built from the year’s tax events, bulk snapshots and finished-goods stock movements. Line 1 carries from last year’s return as filed when it is on file.',
    b: `<h2>Section A (bulk)</h2><ul><li>Lines 1 and 31: declared (bonded) wine on hand by class at the start and end of the year, from the bulk snapshots.</li>
<li>Line 2: wine declared (at bottling, or blended into bonded wine); line 6: water added to declared wine; line 9: inventory gains; class changes on lines 4/5/19/20/22.</li>
<li>Line 13 = bottled (B2). Losses with a “TTB – …” reason on bonded wine: testing → 23, destroyed → 24, other → 29 (casualty). Losses on wine still in fermenters are noted, not on Section A.</li></ul>
<h2>Section B (bottled)</h2><ul><li>Lines 1 and 20: bottled on hand by class. Line 2 = packaged, 3 = received, 5 = count gains, 19 = count losses. Records corrections are on no line (they show only in the note on how far the stock records are from the book balance). Retired wines count like any other.</li>
<li>Dispatch lines go to the TTB line set on each dispatch type. If dispatch records and stock history differ by more than 1 gal a class, a note says so.</li></ul>
<h2>Carry-forward</h2><p>When last year’s return is on file, A1 and B1 are taken from its lines 31 and 20 as filed, and the difference from the cellar records is noted.</p>
<h2>Losses &amp; gains tab</h2><p>Every volume loss or gain on the wine (Vintrace history and new adjustments) with its reason, and totals by reason, the same rows Vintrace’s production loss report listed.</p>`,
  },
  scan: {
    t: 'Scanning and labels', v: '1.31',
    s: 'A scanned or typed name is matched exactly first, then ignoring case and spaces, then ignoring dashes, dots and underscores. Digits only = a Vintrace vessel id.',
    b: `<h2>Matching</h2><ol><li>Exactly as written.</li><li>Ignoring capitals and spaces (“b 53” = “B53”).</li><li>Ignoring dashes, dots and underscores too.</li></ol>
<p>A web address on a sticker (…/v/&lt;name&gt; or ?code=…) is taken apart and each piece tried. A real vessel is preferred over a virtual one. Digits only are read as a Vintrace vessel id. No match: “Unknown vessel — add it?”.</p>
<h2>Labels</h2><p>The QR holds only the plain vessel name, at high error correction so the logo in the middle and some creasing still read. 3.4″ labels, six per page. Creased or curved stickers may still fail; type the name or reprint.</p>`,
  },
};
const ORDER = ['stock', 'so2', 'cellar', 'groups', 'topping', 'stage', 'dispatch', 'film', 'red', 'formulation', 'ttb', 'scan'];

// the "?": hover (desktop) or tap (phone) shows the summary and a link to the sheet
export function tip(key, text = null) {
  const t = TOPICS[key];
  if (!t) return '';
  return `<span class="hq" tabindex="0" role="button" aria-label="How this is worked out">?<span class="hqt">${E(text || t.s)} <a href="/help/${key}">More →</a></span></span>`;
}
export function page_index() {
  return `<h1>Help</h1><p class="sub">How the tracker works out what it shows. Every “?” beside a number links to one of these. Tracker ${V}.</p>
<div class="hlist" data-nouc>${ORDER.map(k => `<a class="hcard" href="/help/${k}"><b>${E(TOPICS[k].t)}</b><span>${E(TOPICS[k].s)}</span></a>`).join('')}</div>
<p class="sub" style="margin-top:14px">Constants and defaults: <a href="/constants">Constants</a> · SO₂ fit: <a href="/so2/calibration">SO₂ calibration</a></p>${HCSS}`;
}
export function page_topic(key) {
  const t = TOPICS[key];
  if (!t) return null;
  const i = ORDER.indexOf(key), nx = ORDER[i + 1];
  return [t.t, `<h1>${E(t.t)}</h1><p class="sub">${E(t.s)}</p><div class="hbody" data-nouc>${t.b}</div>
<p class="hfoot">Describes tracker ${E(t.v)}. <a href="/help">All help</a>${nx ? ` · next: <a href="/help/${nx}">${E(TOPICS[nx].t)}</a>` : ''}</p>${HCSS}`];
}
const HCSS = `<style>.hlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}.hcard{display:block;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;text-decoration:none}
.hcard b{display:block;color:var(--fg2);margin-bottom:3px}.hcard span{color:var(--mut);font-size:13px}.hcard:hover{border-color:var(--acc)}
.hbody{max-width:760px;line-height:1.55}.hbody h2{font-size:16px;margin:18px 0 6px}.hbody dt{font-weight:600;color:var(--fg2);margin-top:8px}.hbody dd{margin:2px 0 0 0;color:var(--fg)}.hbody li{margin:3px 0}
.hbody code{font-size:12.5px}.hv{color:var(--mut);font-size:13px;border-left:3px solid var(--line2);padding-left:10px}.hfoot{color:var(--mut);font-size:12.5px;margin-top:22px;border-top:1px solid var(--line);padding-top:8px}</style>`;

// global: the "?" look, plus a script that keeps the tip on screen and stops a "?" in a table header from sorting the column
export const GLOBAL = `<style>.hq{position:relative;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:4px;border-radius:50%;border:1px solid var(--line2);color:var(--mut);font-size:10.5px;font-weight:700;line-height:1;cursor:help;vertical-align:1px;text-transform:none;letter-spacing:0;font-style:normal}
.hq:hover,.hq:focus{color:var(--fg2);border-color:var(--acc);outline:none}.hqt{box-sizing:border-box;display:none;position:fixed;z-index:60;top:0;left:0;width:280px;max-width:calc(100vw - 24px);background:#0d1117;border:1px solid var(--line2);border-radius:7px;padding:8px 10px;font-size:12.5px;font-weight:400;line-height:1.45;color:var(--fg2);text-align:left;white-space:normal;box-shadow:0 6px 18px rgba(0,0,0,.5)}
.hq.hqon:hover .hqt,.hq.hqon:focus .hqt,.hq.hqon:focus-within .hqt{display:block}.hqt a{white-space:nowrap;color:var(--acc)}</style>
<script>(function(){function place(h){var t=h.querySelector('.hqt');if(!t)return;var r=h.getBoundingClientRect(),w=Math.min(280,window.innerWidth-24),x=Math.max(8,Math.min(r.left,window.innerWidth-w-8)),y=r.bottom+6;t.style.left=x+'px';t.style.top=y+'px';h.classList.add('hqon');var th=t.offsetHeight||120;if(y+th>window.innerHeight-8&&r.top-th-6>8){y=r.top-th-6;t.style.top=y+'px'}var q=t.getBoundingClientRect(),dx=x-q.left,dy=y-q.top;if(Math.abs(dx)>1||Math.abs(dy)>1){t.style.left=(x+dx)+'px';t.style.top=(y+dy)+'px'}}
document.addEventListener('mouseover',function(e){var h=e.target.closest&&e.target.closest('.hq');if(h)place(h)});document.addEventListener('focusin',function(e){var h=e.target.closest&&e.target.closest('.hq');if(h)place(h)});
function off(k){document.querySelectorAll('.hq.hqon').forEach(function(h){if(h!==k)h.classList.remove('hqon')})}window.addEventListener('scroll',function(){var a=document.activeElement,k=a&&a.closest&&a.closest('.hq');off(k);if(k)place(k)},true);document.addEventListener('mouseout',function(e){var h=e.target.closest&&e.target.closest('.hq');if(h&&!h.contains(e.relatedTarget)&&!h.contains(document.activeElement))h.classList.remove('hqon')});document.addEventListener('focusout',function(e){var h=e.target.closest&&e.target.closest('.hq');if(h&&!h.contains(e.relatedTarget))h.classList.remove('hqon')});window.addEventListener('pageshow',function(e){if(!e.persisted)return;off(null);var a=document.activeElement;if(a&&a.closest&&a.closest('.hq'))a.blur()});document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('.hq')&&!e.target.closest('a'))e.stopPropagation()},true)})()</script>`;
