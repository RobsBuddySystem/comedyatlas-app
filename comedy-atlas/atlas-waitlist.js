/* Comedy Atlas roadmap item #3 -- sold-out waitlist capture
   (DICE/Bandsintown playbook: "scarcity -> first-party email").

   STANDALONE by design (2026-07-19): the event page's own generator
   (scripts/generate_entity_pages.py) is owned by another agent this wave
   and does not embed a sold-out signal into the static export today --
   event_instances.sold_out_status only exists live in the DB, written by
   ingest/showrunner_portal.py::set_sold_out_status. Rather than wait on a
   generator change, this script fetches the live status itself (GET
   /events/{id}/status, apps/atlas_api/routes_waitlist.py) using the
   event id ALREADY present on every event page today via the existing
   "Save this show" button's data-event-id attribute (render_save_box,
   scripts/generate_entity_pages.py) -- no markup change needed for this
   script to find its event. It renders nothing (no network call even
   attempted beyond the one status check) unless that live check reports
   sold_out_status === 'sold_out'.

   POST-WAVE HOOK STILL NEEDED: this file is not yet <script>-included on
   any generated event page. The one-line addition once the generator is
   free: scripts/generate_entity_pages.py's SAVE_SCRIPT/FOLLOW_SCRIPT
   block (around the render_event_page assembly) needs one more line
   next to the existing atlas-venue-map.js include:
       <script src="/comedy-atlas/atlas-waitlist.js"></script>
   Until that lands, this file can be manually included on any hand-
   authored comedy-atlas page for testing, or loaded directly in a
   browser console against a known event id for a live proof.

   Origin-aware API base -- same shape as atlas-auth.js's own API_BASE
   (comedyatlas.app / www.comedyatlas.app / atlas-api.pariscomedy.com /
   api.comedyatlas.app all resolve to the one shared API host; anything
   else falls back to the pariscomedy API absolutely). */
(function () {
  "use strict";

  var API_BASE = (function (h) {
    if (h === "atlas-api.pariscomedy.com" || h === "api.comedyatlas.app") return "";
    if (h === "comedyatlas.app" || h === "www.comedyatlas.app") return "https://api.comedyatlas.app";
    return "https://atlas-api.pariscomedy.com";
  })(location.hostname);

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({"Content-Type": "application/json"}, opts.headers || {});
    var url = API_BASE + path;
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.detail || res.statusText);
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
  }

  function renderWaitlistBox(eventId) {
    if (document.getElementById("waitlist-box")) return; // already rendered
    var box = document.createElement("div");
    box.className = "card waitlist-box";
    box.id = "waitlist-box";
    box.innerHTML =
      '<strong>This show is sold out.</strong>' +
      '<div class="field-row" style="margin-top:6px">' +
      "Join the waitlist — we'll email you if tickets return." +
      '</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<input type="email" id="waitlist-email" placeholder="you@example.com" ' +
      'aria-label="Email address for the waitlist">' +
      '<button type="button" id="waitlist-join-btn">Join the waitlist</button>' +
      '</div>' +
      '<div id="waitlist-status" style="margin-top:6px"></div>';

    var anchor = document.getElementById("save-box") || document.getElementById("claim-box");
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    } else {
      document.body.appendChild(box);
    }

    var btn = document.getElementById("waitlist-join-btn");
    var emailInput = document.getElementById("waitlist-email");
    var status = document.getElementById("waitlist-status");

    btn.addEventListener("click", function () {
      var email = emailInput.value.trim();
      if (!email) {
        status.textContent = "Enter an email address.";
        return;
      }
      btn.disabled = true;
      api("/waitlist/" + eventId + "/join", {
        method: "POST",
        body: JSON.stringify({email: email, return_to: location.href}),
      }).then(function (body) {
        status.textContent = body.already_confirmed
          ? "You're already on the waitlist for this show."
          : "Check your email to confirm — we'll let you know if tickets return.";
      }).catch(function (err) {
        btn.disabled = false;
        status.textContent = (err && err.message) ||
          "Could not join the waitlist right now — try again later.";
        if (window.atlasToast) {
          window.atlasToast("Could not join the waitlist right now — try again later.");
        }
      });
    });
  }

  function init() {
    var saveBtn = document.getElementById("save-btn");
    if (!saveBtn || !saveBtn.dataset.eventId) return; // no event on this page
    var eventId = Number(saveBtn.dataset.eventId);
    if (!eventId) return;

    api("/events/" + eventId + "/status", {method: "GET"}).then(function (data) {
      if (data && data.sold_out_status === "sold_out") {
        renderWaitlistBox(eventId);
      }
    }).catch(function () {
      // No sold-out signal available (event not found, network error, or
      // the API layer isn't reachable) -- render nothing, matching the
      // task's own doctrine: "if no sold-out signal exists, the JS
      // renders nothing".
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AtlasWaitlist = {init: init, apiBase: API_BASE, escapeHtml: escapeHtml};
})();
