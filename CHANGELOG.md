# HWWineTracker changelog
Newest first. One entry per version: date · editor · what changed · anything Ken must check.

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
