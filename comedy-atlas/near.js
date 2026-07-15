/* "Shows near me tonight" (Phase 3 geo discovery) -- self-contained, no
   external libs. Injects a prominent button into the ATLAS hub, uses the
   browser Geolocation API to get lat/lon, calls GET /shows/near on the
   ATLAS API, and renders the result inline. Degrades cleanly:
     - permission denied / no geolocation support -> "browse by city" link
     - zero results in range -> a plain "try a wider range" message
     - in flight -> a small spinner
   Works from pariscomedy.com (this script's fetch always targets the API's
   absolute origin, same API_BASE pattern as atlas-feedback.js/atlas-common.js). */
(function () {
  "use strict";

  var API_BASE = (function (h) {
    if (h === "atlas-api.pariscomedy.com" || h === "api.comedyatlas.app") return "";
    if (h === "comedyatlas.app" || h === "www.comedyatlas.app") return "https://api.comedyatlas.app";
    return "https://atlas-api.pariscomedy.com";
  })(location.hostname);

  var A = window.AtlasCommon || null;

  function escapeHtml(s) {
    if (A && A.escapeHtml) return A.escapeHtml(s);
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var css = "" +
    ".near-tonight-wrap{max-width:1100px;margin:0 auto;padding:0 20px 8px}" +
    ".near-tonight-btn{display:inline-flex;align-items:center;gap:8px;border-radius:10px;padding:13px 22px;font-size:14px;font-weight:700;background:#c9a84c;color:#100c00;border:none;cursor:pointer;font-family:inherit}" +
    ".near-tonight-btn:hover{opacity:.9}" +
    ".near-tonight-panel{margin-top:16px}" +
    ".near-tonight-panel .state-block{text-align:center;padding:32px 20px;color:var(--muted,#8899aa)}" +
    ".near-tonight-panel .spinner{width:24px;height:24px;border:3px solid var(--border,#1e2a3a);border-top-color:var(--purple,#7c3aed);border-radius:50%;margin:0 auto 12px;animation:near-spin .8s linear infinite}" +
    "@keyframes near-spin{to{transform:rotate(360deg)}}" +
    ".near-event-card{background:var(--card,#111827);border:1px solid var(--border,#1e2a3a);border-radius:12px;padding:16px 18px;margin-bottom:12px}" +
    ".near-event-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}" +
    ".near-event-title{font-size:16px;font-weight:700;line-height:1.3}" +
    ".near-event-dist{font-size:13px;color:var(--gold,#c9a84c);font-weight:700;white-space:nowrap}" +
    ".near-event-meta{font-size:13px;color:var(--muted,#8899aa);margin-top:4px}" +
    ".near-ticket-link{display:inline-block;margin-top:8px;font-size:13px;font-weight:700;color:#fff;background:var(--purple,#7c3aed);padding:8px 16px;border-radius:8px}" +
    ".near-ticket-link:hover{opacity:.9}" +
    ".near-fallback-link{color:var(--purple-light,#9d5ff5);font-weight:700}";

  function injectCss() {
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function fmtPrice(ev) {
    if (ev.price_min === null || ev.price_min === undefined) return "";
    var cur = ev.currency || "";
    if (ev.price_max && ev.price_max !== ev.price_min) {
      return escapeHtml(ev.price_min) + "–" + escapeHtml(ev.price_max) + " " + escapeHtml(cur);
    }
    return escapeHtml(ev.price_min) + " " + escapeHtml(cur);
  }

  function renderPanelState(panel, html) {
    panel.innerHTML = html;
  }

  function renderLoading(panel) {
    renderPanelState(panel, '<div class="state-block"><div class="spinner" aria-hidden="true"></div>' +
      '<p>Finding shows near you…</p></div>');
  }

  function renderFallback(panel, message) {
    renderPanelState(panel, '<div class="state-block"><p>' + message + '</p>' +
      '<p style="margin-top:10px"><a class="near-fallback-link" href="#" onclick="' +
      'document.querySelector(\'.card-grid\') && document.querySelector(\'.card-grid\').scrollIntoView({behavior:\'smooth\'});return false;">' +
      'Browse by city instead →</a></p></div>');
  }

  function eventCard(ev) {
    var price = fmtPrice(ev);
    var ticket = ev.ticket_url
      ? '<a class="near-ticket-link" href="' + escapeHtml(ev.ticket_url) +
        '" rel="noopener noreferrer" target="_blank">Official tickets →</a>'
      : "";
    return '<div class="near-event-card">' +
      '<div class="near-event-top">' +
      '<div class="near-event-title">' + escapeHtml(ev.title || "Untitled show") + '</div>' +
      '<div class="near-event-dist">' + escapeHtml(ev.distance_km) + ' km away</div>' +
      '</div>' +
      '<div class="near-event-meta">' + escapeHtml(fmtTime(ev.starts_at)) +
      (ev.venue_name ? ' · ' + escapeHtml(ev.venue_name) : '') +
      (ev.city ? ' · ' + escapeHtml(ev.city) : '') +
      (price ? ' · ' + price : '') +
      '</div>' + ticket + '</div>';
  }

  function renderResults(panel, events) {
    if (!events.length) {
      renderFallback(panel, "No shows within 25km tonight — try a wider range or " +
        "pick a city below.");
      return;
    }
    var html = "";
    events.forEach(function (ev) { html += eventCard(ev); });
    renderPanelState(panel, html);
  }

  function fetchNear(lat, lon, panel) {
    var url = API_BASE + "/shows/near?lat=" + encodeURIComponent(lat) +
      "&lon=" + encodeURIComponent(lon) + "&radius_km=25";
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error("bad status " + r.status);
      return r.json();
    }).then(function (events) {
      renderResults(panel, events);
    }).catch(function () {
      renderFallback(panel, "Couldn’t load nearby shows right now — try again shortly, " +
        "or pick a city below.");
    });
  }

  function onFindClick(panel) {
    if (!("geolocation" in navigator)) {
      renderFallback(panel, "Your browser doesn’t support location — pick a city below instead.");
      return;
    }
    renderLoading(panel);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        fetchNear(pos.coords.latitude, pos.coords.longitude, panel);
      },
      function () {
        renderFallback(panel, "Location access was denied — no problem, pick a city below instead.");
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  }

  function init() {
    injectCss();
    var mountPoint = document.getElementById("freshness");
    if (!mountPoint || !mountPoint.parentNode) return;

    var wrap = document.createElement("div");
    wrap.className = "near-tonight-wrap";
    wrap.innerHTML = '<button type="button" class="near-tonight-btn" id="near-tonight-btn">' +
      '📍 Shows near me tonight</button>' +
      '<div class="near-tonight-panel" id="near-tonight-panel"></div>';
    mountPoint.parentNode.insertBefore(wrap, mountPoint.nextSibling);

    var panel = document.getElementById("near-tonight-panel");
    document.getElementById("near-tonight-btn").addEventListener("click", function () {
      onFindClick(panel);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
