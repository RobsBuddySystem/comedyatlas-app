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

/*
 * Roadmap #15 — PWA install hint. A small, dismissible "Add COMEDY ATLAS to
 * your home screen" banner, comedyatlas.app-only (same gate as the SW
 * registration above -- pariscomedy.com's copy of this page is never the
 * installable PWA, so no install nudge belongs there either).
 *
 * Rules (never nag):
 *   - shown only from the visitor's 2nd visit onward (localStorage-counted).
 *   - shown at most once per page load, and never once already installed
 *     (display-mode:standalone / navigator.standalone).
 *   - dismissing (the × or "Not now") snoozes for 30 days -- no re-show
 *     before that, no matter how many more visits happen in between.
 *   - uses the real `beforeinstallprompt` prompt where the browser offers
 *     one (Chrome/Edge/Android); iOS Safari never fires that event, so it
 *     gets honest fallback copy (the manual Share -> Add to Home Screen
 *     steps) instead of a fake "Install" button that would do nothing.
 */
(function () {
  "use strict";
  var h = location.hostname;
  if (h !== "comedyatlas.app" && h !== "www.comedyatlas.app") return;

  var VISITS_KEY = "atlas_pwa_visits";
  var LAST_VISIT_KEY = "atlas_pwa_last_visit_day";
  var SNOOZE_KEY = "atlas_pwa_install_snooze_until";
  var MIN_VISITS = 2;
  var SNOOZE_DAYS = 30;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      // iPadOS 13+ reports as "Macintosh" but exposes multi-touch, unlike a
      // real Mac -- the standard feature-detect for "this is actually an iPad".
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC is fine for a once-a-day dedup
  }

  function bumpVisitCount() {
    var today = todayKey();
    var lastDay = localStorage.getItem(LAST_VISIT_KEY);
    var visits = Number(localStorage.getItem(VISITS_KEY)) || 0;
    if (lastDay !== today) {
      visits += 1;
      localStorage.setItem(VISITS_KEY, String(visits));
      localStorage.setItem(LAST_VISIT_KEY, today);
    }
    return visits;
  }

  function isSnoozed() {
    var until = Number(localStorage.getItem(SNOOZE_KEY));
    return until && Date.now() < until;
  }

  function snooze() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  }

  function injectStyle() {
    if (document.getElementById("atlas-pwa-hint-style")) return;
    var style = document.createElement("style");
    style.id = "atlas-pwa-hint-style";
    style.textContent =
      ".atlas-pwa-hint{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));" +
      "z-index:9997;background:#111827;color:#f0f0f0;border:1px solid #1e2a3a;border-radius:12px;" +
      "padding:14px 16px;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "box-shadow:0 4px 20px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;" +
      "max-width:420px;margin:0 auto}" +
      "@media(prefers-color-scheme:light){.atlas-pwa-hint{background:#fff;color:#171512;border-color:#e2ddd2}}" +
      ".atlas-pwa-hint-body{flex:1;min-width:0}" +
      ".atlas-pwa-hint-title{font-weight:700;margin-bottom:2px}" +
      ".atlas-pwa-hint-copy{font-size:12.5px;color:#8899aa}" +
      ".atlas-pwa-hint-actions{display:flex;flex-direction:column;gap:6px;align-items:stretch}" +
      ".atlas-pwa-hint-actions button{font:inherit;font-weight:700;font-size:12.5px;border-radius:8px;" +
      "padding:7px 12px;cursor:pointer;white-space:nowrap}" +
      ".atlas-pwa-install-btn{background:#7c3aed;color:#fff;border:none}" +
      ".atlas-pwa-dismiss-btn{background:transparent;border:1px solid #8899aa;color:inherit}" +
      "@media(max-width:480px){.atlas-pwa-hint{left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px))}}";
    document.head.appendChild(style);
  }

  function showBanner(opts) {
    injectStyle();
    var el = document.createElement("div");
    el.className = "atlas-pwa-hint";
    el.setAttribute("role", "complementary");
    el.setAttribute("aria-label", "Install COMEDY ATLAS");
    el.innerHTML =
      '<div class="atlas-pwa-hint-body">' +
      '<div class="atlas-pwa-hint-title">Add COMEDY ATLAS to your home screen</div>' +
      '<div class="atlas-pwa-hint-copy">' + opts.copy + "</div>" +
      "</div>" +
      '<div class="atlas-pwa-hint-actions">' +
      (opts.installLabel ? '<button type="button" class="atlas-pwa-install-btn">' + opts.installLabel + "</button>" : "") +
      '<button type="button" class="atlas-pwa-dismiss-btn">Not now</button>' +
      "</div>";
    document.body.appendChild(el);

    function dismiss() {
      snooze();
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    el.querySelector(".atlas-pwa-dismiss-btn").addEventListener("click", dismiss);
    var installBtn = el.querySelector(".atlas-pwa-install-btn");
    if (installBtn && opts.onInstall) {
      installBtn.addEventListener("click", function () {
        opts.onInstall();
        dismiss();
      });
    }
    return el;
  }

  var deferredPrompt = null;
  var bannerShown = false;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); // suppress the browser's own mini-infobar -- we show our own, gated banner instead
    deferredPrompt = e;
    // beforeinstallprompt can fire AFTER our own DOMContentLoaded check ran
    // (its exact timing is browser-decided) -- re-check here too so a
    // late-arriving prompt still gets the banner instead of being missed.
    maybeShowHint();
  });
  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    var existing = document.querySelector(".atlas-pwa-hint");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  });

  function maybeShowHint() {
    if (bannerShown) return; // at most one banner per page load, ever
    if (isStandalone()) return; // already installed -- nothing to nudge toward
    if (isSnoozed()) return;
    var visits = bumpVisitCount();
    if (visits < MIN_VISITS) return;

    if (deferredPrompt) {
      bannerShown = true;
      showBanner({
        copy: "Install the app for one-tap access and offline listings — no App Store, no download size.",
        installLabel: "Install",
        onInstall: function () {
          var promptEvent = deferredPrompt;
          deferredPrompt = null;
          if (!promptEvent) return;
          promptEvent.prompt();
        }
      });
      return;
    }

    if (isIos()) {
      // iOS Safari never fires beforeinstallprompt -- the only real path
      // to the home screen is the manual Share-sheet flow, so the fallback
      // copy says exactly that instead of offering a button that would do
      // nothing.
      bannerShown = true;
      showBanner({
        copy: 'Tap the Share icon, then "Add to Home Screen" — no App Store needed.'
      });
      return;
    }
    // Any other browser/platform with neither signal (e.g. desktop Safari,
    // or a Chrome that already dismissed its own native prompt this
    // session): nothing reliable to offer, so stay silent rather than show
    // a banner with no working action.
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeShowHint);
  } else {
    maybeShowHint();
  }
})();
