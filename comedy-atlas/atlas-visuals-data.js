/*
 * COMEDY ATLAS — Atlas Visuals v1: data adapter (site/comedy-atlas/atlas-visuals-data.js)
 *
 * FIRST of three separate concerns (see atlas-layers.js's header comment
 * for the full split). This file's only job is: fetch the ALREADY-
 * PUBLISHED static exports and normalize them into the shape atlas-
 * layers.js's resolvers expect. It never queries a database, never talks
 * to an API this repo doesn't already publish, and never fabricates a
 * field the source JSON doesn't have.
 *
 * Same data contract atlas-common.js already uses (see that file's own
 * header comment): relative to site/comedy-atlas/, so in production this
 * is same-origin, no CORS, no CDN.
 *
 * upcoming_events.json is ~5MB (3,631 rows live, 2026-07-27) — loadCore()
 * deliberately does NOT fetch it. First paint uses cities.json alone
 * (39 rows, every one with a real published latitude/longitude — verified
 * 2026-07-27, 0 of 39 missing), which is enough to draw every city dot at
 * its real location immediately. loadDetail() fetches the event export in
 * the background and is awaited separately so the hero never blocks on it.
 */
(function (global) {
  "use strict";

  var CITIES_URL = "../data/comedy-atlas/cities.json";
  var EVENTS_URL = "../data/comedy-atlas/upcoming_events.json";
  var MANIFEST_URL = "../data/comedy-atlas/MANIFEST.json";

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.json();
    });
  }

  // --- Core (fast, first-paint) -------------------------------------------
  // Returns { cities: [{name, country, lat, lon}], generatedAt }.
  // Every city here carries a REAL published centroid — cities.json has
  // never shipped a row with a null lat/lon in this export (checked
  // 2026-07-27); if a future export ever does, that row is dropped here
  // rather than plotted at 0,0 or any other guess.
  function loadCore() {
    return Promise.all([
      fetchJson(CITIES_URL),
      fetchJson(MANIFEST_URL).catch(function () { return null; })
    ]).then(function (results) {
      var raw = results[0];
      var manifest = results[1];
      if (!Array.isArray(raw)) throw new Error("cities.json: unexpected shape");
      var cities = raw
        .filter(function (c) {
          return c && typeof c.latitude === "number" && isFinite(c.latitude) &&
            typeof c.longitude === "number" && isFinite(c.longitude) && c.name;
        })
        .map(function (c) {
          return {
            name: c.name,
            country: c.country_name || c.country_iso2 || null,
            lat: c.latitude,
            lon: c.longitude,
            // Filled in by mergeDetail() once upcoming_events.json has
            // loaded. Zero here means "not counted yet", NOT "confirmed
            // zero" — resolvePoints()/the renderer key off eventsLoaded to
            // tell the two apart, see atlas-layers.js.
            shows: 0,
            festivals: 0,
            openMics: 0
          };
        });
      return {
        cities: cities,
        generatedAt: manifest && manifest.generated_at ? manifest.generated_at : null,
        eventsLoaded: false,
        venues: []
      };
    });
  }

  // --- Title-based open-mic detection ------------------------------------
  // Deliberately mirrors atlas-common.js's deriveFormat() openmic branch
  // exactly (same regex, same reasoning: the canonical `genre` column is
  // "standup" on every published row today, so it carries no open-mic
  // signal — see that file's header comment for the fuller data-gap note).
  // Kept as a local copy rather than a second <script> dependency so this
  // adapter has exactly one job — fetch + normalize — without also being
  // responsible for atlas-common.js staying loaded first.
  function isOpenMicTitle(title) {
    return /\bopen mic\b/i.test(title || "");
  }

  // --- Detail (deferred, background) --------------------------------------
  // Fetches upcoming_events.json and folds real per-city counts + real
  // per-venue points into a copy of the `core` object loadCore() returned.
  // A "unique show", not a raw showtime row, mirrors atlas-common.js's own
  // uniqueShowCount/showKey convention (a weekly night is one show, not
  // however many dated occurrences it's expanded into) — the SAME show
  // must not inflate a city's dot to look bigger than it really is.
  function showKey(ev) {
    return ev.show_series_slug ||
      ((ev.title || "") + "|" + (ev.venue_name || "") + "|" + (ev.city_name || ""));
  }

  function loadDetail(core) {
    return fetchJson(EVENTS_URL).then(function (events) {
      if (!Array.isArray(events)) throw new Error("upcoming_events.json: unexpected shape");

      var byCity = {};
      core.cities.forEach(function (c) { byCity[c.name] = c; });

      var seenShowPerCity = {}; // cityName -> { showKey: true }
      var seenFestivalPerCity = {};
      var seenOpenMicPerCity = {};
      var venuesById = {}; // venue_id -> accumulator

      events.forEach(function (ev) {
        var city = ev.city_name;
        if (!city || !byCity[city]) return; // never invent a city cities.json didn't publish

        var key = showKey(ev);
        seenShowPerCity[city] = seenShowPerCity[city] || {};
        if (!seenShowPerCity[city][key]) {
          seenShowPerCity[city][key] = true;
          byCity[city].shows += 1;
        }

        if (ev.is_festival) {
          seenFestivalPerCity[city] = seenFestivalPerCity[city] || {};
          if (!seenFestivalPerCity[city][key]) {
            seenFestivalPerCity[city][key] = true;
            byCity[city].festivals += 1;
          }
        }

        if (isOpenMicTitle(ev.title)) {
          seenOpenMicPerCity[city] = seenOpenMicPerCity[city] || {};
          if (!seenOpenMicPerCity[city][key]) {
            seenOpenMicPerCity[city][key] = true;
            byCity[city].openMics += 1;
          }
        }

        // Venues: only when the event carries a REAL venue_id + real
        // coordinates (~26% of rows, 952/3631 in the 2026-07-27 export) —
        // an event with a venue name but no lat/lon is never plotted here;
        // it still counts toward its city's Shows dot, just not a Venues
        // point of its own.
        if (ev.venue_id != null &&
            typeof ev.venue_latitude === "number" && isFinite(ev.venue_latitude) &&
            typeof ev.venue_longitude === "number" && isFinite(ev.venue_longitude)) {
          var vid = ev.venue_id;
          if (!venuesById[vid]) {
            venuesById[vid] = {
              id: vid,
              name: ev.venue_name || "Unnamed venue",
              cityName: city,
              lat: ev.venue_latitude,
              lon: ev.venue_longitude,
              _shows: {}
            };
          }
          venuesById[vid]._shows[key] = true;
        }
      });

      var venues = Object.keys(venuesById).map(function (vid) {
        var v = venuesById[vid];
        return {
          id: v.id, name: v.name, cityName: v.cityName, lat: v.lat, lon: v.lon,
          eventCount: Object.keys(v._shows).length
        };
      });

      core.eventsLoaded = true;
      core.venues = venues;
      return core;
    });
  }

  global.AtlasVisualsData = {
    CITIES_URL: CITIES_URL,
    EVENTS_URL: EVENTS_URL,
    MANIFEST_URL: MANIFEST_URL,
    loadCore: loadCore,
    loadDetail: loadDetail,
    isOpenMicTitle: isOpenMicTitle
  };
})(window);
