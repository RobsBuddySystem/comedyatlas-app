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

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({"Content-Type": "application/json"}, opts.headers || {});
    opts.credentials = "include";
    var url = (path.charAt(0) === "/") ? (API_BASE + path) : path;
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
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

  function me() {
    return get("/auth/me");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
  }

  return {api: api, post: post, put: put, get: get, me: me, escapeHtml: escapeHtml,
           apiBase: API_BASE};
})();
