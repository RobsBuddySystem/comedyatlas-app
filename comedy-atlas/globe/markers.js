/**
 * COMEDY ATLAS — Interactive Globe: city marker layer
 * (site/comedy-atlas/globe/markers.js)
 *
 * CHECKPOINT 6 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * Custom instanced-style markers — concentric glowing rings (a bright warm
 * core dot, a thin ring, and a soft radial glow bleeding outward), NEVER a
 * standard map pin. Built directly on vendored three.js `Sprite`s, each
 * textured with a small canvas-drawn radial composition (cheap: the canvas
 * textures are generated once per distinct colour/tier combination and
 * cached, not per marker).
 *
 * HARD INTEGRATION CONTRACTS honoured here:
 *   - Placement: `latLngToVector3`, imported from earth.js, NOT re-derived.
 *   - Size/colour: `markerScale` / `markerTier` / `markerColorToken`,
 *     imported from activity.js. This module never recomputes an activity
 *     score — it only maps the already-computed [0,1] score to pixels and
 *     a colour token name, exactly as CP3 intended.
 *   - LOD/clustering: `lodTier` / `clusterCities` / `selectLabels`,
 *     imported from cluster.js, driven by `camera.js`'s `altitude()`
 *     (the two were verified in CP5 to agree on units).
 *
 * Colour mapping (documented deviation, not silent): the approved mockup's
 * legend calls for gold=hub / orange=active-scene / red=live / violet=
 * festival-ring / cream=selected / muted=partial-community. CP3's already-
 * shipped `activity.markerColorToken()` maps the "active" tier to
 * `--atlas-globe-amber`, not `--atlas-globe-orange` (TIER_TOKENS in
 * activity.js). Per the plan's hard rule "Use them for marker size/colour
 * ... do NOT recompute activity scores in JS", this module uses
 * `markerColorToken()` verbatim for the marker's BASE colour (gold / amber
 * / ember / muted), and layers live/festival/selected as colour OVERLAYS
 * (a red base + pulse when genuinely live, a violet ring when the city has
 * a real festivalCount, a cream ring when selected) rather than
 * reimplementing CP3's tier->colour table with a fourth "orange" branch.
 *
 * `--atlas-globe-ember` is referenced by activity.js's TIER_TOKENS for the
 * "emerging" tier, but globe-tokens.css (CP4, frozen, not touched here)
 * never defines that custom property — an existing gap between CP3 and
 * CP4, not introduced here. This module supplies its own visually-sane
 * fallback (see TOKEN_FALLBACKS) so an undefined token never renders as
 * transparent/black, exactly mirroring earth.js's readToken "missing token
 * -> fallback, never a crash" pattern.
 *
 * BUGFIX (2026-07-31, follow-up to CP6/CP7/CP8 — "markers do not hold a
 * constant screen size as you zoom"). Markers used to be sized ONCE, at
 * construction, in WORLD units (`WORLD_UNITS_PER_PX * markerScale(...)`)
 * and left there. A `THREE.Sprite` with the default `sizeAttenuation: true`
 * projects a fixed-world-size object through normal perspective — exactly
 * like a real building on the ground, it subtends a LARGER angle (and so
 * more screen pixels) the closer the camera gets. Zooming from world view
 * to city-focus altitude (camera.js's CITY_FOCUS_ALTITUDE, ~4x closer than
 * the default world-view altitude) therefore inflated every marker by
 * roughly the same factor the camera moved — at city zoom the concentric
 * glow/ring/core composition ballooned to hundreds of screen pixels and
 * swallowed the coastline behind it. `markerScale()` is documented in
 * PIXELS (MARKER_SCALE_MIN_PX/MAX_PX), so pixels were always the intent.
 *
 * FIX: markers now subtend a constant SCREEN size at every zoom level.
 * `sizeAttenuation: true` is kept (unchanged materials contract, and it is
 * what makes a marker on the far/near side of a tilted view still read as
 * "the same object" rather than snapping oddly) — instead, every frame
 * (`recomputeMarkerSizes`, called from `update()`) each sprite's WORLD-SPACE
 * scale is recomputed from the camera's REAL current distance to that
 * marker and its REAL vertical FOV, so that after three.js's own
 * distance-based perspective attenuation the resulting on-screen size is
 * the constant, documented `markerScale()` pixel value regardless of
 * altitude. This is the standard "billboard held to a fixed pixel size"
 * technique — screenPx = worldSize / distance * k(fov, viewportHeight), so
 * setting worldSize = desiredPx * distance / k(fov, viewportHeight) makes
 * screenPx == desiredPx for any distance. Verified with a real per-frame
 * screen-pixel measurement in tests/test_globe_e2e.py, not just asserted.
 */

import * as THREE from '../vendor/three/three.module.js';
import { latLngToVector3, readToken } from './earth.js';
import { markerScale, markerTier, markerColorToken, MARKER_TIER_HUB_MIN } from './activity.js';
import { lodTier, clusterCities, selectLabels } from './cluster.js';

/** Fallback vertical FOV (degrees) used only if a camera without a finite
 * `.fov` is ever passed in (defensive — every real caller in this codebase
 * constructs a `THREE.PerspectiveCamera(45, ...)`, see experience.js and
 * the e2e test harnesses). Matches camera.js's own REFERENCE_FOV_DEG. */
const FALLBACK_FOV_DEG = 45;

/** Extra multiplier applied only to hub-tier markers' glow radius, so major
 * hubs get a "wider glow" per the visual target, beyond simple linear
 * scaling from markerScale() -- kept modest so a hub's glow reads as
 * "noticeably larger", not so large it visually swallows a genuinely
 * distinct neighbouring city a realistic ~100km+ away (tuned by inspecting
 * a real screenshot: an earlier, much larger value made two cities ~130km
 * apart look like one blob at a normal city-focus zoom). This now scales
 * the TARGET PIXEL size, not a world-space size, so the "wider glow" holds
 * at every zoom level rather than only at the altitude it was tuned at. */
const HUB_GLOW_BOOST = 1.2;

/** Multiplier applied to a marker's constant-pixel target size to size its
 * festival/selection overlay rings, so they read as concentric rings around
 * the base marker at ANY zoom level (previously a multiple of a world-space
 * size that itself no longer exists). */
const FESTIVAL_RING_SCALE = 1.22;
const SELECTION_RING_SCALE = 1.4;

const TOKEN_FALLBACKS = {
  '--atlas-globe-gold': '#c9a84c',
  '--atlas-globe-amber': '#e8c96a',
  '--atlas-globe-ember': '#b8632f',
  '--atlas-globe-muted': '#8899aa',
  '--atlas-globe-live': '#c41e3a',
  '--atlas-globe-violet': '#8a5cf6',
  '--atlas-globe-selected': '#f0f0f0',
};

function tokenColor(name) {
  return readToken(name, TOKEN_FALLBACKS[name] || '#ffffff');
}

/* ------------------------------------------------------------------ */
/* Canvas-drawn marker textures — core dot + ring + glow, cached        */
/* ------------------------------------------------------------------ */

const TEXTURE_SIZE = 128;
const textureCache = new Map();

/**
 * Draws one marker composition — a soft outward glow, a thin ring, and a
 * bright core dot — onto an offscreen canvas and returns a cached
 * `THREE.CanvasTexture`. Cached by a string key so the same colour/variant
 * combination is only rasterized once no matter how many cities share it.
 */
function getMarkerTexture(coreHex, ringHex, { hubRing = false } = {}) {
  const key = `${coreHex}|${ringHex}|${hubRing}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const c = TEXTURE_SIZE / 2;

  // 1. Soft outward glow.
  const glowRadius = hubRing ? c * 0.88 : c * 0.72;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, glowRadius);
  glow.addColorStop(0, hexWithAlpha(coreHex, 0.42));
  glow.addColorStop(0.55, hexWithAlpha(coreHex, 0.16));
  glow.addColorStop(1, hexWithAlpha(coreHex, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // 2. Faint outer pulse ring — hub markers only, static base; the actual
  // pulsing ANIMATION is a separate sprite (see attachPulseRing) so it can
  // scale/fade over time without re-rasterizing this cached texture.
  if (hubRing) {
    ctx.beginPath();
    ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = hexWithAlpha(coreHex, 0.25);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 3. Thin ring.
  ctx.beginPath();
  ctx.arc(c, c, c * 0.34, 0, Math.PI * 2);
  ctx.strokeStyle = hexWithAlpha(ringHex, 0.9);
  ctx.lineWidth = 3;
  ctx.stroke();

  // 4. Bright core dot, with a subtle inner highlight so it reads as a
  // warm light source rather than a flat disc.
  const coreRadius = c * 0.16;
  const core = ctx.createRadialGradient(c, c, 0, c, c, coreRadius);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.35, coreHex);
  core.addColorStop(1, coreHex);
  ctx.beginPath();
  ctx.arc(c, c, coreRadius, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

/** A thin ring-only texture (transparent centre) used for the selection
 * and festival overlay rings, which sit at a larger scale around the base
 * marker sprite rather than replacing it. */
const ringTextureCache = new Map();
function getRingTexture(hex) {
  if (ringTextureCache.has(hex)) return ringTextureCache.get(hex);
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const c = TEXTURE_SIZE / 2;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = hexWithAlpha(hex, 0.85);
  ctx.lineWidth = 3;
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  ringTextureCache.set(hex, texture);
  return texture;
}

function hexWithAlpha(hex, alpha) {
  const color = new THREE.Color(hex);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ------------------------------------------------------------------ */
/* Per-city marker record                                              */
/* ------------------------------------------------------------------ */

/** Resolves the base core/ring colour hexes for one city, honouring the
 * documented colour-mapping deviation above: activity.js's tier/verification
 * colour is the base, live overrides to red, festival adds a violet ring
 * overlay, selection adds a cream ring overlay.
 *
 * `city.activeShowCount` means exactly what it says: shows genuinely
 * in progress right now (see scripts/globe_data/build.py's computation,
 * gated on a real timezone + a real starts_at within the documented
 * default-show-duration window) — NOT the total upcoming count. It is
 * correct and expected for this to be 0 for almost every city almost all
 * of the time; do not "fix" a mostly-gold globe by widening this. */
function resolveCityColors(city) {
  const isLive = Number(city && city.activeShowCount) > 0;
  const baseTokenName = markerColorToken(city);
  const baseHex = isLive ? tokenColor('--atlas-globe-live') : tokenColor(baseTokenName);
  return {
    coreHex: baseHex,
    ringHex: baseHex,
    isLive,
    isFestival: Number(city && city.festivalCount) > 0,
    isHub: markerTier(city) === 'hub',
  };
}

/** Vertical FOV of `camera`, in radians, falling back to `FALLBACK_FOV_DEG`
 * if the camera has no finite `.fov` (defensive only — see comment above). */
function verticalFovRadians(camera) {
  const fov = camera && Number.isFinite(camera.fov) ? camera.fov : FALLBACK_FOV_DEG;
  return THREE.MathUtils.degToRad(fov);
}

/**
 * The core of the constant-screen-size fix. Computes the WORLD-SPACE sprite
 * scale (full width/height, in the globe's unit-radius world units) that
 * will render as exactly `desiredPx` CSS pixels on screen for a sprite at
 * `worldPosition`, given `camera`'s REAL current distance to that position
 * and its REAL vertical FOV.
 *
 * Why this works: a `THREE.Sprite` with `sizeAttenuation: true` (three.js's
 * default, unchanged here) renders a world-space size `s` at distance `d`
 * as approximately `screenPx = s / (2 * d * tan(fov/2)) * viewportHeightPx`
 * — standard perspective attenuation, the same reason a real-world object
 * looks smaller far away. Solving that same equation for `s` given a
 * TARGET `screenPx` makes the result `s = desiredPx * 2 * d * tan(fov/2) /
 * viewportHeightPx` — i.e. exactly proportional to distance. Feeding that
 * `s` back through the sprite's own distance-based attenuation cancels the
 * distance term out again, so the RENDERED screen size is `desiredPx`
 * regardless of how close or far the camera is. Called fresh every frame
 * (see `recomputeMarkerSizes` below) because `d` changes continuously as
 * the user zooms.
 *
 * @param {import('../vendor/three/three.module.js').PerspectiveCamera} camera
 * @param {import('../vendor/three/three.module.js').Vector3} worldPosition
 * @param {number} desiredPx
 * @param {number} viewportHeightPx
 * @returns {number}
 */
function worldSizeForScreenPixels(camera, worldPosition, desiredPx, viewportHeightPx) {
  const distance = camera.position.distanceTo(worldPosition);
  const worldHeightAtDistance = 2 * distance * Math.tan(verticalFovRadians(camera) / 2);
  const heightPx = viewportHeightPx > 0 ? viewportHeightPx : 700;
  return desiredPx * (worldHeightAtDistance / heightPx);
}

function buildCityMarker(city, camera, viewportHeightPx) {
  const colors = resolveCityColors(city);
  const texture = getMarkerTexture(colors.coreHex, colors.ringHex, { hubRing: colors.isHub });
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = `atlas-globe-marker-${city.id}`;

  const scorePx = markerScale(Number.isFinite(city.activityScore) ? city.activityScore : 0);
  const boostedRadiusPx = colors.isHub ? scorePx * HUB_GLOW_BOOST : scorePx;
  // markerScale() is documented as a RADIUS in px; sprite scale is the full
  // width/height (diameter). This is the CONSTANT target this marker holds
  // at every zoom level — never recomputed from activityScore again after
  // this point, only reprojected into world units per-frame.
  const basePxDiameter = boostedRadiusPx * 2;

  const position = latLngToVector3(city.latitude, city.longitude, 1.001);
  sprite.position.copy(position);

  const initialWorldSize = worldSizeForScreenPixels(camera, position, basePxDiameter, viewportHeightPx);
  sprite.scale.set(initialWorldSize, initialWorldSize, 1);

  const record = {
    city,
    sprite,
    material,
    texture,
    colors,
    basePxDiameter,
    baseWorldSize: initialWorldSize, // recomputed every frame in recomputeMarkerSizes()
  };

  // Festival overlay ring (violet), slightly larger than the base marker,
  // per the legend: "violet ring = festival". Sized to the SAME constant
  // pixel target (scaled up), not a multiple of a world-space size.
  let festivalRing = null;
  if (colors.isFestival) {
    const ringTex = getRingTexture(tokenColor('--atlas-globe-violet'));
    const ringMat = new THREE.SpriteMaterial({ map: ringTex, transparent: true, depthWrite: false, sizeAttenuation: true });
    festivalRing = new THREE.Sprite(ringMat);
    const ringSize = worldSizeForScreenPixels(camera, position, basePxDiameter * FESTIVAL_RING_SCALE, viewportHeightPx);
    festivalRing.scale.set(ringSize, ringSize, 1);
    festivalRing.position.copy(position);
    record.festivalRing = festivalRing;
  }

  // Selection overlay ring (cream), hidden until this city is selected.
  const selTex = getRingTexture(tokenColor('--atlas-globe-selected'));
  const selMat = new THREE.SpriteMaterial({ map: selTex, transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0 });
  const selectionRing = new THREE.Sprite(selMat);
  const selSize = worldSizeForScreenPixels(camera, position, basePxDiameter * SELECTION_RING_SCALE, viewportHeightPx);
  selectionRing.scale.set(selSize, selSize, 1);
  selectionRing.position.copy(position);
  selectionRing.visible = false;
  record.selectionRing = selectionRing;

  return record;
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_err) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Public: the city marker layer                                       */
/* ------------------------------------------------------------------ */

/**
 * @param {import('../vendor/three/three.module.js').Scene} scene
 * @param {import('../vendor/three/three.module.js').Camera} camera
 * @param {object[]} cities  GlobeCity[] (already parsed by data-adapter.js)
 * @param {{
 *   getAltitude: () => number,
 *   minPixelSeparation?: number,
 *   maxLabels?: number,
 *   onHoverChange?: (city: object|null) => void,
 *   onSelectChange?: (city: object|null) => void,
 * }} options
 */
export function createCityMarkerLayer(scene, camera, cities, options) {
  const opts = options || {};
  const getAltitude = typeof opts.getAltitude === 'function' ? opts.getAltitude : () => 2.2;
  const minPixelSeparation = typeof opts.minPixelSeparation === 'number' ? opts.minPixelSeparation : 34;
  const maxLabels = typeof opts.maxLabels === 'number' ? opts.maxLabels : 6;
  const onHoverChange = typeof opts.onHoverChange === 'function' ? opts.onHoverChange : () => {};
  const onSelectChange = typeof opts.onSelectChange === 'function' ? opts.onSelectChange : () => {};

  const root = new THREE.Group();
  root.name = 'atlas-globe-city-markers';
  scene.add(root);

  function currentViewport() {
    const canvas = camera && camera.__atlasGlobeCanvas;
    if (canvas) return { width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height };
    return { width: 900, height: 700 };
  }

  const initialViewportHeight = currentViewport().height;

  const records = (Array.isArray(cities) ? cities : [])
    .filter((c) => c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
    .map((city) => buildCityMarker(city, camera, initialViewportHeight));

  records.forEach((r) => {
    root.add(r.sprite);
    if (r.festivalRing) root.add(r.festivalRing);
    root.add(r.selectionRing);
  });

  let selectedId = null;
  let hoveredId = null;
  let clock = 0;
  const reducedMotion = prefersReducedMotion();

  /** Screen-space projection of a city's 3D position, used by cluster.js's
   * `project` callback and by tests that need to click/hover a real screen
   * point. Returns null if the city is on the far side of the globe. */
  function projectToScreen(record, viewportWidth, viewportHeight) {
    const v = record.sprite.position.clone().project(camera);
    if (v.z > 1) return null; // behind camera / far side, cheap reject
    return {
      x: (v.x * 0.5 + 0.5) * viewportWidth,
      y: (-v.y * 0.5 + 0.5) * viewportHeight,
    };
  }

  // A cluster has no single city's lat/lng of its own (cluster.js works in
  // screen space only) — it is rendered at its DOMINANT member's real 3D
  // position (highest activityScore in the group) using a reusable pool of
  // sprites, so a cluster is never an invisible gap on the globe at world
  // view. Pool is sized once to the max possible number of simultaneous
  // clusters (never more clusters than cities).
  const clusterSpritePool = [];
  function ensureClusterSprite(i) {
    if (clusterSpritePool[i]) return clusterSpritePool[i];
    const tex = getMarkerTexture(tokenColor('--atlas-globe-gold'), tokenColor('--atlas-globe-gold'), { hubRing: true });
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    sprite.name = 'atlas-globe-cluster-marker';
    sprite.visible = false;
    root.add(sprite);
    clusterSpritePool[i] = sprite;
    return sprite;
  }

  /**
   * Recomputes which markers are visible as singles vs. clustered at the
   * current LOD tier, positions the cluster sprites at their dominant
   * member's real coordinates, and picks which entries (singles AND
   * clusters) get a text label. Called once per frame from `update()`.
   * This is what makes densely-packed cities resolve into one cluster
   * blob at world view and separate out again on zoom, per CP6 Step 2 —
   * verified by the e2e test that switches LOD tiers and re-counts
   * rendered markers.
   */
  function recomputeVisibility() {
    const { width, height } = currentViewport();
    const tier = lodTier(getAltitude());

    const projectable = records
      .map((r) => ({ record: r, point: projectToScreen(r, width, height) }))
      .filter((entry) => entry.point !== null);

    const cityLikeInputs = projectable.map((entry) => entry.record.city);
    const projectFn = (city) => {
      const entry = projectable.find((e) => e.record.city === city);
      return entry ? entry.point : { x: -99999, y: -99999 };
    };

    const { clusters, singles } = clusterCities(cityLikeInputs, {
      tier,
      project: projectFn,
      minPixelSeparation,
    });

    const clusteredIds = new Set();
    clusters.forEach((cl) => cl.cities.forEach((c) => clusteredIds.add(c.id)));

    records.forEach((r) => {
      const isClusteredAway = clusteredIds.has(r.city.id);
      const stillOnFrontFace = projectable.some((e) => e.record === r);
      r.sprite.visible = stillOnFrontFace && !isClusteredAway;
      if (r.festivalRing) r.festivalRing.visible = r.sprite.visible;
      r.selectionRing.visible = r.sprite.visible && r.city.id === selectedId;
    });

    const labelCandidates = singles.map((c) => {
      const pt = projectFn(c);
      return { id: c.id, score: c.activityScore, x: pt.x, y: pt.y, text: c.name };
    });

    clusters.forEach((cl, i) => {
      const dominant = cl.cities.reduce(
        (best, c) => ((c.activityScore || 0) > (best.activityScore || 0) ? c : best),
        cl.cities[0],
      );
      const sprite = ensureClusterSprite(i);
      const pos = latLngToVector3(dominant.latitude, dominant.longitude, 1.001);
      sprite.position.copy(pos);
      // Same constant-screen-size treatment as single markers (see
      // worldSizeForScreenPixels above): the desired PIXEL diameter is
      // computed once from the dominant city's score + the cluster-size
      // boost, then reprojected into world units using the camera's
      // CURRENT real distance to this cluster's position, every frame —
      // so a cluster marker holds its size on screen exactly like a single
      // marker does, at any zoom level.
      const scorePx = markerScale(Number.isFinite(dominant.activityScore) ? dominant.activityScore : 0);
      const boost = 1 + Math.min(cl.cities.length, 6) * 0.08;
      const desiredPxDiameter = scorePx * 2 * boost;
      const size = worldSizeForScreenPixels(camera, pos, desiredPxDiameter, height);
      sprite.scale.set(size, size, 1);
      sprite.visible = true;
      labelCandidates.push({
        id: cl.id,
        score: dominant.activityScore,
        x: cl.x,
        y: cl.y,
        text: cl.cities.length > 1 ? `${dominant.name} +${cl.cities.length - 1}` : dominant.name,
      });
    });
    for (let i = clusters.length; i < clusterSpritePool.length; i += 1) {
      clusterSpritePool[i].visible = false;
    }

    // Label selection: entries scored by activityScore, always including
    // hover/selection (CP3's documented guarantee). Clusters participate
    // too, so world view — where most cities ARE clustered — still shows
    // real, readable labels instead of none at all.
    const chosenIds = selectLabels(
      labelCandidates.map((c) => ({ id: c.id, score: c.score })),
      { maxLabels, hoveredId, selectedId },
    );
    const labelEntries = labelCandidates.filter((c) => chosenIds.has(c.id));

    return { tier, singles, clusters, labelEntries, viewport: { width, height } };
  }

  let lastVisibility = { tier: 'world', singles: [], clusters: [], labelEntries: [], viewport: { width: 0, height: 0 } };

  function update(dtSeconds) {
    lastVisibility = recomputeVisibility();

    if (!reducedMotion) {
      clock += typeof dtSeconds === 'number' ? dtSeconds : 1 / 60;
    }

    // Constant-screen-size fix: every frame, reproject each marker's
    // (and its overlay rings') CONSTANT pixel target back into world
    // units using the camera's CURRENT distance to it. This must run
    // every frame regardless of reduced-motion — it is not an animation,
    // it is what keeps the marker's on-screen size from ballooning as the
    // user zooms in. Only the hub/live "pulse" breathing on top of this
    // base size is gated by `reducedMotion`.
    const { height } = lastVisibility.viewport;
    records.forEach((r) => {
      const target = worldSizeForScreenPixels(camera, r.sprite.position, r.basePxDiameter, height);
      r.baseWorldSize = target;

      let s = target;
      if (!reducedMotion && (r.colors.isHub || r.colors.isLive)) {
        // Animate the hub/live "faint outer pulse ring" purely via the
        // base marker sprite's own scale breathing very slightly on top
        // of its constant-pixel target — cheap, no extra draw calls, and
        // automatically skipped under reduced motion.
        const pulse = 1 + Math.sin(clock * 2.2 + hashSeed(r.city.id)) * 0.045;
        s = target * pulse;
      }
      r.sprite.scale.set(s, s, 1);

      if (r.festivalRing) {
        const fr = worldSizeForScreenPixels(camera, r.festivalRing.position, r.basePxDiameter * FESTIVAL_RING_SCALE, height);
        r.festivalRing.scale.set(fr, fr, 1);
      }
      const sr = worldSizeForScreenPixels(camera, r.selectionRing.position, r.basePxDiameter * SELECTION_RING_SCALE, height);
      r.selectionRing.scale.set(sr, sr, 1);
    });
  }

  function hashSeed(id) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 1000;
    return h / 1000;
  }

  function setSelectedId(id) {
    if (selectedId === id) return;
    selectedId = id || null;
    records.forEach((r) => {
      r.selectionRing.visible = r.sprite.visible && r.city.id === selectedId;
      r.selectionRing.material.opacity = r.city.id === selectedId ? 1 : 0;
    });
    const city = records.find((r) => r.city.id === selectedId);
    onSelectChange(city ? city.city : null);
  }

  function setHoveredId(id) {
    if (hoveredId === id) return;
    hoveredId = id || null;
    const rec = records.find((r) => r.city.id === hoveredId);
    onHoverChange(rec ? rec.city : null);
  }

  /** Raycast helper for real pointer interaction. `ndc` is normalized
   * device coordinates ({x,y} in [-1,1]). Returns the hit city or null. */
  const raycaster = new THREE.Raycaster();
  function pickAtNDC(ndc) {
    raycaster.setFromCamera(ndc, camera);
    const sprites = records.filter((r) => r.sprite.visible).map((r) => r.sprite);
    const hits = raycaster.intersectObjects(sprites, false);
    if (hits.length === 0) return null;
    const rec = records.find((r) => r.sprite === hits[0].object);
    return rec ? rec.city : null;
  }

  /** Test/diagnostic hook: real screen-space {x,y} for a city id, or null
   * if it is currently clustered away / on the far side. Not required by
   * the plan's public contract, additive only — mirrors camera.js's
   * rotationState() precedent for exposing verifiable internal state. */
  function getScreenPositionForCity(id) {
    const rec = records.find((r) => r.city.id === id);
    if (!rec || !rec.sprite.visible) return null;
    return projectToScreen(rec, lastVisibility.viewport.width, lastVisibility.viewport.height);
  }

  function getRenderedMarkerCount() {
    return records.filter((r) => r.sprite.visible).length + lastVisibility.clusters.length;
  }

  /** Test/diagnostic hook (additive, same precedent as
   * `getScreenPositionForCity` above): measures a city's marker's ACTUAL
   * rendered on-screen diameter in CSS pixels, by projecting two points a
   * half-scale apart along the camera's real "right" axis (the same axis
   * three.js's own sprite billboarding uses) through the real camera
   * projection matrix — i.e. it reads the true rendered geometry, not the
   * internal target this module is trying to hit. This is what the
   * "markers hold a constant screen size across zoom" regression test
   * measures. Returns `null` if the marker is not currently a visible
   * single (clustered away or on the far side). */
  function getMarkerScreenSizePx(id) {
    const rec = records.find((r) => r.city.id === id);
    if (!rec || !rec.sprite.visible) return null;
    const { width, height } = lastVisibility.viewport;
    if (!width || !height) return null;

    const worldSize = rec.sprite.scale.x;
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const center = rec.sprite.position;
    const edgeA = center.clone().addScaledVector(camRight, worldSize / 2);
    const edgeB = center.clone().addScaledVector(camRight, -worldSize / 2);

    const toScreen = (v) => {
      const p = v.clone().project(camera);
      return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height };
    };
    const a = toScreen(edgeA);
    const b = toScreen(edgeB);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Returns the entries that should render a visible text label THIS
   * frame: `{id, x, y, text}[]`, already resolved to real screen
   * coordinates and a real display string (a city name, or a cluster's
   * dominant city name plus a genuine "+N" count — never fabricated). */
  function getVisibleLabelEntries() {
    return lastVisibility.labelEntries;
  }

  function dispose() {
    scene.remove(root);
    records.forEach((r) => {
      r.material.dispose();
      if (r.festivalRing) r.festivalRing.material.dispose();
      r.selectionRing.material.dispose();
    });
    clusterSpritePool.forEach((s) => s.material.dispose());
    textureCache.forEach((t) => t.dispose());
    ringTextureCache.forEach((t) => t.dispose());
    textureCache.clear();
    ringTextureCache.clear();
  }

  return {
    object3D: root,
    update,
    setSelectedId,
    setHoveredId,
    pickAtNDC,
    getScreenPositionForCity,
    getMarkerScreenSizePx,
    getRenderedMarkerCount,
    getVisibleLabelEntries,
    dispose,
  };
}

export const __internal = { getMarkerTexture, resolveCityColors, hexWithAlpha };
