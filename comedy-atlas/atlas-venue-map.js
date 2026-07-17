/*
 * COMEDY ATLAS — venue map (site/comedy-atlas/atlas-venue-map.js)
 *
 * Phase 3b deliverable #7: "Shows near me + venue map — Leaflet (open-source)
 * + venue lat/lon (OSM verification work now supplies coordinates)."
 *
 * Loaded by city.html alongside the existing card-list view. This module
 * does NOT replace the card list -- it adds a Leaflet map plotting the same
 * (already-filtered) events, grouped by venue, with real venue_latitude/
 * venue_longitude only. A venue with no coordinates gets NO pin -- this
 * module never fabricates or guesses a location.
 *
 * Real coverage as of 2026-07-17 (see BUILD_STATE.md): 145 of 1,691 upcoming
 * events (8.6%) carry real venue coordinates; 317 of 493 venues (64.3%)
 * overall, unevenly distributed (Paris/US cities well-covered, several
 * newly-onboarded European wave-1 cities near 0%). That means several
 * cities will show a mostly- or fully-empty map today -- an honest reflection
 * of OSM-verification progress, not a bug, and the empty state below says so
 * plainly rather than hiding the gap.
 *
 * "Shows near me" (cross-city, opt-in browser geolocation -> server-side
 * GET /shows/near) already exists in near.js on the hub page and is NOT
 * duplicated here. This module's own opt-in geolocation button is scoped
 * to the CURRENT city's map only: it centers the map and labels/sorts the
 * ALREADY-PLOTTED venue pins by distance -- it never asks for location
 * silently, never sends the coordinate anywhere (all math is client-side,
 * no network call), and degrades to "leave the map as-is" if denied or
 * unsupported.
 *
 * No build step, no CDN -- Leaflet 1.9.4 is vendored locally in
 * vendor/leaflet/ (BSD-2-Clause), matching this site's existing convention
 * of same-origin-only <script src> tags (grep site/comedy-atlas/*.html --
 * nothing here loads from a CDN today).
 */
(function (global) {
  "use strict";

  var EARTH_RADIUS_KM = 6371;

  // ---- pure helpers (unit-tested directly via `node -e`, no DOM needed) --

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // Haversine great-circle distance in km. Standard formula, no shortcuts.
  function haversineKm(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }

  function hasCoords(ev) {
    var lat = ev.venue_latitude;
    var lon = ev.venue_longitude;
    return typeof lat === "number" && typeof lon === "number" &&
      !isNaN(lat) && !isNaN(lon);
  }

  // Group events by venue (real venue_id, falling back to a rounded
  // lat/lon composite key only if venue_id is ever absent -- never drops a
  // real coordinate just because the id is missing). Events with no
  // coordinates are excluded entirely -- no pin, no fabrication.
  function groupByVenue(events) {
    var withCoords = events.filter(hasCoords);
    var byKey = {};
    var order = [];
    withCoords.forEach(function (ev) {
      var key = ev.venue_id != null ? "v" + ev.venue_id :
        "c" + ev.venue_latitude.toFixed(4) + "," + ev.venue_longitude.toFixed(4);
      if (!byKey[key]) {
        byKey[key] = {
          key: key,
          venue_id: ev.venue_id != null ? ev.venue_id : null,
          name: ev.venue_name || "Venue",
          lat: ev.venue_latitude,
          lon: ev.venue_longitude,
          events: []
        };
        order.push(key);
      }
      byKey[key].events.push(ev);
    });
    return order.map(function (key) { return byKey[key]; });
  }

  // Deterministic grid-based clustering (no external clustering plugin --
  // this repo vendors only Leaflet core, no new dependency without an ADR).
  // Buckets venues into grid cells of `gridDeg` degrees (~1.1km at
  // gridDeg=0.01 near the equator, close enough at European latitudes for
  // "these pins are basically on top of each other at this zoom" purposes).
  // A cell with >=2 distinct venues becomes one cluster point at the
  // centroid of its members; a cell with exactly 1 venue passes through
  // unclustered. Deterministic and side-effect-free -- same input always
  // produces the same clusters, independent of render order.
  function clusterVenues(venues, gridDeg) {
    gridDeg = gridDeg || 0.01;
    var cells = {};
    var order = [];
    venues.forEach(function (v) {
      var cellKey = Math.round(v.lat / gridDeg) + "_" + Math.round(v.lon / gridDeg);
      if (!cells[cellKey]) {
        cells[cellKey] = [];
        order.push(cellKey);
      }
      cells[cellKey].push(v);
    });
    return order.map(function (cellKey) {
      var members = cells[cellKey];
      if (members.length === 1) {
        return { cluster: false, lat: members[0].lat, lon: members[0].lon, venues: members };
      }
      var sumLat = 0, sumLon = 0;
      members.forEach(function (v) { sumLat += v.lat; sumLon += v.lon; });
      return {
        cluster: true,
        lat: sumLat / members.length,
        lon: sumLon / members.length,
        venues: members
      };
    });
  }

  // Sorts venue groups by distance (km) from (lat, lon), ascending, and
  // returns a NEW array with a `distance_km` field attached to each venue
  // (rounded to 1 decimal) -- never mutates the input.
  function sortByDistance(venues, lat, lon) {
    return venues
      .map(function (v) {
        var d = haversineKm(lat, lon, v.lat, v.lon);
        var copy = {};
        for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) copy[k] = v[k]; }
        copy.distance_km = Math.round(d * 10) / 10;
        return copy;
      })
      .sort(function (a, b) { return a.distance_km - b.distance_km; });
  }

  function eventLinkHref(ev) {
    if (ev.slug) return "/comedy-atlas/event/" + ev.slug + "/";
    if (ev.canonical_event_url) {
      var destHost = "";
      try { destHost = new URL(ev.canonical_event_url).hostname.replace(/^www\./, ""); } catch (_) { destHost = ""; }
      return "go.html?e=" + encodeURIComponent(ev.id) + (destHost ? "&dest=" + encodeURIComponent(destHost) : "");
    }
    return null;
  }

  function escapeHtml(s) {
    if (global.AtlasCommon && global.AtlasCommon.escapeHtml) return global.AtlasCommon.escapeHtml(s);
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function popupHtml(venueGroup) {
    var html = '<div class="venue-map-popup"><strong>' + escapeHtml(venueGroup.name) + "</strong>";
    venueGroup.events.slice(0, 8).forEach(function (ev) {
      var href = eventLinkHref(ev);
      var title = escapeHtml(ev.title || "Untitled show");
      html += '<div class="venue-map-popup-row">';
      html += href ? '<a href="' + escapeHtml(href) + '">' + title + "</a>" : title;
      html += "</div>";
    });
    if (venueGroup.events.length > 8) {
      html += '<div class="venue-map-popup-row">+' + (venueGroup.events.length - 8) + " more</div>";
    }
    html += "</div>";
    return html;
  }

  // ---- Leaflet lazy-loader (only loads the library when there's a map to
  // draw -- vendored, same-origin, no CDN) --------------------------------

  var leafletLoadPromise = null;
  function loadLeaflet(basePath) {
    if (global.L) return Promise.resolve(global.L);
    if (leafletLoadPromise) return leafletLoadPromise;
    leafletLoadPromise = new Promise(function (resolve, reject) {
      var cssHref = basePath + "vendor/leaflet/leaflet.css";
      if (!document.querySelector('link[href="' + cssHref + '"]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssHref;
        document.head.appendChild(link);
      }
      var script = document.createElement("script");
      script.src = basePath + "vendor/leaflet/leaflet.js";
      script.onload = function () { resolve(global.L); };
      script.onerror = function () { reject(new Error("Leaflet failed to load")); };
      document.body.appendChild(script);
    });
    return leafletLoadPromise;
  }

  // ---- public render entry point -----------------------------------------

  // container: a DOM element to render into (its innerHTML is replaced).
  // events: the array of already-filtered event objects for the current
  //   city (same shape as upcoming_events.json rows).
  // opts.basePath: relative prefix to this page's comedy-atlas root, so the
  //   vendored assets resolve whether the page is at /comedy-atlas/city.html
  //   or /comedy-atlas/city/<slug>/index.html. Defaults to "" (same dir).
  function render(container, events, opts) {
    opts = opts || {};
    var basePath = opts.basePath || "";
    var venues = groupByVenue(events);

    if (!venues.length) {
      container.innerHTML =
        '<div class="venue-map-empty">No mapped venues yet for this view — ' +
        "venue coordinates are added as our OSM verification work reaches " +
        "each city. Nothing is guessed: a venue only gets a pin once its " +
        "location is confirmed.</div>";
      return;
    }

    container.innerHTML =
      '<div class="venue-map-toolbar">' +
      '<button type="button" class="venue-map-locate-btn">📍 Show my location on this map</button>' +
      '<span class="venue-map-count"></span>' +
      "</div>" +
      '<div class="venue-map-canvas" style="height:360px;border-radius:12px;overflow:hidden"></div>' +
      '<div class="venue-map-status"></div>';

    var countEl = container.querySelector(".venue-map-count");
    countEl.textContent = venues.length + " mapped venue" + (venues.length === 1 ? "" : "s");

    var mapEl = container.querySelector(".venue-map-canvas");
    var statusEl = container.querySelector(".venue-map-status");
    var locateBtn = container.querySelector(".venue-map-locate-btn");

    loadLeaflet(basePath).then(function (L) {
      // Vendored marker icons -- Leaflet's default icon paths assume a CDN
      // layout; point them at our own vendored images instead.
      var DefaultIcon = L.icon({
        iconUrl: basePath + "vendor/leaflet/images/marker-icon.png",
        iconRetinaUrl: basePath + "vendor/leaflet/images/marker-icon-2x.png",
        shadowUrl: basePath + "vendor/leaflet/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });
      L.Marker.prototype.options.icon = DefaultIcon;

      var map = L.map(mapEl, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      var clusters = clusterVenues(venues, 0.01);
      var markers = [];

      function addMarkers(clusterList) {
        markers.forEach(function (m) { map.removeLayer(m); });
        markers = [];
        clusterList.forEach(function (c) {
          if (c.cluster) {
            var totalEvents = c.venues.reduce(function (n, v) { return n + v.events.length; }, 0);
            var marker = L.circleMarker([c.lat, c.lon], {
              radius: 14, color: "#7c3aed", fillColor: "#7c3aed", fillOpacity: 0.85
            }).addTo(map);
            marker.bindTooltip(String(c.venues.length) + " venues", { permanent: false });
            marker.on("click", function () {
              var bounds = L.latLngBounds(c.venues.map(function (v) { return [v.lat, v.lon]; }));
              map.fitBounds(bounds.pad(0.3));
            });
            marker._atlasVenues = c.venues;
            marker._atlasEventCount = totalEvents;
            markers.push(marker);
          } else {
            var v = c.venues[0];
            var m = L.marker([v.lat, v.lon]).addTo(map);
            m.bindPopup(popupHtml(v));
            m._atlasVenues = [v];
            markers.push(m);
          }
        });
      }

      addMarkers(clusters);

      var bounds = L.latLngBounds(venues.map(function (v) { return [v.lat, v.lon]; }));
      map.fitBounds(bounds.pad(0.2));
      if (venues.length === 1) map.setZoom(14);

      locateBtn.addEventListener("click", function () {
        if (!("geolocation" in navigator)) {
          statusEl.textContent = "Your browser doesn't support location — the map still works, just not distance-sorted.";
          return;
        }
        statusEl.textContent = "Locating…";
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            var lat = pos.coords.latitude, lon = pos.coords.longitude;
            statusEl.textContent = "";
            var youMarker = L.circleMarker([lat, lon], {
              radius: 8, color: "#c9a84c", fillColor: "#c9a84c", fillOpacity: 1
            }).addTo(map).bindTooltip("You are here", { permanent: false });
            markers.push(youMarker);
            var sorted = sortByDistance(venues, lat, lon);
            countEl.textContent = venues.length + " mapped venue" + (venues.length === 1 ? "" : "s") +
              " — nearest: " + escapeHtml(sorted[0].name) + " (" + sorted[0].distance_km + " km)";
            map.setView([lat, lon], 12);
          },
          function () {
            statusEl.textContent = "Location access was denied — no problem, the map still works without it.";
          },
          { timeout: 8000, maximumAge: 300000 }
        );
      });
    }).catch(function () {
      container.innerHTML = '<div class="venue-map-empty">Map couldn\'t load right now — ' +
        "browse the list above instead.</div>";
    });
  }

  global.AtlasVenueMap = {
    haversineKm: haversineKm,
    hasCoords: hasCoords,
    groupByVenue: groupByVenue,
    clusterVenues: clusterVenues,
    sortByDistance: sortByDistance,
    eventLinkHref: eventLinkHref,
    popupHtml: popupHtml,
    render: render
  };
})(typeof window !== "undefined" ? window : global);

// CommonJS export for `node -e` sanity checks only -- browsers never hit
// this branch (module/exports are undefined there).
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : global).AtlasVenueMap;
}
