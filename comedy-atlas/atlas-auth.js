/* Shared fetch helpers for the ATLAS comic/booker portal pages.
   Cookie session (Starlette SessionMiddleware, HttpOnly "atlas_session").

   These pages are served from TWO origins:
     - atlas-api.pariscomedy.com  (the portal pages: comic.html/booker.html)
     - pariscomedy.com            (the login page -- the ONLY origin the
                                   shared Google app trusts for the GSI button)
   Both talk to the SAME api at atlas-api.pariscomedy.com. When we are already
   on that host, API_BASE is "" (same-origin, unchanged behavior). When we are
   on pariscomedy.com, we target the api absolutely. pariscomedy.com and
   atlas-api.pariscomedy.com are the same SITE (registrable domain
   pariscomedy.com), so this is same-site cross-origin: credentials:"include"
   + the api's CORS allow-credentials makes the Lax cookie flow. */
window.AtlasAuth = (function () {
  "use strict";

  // Origin-aware API base. Same-site cross-origin in every case (registrable
  // domain matches its api host), so the Lax session cookie flows with
  // credentials:"include". Current pariscomedy hosts unchanged; comedyatlas.app
  // added as a parallel primary. Unknown hosts fall back to the paris api.
  var API_BASE = (function (h) {
    if (h === "atlas-api.pariscomedy.com" || h === "api.comedyatlas.app") return "";
    if (h === "comedyatlas.app" || h === "www.comedyatlas.app") return "https://api.comedyatlas.app";
    return "https://atlas-api.pariscomedy.com";
  })(location.hostname);

  // P1.1 (TRUST_AUDIT_2026-10-16): the session cookie is HttpOnly, so the page
  // cannot see it. A logged-out visitor opening booker.html / comic.html used to
  // fire /auth/me (+ booker/*) and log 401s in the console. We keep a harmless
  // non-secret HINT ("a sign-in succeeded in this browser") in localStorage:
  // set on any successful /auth/* response, cleared on logout or any 401. The
  // portal pages call meIfSession(), which makes NO request without the hint.
  // Storage can be blocked (private mode): every access is try/caught and a
  // failure just means "no hint" -> the signed-out panel, never an exception.
  var HINT_KEY = "atlas_session_hint";
  function hasSession() {
    try { return window.localStorage.getItem(HINT_KEY) === "1"; } catch (e) { return false; }
  }
  function setHint(on) {
    try {
      if (on) window.localStorage.setItem(HINT_KEY, "1");
      else window.localStorage.removeItem(HINT_KEY);
    } catch (e) { /* storage blocked: no hint, no crash */ }
  }

  // booker.html / comic.html call quietLoggedOut() first: from then on, a
  // /booker/* or /comic/* request with no sign-in hint is rejected locally
  // (401-shaped, err.local) instead of hitting the network and logging a 401.
  var quiet = false;
  function quietLoggedOut() { quiet = true; }
  function localSignedOut() {
    var err = new Error("not signed in");
    err.status = 401;
    err.local = true;
    return err;
  }

  function api(path, opts) {
    if (quiet && !hasSession() && (path.indexOf("/booker/") === 0 || path.indexOf("/comic/") === 0)) {
      return Promise.reject(localSignedOut());
    }
    opts = opts || {};
    opts.headers = Object.assign({"Content-Type": "application/json"}, opts.headers || {});
    opts.credentials = "include";
    var url = (path.charAt(0) === "/") ? (API_BASE + path) : path;
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (path.indexOf("/auth/logout") === 0 || res.status === 401) setHint(false);
        else if (res.ok && path.indexOf("/auth/") === 0) setHint(true);
        if (!res.ok) {
          var err = new Error(body.detail || res.statusText);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  function post(path, data) {
    return api(path, {method: "POST", body: JSON.stringify(data || {})});
  }
  function put(path, data) {
    return api(path, {method: "PUT", body: JSON.stringify(data || {})});
  }
  function get(path) {
    return api(path, {method: "GET"});
  }
  // `data` is optional and backwards-compatible: every existing caller passes
  // a path alone and still sends no body. Added 2026-07-29 for availability
  // withdrawal (DELETE /comic/{id}/availability takes the dates to remove) --
  // without it the second argument was silently dropped and the request 422'd
  // on a missing body, which looks exactly like "the button does nothing".
  function del(path, data) {
    var opts = {method: "DELETE"};
    if (data !== undefined) opts.body = JSON.stringify(data);
    return api(path, opts);
  }

  function me() {
    return get("/auth/me");
  }

  // Like me(), but silent when this browser has never signed in: rejects with a
  // local 401-shaped error WITHOUT touching the network.
  function meIfSession() {
    if (!hasSession()) return Promise.reject(localSignedOut());
    return me();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
  }

  return {api: api, post: post, put: put, get: get, del: del, me: me,
           meIfSession: meIfSession, hasSession: hasSession, quietLoggedOut: quietLoggedOut,
           escapeHtml: escapeHtml, apiBase: API_BASE};
})();
