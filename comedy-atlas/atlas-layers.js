/*
 * COMEDY ATLAS — Atlas Visuals v1: layer registry (site/comedy-atlas/atlas-layers.js)
 *
 * This file is the SECOND of three deliberately separate concerns
 * (data adapter -> layer registry -> renderer, see ATLAS-VISUALS-V1 brief):
 *
 *   atlas-visuals-data.js  fetches + normalizes the already-published
 *                          exports (cities.json, upcoming_events.json, ...).
 *   atlas-layers.js        (this file) — a DECLARATIVE table describing
 *                          every layer: id, label, colour token, icon,
 *                          default visibility, and how an entity in that
 *                          layer resolves to a link. Adding a layer means
 *                          adding one entry to LAYERS + one RESOLVERS
 *                          function — nothing in atlas-visuals.js (the
 *                          renderer) has to change, because the renderer
 *                          only ever calls AtlasLayers.resolvePoints(id,
 *                          data) and AtlasLayers.entityHref(id, entity)
 *                          generically, for whichever layers LAYERS
 *                          contains.
 *   atlas-visuals.js       consumes the registry + normalized data and
 *                          draws it. Swappable later (a real map library,
 *                          a different projection) without touching this
 *                          file or the data adapter.
 *
 * HARD RULE — never fabricate a location or a count (this project has a
 * documented history of invented data causing real damage, see
 * feedback_source_declared_category_can_be_overbroad.md /
 * feedback_event_times_render_in_own_timezone.md in the ops memory). Every
 * resolver below reads real published lat/lon or a real derived count;
 * none of them guess, round up, or interpolate a coordinate. Where the
 * underlying export genuinely has no location for an entity (comics: no
 * comics.json / comedian-per-event field is published anywhere today —
 * verified 2026-07-27, see the v1 scope note in the "comics" resolver
 * below), the resolver returns an empty list rather than a plausible-
 * looking guess.
 */
(function (global) {
  "use strict";

  // --- The registry -------------------------------------------------------
  // `color` is a CSS custom-property NAME (not a literal colour) — the
  // renderer/CSS own the actual values so a future theme or brand refresh
  // touches CSS only, never this file.
  var LAYERS = [
    {
      id: "shows",
      label: "Shows",
      icon: "🎤", // microphone
      color: "--atlas-layer-shows",
      defaultVisible: true,
      granularity: "city",
      description: "Every city with at least one real, currently-published show."
    },
    {
      id: "venues",
      label: "Venues",
      icon: "📍", // round pushpin
      color: "--atlas-layer-venues",
      defaultVisible: true,
      granularity: "venue",
      description: "Individual venues with a published street coordinate — about a " +
        "quarter of listed shows carry one today, the rest are honestly left off this " +
        "layer rather than placed at a guessed point."
    },
    {
      id: "comics",
      label: "Comics",
      icon: "🎭", // performing arts
      color: "--atlas-layer-comics",
      defaultVisible: false,
      granularity: "none",
      description: "Not available in v1 — no comic-level location data is published " +
        "in any COMEDY ATLAS export today. This layer is wired into the registry so a " +
        "future comics.json export lights it up with zero renderer changes; until then " +
        "it always resolves to zero points, on purpose."
    },
    {
      id: "festivals",
      label: "Festivals",
      icon: "🎪", // circus tent
      color: "--atlas-layer-festivals",
      defaultVisible: true,
      granularity: "city",
      description: "Cities hosting at least one show flagged is_festival in the live data."
    },
    {
      id: "openmics",
      label: "Open Mics",
      icon: "🎙️", // studio microphone
      color: "--atlas-layer-openmics",
      defaultVisible: false,
      granularity: "city",
      description: "Cities with at least one show whose title identifies it as an open " +
        "mic (the same title-keyword heuristic atlas-common.js's deriveFormat already " +
        "uses elsewhere on the site — genre alone doesn't carry this signal yet)."
    }
  ];

  function layerById(id) {
    for (var i = 0; i < LAYERS.length; i++) {
      if (LAYERS[i].id === id) return LAYERS[i];
    }
    return null;
  }

  // --- Point validity -------------------------------------------------
  // Shared guard every resolver's output passes through: a point with a
  // non-finite lat/lon never reaches the renderer. This is what makes
  // "no fabricated coordinates" an enforceable invariant rather than a
  // convention each resolver has to remember.
  function isValidPoint(p) {
    return !!p &&
      typeof p.lat === "number" && isFinite(p.lat) &&
      typeof p.lon === "number" && isFinite(p.lon);
  }

  // --- Resolvers ------------------------------------------------------
  // Each resolver takes the normalized data object produced by
  // atlas-visuals-data.js (AtlasVisualsData.normalize()) and returns an
  // array of point records: { id, lat, lon, label, count, cityName,
  // confirmed }. `data.cities` always carries every city's REAL published
  // centroid (cities.json, 100% coverage — verified 2026-07-27) even
  // before the (much larger) events export has loaded; `count`/`shows`/etc.
  // fields are 0 until detail data arrives, never a placeholder pretending
  // to be real. `data.eventsLoaded` tells a resolver (and the renderer)
  // whether a 0 is a confirmed zero or just "not counted yet".
  //
  // `confirmed` (2026-07-27, routing fix): true only when THIS point was
  // derived from the real, loaded upcoming_events.json — i.e. the exact
  // same "does this city clear the >=1-event bar" test
  // scripts/generate_city_pages.py's own docstring describes for deciding
  // whether a static /comedy-atlas/city/<slug>/ page exists. entityHref()
  // below only offers the canonical slug route when confirmed is true; a
  // pre-load placeholder (shows layer before eventsLoaded) is never
  // confirmed, so it can't produce a canonical link for a city that turns
  // out to have zero real events.
  var RESOLVERS = {
    shows: function (data) {
      var cities = (data && data.cities) || [];
      return cities
        .filter(function (c) { return !data.eventsLoaded || c.shows > 0; })
        .map(function (c) {
          return {
            id: "city:" + c.name,
            lat: c.lat,
            lon: c.lon,
            label: c.name,
            cityName: c.name,
            count: c.shows || 0,
            countLabel: data.eventsLoaded ? (c.shows + (c.shows === 1 ? " show" : " shows")) : "loading…",
            confirmed: !!data.eventsLoaded && c.shows > 0
          };
        });
    },

    venues: function (data) {
      var venues = (data && data.venues) || [];
      return venues.map(function (v) {
        return {
          id: "venue:" + v.id,
          lat: v.lat,
          lon: v.lon,
          label: v.name,
          cityName: v.cityName,
          count: v.eventCount || 0,
          countLabel: v.eventCount + (v.eventCount === 1 ? " show" : " shows"),
          // A venue point only ever exists once real per-event data has
          // been folded in (see atlas-visuals-data.js's loadDetail) — its
          // city necessarily has >=1 real event too.
          confirmed: true
        };
      });
    },

    // v1 scope: intentionally always empty. See the registry entry above —
    // this is a documented gap, not a bug. Kept as its own function (rather
    // than omitted from RESOLVERS) so resolvePoints()'s "unknown layer ->
    // []" fallback and "this layer has no data yet" are two visibly
    // different code paths in review.
    comics: function () {
      return [];
    },

    festivals: function (data) {
      var cities = (data && data.cities) || [];
      return cities
        .filter(function (c) { return c.festivals > 0; })
        .map(function (c) {
          return {
            id: "festival-city:" + c.name,
            lat: c.lat,
            lon: c.lon,
            label: c.name,
            cityName: c.name,
            count: c.festivals,
            countLabel: c.festivals + (c.festivals === 1 ? " festival show" : " festival shows"),
            confirmed: true
          };
        });
    },

    openmics: function (data) {
      var cities = (data && data.cities) || [];
      return cities
        .filter(function (c) { return c.openMics > 0; })
        .map(function (c) {
          return {
            id: "openmic-city:" + c.name,
            lat: c.lat,
            lon: c.lon,
            label: c.name,
            cityName: c.name,
            count: c.openMics,
            countLabel: c.openMics + (c.openMics === 1 ? " open mic" : " open mics"),
            confirmed: true
          };
        });
    }
  };

  function resolvePoints(layerId, data) {
    var fn = RESOLVERS[layerId];
    if (!fn) return [];
    var raw = fn(data || {}) || [];
    return raw.filter(isValidPoint);
  }

  // --- Link resolution --------------------------------------------------
  // slugify(): a byte-for-byte port of scripts/seo_common.py's slugify()
  // (NFKD-normalize, drop combining marks + any remaining non-ASCII,
  // collapse runs of non-alphanumerics to "-", trim, lowercase, "x" if
  // empty) — the exact function scripts/generate_city_pages.py uses to
  // name /comedy-atlas/city/<slug>/index.html. Reusing the real rule
  // (not reinventing one) is what makes the canonical route below safe
  // to construct client-side rather than a guess.
  function slugify(text) {
    var s = String(text == null ? "" : text);
    if (typeof s.normalize === "function") {
      // eslint-disable-next-line no-misleading-character-class
      s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); // strip combining diacritics (e.g. Zurich's u-umlaut -> "u" + U+0308)
    }
    s = s.replace(/[^\x00-\x7F]/g, "");
    s = s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return s || "x";
  }

  // canonicalCityHref(): the real, sitemap-indexed, server-rendered,
  // schema.org-carrying page (scripts/generate_city_pages.py) — always
  // preferred over the client-rendered city.html?city= query page per
  // the 2026-07-27 design review.
  //
  // fallbackCityHref(): city.html?city=<name> (the pre-existing pattern
  // index.html's own cityCard() has always used). Used when a point isn't
  // `confirmed` (see the RESOLVERS comment above) -- i.e. we don't yet
  // have real evidence, from the actually-loaded export, that this city
  // clears the generator's own >=1-event gate.
  //
  // IMPORTANT — even a `confirmed` point's canonical URL is not
  // guaranteed to resolve at this exact moment: verified live 2026-07-27
  // against all 35 cities with real events in one production export,
  // 33/35 canonical pages resolved (200) and 2 didn't (Cologne, Galway —
  // both real cities with real events, whose static page generation run
  // apparently hasn't caught up yet; this is a generation/deploy-lag
  // fact, not a client-side guessing problem, and is out of this file's
  // control). Because a purely client-side heuristic cannot close that
  // last gap, atlas-visuals.js does a lightweight same-origin existence
  // check (HEAD request) before ever navigating a real click to the
  // canonical URL, falling back to fallbackCityHref() if it 404s -- see
  // that file's `resolveHrefForNavigation`. entityHref()/canonicalCityHref()
  // here still return the canonical URL as the point's rendered `href`
  // attribute (correct default, correct for search engines / no-JS
  // middle-click / view-source), the click-time check is what guarantees
  // a real click never lands on a dead page.
  function canonicalCityHref(cityName) {
    if (!cityName) return null;
    return "city/" + slugify(cityName) + "/";
  }

  function fallbackCityHref(cityName) {
    if (!cityName) return null;
    return "city.html?city=" + encodeURIComponent(cityName);
  }

  // A per-venue permalink (/comedy-atlas/venue/<slug>/) does exist
  // server-side too, but the published event export never ships a slug
  // for it — guessing one from the venue name risks exactly the class of
  // dead link this file works hard to avoid for cities, so the Venues
  // layer links to its city's page (canonical when confirmed) rather
  // than a guessed venue permalink.
  function entityHref(layerId, entity) {
    if (!entity || !entity.cityName) return null;
    if (entity.confirmed) return canonicalCityHref(entity.cityName);
    return fallbackCityHref(entity.cityName);
  }

  global.AtlasLayers = {
    LAYERS: LAYERS,
    layerById: layerById,
    isValidPoint: isValidPoint,
    resolvePoints: resolvePoints,
    slugify: slugify,
    canonicalCityHref: canonicalCityHref,
    fallbackCityHref: fallbackCityHref,
    entityHref: entityHref
  };
})(window);
