# HWWineTracker changelog
Newest first. One entry per version: date · editor · what changed · anything Ken must check.

## 1.77.0-cloud — 2026-11-20 · Claude
Wine card: pH shown plainly in the Free SO₂ runway (Ken: the pH drives what KMS is needed).
- New pH box under the headline: the pH in large type, where it came from ("measured <date>", "lot reading <date>", or
  "assumed — no pH reading yet" in amber when the 3.6 default is used, per vessel too), and the free SO₂ targets that pH gives
  (0.5 and 0.8 molecular, mg/L). When a wine's vessels have different pH readings, each vessel's pH is listed and the
  box says which vessel the target lines are drawn for.
- Same pH, source and targets as the batch page's SO₂ table (so2.status); nothing recalculated. Display only.
## 1.76.0-cloud — 2026-11-20 · Claude
Ciders use cider as the base liquid, not water (Ken: 26CranCider2's Make a batch screen showed 564 L of water; ciders have none).
- New src/baseliquid.js: a formulation is cider-base when its category is Cider, its liquid is "cider", or a cider SG is set.
- Make a batch: the plan row, the hints, the "record now" box and the entry field say **Cider** for cider-base formulations;
  new optional "Cider from" (orchard). Recording now puts the cider in as a **Bulk juice/cider intake** into the vessel
  (same record as the Intake page: TTB Part IV cider received; correctable like any intake), never as a Water addition.
  Fruit wines and meads unchanged (water addition as before).
- Start a batch (from fruit on hand): same rule when the chosen formulation is a cider or has a cider SG.
- Batch checklist (formulation target), phone batch card and the doses note: "Cider" row counts bulk cider intakes on the
  batch instead of water additions. Formulation page: step 4 reads Cider when a cider SG is set even if the category
  isn't Cider; planned-vs-actual shows "Cider added" from the batch's bulk intakes.
- A cider recorded at the start counts as the batch's start (Make a batch won't offer to record it a second time); the
  checklist counts bulk intakes whose variety names cider, plus any Water additions (older cider batches were booked that way).
- Maths unchanged (formulation.calc already treated the cider as the liquid when its SG is set). No table or stored data changed.
Ken: open 26CranCider2's formulation and check Category = Cider and the Cider SG is your cider's SG (it drives the OG);
then Make a batch should show Cider 564 L.
(Opened as 1.75.0 in PR #5; renumbered 1.76.0 on 2026-11-20 because the desktop layout took 1.75.0.)

## 1.75.0-cloud — 2026-11-20 · Claude
Desktop layout without the left menu, and a wine card beside the Batches list (Ken picked layout "D" from five mock-ups).
- **Menus instead of the left rail (desktop, wider than 640 px):** four drop-downs in the breadcrumb row — Cellar (Batches,
  Vessels, Dashboard), Winemaking (Formulations, Prototype wines, Additions, Constants), Inventory (Stock, Materials,
  Intakes, Dispatches), Business (Analytics, Reports, Costs, Contacts) — each entry with a one-line description. Cellar view
  and Help moved to the top bar. The HW logo now opens Batches; the About splash the logo used to open is under
  Business › About (and on "Hermit Woods / date", top right, on wide screens). "/" is still the Dashboard. Phone widths (640 px and under) keep the slide-out menu exactly
  as before; the cellar (phone) view is untouched. A page added to the menu list later lands in the last menu automatically.
- **Batches: wine card (screens wider than 1100 px).** Click a row and that wine opens in a card on the right without
  leaving the list: ＋ Record (same menu; the entry forms return to Batches with that wine's card open, on the default filters), its vessels with
  Addition and ⚖ Adjust volume per vessel, last note (film-yeast flag as on the Film yeast tab), Lab readings / Note buttons,
  volume, type, last operation, last topping (barrels), and links to every batch tab. The batch code in the card, a
  double-click on a row, or Ctrl/middle-click on a code opens the full batch page. With the card showing, the list drops the
  Year and Type columns (Type is in the card); narrower screens keep the old list and links.
- **Free SO₂ runway (in the card, wines not fermenting):** one line per vessel — readings (dots), KMS additions (green
  ticks), the estimate to today and its projection, the range at today, and the 0.5 / 0.8 molecular target lines at the
  wine's pH (3.6 assumed until a pH is recorded, as before). Headline: estimate today in the vessel that needs KMS first,
  "Add KMS by <date>" or "Below 0.5 molecular — add KMS now", and the KMS grams for 0.8 molecular. A wine with no free SO₂
  reading is drawn dashed and marked as an estimate. All figures are the batch page's SO₂ table figures (so2.status); the
  one new calculation is the date: days = ln(estimate ÷ 0.5-molecular target) ÷ k, per vessel.
- **Batches: "Free SO₂ est." column** — estimate today in the lowest vessel with a bar against its 0.5 target; "?" = no
  reading yet. Sorts by distance above/below the target; the first click lists the wine that needs KMS first.
No table or stored data changed (display only; so2.status returns extra fields, opmenu's return-to list gained
/batches?sel=; table sorting keeps a heading's own tooltip and honours data-first="asc"). New file src/batchcard.js. Checked on a local copy of the 2026-10-02 backup, not on today's data.
Ken: after merge the splash shows 1.75.0-cloud; check a wine with a fresh free SO₂ reading and one in several vessels.

## 1.74.0-cloud — 2026-11-19 · Claude
Analytics › Sales: the Annual sales & runway table redesigned for a quick read (Ken: columns hard to read, too much at once).
- Seven columns: product line, status flag (Start overdue / Start soon / Gap coming / Long on stock / OK), a 3-year stock
  bar (blue = bottled, teal = carried by wine in tank or planned, red = nothing to sell, ▼ = start next batch by),
  bottled now, sells per year, runs out, and "What to do" in plain words with production time and start months.
- Listed most urgent first; flag counts above the table filter it; headings still sort; ▸ opens the figures behind a
  line (stock by SKU, unbooked estimate, tank batches, sales rates, dates); Expand all.
- New: "Long on stock" = 3+ years of sales covered incl. tank and plans; for overdue lines, what a batch started at the
  next allowed moment gives (ready date, months with none to sell).
No table or stored data changed; display and two derived figures only. Line pages and Sales history unchanged.
Ken: after merge the splash shows 1.74.0-cloud.

## 1.73.0-cloud — 2026-11-19 · Claude
New **Analytics › Sales** tab (desktop), replacing the WineSalesbySKU workbook as the thing to look at.
- **Annual sales & runway** (lead view, after Ken's ANNUAL SALES sheet): one row per product line — bottled stock
  estimated for today (on hand minus month-end sales not yet booked), wine in tank as bottle/can equivalents, planned
  batches, sold in the last 12 booked months, Ken's annual figure, years of stock, run-out dates (bottled only, and
  incl. tank & plans, with a seasonal sales shape), production time fruit-to-bottle, the months a batch can be started,
  "start next batch by" with Overdue / < 3 months flags, and a 24-month stock strip. Dispatch-type filter chips.
- **Line page** (/analytics/sales/line?id=): projected stock chart, monthly bottles-out bars by dispatch type, the line's
  SKUs (add/remove), tank batches (share %, ready date from the batch stage or production time), planned batches, settings.
- **Sales history**: compare lines by month/quarter/year, ranked last-12 vs prior-12 with sparklines.
- New tables (additive, idempotent): sales_line, sales_line_item, sales_line_batch, sales_plan; app_meta key sales_seeded.
  Seeded once from ANNUAL SALES (20 lines: col D annual figure, col S production time) and the Stock-item filters of
  each per-wine pivot sheet (workbook through Sep 2026) plus newer vintages; seasons only where a sheet note says so;
  tank batches on 2026-11-18 assigned by code (marked "auto"). No costs, prices or margins. No existing table changed.
  Last night's R2 backup checked before this change: daily/main/HWWineTracker_main_2026-11-19.ndjson.gz (07:13 UTC, 2.5 MB).
- Projection: stock never goes below zero (a gap is lost sales, not a backorder); wine in tank / plans land on their own
  day; a gap before tank wine is ready is shown in red; "start next batch by" works from the last run-out that nothing
  known refills. Wholesale and NHLC orders count in the rate but not in the seasonal shape.
Ken: check the auto tank assignments (e.g. 25PB → Petite Blue, 26Straw2/26StrawHG → Strawberry), fill in seasons and
production times marked "not set", and add a line for Cirque (24Cirque 1,524 bottles is in "not in a product line").

## 1.72.4-cloud — 2026-11-13 · Claude
Fix Error 1101 (site down since the Zero Trust team rename on 13 Nov): `ACCESS_TEAM` in wrangler.toml
changed from icy-sun-dd2e.cloudflareaccess.com to kchgeology.cloudflareaccess.com, at Ken's request. The
sign-in check fetched its keys from the old team address, which no longer exists. `ACCESS_AUD` unchanged.
No app code or data changed. Ken: after merge, the tracker should open (one PIN prompt) and the splash
screen should show Version 1.72.4-cloud.

## 1.72.3-cloud — 2026-11-01 · Claude
Pinned wrangler 4.156.0 as a devDependency so Cloudflare Workers Builds uses the same version every
build. AGENTS.md: branch builds are off, so every PR must pass a local dry-run first. No app behaviour changed. Ken: after merge, the splash screen should show Version 1.72.3-cloud.

## 1.72.2-cloud — 2026-11-01 · baseline
Repository started from Ken's laptop folder (Documents\HW\claude_work\cloud\hwwinetracker), version as
live per Drive STATE. Earlier history: Drive `Claude/log/hermit-woods` and the `_superseded` copies.
Added AGENTS.md, CLAUDE.md, GEMINI.md, CHANGELOG.md, .gitignore. No app code changed.
