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
- [x] S1 Skiddle: 2,306/2,306 tagged, 10/10 live clicks OK
- [x] S2 TTD: 0 links anywhere (never built; needs feed from Robert)
- [x] S3 BilletReduc: 2,572 wrapped; 10/10 clicks reach correct Awin URL; final hop unverifiable (awin1 blocked). pariscomedy.com links 2 BilletReduc shows RAW (no Awin)
- [x] S4 Ticketmaster: 7,617 plain, unchanged; 10/10 clicks OK
- [x] S5 docs/PARTNER_LINK_AUDIT_2026-11-04.md committed
- [x] S6 pariscomedy.com partner wrap: commit 6cbf89b on claude/listings-from-atlas (PR #2); verified in Chromium (choumi -> Awin URL)
- [x] S7 Reported to Robert (partner table in docs/PARTNER_LINK_AUDIT_2026-11-04.md)

## Next
Nothing else codeable without Robert's input. Waiting on:
- merges: comedy-network-db #14 (Velvet ticket, urgent), #11, #9, #15, #16, #17; pariscomedy.com #1 then #2; comedyatlas-app #1;
- TTD: a feed/link format from Robert (0 links exist today);
- Mac: verify the final Awin hop with `curl -sSIL` (command in the audit doc); the pre-migration data fixes from #16;
- decisions: Julie Collas en/fr; Ticketmaster affiliate program.
CI watch: PRs #16, #17, pariscomedy.com #2 have required checks green; the remaining red is pre-existing (explained on each PR).

## Environment notes for a fresh session
- Allowed network: `*.pariscomedy.com`, `pariscomedy.com`, `*.comedyatlas.app`, `comedyatlas.app`, github.com, package managers. **`awin1.com` is NOT allowed**, so the final Awin hop can't be followed from the cloud.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Python venv with playwright: `/tmp/claude-0/venv`. Rebuild it if missing: `uv venv -p python3.12` then `uv pip install -r requirements-dev.txt` in comedy-network-db.
