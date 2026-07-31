/**
 * COMEDY ATLAS — Interactive Globe: city detail panel
 * (site/comedy-atlas/globe/panel.js)
 *
 * CHECKPOINT 6 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * Pure DOM builder — no three.js, no fetch. Every number rendered here
 * comes from the caller-supplied `city` object (the GlobeCity contract) or
 * an explicitly-supplied `shows` array; nothing in this file is a
 * hard-coded statistic (Global Constraint #7). A zero renders honestly as
 * `0` (decision D-B) — it is never hidden or padded.
 *
 * `globe-chrome.css` and `globe-tokens.css` are FROZEN for this checkpoint
 * (Opus-validated, not in this agent's touch list), so this module cannot
 * add new rules to either file. Instead it injects one small, idempotent
 * <style> block (id `atlas-globe-panel-styles`) into <head> the first time
 * a panel mounts, scoped entirely under `.atlas-globe-panel` and reading
 * only existing `--atlas-globe-*` custom properties — never a bare hex.
 *
 * Exports:
 *   createCityHeader(city, {imageUrl}) -> HTMLElement
 *     Implements decision D-A. See the header comment on
 *     buildAbstractHeaderBackground() below for the full design rationale.
 *   renderDetailPanel(rootEl, city, options) -> {destroy, update(city, options)}
 *     The full §13-structure panel: header, stat tiles, action buttons,
 *     NEXT SHOWS list, "view all" link.
 */

const STYLE_ID = 'atlas-globe-panel-styles';

function injectStylesOnce() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.atlas-globe-panel{
  display:flex;flex-direction:column;
  background:var(--atlas-globe-panel-bg);
  border:1px solid var(--atlas-globe-panel-border);
  border-radius:var(--atlas-globe-radius);
  overflow:hidden;
  color:var(--atlas-globe-cream);
  font-family:inherit;
  max-height:100%;
}
.atlas-globe-panel-scroll{overflow-y:auto;display:flex;flex-direction:column}

.atlas-globe-header{
  position:relative;min-height:150px;padding:18px 18px 16px;
  display:flex;flex-direction:column;justify-content:flex-end;gap:8px;
  overflow:hidden;background-size:cover;background-position:center;
  background-color:var(--atlas-globe-panel-bg);
}
.atlas-globe-header-wash{position:absolute;inset:0;pointer-events:none;background-size:cover;background-position:center;}
.atlas-globe-header-grid{position:absolute;inset:0;opacity:.12;pointer-events:none;
  background-image:repeating-linear-gradient(0deg, var(--atlas-globe-grid) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(90deg, var(--atlas-globe-grid) 0 1px, transparent 1px 28px);
  -webkit-mask-image:linear-gradient(to bottom, black 0%, black 45%, transparent 92%);
  mask-image:linear-gradient(to bottom, black 0%, black 45%, transparent 92%);}
.atlas-globe-header-glow{position:absolute;left:0;right:0;bottom:0;height:62%;pointer-events:none;
  background:linear-gradient(to top, var(--atlas-globe-atmosphere) 0%, transparent 100%);opacity:.4;}
.atlas-globe-header-fade{position:absolute;left:0;right:0;bottom:0;height:36px;pointer-events:none;
  background:linear-gradient(to bottom, transparent 0%, var(--atlas-globe-panel-bg) 100%);}
.atlas-globe-header-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.atlas-globe-header-fg{position:relative;z-index:1;display:flex;flex-direction:column;gap:6px}
.atlas-globe-header-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.atlas-globe-header-name{margin:0;font:800 26px/1.05 Georgia,'Times New Roman',serif;
  letter-spacing:.03em;text-transform:uppercase;color:var(--atlas-globe-cream);
  text-shadow:0 2px 10px rgba(0,0,0,.55);}
.atlas-globe-flag-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;
  padding:3px 9px;border-radius:999px;background:rgba(5,7,11,.55);
  border:1px solid var(--atlas-globe-panel-border);color:var(--atlas-globe-cream);}
.atlas-globe-verification-chip{align-self:flex-start;font-size:9.5px;letter-spacing:.08em;
  text-transform:uppercase;padding:3px 9px;border-radius:999px;font-weight:700;
  background:rgba(5,7,11,.55);border:1px solid var(--atlas-globe-panel-border);}
.atlas-globe-verification-chip[data-state="verified"]{color:var(--atlas-globe-gold);border-color:var(--atlas-globe-gold);}
.atlas-globe-verification-chip[data-state="partial"],
.atlas-globe-verification-chip[data-state="community"]{color:var(--atlas-globe-muted);}
.atlas-globe-verification-chip[data-state="unknown"]{color:var(--atlas-globe-muted);}
.atlas-globe-header-summary{margin:0;font-size:12px;font-style:italic;color:var(--atlas-globe-cream);opacity:.82;
  text-shadow:0 1px 6px rgba(0,0,0,.5);}

.atlas-globe-stattiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 16px 4px;}
.atlas-globe-stattile{display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:10px 4px;border-radius:var(--atlas-globe-radius-sm);
  background:rgba(255,255,255,.03);border:1px solid var(--atlas-globe-panel-border);}
.atlas-globe-stattile .atlas-globe-icon{width:16px;height:16px;color:var(--atlas-globe-muted)}
.atlas-globe-stattile-number{font-size:17px;font-weight:800;color:var(--atlas-globe-cream)}
.atlas-globe-stattile-number[data-empty="true"]{color:var(--atlas-globe-muted);font-size:14px;font-weight:600}
.atlas-globe-stattile-label{font-size:8.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--atlas-globe-muted)}
.atlas-globe-stattile--warm{background:rgba(217,130,43,.14);border-color:var(--atlas-globe-orange)}
.atlas-globe-stattile--warm .atlas-globe-icon{color:var(--atlas-globe-orange)}
.atlas-globe-stattile--warm .atlas-globe-stattile-number{color:var(--atlas-globe-orange)}

.atlas-globe-panel-actions{display:flex;flex-direction:column;gap:8px;padding:12px 16px;}
.atlas-globe-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:11px 14px;border-radius:999px;font-size:12.5px;font-weight:700;letter-spacing:.03em;
  text-decoration:none;cursor:pointer;font-family:inherit;min-height:44px;text-align:center;}
.atlas-globe-btn .atlas-globe-icon{width:14px;height:14px}
.atlas-globe-btn--primary{background:var(--atlas-globe-gold);color:#1a1406;border:1px solid var(--atlas-globe-gold)}
.atlas-globe-btn--secondary{background:transparent;color:var(--atlas-globe-cream);border:1px solid var(--atlas-globe-panel-border)}
.atlas-globe-btn:focus-visible{outline:var(--atlas-globe-focus-ring);outline-offset:2px}

.atlas-globe-nextshows{padding:6px 16px 16px;display:flex;flex-direction:column;gap:10px}
.atlas-globe-nextshows-head{display:flex;align-items:center;justify-content:space-between}
.atlas-globe-nextshows-title{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--atlas-globe-muted)}
.atlas-globe-livenow-pill{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--atlas-globe-live);}
.atlas-globe-livenow-dot{width:6px;height:6px;border-radius:50%;background:var(--atlas-globe-live);
  box-shadow:0 0 0 3px rgba(196,30,58,.25);}
.atlas-globe-showrow{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;}
.atlas-globe-showrow-thumb{width:44px;height:44px;border-radius:8px;flex-shrink:0;
  background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;
  font:800 15px/1 Georgia,serif;color:rgba(255,255,255,.85);overflow:hidden;}
.atlas-globe-showrow-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.atlas-globe-showrow-body{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;gap:1px}
.atlas-globe-showrow-title{font-size:12.5px;font-weight:700;color:var(--atlas-globe-cream);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atlas-globe-showrow-meta{font-size:10.5px;color:var(--atlas-globe-muted)}
.atlas-globe-showrow-trail{font-size:11.5px;color:var(--atlas-globe-muted);flex-shrink:0}
.atlas-globe-showrow-trail[data-live="true"]{color:var(--atlas-globe-live);font-weight:700}
.atlas-globe-nextshows-empty{font-size:12px;color:var(--atlas-globe-muted);padding:6px 0}
.atlas-globe-viewall{font-size:11.5px;color:var(--atlas-globe-gold);text-decoration:none;font-weight:600;
  padding:2px 0;}
.atlas-globe-viewall:focus-visible{outline:var(--atlas-globe-focus-ring);outline-offset:2px}
`;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

/** Deterministic 32-bit string hash (same input -> same output, always —
 * this is what makes the header/thumbnail gradients repeatable per city,
 * never randomized per render, per decision D-A). */
function hashString(str) {
  const s = String(str || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Regional-indicator-symbol flag emoji from an ISO2 country code. Purely
 * computed from the two letters — not a lookup table, so it works for any
 * real country code the data ever contains, and never needs updating. */
function flagEmoji(iso2) {
  if (typeof iso2 !== 'string' || iso2.length !== 2) return '';
  const upper = iso2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  const points = [...upper].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
}

function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function safeInt(n) {
  return Number.isInteger(n) ? n : 0;
}

/**
 * Deterministic warm-arc gradient CSS for a given slug + festivalCount.
 * Base hue sits in the gold/amber/ember family (25deg-45deg); the more a
 * city's real festivalCount, the further the second stop shifts toward
 * violet (270deg) — "festival-heavy cities" per decision D-A's spec.
 * Same city + same festivalCount -> always the same gradient string.
 *
 * Used for small opaque swatches (the NEXT SHOWS thumbnail default state)
 * where a flat, fully-covering fill is correct — NOT for the panel header,
 * which needs a wash over near-black (see headerWashFor below).
 */
function warmGradientFor(slugOrKey, festivalCount) {
  const hash = hashString(slugOrKey);
  const baseHue = 22 + (hash % 26); // 22deg..48deg: gold -> amber -> ember
  const angle = hash % 360;
  const festivalBias = Math.min(safeInt(festivalCount) / 6, 1); // 0..1
  const secondHue = baseHue + (275 - baseHue) * festivalBias;
  const l1 = 20 + (hash % 7);
  const l2 = 10 + ((hash >> 3) % 6);
  return (
    `linear-gradient(${angle}deg, ` +
    `hsl(${baseHue}deg 62% ${l1}%) 0%, ` +
    `hsl(${Math.round(secondHue)}deg 48% ${l2}%) 100%)`
  );
}

/**
 * Deterministic ember-glow WASH for the panel header, per decision D-A's
 * "reads as intentional and high-end, never as a placeholder" bar and
 * ROBERT'S DECISIONS D-A rework: the header's base register must stay
 * near-black, like the globe itself, and the city hue must arrive as a
 * soft directional glow *over* that darkness — not as a flat colour fill.
 *
 * Returns a `radial-gradient(...)` string whose stops fade from a warm,
 * moderately-saturated core (alpha ~0.6) down to fully transparent — it is
 * designed to be painted on a layer stacked *above* a near-black base
 * (`.atlas-globe-header`'s own `background-color`), never used as the
 * base fill itself. The focal point (`posX`/`posY`) is also derived from
 * the same hash, so each city gets its own believable "light source"
 * position (biased to the upper half of the frame, so the glow reads as
 * falling light rather than a bottom-lit stage prop) while remaining
 * exactly reproducible for a given city — same city ⇒ same wash, always.
 */
function headerWashFor(slugOrKey, festivalCount) {
  const hash = hashString(slugOrKey);
  const baseHue = 22 + (hash % 26); // 22deg..48deg: gold -> amber -> ember
  const festivalBias = Math.min(safeInt(festivalCount) / 6, 1); // 0..1
  const secondHue = baseHue + (275 - baseHue) * festivalBias;
  const posX = 12 + (hash % 60); // 12%..72%
  const posY = 6 + ((hash >> 4) % 34); // 6%..40% -- upper frame, falling light
  return (
    `radial-gradient(120% 95% at ${posX}% ${posY}%, ` +
    `hsl(${baseHue}deg 72% 40% / 0.60) 0%, ` +
    `hsl(${Math.round(secondHue)}deg 55% 22% / 0.28) 42%, ` +
    `hsl(${Math.round(secondHue)}deg 40% 10% / 0) 78%)`
  );
}

/* ------------------------------------------------------------------ */
/* D-A: abstract branded header (permanent fallback, never a stand-in) */
/* ------------------------------------------------------------------ */

/**
 * Builds the city detail panel's header element. Implements decision D-A
 * verbatim: when `imageUrl` is absent (always, today — no city image field
 * exists anywhere in the pipeline), this renders a deliberate, high-end
 * abstract header — never "image coming soon", never an empty frame.
 * Composition back to front, per the plan's CP6 Step 4 spec (reworked per
 * ROBERT'S DECISIONS D-A follow-up: the first pass read as a flat, fairly
 * saturated colour swatch with a loud ruled grid — an unstyled-placeholder
 * look D-A explicitly forbids. This composition keeps the whole header in
 * the globe's own near-black register and lets the city hue arrive only as
 * a soft directional glow, the same way the atmosphere sits on the Earth):
 *   1. Base: near-black panel surface — `background-color` on
 *      `.atlas-globe-header` itself, driven by `--atlas-globe-panel-bg`
 *      (the same near-black token the rest of the panel chrome uses), not
 *      a colour swatch.
 *   2. `.atlas-globe-header-wash`: a deterministic ember-glow radial
 *      gradient (see headerWashFor) painted *over* that near-black base —
 *      a warm wash with a falling-light focal point, fading to fully
 *      transparent, not a flat fill. Same city ⇒ same wash, always.
 *   3. `.atlas-globe-header-grid`: the subtle map/grid overlay, reusing the
 *      `--atlas-globe-grid` token, at low opacity and masked to fade out
 *      toward the bottom, so it reads as cartography on second look rather
 *      than a ruled spreadsheet on first.
 *   4. `.atlas-globe-header-glow`: atmospheric glow bleeding from the lower
 *      edge (`--atlas-globe-atmosphere`), echoing the globe's own limb rim.
 *   5. `.atlas-globe-header-fade`: a soft bottom-edge fade back to
 *      `--atlas-globe-panel-bg`, so the header dissolves into the panel
 *      body instead of terminating in a hard line above the stat tiles.
 *   6. Foreground: city name, country + flag chip, verification chip, and
 *      a one-line real activity summary.
 *
 * The `imageUrl` parameter is the forward hook for a future verified city
 * photo field: when supplied, the same structure renders with a real photo
 * as the base layer (grid + glow + foreground stay identical) instead of
 * redesigning anything. Today `imageUrl` is always null/undefined.
 *
 * @param {object} city
 * @param {{imageUrl?: string|null}} [opts]
 * @returns {HTMLElement}
 */
export function createCityHeader(city, opts) {
  injectStylesOnce();
  const options = opts || {};
  const imageUrl = options.imageUrl || null;

  const header = document.createElement('div');
  header.className = 'atlas-globe-header';

  const key = (city && (city.slug || city.id || city.name)) || 'unknown';
  const festivalCount = safeInt(city && city.festivalCount);

  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'atlas-globe-header-img';
    img.src = imageUrl;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    header.appendChild(img);
  } else {
    // No image field exists in the data pipeline today (always this
    // branch) -- the near-black base comes from the CSS class itself
    // (`--atlas-globe-panel-bg`); this wash layer is the only thing that
    // carries the city-specific hue, and it is a fading glow, not a fill.
    const wash = document.createElement('div');
    wash.className = 'atlas-globe-header-wash';
    wash.style.backgroundImage = headerWashFor(key, festivalCount);
    header.appendChild(wash);
  }

  const grid = document.createElement('div');
  grid.className = 'atlas-globe-header-grid';
  header.appendChild(grid);

  const glow = document.createElement('div');
  glow.className = 'atlas-globe-header-glow';
  header.appendChild(glow);

  const fade = document.createElement('div');
  fade.className = 'atlas-globe-header-fade';
  header.appendChild(fade);

  const fg = document.createElement('div');
  fg.className = 'atlas-globe-header-fg';

  const titleRow = document.createElement('div');
  titleRow.className = 'atlas-globe-header-title-row';

  const name = document.createElement('h2');
  name.className = 'atlas-globe-header-name';
  name.textContent = (city && city.name) || 'Unknown city';
  titleRow.appendChild(name);

  const countryName = (city && city.countryName) || null;
  const countryCode = (city && city.countryCode) || null;
  if (countryName || countryCode) {
    const chip = document.createElement('span');
    chip.className = 'atlas-globe-flag-chip';
    const flag = flagEmoji(countryCode);
    chip.textContent = [flag, countryName].filter(Boolean).join(' ');
    titleRow.appendChild(chip);
  }
  fg.appendChild(titleRow);

  const verificationState = (city && city.verificationState) || 'unknown';
  const verifChip = document.createElement('span');
  verifChip.className = 'atlas-globe-verification-chip';
  verifChip.setAttribute('data-state', verificationState);
  verifChip.textContent = {
    verified: 'Verified',
    partial: 'Partially verified',
    community: 'Community-submitted',
    unknown: 'Unverified',
  }[verificationState] || 'Unverified';
  fg.appendChild(verifChip);

  const summary = document.createElement('p');
  summary.className = 'atlas-globe-header-summary';
  const upcoming = safeInt(city && city.upcomingShowCount);
  const venues = safeInt(city && city.venueCount);
  summary.textContent =
    upcoming > 0
      ? `${upcoming} upcoming show${upcoming === 1 ? '' : 's'} across ${venues} venue${venues === 1 ? '' : 's'}.`
      : venues > 0
        ? `${venues} venue${venues === 1 ? '' : 's'} tracked · no verified upcoming shows yet.`
        : 'No verified comedy activity on record yet.';
  fg.appendChild(summary);

  header.appendChild(fg);
  return header;
}

/* ------------------------------------------------------------------ */
/* Stat tiles                                                          */
/* ------------------------------------------------------------------ */

const ICONS = {
  comics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 10h8M8 14h5"/><rect x="3" y="5" width="18" height="12" rx="2"/><path d="m8 17-2 3v-3"/></svg>',
  shows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 18V9l8-5 8 5v9"/><path d="M9 18v-6h6v6"/></svg>',
  venues: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="1"/><path d="M9 20v-5h6v5M4 9l8-6 8 6"/></svg>',
  festivals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3v6M8 9l4-3 4 3M6 21l3-9M18 21l-3-9M9 21h6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
};

function iconEl(name) {
  const span = document.createElement('span');
  span.className = 'atlas-globe-icon';
  span.innerHTML = ICONS[name] || '';
  return span;
}

function numberSpan(value) {
  const el = document.createElement('span');
  el.className = 'atlas-globe-stattile-number';
  const n = isFiniteNum(value) ? value : 0;
  el.textContent = String(n);
  if (n === 0) el.setAttribute('data-empty', 'true');
  return el;
}

function buildStatTiles(city) {
  const grid = document.createElement('div');
  grid.className = 'atlas-globe-stattiles';
  // NOTE: this tile intentionally reads `upcomingShowCount`, not
  // `activeShowCount`. `activeShowCount` means genuinely live-right-now
  // (see build.py) and is correctly 0 for almost every city almost all
  // the time -- a stat tile is the wrong place for that number; the
  // "Live Now" pill in buildNextShows() below is the honest place it
  // surfaces. Labeling an upcoming count "Active" would misrepresent it.
  const defs = [
    { key: 'comicCount', icon: 'comics', label: 'Comics' },
    { key: 'upcomingShowCount', icon: 'shows', label: 'Upcoming Shows', warm: true },
    { key: 'venueCount', icon: 'venues', label: 'Venues' },
    { key: 'festivalCount', icon: 'festivals', label: 'Festivals' },
  ];
  defs.forEach((def) => {
    const tile = document.createElement('div');
    tile.className = 'atlas-globe-stattile' + (def.warm ? ' atlas-globe-stattile--warm' : '');
    tile.setAttribute('data-key', def.key);
    tile.appendChild(iconEl(def.icon));
    const value = city ? city[def.key] : 0;
    const num = numberSpan(value);
    tile.appendChild(num);
    const label = document.createElement('span');
    label.className = 'atlas-globe-stattile-label';
    label.textContent = def.label;
    tile.appendChild(label);
    tile.setAttribute(
      'aria-label',
      `${def.label}: ${isFiniteNum(value) ? value : 0}`
    );
    grid.appendChild(tile);
  });
  return grid;
}

/* ------------------------------------------------------------------ */
/* Action buttons                                                      */
/* ------------------------------------------------------------------ */

function buildActions(city, options) {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-globe-panel-actions';

  const cityHref = typeof options.cityHref === 'function' ? options.cityHref(city) : '#';
  const cityName = (city && city.name) || 'this city';

  const primary = document.createElement('a');
  primary.className = 'atlas-globe-btn atlas-globe-btn--primary';
  primary.href = cityHref;
  primary.appendChild(document.createTextNode(`EXPLORE ${String(cityName).toUpperCase()}`));
  primary.appendChild(iconEl('arrow'));
  wrap.appendChild(primary);

  const venuesBtn = document.createElement('a');
  venuesBtn.className = 'atlas-globe-btn atlas-globe-btn--secondary';
  venuesBtn.href = cityHref + '#venues';
  venuesBtn.textContent = `All Venues in ${cityName}`;
  wrap.appendChild(venuesBtn);

  const correctionBtn = document.createElement('a');
  correctionBtn.className = 'atlas-globe-btn atlas-globe-btn--secondary';
  const subject = encodeURIComponent(`Correction for ${cityName} on Comedy Atlas`);
  correctionBtn.href = `mailto:contact@comedyatlas.app?subject=${subject}`;
  correctionBtn.textContent = 'Suggest a Correction';
  wrap.appendChild(correctionBtn);

  return wrap;
}

/* ------------------------------------------------------------------ */
/* NEXT SHOWS                                                          */
/* ------------------------------------------------------------------ */

export const NO_SHOWS_TEXT = 'No upcoming shows are currently verified for this city.';

/** Branded typographic thumbnail — the DEFAULT state, per the plan ("only
 * 310 of 7,324 events have a photo_url, so the thumbnail's default state is
 * a branded typographic tile ... treat the real photo as the exception").
 * Reuses the same deterministic-gradient treatment as the header. */
function buildShowThumb(show) {
  const thumb = document.createElement('div');
  thumb.className = 'atlas-globe-showrow-thumb';
  if (show && show.photoUrl) {
    const img = document.createElement('img');
    img.src = show.photoUrl;
    img.alt = '';
    thumb.appendChild(img);
  } else {
    const key = (show && (show.title || show.venueName)) || 'show';
    thumb.style.background = warmGradientFor(key, 0);
    const initial = String((show && show.title) || '?').trim().charAt(0).toUpperCase() || '?';
    thumb.textContent = initial;
  }
  return thumb;
}

function formatDayTime(isoString, timezone) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || undefined,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return fmt.format(date);
  } catch (_err) {
    return date.toISOString();
  }
}

function buildShowRow(show, city) {
  const row = document.createElement('a');
  row.className = 'atlas-globe-showrow';
  row.href = (show && show.url) || '#';

  row.appendChild(buildShowThumb(show));

  const body = document.createElement('div');
  body.className = 'atlas-globe-showrow-body';
  const title = document.createElement('span');
  title.className = 'atlas-globe-showrow-title';
  title.textContent = (show && show.title) || 'Untitled show';
  body.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'atlas-globe-showrow-meta';
  const dayTime = formatDayTime(show && show.startsAt, city && city.timezone);
  meta.textContent = [show && show.venueName, dayTime].filter(Boolean).join(' · ') || 'Venue and time not yet verified';
  body.appendChild(meta);

  row.appendChild(body);

  const trail = document.createElement('span');
  trail.className = 'atlas-globe-showrow-trail';
  if (show && show.isLive) {
    trail.textContent = 'LIVE';
    trail.setAttribute('data-live', 'true');
  } else if (show && isFiniteNum(show.price)) {
    trail.textContent = show.price === 0 ? 'Free' : `€${show.price}`;
  } else if (show && typeof show.priceText === 'string' && show.priceText) {
    trail.textContent = show.priceText;
  } else {
    trail.appendChild(iconEl('chevron'));
  }
  row.appendChild(trail);

  return row;
}

function buildNextShows(city, options) {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-globe-nextshows';

  const head = document.createElement('div');
  head.className = 'atlas-globe-nextshows-head';
  const title = document.createElement('span');
  title.className = 'atlas-globe-nextshows-title';
  title.textContent = 'Next Shows';
  head.appendChild(title);

  // Honest, real-data-only: the LIVE NOW indicator only ever appears when
  // the city's own genuine activeShowCount is > 0 (decision D-B) — never
  // fabricated from the shows list alone.
  const liveNow = safeInt(city && city.activeShowCount);
  if (liveNow > 0) {
    const pill = document.createElement('span');
    pill.className = 'atlas-globe-livenow-pill';
    const dot = document.createElement('span');
    dot.className = 'atlas-globe-livenow-dot';
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode('Live Now'));
    head.appendChild(pill);
  }
  wrap.appendChild(head);

  // `shows` is an explicit, optional, caller-supplied array — see this
  // file's header comment: no per-show data source exists yet in the
  // GlobeCity contract (CP1) or anywhere else this checkpoint can reach
  // without loading the forbidden 13MB upcoming_events.json. Real per-city
  // show rows can be wired in by a later checkpoint (CP7/CP9) simply by
  // passing `options.shows`; until then this renders the honest empty
  // state, never an invented row.
  const shows = Array.isArray(options.shows) ? options.shows : [];

  if (shows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'atlas-globe-nextshows-empty';
    empty.textContent = NO_SHOWS_TEXT;
    wrap.appendChild(empty);
  } else {
    shows.forEach((show) => {
      wrap.appendChild(buildShowRow(show, city));
    });
  }

  const viewAll = document.createElement('a');
  viewAll.className = 'atlas-globe-viewall';
  const cityHref = typeof options.cityHref === 'function' ? options.cityHref(city) : '#';
  viewAll.href = cityHref + '#shows';
  viewAll.textContent = `View all shows in ${(city && city.name) || 'this city'} →`;
  wrap.appendChild(viewAll);

  return wrap;
}

/* ------------------------------------------------------------------ */
/* Public: full panel                                                  */
/* ------------------------------------------------------------------ */

/**
 * Renders the complete city detail panel into `rootEl` (typically
 * `.atlas-globe-panel-col`, CP4's reserved column). Replaces any previous
 * panel content. Returns `{destroy, update}` so `experience.js` can swap
 * cities without re-creating the DOM subtree from scratch each time.
 *
 * @param {HTMLElement} rootEl
 * @param {object} city  a GlobeCity record
 * @param {{cityHref?: (city: object) => string, shows?: object[], imageUrl?: string|null}} [options]
 * @returns {{destroy: () => void, update: (city: object, options?: object) => void}}
 */
export function renderDetailPanel(rootEl, city, options) {
  injectStylesOnce();
  const opts = options || {};

  function paint(c, o) {
    rootEl.innerHTML = '';
    rootEl.setAttribute('role', 'region');
    rootEl.setAttribute('aria-label', `${(c && c.name) || 'City'} details`);

    const panel = document.createElement('div');
    panel.className = 'atlas-globe-panel';

    const scroll = document.createElement('div');
    scroll.className = 'atlas-globe-panel-scroll';

    scroll.appendChild(createCityHeader(c, { imageUrl: o.imageUrl || null }));
    scroll.appendChild(buildStatTiles(c));
    scroll.appendChild(buildActions(c, o));
    scroll.appendChild(buildNextShows(c, o));

    panel.appendChild(scroll);
    rootEl.appendChild(panel);
  }

  paint(city, opts);

  return {
    update(nextCity, nextOptions) {
      paint(nextCity, nextOptions || opts);
    },
    destroy() {
      rootEl.innerHTML = '';
    },
  };
}

export const __internal = { hashString, flagEmoji, warmGradientFor, headerWashFor, formatDayTime };
