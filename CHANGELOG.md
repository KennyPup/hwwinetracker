# HWWineTracker changelog
Newest first. One entry per version: date · editor · what changed · anything Ken must check.

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
