/* "Get the weekly what's-on for <city>" signup block (Growth Roadmap
   Wave 1-2 -- docs/atlas-ops/GROWTH_ROADMAP_2026-07-16.md "city email
   lists"). Self-contained, no dependency, mirrors atlas-feedback.js's own
   pattern exactly: finds every element with class
   "atlas-subscribe-mount" on the page and renders a small signup form
   into it, POSTing to the ATLAS API's /subscribe/city endpoint
   (apps/atlas_api/main.py; migration 0074). Double opt-in: the form only
   ever tells the visitor "check your email to confirm" -- it never
   claims they're subscribed until they click the confirmation link.

   Usage: <div class="atlas-subscribe-mount" data-city="Paris"></div>
   Omit data-city (or leave it empty) to render a free-text city input
   instead (used on the hub index.html, which isn't scoped to one city). */
(function () {
  "use strict";
  var API_BASE = (function (h) {
    if (h === "atlas-api.pariscomedy.com" || h === "api.comedyatlas.app") return "";
    if (h === "comedyatlas.app" || h === "www.comedyatlas.app") return "https://api.comedyatlas.app";
    return "https://atlas-api.pariscomedy.com";
  })(location.hostname);

  var cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var css = "" +
      ".atlas-sub-block{border:1px solid var(--border,#1e2a3a);border-radius:12px;padding:18px 20px;margin:20px auto;max-width:640px;background:var(--card,#111827);color:var(--text,#f0f0f0)}" +
      "@media(prefers-color-scheme:light){.atlas-sub-block{background:#fff;color:#171512;border-color:#e2ddd2}}" +
      ".atlas-sub-block h3{font-size:15px;margin:0 0 4px}" +
      ".atlas-sub-block p{font-size:12.5px;color:#8899aa;margin:0 0 10px}" +
      ".atlas-sub-row{display:flex;gap:8px;flex-wrap:wrap}" +
      ".atlas-sub-row input[type=email],.atlas-sub-row input[type=text]{flex:1;min-width:160px;padding:9px 11px;border-radius:8px;border:1px solid #1e2a3a;background:transparent;color:inherit;font:inherit}" +
      ".atlas-sub-row button{padding:9px 16px;border-radius:8px;border:none;font-weight:700;cursor:pointer;background:#7c3aed;color:#fff}" +
      ".atlas-sub-row button:hover{opacity:.92}" +
      ".atlas-sub-msg{font-size:12.5px;margin-top:8px}" +
      ".atlas-sub-consent{font-size:11.5px;color:#8899aa;margin-top:8px}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }

  function render(mount) {
    var city = (mount.getAttribute("data-city") || "").trim();
    var cityInputHtml = city
      ? '<input type="hidden" class="atlas-sub-city" value="' + city.replace(/"/g, "&quot;") + '">'
      : '<input type="text" class="atlas-sub-city" placeholder="Your city (e.g. Paris)">';
    var heading = city
      ? "Get the weekly what's-on for " + city
      : "Get the weekly what's-on for your city";
    var block = el(
      '<div class="atlas-sub-block">' +
      "<h3>" + heading + "</h3>" +
      "<p>One email a week: new stand-up shows as they're added. Free, one-click unsubscribe any time.</p>" +
      '<div class="atlas-sub-row">' +
      cityInputHtml +
      '<input type="email" class="atlas-sub-email" placeholder="you@example.com">' +
      '<button type="button" class="atlas-sub-send">Subscribe</button>' +
      "</div>" +
      '<div class="atlas-sub-consent">Double opt-in: we\'ll email you a confirmation link before sending anything. We never share your email.</div>' +
      '<div class="atlas-sub-msg"></div>' +
      "</div>"
    );
    mount.appendChild(block);

    var btn = block.querySelector(".atlas-sub-send");
    var msg = block.querySelector(".atlas-sub-msg");
    btn.addEventListener("click", function () {
      var cityVal = block.querySelector(".atlas-sub-city").value.trim();
      var emailVal = block.querySelector(".atlas-sub-email").value.trim();
      if (!cityVal) { msg.textContent = "Please enter a city."; msg.style.color = "#c41e3a"; return; }
      if (emailVal.indexOf("@") < 1) { msg.textContent = "Please enter a valid email."; msg.style.color = "#c41e3a"; return; }
      msg.textContent = "Subscribing…"; msg.style.color = "#8899aa";
      btn.disabled = true;
      fetch(API_BASE + "/subscribe/city", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal, city_name: cityVal, weekly_digest_opt_in: true })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, body: d }; }); })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) {
            msg.textContent = (res.body && res.body.detail) || "Could not subscribe — try again.";
            msg.style.color = "#c41e3a";
            return;
          }
          msg.textContent = res.body.message || "Check your email to confirm.";
          msg.style.color = "#3fb950";
          block.querySelector(".atlas-sub-email").value = "";
        })
        .catch(function () {
          btn.disabled = false;
          msg.textContent = "Could not subscribe — try again.";
          msg.style.color = "#c41e3a";
        });
    });
  }

  function init() {
    var mounts = document.querySelectorAll(".atlas-subscribe-mount");
    if (!mounts.length) return;
    injectCss();
    mounts.forEach(render);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
