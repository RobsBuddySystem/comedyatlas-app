# Partner link audit — live sites, 2026-11-04

Method: live data (`comedyatlas.app/data/comedy-atlas/upcoming_events.json`, 19,655 upcoming events, all with a ticket URL) + live `partner-config.json` + real pages fetched from comedyatlas.app + real `go.html` clicks in headless Chromium (destination captured, not followed). pariscomedy.com listings from `api.pariscomedy.com/api/listings`.

On-page routing: every Atlas ticket button goes through `/comedy-atlas/go.html?e=<id>&dest=<host>`, which adds partner params / Awin wrap at click time.
- 75 sampled event pages (25 Skiddle, 25 BilletReduc, 25 Ticketmaster): 75/75 HTTP 200, 75/75 ticket button = go.html for that event, **0 pages with a raw partner link**.
- 14 listing pages (home, shows, 6 city pages, calendar day, 2 city guides, partners, festival): **0 raw partner links**.

| Partner | Links found (events) | Tagged correctly | Untagged | Broken (live clicks) | Example (real click destination) |
|---|---|---|---|---|---|
| **Skiddle** (`sktag=15788`) | 2,306 | **2,306** (stored URL already carries it; go.html re-adds if missing) | 0 | **0 / 10** | `https://www.skiddle.com/whats-on/London/JK-Comedy-Club-Covent-Garden/Saturday-Night-Comedy-8PM-Covent-Garden/43141214/?sktag=15788` |
| **BilletReduc via Awin** (mid 20796, publisher 3039909) | 2,572 | **2,572** wrapped at click time | 0 on Atlas | **0 / 10** reached the Awin URL; final Awin→BilletReduc hop **not verifiable from the cloud** (awin1.com blocked by the sandbox network policy) | `https://www.awin1.com/cread.php?awinmid=20796&awinaffid=3039909&ued=https%3A%2F%2Fwww.billetreduc.com%2Fspectacle%2Fle-onzieme-degre-comedy-club-impro-393922` |
| **Theatre Tickets Direct** (Awin 3039909) | **0** | 0 | — | — | none exists: no event links to TTD, no `partner-config.json` entry, no code anywhere (only a plan note: "approved by the network, no feed/import integration built") |
| **Ticketmaster** (plain, no affiliate id — left unchanged) | **7,617** | n/a — 0 carry our affiliate id (none configured) | 7,617 plain | **0 / 10** | `https://www.ticketmaster.ch/event/bellarena-indoor-festival-%7C-jarry--friends-tickets/2035092666?language=en-us` |

Ticketmaster by host: ticketmaster.com 4,001 · .co.uk 2,096 · .ca 328 · .ie 255 · .be 250 · .com.au 135 · .de 107 · .com.mx 90 · .nl 54 · theatre.ticketmaster.co.uk 46 · .ch 43 · travel.ticketmaster.com 42 · others 170. The 42 travel.ticketmaster.com links carry the *source's* `utm_*` params (not ours).

## pariscomedy.com (separate site, own listings)
9 listings, all linked **raw** (no go.html): 7 Eventbrite (no partner program) and **2 BilletReduc linked directly, bypassing the Awin wrap → no commission**:
- `choumi-in-english` → `https://www.billetreduc.com/spectacle/choumi-in-english-400870`
- `theatre-bo-julie` → `https://www.billetreduc.com/spectacle/julie-collas-dans-oh-my-god-she-s-parisian-392192`

Fix: see pariscomedy.com PR (partner wrap in `js/pc-listings.js`, same rules as Atlas `go.html`), and the Atlas-feed migration (#16 / pariscomedy.com #2) routes every click through Atlas go.html.

## To verify on the Mac (cloud cannot reach awin1.com)
`curl -sSIL 'https://www.awin1.com/cread.php?awinmid=20796&awinaffid=3039909&ued=https%3A%2F%2Fwww.billetreduc.com%2Fspectacle%2Fle-onzieme-degre-comedy-club-impro-393922' | grep -i '^location'` — the last Location should be billetreduc.com with an `awc=` parameter.
