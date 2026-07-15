/* Shared "optional 2FA" UI for the ATLAS comic/booker portals.
   Backend: apps/atlas_api/main.py's /auth/2fa/* routes (stdlib TOTP, RFC
   6238, apps/atlas_api/twofa.py; secret encrypted at rest via
   apps/atlas_api/crypto.py). NEVER required to use ATLAS -- this is a
   reminder + opt-in setup flow only, matching Robert's ask.

   Usage (see comic.html / booker.html): after A.me() resolves,
   AtlasTwoFA.mount(document.getElementById("twofa-section"), meResult).

   No QR-image rendering here (no external service call, no new
   dependency) -- the manual setup key (secret_b32) and the raw otpauth://
   URI are both shown; any Google-Authenticator-compatible app accepts
   manual key entry, and apps that support "enter setup URI" work too. */
window.AtlasTwoFA = (function () {
  "use strict";

  var BANNER_DISMISS_KEY = "atlas_2fa_banner_dismissed";

  function renderBanner(container, enabled) {
    var slot = document.getElementById("atlas-2fa-banner-slot");
    if (!slot) return;
    if (enabled || sessionStorage.getItem(BANNER_DISMISS_KEY) === "1") {
      slot.innerHTML = "";
      return;
    }
    slot.innerHTML =
      '<div id="atlas-2fa-banner" style="display:flex;align-items:center;' +
      'gap:10px;background:rgba(201,168,76,.12);border:1px solid var(--gold);' +
      'border-radius:10px;padding:10px 14px;margin-bottom:18px;font-size:13px">' +
      '<span style="flex:1">🔒 Protect your account — enable two-factor ' +
      'sign-in (recommended).</span>' +
      '<a href="#twofa-section" id="atlas-2fa-banner-cta" style="font-weight:700;white-space:nowrap">Set up →</a>' +
      '<button type="button" id="atlas-2fa-banner-dismiss" style="margin:0;padding:4px 10px;' +
      'font-size:12px;background:transparent;border:1px solid var(--muted);color:var(--muted)">Dismiss</button>' +
      '</div>';
    document.getElementById("atlas-2fa-banner-dismiss").addEventListener("click", function () {
      sessionStorage.setItem(BANNER_DISMISS_KEY, "1");
      slot.innerHTML = "";
    });
  }

  function renderSection(container) {
    var A = window.AtlasAuth;

    function renderDisabled() {
      container.innerHTML =
        '<h2>🔒 Security</h2>' +
        '<p class="privacy" style="margin-bottom:10px">Two-factor sign-in is OFF. ' +
        'Add a Google-Authenticator-compatible app as a second step -- never required, ' +
        'but recommended for any account holding private contact info.</p>' +
        '<button type="button" id="twofa-enroll-btn">Enable two-factor sign-in</button>' +
        '<div class="msg" id="twofa-msg"></div>' +
        '<div id="twofa-enroll-box" style="display:none;margin-top:14px"></div>';
      document.getElementById("twofa-enroll-btn").addEventListener("click", startEnroll);
    }

    function renderEnabled() {
      container.innerHTML =
        '<h2>🔒 Security</h2>' +
        '<p class="privacy" style="margin-bottom:10px">Two-factor sign-in is ON. ' +
        'You\'ll be asked for a 6-digit code from your authenticator app at every sign-in.</p>' +
        '<label for="twofa-disable-code">Enter a current code to turn it off</label>' +
        '<input id="twofa-disable-code" type="text" inputmode="numeric" maxlength="6" placeholder="123456">' +
        '<button type="button" id="twofa-disable-btn">Disable two-factor sign-in</button>' +
        '<div class="msg" id="twofa-msg"></div>';
      document.getElementById("twofa-disable-btn").addEventListener("click", function () {
        var msg = document.getElementById("twofa-msg");
        var code = document.getElementById("twofa-disable-code").value.trim();
        A.post("/auth/2fa/disable", { code: code }).then(function () {
          msg.textContent = "Two-factor sign-in disabled."; msg.className = "msg ok";
          renderDisabled();
          renderBanner(container, false);
        }).catch(function (e) {
          msg.textContent = e.body && e.body.detail ? e.body.detail : "Could not disable -- check the code.";
          msg.className = "msg error";
        });
      });
    }

    function startEnroll() {
      var msg = document.getElementById("twofa-msg");
      var box = document.getElementById("twofa-enroll-box");
      A.post("/auth/2fa/enroll").then(function (r) {
        box.style.display = "block";
        box.innerHTML =
          '<p style="font-size:13px;margin-bottom:6px">Scan this with Google Authenticator ' +
          '(or any TOTP app), or enter the setup key manually:</p>' +
          '<p style="font-family:monospace;font-size:14px;letter-spacing:.05em;' +
          'word-break:break-all;background:var(--bg);padding:8px;border-radius:6px">' +
          A.escapeHtml(r.secret_b32) + '</p>' +
          '<p style="font-size:11px;color:var(--muted);margin:6px 0 12px;word-break:break-all">' +
          A.escapeHtml(r.otpauth_uri) + '</p>' +
          '<label for="twofa-confirm-code">Enter the 6-digit code from your app</label>' +
          '<input id="twofa-confirm-code" type="text" inputmode="numeric" maxlength="6" placeholder="123456">' +
          '<button type="button" id="twofa-confirm-btn">Confirm and enable</button>';
        document.getElementById("twofa-confirm-btn").addEventListener("click", function () {
          var code = document.getElementById("twofa-confirm-code").value.trim();
          A.post("/auth/2fa/confirm", { code: code }).then(function () {
            msg.textContent = "Two-factor sign-in is now ON."; msg.className = "msg ok";
            renderEnabled();
            renderBanner(container, true);
          }).catch(function (e) {
            msg.textContent = e.body && e.body.detail ? e.body.detail : "Invalid code -- try again.";
            msg.className = "msg error";
          });
        });
      }).catch(function (e) {
        msg.textContent = e.body && e.body.detail ? e.body.detail : "Could not start enrollment.";
        msg.className = "msg error";
      });
    }

    A.get("/auth/2fa/status").then(function (r) {
      if (r.enabled) { renderEnabled(); } else { renderDisabled(); }
    }).catch(function () {
      renderDisabled();
    });
  }

  function mount(container, meResult) {
    if (!container) return;
    renderBanner(container, !!(meResult && meResult.twofa_enabled));
    renderSection(container);
  }

  return { mount: mount };
})();
