/* Shared nav helpers for the ATLAS portal pages (booker.html/comic.html/
   login.html). Fixes two real, reported bugs at the root, both caused by
   the SAME fact: comedy-atlas/*.html is served from TWO kinds of origin --
   the public marketing site (pariscomedy.com / comedyatlas.app, via
   GitHub Pages) AND the API's own StaticFiles mount (atlas-api.pariscomedy.
   com / api.comedyatlas.app -- required so the session cookie is
   same-origin, see atlas-auth.js). A page has no reliable way to know
   which kind of origin served it, so anything that assumes "/" or a bare
   relative link resolves sensibly breaks half the time:

   1. Dead nav-logo link -- a bare href="/" 404s on the api host (nothing
      is mounted at its root). Fixed by always pointing the logo at an
      ABSOLUTE, known-good marketing homepage, chosen by hostname family,
      never a relative "/".
   2. Google Sign-In "origin_mismatch" -- the GSI button's trusted-origin
      allowlist (Google Cloud Console "Authorized JavaScript origins")
      only lists the marketing hosts, never the api hosts. A booker who
      was already ON an api host (e.g. switching from comic.html to
      booker.html while signed in) and followed a plain relative
      "login.html?..." link stayed on that SAME untrusted api origin,
      hitting origin_mismatch the moment the GSI button rendered. Fixed by
      always sending users to login.html on the marketing origin, never
      the api origin -- login.html's own destination() logic already
      lands them back on the correct (cookie-same-origin) api-hosted
      portal page after a successful sign-in, so this changes nothing
      about where the session ends up, only where the GSI button itself
      is ever rendered from. */
window.AtlasNav = (function () {
  "use strict";

  function isComedyAtlasFamily(h) {
    return h === "comedyatlas.app" || h === "www.comedyatlas.app" ||
      h === "api.comedyatlas.app";
  }

  // The public marketing origin's homepage -- always resolves, on every
  // origin this page could have been served from.
  function homeUrl() {
    return isComedyAtlasFamily(location.hostname)
      ? "https://comedyatlas.app/"
      : "https://pariscomedy.com/";
  }

  // login.html on the marketing origin only -- never the api origin, so
  // the GSI button always renders from a Google-authorized origin.
  function loginUrl(role, next) {
    var base = isComedyAtlasFamily(location.hostname)
      ? "https://comedyatlas.app/comedy-atlas/login.html"
      : "https://pariscomedy.com/comedy-atlas/login.html";
    var qs = [];
    if (role) qs.push("role=" + encodeURIComponent(role));
    if (next) qs.push("next=" + encodeURIComponent(next));
    return qs.length ? base + "?" + qs.join("&") : base;
  }

  // Fix every .nav-logo on the page to the absolute, always-correct home
  // URL. Safe to call on any page (no-op if there's no .nav-logo).
  function fixLogo() {
    document.querySelectorAll(".nav-logo").forEach(function (a) {
      a.setAttribute("href", homeUrl());
    });
  }

  // Fix any signed-out "Sign in / create account" link that still points
  // at a bare relative login.html (the same origin_mismatch trap) --
  // rewrites it to the marketing-origin login URL, preserving its
  // existing ?role=/?next= query params.
  function fixSignInLinks() {
    document.querySelectorAll('a[href*="login.html"]').forEach(function (a) {
      try {
        var u = new URL(a.getAttribute("href"), location.href);
        a.setAttribute("href", loginUrl(u.searchParams.get("role"), u.searchParams.get("next")));
      } catch (e) { /* leave malformed hrefs alone */ }
    });
  }

  // Wires a "Sign out" control (any element matching the selector) to
  // POST /auth/logout, then send the browser to the marketing login page.
  // Requires window.AtlasAuth (atlas-auth.js) to already be loaded.
  function wireSignOut(selector) {
    document.querySelectorAll(selector).forEach(function (el) {
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        var done = function () { location.href = loginUrl(); };
        if (window.AtlasAuth) {
          window.AtlasAuth.post("/auth/logout", {}).then(done).catch(done);
        } else {
          done();
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    fixLogo();
    fixSignInLinks();
  });

  return {homeUrl: homeUrl, loginUrl: loginUrl, fixLogo: fixLogo,
           fixSignInLinks: fixSignInLinks, wireSignOut: wireSignOut};
})();
