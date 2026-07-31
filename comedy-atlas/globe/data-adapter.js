/**
 * data-adapter.js — CHECKPOINT 3 (pure-JS logic modules)
 *
 * Fetch + validate + shape the GlobeCity[] contract defined in
 * docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md ("The GlobeCity
 * contract"). This module is PURE: no DOM, no `window`/`document`, no WebGL
 * render-layer import, and no fetch of a hard-coded URL — the caller injects `fetchImpl`
 * (e.g. the real `fetch`, or a test double) and the `url` to request.
 *
 * `parseGlobePayload` must NEVER throw. Malformed input (null, wrong shape,
 * a single bad city row, garbage of any kind) always degrades to an empty or
 * partially-populated result — it never crashes the caller. This is the
 * "one malformed record cannot crash the parse" gate from the Opus review.
 *
 * IMPORTANT: this module does not recompute the activity score. It trusts
 * `activityScore` as delivered by the Python builder (scripts/globe_data/).
 */

/** Required, must be finite numbers for a city row to be kept. */
const REQUIRED_NUMERIC_FIELDS = ['latitude', 'longitude'];

/** Required, must be non-empty strings for a city row to be kept. */
const REQUIRED_STRING_FIELDS = ['id', 'name'];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate + normalize a single raw city record from the GlobeCity contract.
 * Returns `null` (never throws) if the record cannot be trusted for
 * rendering — e.g. missing id/name, non-finite or out-of-range coordinates.
 *
 * @param {unknown} rawCity
 * @returns {object|null}
 */
function parseCity(rawCity) {
  if (rawCity === null || typeof rawCity !== 'object' || Array.isArray(rawCity)) {
    return null;
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(rawCity[field])) {
      return null;
    }
  }

  for (const field of REQUIRED_NUMERIC_FIELDS) {
    if (!isFiniteNumber(rawCity[field])) {
      return null;
    }
  }

  const { latitude, longitude } = rawCity;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  const activityScore = isFiniteNumber(rawCity.activityScore)
    ? Math.min(Math.max(rawCity.activityScore, 0), 1)
    : 0;

  return {
    id: rawCity.id,
    slug: isNonEmptyString(rawCity.slug) ? rawCity.slug : null,
    name: rawCity.name,
    normalizedName: isNonEmptyString(rawCity.normalizedName) ? rawCity.normalizedName : null,
    countryName: isNonEmptyString(rawCity.countryName) ? rawCity.countryName : null,
    countryCode: isNonEmptyString(rawCity.countryCode) ? rawCity.countryCode : null,
    region: isNonEmptyString(rawCity.region) ? rawCity.region : null,
    latitude,
    longitude,
    timezone: isNonEmptyString(rawCity.timezone) ? rawCity.timezone : null,
    activeShowCount: Number.isInteger(rawCity.activeShowCount) ? rawCity.activeShowCount : 0,
    upcomingShowCount: Number.isInteger(rawCity.upcomingShowCount) ? rawCity.upcomingShowCount : 0,
    venueCount: Number.isInteger(rawCity.venueCount) ? rawCity.venueCount : 0,
    festivalCount: Number.isInteger(rawCity.festivalCount) ? rawCity.festivalCount : 0,
    comicCount: Number.isInteger(rawCity.comicCount) ? rawCity.comicCount : 0,
    activityScore,
    nextShowAt: isNonEmptyString(rawCity.nextShowAt) ? rawCity.nextShowAt : null,
    verificationState: isNonEmptyString(rawCity.verificationState) ? rawCity.verificationState : 'unknown',
    sourceUpdatedAt: isNonEmptyString(rawCity.sourceUpdatedAt) ? rawCity.sourceUpdatedAt : null,
  };
}

/**
 * Parse the raw GlobeCity JSON payload (already `JSON.parse`d) into the shape
 * the rest of the globe modules consume. Never throws — garbage input of any
 * shape degrades to `{cities: [], excluded: [], totals: {...}, generatedAt: null}`.
 *
 * @param {unknown} raw
 * @returns {{cities: object[], excluded: object[], totals: {included: number, excluded: number}, generatedAt: string|null}}
 */
export function parseGlobePayload(raw) {
  const empty = {
    cities: [],
    excluded: [],
    totals: { included: 0, excluded: 0 },
    generatedAt: null,
  };

  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return empty;
  }

  const rawCities = Array.isArray(raw.cities) ? raw.cities : [];
  const cities = [];
  for (const rawCity of rawCities) {
    const parsed = parseCity(rawCity);
    if (parsed !== null) {
      cities.push(parsed);
    }
  }

  const excluded = Array.isArray(raw.excluded)
    ? raw.excluded.filter((entry) => entry !== null && typeof entry === 'object')
    : [];

  const generatedAt = isNonEmptyString(raw.generated_at)
    ? raw.generated_at
    : isNonEmptyString(raw.generatedAt)
      ? raw.generatedAt
      : null;

  const totalsSource = raw.totals !== null && typeof raw.totals === 'object' ? raw.totals : {};
  const totals = {
    included: Number.isInteger(totalsSource.included) ? totalsSource.included : cities.length,
    excluded: Number.isInteger(totalsSource.excluded) ? totalsSource.excluded : excluded.length,
  };

  return { cities, excluded, totals, generatedAt };
}

/**
 * Load and parse the globe cities payload. Never throws: network failure,
 * a non-ok response, or malformed JSON all resolve to the same empty shape
 * `parseGlobePayload` returns for garbage input.
 *
 * `fetchImpl` is REQUIRED to be injected by the caller — this module never
 * references a hard-coded URL or the global `fetch`/`window`.
 *
 * @param {{url: string, fetchImpl: (url: string) => Promise<{ok: boolean, json: () => Promise<unknown>}>}} options
 * @returns {Promise<ReturnType<typeof parseGlobePayload>>}
 */
export async function loadGlobeCities({ url, fetchImpl }) {
  // Deliberately never throws -- callers rely on always receiving a payload
  // of the documented shape. But "we could not load it" and "it loaded and is
  // empty" are DIFFERENT facts, and this function used to erase that
  // distinction by returning the same empty payload for both (Fable globe
  // review #5, deepened 2026-07-31). The caller then had no way to tell a 404
  // from a genuinely empty world, and told the reader it was an empty world.
  //
  // Same rule as this repo's /health lesson: bad news goes in a FIELD you can
  // read, never into a silently-plausible zero. `loadError` is that field --
  // null on success, a short machine-readable reason otherwise.
  try {
    const response = await fetchImpl(url);
    if (!response || !response.ok) {
      const status = response && response.status;
      return { ...parseGlobePayload(null), loadError: status ? `HTTP ${status}` : 'no response' };
    }
    const raw = await response.json();
    return { ...parseGlobePayload(raw), loadError: null };
  } catch (err) {
    return { ...parseGlobePayload(null), loadError: (err && err.message) || 'fetch failed' };
  }
}
