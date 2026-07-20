/* COMEDY ATLAS — geolocation personalization (2026-07-20).

   On first visit, asks the API for the visitor's nearest COVERED city
   (GET /geo/nearest-city — coarse server-side geo-IP, used transiently;
   the response is only {city, country}, the IP is never echoed or stored;
   disclosed on privacy.html). The homepage then floats that city's card
   to the front with a "Shows near you" tag; city.html preselects it when
   opened without an explicit ?city= param.

   Preference order (strongest wins):
     1. Manual choice — any city the visitor actually clicked/browsed to
        (localStorage "atlas_city_manual"). Wins forever until changed.
     2. Signed-in fan's home city (GET /fan/me .home_city, migration 0103).
     3. Detected city (localStorage "atlas_city_detected", 7-day TTL, then
        re-detected via the API).

   Degrades to nothing: any storage/fetch failure just means no
   personalization, never a broken page. No consent wall needed — coarse,
   transient, server-side; the browser Geolocation API is only ever used
   by the separate opt-in "Shows near me" button (near.js). */
(function () {
  "use strict";

  var API_BASE = (function (h) {
    if (h === "atlas-api.pariscomedy.com" || h === "api.comedyatlas.app") return "";
    if (h === "comedyatlas.app" || h === "www.comedyatlas.app") return "https://api.comedyatlas.app";
    return "https://atlas-api.pariscomedy.com";
  })(location.hostname);

  var MANUAL_KEY = "atlas_city_manual";
  var DETECTED_KEY = "atlas_city_detected";
  var DETECT_TTL_MS = 7 * 24 * 3600 * 1000;   // re-detect weekly
  var NULL_TTL_MS = 24 * 3600 * 1000;          // retry daily if nothing found

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* ignore */ }
  }

  function rememberManual(city) {
    if (!city) return;
    lsSet(MANUAL_KEY, { city: String(city), ts: Date.now() });
  }

  function manualCity() {
    var m = lsGet(MANUAL_KEY);
    return (m && m.city) ? m.city : null;
  }

  function cachedDetection() {
    var d = lsGet(DETECTED_KEY);
    if (!d || !d.ts) return null;
    var ttl = d.city ? DETECT_TTL_MS : NULL_TTL_MS;
    if (Date.now() - d.ts > ttl) return null;
    return d;
  }

  // Resolves to {city, source} or null. Never rejects.
  function detect() {
    var cached = cachedDetection();
    if (cached) {
      return Promise.resolve(cached.city ? { city: cached.city, source: "detected" } : null);
    }
    return fetch(API_BASE + "/geo/nearest-city")
      .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
      .then(function (data) {
        var city = (data && data.city) ? String(data.city) : null;
        lsSet(DETECTED_KEY, { city: city, country: (data && data.country) || null, ts: Date.now() });
        return city ? { city: city, source: "detected" } : null;
      })
      .catch(function () { return null; });
  }

  // Signed-in fan's home city; resolves to city name or null. Never rejects.
  function fanHomeCity() {
    return fetch(API_BASE + "/fan/me", { credentials: "include" })
      .then(function (r) { if (!r.ok) throw new Error("not signed in"); return r.json(); })
      .then(function (me) { return (me && me.home_city) ? String(me.home_city) : null; })
      .catch(function () { return null; });
  }

  // Full preference resolution. Resolves to {city, source} or null.
  function preferredCity() {
    var manual = manualCity();
    if (manual) return Promise.resolve({ city: manual, source: "manual" });
    return fanHomeCity().then(function (home) {
      if (home) return { city: home, source: "fan" };
      return detect();
    });
  }

  // Any explicit navigation to a city IS the visitor's choice — remember it
  // so returning visitors never re-click (manual beats detection forever).
  function watchManualChoices() {
    document.addEventListener("click", function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.tagName === "A" && el.href && el.href.indexOf("city.html?city=") !== -1) {
          try {
            var qs = el.href.split("?")[1] || "";
            var city = new URLSearchParams(qs).get("city");
            if (city) rememberManual(city);
          } catch (_) { /* ignore */ }
          return;
        }
        el = el.parentNode;
      }
    }, true);
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---- Homepage: float the preferred city's card to the front. ----------
  function floatCityCard(pref) {
    if (!pref || !pref.city) return false;
    var grid = document.querySelector(".atlas-section .card-grid");
    if (!grid) return false;
    var want = pref.city.toLowerCase();
    var links = document.querySelectorAll(
      '.atlas-section a[href*="city.html?city="]');
    var match = null;
    for (var i = 0; i < links.length; i++) {
      try {
        var qs = links[i].href.split("?")[1] || "";
        var c = new URLSearchParams(qs).get("city");
        if (c && c.toLowerCase() === want) { match = links[i]; break; }
      } catch (_) { /* ignore */ }
    }
    if (!match) return false;

    var label = pref.source === "detected"
      ? "📍 Shows near you in " + escapeHtml(pref.city)
      : "📍 Your city";
    var card;
    if (match.classList.contains("place-card")) {
      card = match;
    } else {
      // Stub-list link: promote it to a real card at the front of the grid.
      card = document.createElement("a");
      card.className = "place-card";
      card.href = match.href;
      card.innerHTML = '<div class="place-name">' + escapeHtml(match.textContent) + "</div>";
    }
    // Avoid stacking tags if this runs twice.
    if (!card.querySelector(".place-tag.geo-tag")) {
      var tag = document.createElement("div");
      tag.className = "place-tag geo-tag";
      tag.innerHTML = label;
      card.appendChild(tag);
    }
    card.style.borderColor = "var(--gold)";
    if (grid.firstChild !== card) grid.insertBefore(card, grid.firstChild);
    return true;
  }

  function applyHomepage() {
    preferredCity().then(function (pref) {
      if (!pref) return;
      // The homepage renders its city grid asynchronously (fetchEvents);
      // apply now if it's there, otherwise wait for it to appear.
      if (floatCityCard(pref)) return;
      var main = document.getElementById("main-content");
      if (!main || !window.MutationObserver) return;
      var obs = new MutationObserver(function () {
        if (floatCityCard(pref)) obs.disconnect();
      });
      obs.observe(main, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); }, 20000);
    });
  }

  // ---- city.html: preselect the preferred city when none is given. ------
  function applyCityDefault() {
    var params = new URLSearchParams(location.search);
    if (params.get("city")) return;  // explicit link wins, never rewrite it
    // Synchronous-only sources (localStorage) so the redirect happens
    // before the page renders its hardcoded default; async detection just
    // primes storage for the NEXT visit instead of flashing a reload.
    var city = manualCity();
    if (!city) {
      var d = cachedDetection();
      city = d && d.city ? d.city : null;
    }
    if (city) {
      params.set("city", city);
      location.replace(location.pathname + "?" + params.toString() + location.hash);
      return;
    }
    // Prime for next time (also lets a signed-in fan's home city win the
    // next parameterless visit via the manual key — their explicit setting).
    fanHomeCity().then(function (home) {
      if (home) { rememberManual(home); return null; }
      return detect();
    });
  }

  // city.html's own inline script reads ?city= at parse time, so the
  // preselect redirect must run NOW (this file is included before that
  // inline script), not at DOMContentLoaded — otherwise the hardcoded
  // default city renders first and the replace() causes a visible reload.
  var IS_CITY_PAGE = /city\.html$/.test(location.pathname);
  if (IS_CITY_PAGE) {
    try { applyCityDefault(); } catch (_) { /* never break the page */ }
  }

  function init() {
    watchManualChoices();
    if (IS_CITY_PAGE) {
      // preselect already ran synchronously above
    } else if (document.getElementById("near-tonight-btn")) {
      applyHomepage();
    } else {
      // Any other page: quietly prime detection for the next homepage visit.
      if (!manualCity() && !cachedDetection()) detect();
    }
  }

  window.AtlasGeo = {
    preferredCity: preferredCity,
    detect: detect,
    rememberManual: rememberManual,
    manualCity: manualCity,
    applyHomepage: applyHomepage,
    applyCityDefault: applyCityDefault,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
