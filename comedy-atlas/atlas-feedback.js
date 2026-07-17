/* Floating "Feedback" widget for COMEDY ATLAS pages. Self-contained: inject a
   pill button that opens a small form and POSTs to the ATLAS API /feedback
   endpoint. Works from either origin (pariscomedy.com static pages and the
   atlas-api-served portal pages) — the API's CORS allows pariscomedy.com and
   the endpoint is public (a logged-in visitor is auto-attributed server-side
   via their session cookie; credentials:'include' carries it). No dependency. */
(function () {
  "use strict";
  var API_BASE = (function (h) {
    if (h === "atlas-api.pariscomedy.com" || h === "api.comedyatlas.app") return "";
    if (h === "comedyatlas.app" || h === "www.comedyatlas.app") return "https://api.comedyatlas.app";
    return "https://atlas-api.pariscomedy.com";
  })(location.hostname);

  var css = "" +
    ".atlas-fb-btn{position:fixed;right:16px;bottom:16px;z-index:9998;background:#7c3aed;color:#fff;border:none;border-radius:999px;padding:10px 16px;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}" +
    ".atlas-fb-btn:hover{opacity:.92}" +
    // 2026-07-17 frontend audit: on narrow viewports this fixed pill had
    // no scroll-safe reservation and sat directly on top of whatever card
    // was in the bottom-right corner as the user scrolled (confirmed
    // obscuring real card text). Shrinking the footprint on mobile
    // directly reduces how much it can cover, without losing the
    // always-reachable fixed-position purpose the widget exists for.
    "@media(max-width:480px){.atlas-fb-btn{padding:8px 12px;font-size:12px;right:12px;bottom:12px}}" +
    ".atlas-fb-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center}" +
    ".atlas-fb-card{background:#111827;color:#f0f0f0;border:1px solid #1e2a3a;border-radius:12px;max-width:420px;width:calc(100% - 32px);padding:20px;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
    "@media(prefers-color-scheme:light){.atlas-fb-card{background:#fff;color:#171512;border-color:#e2ddd2}}" +
    ".atlas-fb-card h3{margin:0 0 4px;font-size:16px}.atlas-fb-card p{margin:0 0 12px;color:#8899aa;font-size:12.5px}" +
    ".atlas-fb-card textarea,.atlas-fb-card input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;border:1px solid #1e2a3a;background:transparent;color:inherit;font:inherit;margin-bottom:10px}" +
    ".atlas-fb-card textarea{min-height:90px;resize:vertical}" +
    ".atlas-fb-row{display:flex;gap:8px;justify-content:flex-end}" +
    ".atlas-fb-row button{padding:9px 16px;border-radius:8px;border:none;font-weight:700;cursor:pointer}" +
    ".atlas-fb-send{background:#7c3aed;color:#fff}.atlas-fb-cancel{background:transparent;border:1px solid #8899aa;color:#8899aa}" +
    ".atlas-fb-msg{font-size:12.5px;margin-top:6px}";

  function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }

  function init() {
    var style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
    var btn = el('<button class="atlas-fb-btn" aria-label="Send feedback">💬 Feedback</button>');
    var modal = el('<div class="atlas-fb-modal"><div class="atlas-fb-card">' +
      '<h3>Help us improve ATLAS</h3>' +
      '<p>Found a bug, missing show, or have an idea? Tell us — we read every note.</p>' +
      '<textarea id="atlas-fb-body" placeholder="What should we fix or add?"></textarea>' +
      '<input id="atlas-fb-email" type="email" placeholder="Your email (optional, so we can reply)">' +
      '<div class="atlas-fb-row"><button class="atlas-fb-cancel">Cancel</button>' +
      '<button class="atlas-fb-send">Send</button></div>' +
      '<div class="atlas-fb-msg" id="atlas-fb-msg"></div></div></div>');
    document.body.appendChild(btn); document.body.appendChild(modal);

    function open() { modal.style.display = "flex"; }
    function close() { modal.style.display = "none"; }
    btn.addEventListener("click", open);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.querySelector(".atlas-fb-cancel").addEventListener("click", close);
    modal.querySelector(".atlas-fb-send").addEventListener("click", function () {
      var body = document.getElementById("atlas-fb-body").value.trim();
      var email = document.getElementById("atlas-fb-email").value.trim();
      var msg = document.getElementById("atlas-fb-msg");
      if (body.length < 3) { msg.textContent = "Please add a message."; msg.style.color = "#c41e3a"; return; }
      msg.textContent = "Sending…"; msg.style.color = "#8899aa";
      fetch(API_BASE + "/feedback", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body, email: email || null, page_ref: location.pathname + location.search })
      }).then(function (r) { return r.json(); }).then(function (d) {
        msg.textContent = d.message || "Thank you!"; msg.style.color = "#3fb950";
        document.getElementById("atlas-fb-body").value = "";
        setTimeout(close, 1600);
      }).catch(function () { msg.textContent = "Could not send — try again."; msg.style.color = "#c41e3a"; });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
