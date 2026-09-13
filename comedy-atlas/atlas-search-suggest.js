/**
 * COMEDY ATLAS -- shared site-wide type-ahead search box (work order
 * 2026-09-12, Robert verbatim: "everything searchable like cities, comics,
 * venues, they should also start to auto finish the results as well. So if
 * i type in Lon then London will appear. everything a pro website needs.").
 *
 * Mounted into the primary nav on EVERY page: scripts/seo_common.py's
 * nav_html() (the single place the nav markup is produced -- every
 * DB-driven generator calls it, and render_atlas_static_pages.py syncs
 * every hand-authored page's own baked copy to match) emits the plain
 * `<form class="atlas-nav-search">...<input id="atlas-nav-q">...</form>`
 * this file enhances, plus the `<script type="module" ...>` tag that loads
 * this file. See seo_common.NAV_SEARCH_HTML/NAV_SEARCH_SCRIPT_HTML for the
 * exact markup contract.
 *
 * REUSE, NOT REIMPLEMENTATION: every matching/ranking/grouping/keyboard
 * rule lives in globe/search.js's `mountGlobeSearch` -- the SAME module the
 * homepage hero search (`#atlas-q`, index.html's "HERO SEARCH -> GLOBE
 * BRIDGE") already uses. This file exists only to wire that shared module
 * against the nav's own input/dropdown pair and to decide, for a box with
 * no globe to fly to, where a selection navigates.
 *
 * LAZY BY DESIGN: nothing here fetches search_index.json (~1.0MB) until the
 * visitor actually focuses or types into the box -- mountGlobeSearch's own
 * startLoadingIndex() gates that on the input's 'focus'/'input' events (see
 * that file's own CP10 perf comment), so loading this module at page load
 * costs only a few KB of JS, never the index payload. `indexUrl` below is
 * root-absolute (never the module's own default, which is relative to
 * globe/search.js's typical caller depth) so it resolves identically no
 * matter how deep the page carrying this nav is nested.
 *
 * NO-JS CONTRACT: the underlying `<form action="/comedy-atlas/search/"
 * method="get">` (baked into the nav markup, not this file) works with
 * zero JS. If this module fails to load or import (old browser, blocked
 * script, ad blocker, globe/search.js 404) the plain GET form is completely
 * unaffected -- this file only ever ADDS behavior to an already-functional
 * input, matching every other progressive-enhancement path in this
 * codebase (globe/search.js's own mount().catch() discipline; index.html's
 * initHeroSearchBridge().catch()).
 *
 * DISCOVERABILITY ALWAYS NAVIGATES: this box has no globe to fly a city to,
 * so both onSelectCity and onSelectRecord below send the browser to the
 * record's own real, crawlable page -- never a client-side-only state (same
 * FABLE contract globe/search.js's own onSelectRecord already documents for
 * the hero bridge).
 */
import { mountGlobeSearch } from "./globe/search.js";

var SEARCH_INDEX_URL = "/data/comedy-atlas/search_index.json";

// Self-contained styling (same idempotent-injection pattern as globe/
// search.js's own injectSearchStylesOnce): the nav box must render sanely
// on EVERY page this runs on, including hand-authored pages whose own
// <style> block was never taught about `.atlas-nav-search` -- so this never
// depends on any page's own CSS. mountGlobeSearch itself injects the
// dropdown's own styles (`.atlas-globe-search-dropdown`) and sets the
// input's parent to `position:relative` -- this only needs to size/hide the
// form + its screen-reader-only label, and to keep the nav usable at phone
// width (work order: "works at phone width").
var STYLE_ID = "atlas-nav-search-styles";
function injectNavSearchStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  var style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    // min-width:0 (never the flexbox default `auto`, which for a form
    // control means its OWN intrinsic content width) is what actually lets
    // this shrink below ~160-200px -- without it a plain <input> refuses to
    // shrink past its browser-default intrinsic size no matter what
    // `width:100%`/`flex-basis` say, and overflows the nav at extreme zoom
    // widths (measured: 222px scrollWidth in a 192px viewport before this
    // line was added -- see tests/test_chrome_touch_targets.py's own
    // 192px = 400% zoom on a 768px layout viewport sweep).
    ".atlas-nav-search{display:flex;align-items:center;min-width:0;" +
    "flex:1 1 160px;max-width:260px;margin-left:auto}\n" +
    ".atlas-nav-search-label{position:absolute;width:1px;height:1px;" +
    "padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);" +
    "white-space:nowrap;border:0}\n" +
    ".atlas-nav-search input[type=search]{width:100%;min-width:0;" +
    "box-sizing:border-box;padding:8px 10px;font-size:14px;border-radius:8px;" +
    "border:1px solid var(--border,#2a3548);background:var(--card,#141a26);" +
    "color:var(--text,#f0f0f0)}\n" +
    "@media(max-width:600px){.atlas-nav-search{flex-basis:100%;" +
    "min-width:0;max-width:none;margin-left:0;order:99}}\n";
  document.head.appendChild(style);
}

function mountNavSearch(inputEl) {
  var suggestId = inputEl.getAttribute("aria-controls") ||
    inputEl.id + "-suggest";
  var dropdownEl = document.getElementById(suggestId);

  mountGlobeSearch(inputEl, {
    indexUrl: SEARCH_INDEX_URL,
    dropdownEl: dropdownEl || undefined,
    // No live globe on a plain nav box -- picking a city still lands on a
    // real page, never a silent no-op (see module docstring above).
    onSelectCity: function (id, city) {
      if (city && city.slug) {
        window.location.href = "/comedy-atlas/city/" + city.slug + "/";
      }
    },
    onSelectRecord: function (record) {
      if (record && record.url) window.location.href = record.url;
    },
  });
}

function init() {
  injectNavSearchStylesOnce();
  var inputs = document.querySelectorAll('input[id="atlas-nav-q"], .atlas-nav-search input[type="search"]');
  var seen = [];
  inputs.forEach(function (inputEl) {
    if (seen.indexOf(inputEl) !== -1) return; // the two selectors above can both match the same element
    seen.push(inputEl);
    mountNavSearch(inputEl);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

export const __internal = { mountNavSearch, init };
