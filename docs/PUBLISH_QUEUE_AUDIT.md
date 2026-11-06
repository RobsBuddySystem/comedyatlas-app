# Publish queue audit — 2026-10-09

Scope: this repo holds only the *output* of the publish worker (no queue code), so the audit is
derived from the `publish_worker` commit trail (50 commits, 2026-10-06 → 2026-10-09), the data
manifest, and the sitemaps. All figures were measured against `HEAD` (`e6e597cf4`). Nothing in the
site content was changed by this audit.

## Healthy
- **Manifest integrity:** all 9 files in `data/comedy-atlas/MANIFEST.json` exist; sha256 and row counts match.
- **Sitemaps:** all 11 sitemaps (~30.7k URLs) resolve to files on disk; no duplicate URLs, no dead entries.
- **Cadence:** `clock-refresh` runs every ~1–3 h, `cityguide` and `daily_blog` daily, no gaps. Prune count is stable (~1430–1490); archive count grows monotonically (9563 → 10280).

## Findings

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| 1 | **High** | **Event data is ~3 days stale.** `upcoming_events.json`, `MANIFEST.json` (`generated_at` 2026-10-06T19:28Z) and `sitemap-event.xml` last changed 2026-10-06, while `clock-refresh` keeps running. The clock-refresh handles page-level archiving but never refreshes the dataset. | 701 of 23,018 "upcoming" events start before 2026-10-09; 698 of them are still in `sitemap-event.xml`. |
| 2 | Medium | **Four new blog posts are not in `sitemap-blog.xml`** (104 listed vs 108 post dirs incl. index; 107 posts). Daily blog publish is scoped to `comedy-atlas/blog/*` so it never touches the sitemap. | Unlisted: `comedy-club-barcelona-…-sep-30-oct-7-2026`, `comedy-club-berlin-…-sep-29-oct-6-2026`, `comedy-show-kansas-city-…-oct-2-oct-9-2026`, `stand-up-comedy-madrid-…-oct-1-oct-8-2026`. |
| 3 | Medium | **Event dataset/page mismatch:** 85 events in `upcoming_events.json` have no page directory. | `data slugs − event dirs = 85`. |
| 4 | Low | **Commit messages misreport counts.** `publish [cityguide] 382 file(s) added` is really 382 files *modified*; `publish [daily_blog] 108 file(s) added` changed 2 files (1 new post + index). The number appears to be total files in scope, not the diff. This makes the log useless for detecting empty or partial publishes. | `git show --stat 599731ec1 e6e597cf4`. |
| 5 | Low | `publish [cityguide]` rewrites all 382 pages every day even when content is mostly unchanged (many 4-line diffs) → needless churn / repo growth. | `git show --stat 599731ec1`. |
| 6 | Info | 10,889 event dirs are not in the sitemap. Consistent with the ~10.3k archived pages (intentional), but archived pages remain crawlable on disk; confirm they carry `noindex`/redirect. | `dirs − sitemap = 10889`, archive = 10280. |
| 7 | Info | `recovered` counts spike (e.g. 7780, 6480, 5824) on the nightly runs that also "mark ongoing"/"city" changes — likely re-publishing pages after the data rebuild. Worth confirming "recovered" is expected rather than a symptom of a previous partial publish. | Sum of `recovered` over 50 commits ≈ 50.8k. |

## Recommended fixes (worker side, outside this repo)
1. Have `clock-refresh` (or a daily job) regenerate `upcoming_events.json`, `MANIFEST.json`, and `sitemap-event.xml`, dropping events whose `starts_at` is in the past (#1, #3).
2. Include `sitemap-blog.xml` in the `daily_blog` publish scope (#2).
3. Report real diff counts (added / modified / removed) in the commit subject (#4).
4. Skip unchanged city-guide pages (#5).

## Daily re-audit checklist
- Manifest sha256/rows match files; `generated_at` < 24 h old.
- Events with `starts_at` < today = 0.
- Every sitemap URL resolves; every new blog/city/event page is in its sitemap.
- Commit-subject counts match `git show --stat`.
