/*
 * COMEDY ATLAS — Atlas Visuals v1: renderer (site/comedy-atlas/atlas-visuals.js)
 *
 * THIRD of three separate concerns (data adapter -> layer registry ->
 * renderer, see atlas-layers.js's header comment). This file draws the
 * hero: it only ever calls AtlasVisualsData (fetch/normalize) and
 * AtlasLayers (registry + resolvers + link helpers) through their public
 * functions, and only ever iterates AtlasLayers.LAYERS generically — it
 * has no layer-specific branches, so a new registry entry lights up here
 * with zero edits to this file.
 *
 * Projection: a plain equirectangular graticule (lon/lat -> x/y on a flat
 * 2:1 grid), not a real coastline map or a 3D globe. This repo has no
 * bundled world-geometry asset and the static-site CSP forbids pulling
 * one from a CDN (HARD CONSTRAINTS in the brief), so a real map outline
 * would mean either fabricating simplified coastlines by hand (a form of
 * invented data this repo's standing rule explicitly forbids applying to
 * anything user-facing) or adding a runtime dependency (also forbidden).
 * What this version DOES do (2026-07-27 design pass, see the coordinator
 * review that prompted it) is make that honest flat grid feel designed
 * rather than placeholder: a layered radial "night sky" surface, dot size
 * + glow driven by real counts so density reads at a glance, direct
 * labels on the biggest real cities, and a hover/focus link between the
 * map and the accessible list so they read as one component. Every pixel
 * of that is presentation on top of real data — no new coordinates, no
 * new counts, nothing invented.
 *
 * Called by index.html as: AtlasVisuals.mount(document.getElementById(
 * "atlas-viz-root")). No-ops harmlessly if the container isn't found.
 */
(function (global) {
  "use strict";

  var VB_W = 1000, VB_H = 500;
  var TOP_LABEL_COUNT = 6; // biggest real cities get a direct map label
  var MIN_R = 5, MAX_R = 24;

  function project(lat, lon) {
    return {
      x: (lon + 180) / 360 * VB_W,
      y: (90 - lat) / 180 * VB_H
    };
  }

  function svgEl(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    }
    return e;
  }

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") e.className = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function cityKey(name) {
    return String(name || "").toLowerCase().replace(/\s+/g, "-");
  }

  // --- Keyword search (multi-entity, tokenised) --------------------------
  // Reads the already-published data/comedy-atlas/search_index.json (see
  // scripts/generate_search_index.py). TYPE_LABELS/TYPE_ORDER below name
  // ONLY the entity types that generator's own VALID_TYPES emits
  // (event/comic/venue/festival/city/organizer/show) -- nothing invented.
  // "show" is labelled "Series" here, matching the generator's own comment:
  // "Shows" is reserved for dated events (`type: "event"`), a permanent
  // show-series entity is a different, deliberately distinct thing.
  var SEARCH_INDEX_URL = "../data/comedy-atlas/search_index.json";

  var TYPE_LABELS = {
    city: "Cities", region: "Regions", event: "Shows", venue: "Venues",
    festival: "Festivals", show: "Series", comic: "Comics", organizer: "Organizers"
  };
  var TYPE_ORDER = ["city", "region", "event", "venue", "festival", "show", "comic", "organizer"];
  var LEADING_ARTICLES = ["the", "a", "an"];

  // Every record in search_index.json IS a comedy entity (that's the whole
  // corpus) -- a word that only names the DOMAIN itself ("comedy",
  // "stand-up", ...) can never fail to describe a real result, so treating
  // it as a literal per-record text filter would wrongly hide a real venue
  // whose own name doesn't happen to contain the word "comedy". Dropped
  // from the topic-term list rather than matched against text: "NEW YORK
  // COMEDY" degrades to "everything real in New York", which is the
  // honest answer this corpus can give -- not a fabricated relevance score.
  var GENERIC_TERMS = [
    "comedy", "comedian", "comedians", "standup", "stand", "up",
    "club", "clubs", "show", "shows", "gig", "gigs", "night", "nights",
    "live", "open", "mic", "mics"
  ];

  function stripAccents(s) {
    var str = String(s == null ? "" : s);
    // Combining-diacritical-marks range after NFD decomposition -- broadly
    // supported (String#normalize is ES2015), no new dependency.
    return str.normalize ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : str;
  }

  // Case, accents, punctuation -> one lowercase, single-spaced string.
  function normalizeText(s) {
    var t = stripAccents(s).toLowerCase().replace(/['’]/g, "");
    t = t.replace(/[^a-z0-9]+/g, " ");
    return t.trim().replace(/\s+/g, " ");
  }

  // Normalise + split into tokens, dropping one leading article ("the",
  // "a", "an") so "THE COMEDY CELLAR" tokenises the same as "COMEDY CELLAR".
  function tokenize(query) {
    var norm = normalizeText(query);
    if (!norm) return [];
    var tokens = norm.split(" ");
    if (tokens.length > 1 && LEADING_ARTICLES.indexOf(tokens[0]) !== -1) {
      tokens = tokens.slice(1);
    }
    return tokens;
  }

  // A record's own city/cities, ALWAYS as an array so every caller has one
  // shape to match against. The "city" type's row IS the city (its `name`
  // field). Every other type carries location either as a single `city`
  // scalar (event/venue/show/organizer -- one place by construction) OR as
  // a `cities` array (comic/festival -- generate_search_index.py's
  // fetch_comics/_festival_location_evidence derive these from real linked
  // events, and a comic or festival can genuinely have appeared/run in more
  // than one real city, so a single scalar would silently drop evidence).
  // A record with neither field returns [] -- never a guess.
  function recordCitiesNormalized(record) {
    if (!record) return [];
    if (record.type === "city") {
      var cityName = normalizeText(record.name);
      return cityName ? [cityName] : [];
    }
    var out = [];
    var seen = {};
    if (Array.isArray(record.cities)) {
      record.cities.forEach(function (c) {
        var n = normalizeText(c);
        if (n && !seen[n]) { seen[n] = true; out.push(n); }
      });
    }
    if (record.city) {
      var n2 = normalizeText(record.city);
      if (n2 && !seen[n2]) { seen[n2] = true; out.push(n2); }
    }
    return out;
  }

  // Every distinct real city name the loaded index actually contains,
  // longest-token-count first, so a multi-word city ("New York") is
  // recognised before a shorter one that happens to be a prefix of it.
  // Built from the live data, never a hand-maintained list -- includes
  // cities that only appear in a `cities` array (e.g. a comic who has
  // performed in a city with no dedicated "city" type record of its own),
  // so a comic can be the sole evidence that makes a location recognised.
  function buildCityIndex(records) {
    var seen = {};
    var out = [];
    (records || []).forEach(function (r) {
      recordCitiesNormalized(r).forEach(function (norm) {
        if (!norm || seen[norm]) return;
        seen[norm] = true;
        out.push({ normalized: norm, tokens: norm.split(" ") });
      });
    });
    out.sort(function (a, b) { return b.tokens.length - a.tokens.length; });
    return out;
  }

  // Region counterpart of recordCitiesNormalized (Atlas Wave A1,
  // 2026-08-08 -- scripts/generate_search_index.py's fetch_regions/
  // region-on-every-fetcher work). A `region`-type record's own `name`
  // IS the location (same relationship "city"-type has to its own
  // `name`); every other type carries it as a scalar `region` (event/
  // venue/show/organizer/city -- one region by construction) OR a
  // `regions` array (comic/festival, same "can genuinely span more than
  // one real place" reasoning recordCitiesNormalized's own comment gives
  // for `cities`). A record with none of these returns [] -- never a
  // guess, exactly recordCitiesNormalized's own contract.
  function recordRegionsNormalized(record) {
    if (!record) return [];
    if (record.type === "region") {
      var regionName = normalizeText(record.name);
      return regionName ? [regionName] : [];
    }
    var out = [];
    var seen = {};
    if (Array.isArray(record.regions)) {
      record.regions.forEach(function (r) {
        var n = normalizeText(r);
        if (n && !seen[n]) { seen[n] = true; out.push(n); }
      });
    }
    if (record.region) {
      var n2 = normalizeText(record.region);
      if (n2 && !seen[n2]) { seen[n2] = true; out.push(n2); }
    }
    return out;
  }

  // A record's full location set -- city AND region together -- so a
  // single LOCATION filter (which can resolve to either kind, see
  // buildLocationIndex below) is checked against both in one place.
  function recordLocationsNormalized(record) {
    return recordCitiesNormalized(record).concat(recordRegionsNormalized(record));
  }

  // Region counterpart of buildCityIndex: every distinct real region a
  // `region`-type record's own `name` OR any record's `region`/`regions`
  // field contains -- PLUS one entry per region_aliases row (e.g. "New
  // York State" disambiguating the region from the city "New York" --
  // scripts/enrich/populate_iso_3166_2_regions.py's REGION_ALIASES),
  // each mapped to the region's own CANONICAL normalised name (not the
  // alias's own text) so a query for the alias still filters records via
  // recordRegionsNormalized's canonical values, exactly like an alias
  // match already works for cities via recordHaystackTokens (that path
  // is topic-word matching; this one is location-filter matching, the
  // same alias data serving both).
  // Entries carry BOTH `matchText` (the literal alias/name string a query
  // must equal -- e.g. "new york state") and `normalized` (the CANONICAL
  // value returned as `location` once matched -- e.g. "new york", the
  // region's own DB name, which is what recordRegionsNormalized() puts on
  // every record actually linked to that region). The two differ exactly
  // for an alias entry; extractLocationFilter (below) already compares
  // against `entry.matchText || entry.normalized`, so a plain city/region
  // entry (matchText === normalized, or matchText omitted) behaves exactly
  // as before.
  function buildRegionIndex(records) {
    var seen = {};
    var out = [];
    function addEntry(normalized, tokens) {
      if (!normalized || !tokens.length) return;
      var matchText = tokens.join(" ");
      var key = normalized + "|" + matchText;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ normalized: normalized, tokens: tokens, matchText: matchText });
    }
    (records || []).forEach(function (r) {
      if (!r) return;
      if (r.type === "region") {
        var n = normalizeText(r.name);
        if (n) {
          addEntry(n, n.split(" "));
          if (Array.isArray(r.aliases)) {
            r.aliases.forEach(function (a) { addEntry(n, tokenize(a)); });
          }
        }
      }
      recordRegionsNormalized(r).forEach(function (n2) { addEntry(n2, n2.split(" ")); });
    });
    out.sort(function (a, b) { return b.tokens.length - a.tokens.length; });
    return out;
  }

  // City + region entries together, longest-token-count first -- this is
  // what actually disambiguates "New York State" (region alias, 3
  // tokens) from the city "New York" (2 tokens) when both are real
  // strings in the loaded index: extractLocationFilter (unchanged below)
  // always tries the longest known string first, so the 3-token alias
  // wins over the 2-token city whenever the query contains the extra
  // word, and falls through to the city otherwise.
  function buildLocationIndex(records) {
    return buildCityIndex(records).concat(buildRegionIndex(records))
      .sort(function (a, b) { return b.tokens.length - a.tokens.length; });
  }

  // Scans every contiguous run of query tokens (longest known city/region
  // first) for a match against the supplied location index. Compares
  // against `entry.matchText` when present (an alias's own literal text,
  // e.g. "new york state" -- buildRegionIndex) or `entry.normalized`
  // otherwise (buildCityIndex's entries, unchanged: normalized IS the
  // literal text there, so this is a no-op for every pre-existing city
  // entry). Returns the matched entry's CANONICAL normalised value (or
  // null -- never a guess) plus the remaining tokens -- for an alias
  // match that canonical value is the region's real DB name, not the
  // alias string itself, so it lines up with recordRegionsNormalized().
  function extractLocationFilter(tokens, cityIndex) {
    for (var i = 0; i < cityIndex.length; i++) {
      var entry = cityIndex[i];
      var len = entry.tokens.length;
      if (len > tokens.length) continue;
      var matchText = entry.matchText || entry.normalized;
      for (var start = 0; start + len <= tokens.length; start++) {
        if (tokens.slice(start, start + len).join(" ") === matchText) {
          return {
            location: entry.normalized,
            rest: tokens.slice(0, start).concat(tokens.slice(start + len))
          };
        }
      }
    }
    return { location: null, rest: tokens.slice() };
  }

  function topicTermsFrom(tokens) {
    return tokens.filter(function (t) { return t && GENERIC_TERMS.indexOf(t) === -1; });
  }

  // Parses a raw query string against the records currently loaded into
  // this search: tokenise -> pull out a real known city-OR-region
  // LOCATION filter (buildLocationIndex, Wave A1) -> whatever's left,
  // minus domain-generic words, are the topic terms.
  function parseSearchQuery(query, records) {
    var tokens = tokenize(query);
    var extracted = extractLocationFilter(tokens, buildLocationIndex(records));
    return {
      tokens: tokens,
      location: extracted.location,
      topicTokens: topicTermsFrom(extracted.rest)
    };
  }

  function recordHaystackTokens(record) {
    var parts = [record && record.name];
    if (record && Array.isArray(record.aliases)) parts = parts.concat(record.aliases);
    if (record && record.city) parts.push(record.city);
    if (record && Array.isArray(record.cities)) parts = parts.concat(record.cities);
    if (record && record.region) parts.push(record.region);
    if (record && Array.isArray(record.regions)) parts = parts.concat(record.regions);
    if (record && record.region_code) parts.push(record.region_code);
    if (record && record.country) parts.push(record.country);
    if (record && Array.isArray(record.countries)) parts = parts.concat(record.countries);
    if (record && record.status) parts.push(record.status);
    return tokenize(parts.filter(Boolean).join(" "));
  }

  // Tokenised matching -- never a substring test against the whole
  // haystack string, always token vs token (exact or prefix), so e.g. a
  // query token "new" only matches a record token that STARTS with "new",
  // not any record whose combined text happens to contain "new" mid-word.
  function matchesTopics(record, topicTokens) {
    if (!topicTokens.length) return true;
    var haystack = recordHaystackTokens(record);
    return topicTokens.every(function (qt) {
      return haystack.some(function (rt) { return rt.indexOf(qt) === 0; });
    });
  }

  function recordMatchesQuery(record, parsed) {
    if (parsed.location && recordLocationsNormalized(record).indexOf(parsed.location) === -1) return false;
    return matchesTopics(record, parsed.topicTokens);
  }

  // Deterministic ranking within a type group: exact name match (0), then
  // name-starts-with (1), then everything else that matched on tokens
  // alone (2) -- no fuzzy library, no invented relevance score.
  function rankRecord(record, normalizedQuery) {
    if (!normalizedQuery) return 2;
    var name = normalizeText(record && record.name);
    if (name === normalizedQuery) return 0;
    if (name.indexOf(normalizedQuery) === 0) return 1;
    return 2;
  }

  // Main entry point: raw search_index.json records + a raw query string ->
  // results grouped by real entity type, in TYPE_ORDER, each group carrying
  // a real count. An empty/whitespace query returns no groups (the "type
  // to search" empty-before-typing state is the caller's concern).
  function searchRecords(records, query, opts) {
    opts = opts || {};
    var limit = typeof opts.limit === "number" ? opts.limit : 8;
    var list = Array.isArray(records) ? records.filter(function (r) { return r && typeof r === "object"; }) : [];
    var q = String(query == null ? "" : query).trim();
    if (!q) return { groups: [], total: 0, location: null, topicTokens: [] };

    var parsed = parseSearchQuery(q, list);
    var normalizedQuery = normalizeText(q);
    var matched = list.filter(function (r) { return recordMatchesQuery(r, parsed); });

    var groups = [];
    var total = 0;
    TYPE_ORDER.forEach(function (type) {
      var forType = matched.filter(function (r) { return r.type === type; });
      if (!forType.length) return;
      forType.sort(function (a, b) {
        var ra = rankRecord(a, normalizedQuery), rb = rankRecord(b, normalizedQuery);
        if (ra !== rb) return ra - rb;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      total += forType.length;
      groups.push({ type: type, label: TYPE_LABELS[type] || type, count: forType.length, items: forType.slice(0, limit) });
    });

    return { groups: groups, total: total, location: parsed.location, topicTokens: parsed.topicTokens };
  }

  // Fetch + parse search_index.json without ever throwing or rejecting --
  // any failure (network error, non-ok status, malformed JSON, non-array
  // payload) resolves to { records: [], failed: true } instead. This is
  // what lets the mounted UI degrade to "keyword search unavailable, city
  // map search still works" rather than taking the page down; factored out
  // as a pure function (fetchImpl injectable) so that degradation is
  // provable without a DOM -- see tests/test_globe_search.py.
  function loadSearchIndexSafely(fetchImpl, url) {
    var f = typeof fetchImpl === "function" ? fetchImpl : fetch;
    return f(url, { cache: "no-store" }).then(function (r) {
      if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
      return r.json();
    }).then(function (raw) {
      if (!Array.isArray(raw)) throw new Error("search_index.json: unexpected shape");
      return { records: raw, failed: false };
    }).catch(function () {
      return { records: [], failed: true };
    });
  }

  // One idempotent, scoped <style> injection for the search-results
  // dropdown -- same pattern globe/search.js already uses for its own
  // topbar dropdown (globe-chrome.css is frozen there for the same reason
  // atlas-visuals.css is a separate owned file here: this stays a small,
  // self-contained addition rather than a cross-file edit). Reads only
  // the page's own existing --card/--border/--bg/--text/--muted/--gold
  // tokens (see atlas-visuals.css's header comment) so it looks like part
  // of this component, not a bolted-on widget, in both themes for free.
  var SEARCH_RESULTS_STYLE_ID = "atlas-viz-search-results-styles";
  function injectSearchResultsStylesOnce() {
    if (typeof document === "undefined" || document.getElementById(SEARCH_RESULTS_STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = SEARCH_RESULTS_STYLE_ID;
    style.textContent =
      ".atlas-viz-search-results{position:absolute;left:0;right:0;top:100%;margin-top:6px;z-index:20;" +
      "max-height:340px;overflow-y:auto;background:var(--card);border:1px solid var(--border);" +
      "border-radius:10px;box-shadow:0 12px 28px rgba(0,0,0,.35);font-size:12.5px}" +
      ".atlas-viz-search-results[hidden]{display:none}" +
      ".atlas-viz-search-status{padding:10px 12px;color:var(--muted)}" +
      ".atlas-viz-search-group{padding:8px 12px 2px;font-size:10.5px;font-weight:700;letter-spacing:.06em;" +
      "text-transform:uppercase;color:var(--gold)}" +
      ".atlas-viz-search-item{padding:7px 12px;cursor:pointer;border-top:1px solid var(--border)}" +
      ".atlas-viz-search-item:first-of-type{border-top:none}" +
      ".atlas-viz-search-item:hover{background:var(--bg)}" +
      ".atlas-viz-search-item-name{font-weight:600;color:var(--text)}" +
      ".atlas-viz-search-item-meta{color:var(--muted);font-size:11.5px;margin-top:1px}";
    document.head.appendChild(style);
  }

  // Radius scale: sqrt (perceptually linear-ish for circle area), clamped
  // to [MIN_R, MAX_R], driven entirely by a point's own real `count` — no
  // dot is sized off anything the data doesn't say.
  function radiusFor(count, maxCount) {
    if (!maxCount || maxCount <= 0) return MIN_R;
    var t = Math.sqrt(Math.max(count, 0)) / Math.sqrt(maxCount);
    return MIN_R + (MAX_R - MIN_R) * t;
  }

  // --- Main mount -----------------------------------------------------
  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};
    var Layers = global.AtlasLayers;
    var Data = global.AtlasVisualsData;
    if (!Layers || !Data) {
      // Defensive: a stale cached copy of one file without the other
      // should never throw and take out the rest of the page.
      return null;
    }

    var activeLayers = {};
    Layers.LAYERS.forEach(function (l) { activeLayers[l.id] = !!l.defaultVisible; });
    var searchQuery = "";
    var latestData = { cities: [], venues: [], eventsLoaded: false };
    var linkedKey = null;

    injectSearchResultsStylesOnce();

    // -- DOM scaffold --
    container.innerHTML = "";
    var section = el("section", { class: "atlas-viz", "aria-labelledby": "atlas-viz-heading" });
    var shell = el("div", { class: "atlas-viz-shell" });

    var head = el("div", { class: "atlas-viz-head" });
    head.appendChild(el("h2", { id: "atlas-viz-heading", class: "atlas-viz-title" }, "Explore live comedy worldwide"));
    var searchWrap = el("div", { class: "atlas-viz-search" });
    var searchLabel = el("label", { for: "atlas-viz-search-input", class: "skip-link", style: "position:static;left:auto;width:1px;height:1px;overflow:hidden;padding:0;display:inline-block" }, "Search cities, venues, comics, shows and festivals");
    var searchInput = el("input", {
      id: "atlas-viz-search-input", type: "search", placeholder: "Search cities, venues, comics, shows…",
      autocomplete: "off", "aria-label": "Search cities, venues, comics, shows and festivals",
      role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list",
      "aria-controls": "atlas-viz-search-results"
    });
    var searchResults = el("div", {
      class: "atlas-viz-search-results", id: "atlas-viz-search-results",
      role: "listbox", "aria-label": "Search results", hidden: "hidden"
    });
    searchWrap.appendChild(searchLabel);
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(searchResults);
    head.appendChild(searchWrap);
    shell.appendChild(head);

    var layersRow = el("div", { class: "atlas-viz-layers", role: "group", "aria-label": "Map layers" });
    var toggleEls = {};
    Layers.LAYERS.forEach(function (layer) {
      var id = "atlas-layer-toggle-" + layer.id;
      var label = el("label", {
        class: "atlas-layer-toggle", for: id,
        style: "--layer-color:var(" + layer.color + ")",
        title: layer.description || ""
      });
      var cb = el("input", { type: "checkbox", id: id, "data-layer-id": layer.id });
      cb.checked = !!layer.defaultVisible;
      var dot = el("span", { class: "dot", "aria-hidden": "true" });
      var text = el("span", {}, esc(layer.icon || "") + " " + esc(layer.label));
      var count = el("span", { class: "count", "data-role": "layer-count" }, "");
      label.appendChild(cb);
      label.appendChild(dot);
      label.appendChild(text);
      label.appendChild(count);
      label.setAttribute("data-checked", cb.checked ? "true" : "false");
      cb.addEventListener("change", function () {
        activeLayers[layer.id] = cb.checked;
        label.setAttribute("data-checked", cb.checked ? "true" : "false");
        applyVisibility();
      });
      toggleEls[layer.id] = { label: label, checkbox: cb, countEl: count };
      layersRow.appendChild(label);
    });
    shell.appendChild(layersRow);

    // Loading indicator: only ever shown if loadDetail() genuinely takes a
    // moment (see the setTimeout in the load sequence below) -- a screenshot
    // taken any time after data is actually ready must never carry a
    // spinner as the headline visual, so this starts hidden rather than
    // visible-by-default.
    var loadingRow = el("div", { class: "atlas-viz-loading", id: "atlas-viz-loading", hidden: "hidden" });
    loadingRow.appendChild(el("span", { class: "spinner-sm", "aria-hidden": "true" }));
    var loadingText = el("span", {}, "Loading show counts…");
    loadingRow.appendChild(loadingText);
    shell.appendChild(loadingRow);

    var body = el("div", { class: "atlas-viz-body" });

    var mapWrap = el("div", { class: "atlas-map-wrap" });
    var svg = svgEl("svg", {
      class: "atlas-map-svg", viewBox: "0 0 " + VB_W + " " + VB_H,
      role: "img", "aria-hidden": "true", focusable: "false"
    });
    buildSurface(svg);
    buildGraticule(svg);
    var pointLayerGroups = {};
    var labelGroup = svgEl("g", { class: "atlas-map-labels" });
    Layers.LAYERS.forEach(function (layer) {
      var g = svgEl("g", { "data-layer-group": layer.id });
      pointLayerGroups[layer.id] = g;
      svg.appendChild(g);
    });
    svg.appendChild(labelGroup);
    mapWrap.appendChild(svg);
    var emptyNote = el("div", { class: "atlas-map-empty-note", id: "atlas-map-empty-note", hidden: "hidden" }, "");
    mapWrap.appendChild(emptyNote);
    body.appendChild(mapWrap);

    // -- Accessible fallback / primary-for-screen-readers list --
    var listPanel = el("div", { class: "atlas-viz-list-panel" });
    var listHeading = el("div", { class: "atlas-viz-list-heading", id: "atlas-viz-list-heading" },
      "All cities (<span data-role=\"list-count\">0</span>)");
    listPanel.appendChild(listHeading);
    var list = el("ul", {
      class: "atlas-viz-list", id: "atlas-viz-list",
      "aria-labelledby": "atlas-viz-list-heading"
    });
    listPanel.appendChild(list);
    var comicsNote = el("p", { class: "atlas-viz-comics-note", id: "atlas-viz-comics-note" },
      "Comic-level map data isn't published yet — see the Comics layer for details. " +
      "City and venue locations above are real, published coordinates.");
    listPanel.appendChild(comicsNote);
    body.appendChild(listPanel);

    shell.appendChild(body);
    section.appendChild(shell);
    container.appendChild(section);

    // -- noscript-equivalent note for JS-heavy-rendering-unavailable --
    // The rest of this hero (and the rest of index.html's main listings)
    // is JS-rendered already, same as today's page; <noscript> can't help
    // with fetch-driven content, so this mirrors the existing site
    // convention rather than inventing a new one.

    // -- Surface / grid ------------------------------------------------
    function buildSurface(svgRoot) {
      var defs = svgEl("defs", {});
      var waterGrad = svgEl("radialGradient", {
        id: "atlas-water-grad", cx: "32%", cy: "30%", r: "85%"
      });
      waterGrad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "var(--atlas-map-water-hi)" }));
      waterGrad.appendChild(svgEl("stop", { offset: "55%", "stop-color": "var(--atlas-map-water)" }));
      waterGrad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "var(--atlas-map-water-lo)" }));
      defs.appendChild(waterGrad);

      var vignette = svgEl("radialGradient", { id: "atlas-vignette", cx: "50%", cy: "45%", r: "75%" });
      vignette.appendChild(svgEl("stop", { offset: "60%", "stop-color": "#000", "stop-opacity": "0" }));
      vignette.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#000", "stop-opacity": "0.35" }));
      defs.appendChild(vignette);

      var glow = svgEl("filter", { id: "atlas-dot-glow", x: "-150%", y: "-150%", width: "400%", height: "400%" });
      glow.appendChild(svgEl("feGaussianBlur", { stdDeviation: "3.2", result: "blur" }));
      defs.appendChild(glow);

      svgRoot.appendChild(defs);
      svgRoot.appendChild(svgEl("rect", { x: 0, y: 0, width: VB_W, height: VB_H, fill: "url(#atlas-water-grad)" }));
      svgRoot.appendChild(svgEl("rect", { x: 0, y: 0, width: VB_W, height: VB_H, fill: "url(#atlas-vignette)" }));
    }

    function buildGraticule(svgRoot) {
      var g = svgEl("g", { class: "atlas-graticule" });
      for (var lon = -180; lon <= 180; lon += 30) {
        var p1 = project(90, lon), p2 = project(-90, lon);
        g.appendChild(svgEl("line", {
          class: "atlas-grid-line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y
        }));
      }
      for (var lat = -60; lat <= 90; lat += 30) {
        var q1 = project(lat, -180), q2 = project(lat, 180);
        g.appendChild(svgEl("line", {
          class: "atlas-grid-line", x1: q1.x, y1: q1.y, x2: q2.x, y2: q2.y
        }));
      }
      // Equator + prime meridian get a slightly stronger line -- a small
      // orientation cue on an otherwise unlabeled grid.
      var eq1 = project(0, -180), eq2 = project(0, 180);
      g.appendChild(svgEl("line", { class: "atlas-grid-line atlas-grid-line-major", x1: eq1.x, y1: eq1.y, x2: eq2.x, y2: eq2.y }));
      var pm1 = project(90, 0), pm2 = project(-90, 0);
      g.appendChild(svgEl("line", { class: "atlas-grid-line atlas-grid-line-major", x1: pm1.x, y1: pm1.y, x2: pm2.x, y2: pm2.y }));
      svgRoot.appendChild(g);
    }

    // -- Navigation with a real existence check -------------------------
    // A `confirmed` point's canonical href (AtlasLayers.canonicalCityHref)
    // is the real slugified route, but this repo's own generator only
    // builds that page for a city once its export clears a >=1-event bar
    // -- and that generation run can lag the currently-loaded data (see
    // atlas-layers.js's canonicalCityHref comment for the live evidence:
    // 33/35 real event-bearing cities resolved, 2 didn't, on 2026-07-27).
    // A plain <a href> can't know that at render time, so a real left-
    // click gets a same-origin HEAD check first; middle-click/ctrl-click/
    // cmd-click (open in new tab) is left alone and uses whatever href is
    // already on the element, same as any normal link on the web.
    // Factored out of the click handler so the new search dropdown (below)
    // can send a "city" result through the EXACT same real-existence-check
    // navigation -- not a second, possibly-drifting copy of it.
    function navigateToCity(cityName, confirmed) {
      var fallback = Layers.fallbackCityHref(cityName);
      if (!confirmed) {
        global.location.href = fallback;
        return;
      }
      var canonical = Layers.canonicalCityHref(cityName);
      fetch(canonical, { method: "HEAD", cache: "no-store" }).then(function (r) {
        global.location.href = (r && r.ok) ? canonical : fallback;
      }).catch(function () {
        global.location.href = fallback;
      });
    }

    function wireCityLink(a, entity) {
      a.addEventListener("click", function (ev) {
        if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        navigateToCity(entity.cityName, !!entity.confirmed);
      });
    }

    // -- Hover/focus linking between the map and the list ----------------
    function setLinked(key) {
      if (key === linkedKey) return;
      linkedKey = key;
      var nodes = shell.querySelectorAll("[data-city-key]");
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle("is-linked", !!key && nodes[i].getAttribute("data-city-key") === key);
      }
    }

    // -- Rendering --------------------------------------------------
    // Multiple layers routinely share the exact same real coordinate (a
    // city's Shows, Festivals and Open Mics points all sit at that same
    // city centroid) -- drawn undisturbed they stack into one
    // indistinguishable blob AND become impossible to individually hover/
    // click. `layerIndex` fans each layer's point out a few px around the
    // true point in a small deterministic ring (same idea as marker-
    // clustering "spiderfy" in any map UI) -- cosmetic only, the anchor
    // for hover-linking/labels/list rows stays the real projected
    // coordinate (see the label/glow code below, which uses `pos`, not
    // the offset `drawPos`).
    var LAYER_OFFSET_PX = 6;
    function layerOffset(layerIndex, pos) {
      if (!layerIndex) return pos;
      var angle = (layerIndex / Layers.LAYERS.length) * Math.PI * 2;
      return {
        x: pos.x + Math.cos(angle) * LAYER_OFFSET_PX,
        y: pos.y + Math.sin(angle) * LAYER_OFFSET_PX
      };
    }

    function pointNode(layer, point, opts2) {
      opts2 = opts2 || {};
      var truePos = project(point.lat, point.lon);
      var pos = layerOffset(opts2.layerIndex || 0, truePos);
      var key = cityKey(point.cityName || point.label);
      var g = svgEl("a", {
        class: "atlas-map-point", href: Layers.entityHref(layer.id, point) || "#",
        "data-layer": layer.id,
        "data-label": (point.label || "").toLowerCase(),
        "data-city-key": key,
        role: "link",
        "aria-label": point.label + (point.countLabel ? (", " + point.countLabel) : "") + " — explore this city"
      });
      var r = radiusFor(point.count, opts2.maxCount);
      var glowCircle = svgEl("circle", {
        class: "atlas-map-point-glow", cx: pos.x, cy: pos.y, r: r * 1.7,
        fill: "var(" + layer.color + ")", filter: "url(#atlas-dot-glow)"
      });
      var coreCircle = svgEl("circle", {
        class: "atlas-map-point-core", cx: pos.x, cy: pos.y, r: r,
        fill: "var(" + layer.color + ")"
      });
      g.appendChild(glowCircle);
      g.appendChild(coreCircle);
      var title = svgEl("title", {});
      title.textContent = point.label + (point.countLabel ? (" — " + point.countLabel) : "");
      g.appendChild(title);
      if (!prefersReducedMotion()) g.classList.add("is-entering");

      g.addEventListener("mouseenter", function () { setLinked(key); });
      g.addEventListener("mouseleave", function () { setLinked(null); });
      g.addEventListener("focus", function () { setLinked(key); });
      g.addEventListener("blur", function () { setLinked(null); });
      wireCityLink(g, point);

      if (opts2.labeled) {
        var labelX = pos.x + r + 5;
        var flip = labelX > VB_W - 60; // keep labels on-canvas near the right edge
        var text = svgEl("text", {
          class: "atlas-map-label", x: flip ? (pos.x - r - 5) : labelX, y: pos.y + 3.5,
          "text-anchor": flip ? "end" : "start", "data-city-key": key
        });
        text.textContent = point.label;
        labelGroup.appendChild(text);
      }

      return g;
    }

    function renderPoints(data) {
      latestData = data;
      var showPoints = Layers.resolvePoints("shows", data);
      var maxCount = showPoints.reduce(function (m, p) { return Math.max(m, p.count || 0); }, 0);

      // Direct map labels, biggest-real-city-first, but SKIPPED (not just
      // capped) when they'd land within MIN_LABEL_DIST px of an
      // already-placed label -- several of the real cities in this data
      // (Berlin/Cologne/Amsterdam/Paris/Barcelona) sit close enough
      // together in real lat/lon that an uncoditional top-N-by-count
      // label set overlapped into an unreadable cluster. Falls through to
      // the next-biggest city instead of just stopping, so the map still
      // ends up with up to TOP_LABEL_COUNT labels when the geography
      // allows it, geographically spread rather than crowded.
      var labelKeys = {};
      if (data.eventsLoaded) {
        var placed = [];
        var MIN_LABEL_DIST = 30;
        showPoints.slice().sort(function (a, b) { return b.count - a.count; }).forEach(function (p) {
          if (Object.keys(labelKeys).length >= TOP_LABEL_COUNT) return;
          var pos = project(p.lat, p.lon);
          var tooClose = placed.some(function (q) {
            var dx = q.x - pos.x, dy = q.y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) < MIN_LABEL_DIST;
          });
          if (tooClose) return;
          placed.push(pos);
          labelKeys[cityKey(p.cityName)] = true;
        });
      }

      while (labelGroup.firstChild) labelGroup.removeChild(labelGroup.firstChild);

      Layers.LAYERS.forEach(function (layer, layerIndex) {
        var group = pointLayerGroups[layer.id];
        while (group.firstChild) group.removeChild(group.firstChild);
        var points = Layers.resolvePoints(layer.id, data);
        points.forEach(function (p) {
          var labeled = layer.id === "shows" && !!labelKeys[cityKey(p.cityName)];
          group.appendChild(pointNode(layer, p, { maxCount: maxCount, labeled: labeled, layerIndex: layerIndex }));
        });
        var t = toggleEls[layer.id];
        if (t) {
          if (layer.id === "comics" && points.length === 0) {
            t.countEl.textContent = "no data yet";
          } else if (!data.eventsLoaded && (layer.id === "festivals" || layer.id === "openmics" || layer.id === "venues")) {
            t.countEl.textContent = "…";
          } else {
            t.countEl.textContent = String(points.length);
          }
        }
      });
      renderList(data);
      applyVisibility();
    }

    function renderList(data) {
      // "Every city the map claims" = exactly the Shows layer's resolved
      // points (the most-inclusive layer — every other layer is a subset
      // of the same city set). Deriving the list from the same resolver
      // the map itself uses, rather than a second hand-rolled filter,
      // is what keeps this invariant true by construction instead of by
      // convention (see tests/test_atlas_visuals_registry.py).
      var showPoints = Layers.resolvePoints("shows", data);
      list.innerHTML = "";
      var q = searchQuery.trim().toLowerCase();
      var shown = 0;
      showPoints
        .slice()
        .sort(function (a, b) { return a.label.localeCompare(b.label); })
        .forEach(function (p) {
          if (q && p.label.toLowerCase().indexOf(q) === -1) return;
          shown += 1;
          var key = cityKey(p.cityName);
          var li = el("li", { "data-city-key": key });
          var a = el("a", { href: Layers.entityHref("shows", p) || "#" },
            '<span class="avl-name">' + esc(p.label) + '</span>' +
            '<span class="avl-meta">' + esc(p.countLabel || "") + ' · Explore this city →</span>');
          li.appendChild(a);
          list.appendChild(li);
          a.addEventListener("mouseenter", function () { setLinked(key); });
          a.addEventListener("mouseleave", function () { setLinked(null); });
          a.addEventListener("focus", function () { setLinked(key); });
          a.addEventListener("blur", function () { setLinked(null); });
          wireCityLink(a, p);
        });
      if (shown === 0) {
        var emptyLi = el("li", {}, '<div class="avl-empty">No cities match "' + esc(searchQuery) + '".</div>');
        list.appendChild(emptyLi);
      }
      var countTargets = shell.querySelectorAll('[data-role="list-count"]');
      for (var i = 0; i < countTargets.length; i++) countTargets[i].textContent = String(shown);
    }

    function applyVisibility() {
      var q = searchQuery.trim().toLowerCase();
      var anyVisible = false;
      Layers.LAYERS.forEach(function (layer) {
        var group = pointLayerGroups[layer.id];
        var on = !!activeLayers[layer.id];
        var nodes = group.querySelectorAll(".atlas-map-point");
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          var matchesSearch = !q || (node.getAttribute("data-label") || "").indexOf(q) !== -1;
          var visible = on && matchesSearch;
          node.classList.toggle("is-hidden", !visible);
          if (visible) anyVisible = true;
        }
      });
      // Direct map labels track the Shows layer's own visibility (they're
      // only ever attached to Shows-layer points, see pointNode's
      // `opts2.labeled`) plus the same search filter as every other point.
      var showsOn = !!activeLayers.shows;
      var labelNodes = labelGroup.querySelectorAll(".atlas-map-label");
      for (var j = 0; j < labelNodes.length; j++) {
        var lnode = labelNodes[j];
        var lMatchesSearch = !q || lnode.textContent.toLowerCase().indexOf(q) !== -1;
        lnode.classList.toggle("is-hidden", !showsOn || !lMatchesSearch);
      }
      renderList(latestData);
      if (!anyVisible) {
        emptyNote.hidden = false;
        emptyNote.textContent = q
          ? "No cities on the map match \"" + searchQuery + "\"."
          : "No layers selected.";
      } else {
        emptyNote.hidden = true;
      }
    }

    // -- Keyword search dropdown (multi-entity, grouped) -----------------
    // Independent of, and never blocking, the existing city-only map/list
    // filtering above: that filtering runs entirely off AtlasVisualsData
    // (already loaded for the map itself) and keeps working unchanged even
    // if this dropdown never loads. search_index.json (~1.8MB, by far the
    // largest payload this page can touch) is fetched lazily -- only once
    // the visitor actually starts typing -- and only once.
    var searchIndexRecords = null; // null = not loaded yet
    var searchIndexFailed = false;
    var searchIndexLoadStarted = false;
    var searchResultsTimer = null;
    var searchFlatItems = []; // [{record, el}] in on-screen order, for Enter/click

    function closeSearchResults() {
      searchResults.hidden = true;
      searchInput.setAttribute("aria-expanded", "false");
    }

    function selectSearchRecord(record) {
      if (!record) return;
      if (record.type === "city") {
        // search_index.json's fetch_cities() only ever indexes a city that
        // has already cleared the >=1-event bar generate_city_pages.py
        // requires (see generate_search_index.py's own comment on that
        // function) -- so this is real evidence, not an assumption, that
        // navigateToCity's HEAD-checked canonical route is worth trying.
        navigateToCity(record.name, true);
      } else if (record.url) {
        // Every other type's `url` is already the real, absolute, published
        // canonical page (scripts/generate_search_index.py builds it from
        // the same slug the corresponding page generator writes) -- no
        // second existence check needed, nothing invented.
        global.location.href = record.url;
      }
      searchInput.value = "";
      searchQuery = "";
      applyVisibility();
      closeSearchResults();
    }

    function renderSearchResults() {
      searchResults.innerHTML = "";
      searchFlatItems = [];
      var q = searchQuery.trim();

      if (!q) { closeSearchResults(); return; }

      if (searchIndexRecords === null && !searchIndexFailed) {
        searchResults.appendChild(el("div", { class: "atlas-viz-search-status", role: "status" }, "Loading search index…"));
        searchResults.hidden = false;
        searchInput.setAttribute("aria-expanded", "true");
        return;
      }

      if (searchIndexFailed) {
        searchResults.appendChild(el("div", { class: "atlas-viz-search-status", role: "alert" },
          "Keyword search is temporarily unavailable — showing city map search only."));
        searchResults.hidden = false;
        searchInput.setAttribute("aria-expanded", "true");
        return;
      }

      var result = searchRecords(searchIndexRecords, q);

      if (result.total === 0) {
        searchResults.appendChild(el("div", { class: "atlas-viz-search-status", role: "status" },
          'No results for "' + esc(q) + '".'));
        searchResults.hidden = false;
        searchInput.setAttribute("aria-expanded", "true");
        return;
      }

      result.groups.forEach(function (group) {
        searchResults.appendChild(el("div", { class: "atlas-viz-search-group", role: "presentation" },
          esc(group.label) + " (" + group.count + ")"));
        group.items.forEach(function (record) {
          var item = el("div", {
            class: "atlas-viz-search-item", role: "option",
            id: "atlas-viz-search-item-" + searchFlatItems.length, tabindex: "-1"
          });
          item.appendChild(el("div", { class: "atlas-viz-search-item-name" }, esc(record.name || "")));
          var metaBits = [];
          if (record.city) metaBits.push(record.country ? record.city + ", " + record.country : record.city);
          if (record.status) metaBits.push(record.status);
          if (metaBits.length) item.appendChild(el("div", { class: "atlas-viz-search-item-meta" }, esc(metaBits.join(" · "))));
          item.addEventListener("mousedown", function (ev) {
            ev.preventDefault(); // fires before the input's blur
            selectSearchRecord(record);
          });
          searchResults.appendChild(item);
          searchFlatItems.push({ record: record, el: item });
        });
      });
      searchResults.hidden = false;
      searchInput.setAttribute("aria-expanded", "true");
    }

    function scheduleSearchResultsRender() {
      if (searchResultsTimer) global.clearTimeout(searchResultsTimer);
      searchResultsTimer = global.setTimeout(renderSearchResults, 150);
    }

    function loadSearchIndexOnce() {
      if (searchIndexLoadStarted) return;
      searchIndexLoadStarted = true;
      loadSearchIndexSafely(fetch, SEARCH_INDEX_URL).then(function (result) {
        searchIndexRecords = result.records;
        searchIndexFailed = result.failed;
        renderSearchResults();
        if (result.failed && global.console && global.console.warn) {
          global.console.warn("Atlas Visuals search: search_index.json failed to load; degrading to city-only search.");
        }
      });
    }

    searchInput.addEventListener("input", function () {
      searchQuery = searchInput.value || "";
      applyVisibility();
      loadSearchIndexOnce();
      scheduleSearchResultsRender();
    });

    searchInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !searchResults.hidden) {
        ev.preventDefault();
        closeSearchResults();
      } else if (ev.key === "Enter" && searchFlatItems.length && !searchResults.hidden) {
        ev.preventDefault();
        selectSearchRecord(searchFlatItems[0].record);
      }
    });

    searchInput.addEventListener("blur", function () {
      // Delayed so a mousedown-selected item's own handler still runs first.
      global.setTimeout(closeSearchResults, 120);
    });

    // -- Load data --------------------------------------------------
    // The loading row only appears if loadDetail() (the 5MB fetch) is
    // still pending after a short grace period -- a fast connection (or
    // this task's own test fixtures) never shows it at all, so "loading"
    // is never what a screenshot captures under normal conditions.
    var loadingTimer = global.setTimeout(function () { loadingRow.hidden = false; }, 400);

    Data.loadCore().then(function (core) {
      renderPoints(core);
      return Data.loadDetail(core);
    }).then(function (full) {
      clearTimeout(loadingTimer);
      renderPoints(full);
      loadingRow.hidden = true;
    }).catch(function (err) {
      clearTimeout(loadingTimer);
      loadingText.textContent = "Some map data couldn't load. City locations shown are still real; counts may be incomplete.";
      loadingRow.hidden = false;
      // Never throw out of a promise chain the caller didn't await —
      // logging keeps this out of the "uncaught exception" console-error
      // class the evidence harness checks for.
      if (global.console && global.console.warn) global.console.warn("Atlas Visuals: " + (err && err.message));
    });

    return {
      // Exposed for tests/debugging only — the renderer doesn't need
      // these itself.
      _activeLayers: activeLayers,
      _setSearch: function (q) { searchInput.value = q; searchQuery = q; applyVisibility(); },
      _toggleLayer: function (id, on) {
        var t = toggleEls[id];
        if (!t) return;
        t.checkbox.checked = on;
        t.checkbox.dispatchEvent(new Event("change"));
      }
    };
  }

  // Pure search functions, exposed for tests (tests/test_globe_search.py)
  // independently of mount() -- no DOM/fetch needed to exercise them.
  var AtlasVisualsSearch = {
    SEARCH_INDEX_URL: SEARCH_INDEX_URL,
    TYPE_LABELS: TYPE_LABELS,
    TYPE_ORDER: TYPE_ORDER,
    GENERIC_TERMS: GENERIC_TERMS,
    normalizeText: normalizeText,
    tokenize: tokenize,
    buildCityIndex: buildCityIndex,
    recordRegionsNormalized: recordRegionsNormalized,
    recordLocationsNormalized: recordLocationsNormalized,
    buildRegionIndex: buildRegionIndex,
    buildLocationIndex: buildLocationIndex,
    extractLocationFilter: extractLocationFilter,
    parseSearchQuery: parseSearchQuery,
    recordMatchesQuery: recordMatchesQuery,
    rankRecord: rankRecord,
    searchRecords: searchRecords,
    loadSearchIndexSafely: loadSearchIndexSafely
  };

  global.AtlasVisuals = { mount: mount, project: project, search: AtlasVisualsSearch };
})(window);
