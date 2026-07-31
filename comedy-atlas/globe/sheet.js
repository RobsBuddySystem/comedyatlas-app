/**
 * COMEDY ATLAS — Interactive Globe: mobile bottom sheet + touch gestures
 * (site/comedy-atlas/globe/sheet.js)
 *
 * CHECKPOINT 8 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * Everything mobile/touch-specific that does not belong in the FROZEN
 * `camera.js` lives here (per the plan's own instruction: "camera.js is
 * FROZEN ... prefer handling touch in sheet.js/experience.js"). Two
 * independent concerns:
 *
 *  1. `mountBottomSheet` — a partial/full-height bottom sheet that hosts
 *     the existing (also frozen) panel.js content on narrow viewports,
 *     replacing panel.js's normal in-flow desktop placement without ever
 *     touching panel.js itself. Drag the handle (pointer/touch) or
 *     click/tap/Enter/Space it to toggle between "partial" and "full".
 *
 *  2. `attachTouchGestureGuard` — real two-finger pinch-to-zoom. camera.js
 *     only listens for a single `wheel` event to zoom (see its
 *     `WHEEL_ALTITUDE_PER_UNIT` constant) and unifies mouse/touch/pen drag
 *     through Pointer Events for ROTATION only — it has no concept of a
 *     second simultaneous pointer, so an untouched two-finger touch
 *     gesture today rotates the camera erratically (whichever finger's
 *     pointerId happens to be `lastPointerId` drives the drag) instead of
 *     zooming. Rather than editing camera.js (forbidden), this module
 *     registers a CAPTURE-PHASE pointer listener on an ancestor
 *     (`canvasWrapEl`, which sits above the `<canvas>` camera.js's own
 *     listeners are attached to). Capture-phase listeners on an ancestor
 *     always run before target-phase listeners on the descendant itself,
 *     in the same event dispatch — so the moment a second touch pointer
 *     joins, this handler calls `stopPropagation()`, which prevents the
 *     event from ever reaching camera.js's own listener on the canvas at
 *     all for the remainder of that pointermove. camera.js is never
 *     imported, never edited, and never even aware this module exists;
 *     zooming during a pinch is instead driven by dispatching a real,
 *     synthetic `wheel` event at the canvas — the exact same event
 *     camera.js already listens for from a mouse/trackpad, so one code
 *     path serves both input methods.
 *
 * One-finger rotate and tap-to-select need NO new code here: Pointer
 * Events already unify mouse/touch/pen (see camera.js's own header comment
 * and experience.js's `attachPointerHandling`), so a single-finger drag on
 * the canvas already rotates the globe and a quick single-finger tap
 * already selects a marker, through the exact same listeners a mouse
 * uses — proven by `tests/test_globe_e2e.py`'s CP8 section dispatching a
 * `pointerType: 'touch'` drag through the real, unmodified code path.
 *
 * Exports:
 *   isMobileViewport(width?) -> boolean
 *   mountBottomSheet(containerEl, contentEl, opts) -> {setState, getState, destroy}
 *   attachTouchGestureGuard(canvasWrapEl, canvasEl) -> {dispose}
 */

/** Matches globe-chrome.css's own `@media (max-width:600px)` breakpoint —
 * single source of truth for "is this the mobile layout", read by
 * experience.js so its behaviour switch agrees exactly with the CSS. */
const MOBILE_MAX_WIDTH = 600;

export function isMobileViewport(width) {
  const w = typeof width === 'number' ? width : (typeof window !== 'undefined' ? window.innerWidth : 0);
  return w <= MOBILE_MAX_WIDTH;
}

/** A drag on the handle past this many px switches state; below it, the
 * handle springs back to whatever state it already was (a real toggle,
 * not an accidental hair-trigger on tiny jitter). */
const DRAG_SWITCH_THRESHOLD_PX = 32;

/**
 * @param {HTMLElement} containerEl reserved mount point (experience.js's
 *   `.atlas-globe-panel-col`) — cleared and owned entirely by this call.
 * @param {HTMLElement} contentEl already-rendered panel.js content (this
 *   function only relocates it into the sheet's scrollable body — it does
 *   not build or know anything about panel.js's internals).
 * @param {{initialState?: "partial"|"full", onStateChange?: (state:string)=>void}} [opts]
 */
export function mountBottomSheet(containerEl, contentEl, opts) {
  const options = opts || {};
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
  let state = options.initialState === 'full' ? 'full' : 'partial';
  let disposed = false;

  containerEl.innerHTML = '';

  const sheet = document.createElement('div');
  sheet.className = 'atlas-globe-sheet';
  sheet.setAttribute('data-state', state);

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'atlas-globe-sheet-handle';
  handle.setAttribute('aria-expanded', state === 'full' ? 'true' : 'false');
  handle.setAttribute(
    'aria-label',
    state === 'full' ? 'Collapse city details' : 'Expand city details'
  );
  const grip = document.createElement('span');
  grip.className = 'atlas-globe-sheet-grip';
  grip.setAttribute('aria-hidden', 'true');
  handle.appendChild(grip);

  const body = document.createElement('div');
  body.className = 'atlas-globe-sheet-body';
  body.appendChild(contentEl);

  sheet.appendChild(handle);
  sheet.appendChild(body);
  containerEl.appendChild(sheet);

  function applyState(next) {
    if (next !== 'partial' && next !== 'full') return;
    state = next;
    sheet.setAttribute('data-state', state);
    handle.setAttribute('aria-expanded', state === 'full' ? 'true' : 'false');
    handle.setAttribute(
      'aria-label',
      state === 'full' ? 'Collapse city details' : 'Expand city details'
    );
    onStateChange(state);
  }

  function toggle() {
    applyState(state === 'full' ? 'partial' : 'full');
  }

  // Click covers mouse AND a real tap-without-drag (a <button> click event
  // fires for both), and native <button> semantics already give Enter/Space
  // keyboard activation for free — no separate keydown handler needed.
  handle.addEventListener('click', toggle);

  // Drag-to-resize: up past the threshold expands, down past it collapses.
  // This is additive to the click toggle above, never a replacement for it
  // (so a screen-reader or keyboard-only user, who can never "drag", still
  // has the click/Enter/Space path — the plan's "no hover-only
  // functionality" extended to its logical neighbour, "no drag-only
  // functionality").
  let dragStartY = null;
  let dragPointerId = null;

  function onHandlePointerDown(ev) {
    dragStartY = ev.clientY;
    dragPointerId = ev.pointerId;
    if (handle.setPointerCapture) {
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch (_err) {
        /* not critical */
      }
    }
  }

  function onHandlePointerUp(ev) {
    if (dragStartY === null || ev.pointerId !== dragPointerId) return;
    const delta = ev.clientY - dragStartY;
    dragStartY = null;
    dragPointerId = null;
    if (delta <= -DRAG_SWITCH_THRESHOLD_PX && state !== 'full') applyState('full');
    else if (delta >= DRAG_SWITCH_THRESHOLD_PX && state !== 'partial') applyState('partial');
  }

  function onHandlePointerCancel() {
    dragStartY = null;
    dragPointerId = null;
  }

  handle.addEventListener('pointerdown', onHandlePointerDown);
  handle.addEventListener('pointerup', onHandlePointerUp);
  handle.addEventListener('pointercancel', onHandlePointerCancel);

  return {
    setState: applyState,
    getState() {
      return state;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      handle.removeEventListener('click', toggle);
      handle.removeEventListener('pointerdown', onHandlePointerDown);
      handle.removeEventListener('pointerup', onHandlePointerUp);
      handle.removeEventListener('pointercancel', onHandlePointerCancel);
      containerEl.innerHTML = '';
    },
  };
}

/** Pinch-distance-delta (px) -> synthetic wheel `deltaY` scale. Signed so
 * fingers spreading apart (distance increasing) zooms IN — camera.js's own
 * `onWheel` does `currentAltitude += deltaY * WHEEL_ALTITUDE_PER_UNIT`, so a
 * negative deltaY (this constant's sign, applied below) reduces altitude,
 * i.e. zooms in, exactly matching a trackpad pinch-to-zoom-in convention. */
const PINCH_DELTA_TO_WHEEL_SCALE = 6;

/** Below this per-move pinch-distance change (px), no synthetic wheel event
 * fires — filters out sub-pixel jitter between two touch points that isn't
 * a real pinch gesture. */
const PINCH_MOVE_EPSILON_PX = 1;

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * @param {HTMLElement} canvasWrapEl ancestor of the `<canvas>` — the exact
 *   element experience.js already calls `.atlas-globe-canvas-wrap`.
 * @param {HTMLElement} canvasEl the real `<canvas>` camera.js's own wheel
 *   listener is attached to (`renderer.domElement`).
 */
export function attachTouchGestureGuard(canvasWrapEl, canvasEl) {
  /** @type {Map<number, {x:number, y:number}>} */
  const activeTouchPointers = new Map();
  let pinchStartDistance = null;
  let disposed = false;

  function currentPair() {
    return Array.from(activeTouchPointers.values()).slice(0, 2);
  }

  function onPointerDownCapture(ev) {
    if (ev.pointerType !== 'touch') return;
    activeTouchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (activeTouchPointers.size >= 2) {
      pinchStartDistance = distanceBetween(...currentPair());
    }
  }

  function onPointerMoveCapture(ev) {
    if (ev.pointerType !== 'touch' || !activeTouchPointers.has(ev.pointerId)) return;
    activeTouchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (activeTouchPointers.size < 2) return;

    // A second touch is active: this IS a pinch, not a single-finger drag.
    // Stop the event here, in the capture phase, before it ever reaches
    // camera.js's target-phase pointermove listener on `canvasEl` itself —
    // see this module's header comment for why that ordering guarantee
    // holds and why it is the correct way to override a frozen file's
    // behaviour without editing it.
    ev.stopPropagation();

    const pair = currentPair();
    const currentDistance = distanceBetween(pair[0], pair[1]);
    if (pinchStartDistance !== null) {
      const delta = currentDistance - pinchStartDistance;
      if (Math.abs(delta) >= PINCH_MOVE_EPSILON_PX) {
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: -delta * PINCH_DELTA_TO_WHEEL_SCALE,
          bubbles: false,
          cancelable: true,
        });
        canvasEl.dispatchEvent(wheelEvent);
      }
    }
    pinchStartDistance = currentDistance;
  }

  function onPointerUpOrCancelCapture(ev) {
    if (ev.pointerType !== 'touch') return;
    activeTouchPointers.delete(ev.pointerId);
    if (activeTouchPointers.size < 2) pinchStartDistance = null;
  }

  // `true` = capture phase, the entire mechanism this module relies on.
  canvasWrapEl.addEventListener('pointerdown', onPointerDownCapture, true);
  canvasWrapEl.addEventListener('pointermove', onPointerMoveCapture, true);
  canvasWrapEl.addEventListener('pointerup', onPointerUpOrCancelCapture, true);
  canvasWrapEl.addEventListener('pointercancel', onPointerUpOrCancelCapture, true);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      canvasWrapEl.removeEventListener('pointerdown', onPointerDownCapture, true);
      canvasWrapEl.removeEventListener('pointermove', onPointerMoveCapture, true);
      canvasWrapEl.removeEventListener('pointerup', onPointerUpOrCancelCapture, true);
      canvasWrapEl.removeEventListener('pointercancel', onPointerUpOrCancelCapture, true);
      activeTouchPointers.clear();
    },
  };
}

export const __internal = {
  MOBILE_MAX_WIDTH,
  DRAG_SWITCH_THRESHOLD_PX,
  PINCH_DELTA_TO_WHEEL_SCALE,
  distanceBetween,
};
