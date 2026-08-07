/**
 * map-experience.js — the MapLibre renderer that replaces the three.js globe
 * (2026-08-01, SPEC_atlas_maplibre_replacement_2026-08-01.md).
 *
 * WHY A REPLACEMENT, NOT A PATCH: the three.js globe painted a single
 * 2048x1024 equirectangular texture onto a sphere — ~19.5km per texel at the
 * equator. Zooming to a city magnified a handful of texels across the whole
 * viewport, so it could never be sharp. That is a property of a fixed-size
 * image, not a bug to fix; only a tile pyramid solves it. MapLibre + vector
 * tiles are resolution-independent: they re-render crisply at every zoom.
 *
 * PROVIDER: OpenFreeMap (https://tiles.openfreemap.org/styles/liberty) —
 * free, no API key, no billing. NASA Blue Marble raster imagery was in the
 * original spec but Robert cut it 2026-08-01 06:46 to avoid a GDAL install
 * and a multi-GB download; that also removes the z0-4/z3-7 cross-fade, since
 * there is no raster layer to fade FROM. One continuous vector style at all
 * zooms instead. Honest consequence: the world view is a stylised vector
 * globe, not a photograph of Earth.
 *
 * DATA: this module renders Comedy Atlas data ONLY.
 *   - world view  <- data/map/cities.geojson       (one Point per city,
 *                    `brightness` already computed server-side by
 *                    scripts/map_data/build.py via live_brightness())
 *   - city view   <- data/map/cities/<slug>.json   (venues + their shows)
 * It never invents a coordinate and never renders a decorative population
 * light — the thing Robert correctly called dishonest about the old globe,
 * where bright areas were population, not comedy.
 *
 * Exports mount(rootEl, opts) -> handle, mirroring experience.js's contract
 * so index.html can swap between them behind ATLAS_MAP_PROVIDER.
 */

/** Venue marker colours (spec §"CITY VIEW"). Kept as data, at module scope,
 * so a test can assert the mapping without a browser. */
export const VENUE_STATE_COLORS = {
  live: '#ff2d6f',      // bright red/pink — a verified show happening NOW
  imminent: '#ff9a3c',  // orange — starts soon
  upcoming: '#c9a84c',  // subdued gold — has upcoming shows
  none: '#6b7280',      // muted grey — no currently listed show
};

/** Zoom at which OpenFreeMap's own building footprints become extrudable. */
export const BUILDINGS_MIN_ZOOM = 14;

/** fitBounds should land in this zoom band for a city (spec §5). */
export const CITY_FIT_MAX_ZOOM = 12;

export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * NASA Blue Marble Next Generation, served as real WMTS raster tiles by
 * NASA GIBS (Global Imagery Browse Services) in EPSG:3857.
 *
 * This is a genuine tile pyramid — 256px tiles, zoom 0-8 — NOT one stretched
 * image. It needs no API key, no billing, no GDAL and no local download; an
 * earlier assessment in this project that NASA imagery required a multi-GB
 * download and a GDAL install was simply wrong: GIBS publishes WMTS
 * endpoints directly.
 *
 * Attribution required and rendered: "Imagery courtesy NASA EOSDIS GIBS".
 */
export const NASA_BLUEMARBLE_TILE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration'
  + '/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';

/** GIBS publishes BlueMarble_NextGeneration to zoom 8 only. */
export const NASA_MAX_ZOOM = 8;

/** Cross-fade band: NASA fully opaque at/below FADE_START, fully gone at/above
 * FADE_END, linearly interpolated between (spec: "approximately zoom 4-7"). */
export const NASA_FADE_START = 4;
export const NASA_FADE_END = 7;

/**
 * NASA raster opacity for a given zoom. Pure, so the cross-fade is unit
 * testable without a GPU.
 * @param {number} zoom
 * @returns {number} 0..1
 */
export function nasaOpacityForZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  if (zoom <= NASA_FADE_START) return 1;
  if (zoom >= NASA_FADE_END) return 0;
  return 1 - (zoom - NASA_FADE_START) / (NASA_FADE_END - NASA_FADE_START);
}

/**
 * Reduce a venue's shows to the single state its marker should display.
 * Precedence is deliberate and matches how a person reads a map: something
 * happening RIGHT NOW outranks something starting soon, which outranks a
 * future listing. Pure — no DOM, no MapLibre — so it is unit-testable.
 *
 * @param {{status: string}[]} shows
 * @returns {'live'|'imminent'|'upcoming'|'none'}
 */
export function venueState(shows) {
  if (!Array.isArray(shows) || shows.length === 0) return 'none';
  let hasUpcoming = false;
  let hasImminent = false;
  for (const s of shows) {
    if (!s) continue;
    if (s.status === 'live') return 'live';
    if (s.status === 'imminent') hasImminent = true;
    else if (s.status === 'upcoming') hasUpcoming = true;
  }
  if (hasImminent) return 'imminent';
  if (hasUpcoming) return 'upcoming';
  // Only past/cancelled shows remain: the venue is catalogued but has
  // nothing currently listed. Grey, never gold — claiming otherwise would
  // overstate the listing.
  return 'none';
}

/**
 * Shows worth surfacing on a marker/badge: live, imminent or upcoming.
 * Past and cancelled are excluded so a count badge never inflates a venue
 * with history it isn't currently offering.
 */
export function activeShows(shows) {
  if (!Array.isArray(shows)) return [];
  return shows.filter((s) => s && (s.status === 'live' || s.status === 'imminent'
    || s.status === 'upcoming'));
}

/**
 * Bounds -> MapLibre LngLatBoundsLike, or null when a city has no mapped
 * venue at all. Returning null (rather than a zero-area box or a guessed
 * default) is what lets the caller fall back to the city centre honestly.
 */
export function boundsToLngLat(bounds) {
  if (!bounds) return null;
  const { minLat, maxLat, minLng, maxLng } = bounds;
  if (![minLat, maxLat, minLng, maxLng].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** Padding that keeps a fitted city clear of the right-hand detail panel
 * (spec §4: "fitBounds with padding for the right panel"). The panel is
 * ~32% wide capped at 380px in globe-chrome.css; this mirrors that. */
export function fitPaddingFor(viewportWidth) {
  const panel = Math.min(380, Math.max(260, viewportWidth * 0.32));
  const isNarrow = viewportWidth < 700;
  return isNarrow
    // On mobile the panel is a bottom sheet, not a right column.
    ? { top: 60, bottom: Math.round(viewportWidth * 0.9), left: 40, right: 40 }
    : { top: 80, bottom: 80, left: 80, right: Math.round(panel + 48) };
}

/** Idle world-view spin, degrees/sec. Matches the old globe's feel. */
const IDLE_ROTATE_DEG_PER_SEC = 2;
/** Inactivity before idle spin resumes after the user clears a selection. */
const IDLE_RESUME_DELAY_MS = 4000;

/**
 * Mount the MapLibre experience.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   maplibre?: object,           // injected for tests; defaults to window.maplibregl
 *   worldDataUrl?: string,       // data/map/cities.geojson
 *   cityDataUrlFor?: (slug: string) => string,
 *   fetchImpl?: typeof fetch,
 *   styleUrl?: string,
 *   onCitySelected?: (city: object) => void,
 *   onVenueSelected?: (venue: object) => void,
 * }} opts
 */
export function mount(rootEl, opts) {
  const options = opts || {};
  const maplibregl = options.maplibre
    || (typeof window !== 'undefined' ? window.maplibregl : null);
  if (!maplibregl) {
    throw new Error('map-experience: maplibre-gl is not loaded');
  }
  const fetchImpl = options.fetchImpl || ((...a) => fetch(...a));
  const cityDataUrlFor = options.cityDataUrlFor
    || ((slug) => `../data/map/cities/${slug}.json`);

  const map = new maplibregl.Map({
    container: rootEl,
    style: options.styleUrl || OPENFREEMAP_STYLE_URL,
    center: [-25, 15],
    zoom: 1.4,
    attributionControl: { compact: true },
  });
  // Globe projection: the spec's requirement, and what keeps the world view
  // reading as a planet rather than a flat Mercator sheet.
  map.on('style.load', () => {
    try { map.setProjection({ type: 'globe' }); } catch (_e) { /* older builds */ }
    installNasaLayer();
    installBuildings();
    installWorldCityLights();
  });

  /** NASA Blue Marble beneath everything, cross-faded out as we zoom in. */
  function installNasaLayer() {
    if (map.getSource('nasa-bluemarble')) return;
    map.addSource('nasa-bluemarble', {
      type: 'raster',
      tiles: [options.nasaTileUrl || NASA_BLUEMARBLE_TILE_URL],
      tileSize: 256,
      maxzoom: NASA_MAX_ZOOM,
      attribution: 'Imagery courtesy NASA EOSDIS GIBS',
    });
    // Insert BELOW the first symbol (label) layer so OpenFreeMap's place
    // labels stay readable on top of the imagery rather than being buried.
    let firstSymbolId;
    for (const layer of map.getStyle().layers || []) {
      if (layer.type === 'symbol') { firstSymbolId = layer.id; break; }
    }
    map.addLayer({
      id: 'nasa-bluemarble-layer',
      type: 'raster',
      source: 'nasa-bluemarble',
      paint: {
        // Declarative zoom interpolation: MapLibre re-evaluates this every
        // frame on the GPU, so the fade is smooth and needs no JS per-frame
        // work. Mirrors nasaOpacityForZoom() exactly (asserted by test).
        'raster-opacity': [
          'interpolate', ['linear'], ['zoom'],
          NASA_FADE_START, 1,
          NASA_FADE_END, 0,
        ],
      },
    }, firstSymbolId);
  }

  /** 3D building extrusions where OpenFreeMap has footprints (spec §4). */
  function installBuildings() {
    if (map.getLayer('atlas-3d-buildings')) return;
    if (!map.getSource('openmaptiles')) return;  // style without buildings
    try {
      map.addLayer({
        id: 'atlas-3d-buildings',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: BUILDINGS_MIN_ZOOM,
        paint: {
          'fill-extrusion-color': '#1e2a3a',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.65,
        },
      });
    } catch (_e) { /* style lacks a building layer -- not fatal */ }
  }

  /**
   * World-view city lights, driven ONLY by Comedy Atlas live-activity data
   * (data/map/cities.geojson, whose `brightness` was computed server-side by
   * live_brightness()). This is what replaces the old decorative
   * population-lights texture: a bright point here means real comedy
   * happening, never population density.
   */
  function installWorldCityLights() {
    if (map.getSource('atlas-cities')) return;
    map.addSource('atlas-cities', {
      type: 'geojson',
      data: options.worldDataUrl || '../data/map/cities.geojson',
    });
    // Glow halo — radius and opacity both scale with real live activity.
    map.addLayer({
      id: 'atlas-city-glow',
      type: 'circle',
      source: 'atlas-cities',
      maxzoom: NASA_FADE_END + 1,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['coalesce', ['get', 'brightness'], 0],
          0, 6, 1, 26,
        ],
        'circle-color': [
          'case',
          ['>', ['coalesce', ['get', 'activeShowCount'], 0], 0], VENUE_STATE_COLORS.live,
          ['>', ['coalesce', ['get', 'imminentShowCount'], 0], 0], VENUE_STATE_COLORS.imminent,
          VENUE_STATE_COLORS.upcoming,
        ],
        'circle-blur': 1,
        'circle-opacity': [
          'interpolate', ['linear'], ['coalesce', ['get', 'brightness'], 0],
          // A city with nothing live is a subdued network point, not a dark
          // gap and not a false glow -- the spec's "subdued state".
          0, 0.28, 1, 0.85,
        ],
      },
    });
    map.addLayer({
      id: 'atlas-city-core',
      type: 'circle',
      source: 'atlas-cities',
      maxzoom: NASA_FADE_END + 1,
      paint: {
        'circle-radius': 2.5,
        'circle-color': '#fff8e7',
        'circle-opacity': 0.9,
      },
    });
    map.on('click', 'atlas-city-glow', (ev) => {
      const f = ev.features && ev.features[0];
      if (f && f.properties && f.properties.slug) selectCity(f.properties.slug);
    });
    map.on('mouseenter', 'atlas-city-glow', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'atlas-city-glow', () => {
      map.getCanvas().style.cursor = '';
    });
  }

  /* ------------------------------------------------------------------ *
   * SELECTION STATE. Same hard-won rule as the three.js camera fix
   * (2026-07-31): there must be a state meaning "a city is selected", and
   * the idle spin must consult it. The previous globe had no such state,
   * so it flew to a city and immediately span away from it.
   * ------------------------------------------------------------------ */
  let selectionLocked = false;
  let selectedCity = null;
  let lastInteractionAt = 0;
  let rafHandle = null;
  let lastFrameAt = null;
  let destroyed = false;
  let venueMarkers = [];

  function markInteracting() {
    lastInteractionAt = Date.now();
  }
  map.on('dragstart', markInteracting);
  map.on('zoomstart', markInteracting);
  map.on('mousedown', markInteracting);
  map.on('touchstart', markInteracting);

  function tick(now) {
    if (destroyed) return;
    rafHandle = requestAnimationFrame(tick);
    const dt = lastFrameAt === null ? 0 : (now - lastFrameAt) / 1000;
    lastFrameAt = now;

    // The lock wins over everything. A drag ending must NOT restart the
    // spin while a city is still selected — the exact bug fixed on the old
    // renderer, reproduced here deliberately as a guarded invariant.
    if (selectionLocked) return;
    if (Date.now() - lastInteractionAt < IDLE_RESUME_DELAY_MS) return;
    if (map.isMoving() || map.isZooming()) return;
    if (typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (dt <= 0) return;

    const c = map.getCenter();
    map.setCenter([c.lng + IDLE_ROTATE_DEG_PER_SEC * dt, c.lat]);
  }
  rafHandle = requestAnimationFrame(tick);

  function clearVenueMarkers() {
    for (const m of venueMarkers) m.remove();
    venueMarkers = [];
  }

  function renderVenues(cityPayload) {
    clearVenueMarkers();
    for (const venue of cityPayload.venues || []) {
      const shows = activeShows(venue.shows);
      const state = venueState(venue.shows);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `atlas-map-venue atlas-map-venue--${state}`;
      el.style.background = VENUE_STATE_COLORS[state];
      el.setAttribute('aria-label',
        `${venue.name} — ${shows.length} show${shows.length === 1 ? '' : 's'}`);
      if (shows.length > 1) {
        const badge = document.createElement('span');
        badge.className = 'atlas-map-venue-badge';
        badge.textContent = String(shows.length);
        el.appendChild(badge);
      }
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (typeof options.onVenueSelected === 'function') options.onVenueSelected(venue);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([venue.longitude, venue.latitude])
        .addTo(map);
      venueMarkers.push(marker);
    }
  }

  async function selectCity(slug) {
    if (!slug) return clearSelection();
    const res = await fetchImpl(cityDataUrlFor(slug));
    if (!res || !res.ok) {
      // Honest failure: never silently leave the user on a spinning world
      // pretending nothing happened.
      throw new Error(`map-experience: could not load city data for ${slug}`);
    }
    const payload = await res.json();

    selectionLocked = true;   // BEFORE the camera move, so no frame can spin
    selectedCity = payload;
    renderVenues(payload);

    const lngLat = boundsToLngLat(payload.bounds);
    const padding = fitPaddingFor(rootEl.clientWidth || 1440);
    if (lngLat) {
      map.fitBounds(lngLat, { padding, maxZoom: CITY_FIT_MAX_ZOOM, duration: 1600 });
    } else if (payload.city
        && Number.isFinite(payload.city.latitude)
        && Number.isFinite(payload.city.longitude)) {
      // No mapped venue: frame the city centre rather than a fabricated box.
      map.easeTo({
        center: [payload.city.longitude, payload.city.latitude],
        zoom: 11, padding, duration: 1600,
      });
    }
    if (typeof options.onCitySelected === 'function') options.onCitySelected(payload);
    return payload;
  }

  function clearSelection() {
    selectionLocked = false;
    selectedCity = null;
    clearVenueMarkers();
    // Route the resume through the SAME inactivity delay as any other
    // interaction, so rotation never restarts merely because an animation
    // ended (the rule the old renderer got wrong).
    lastInteractionAt = Date.now();
    map.easeTo({ center: [-25, 15], zoom: 1.4, duration: 1400 });
  }

  return {
    map,
    selectCity,
    clearSelection,
    isSelectionLocked: () => selectionLocked,
    getSelectedCity: () => selectedCity,
    destroy() {
      destroyed = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      clearVenueMarkers();
      map.remove();
    },
  };
}

/**
 * Format a show's start time in ITS OWN timezone. Never the viewer's — a
 * London show at 20:00 must read 20:00 to everyone, which is the same rule
 * the exports already follow server-side.
 */
export function formatShowWhen(show) {
  if (!show || !show.startsAt) return 'Time TBA';
  try {
    const d = new Date(show.startsAt);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: show.timezone || 'UTC',
    }).format(d);
  } catch (_e) {
    return 'Time TBA';
  }
}

/**
 * Build the venue detail panel: name, address, and every current/upcoming
 * show as a real clickable link to its Comedy Atlas event page.
 *
 * `doc` is injected so this is testable under plain `node --test`.
 */
export function buildVenuePanel(doc, venue) {
  const wrap = doc.createElement('div');
  wrap.className = 'atlas-map-venue-panel';

  const name = doc.createElement('h3');
  name.className = 'atlas-map-venue-panel-name';
  name.textContent = venue.name || 'Venue';
  wrap.appendChild(name);

  if (venue.address) {
    const addr = doc.createElement('p');
    addr.className = 'atlas-map-venue-panel-address';
    addr.textContent = venue.address;
    wrap.appendChild(addr);
  }

  const shows = activeShows(venue.shows);
  if (shows.length === 0) {
    const none = doc.createElement('p');
    none.className = 'atlas-map-venue-panel-address';
    // Honest: catalogued, but nothing currently listed. Never implied to be
    // "coming soon" when we simply have nothing.
    none.textContent = 'No current or upcoming shows listed.';
    wrap.appendChild(none);
    return wrap;
  }

  for (const show of shows) {
    // A real <a href>, not a JS click handler: it must be openable in a new
    // tab, crawlable, and work if scripting fails.
    const a = doc.createElement('a');
    a.className = 'atlas-map-show';
    a.href = show.url || '#';

    const title = doc.createElement('span');
    title.className = 'atlas-map-show-title';
    title.textContent = show.title || 'Untitled show';
    a.appendChild(title);

    const when = doc.createElement('span');
    when.className = 'atlas-map-show-when';
    when.textContent = formatShowWhen(show);
    a.appendChild(when);

    if (show.status === 'live') {
      const live = doc.createElement('span');
      live.className = 'atlas-map-show-live';
      live.textContent = 'ON NOW';
      a.appendChild(live);
      if (show.liveStatusEstimated) {
        // The end time was inferred, so say so rather than presenting an
        // estimate as a verified fact.
        const est = doc.createElement('span');
        est.className = 'atlas-map-show-estimated';
        est.textContent = 'end time estimated';
        a.appendChild(est);
      }
    }
    wrap.appendChild(a);
  }
  return wrap;
}

/**
 * H2 (2026-08-03): the visitor-facing summary for a city's map panel.
 *
 * Replaces the two notes this file used to render (removed 2026-08-03) that
 * described the map's two internal "why isn't this show pinned" states in
 * database vocabulary — a real venue this repo holds but cannot verify
 * coordinates for, and a show with no venue record at all. Both states were
 * added honestly (2026-08-02, so a visitor was never told a gap simply
 * didn't exist) but explained in the register of the schema that produced
 * them, not the register of someone deciding whether to come to a show.
 * That reads like a database error on a page about to be shown to real
 * venues and comics.
 *
 * This function keeps the same honesty — the two underlying counts are
 * still summed here, never dropped — while describing the result the way a
 * visitor would want it: how many shows they can see pinned right now, how
 * many more exist whose pin isn't ready yet, and a link so an unpinned show
 * is always still one click away, never actually hidden. Robert's copy
 * pattern (his own wording, task H2 brief):
 *
 *   Primary:   "20 upcoming shows across 4 mapped venues."
 *   Secondary: "22 additional dates have locations still being confirmed."
 *              (the paragraph is omitted entirely when this count is 0 —
 *              never rendered as "0 additional dates...", which would be
 *              noise, not honesty)
 *   Link:      "View all <City> shows"
 *
 * A city with 0 mapped venues still gets an honest primary line ("N
 * upcoming shows across 0 mapped venues.") — never a coverage claim that
 * isn't true.
 *
 * @param {Document} doc
 * @param {object} payload city-map payload (scripts/map_data/build.py shape:
 *   .venues[], .unmappedVenues.unmappedShowCount, .unassignedShowCount,
 *   .city.name/.slug)
 * @param {string|null} [cityHref] href for the "View all <City> shows" link.
 *   No link is rendered when this is falsy (caller has none to offer).
 * @returns {HTMLElement} a <div class="atlas-map-summary"> with 1-3 <p> children.
 */
export function buildCityMapSummary(doc, payload, cityHref) {
  const venues = Array.isArray(payload && payload.venues) ? payload.venues : [];
  // 2026-08-07: the payload now includes venues with NO current dates (the
  // catalogue lists a venue whether or not a source feeds its calendar).
  // Count them separately -- "66 shows across 10 venues" would be a lie when
  // 7 of the 10 have no dates; "across 3, plus 7 more listed" is the truth.
  const venuesWithShows = venues.filter(
    (v) => activeShows(v && v.shows).length > 0);
  const mappedVenueCount = venuesWithShows.length;
  const showlessVenueCount = venues.length - venuesWithShows.length;
  const mappedShowCount = venues.reduce(
    (n, v) => n + activeShows(v && v.shows).length, 0);

  // Both honest P0-1/2026-08-02 counts, summed rather than explained by
  // cause — see the function docstring above.
  const unassignedCount = (payload && payload.unassignedShowCount) || 0;
  const unmappedCount = (payload && payload.unmappedVenues
    && payload.unmappedVenues.unmappedShowCount) || 0;
  const additionalCount = unassignedCount + unmappedCount;

  const cityName = (payload && payload.city && payload.city.name) || 'this city';

  const wrap = doc.createElement('div');
  wrap.className = 'atlas-map-summary';

  const primary = doc.createElement('p');
  primary.className = 'atlas-map-summary-primary';
  primary.textContent =
    `${mappedShowCount} upcoming show${mappedShowCount === 1 ? '' : 's'} `
    + `across ${mappedVenueCount} mapped venue${mappedVenueCount === 1 ? '' : 's'}.`;
  wrap.appendChild(primary);

  if (showlessVenueCount > 0) {
    const alsoListed = doc.createElement('p');
    alsoListed.className = 'atlas-map-summary-secondary';
    alsoListed.textContent = showlessVenueCount === 1
      ? '1 more venue is on the map with no upcoming dates listed.'
      : `${showlessVenueCount} more venues are on the map with no upcoming dates listed.`;
    wrap.appendChild(alsoListed);
  }

  if (additionalCount > 0) {
    const secondary = doc.createElement('p');
    secondary.className = 'atlas-map-summary-secondary';
    secondary.textContent = additionalCount === 1
      ? '1 additional date has a location still being confirmed.'
      : `${additionalCount} additional dates have locations still being confirmed.`;
    wrap.appendChild(secondary);
  }

  if (cityHref) {
    const linkP = doc.createElement('p');
    linkP.className = 'atlas-map-summary-link';
    const a = doc.createElement('a');
    a.href = cityHref;
    a.textContent = `View all ${cityName} shows`;
    linkP.appendChild(a);
    wrap.appendChild(linkP);
  }

  return wrap;
}

export const __internal = {
  venueState,
  activeShows,
  boundsToLngLat,
  fitPaddingFor,
  formatShowWhen,
  buildVenuePanel,
  buildCityMapSummary,
  nasaOpacityForZoom,
  VENUE_STATE_COLORS,
  IDLE_RESUME_DELAY_MS,
};
