# RESUME — cloud session state (read this first if you are a fresh session)

Session: https://claude.ai/code/session_01SwqbJAR48dpA7SnBCiWhwy
Branch holding this file: `claude/publish-queue-audit-h4btgq` (comedyatlas-app, draft PR #1)
Last updated: 2026-11-04 (in progress)

## Current task (Robert, 2026-11-04 evening)
PRIORITY: verify partner links are live on the real pages:
1. Skiddle links carry `sktag=15788`: count tagged vs untagged.
2. Theatre Tickets Direct links via Awin publisher `3039909`.
3. The Awin BilletReduc redirect works.
4. Ticketmaster links are plain (no affiliate ID): count them, **do not change them**.

Report per partner: links found / tagged / broken, with example URLs. Then continue the audit fixes.

Budget: about $40 of cloud credit, expiring 2026-11-05 09:00 Paris time. Work in small committed increments, and update this file after every step.

## Done before this task (all draft PRs; nothing merged or deployed)
- comedy-network-db **#14**: Velvet 20:30 ticket link + restore the 19:00 open mic (scripts; Mac applies them).
- comedy-network-db **#15**: booker show home, co-owners, shared lineups, venue comics report.
- comedy-network-db **#16**: `pariscomedy_listings.json` exported from Atlas, plus a parity check and `set_event_language.py`.
- comedy-network-db **#17**: `go.html` per-event shards (~3 KB instead of 3.8 MB per click), plus the address line fix.
- pariscomedy.com **#1**: the calendar shows a message instead of going blank.
- pariscomedy.com **#2**: one listings loader (`listings_source` backend|atlas) + phone overflow fix (stacked on #1).
- All required CI is green. The optional full-suite job and pariscomedy.com `guard` were already red on base (explained in a comment on each PR).

## Steps (update status as you go)
- [ ] S1 Skiddle on-page verification
- [ ] S2 Theatre Tickets Direct / Awin 3039909 search
- [ ] S3 Awin BilletReduc redirect check
- [ ] S4 Ticketmaster plain-link count
- [ ] S5 Write `docs/PARTNER_LINK_AUDIT_2026-11-04.md` and commit it here
- [ ] S6 Next audit fixes (see "Next")

## Next
After S5: remaining audit fixes that need no input from Robert. The pariscomedy.com sitemap is generated on the Mac, so it's out of scope here.

## Environment notes for a fresh session
- Allowed network: `*.pariscomedy.com`, `pariscomedy.com`, `*.comedyatlas.app`, `comedyatlas.app`, github.com, package managers. **`awin1.com` is NOT allowed**, so the final Awin hop can't be followed from the cloud.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Python venv with playwright: `/tmp/claude-0/venv`. Rebuild it if missing: `uv venv -p python3.12` then `uv pip install -r requirements-dev.txt` in comedy-network-db.
