/**
 * COMEDY ATLAS — Interactive Globe: camera controller
 * (site/comedy-atlas/globe/camera.js)
 *
 * CHECKPOINT 5 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * No three-globe / OrbitControls dependency (see earth.js header and CP2's
 * Deviation D5 — three-globe could not be vendored, and its ESM bundle is
 * the only place a matching OrbitControls-equivalent would have come from
 * without a build step). Drag-rotate, wheel/trackpad zoom and animated
 * focus are implemented directly on top of vendored three.js using pointer
 * events (unifies mouse, touch and pen — no separate touch handling path
 * needed for CP5; CP8 layers compact mobile-specific chrome on top of the
 * same controller).
 *
 * Coordinate contract (shared with earth.js): the Earth is a unit sphere
 * (radius 1 = EARTH_RADIUS) centered at the origin. "Altitude" is
 * `distanceFromCenter - EARTH_RADIUS`, expressed in globe radii — the
 * EXACT unit CP3's cluster.js documents its LOD breakpoints in:
 *   LOD_WORLD_MIN_ALTITUDE    = 1.5
 *   LOD_REGIONAL_MIN_ALTITUDE = 0.6
 *   LOD_CITY_MIN_ALTITUDE     = 0.15
 * This module's MIN/MAX/WORLD/CITY altitude constants below are chosen to
 * agree with those breakpoints (see the comment on each constant).
 *
 * Idle rotation (plan Step 3, non-negotiable):
 *   - slow (IDLE_ROTATE_DEG_PER_SEC)
 *   - pauses IMMEDIATELY on any pointerdown/wheel interaction
 *   - resumes after IDLE_RESUME_DELAY_MS of inactivity
 *   - fully disabled under `prefers-reduced-motion: reduce`
 *   - halted while `document.hidden` (visibilitychange listener)
 *
 * Exports:
 *   createCameraController(camera, renderer, {onIdle, onInteract}) ->
 *     {update, focusOnLatLng(lat, lng, {duration}), resetToWorldView(),
 *      altitude(), dispose}
 *
 * Also owns the renderer's clear colour (Opus gate, CP5): the WebGL canvas
 * defaulted to pure black while the chrome around it (globe-chrome.css)
 * renders a near-black-but-not-quite `#05070b` field, producing a visible
 * seam at the canvas edge. `earth.js` never receives the renderer (its
 * contract is `createEarth(scene, opts)`), so this is the only CP5 module
 * that can set it. Driven from `--atlas-globe-ocean-lo` (fallback
 * `#05070d`) — globe-chrome.css's own field colour (`#05070b`, e.g. its
 * panel/search backgrounds and the canvas-container radial-gradient stop)
 * is a hard-coded literal, not itself exposed as a token, so ocean-lo is
 * the closest existing scoped token and is visually indistinguishable
 * from it (2 units off in the blue channel).
 */

import { EARTH_RADIUS, latLngToVector3, readToken } from './earth.js';
import * as THREE from '../vendor/three/three.module.js';

export { latLngToVector3 };

/** Never lets the camera pass through the Earth's surface. */
const MIN_ALTITUDE = 0.05;
/** Furthest the camera is allowed to zoom out. Raised from the previous 3.0
 * (see WORLD_VIEW_ALTITUDE below) to leave real zoom-out headroom beyond the
 * new, further-back default world-view distance. */
const MAX_ALTITUDE = 4.0;
/** Default `focusOnLatLng` altitude — inside cluster.js's "city" tier
 * ([0.15, 0.6)) so a focused city immediately renders at city-level LOD. */
const CITY_FOCUS_ALTITUDE = 0.35;

/*
 * BUGFIX (2026-07-31, Bug #2 regression: "opaque scrim guillotines the
 * sphere").
 *
 * The previous fix for "legend renders on top of the Earth" painted an
 * opaque `.atlas-globe-shell::after` scrim over the canvas's bottom band in
 * globe-chrome.css. Confirmed by screenshot inspection (tests/globe_screenshots/
 * city_selected_paris.png): at the old WORLD_VIEW_ALTITUDE (2.2), the
 * rendered sphere is tall enough that its true lower arc extends well past
 * the scrim's top edge, so the scrim didn't sit on empty ocean below the
 * globe -- it painted a flat, dead-straight line directly across the
 * visible sphere, reading as an amputated planet. That scrim has been
 * deleted outright (globe-chrome.css). This is the real fix: make the
 * globe's own geometry leave the legend band genuinely empty, so nothing
 * needs to be painted over.
 *
 * Two camera-only levers, both legitimate three.js camera properties (no
 * touch to earth.js/markers.js/cluster.js — their pixel-projection math is
 * driven entirely off `camera.projectionMatrix`, which both of these
 * mutate through the camera's own public API, so every consumer downstream
 * stays correct automatically):
 *
 * 1. Pull the default world-view camera back so the sphere subtends a
 *    smaller vertical angle -- WORLD_VIEW_TARGET_DIAMETER_FRACTION targets
 *    the sphere's on-screen DIAMETER as a fraction of canvas height,
 *    and `computeWorldViewAltitude()` inverts the projection's own
 *    trig (asin/atan on the real camera.fov -- not a guessed constant) to
 *    find the exact altitude that produces it. At fov=45 this lands at
 *    altitude ~3.15 -- comfortably inside cluster.js's "world" LOD tier
 *    (>=1.5), which is why MAX_ALTITUDE above was raised from 3.0 to 4.0
 *    (the old ceiling would have clamped the new default short of its
 *    target and left no user zoom-out headroom left at all).
 *
 * 2. `camera.setViewOffset()` -- a standard, built-in three.js lens-shift:
 *    it reframes the same frustum asymmetrically without changing the
 *    canvas size, the FOV, or the projected scale of anything in it, so it
 *    cannot be confused with the reverted "shrink the canvas" attempt that
 *    broke marker-clustering pixel math. `applyWorldFrameOffset()` below
 *    computes the exact vertical shift so that, at the diameter fixed by
 *    lever 1, the sphere's centre sits high enough that:
 *      - FRAME_BOTTOM_RESERVE_FRACTION (0.34) of the canvas height stays
 *        genuinely empty dark field below the sphere's lower edge -- more
 *        than the deleted scrim's own 150px/520px (~0.29) band, so the
 *        legend + hint row sit with real clearance, not a razor's edge.
 *      - the remaining ~6% above the sphere clears the topbar without
 *        the sphere ever being clipped by the canvas's own top edge.
 *    The shift is applied ONCE, as a fixed lens property, independent of
 *    the current zoom/focus state -- exactly like a real camera's shift
 *    lens, so the legend's clear band stays clear whether the globe is at
 *    world view or focused in on a city.
 */

/** Sphere's on-screen diameter, as a fraction of canvas height, at the
 * default world view. Chosen to read as a substantial, cinematic subject
 * (not a tiny distant marble) while leaving room for the reserved bottom
 * band below. */
const WORLD_VIEW_TARGET_DIAMETER_FRACTION = 0.6;

/** Fraction of canvas height reserved as genuinely empty field beneath the
 * sphere for the legend + hint row + layers-bar band. */
const FRAME_BOTTOM_RESERVE_FRACTION = 0.34;

/**
 * Inverts the perspective projection's own vertical trig to find the
 * camera altitude (in EARTH_RADIUS units) at which the sphere's on-screen
 * diameter equals `diameterFraction` of the canvas height, for a camera
 * with vertical field of view `fovDeg`. Pure function of real camera
 * parameters -- not a hand-guessed distance constant.
 *
 * @param {number} fovDeg
 * @param {number} diameterFraction
 * @returns {number} altitude in EARTH_RADIUS units
 */
function computeWorldViewAltitude(fovDeg, diameterFraction) {
  const halfFovRad = (fovDeg / 2) * (Math.PI / 180);
  const tanTheta = diameterFraction * Math.tan(halfFovRad);
  const sinTheta = tanTheta / Math.sqrt(1 + tanTheta * tanTheta);
  return EARTH_RADIUS / sinTheta - EARTH_RADIUS;
}

/**
 * Computes the vertical `setViewOffset` shift (in canvas pixels) that
 * places the sphere's centre so that `FRAME_BOTTOM_RESERVE_FRACTION` of the
 * canvas height stays clear below the sphere's lower edge, given the
 * sphere's actual on-screen diameter fraction and the canvas height.
 *
 * Derivation: a perspective camera's `setViewOffset(fullW, fullH, x, y, w, h)`
 * with `w === fullW` and `h === fullH` (no additional zoom) shifts the
 * on-screen vertical position of anything centred on the look-at target by
 * `y / fullH` of the frame, i.e. offsetY-in-pixels === shiftFraction *
 * canvasHeight. A positive shift moves content UP the canvas. Solving
 * `bottomMarginFraction + diameterFraction/2 - 0.5 = shiftFraction` for the
 * desired bottom margin gives the offset below.
 *
 * @param {number} diameterFraction
 * @param {number} canvasHeight
 * @returns {number} offsetY in canvas pixels for `camera.setViewOffset`
 */
function computeVerticalFrameShiftPx(diameterFraction, canvasHeight) {
  const shiftFraction = FRAME_BOTTOM_RESERVE_FRACTION + diameterFraction / 2 - 0.5;
  return shiftFraction * canvasHeight;
}

/** Idle auto-rotate speed — deliberately slow, per plan Step 3. */
const IDLE_ROTATE_DEG_PER_SEC = 2;
/** Inactivity period before idle rotation resumes after an interaction. */
const IDLE_RESUME_DELAY_MS = 4000;
/** Default focus-animation duration when the caller doesn't specify one. */
const DEFAULT_FOCUS_DURATION_MS = 1200;

/** `resetToWorldView()` framing: an Atlantic-centered point so Europe,
 * Africa and the Americas are simultaneously in view, per plan Step 2. */
const WORLD_VIEW_LAT = 15;
const WORLD_VIEW_LNG = -25;

/** Rotation never crosses the poles — avoids the disorienting "flip" the
 * plan's Step 2 explicitly forbids. */
const MAX_ABS_LAT = 85;

const DRAG_DEG_PER_PIXEL = 0.18;
const WHEEL_ALTITUDE_PER_UNIT = 0.0016;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Shortest signed angular delta from `a` to `b`, in degrees, handling the
 * ±180 longitude wrap so an animated focus never spins the long way round. */
function shortestAngleDelta(a, b) {
  let delta = (b - a) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_err) {
    return false;
  }
}

/**
 * @param {import('../vendor/three/three.module.js').PerspectiveCamera} camera
 * @param {import('../vendor/three/three.module.js').WebGLRenderer} renderer
 * @param {{onIdle?: () => void, onInteract?: () => void}} [callbacks]
 */
export function createCameraController(camera, renderer, callbacks) {
  const cb = callbacks || {};
  const onIdle = typeof cb.onIdle === 'function' ? cb.onIdle : () => {};
  const onInteract = typeof cb.onInteract === 'function' ? cb.onInteract : () => {};

  const domEl = renderer.domElement;

  // Match the canvas's clear colour to globe-chrome.css's own field colour
  // so the WebGL canvas and the surrounding page read as one continuous
  // surface instead of a black rectangle sitting on a near-black page.
  const clearColorHex = readToken('--atlas-globe-ocean-lo', '#05070d');
  renderer.setClearColor(new THREE.Color(clearColorHex), 1);

  // Lever 1 (see the Bug #2 comment block above `computeWorldViewAltitude`):
  // derive the world-view distance from the camera's own real FOV rather
  // than a hand-picked constant, then clamp it into this controller's own
  // altitude bounds (defined just below) so it can never itself violate
  // MIN/MAX_ALTITUDE.
  const WORLD_VIEW_ALTITUDE = clamp(
    computeWorldViewAltitude(camera.fov, WORLD_VIEW_TARGET_DIAMETER_FRACTION),
    MIN_ALTITUDE,
    MAX_ALTITUDE,
  );

  // Lever 2: a fixed vertical lens-shift so the legend/hint/layers-bar band
  // stays genuinely clear of the sphere at every zoom level, not just at
  // world view. Read the canvas's real rendered size (already set by
  // `renderer.setSize()` before this controller is constructed — see
  // experience.js/the CP5 harness) rather than assuming a fixed viewport.
  (function applyWorldFrameOffset() {
    const canvasWidth = domEl.clientWidth || domEl.width || 1;
    const canvasHeight = domEl.clientHeight || domEl.height || 1;
    if (!canvasWidth || !canvasHeight) return;
    const offsetY = computeVerticalFrameShiftPx(WORLD_VIEW_TARGET_DIAMETER_FRACTION, canvasHeight);
    // fullWidth/fullHeight === width/height (no additional crop/zoom) — this
    // is a pure shift, not a resize. camera.aspect is reassigned to
    // fullWidth/fullHeight by setViewOffset itself, which equals the
    // canvas's own aspect, so nothing is distorted.
    camera.setViewOffset(canvasWidth, canvasHeight, 0, offsetY, canvasWidth, canvasHeight);
  })();

  let currentLat = WORLD_VIEW_LAT;
  let currentLng = WORLD_VIEW_LNG;
  let currentAltitude = WORLD_VIEW_ALTITUDE;

  let dragging = false;
  let lastPointerId = null;
  let lastX = 0;
  let lastY = 0;

  let lastInteractionAt = 0;
  /** "idle" | "interacting" | "paused-reduced-motion" | "paused-hidden" —
   * exposed via the returned controller's `rotationState()` for tests and
   * diagnostics (not part of the plan's required export list, additive
   * only, never required by any other module). */
  let rotationState = 'idle';

  let tween = null; // {fromLat, fromLng, fromAlt, toLat, toLng, toAlt, start, duration}

  let disposed = false;

  function applyCameraTransform() {
    const distance = EARTH_RADIUS + clamp(currentAltitude, MIN_ALTITUDE, MAX_ALTITUDE);
    const position = latLngToVector3(currentLat, currentLng, distance);
    camera.position.copy(position);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
  }

  applyCameraTransform();

  function markInteracting() {
    const wasIdleOrPaused = rotationState !== 'interacting';
    lastInteractionAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    tween = null; // an explicit user interaction always wins over an in-flight focus animation
    if (rotationState !== 'paused-reduced-motion' && rotationState !== 'paused-hidden') {
      rotationState = 'interacting';
    }
    if (wasIdleOrPaused) onInteract();
  }

  function onPointerDown(event) {
    dragging = true;
    lastPointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    if (domEl.setPointerCapture) {
      try {
        domEl.setPointerCapture(event.pointerId);
      } catch (_err) {
        /* ignore — not critical to rotation correctness */
      }
    }
    markInteracting();
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== lastPointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    currentLng = ((currentLng - dx * DRAG_DEG_PER_PIXEL) % 360 + 540) % 360 - 180;
    currentLat = clamp(currentLat + dy * DRAG_DEG_PER_PIXEL, -MAX_ABS_LAT, MAX_ABS_LAT);

    markInteracting();
    applyCameraTransform();
  }

  function endDrag(event) {
    if (event && event.pointerId !== undefined && event.pointerId !== lastPointerId) return;
    dragging = false;
    lastPointerId = null;
  }

  function onWheel(event) {
    event.preventDefault();
    currentAltitude = clamp(
      currentAltitude + event.deltaY * WHEEL_ALTITUDE_PER_UNIT,
      MIN_ALTITUDE,
      MAX_ALTITUDE,
    );
    markInteracting();
    applyCameraTransform();
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      rotationState = 'paused-hidden';
    } else if (rotationState === 'paused-hidden') {
      rotationState = 'idle';
      lastInteractionAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
  }

  let reducedMotionMql = null;
  function onReducedMotionChange(mql) {
    if (mql.matches) {
      rotationState = 'paused-reduced-motion';
    } else if (rotationState === 'paused-reduced-motion') {
      rotationState = 'idle';
    }
  }

  domEl.addEventListener('pointerdown', onPointerDown);
  domEl.addEventListener('pointermove', onPointerMove);
  domEl.addEventListener('pointerup', endDrag);
  domEl.addEventListener('pointercancel', endDrag);
  domEl.addEventListener('pointerleave', endDrag);
  domEl.addEventListener('wheel', onWheel, { passive: false });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.hidden) rotationState = 'paused-hidden';
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      reducedMotionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
      const listener = () => onReducedMotionChange(reducedMotionMql);
      // addEventListener is the modern API; addListener is the legacy
      // fallback some older WebKit/jsdom-ish environments still need.
      if (typeof reducedMotionMql.addEventListener === 'function') {
        reducedMotionMql.addEventListener('change', listener);
      } else if (typeof reducedMotionMql.addListener === 'function') {
        reducedMotionMql.addListener(listener);
      }
      reducedMotionMql._atlasGlobeListener = listener;
      if (reducedMotionMql.matches) rotationState = 'paused-reduced-motion';
    } catch (_err) {
      reducedMotionMql = null;
    }
  } else if (prefersReducedMotion()) {
    rotationState = 'paused-reduced-motion';
  }

  /**
   * Advances idle rotation and any in-flight focus animation. Call once per
   * rendered frame from the caller's render loop.
   *
   * @param {number} [dtSeconds] time since the previous call, in seconds.
   *   If omitted, computed internally from `performance.now()`.
   */
  let lastUpdateAt = null;
  function update(dtSeconds) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let dt = dtSeconds;
    if (typeof dt !== 'number' || !Number.isFinite(dt)) {
      dt = lastUpdateAt === null ? 0 : (now - lastUpdateAt) / 1000;
    }
    lastUpdateAt = now;

    if (tween) {
      const elapsed = now - tween.start;
      const t = clamp(elapsed / tween.duration, 0, 1);
      const eased = easeInOutCubic(t);
      currentLat = tween.fromLat + (tween.toLat - tween.fromLat) * eased;
      currentLng = tween.fromLng + tween.deltaLng * eased;
      currentAltitude = tween.fromAlt + (tween.toAlt - tween.fromAlt) * eased;
      if (t >= 1) tween = null;
      applyCameraTransform();
      return;
    }

    if (rotationState === 'interacting') {
      if (now - lastInteractionAt >= IDLE_RESUME_DELAY_MS) {
        rotationState = 'idle';
        onIdle();
      }
      return;
    }

    if (rotationState !== 'idle') {
      // paused-reduced-motion or paused-hidden: no auto-rotation, ever.
      return;
    }

    if (dt > 0) {
      currentLng = ((currentLng + IDLE_ROTATE_DEG_PER_SEC * dt) % 360 + 540) % 360 - 180;
      applyCameraTransform();
    }
  }

  /**
   * Animates the camera to look squarely at (lat, lng) from the "city" LOD
   * altitude (or a caller-supplied one), via the shortest longitudinal path.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {{duration?: number, altitude?: number}} [opts]
   */
  function focusOnLatLng(lat, lng, opts) {
    const options = opts || {};
    const duration = typeof options.duration === 'number' ? options.duration : DEFAULT_FOCUS_DURATION_MS;
    const targetAltitude = typeof options.altitude === 'number' ? options.altitude : CITY_FOCUS_ALTITUDE;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    tween = {
      fromLat: currentLat,
      fromLng: currentLng,
      fromAlt: currentAltitude,
      toLat: clamp(lat, -MAX_ABS_LAT, MAX_ABS_LAT),
      toLng: lng,
      toAlt: clamp(targetAltitude, MIN_ALTITUDE, MAX_ALTITUDE),
      deltaLng: shortestAngleDelta(currentLng, lng),
      start: now,
      duration: Math.max(1, duration),
    };
  }

  /** Reframes to the default world view (Europe + Africa + the Americas). */
  function resetToWorldView() {
    focusOnLatLng(WORLD_VIEW_LAT, WORLD_VIEW_LNG, {
      duration: DEFAULT_FOCUS_DURATION_MS,
      altitude: WORLD_VIEW_ALTITUDE,
    });
  }

  /** @returns {number} camera altitude in globe radii above the surface —
   * the exact unit cluster.js's lodTier() expects. */
  function altitude() {
    return currentAltitude;
  }

  /** Diagnostic-only, additive export (not in the plan's required list):
   * "idle" | "interacting" | "paused-reduced-motion" | "paused-hidden". */
  function rotationStateNow() {
    return rotationState;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    domEl.removeEventListener('pointerdown', onPointerDown);
    domEl.removeEventListener('pointermove', onPointerMove);
    domEl.removeEventListener('pointerup', endDrag);
    domEl.removeEventListener('pointercancel', endDrag);
    domEl.removeEventListener('pointerleave', endDrag);
    domEl.removeEventListener('wheel', onWheel);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (reducedMotionMql) {
      const listener = reducedMotionMql._atlasGlobeListener;
      if (typeof reducedMotionMql.removeEventListener === 'function') {
        reducedMotionMql.removeEventListener('change', listener);
      } else if (typeof reducedMotionMql.removeListener === 'function') {
        reducedMotionMql.removeListener(listener);
      }
      reducedMotionMql = null;
    }
    tween = null;
  }

  return {
    update,
    focusOnLatLng,
    resetToWorldView,
    altitude,
    dispose,
    rotationState: rotationStateNow,
  };
}

/** Not used anywhere in this codebase today (confirmed by grep before this
 * edit) — kept only as the informational value CAMERA_WORLD_VIEW_ALTITUDE
 * always exported. WORLD_VIEW_ALTITUDE itself became a per-controller value
 * (computed from the real camera.fov passed to createCameraController — see
 * computeWorldViewAltitude above), since a module-level constant can no
 * longer be correct for every possible fov. This is that same formula
 * evaluated at the standard 45° fov this codebase always constructs its
 * PerspectiveCamera with (experience.js, the CP5/CP6 test harnesses).
 * If a caller ever passes a different fov, THEIR controller's actual
 * altitude will legitimately differ from this constant — call
 * `controller.altitude()` for the real, live value. */
const REFERENCE_FOV_DEG = 45;
const CAMERA_WORLD_VIEW_ALTITUDE = computeWorldViewAltitude(
  REFERENCE_FOV_DEG,
  WORLD_VIEW_TARGET_DIAMETER_FRACTION,
);

export {
  MIN_ALTITUDE as CAMERA_MIN_ALTITUDE,
  MAX_ALTITUDE as CAMERA_MAX_ALTITUDE,
  CAMERA_WORLD_VIEW_ALTITUDE,
  CITY_FOCUS_ALTITUDE as CAMERA_CITY_FOCUS_ALTITUDE,
};
