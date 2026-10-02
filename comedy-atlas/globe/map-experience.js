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

/** Smallest comfortable touch target (WCAG 2.5.5 / Apple HIG): every venue
 * and cluster button is at least this many CSS px square, and a tap on the
 * world-view city dots hits anything drawn within half of it. */
export const TAP_TARGET_PX = 44;

/** Venue GeoJSON source / clustering (2026-10-01). Nearby venues merge into a
 * numbered cluster instead of 54 overlapping DOM pins in Paris. */
export const VENUE_SOURCE_ID = 'atlas-venues';
export const CLUSTER_RADIUS_PX = 52;
export const CLUSTER_MAX_ZOOM = 15;

/**
 * One key per recurring "show" (series). The DB series id when the date has
 * one, otherwise its normalised title -- mirrors scripts/map_data/build.py's
 * series_key(), and is computed here from the dates themselves so JSON
 * generated before 2026-10-01 (no series fields) still groups sensibly.
 */
export function seriesKeyFor(show) {
  if (show && show.showSeriesId !== undefined && show.showSeriesId !== null) {
    return `sid:${show.showSeriesId}`;
  }
  const title = (show && show.title) || '';
  return `t:${String(title).toLowerCase().split(/\s+/).filter(Boolean).join(' ')}`;
}

function startMs(show) {
  const t = show && show.startsAt ? Date.parse(show.startsAt) : NaN;
  return Number.isFinite(t) ? t : Infinity;
}

/**
 * Collapse a venue's current dates into one entry per show (series), each
 * with its dates and the next one. Sorted by next date. Pure.
 * @returns {{key:string,id:*,name:string,url:string|null,dates:object[],
 *   dateCount:number,next:object,nextStartsAt:string|null}[]}
 */
export function groupShowsBySeries(shows) {
  const groups = new Map();
  for (const s of activeShows(shows)) {
    const key = seriesKeyFor(s);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        id: s.showSeriesId === undefined ? null : s.showSeriesId,
        name: s.showSeriesName || s.title || 'Untitled show',
        url: s.showSeriesUrl || null,
        dates: [],
      };
      groups.set(key, g);
    }
    g.dates.push(s);
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.dates.sort((a, b) => startMs(a) - startMs(b));
    g.dateCount = g.dates.length;
    g.next = g.dates.find((d) => d.status === 'live') || g.dates[0];
    g.nextStartsAt = g.next.startsAt || null;
  }
  out.sort((a, b) => startMs(a.next) - startMs(b.next));
  return out;
}

/** {seriesCount, dateCount, nextStartsAt} for one venue. */
export function venueTotals(venue) {
  const groups = groupShowsBySeries(venue && venue.shows);
  return {
    seriesCount: groups.length,
    dateCount: groups.reduce((n, g) => n + g.dateCount, 0),
    nextStartsAt: groups.length ? groups[0].nextStartsAt : null,
  };
}

/** "2 shows · 49 dates" -- the one phrase every surface (marker label, aria,
 * panel header) uses, so they can never disagree. */
export function formatShowsDates(seriesCount, dateCount) {
  const s = `${seriesCount} show${seriesCount === 1 ? '' : 's'}`;
  const d = `${dateCount} date${dateCount === 1 ? '' : 's'}`;
  return `${s} · ${d}`;
}

export function venueAriaLabel(venue) {
  const t = venueTotals(venue);
  const name = (venue && venue.name) || 'Venue';
  return t.seriesCount === 0
    ? `${name} — no upcoming shows`
    : `${name} — ${formatShowsDates(t.seriesCount, t.dateCount)}`;
}

/** GeoJSON for the clustered venue source. `epoch` lets the marker sync
 * ignore features left over from a previous city. */
export function venuesToFeatureCollection(venues, epoch) {
  const features = [];
  (venues || []).forEach((v, idx) => {
    if (!v || !Number.isFinite(v.longitude) || !Number.isFinite(v.latitude)) return;
    const t = venueTotals(v);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
      properties: { idx, epoch, seriesCount: t.seriesCount, dateCount: t.dateCount },
    });
  });
  return { type: 'FeatureCollection', features };
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

/** Padding for a fitted city. 2026-10-01: the details panel no longer floats
 * OVER the map -- it lives in a rail beside the map (desktop/landscape) or a
 * sheet below it (portrait) -- so the camera needs only an even margin; the
 * old right-hand/bottom reserve existed purely to dodge the overlay. */
export function fitPaddingFor(viewportWidth) {
  const narrow = viewportWidth < 700;
  const m = narrow ? 36 : 56;
  return { top: m, bottom: m, left: m, right: m };
}

/** Idle world-view spin, degrees/sec. Matches the old globe's feel. */
const IDLE_ROTATE_DEG_PER_SEC = 2;
/** Inactivity before idle spin resumes after the user clears a selection. */
const IDLE_RESUME_DELAY_MS = 4000;

/**
 * Zoom at/above which the user is looking at a city, not the world (Bug
 * A/B fix, 2026-08-16). Deliberately the exact level that used to make the
 * atlas-city-glow/atlas-city-core layers DISAPPEAR (the old
 * `maxzoom: NASA_FADE_END + 1`) -- that cap is what caused "when I zoomed in
 * to Paris you don't see any shows". Reused here for two purposes that both
 * boil down to "has the user left the world view": (1) gate the idle spin
 * (Bug B: it must not resume once the user has deliberately zoomed in, even
 * with nothing selected) and (2) gate manual-zoom venue loading (Bug A).
 */
export const MANUAL_ZOOM_CITY_THRESHOLD = NASA_FADE_END + 1;

/** Debounce for the manual-zoom venue-loading watcher (below): a zoom/pan
 * gesture fires several `moveend` events in quick succession and we want to
 * fetch the SETTLED city once, not once per intermediate frame. */
const MANUAL_ZOOM_DEBOUNCE_MS = 250;

/**
 * Zoom at/above which the idle spin must NOT resume, even with nothing
 * selected (Bug B correction, 2026-08-16, second pass). Deliberately a
 * SEPARATE constant from MANUAL_ZOOM_CITY_THRESHOLD above -- reusing that
 * one (8) for the spin gate was the mistake in the first pass: Robert's own
 * repro screenshot showed the globe at roughly zoom 5-6 (country level,
 * place labels visible), which is well below 8, and the spin was still
 * dragging him sideways. The two thresholds answer different questions --
 * 8 is "how far in before a city's venues are worth loading"; this one is
 * "has the user deliberately left the ambient world view at all" -- and the
 * honest answer to the second question is "barely any zoom in counts".
 *
 * mount() starts the camera at zoom 1.4, where the whole planet (multiple
 * continents) is visible at once -- that framing IS the ambient spin, so a
 * tiny amount of zoom drift or a fractional-zoom render must not look like
 * navigation. By ~2.5-3 the view has narrowed to roughly a continent/region,
 * which is a deliberate act a user chose to do, not ambient motion -- so
 * that is where this threshold sits. It is intentionally far below
 * MANUAL_ZOOM_CITY_THRESHOLD (8): a user does not need to reach city level,
 * or even country level, before the spin owes them stillness.
 */
export const WORLD_VIEW_ZOOM_THRESHOLD = 2.6;

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
  // The compact attribution control opens itself on load and, on a phone, sat
  // over ~130px of the map. Collapse it; the (i) button still opens it, so
  // the required credit is one tap away, never removed.
  map.on('load', () => {
    try {
      const attrib = rootEl.querySelector && rootEl.querySelector('.maplibregl-ctrl-attrib');
      if (attrib) {
        attrib.classList.remove('maplibregl-compact-show');
        attrib.removeAttribute('open');
      }
    } catch (_e) { /* cosmetic only */ }
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
      // No maxzoom cap (Bug A, 2026-08-16): this used to vanish above
      // NASA_FADE_END + 1, so a user who zoomed into Paris saw bare
      // OpenFreeMap streets with no Comedy Atlas content at all -- the
      // reported bug. The NASA raster fade (a separate layer/paint
      // property, see installNasaLayer) is unchanged; only this marker's
      // own visibility cap is removed.
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
      // Same removal, same reason -- see atlas-city-glow above.
      paint: {
        'circle-radius': 2.5,
        'circle-color': '#fff8e7',
        'circle-opacity': 0.9,
      },
    });
    // Hit area: anything drawn within half a tap target (22px) of the tap,
    // not just the 2-26px dot itself -- a fingertip is ~44px.
    map.on('click', (ev) => {
      const r = TAP_TARGET_PX / 2;
      const p = ev.point || { x: 0, y: 0 };
      let hits = [];
      try {
        hits = map.queryRenderedFeatures(
          [[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ['atlas-city-glow'] }) || [];
      } catch (_e) { hits = []; }
      const f = hits[0];
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

  /**
   * "The user navigated here by hand" (Bug A, 2026-08-16) -- deliberately a
   * SEPARATE piece of state from `selectionLocked` above. `selectionLocked`
   * is the hard, user-committed selection made by clicking an
   * atlas-city-glow marker or via the search module: it drives fitBounds,
   * the detail panel, and (via clearSelection) the recenter control, and
   * every existing selection-lock invariant keys off it. A manual pinch/
   * scroll zoom into a city is a real navigation too, but a SOFTER one --
   * the user never committed to a city, they just looked at one -- so it
   * gets its own state that clears independently the moment they zoom back
   * out or pan to a different city, and that a hard selectCity()/
   * clearSelection() always supersedes and resets. Holds the currently
   * shown city's slug, or null when nothing is manually loaded.
   */
  let handNavigatedCitySlug = null;
  let manualZoomTimer = null;

  /**
   * "The user has deliberately panned away from the ambient world view"
   * (Bug B correction, 2026-08-16, second pass). A user who drags the globe
   * to look at, say, Europe, then stops, is in exactly the same position as
   * one who zoomed in: both navigated on purpose and neither wants the
   * ambient spin dragging them sideways 4s later. Zoom alone can't catch
   * this — a pan can move the whole visible world without changing zoom at
   * all — so this is a THIRD, independent piece of navigation state
   * alongside selectionLocked (hard click/search selection) and
   * handNavigatedCitySlug (soft manual-zoom venue loading). Set by a real
   * `dragend` (MapLibre fires that only from actual pointer drags, never
   * from this file's own programmatic fitBounds/easeTo calls, so it can
   * never self-trigger). Cleared only by the explicit escape hatch,
   * clearSelection() (the recenter control) — see there for why.
   */
  let hasPannedAwayFromWorldView = false;

  function markInteracting() {
    lastInteractionAt = Date.now();
  }
  map.on('dragstart', markInteracting);
  map.on('zoomstart', markInteracting);
  map.on('mousedown', markInteracting);
  map.on('touchstart', markInteracting);
  map.on('dragend', () => { hasPannedAwayFromWorldView = true; });

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
    // Bug B (2026-08-16): "the globe keeps spinning". The idle spin used to
    // resume 4s after ANY interaction as long as no city was selectionLocked
    // — including a deliberate manual zoom or pan, which is real navigation
    // even though it never sets selectionLocked. Ambient spin is
    // homepage-only motion for the WORLD view; once the user is past it (by
    // zoom OR by pan), it stays off, independent of selection, until they
    // return to it via the recenter control.
    if (hasPannedAwayFromWorldView) return;
    if (typeof map.getZoom === 'function'
        && map.getZoom() >= WORLD_VIEW_ZOOM_THRESHOLD) return;
    if (dt <= 0) return;

    const c = map.getCenter();
    map.setCenter([c.lng + IDLE_ROTATE_DEG_PER_SEC * dt, c.lat]);
  }
  rafHandle = requestAnimationFrame(tick);

  /* ---------------------------------------------------------------- *
   * VENUE MARKERS (2026-10-01 rewrite). A MapLibre-native clustered
   * GeoJSON source decides what is a cluster and what is a single venue;
   * each result is drawn as ONE accessible <button> (>=44px hit area, a
   * smaller visual inside) so a venue is never two circles, 54 Paris pins
   * merge into numbered clusters, and every tap target is finger-sized.
   * The label on a venue is its number of DISTINCT shows, not dated rows.
   * ---------------------------------------------------------------- */
  let currentVenues = [];
  let dataEpoch = 0;
  let markerById = new Map();
  let pendingVenuePayload = null;

  function clearVenueMarkers() {
    for (const m of markerById.values()) m.remove();
    markerById = new Map();
    currentVenues = [];
    const src = map.getSource && map.getSource(VENUE_SOURCE_ID);
    if (src && typeof src.setData === 'function') {
      try { src.setData({ type: 'FeatureCollection', features: [] }); } catch (_e) { /* map gone */ }
    }
  }

  function ensureVenueSource() {
    if (map.getSource(VENUE_SOURCE_ID)) return true;
    try {
      map.addSource(VENUE_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: CLUSTER_RADIUS_PX,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterProperties: { shows: ['+', ['get', 'seriesCount']] },
      });
      // MapLibre only tiles a source some layer uses; this layer draws
      // nothing (the visible pins are the DOM buttons) but keeps it live.
      map.addLayer({
        id: 'atlas-venues-anchor', type: 'circle', source: VENUE_SOURCE_ID,
        paint: { 'circle-radius': 1, 'circle-opacity': 0 },
      });
      return true;
    } catch (_e) {
      return false; // style not ready yet -- caller retries on 'idle'
    }
  }

  function venueButton(venue) {
    const state = venueState(venue.shows);
    const totals = venueTotals(venue);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `atlas-map-venue atlas-map-venue--${state}`;
    el.setAttribute('aria-label', venueAriaLabel(venue));
    const pill = document.createElement('span');
    pill.className = 'atlas-map-venue-pill';
    pill.style.background = VENUE_STATE_COLORS[state];
    pill.textContent = totals.seriesCount > 0 ? String(totals.seriesCount) : '';
    el.appendChild(pill);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (typeof options.onVenueSelected === 'function') options.onVenueSelected(venue);
    });
    return el;
  }

  function clusterButton(feature) {
    const props = feature.properties || {};
    const count = props.point_count || 0;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'atlas-map-cluster';
    el.setAttribute('aria-label',
      `${count} venues, ${props.shows || 0} show${props.shows === 1 ? '' : 's'} — zoom in`);
    const bubble = document.createElement('span');
    bubble.className = 'atlas-map-cluster-bubble';
    bubble.textContent = String(count);
    // 30px for 2 venues up to 42px for 40+, always inside the 44px button.
    const size = Math.round(30 + Math.min(12, Math.log2(Math.max(2, count)) * 2.2));
    bubble.style.width = bubble.style.height = `${size}px`;
    el.appendChild(bubble);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      expandCluster(feature);
    });
    return el;
  }

  function lngLatOf(feature) {
    return feature.geometry && feature.geometry.coordinates;
  }

  async function expandCluster(feature) {
    const src = map.getSource(VENUE_SOURCE_ID);
    const id = feature.properties.cluster_id;
    const center = lngLatOf(feature);
    let zoom = NaN;
    let leaves = [];
    try {
      zoom = await src.getClusterExpansionZoom(id);
      leaves = await src.getClusterLeaves(id, 200, 0);
    } catch (_e) { /* fall through to a plain zoom-in */ }
    const venues = leaves
      .map((l) => currentVenues[l.properties && l.properties.idx])
      .filter(Boolean);
    // Venues that share (almost) one point can never be pulled apart by
    // zooming -- list them instead (the rail), so none is unreachable.
    const coLocated = venues.length > 1 && venues.every((v) =>
      Math.abs(v.latitude - venues[0].latitude) < 0.00005
      && Math.abs(v.longitude - venues[0].longitude) < 0.00005);
    if (coLocated) {
      if (typeof options.onClusterSelected === 'function') options.onClusterSelected(venues);
      return;
    }
    const target = Number.isFinite(zoom) ? Math.min(zoom + 0.25, 18) : map.getZoom() + 2;
    map.easeTo({ center, zoom: Math.max(target, map.getZoom() + 0.75), duration: 500 });
  }

  /** Reconcile DOM buttons with what the cluster source currently yields. */
  function syncMarkers() {
    if (destroyed || !currentVenues.length) return;
    if (!map.getSource(VENUE_SOURCE_ID)) return;
    if (typeof map.isSourceLoaded === 'function' && !map.isSourceLoaded(VENUE_SOURCE_ID)) return;
    let feats = [];
    try { feats = map.querySourceFeatures(VENUE_SOURCE_ID) || []; } catch (_e) { return; }
    const wanted = new Map();
    for (const f of feats) {
      const p = f.properties || {};
      if (!p.cluster && p.epoch !== dataEpoch) continue; // leftover from an earlier city
      const key = p.cluster ? `c${p.cluster_id}` : `v${p.idx}`;
      if (!wanted.has(key)) wanted.set(key, f);
    }
    for (const [key, m] of markerById) {
      if (!wanted.has(key)) { m.remove(); markerById.delete(key); }
    }
    for (const [key, f] of wanted) {
      if (markerById.has(key)) continue;
      const p = f.properties;
      let el;
      if (p.cluster) el = clusterButton(f);
      else if (currentVenues[p.idx]) el = venueButton(currentVenues[p.idx]);
      else continue;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(lngLatOf(f))
        .addTo(map);
      markerById.set(key, marker);
    }
  }
  map.on('render', syncMarkers);

  function renderVenues(cityPayload) {
    clearVenueMarkers();
    const venues = (cityPayload.venues || []).filter(
      (v) => v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude));
    if (!ensureVenueSource()) {
      // The style is still loading (a very early search). Try again once it settles.
      pendingVenuePayload = cityPayload;
      if (typeof map.once === 'function') {
        map.once('idle', () => {
          const p = pendingVenuePayload;
          pendingVenuePayload = null;
          if (p && !destroyed && selectedCity === p) renderVenues(p);
        });
      }
      return;
    }
    currentVenues = venues;
    dataEpoch += 1;
    map.getSource(VENUE_SOURCE_ID).setData(venuesToFeatureCollection(venues, dataEpoch));
    syncMarkers();
  }

  /**
   * Manual-zoom venue loading (Bug A, 2026-08-16). Venue markers used to be
   * created ONLY by renderVenues(), called ONLY from selectCity(), reachable
   * ONLY via a click on atlas-city-glow or the search module. A user who
   * pinch- or scroll-zoomed straight into a city triggered neither, so they
   * saw bare OpenFreeMap streets — nothing Comedy-Atlas about them. This
   * watches `moveend`, and once the user has zoomed in far enough to be
   * looking at one city (found the same way the click handler already
   * finds one — the atlas-city-glow features actually on screen), loads
   * that city's venues via the SAME fetchImpl/cityDataUrlFor selectCity
   * uses, but WITHOUT touching selectionLocked — see handNavigatedCitySlug
   * above for why that separation matters.
   */
  function scheduleManualZoomCheck() {
    if (manualZoomTimer) clearTimeout(manualZoomTimer);
    manualZoomTimer = setTimeout(() => {
      manualZoomTimer = null;
      checkManualZoom();
    }, MANUAL_ZOOM_DEBOUNCE_MS);
  }

  function checkManualZoom() {
    if (destroyed || selectionLocked) return; // a real selection owns the view
    if (map.getZoom() < MANUAL_ZOOM_CITY_THRESHOLD) {
      if (handNavigatedCitySlug) {
        handNavigatedCitySlug = null;
        clearVenueMarkers();
      }
      return;
    }
    let features = [];
    try {
      features = map.queryRenderedFeatures(undefined, { layers: ['atlas-city-glow'] }) || [];
    } catch (_e) {
      features = []; // style/layer not ready yet — treat as "no city in view"
    }
    const slug = features[0] && features[0].properties && features[0].properties.slug;
    if (!slug) {
      if (handNavigatedCitySlug) {
        handNavigatedCitySlug = null;
        clearVenueMarkers();
      }
      return;
    }
    if (slug === handNavigatedCitySlug) return; // already showing this city

    fetchImpl(cityDataUrlFor(slug))
      .then((res) => {
        if (!res || !res.ok) {
          throw new Error(`map-experience: could not load city data for ${slug}`);
        }
        return res.json();
      })
      .then((payload) => {
        if (!payload || destroyed || selectionLocked) return;
        // A fast pan could have moved the user on to somewhere else while
        // this fetch was in flight; only render if still zoomed in.
        if (map.getZoom() < MANUAL_ZOOM_CITY_THRESHOLD) return;
        handNavigatedCitySlug = slug;
        renderVenues(payload);
      })
      .catch((err) => {
        // Honest failure, file convention (see selectCity below) — but this
        // path has no caller awaiting a promise, so it must never become an
        // unhandled rejection in the render loop. Surfaced via console.error
        // instead: silent to the user (no crash, no stuck spinner) but
        // visible to anyone debugging.
        if (typeof console !== 'undefined' && console.error) console.error(err);
      });
  }
  map.on('moveend', scheduleManualZoomCheck);

  async function selectCity(slug) {
    if (!slug) return clearSelection();
    // A hard selection supersedes any soft manual-zoom/pan state outright.
    handNavigatedCitySlug = null;
    hasPannedAwayFromWorldView = false;
    if (manualZoomTimer) { clearTimeout(manualZoomTimer); manualZoomTimer = null; }
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
    // Same reset as selectCity() above: the recenter control must not leave
    // stale manual-zoom/pan state behind (e.g. a fetch already in flight
    // from a manual zoom that this recenter is now overriding, or a pan
    // flag that would otherwise keep the ambient spin off forever — this
    // IS the escape hatch back to it).
    handNavigatedCitySlug = null;
    hasPannedAwayFromWorldView = false;
    if (manualZoomTimer) { clearTimeout(manualZoomTimer); manualZoomTimer = null; }
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
    /** Fly to one venue (used by the rail's venue list). */
    focusVenue(venue) {
      if (venue && Number.isFinite(venue.longitude) && Number.isFinite(venue.latitude)) {
        map.easeTo({ center: [venue.longitude, venue.latitude],
          zoom: Math.max(map.getZoom(), 15), duration: 700 });
      }
    },
    /** Test/diagnostic view of what is drawn: [{key,label,aria,w,h}]. */
    describeMarkers() {
      return [...markerById.entries()].map(([key, m]) => {
        const el = m.getElement ? m.getElement() : m.el;
        return { key, text: el && el.textContent, aria: el && el.getAttribute && el.getAttribute('aria-label') };
      });
    },
    getSelectedCity: () => selectedCity,
    destroy() {
      destroyed = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      if (manualZoomTimer) clearTimeout(manualZoomTimer);
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

  const groups = groupShowsBySeries(venue.shows);
  if (groups.length === 0) {
    const none = doc.createElement('p');
    none.className = 'atlas-map-venue-panel-address';
    // Honest: catalogued, but nothing currently listed. Never implied to be
    // "coming soon" when we simply have nothing.
    none.textContent = 'No current or upcoming shows listed.';
    wrap.appendChild(none);
    return wrap;
  }

  // 2026-10-01: one headline that matches the marker label ("2 shows"), then
  // each show ONCE with its next date. Eleven weekly dates of one series used
  // to read as eleven "shows" (Velvet Bar's "11").
  const totals = venueTotals(venue);
  const count = doc.createElement('p');
  count.className = 'atlas-map-venue-panel-count';
  count.textContent = formatShowsDates(totals.seriesCount, totals.dateCount);
  wrap.appendChild(count);

  for (const group of groups) {
    const show = group.next;
    const card = doc.createElement('div');
    card.className = 'atlas-map-show-group';

    // A real <a href>, not a JS click handler: it must be openable in a new
    // tab, crawlable, and work if scripting fails.
    const a = doc.createElement('a');
    a.className = 'atlas-map-show';
    a.href = show.url || '#';

    const title = doc.createElement('span');
    title.className = 'atlas-map-show-title';
    title.textContent = group.name || 'Untitled show';
    a.appendChild(title);

    const when = doc.createElement('span');
    when.className = 'atlas-map-show-when';
    when.textContent = `Next: ${formatShowWhen(show)}`;
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
    card.appendChild(a);

    if (group.dateCount > 1 && group.url) {
      const all = doc.createElement('a');
      all.className = 'atlas-map-show-all';
      all.href = group.url;
      all.textContent = `See all dates (${group.dateCount})`;
      card.appendChild(all);
    }
    wrap.appendChild(card);
  }
  return wrap;
}

/**
 * The rail's venue list for a city (2026-10-01): one button per mapped venue,
 * labelled with the same "N shows · M dates" phrase as its map marker. This
 * is also the keyboard/screen-reader route to every pin. `onPick(venue)` is
 * called on activation. Venues with shows come first, soonest first.
 */
export function buildCityVenueList(doc, payload, onPick) {
  const venues = (Array.isArray(payload && payload.venues) ? payload.venues : [])
    .filter((v) => v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude));
  const rows = venues.map((v) => ({ v, t: venueTotals(v) }));
  rows.sort((a, b) => {
    if ((a.t.seriesCount > 0) !== (b.t.seriesCount > 0)) return a.t.seriesCount > 0 ? -1 : 1;
    const ta = a.t.nextStartsAt ? Date.parse(a.t.nextStartsAt) : Infinity;
    const tb = b.t.nextStartsAt ? Date.parse(b.t.nextStartsAt) : Infinity;
    return ta - tb;
  });
  const list = doc.createElement('div');
  list.className = 'atlas-map-venue-list';
  for (const { v, t } of rows) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'atlas-map-venue-row';
    if (b.setAttribute) b.setAttribute('aria-label', venueAriaLabel(v));
    const name = doc.createElement('span');
    name.className = 'atlas-map-venue-row-name';
    name.textContent = v.name || 'Venue';
    b.appendChild(name);
    const meta = doc.createElement('span');
    meta.className = 'atlas-map-venue-row-meta';
    meta.textContent = t.seriesCount > 0
      ? formatShowsDates(t.seriesCount, t.dateCount) : 'No upcoming dates';
    b.appendChild(meta);
    if (b.addEventListener) b.addEventListener('click', () => { if (onPick) onPick(v); });
    list.appendChild(b);
  }
  return list;
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
  // 2026-10-01: "shows" are DISTINCT shows (a weekly series is one show) and
  // dates are the dated occurrences, so the header agrees with every marker.
  const venuesWithShows = venues.filter(
    (v) => activeShows(v && v.shows).length > 0);
  const mappedVenueCount = venuesWithShows.length;
  const showlessVenueCount = venues.length - venuesWithShows.length;
  const mappedDateCount = venues.reduce(
    (n, v) => n + activeShows(v && v.shows).length, 0);
  const mappedShowCount = new Set(venues.flatMap(
    (v) => activeShows(v && v.shows).map(seriesKeyFor))).size;

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
    `${formatShowsDates(mappedShowCount, mappedDateCount)} `
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
  buildCityVenueList,
  groupShowsBySeries,
  seriesKeyFor,
  venueTotals,
  venueAriaLabel,
  formatShowsDates,
  venuesToFeatureCollection,
  TAP_TARGET_PX,
  VENUE_SOURCE_ID,
  nasaOpacityForZoom,
  VENUE_STATE_COLORS,
  IDLE_RESUME_DELAY_MS,
  MANUAL_ZOOM_CITY_THRESHOLD,
  WORLD_VIEW_ZOOM_THRESHOLD,
};
