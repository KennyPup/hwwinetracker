# HWWineTracker on Cloudflare

- `src/` — the app (JavaScript port of `..\..\cellar\app\*.py`, same pages and calculations). Runs as Worker `hwwinetracker`;
  the database is SQLite inside a Durable Object (`main` = real records, `practice` = practice copy).
- `admin/` — Worker `hwwinetracker-admin`: token-protected door the laptop uses to load data and take backups.
- `tools/load.py` — pushes a laptop SQLite database (cellar.db / practice.db) into the cloud.
- Sign-in: Cloudflare Access (email code) on the `hwwinetracker` Worker. Until it's switched on, the site shows nothing.
- Secrets live in `..\.secrets\` (cloudflare_token.txt, hwt_admin_token.txt) and are never printed.
