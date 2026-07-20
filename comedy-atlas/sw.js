/*
 * COMEDY ATLAS — service worker (D2, docs/ATLAS_ROADMAP_DECISIONS_2026-07-16.md)
 *
 * Scope: registered from /comedy-atlas/ pages with the default scope
 * (the directory containing this script, i.e. /comedy-atlas/). A page's
 * OWN scope controls which fetches it sees -- once a /comedy-atlas/ page is
 * controlled, requests it makes to ../data/comedy-atlas/*.json (outside the
 * scope path, but issued BY an in-scope document) still pass through this
 * fetch handler, so no root-level install is needed.
 *
 * Strategy:
 *   - data/*.json (event listings)   -> network-first (freshness matters;
 *     shows/times change). Falls back to cache when offline, and updates
 *     the cache on every successful network hit.
 *   - everything else same-origin GET (html/css/js/png/manifest) -> cache-
 *     first, versioned. A cache miss falls through to network and seeds
 *     the cache for next time.
 *   - navigation requests (HTML page loads) that fail BOTH network and
 *     cache fall back to offline.html.
 *
 * Bump CACHE_VERSION on any static-asset change that must invalidate old
 * clients; activate() deletes every cache name that doesn't match it.
 */
"use strict";

var CACHE_VERSION = "atlas-c8ce74cf2a49";
var STATIC_CACHE = "atlas-static-" + CACHE_VERSION;
var DATA_CACHE = "atlas-data-" + CACHE_VERSION;

// App-shell precache. Paths are relative to this file's directory
// (/comedy-atlas/), matching how the pages themselves are served.
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./offline.html",
  "./atlas-common.js",
  "./atlas-track.js",
  "./atlas-feedback.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      // Best-effort: don't fail install if one precache URL 404s (e.g. a
      // page that doesn't exist on this particular origin's rollout yet).
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.map(function (name) {
          if (name !== STATIC_CACHE && name !== DATA_CACHE) {
            return caches.delete(name);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isDataRequest(url) {
  return /\/data\/comedy-atlas\/.*\.json$/.test(url.pathname);
}

function networkFirst(request) {
  return caches.open(DATA_CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(function () {
      return cache.match(request).then(function (cached) {
        if (cached) return cached;
        throw new Error("offline, no cached data for " + request.url);
      });
    });
  });
}

function cacheFirst(request) {
  return caches.open(STATIC_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok && request.method === "GET") {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return; // never intercept writes (POST /api/*)

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin API calls

  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      cacheFirst(request).catch(function () {
        return caches.match("./offline.html");
      })
    );
    return;
  }

  event.respondWith(
    cacheFirst(request).catch(function () {
      return caches.match(request);
    })
  );
});
