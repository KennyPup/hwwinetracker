# HWWineTracker — rules for every AI and human editing this repo

Owner: Ken Hardcastle (Hermit Woods Winery). Editors: Ken, Claude, Gemini. One shared rulebook:
CLAUDE.md and GEMINI.md only point here. Change these rules only when Ken asks.

## What this is
- Cloudflare Worker `hwwinetracker` (src/, wrangler.toml), live at hwwinetracker.ken-7ec.workers.dev behind
  Cloudflare Access. Database = SQLite inside the Durable Object `Cellar` (instances `main` = real records,
  `practice` = practice copy). Nightly R2 backup to `hwwinetracker-backups` (cron 07:13 UTC, src/backup_r2.js).
- `admin/` = separate Worker `hwwinetracker-admin` (token door for laptop scripts). Not auto-deployed; deploy
  manually and only when Ken asks. It imports ../src/backup_r2.js and reaches `Cellar` by script_name, so
  any PR touching src/backup_r2.js or the /_admin routes must say "admin redeploy needed".
- `tools/` = laptop Python scripts. Secrets live outside the repo (Ken's `..\.secrets\`) and in Cloudflare
  secrets (ADMIN_TOKEN, BACKUP_TOKEN). Never put a token, key or password in the repo, a commit or a log.

## Source of truth and deploys
- GitHub `main` = what is live. Cloudflare Workers Builds deploys every push to `main` (`npx wrangler deploy`).
  Builds for other branches are switched off in Cloudflare, so before opening a PR run
  `npm ci && npx wrangler deploy --dry-run` yourself and say in the PR that it passed.
- Nobody runs `wrangler deploy` from a laptop for this Worker any more (emergency only, with Ken's say-so,
  and then commit the same code to `main` straight after).

## Every session
1. Pull / start from the latest `main`. Read CHANGELOG.md (top entries) before touching code.
2. Work on a branch named `<ai>/<short-topic>` (e.g. `claude/kms-panel`, `gemini/dispatch-fix`).
3. Bump `VERSION` in src/core.js, keeping the `-cloud` suffix (e.g. `1.72.3-cloud`; patch for fixes, minor for features) and add a CHANGELOG.md entry
   (version, date, who, what changed, anything Ken must check).
4. Commit messages start with the editor: `[Claude] v1.72.3: ...`, `[Gemini] ...`, `[Ken] ...`.
5. Push the branch and open a pull request. Ken merges = it goes live. Never merge or push to `main`
   yourself unless Ken explicitly says to for that change.
6. Small, focused changes. If `main` moved while you worked, rebase/merge it in and re-check.
7. After Ken merges, note the version in Drive `Claude/log/hermit-woods` (one line, pointing to the
   CHANGELOG — do not duplicate it).

## Data safety (the database is not in git — it can't be rolled back by git)
- Any change to tables or stored data: check the latest nightly R2 backup exists first; make the change
  additive (new columns/tables; never drop or rename without Ken's explicit approval); make it
  idempotent; say so in the PR and the CHANGELOG.
- Durable Object `[[migrations]]` in wrangler.toml: only append new tags, never edit or remove old ones.
- Test against `practice` before `main` where the app allows it.
- Never change `MODE`, `ACCESS_TEAM`, `ACCESS_AUD`, bindings or the cron without Ken asking.
- `DEV_NOAUTH=1` switches Cloudflare Access sign-in off entirely (src/lib/access.js). Never put it in
  wrangler.toml `[vars]` or a Cloudflare variable; local `.dev.vars` only.
- Never rename the `Cellar` class or use `deleted_classes` in a migration — that destroys the database.
- Backup pruning (src/backup_r2.js keeps 30 days of dailies plus every 1st-of-month copy) and its
  state.json logic: no changes without Ken. Check last night's backup on the app's backup page before
  any data change.

## Build forward only — never remove or regress these
- Dual metric/imperial formulation cards; interactive lab charts; vessel QR scanning (existing Vintrace
  stickers encode the vessel name); stock Option B pacing.
- Clickable sortable columns and sticky table headers everywhere; multi-line dispatch entry (default
  Tasting room samples + today); dispatches correctable at any later date; entry range checks.
- Cellar view / Full app switch (phone → cellar, desktop → full); phone search across bulk, bottled
  stock and materials; desktop top-bar converters (gal⇄L, lb⇄kg).
- KMS/SO₂ panel, dip-chart volume adjust, TTB 5120.17 output, nightly R2 backup.
If a request seems to conflict with one of these, ask Ken first.

## Winemaking rules that apply to the app's content
- Top-grade fruit only; never suggest seconds or process-grade fruit.
- Cookbook is the master for addition doses (KMS factor 0.576).
