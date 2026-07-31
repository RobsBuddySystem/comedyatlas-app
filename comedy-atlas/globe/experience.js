/**
 * COMEDY ATLAS — Interactive Globe: AtlasGlobeExperience
 * (site/comedy-atlas/globe/experience.js)
 *
 * CHECKPOINT 6 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * The single public entry point for the whole globe feature (plan's own
 * words: "the only public entry point"). Composes every module shipped so
 * far — CP2's vendored three.js, CP3's pure-JS data/activity/cluster
 * logic, CP4's chrome/tokens/fallback/legend/loading, CP5's earth+camera,
 * and this checkpoint's markers.js + panel.js — into one mountable widget.
 *
 * Exports:
 *   mount(rootEl, {dataUrl, flags, fetchImpl, payload, cityHref, quality})
 *     -> {destroy, selectCity(id), setLayer(name, on)}
 *
 * `payload` (optional) lets a caller (chiefly this checkpoint's own tests,
 * and CP9's homepage integration if it ever wants to pre-fetch) hand in an
 * already-parsed `{cities, excluded, totals, generatedAt}` object instead
 * of triggering a network fetch — `dataUrl`/`fetchImpl` are ignored when
 * `payload` is supplied. Without it, `loadGlobeCities` (data-adapter.js,
 * CP3) fetches and parses `dataUrl` exactly as production will.
 *
 * `cityHref` default: this module assumes it mounts one directory level
 * below `site/comedy-atlas/` (matching CP5's own `globe-harness/` test
 * placement convention, and fallback.js's existing `"../city/<slug>/"`
 * default) — see `defaultCityHref` below. CP9, which mounts directly on
 * `site/comedy-atlas/index.html` (one level shallower), MUST override
 * `cityHref` to `"city/<slug>/"` at that point; this is called out again
 * in CP9's own step so it isn't silently wrong on integration.
 */

import * as THREE from '../vendor/three/three.module.js';
import { createEarth } from './earth.js';
import { createCameraController } from './camera.js';
import { loadGlobeCities, parseGlobePayload } from './data-adapter.js';
import { createCityMarkerLayer } from './markers.js';
import { renderDetailPanel } from './panel.js';
import { mountGlobeFallback } from './fallback.js';
import {
  createLayerSelector,
  DEFAULT_LAYERS,
  renderLegend,
  renderFooterStats,
  renderNearMe,
} from './legend.js';
import { renderLoadingState } from './loading.js';
import { mountGlobeSearch } from './search.js';
import { buildLayerRegistry, filterCitiesForLayer, renderShowsNowCounter } from './layers.js';
import { isMobileViewport, mountBottomSheet, attachTouchGestureGuard } from './sheet.js';

function slugFallback(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function defaultCityHref(city) {
  const slug = (city && (city.slug || slugFallback(city.name))) || '';
  return '../city/' + slug + '/';
}

/** Same "one directory level below site/comedy-atlas/" convention as
 * `defaultCityHref` above (see that function's own comment). Unlike
 * `city/`, which lives INSIDE `site/comedy-atlas/`, `data/comedy-atlas/`
 * is published as a SIBLING of the whole `comedy-atlas/` directory (see
 * `atlas-common.js`'s own `DATA_URL = "../data/comedy-atlas/..."`, written
 * from a page that lives directly at `site/comedy-atlas/*.html` — one
 * `..` to escape `comedy-atlas/` entirely). This module's assumed default
 * mount point is one level deeper than that (matching the CP5/CP6/CP7 test
 * harnesses' own `globe-harness-N` placement), so reaching the same
 * sibling `data/` directory needs one extra `..`. CP9's homepage mount is
 * one level shallower and MUST override this to `"../data/comedy-atlas/
 * search_index.json"` — exactly matching `atlas-common.js`'s own
 * constant — the same override CP9 already has to make for `cityHref`. */
const DEFAULT_SEARCH_INDEX_URL = '../../data/comedy-atlas/search_index.json';

/**
 * Copy for the data-unavailable state (Fable review #5). Kept as data, at
 * module scope, so a test can assert the two states say DIFFERENT things
 * without standing up a browser.
 *
 * 'error' = we could not load globe-cities.json.
 * 'empty' = we loaded it and it genuinely contains no cities.
 *
 * Both must read as a statement about US, never about the world. The defect
 * this replaces rendered the full chrome with "0 COUNTRIES / 0 VENUES", which
 * is a confident lie: it claims the world has no comedy in it.
 */
export const UNAVAILABLE_TEXT = {
  error: {
    title: "The globe's map data could not be loaded.",
    note: 'This is a problem on our side, not an empty world. Please try again, or browse the city list.',
  },
  empty: {
    title: 'No cities to show on the globe yet.',
    note: 'This is a gap in our data, not in the comedy world — browse the city list instead.',
  },
};

/**
 * Builds the data-unavailable node. `doc` is injected (not the global
 * `document`) so this is testable under plain `node --test` with a minimal
 * fake, exactly like the rest of this module's pure helpers.
 */
export function buildUnavailableNode(doc, kind, detail) {
  const copy = UNAVAILABLE_TEXT[kind] || UNAVAILABLE_TEXT.error;
  const wrap = doc.createElement('div');
  wrap.className = 'atlas-globe-unavailable';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  wrap.dataset.state = kind;

  const title = doc.createElement('p');
  title.className = 'atlas-globe-unavailable-title';
  title.textContent = copy.title;
  wrap.appendChild(title);

  const note = doc.createElement('p');
  note.className = 'atlas-globe-unavailable-note';
  note.textContent = copy.note;
  wrap.appendChild(note);

  const link = doc.createElement('a');
  link.className = 'atlas-globe-unavailable-link';
  link.href = '../cities/';
  link.textContent = 'Browse all cities';
  wrap.appendChild(link);

  // Machine-readable for our own diagnostics only — never rendered as a
  // number a reader could mistake for a fact about comedy.
  if (detail) wrap.dataset.detail = String(detail);
  return wrap;
}

const LABEL_STYLE_ID = 'atlas-globe-marker-label-styles';

/**
 * City name labels render as DOM overlay text (not baked into a canvas
 * texture) so they can use real CSS small-caps typography per the visual
 * target ("Labels sit to the RIGHT of the marker in cream small-caps, only
 * on prominent/hovered/selected cities"). `globe-chrome.css` is frozen for
 * this checkpoint, so — exactly like panel.js's own injectStylesOnce — one
 * small idempotent <style> block is injected into <head> the first time a
 * label is needed, scoped to its own class and reading only existing
 * `--atlas-globe-*` tokens.
 */
function injectLabelStylesOnce() {
  if (typeof document === 'undefined' || document.getElementById(LABEL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LABEL_STYLE_ID;
  style.textContent = `
.atlas-globe-labels-layer{position:absolute;inset:0;pointer-events:none;}
.atlas-globe-marker-label{
  position:absolute;pointer-events:none;
  font-size:10.5px;font-variant:small-caps;letter-spacing:.05em;
  color:var(--atlas-globe-cream,#f0f0f0);
  text-shadow:0 1px 4px rgba(0,0,0,.75);
  white-space:nowrap;transform:translate(0,-50%);
}
`;
  document.head.appendChild(style);
}

/**
 * "Near Me" (Fable finding #7, MED): the button previously rendered with no
 * onClick at all (`renderNearMe(el, {})`) — prominent, aria-labelled, and a
 * complete no-op. These helpers wire it to REAL geolocation and the SAME
 * city-selection path a marker click or search result already uses
 * (`selectCity`, which drives `controller.focusOnLatLng` + opens the detail
 * panel — see that function above), rather than inventing a parallel camera
 * or panel path.
 *
 * `findNearestCity` and `createNearMeHandler` are pure/DOM-free (no
 * `document`/`window` reference), and exported via `__internal` below so
 * they can be exercised directly in `node --test` without needing a WebGL
 * canvas — the same reason `defaultCityHref`/`supportsWebGL`/`slugFallback`/
 * `resolveAutoQuality` are already exposed that way.
 */
const EARTH_RADIUS_KM = 6371;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in km between two lat/lng points (haversine). */
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Comedy Atlas's globe payload is a curated set of comedy HUBS (dozens, not
 * thousands, of cities) — most points on Earth are legitimately far from
 * the nearest one. 400km (~a comfortable single day's travel) is the
 * "sensible radius" the finding calls for: close enough that "near me" is
 * still an honest claim, far enough that it isn't trivially empty for
 * every visitor outside a capital. Below this, "no city in range" is the
 * correct, honest answer — never a forced match to a city hours away.
 */
const NEAR_ME_MAX_KM = 400;

/**
 * @param {object[]} cities GlobeCity[] (data-adapter.js shape)
 * @param {number} lat
 * @param {number} lng
 * @param {number} [maxKm]
 * @returns {{city: object, distanceKm: number}|null}
 */
function findNearestCity(cities, lat, lng, maxKm) {
  const limit = typeof maxKm === 'number' && maxKm > 0 ? maxKm : NEAR_ME_MAX_KM;
  if (!Array.isArray(cities) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  for (const city of cities) {
    if (!city || !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) continue;
    const distanceKm = haversineKm(lat, lng, city.latitude, city.longitude);
    if (distanceKm > limit) continue;
    if (!best || distanceKm < best.distanceKm) best = { city, distanceKm };
  }
  return best;
}

/**
 * Builds the real "Near Me" onClick. Every branch calls `setStatus` with a
 * distinct, honest state (see legend.js's `NEAR_ME_STATUS_TEXT`) — there is
 * no path that silently does nothing, and no path that shows a "locating"
 * state that never resolves: `getCurrentPosition`'s own `timeout` guarantees
 * either the success or the error callback fires.
 *
 * This function itself never awaits anything and never blocks the caller —
 * geolocation is entirely callback-driven, so mounting the globe can never
 * be delayed by (or wait on) a location prompt the visitor may never answer.
 *
 * @param {{
 *   getGeolocation: () => ({getCurrentPosition: Function}|undefined|null),
 *   getCities: () => object[],
 *   focusCity: (id: string) => void,
 *   setStatus: (state: string|null) => void,
 *   maxDistanceKm?: number,
 * }} deps
 * @returns {(ev?: Event) => void}
 */
function createNearMeHandler(deps) {
  return function onNearMeClick() {
    const geolocation = deps.getGeolocation();
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      deps.setStatus('unsupported');
      return;
    }

    // Permissions API pre-check (2026-08-01): if the browser can tell us the
    // permission is ALREADY denied, say so immediately instead of calling
    // getCurrentPosition again. Browsers that remember a denial don't
    // re-show a system prompt on a second call -- they just fire the error
    // callback again -- so this isn't required for correctness, but it
    // avoids a pointless round trip and (on some browsers) a console
    // warning, and gets the honest message on screen faster. Support is
    // optional and best-effort: not every browser implements
    // navigator.permissions, and Safari in particular is inconsistent about
    // it, so absence of the API just falls through to the real request
    // below rather than being treated as an error.
    const permissions = deps.getPermissions ? deps.getPermissions() : null;
    if (permissions && typeof permissions.query === 'function') {
      permissions.query({ name: 'geolocation' }).then((status) => {
        if (status && status.state === 'denied') {
          deps.setStatus('denied');
          return;
        }
        requestPosition();
      }, requestPosition);
      return;
    }
    requestPosition();

    function requestPosition() {
    deps.setStatus('locating');
    geolocation.getCurrentPosition(
      (position) => {
        const coords = position && position.coords;
        const lat = coords && coords.latitude;
        const lng = coords && coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          deps.setStatus('unavailable');
          return;
        }
        const nearest = findNearestCity(deps.getCities(), lat, lng, deps.maxDistanceKm);
        if (!nearest) {
          deps.setStatus('none-in-range');
          return;
        }
        // Success: clear any prior status — the camera fly-to + opened
        // detail panel (via `focusCity` -> `selectCity`) ARE the visible
        // confirmation, so no redundant status text is shown.
        deps.setStatus(null);
        deps.focusCity(nearest.city.id);
      },
      (error) => {
        // GeolocationPositionError codes: 1 = PERMISSION_DENIED,
        // 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT. Each gets its own honest
        // state (2026-08-01: TIMEOUT used to be folded into 'unavailable' --
        // separated because "took too long" and "couldn't get a fix at all"
        // call for different next actions from the visitor).
        if (error && error.code === 1) {
          deps.setStatus('denied');
        } else if (error && error.code === 3) {
          deps.setStatus('timeout');
        } else {
          deps.setStatus('unavailable');
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
    }
  };
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch (_err) {
    return false;
  }
}

/**
 * CP10 perf: auto-selects earth.js's `quality` preset ("low" trims sphere
 * segment counts roughly 3x — see `QUALITY_PRESETS` in earth.js) for
 * devices that signal they are constrained, WITHOUT ever overriding an
 * explicit caller choice. `opts.quality` (an explicit `mount()` option)
 * always wins — this function is only consulted when the caller left it
 * unset, exactly like every other optional field in this module.
 *
 * Signals, each individually sufficient, all real browser-exposed
 * capability hints (never a UA-string guess):
 *   - `prefers-reduced-motion: reduce` — the same signal camera.js already
 *     honours for idle rotation; a visitor who asked for less motion is
 *     also a reasonable proxy for "give me a lighter render."
 *   - `navigator.hardwareConcurrency <= 4` — low core count, a real
 *     (if imperfect) low-power signal already exposed to all pages.
 *   - `navigator.deviceMemory <= 4` (Chrome-only; `undefined` elsewhere,
 *     which this check correctly ignores rather than treating as "low").
 * Never throws if a signal is unsupported in this browser.
 * @returns {"high"|"medium"|"low"}
 */
function resolveAutoQuality() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'low';
    }
  } catch (_err) {
    /* ignore */
  }
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  if (typeof cores === 'number' && cores > 0 && cores <= 4) return 'low';
  const memory = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
  if (typeof memory === 'number' && memory > 0 && memory <= 4) return 'low';
  return 'medium';
}

const SHELL_HTML = `
  <div class="atlas-globe-shell">
    <div class="atlas-globe-canvas-wrap" data-role="canvas-wrap"></div>
    <div class="atlas-globe-topbar">
      <div class="atlas-globe-brand">
        <div class="atlas-globe-brand-text">
          <span class="atlas-globe-brand-word">COMEDY ATLAS</span>
          <span class="atlas-globe-brand-sub">The world of stand-up comedy.</span>
        </div>
      </div>
      <div class="atlas-globe-search">
        <input type="text" aria-label="Search a comic, city, show, venue or festival"
               placeholder="Search a comic, city, show, venue or festival…">
      </div>
      <div class="atlas-globe-topnav"></div>
    </div>
    <fieldset class="atlas-globe-rail" data-role="rail" id="atlas-globe-rail-panel"></fieldset>
    <button type="button" class="atlas-globe-rail-compact" data-role="rail-compact"
            aria-haspopup="true" aria-expanded="false" aria-controls="atlas-globe-rail-panel">Layers</button>
    <button type="button" class="atlas-globe-recenter" data-role="recenter"
            aria-label="Recenter the globe on the world view">
      <span class="atlas-globe-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="8"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>
        </svg>
      </span>
    </button>
    <div class="atlas-globe-bottomleft">
      <div data-role="nearme"></div>
      <div class="atlas-globe-livecount" data-role="livecount"></div>
    </div>
    <div class="atlas-globe-legend-wrap" data-role="legend"></div>
    <div class="atlas-globe-panel-col" data-role="panel"></div>
    <fieldset class="atlas-globe-layers-bar" data-role="layers-bar"></fieldset>
  </div>
  <div class="atlas-globe-footer">
    <div class="atlas-globe-footer-left">
      <p class="atlas-globe-footer-kicker">Comedy Atlas</p>
      <p class="atlas-globe-footer-copy">Live stand-up comedy, mapped from real, verified sources.</p>
    </div>
    <div class="atlas-globe-footer-stats" data-role="footer-stats"></div>
  </div>
`;

/**
 * @param {HTMLElement} rootEl
 * @param {{
 *   dataUrl?: string,
 *   fetchImpl?: (url: string) => Promise<Response>,
 *   payload?: {cities: object[], excluded: object[], totals: object, generatedAt: string|null},
 *   cityHref?: (city: object) => string,
 *   quality?: "high"|"medium"|"low",
 *   searchIndexUrl?: string,
 *   assetBase?: string,
 * }} [options]
 *
 * `assetBase` (root-cause fix, post-CP9 integration): forwarded verbatim to
 * `earth.js`'s `createEarth(scene, {assetBase})`, which otherwise defaults
 * to the same "one directory level below site/comedy-atlas/" convention as
 * `cityHref`/`searchIndexUrl` above. CP9's homepage mount is one level
 * shallower and MUST override this to `"assets/globe/"` -- exactly the
 * same shallower-mount adjustment already documented for `cityHref` and
 * `searchIndexUrl`. Left unset, every existing test harness keeps its
 * current working default.
 * @returns {{destroy: () => void, selectCity: (id: string|null) => void, setLayer: (name: string, on: boolean) => void}}
 */
export function mount(rootEl, options) {
  const opts = options || {};
  const cityHref = typeof opts.cityHref === 'function' ? opts.cityHref : defaultCityHref;

  rootEl.innerHTML = '';
  rootEl.classList.add('atlas-globe-root');

  const loading = renderLoadingState(rootEl, { label: 'Loading the Comedy Atlas globe…' });

  let destroyed = false;
  let markers = null;
  let controller = null;
  let earth = null;
  let renderer = null;
  let sceneRef = null;
  let cameraRef = null;
  let rafHandle = null;
  let panelHandle = null;
  let sheetHandle = null; // CP8: mobile bottom sheet wrapping panelHandle's content
  let touchGuardHandle = null; // CP8: two-finger pinch-zoom guard (sheet.js)
  let railOverlayKeydownHandler = null; // CP8: document-level Escape handler, see buildChrome
  let onKeyDown = null; // Escape-to-deselect (2026-07-31 selection-lock work)
  let fallbackHandle = null;
  let selectorRail = null;
  let selectorBar = null;
  let liveCounterHandle = null;
  let footerStatsHandle = null;
  let nearMeHandle = null;
  let legendHandle = null;
  let searchHandle = null;
  let currentPayload = { cities: [], excluded: [], totals: { included: 0, excluded: 0 }, generatedAt: null };
  let selectedId = null;
  let activeLayerId = 'world';
  const layerState = new Map(DEFAULT_LAYERS.map((l) => [l.id, l.id === 'world']));

  function cleanupWebGL() {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    if (touchGuardHandle) touchGuardHandle.dispose();
    if (railOverlayKeydownHandler) {
      document.removeEventListener('keydown', railOverlayKeydownHandler);
      railOverlayKeydownHandler = null;
    }
    if (markers) markers.dispose();
    if (controller) controller.dispose();
    if (earth) earth.dispose();
    if (renderer) renderer.dispose();
    touchGuardHandle = null;
    markers = null;
    controller = null;
    earth = null;
    renderer = null;
  }

  function findCityById(id) {
    return currentPayload.cities.find((c) => c.id === id) || null;
  }

  /**
   * CP8: on a mobile viewport, panel.js's content (still built by
   * panel.js itself, untouched) is relocated into sheet.js's bottom sheet
   * instead of panel.js's own normal desktop in-flow placement — a real
   * DOM move, not a re-implementation. Desktop behaviour (`renderDetailPanel`
   * straight into `.atlas-globe-panel-col`) is completely unchanged from
   * CP6/CP7.
   */
  function openPanelFor(city) {
    const panelEl = rootEl.querySelector('[data-role="panel"]');
    if (!panelEl) return;
    if (sheetHandle) {
      sheetHandle.destroy();
      sheetHandle = null;
    }
    if (panelHandle) {
      panelHandle.destroy();
      panelHandle = null;
    }
    panelEl.innerHTML = '';
    if (!city) return;

    if (isMobileViewport()) {
      const contentHost = document.createElement('div');
      panelHandle = renderDetailPanel(contentHost, city, { cityHref, shows: [] });
      sheetHandle = mountBottomSheet(panelEl, contentHost, { initialState: 'partial' });
    } else {
      panelHandle = renderDetailPanel(panelEl, city, { cityHref, shows: [] });
    }
  }

  /**
   * Selects a city by its GlobeCity `id` (e.g. `"city-3"`), or clears the
   * selection when `id` is falsy. This is the exact behaviour a real
   * pointer click on a marker triggers internally (see `handleClick`
   * below) — exposed here so callers (including this checkpoint's own
   * e2e tests, standing in for "clicking Paris") can drive selection
   * without needing a synthetic mouse event.
   *
   * @param {string|null} id
   */
  function selectCity(id) {
    selectedId = id || null;
    if (markers) markers.setSelectedId(selectedId);
    if (controller) {
      const city = findCityById(selectedId);
      if (city) {
        // Locks the camera on arrival (camera.js `selectionLocked`). Before
        // this, the globe flew to the city and then immediately resumed the
        // idle spin, carrying the selected city off-screen while its panel
        // stayed open — the 2026-07-31 live bug.
        controller.focusOnLatLng(city.latitude, city.longitude);
      } else if (controller.clearSelectionLock) {
        // selectCity(null) is a real deselect: release the camera so the
        // world view can breathe again after the usual inactivity delay.
        controller.clearSelectionLock();
      }
    }
    openPanelFor(findCityById(selectedId));
  }

  /**
   * The explicit "I'm done with this city" gesture. Without this there was no
   * way to leave CITY_SELECTED_LOCKED at all — grep for a deselect path before
   * 2026-07-31 returns nothing, so the panel could be opened and never closed.
   */
  function clearSelection() {
    selectCity(null);
  }

  /**
   * Toggles a named layer (see legend.js's DEFAULT_LAYERS, annotated by
   * layers.js's buildLayerRegistry with real disabled/reason state). CP7:
   * activating a data layer (Shows Now / Venues / Festivals / Comics)
   * rebuilds the marker layer from `filterCitiesForLayer` — a real subset
   * of `currentPayload.cities`, never a fabricated one — so the rendered
   * marker count genuinely changes. "World" restores the full set.
   * Connections/History are structurally disabled by layers.js
   * (`filterCitiesForLayer` returns `[]` for them as a second guarantee
   * beyond the selector already refusing to activate a disabled item), so
   * toggling one honestly empties the globe rather than inventing content.
   *
   * @param {string} name
   * @param {boolean} on
   */
  // Re-entrancy guard. legend.js's setActive() notifies its own onChange
  // handler, and that handler is setLayer -- so a naive setLayer -> setActive
  // call re-enters setLayer immediately and recurses until the stack blows.
  // (This shipped briefly and took out three tests with
  // "Maximum call stack size exceeded" inside setLayer/onChange/setActive.)
  // The guard makes the direction of travel explicit: whoever calls first
  // owns the update, and the echo back from the selector is ignored.
  let applyingLayer = false;

  function setLayer(name, on) {
    if (!layerState.has(name)) return;
    if (applyingLayer) return; // echo from selector.setActive() -- already handled
    applyingLayer = true;
    try {
      applyLayer(name, on);
    } finally {
      applyingLayer = false;
    }
  }

  function applyLayer(name, on) {
    layerState.set(name, !!on);
    activeLayerId = on ? name : 'world';
    if (selectorRail) selectorRail.setActive(activeLayerId);

    if (!markers) return; // fallback mode, or not yet built — nothing to re-render
    const filtered = filterCitiesForLayer(currentPayload.cities, activeLayerId, {});
    markers.dispose();
    markers = createCityMarkerLayer(sceneRef, cameraRef, filtered, {
      getAltitude: () => controller.altitude(),
    });
    markers.setSelectedId(selectedId);
    // `_debug.markers` (see buildChrome's return value) is a plain object
    // property captured at mount time, not a live binding to the `markers`
    // variable above — update it here so tests/diagnostics that read
    // `handle._debug.markers` after a layer toggle see the REBUILT layer,
    // not the disposed one.
    if (handle._debug) handle._debug.markers = markers;
  }

  function attachPointerHandling(canvas, camera) {
    let downX = 0;
    let downY = 0;
    let downAt = 0;

    function ndcFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      };
    }

    function onMove(event) {
      if (!markers) return;
      const hit = markers.pickAtNDC(ndcFromEvent(event));
      markers.setHoveredId(hit ? hit.id : null);
      canvas.style.cursor = hit ? 'pointer' : '';
    }

    function onDown(event) {
      downX = event.clientX;
      downY = event.clientY;
      downAt = performance.now();
    }

    function onUp(event) {
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      const elapsed = performance.now() - downAt;
      // A real click (not the end of a drag-rotate): small movement, quick.
      if (moved > 6 || elapsed > 600 || !markers) return;
      const hit = markers.pickAtNDC(ndcFromEvent(event));
      selectCity(hit ? hit.id : null);
    }

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);

    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }

  function buildChrome() {
    loading.destroy();
    rootEl.innerHTML = SHELL_HTML;
    injectLabelStylesOnce();

    const resolvedQuality = opts.quality || resolveAutoQuality();
    // CP10 perf: the devicePixelRatio cap is itself a quality lever, not
    // just the sphere segment counts. A "low" quality device also gets a
    // tighter DPR cap (1x, i.e. no supersampling) rather than the
    // previously-unconditional 2x every device paid for regardless of
    // capability. This is the single biggest lever for GPU fill-rate cost
    // on the atmosphere/marker overdraw measured for this checkpoint (see
    // docs/COMEDY_ATLAS_GLOBE_IMPLEMENTATION.md's Performance section).
    const dprCap = resolvedQuality === 'low' ? 1 : 2;

    const canvasWrap = rootEl.querySelector('[data-role="canvas-wrap"]');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    const rect = canvasWrap.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 600;
    renderer.setSize(width, height);
    canvasWrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
    camera.__atlasGlobeCanvas = renderer.domElement;
    sceneRef = scene;
    cameraRef = camera;

    earth = createEarth(scene, { quality: resolvedQuality, assetBase: opts.assetBase });
    controller = createCameraController(camera, renderer, {});
    controller.resetToWorldView();

    markers = createCityMarkerLayer(scene, camera, currentPayload.cities, {
      getAltitude: () => controller.altitude(),
    });

    const detachPointer = attachPointerHandling(renderer.domElement, camera);
    // CP8: two-finger pinch-zoom, implemented entirely outside the frozen
    // camera.js — see sheet.js's own header comment for the capture-phase
    // mechanism. `canvasWrap` (the ancestor) is required, not `renderer.
    // domElement` itself, so this handler's capture-phase listener runs
    // strictly before camera.js's own target-phase listener on the canvas.
    touchGuardHandle = attachTouchGestureGuard(canvasWrap, renderer.domElement);

    const labelsLayer = document.createElement('div');
    labelsLayer.className = 'atlas-globe-labels-layer';
    canvasWrap.appendChild(labelsLayer);
    const labelEls = new Map();

    function syncLabels() {
      const entries = markers.getVisibleLabelEntries();
      const liveIds = new Set(entries.map((e) => e.id));
      for (const [id, el] of labelEls) {
        if (!liveIds.has(id)) {
          el.remove();
          labelEls.delete(id);
        }
      }
      entries.forEach((entry) => {
        let el = labelEls.get(entry.id);
        if (!el) {
          el = document.createElement('span');
          el.className = 'atlas-globe-marker-label';
          labelsLayer.appendChild(el);
          labelEls.set(entry.id, el);
        }
        el.textContent = entry.text;
        el.style.left = entry.x + 10 + 'px';
        el.style.top = entry.y + 'px';
      });
    }

    function animate() {
      controller.update();
      markers.update();
      syncLabels();
      renderer.render(scene, camera);
      rafHandle = requestAnimationFrame(animate);
    }
    animate();

    const railEl = rootEl.querySelector('[data-role="rail"]');
    const barEl = rootEl.querySelector('[data-role="layers-bar"]');
    // CP7: the registry is legend.js's own DEFAULT_LAYERS, only ANNOTATED
    // with real disabled/reason state (layers.js's buildLayerRegistry) —
    // one controller (createLayerSelector), one list of layers, per the
    // plan's explicit "do not create a second source of truth."
    const annotatedLayers = buildLayerRegistry(DEFAULT_LAYERS, currentPayload.cities);
    const selector = createLayerSelector(annotatedLayers, {
      activeId: 'world',
      onChange: (id) => setLayer(id, true),
    });
    selector.mount(railEl, { variant: 'rail' });
    selector.mount(barEl, { variant: 'bar' });
    selectorRail = selector;
    selectorBar = selector;

    // CP8: recenter control — always reachable, no matter the current
    // camera/zoom/focus state. Calls the same real controller.resetToWorldView()
    // CP5 already built and CP9's homepage flag-off/flag-on paths both use.
    const recenterBtn = rootEl.querySelector('[data-role="recenter"]');
    if (recenterBtn) {
      // Recentring is also the DESELECT gesture. resetToWorldView() alone
      // released the camera lock but left the city panel open, which reads as
      // "still selected" while the globe spins away — the same incoherence in
      // a different place. clearSelection() drops the marker selection, closes
      // the panel and releases the lock; resetToWorldView() then flies out.
      recenterBtn.addEventListener('click', () => {
        clearSelection();
        controller.resetToWorldView();
      });
    }

    // Escape is the conventional "close this" key and costs nothing to honour.
    // Without it, keyboard users had no deselect path at all.
    onKeyDown = (ev) => {
      if (ev.key === 'Escape' && selectedId) {
        clearSelection();
        controller.resetToWorldView();
      }
    };
    rootEl.ownerDocument.addEventListener('keydown', onKeyDown);

    // CP8: the compact "Layers" button reveals the SAME rail (one
    // createLayerSelector instance, per legend.js's own header comment —
    // never a second control surface) as a temporary overlay on mobile,
    // rather than doing nothing (its pre-CP8 state). Toggled via a plain
    // data attribute so globe-chrome.css owns all the actual positioning.
    const railCompactBtn = rootEl.querySelector('[data-role="rail-compact"]');
    if (railCompactBtn && railEl) {
      const closeRailOverlay = () => {
        railEl.removeAttribute('data-mobile-open');
        railCompactBtn.setAttribute('aria-expanded', 'false');
      };
      railCompactBtn.addEventListener('click', () => {
        const isOpen = railEl.getAttribute('data-mobile-open') === 'true';
        if (isOpen) {
          closeRailOverlay();
        } else {
          railEl.setAttribute('data-mobile-open', 'true');
          railCompactBtn.setAttribute('aria-expanded', 'true');
        }
      });
      // Escape closes the overlay — keyboard parity with a tap outside it.
      // Bound at `document` level (not on railEl itself): focus stays on
      // the compact BUTTON after the click/tap that opened the overlay
      // (native <button> behaviour), so a keydown listener scoped to
      // railEl — a sibling, not an ancestor of the focused button — would
      // never receive it. Only acts while the overlay is actually open.
      railOverlayKeydownHandler = (ev) => {
        if (ev.key === 'Escape' && railEl.getAttribute('data-mobile-open') === 'true') {
          closeRailOverlay();
          railCompactBtn.focus();
        }
      };
      document.addEventListener('keydown', railOverlayKeydownHandler);
      // Selecting a layer from the mobile overlay closes it automatically
      // (matches the mockup's own "pick one, overlay dismisses" behaviour)
      // rather than leaving a 7-item panel sitting over the globe after a
      // choice has already been made.
      railEl.addEventListener('change', () => {
        if (railEl.getAttribute('data-mobile-open') === 'true') closeRailOverlay();
      });
    }

    legendHandle = renderLegend(rootEl.querySelector('[data-role="legend"]'));
    footerStatsHandle = renderFooterStats(rootEl.querySelector('[data-role="footer-stats"]'), currentPayload);
    // CP7: legend.js's own renderLiveCounter renders an explanatory string
    // (not a literal digit) at zero — see layers.js's header comment on
    // renderShowsNowCounter for why this checkpoint's binding instruction
    // (a literal, visible "0") is satisfied by a dedicated renderer instead
    // of editing the frozen legend.js file.
    liveCounterHandle = renderShowsNowCounter(rootEl.querySelector('[data-role="livecount"]'), currentPayload.cities, {});
    // Fable finding #7 (MED): this used to be `renderNearMe(el, {})` — no
    // onClick, a dead button despite being prominent and aria-labelled. Now
    // wired to real geolocation + the SAME `selectCity` path a marker click
    // or search result uses (see `createNearMeHandler`'s header comment).
    // `setNearMeStatus` closes over `nearMeHandle` (assigned two lines
    // below) rather than capturing it now, so it always reaches the live
    // handle by the time a click can actually happen.
    const setNearMeStatus = (state) => {
      if (nearMeHandle) nearMeHandle.setStatus(state);
    };
    const nearMeOnClick = createNearMeHandler({
      getGeolocation: () => (typeof navigator !== 'undefined' ? navigator.geolocation : undefined),
      getPermissions: () => (typeof navigator !== 'undefined' ? navigator.permissions : undefined),
      getCities: () => currentPayload.cities,
      focusCity: (id) => selectCity(id),
      setStatus: setNearMeStatus,
    });
    nearMeHandle = renderNearMe(rootEl.querySelector('[data-role="nearme"]'), {
      onClick: nearMeOnClick,
      // "Search a city instead" (2026-08-01): a Near Me dead end must not be
      // a dead end. Focuses the same search input a marker click or manual
      // search already uses -- no parallel UI, just moves focus into it.
      onSearchInstead: () => {
        const input = rootEl.querySelector('.atlas-globe-search input');
        if (input) input.focus();
      },
    });

    const searchInputEl = rootEl.querySelector('.atlas-globe-search input');
    if (searchInputEl) {
      searchHandle = mountGlobeSearch(searchInputEl, {
        fetchImpl: opts.fetchImpl || ((...args) => fetch(...args)),
        indexUrl: opts.searchIndexUrl || DEFAULT_SEARCH_INDEX_URL,
        getCities: () => currentPayload.cities,
        onSelectCity: (id) => selectCity(id),
        onSelectRecord: (_record, city) => {
          if (city) selectCity(city.id);
        },
      });
    }

    // Diagnostic-only handle, additive beyond the plan's required return
    // shape (mirrors camera.js's rotationState() / markers.js's own
    // getRenderedMarkerCount() precedent) — lets tests assert on real
    // internal state instead of only DOM side-effects.
    return {
      _debug: {
        scene, camera, renderer, earth, controller, markers, detachPointer,
        resolvedQuality,
      },
    };
  }

  /**
   * Honest terminal state for "there is no globe to draw" (Fable review #5).
   *
   * The failure this exists to prevent: when `globe-cities.json` is missing,
   * the old code rendered the FULL chrome — legend, layers bar, live counter —
   * reading "0 COUNTRIES / 0 VENUES". That is indistinguishable from a
   * confidently-reported truth that the world contains no comedy. A missing
   * file is OUR problem and must be shown as ours, never as a fact about the
   * world. Same rule as this repo's /health lesson: bad news goes in a field
   * you can read, not into a silently-plausible zero.
   *
   * `kind` is 'error' (we could not load the data) or 'empty' (we loaded it
   * and it genuinely contains no cities) — deliberately different messages,
   * because they call for different action from whoever sees them.
   */
  function mountDataUnavailable(kind, detail) {
    rootEl.innerHTML = '';
    rootEl.classList.add('atlas-globe-root');
    const wrap = buildUnavailableNode(document, kind, detail);
    rootEl.appendChild(wrap);
    return wrap;
  }

  function afterPayloadReady() {
    if (destroyed) return;
    const cityCount = (currentPayload && Array.isArray(currentPayload.cities))
      ? currentPayload.cities.length
      : 0;
    if (cityCount === 0) {
      // Never fall through to buildChrome() with an empty dataset — that is
      // the "0 COUNTRIES / 0 VENUES" render Fable #5 caught. `loadError` (set
      // by loadGlobeCities) is what separates "we could not fetch it" from
      // "we fetched it and the world is genuinely empty"; without it a 404
      // would be reported to the reader as a gap in comedy rather than a bug
      // in us.
      const loadError = currentPayload && currentPayload.loadError;
      mountDataUnavailable(loadError ? 'error' : 'empty', loadError || null);
      return;
    }
    if (!supportsWebGL()) {
      const fallbackRoot = document.createElement('div');
      rootEl.innerHTML = '';
      rootEl.appendChild(fallbackRoot);
      fallbackHandle = mountGlobeFallback(fallbackRoot, currentPayload, {
        cityHref,
        reason: 'WebGL is not available in this browser — showing the full city list instead.',
      });
      return;
    }
    const built = buildChrome();
    handle._debug = built._debug;
  }

  const handle = {
    selectCity,
    setLayer,
    clearSelection,
    destroy() {
      destroyed = true;
      if (onKeyDown) {
        rootEl.ownerDocument.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
      }
      cleanupWebGL();
      if (sheetHandle) sheetHandle.destroy();
      if (panelHandle) panelHandle.destroy();
      if (fallbackHandle) fallbackHandle.destroy();
      if (selectorRail) selectorRail.destroy();
      if (legendHandle) legendHandle.destroy();
      if (footerStatsHandle) footerStatsHandle.destroy();
      if (liveCounterHandle) liveCounterHandle.destroy();
      if (nearMeHandle) nearMeHandle.destroy();
      if (searchHandle) searchHandle.destroy();
      rootEl.innerHTML = '';
      rootEl.classList.remove('atlas-globe-root');
    },
  };

  if (opts.payload) {
    currentPayload = parseGlobePayload(opts.payload);
    afterPayloadReady();
  } else {
    loadGlobeCities({
      url: opts.dataUrl,
      fetchImpl: opts.fetchImpl || ((...args) => fetch(...args)),
    }).then((payload) => {
      currentPayload = payload;
      afterPayloadReady();
    }).catch((err) => {
      // Fable review #5: this .catch() did not exist. A missing or malformed
      // globe-cities.json produced an unhandled rejection, afterPayloadReady()
      // never ran, and the page sat there showing chrome with zeroes in it.
      if (destroyed) return;
      mountDataUnavailable('error', err && err.message);
    });
  }

  return handle;
}

export const __internal = {
  defaultCityHref,
  supportsWebGL,
  slugFallback,
  resolveAutoQuality,
  haversineKm,
  findNearestCity,
  createNearMeHandler,
  NEAR_ME_MAX_KM,
  buildUnavailableNode,
  UNAVAILABLE_TEXT,
};
