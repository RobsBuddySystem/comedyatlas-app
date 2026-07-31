/**
 * COMEDY ATLAS — Interactive Globe: loading state
 * (site/comedy-atlas/globe/loading.js)
 *
 * CHECKPOINT 4 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * Global Constraint #11: the cartoon Atlas character may appear in
 * brand/loading areas only, and never overlay the interactive Earth. This
 * module renders while the Earth/vendor bundle/data are still loading —
 * i.e. before the canvas exists — so it is a safe place for the mark.
 * It intentionally renders "a Comedy Atlas mark + restrained globe
 * outline" (plan CP4 Step 4), never a bare spinner alone.
 *
 * Exports:
 *   renderLoadingState(rootEl, {label}) -> {destroy, setLabel(text)}
 */

const MARK_SVG =
  '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<circle cx="24" cy="28" r="12"/>' +
  '<path d="M24 16v24M12 28h24M15 20a12 12 0 0 0 0 16M33 20a12 12 0 0 1 0 16"/>' +
  "</svg>";

export function renderLoadingState(rootEl, opts) {
  const options = opts || {};
  rootEl.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "atlas-globe-loading";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");

  const ring = document.createElement("div");
  ring.className = "atlas-globe-loading-ring";
  ring.setAttribute("aria-hidden", "true");

  const mark = document.createElement("div");
  mark.className = "atlas-globe-loading-mark";
  mark.innerHTML = MARK_SVG;

  const text = document.createElement("p");
  text.className = "atlas-globe-loading-text";
  text.textContent = options.label || "Loading the Comedy Atlas globe…";

  wrap.appendChild(ring);
  wrap.appendChild(mark);
  wrap.appendChild(text);
  rootEl.appendChild(wrap);

  return {
    setLabel(next) {
      text.textContent = next;
    },
    destroy() {
      rootEl.innerHTML = "";
    },
  };
}
