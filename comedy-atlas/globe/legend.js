/**
 * COMEDY ATLAS — Interactive Globe: legend + layer selector + data-driven
 * footer/near-me widgets (site/comedy-atlas/globe/legend.js)
 *
 * CHECKPOINT 4 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md,
 * updated mid-checkpoint to match Robert's approved visual mockup
 * (coordinator note, 2026-07-30). Pure DOM builders — no three.js, no
 * fetch, no WebGL. Every numeric value rendered anywhere in this file is
 * computed from an injected payload; nothing is a hard-coded statistic
 * (Global Constraint #7).
 *
 * Exports:
 *   createLayerSelector(layers, {activeId, onChange}) -> controller
 *     controller.mount(el, {variant: "rail"|"bar"|"compact"}) -> HTMLElement
 *     controller.setActive(id)
 *     controller.destroy()
 *   Renders the SAME underlying state to as many mount points as are
 *   requested (left rail + bottom-right duplicate bar, per the mockup) —
 *   one controller, multiple views, so there is exactly one source of
 *   truth for which layer is active.
 *
 *   renderLegend(rootEl) -> {destroy}
 *     The 4-item marker-colour legend + the "Drag to rotate..." hint row.
 *
 *   renderFooterStats(rootEl, payload) -> {destroy, update(payload)}
 *     5 stat entries (countries / comics / venues / upcoming shows /
 *     festivals), each derived by summing/counting the injected
 *     GlobeCity[] payload. Empty/zero is rendered honestly, never hidden.
 *
 *   renderLiveCounter(rootEl, payload) -> {destroy, update(payload)}
 *     Sums `activeShowCount` across the payload's cities. 0 renders as an
 *     explicit "No shows starting right now" state, not a bare "0" and
 *     not a hidden element.
 *
 *   renderNearMe(rootEl, {onClick}) -> {destroy, setStatus(state)}
 *     The "Near Me" pill button. Behaviour (geolocation, camera focus) is
 *     wired by experience.js via the onClick callback; this module only
 *     owns the accessible control, its markup, and an honest status line
 *     underneath it. `setStatus(state)` renders one of a fixed set of
 *     real-world outcomes (see NEAR_ME_STATUS_TEXT below) — geolocation
 *     unsupported, permission denied, position unavailable/timed out, no
 *     city within range, or the transient "locating" state — as visible,
 *     `aria-live="polite"` text. `setStatus(null)` clears it (the success
 *     case: the camera already moved and the panel already opened, so no
 *     redundant message is needed). Never a silent no-op, never a spinner
 *     that never resolves (Fable finding #7, MED).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Minimal inline icon set — no external assets, no icon font, no CDN. */
const ICONS = {
  stack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="M2 13l10 5 10-5"/><path d="M2 18l10 5 10-5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 11h1v6h1"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  world: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18Z"/></svg>',
  shows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 18V9l8-5 8 5v9"/><path d="M9 18v-6h6v6"/></svg>',
  venues: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="1"/><path d="M9 20v-5h6v5M4 9l8-6 8 6"/></svg>',
  festivals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3v6M8 9l4-3 4 3M6 21l3-9M18 21l-3-9M9 21h6"/></svg>',
  comics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 10h8M8 14h5"/><rect x="3" y="5" width="18" height="12" rx="2"/><path d="m8 17-2 3v-3"/></svg>',
  connections: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 0M7.5 8l3.5 8M16.5 8l-3.5 8"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4M12 8v5l3 2"/></svg>',
  countries: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 4v16M4 4h11l-1.5 3L15 10H4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20V4M6 10l6-6 6 6"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7-4.6-9.3-8.8C1.2 9 2.6 6 5.6 5.4c1.9-.4 3.6.5 4.4 2 .8-1.5 2.5-2.4 4.4-2 3 .6 4.4 3.6 2.9 6.8C19 16.4 12 21 12 21Z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 5c-2 3-2 8 3 8s5 5 3 8M6 3l1 2M18 3l-1 2"/></svg>',
};

function iconEl(name) {
  const span = document.createElement("span");
  span.className = "atlas-globe-icon";
  span.innerHTML = ICONS[name] || "";
  return span;
}

function numberOrEmpty(n) {
  const el = document.createElement("span");
  const value = Number.isFinite(n) ? n : 0;
  el.textContent = value > 0 ? String(value) : "0";
  if (value === 0) el.setAttribute("data-empty", "true");
  return el;
}

/* ------------------------------------------------------------------ */
/* Layer selector — one controller, N views (rail / bar / compact).   */
/* ------------------------------------------------------------------ */

export const DEFAULT_LAYERS = [
  { id: "world", label: "World", icon: "world" },
  { id: "shows", label: "Shows Now", icon: "shows" },
  { id: "venues", label: "Venues", icon: "venues" },
  { id: "festivals", label: "Festivals", icon: "festivals" },
  { id: "comics", label: "Comics", icon: "comics" },
  { id: "connections", label: "Connections", icon: "connections" },
  { id: "history", label: "History", icon: "history" },
];

export function createLayerSelector(layers, opts) {
  const options = opts || {};
  const state = {
    layers: Array.isArray(layers) && layers.length ? layers : DEFAULT_LAYERS,
    activeId: options.activeId || (layers && layers[0] && layers[0].id) || "world",
    onChange: typeof options.onChange === "function" ? options.onChange : () => {},
  };
  const views = []; // {el, variant, itemEls: Map<id, {input, item}>}

  function buildRailItem(layer, variant) {
    const item = document.createElement("label");
    item.className = variant === "bar" ? "atlas-globe-layers-bar-item" : "atlas-globe-rail-item";
    item.setAttribute("data-active", String(layer.id === state.activeId));
    if (layer.disabled) {
      item.setAttribute("data-disabled", "true");
      item.title = layer.disabledReason || "Not enough verified data yet";
    }
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "atlas-globe-layer-" + variant + "-" + Math.random().toString(36).slice(2);
    input.value = layer.id;
    input.checked = layer.id === state.activeId;
    input.disabled = !!layer.disabled;
    input.setAttribute("aria-label", layer.label + (layer.disabled ? " (unavailable: " + (layer.disabledReason || "not enough data") + ")" : ""));
    input.addEventListener("change", () => {
      if (!layer.disabled) setActive(layer.id);
    });
    item.appendChild(input);
    item.appendChild(iconEl(layer.icon));
    const span = document.createElement("span");
    span.textContent = layer.label;
    item.appendChild(span);
    return { item, input };
  }

  function render(view) {
    const { el, variant } = view;
    el.innerHTML = "";
    const itemEls = new Map();
    state.layers.forEach((layer) => {
      const { item, input } = buildRailItem(layer, variant);
      el.appendChild(item);
      itemEls.set(layer.id, { item, input });
    });
    view.itemEls = itemEls;
  }

  function setActive(id) {
    const layer = state.layers.find((l) => l.id === id);
    if (!layer || layer.disabled) return;
    state.activeId = id;
    views.forEach((view) => {
      view.itemEls.forEach((refs, layerId) => {
        refs.item.setAttribute("data-active", String(layerId === id));
        refs.input.checked = layerId === id;
      });
    });
    state.onChange(id);
  }

  function mount(el, mountOpts) {
    const variant = (mountOpts && mountOpts.variant) || "rail";
    el.innerHTML = "";
    let wrapper = el;
    if (variant !== "compact") {
      wrapper = document.createElement("fieldset");
      wrapper.className = variant === "bar" ? "atlas-globe-layers-bar-row" : "";
      wrapper.style.border = "none";
      wrapper.style.margin = "0";
      wrapper.style.padding = "0";
      const legend = document.createElement("legend");
      legend.textContent = "Map layers";
      wrapper.appendChild(legend);
      el.appendChild(wrapper);
    }
    const view = { el: wrapper, variant };
    views.push(view);
    render(view);
    return el;
  }

  function destroy() {
    views.forEach((v) => {
      v.el.innerHTML = "";
    });
    views.length = 0;
  }

  return { mount, setActive, destroy, get activeId() { return state.activeId; } };
}

/* ------------------------------------------------------------------ */
/* Legend row + interaction hint                                       */
/* ------------------------------------------------------------------ */

const LEGEND_ITEMS = [
  { tier: "hub", label: "Major Comedy Hub" },
  { tier: "active", label: "Active Scene" },
  { tier: "live", label: "Upcoming Shows" },
  { tier: "festival", label: "Festival" },
];

export function renderLegend(rootEl) {
  rootEl.innerHTML = "";
  const legend = document.createElement("div");
  legend.className = "atlas-globe-legend";
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", "Marker colour legend");
  LEGEND_ITEMS.forEach(({ tier, label }) => {
    const row = document.createElement("span");
    row.className = "atlas-globe-legend-item";
    row.setAttribute("role", "listitem");
    const dot = document.createElement("span");
    dot.className = "atlas-globe-legend-dot";
    dot.setAttribute("data-tier", tier);
    row.appendChild(dot);
    const text = document.createElement("span");
    text.textContent = label;
    row.appendChild(text);
    legend.appendChild(row);
  });
  rootEl.appendChild(legend);

  const hint = document.createElement("p");
  hint.className = "atlas-globe-hint";
  hint.appendChild(iconEl("dots"));
  const hintText = document.createElement("span");
  hintText.textContent = "Drag to rotate · Scroll to zoom · Click a city";
  hint.appendChild(hintText);
  rootEl.appendChild(hint);

  return {
    destroy() {
      rootEl.innerHTML = "";
    },
  };
}

/* ------------------------------------------------------------------ */
/* Footer stats — every number derived from the injected payload.      */
/* ------------------------------------------------------------------ */

function computeTotals(payload) {
  const cities = (payload && Array.isArray(payload.cities)) ? payload.cities : [];
  const countries = new Set();
  let comics = 0;
  let venues = 0;
  let upcomingShows = 0;
  let festivals = 0;
  let liveNow = 0;
  cities.forEach((c) => {
    if (c && c.countryCode) countries.add(c.countryCode);
    comics += Number(c && c.comicCount) || 0;
    venues += Number(c && c.venueCount) || 0;
    upcomingShows += Number(c && c.upcomingShowCount) || 0;
    festivals += Number(c && c.festivalCount) || 0;
    liveNow += Number(c && c.activeShowCount) || 0;
  });
  return { countries: countries.size, comics, venues, upcomingShows, festivals, liveNow };
}

const STAT_DEFS = [
  { key: "countries", icon: "countries", label: "Countries" },
  { key: "comics", icon: "comics", label: "Comics" },
  { key: "venues", icon: "venues", label: "Venues" },
  { key: "upcomingShows", icon: "shows", label: "Upcoming Shows" },
  { key: "festivals", icon: "festivals", label: "Festivals" },
];

export function renderFooterStats(rootEl, payload) {
  function paint(p) {
    rootEl.innerHTML = "";
    const totals = computeTotals(p);
    STAT_DEFS.forEach((def) => {
      const stat = document.createElement("div");
      stat.className = "atlas-globe-stat";
      stat.appendChild(iconEl(def.icon));
      const textWrap = document.createElement("span");
      textWrap.className = "atlas-globe-stat-text";
      const num = numberOrEmpty(totals[def.key]);
      num.className = "atlas-globe-stat-number";
      const label = document.createElement("span");
      label.className = "atlas-globe-stat-label";
      label.textContent = def.label;
      textWrap.appendChild(num);
      textWrap.appendChild(label);
      stat.appendChild(textWrap);
      stat.setAttribute("role", "group");
      stat.setAttribute("aria-label", def.label + ": " + (Number.isFinite(totals[def.key]) ? totals[def.key] : 0));
      rootEl.appendChild(stat);
    });
  }
  paint(payload);
  return {
    update: paint,
    destroy() {
      rootEl.innerHTML = "";
    },
  };
}

/* ------------------------------------------------------------------ */
/* Live-shows-now counter (bottom-left)                                */
/* ------------------------------------------------------------------ */

export function renderLiveCounter(rootEl, payload) {
  function paint(p) {
    rootEl.innerHTML = "";
    const totals = computeTotals(p);
    const wrap = document.createElement("div");
    wrap.className = "atlas-globe-livecount-label";
    const dot = document.createElement("span");
    dot.className = "atlas-globe-livecount-dot";
    wrap.appendChild(dot);
    const text = document.createElement("span");
    text.className = "atlas-globe-livecount-text";
    text.textContent = "Live shows / Right now";
    wrap.appendChild(text);
    rootEl.appendChild(wrap);

    const number = document.createElement("div");
    number.className = "atlas-globe-livecount-number";
    if (totals.liveNow > 0) {
      number.textContent = String(totals.liveNow);
    } else {
      number.textContent = "No shows starting right now";
      number.setAttribute("data-empty", "true");
    }
    rootEl.setAttribute("role", "status");
    rootEl.setAttribute(
      "aria-label",
      totals.liveNow > 0
        ? totals.liveNow + " live shows right now"
        : "No shows starting right now"
    );
    rootEl.appendChild(number);
  }
  paint(payload);
  return {
    update: paint,
    destroy() {
      rootEl.innerHTML = "";
    },
  };
}

/* ------------------------------------------------------------------ */
/* Near Me button                                                      */
/* ------------------------------------------------------------------ */

/** Every real-world outcome `experience.js`'s onClick can report, mapped to
 * honest, human-readable copy. Keys match the `state` argument to
 * `setStatus` 1:1 — anything not in this table (including `null`/
 * `undefined`) clears the status line rather than guessing at text. */
export const NEAR_ME_STATUS_TEXT = {
  locating: "Locating you…",
  unsupported: "Location isn't supported by this browser.",
  denied: "Location permission was denied. Enable it in your browser or device settings to use Near Me.",
  unavailable: "We couldn't get your location. Please try again.",
  timeout: "Finding your location took too long. Please try again.",
  "none-in-range": "No comedy cities found near you yet.",
};

/* States that are dead ends for geolocation itself (2026-08-01) — each gets
 * a "Search a city instead" escape so the visitor is never stuck. `locating`
 * is deliberately excluded: it always resolves on its own via
 * getCurrentPosition's own timeout (see experience.js), so no escape is
 * needed for it. */
const STATES_WITH_SEARCH_ESCAPE = new Set([
  "unsupported", "denied", "unavailable", "timeout", "none-in-range",
]);

export function renderNearMe(rootEl, opts) {
  const options = opts || {};
  rootEl.innerHTML = "";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "atlas-globe-nearme";
  button.appendChild(iconEl("arrow"));
  const label = document.createElement("span");
  label.textContent = "Near Me";
  button.appendChild(label);
  button.setAttribute("aria-label", "Focus the globe on comedy near me");
  button.addEventListener("click", (ev) => {
    if (typeof options.onClick === "function") options.onClick(ev);
  });
  rootEl.appendChild(button);

  /* BUGFIX (2026-08-01, Robert-reported): this used to be a bare <p> with no
   * CSS, no dismiss and no way out — "Location permission was denied."
   * rendered as a large block that overlapped the live counter and never
   * went away. It is now a bounded card (globe-chrome.css
   * .atlas-globe-nearme-status) with:
   *   - a text span (still role=status/aria-live=polite, still announced)
   *   - a "Search a city instead" action for every dead-end state, wired to
   *     options.onSearchInstead so this component never has to know HOW
   *     search is focused, only that it should be
   *   - an explicit dismiss (×) so the visitor can always close it manually
   * `setStatus(null)` (success, or an explicit dismiss) hides it entirely
   * via `display:none` (no [data-state] attribute) rather than leaving an
   * empty box in the layout. */
  const status = document.createElement("div");
  status.className = "atlas-globe-nearme-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const textEl = document.createElement("span");
  textEl.className = "atlas-globe-nearme-status-text";
  status.appendChild(textEl);

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "atlas-globe-nearme-status-action";
  searchBtn.textContent = "Search a city instead";
  searchBtn.style.display = "none";
  searchBtn.addEventListener("click", () => {
    setStatus(null);
    if (typeof options.onSearchInstead === "function") options.onSearchInstead();
  });
  status.appendChild(searchBtn);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "atlas-globe-nearme-status-dismiss";
  dismissBtn.textContent = "×";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.addEventListener("click", () => setStatus(null));
  status.appendChild(dismissBtn);

  rootEl.appendChild(status);

  function setStatus(state) {
    const text = state ? NEAR_ME_STATUS_TEXT[state] || "" : "";
    textEl.textContent = text;
    if (state && text) {
      status.setAttribute("data-state", state);
      searchBtn.style.display = STATES_WITH_SEARCH_ESCAPE.has(state) ? "" : "none";
    } else {
      status.removeAttribute("data-state");
      searchBtn.style.display = "none";
    }
  }

  return {
    setStatus,
    destroy() {
      rootEl.innerHTML = "";
    },
  };
}

export const __icons = ICONS;
