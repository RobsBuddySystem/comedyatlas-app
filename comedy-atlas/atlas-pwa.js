/*
 * COMEDY ATLAS — PWA service-worker registration (D2,
 * docs/ATLAS_ROADMAP_DECISIONS_2026-07-16.md). These pages are shared
 * verbatim between two origins: pariscomedy.com/comedy-atlas/ (the
 * original home) and comedyatlas.app/comedy-atlas/ (the new installable
 * brand domain). The PWA is comedyatlas.app-only on purpose -- registering
 * a service worker on pariscomedy.com would put an extra caching layer in
 * front of a page that already lives inside that site's own SW/cache
 * story, and isn't part of D2's scope. Hostname-gated, so this file is
 * safe to include on every page unconditionally.
 */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  var h = location.hostname;
  if (h !== "comedyatlas.app" && h !== "www.comedyatlas.app") return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/comedy-atlas/sw.js").catch(function () {
      // Best-effort only -- a failed registration must never break the page.
    });
  });
})();
