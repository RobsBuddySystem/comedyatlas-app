/**
 * COMEDY ATLAS — Interactive Globe: layer registry + Shows Now
 * (site/comedy-atlas/globe/layers.js)
 *
 * CHECKPOINT 7 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * This module is the DATA side of the layer system: which cities belong to
 * a given layer, which layers are honestly disabled (and why), and the
 * real, un-padded "Shows Now" computation (decision D-B). It deliberately
 * does NOT re-implement the layer SELECTOR UI — `legend.js`'s
 * `createLayerSelector` (CP4) is already the one controller that drives
 * both the left rail and the bottom-right bar from a single state object,
 * and `legend.js`'s `DEFAULT_LAYERS` is already the one list of layer
 * ids/labels/icons. Re-implementing either here would create a second
 * source of truth the plan explicitly forbids ("wire your registry to
 * that existing controller, do not create a second source of truth").
 * `buildLayerRegistry` below only ANNOTATES a copy of that same list with
 * `disabled`/`disabledReason`, computed from the real payload, and hands
 * it straight to `createLayerSelector`.
 *
 * Exports:
 *   DEFAULT_SHOW_DURATION_MINUTES
 *     The one place the assumed show length lives (see the comment at its
 *     declaration). Nothing else in the globe defines a second duration
 *     constant.
 *   isCityLiveNow(city, nowMs, durationMinutes) -> boolean
 *   computeLiveShowsNow(cities, {now}) -> {count, cityIds}
 *   computeLayerAvailability(cities, opts) -> Map<layerId, {disabled, reason}>
 *   buildLayerRegistry(baseLayers, cities, opts) -> annotated layer array
 *   filterCitiesForLayer(cities, layerId, {now}) -> city[]
 *   renderShowsNowCounter(rootEl, cities, opts) -> {update(cities), destroy}
 */

/**
 * DEFAULT_SHOW_DURATION_MINUTES — THE single, clearly-commented home for
 * the assumed default length of a stand-up show.
 *
 * The GlobeCity contract (see the plan's "GlobeCity contract" section)
 * carries a city's `nextShowAt` — the earliest upcoming event's real
 * start time in its own local timezone — but no per-event END time (no
 * source table in `comedy_network` records a show's actual duration).
 * To answer "is a show live RIGHT NOW, this instant" honestly, without
 * ever inventing a real end time, the globe treats a show as occupying a
 * single fixed window of this length starting at its real `starts_at`.
 * This is a documented ASSUMPTION (a typical one-set stand-up show or a
 * lineup show's realistic total runtime), never presented as a measured
 * fact — it is used only to decide whether "now" falls inside that
 * window, not to display an invented end time anywhere in the UI.
 *
 * Changing the assumed show length means changing this ONE constant.
 * Nothing else in this file, or any other globe module, may define a
 * second "how long is a show" number.
 */
export const DEFAULT_SHOW_DURATION_MINUTES = 90;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Decision D-B, enforced at the one place that actually renders "live":
 * a city contributes to the live-now count ONLY when it has a real,
 * non-empty `timezone` AND a real, parseable `nextShowAt` timestamp. No
 * timezone or no parseable start time -> this city is never counted live,
 * never guessed at. `nextShowAt` already carries its own UTC offset (see
 * `seo_common.local_iso`, the exact function that produces it), so
 * `Date.parse` gives an unambiguous real instant without this module
 * re-deriving timezone math.
 *
 * @param {{timezone?: unknown, nextShowAt?: unknown}} city
 * @param {number} nowMs
 * @param {number} [durationMinutes]
 * @returns {boolean}
 */
export function isCityLiveNow(city, nowMs, durationMinutes) {
  if (!city) return false;
  // No real timezone -> never guess. (D-B, verbatim.)
  if (!isNonEmptyString(city.timezone)) return false;
  if (!isNonEmptyString(city.nextShowAt)) return false;

  const startMs = Date.parse(city.nextShowAt);
  if (!Number.isFinite(startMs)) return false;

  const duration = Number.isFinite(durationMinutes) ? durationMinutes : DEFAULT_SHOW_DURATION_MINUTES;
  const endMs = startMs + duration * 60000;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return now >= startMs && now <= endMs;
}

/**
 * Real, un-padded live-show count across a GlobeCity[] payload, evaluated
 * against `now` (defaults to the real wall clock). Genuinely returns 0
 * when nothing is live — this function never substitutes a busier metric
 * and is the single source the bottom-left counter and the "Shows Now"
 * layer filter both read from.
 *
 * @param {object[]} cities
 * @param {{now?: number, durationMinutes?: number}} [opts]
 * @returns {{count: number, cityIds: string[]}}
 */
export function computeLiveShowsNow(cities, opts) {
  const options = opts || {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const duration = Number.isFinite(options.durationMinutes)
    ? options.durationMinutes
    : DEFAULT_SHOW_DURATION_MINUTES;
  const list = Array.isArray(cities) ? cities : [];
  const liveCities = list.filter((c) => isCityLiveNow(c, now, duration));
  return { count: liveCities.length, cityIds: liveCities.map((c) => c.id) };
}

/* ------------------------------------------------------------------ */
/* Layer availability — honest disabled state, real reasons.          */
/* ------------------------------------------------------------------ */

/**
 * Which layers currently have enough REAL data to be meaningfully turned
 * on, and the honest reason to show when they don't.
 *
 * CORRECTED 2026-08-01 (adversarial review Finding 2): this function used
 * to hard-code 'shows' and 'festivals' as `{disabled: false}` regardless
 * of the actual payload. In production `festival_venues` is EMPTY (0
 * rows; `festivals` itself has 146 rows but none are linked to a city —
 * see build.py's module docstring), so `festivalCount` is 0 for all 44
 * published cities, and toggling "Festivals" wiped every marker off the
 * globe with no explanation whatsoever — exactly the "never
 * empty-but-enabled" failure CP7 Step 4 was written to prevent. The same
 * measured problem applied to "Shows Now" (0 live shows is the common
 * case by design, per D-B).
 *
 * Every data layer below is now computed from the REAL payload, exactly
 * like "Comics" already correctly was — there is no more hard-coded
 * `disabled: false`. "World" is the only layer that is unconditionally
 * available (it is just every published city). A layer with zero
 * qualifying cities right now is honestly disabled with a real reason;
 * it re-enables itself automatically the moment the underlying data
 * changes (a new festival gets linked to a venue, a show starts within
 * the live window, a venue or comic gets attached to a city) because
 * this function is re-run against the live payload, not a cached
 * decision. "Connections" and "History" have NO source table in
 * `comedy_network` at all (the plan's own "Known gap, stated honestly")
 * — they are always disabled, with a reason that says exactly that,
 * never fabricated content standing in for real data.
 *
 * @param {object[]} cities
 * @param {{now?: number, durationMinutes?: number}} [opts]
 * @returns {Map<string, {disabled: boolean, reason: string|null}>}
 */
export function computeLayerAvailability(cities, opts) {
  const list = Array.isArray(cities) ? cities : [];
  const anyLiveNow = computeLiveShowsNow(list, opts).count > 0;
  const anyVenues = list.some((c) => Number(c && c.venueCount) > 0);
  const anyFestivals = list.some((c) => Number(c && c.festivalCount) > 0);
  const anyComics = list.some((c) => Number(c && c.comicCount) > 0);

  const availability = new Map();
  availability.set('world', { disabled: false, reason: null });
  availability.set('shows', anyLiveNow
    ? { disabled: false, reason: null }
    : { disabled: true, reason: 'No shows are live in the current data snapshot.' });
  availability.set('venues', anyVenues
    ? { disabled: false, reason: null }
    : { disabled: true, reason: 'No venue data is published for any city yet.' });
  availability.set('festivals', anyFestivals
    ? { disabled: false, reason: null }
    : { disabled: true, reason: 'No festival is currently linked to a city.' });
  availability.set('comics', anyComics
    ? { disabled: false, reason: null }
    : { disabled: true, reason: 'No comic-to-city data is published yet.' });
  availability.set('connections', {
    disabled: true,
    reason: 'Not enough verified data yet — no comic/venue relationship table exists.',
  });
  availability.set('history', {
    disabled: true,
    reason: 'Not enough verified data yet — no historical archive is published.',
  });
  return availability;
}

/**
 * Returns a NEW array — a copy of `baseLayers` (intended to be legend.js's
 * own `DEFAULT_LAYERS`, imported by the caller, never redefined here) with
 * `disabled`/`disabledReason` set from `computeLayerAvailability`. Handed
 * straight to `createLayerSelector`, which already knows how to render a
 * disabled item (see legend.js's `buildRailItem`: `title`/`aria-label`
 * carry the reason, the `<input>` itself is `disabled`).
 *
 * @param {{id: string, label: string, icon: string}[]} baseLayers
 * @param {object[]} cities
 * @param {{now?: number, durationMinutes?: number}} [opts]
 * @returns {{id: string, label: string, icon: string, disabled?: boolean, disabledReason?: string}[]}
 */
export function buildLayerRegistry(baseLayers, cities, opts) {
  const availability = computeLayerAvailability(cities, opts);
  const list = Array.isArray(baseLayers) ? baseLayers : [];
  return list.map((layer) => {
    const info = availability.get(layer.id) || { disabled: false, reason: null };
    const next = { ...layer };
    if (info.disabled) {
      next.disabled = true;
      next.disabledReason = info.reason;
    }
    return next;
  });
}

/* ------------------------------------------------------------------ */
/* Per-layer city filtering — what the marker layer should render.     */
/* ------------------------------------------------------------------ */

/**
 * Which cities belong on the globe for a given active layer. "World" is
 * every renderable city (the existing CP6 behaviour, unchanged). Data
 * layers filter to cities that genuinely have that kind of real data —
 * never an invented subset. Disabled layers (per `computeLayerAvailability`)
 * always resolve to an empty list, since the caller should not be able to
 * reach them via `setLayer` in the first place (the selector already
 * refuses to activate a disabled item), but this is a second, structural
 * guarantee against ever rendering fabricated content for them.
 *
 * @param {object[]} cities
 * @param {string} layerId
 * @param {{now?: number, durationMinutes?: number}} [opts]
 * @returns {object[]}
 */
export function filterCitiesForLayer(cities, layerId, opts) {
  const list = Array.isArray(cities) ? cities : [];
  switch (layerId) {
    case 'world':
      return list;
    case 'shows': {
      const { cityIds } = computeLiveShowsNow(list, opts);
      const liveSet = new Set(cityIds);
      return list.filter((c) => liveSet.has(c.id));
    }
    case 'venues':
      return list.filter((c) => Number(c && c.venueCount) > 0);
    case 'festivals':
      return list.filter((c) => Number(c && c.festivalCount) > 0);
    case 'comics':
      return list.filter((c) => Number(c && c.comicCount) > 0);
    case 'connections':
    case 'history':
      return [];
    default:
      return list;
  }
}

/* ------------------------------------------------------------------ */
/* Live-shows-now counter — decision D-B, literal zero, never hidden.  */
/*                                                                      */
/* legend.js's own renderLiveCounter (CP4/CP6) renders an explanatory   */
/* string ("No shows starting right now") instead of a literal digit    */
/* when the count is zero. That is honest and never hidden, but CP7's   */
/* own binding instruction is explicit and stronger: "Write a test       */
/* asserting the counter renders 0 (visible, not hidden) when no show   */
/* is live." legend.js is frozen for this checkpoint (Opus-validated,   */
/* not in this agent's touch list), so rather than edit that file, this */
/* module supplies its OWN counter renderer for the SAME bottom-left     */
/* slot, built on the real, un-padded `computeLiveShowsNow` above.       */
/* experience.js (CP7's one permitted minimal wiring change) mounts this */
/* one instead of legend.js's for `[data-role="livecount"]` — this is    */
/* not a second layer-SELECTOR controller (that rule is about           */
/* createLayerSelector/DEFAULT_LAYERS, reused verbatim above), just a    */
/* corrected zero-state for one small stat widget.                      */
/* ------------------------------------------------------------------ */

/**
 * @param {HTMLElement} rootEl
 * @param {object[]} cities
 * @param {{now?: number, durationMinutes?: number}} [opts]
 * @returns {{update: (cities: object[]) => void, destroy: () => void}}
 */
export function renderShowsNowCounter(rootEl, cities, opts) {
  function paint(list) {
    rootEl.innerHTML = '';
    const { count } = computeLiveShowsNow(list, opts);

    const wrap = document.createElement('div');
    wrap.className = 'atlas-globe-livecount-label';
    const dot = document.createElement('span');
    dot.className = 'atlas-globe-livecount-dot';
    wrap.appendChild(dot);
    const text = document.createElement('span');
    text.className = 'atlas-globe-livecount-text';
    text.textContent = 'Live shows / Right now';
    wrap.appendChild(text);
    rootEl.appendChild(wrap);

    // D-B, verbatim: 0, 1 or 2 are all rendered as the real literal
    // number, visible, never hidden, never padded, never substituted.
    const number = document.createElement('div');
    number.className = 'atlas-globe-livecount-number';
    number.textContent = String(count);
    number.setAttribute('data-testid', 'atlas-globe-shows-now-count');
    if (count === 0) number.setAttribute('data-zero', 'true');
    rootEl.appendChild(number);

    rootEl.setAttribute('role', 'status');
    rootEl.setAttribute(
      'aria-label',
      count === 1 ? '1 live show right now' : count + ' live shows right now',
    );
  }

  paint(cities);
  return {
    update: paint,
    destroy() {
      rootEl.innerHTML = '';
    },
  };
}

export const __internal = { isNonEmptyString };
