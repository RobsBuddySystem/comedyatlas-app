/* Public newsletter sign-up widget, shared by comedyatlas.app AND
   pariscomedy.com (Robert approved 2026-09-26 23:54, "yes build the
   newsletter signup"). POSTs to the Atlas API's /newsletter/subscribe
   (apps/atlas_api/routes_newsletter.py); double opt-in -- the API sends a
   confirmation email, this widget never claims someone is subscribed
   until they click that link.

   Origin-aware API base -- same shape as atlas-waitlist.js's own
   API_BASE (comedyatlas.app / www.comedyatlas.app /
   atlas-api.pariscomedy.com / api.comedyatlas.app all resolve to the one
   shared API host; anything else, including pariscomedy.com serving THIS
   file as a standalone snippet, falls back to the pariscomedy API
   absolutely).

   Renders into any element with id="atlas-newsletter-mount" already
   present on the page -- callers place that empty div wherever the
   sign-up should appear (index.html's footer area, or the standalone
   Paris Comedy snippet's own markup) and include this script; nothing
   else is required. */
(function () {
  "use strict";

  var API_BASE = (function (h) {
    if (h === "atlas-api.pariscomedy.com" || h === "api.comedyatlas.app") return "";
    if (h === "comedyatlas.app" || h === "www.comedyatlas.app") return "https://api.comedyatlas.app";
    return "https://atlas-api.pariscomedy.com";
  })(location.hostname);

  var SOURCE_SITE = (function (h) {
    return (h === "comedyatlas.app" || h === "www.comedyatlas.app" ||
            h === "api.comedyatlas.app") ? "comedyatlas" : "pariscomedy";
  })(location.hostname);

  var LANG = (document.documentElement.lang || "en").slice(0, 2) === "fr" ? "fr" : "en";

  var COPY = {
    en: {
      heading: "Get the COMEDY ATLAS newsletter",
      sub: "What's on, new rooms, and comic spotlights. No spam, unsubscribe any time with one click.",
      email_ph: "you@example.com",
      city_ph: "Your city (optional)",
      lang_label: "Language",
      interests_label: "What are you into? (optional)",
      consent: "I'd like to get COMEDY ATLAS's newsletter by email. I can unsubscribe at any time with one click.",
      submit: "Sign up",
      sending: "Sending…",
      ok: "Check your email to confirm your subscription.",
      ok_already: "You're already subscribed.",
      err: "Something went wrong -- please try again in a minute.",
      err_email: "Please enter a valid email address.",
      err_consent: "Please tick the box to confirm you'd like the newsletter.",
    },
    fr: {
      heading: "Recevoir la newsletter COMEDY ATLAS",
      sub: "L'actualité des salles, les nouvelles adresses, les coups de cœur. Pas de spam, désinscription en un clic.",
      email_ph: "toi@exemple.com",
      city_ph: "Ta ville (optionnel)",
      lang_label: "Langue",
      interests_label: "Ça t'intéresse ? (optionnel)",
      consent: "Je souhaite recevoir la newsletter de COMEDY ATLAS par e-mail. Je peux me désinscrire à tout moment en un clic.",
      submit: "S'inscrire",
      sending: "Envoi…",
      ok: "Regarde ta boîte mail pour confirmer ton inscription.",
      ok_already: "Tu es déjà inscrit·e.",
      err: "Une erreur est survenue -- réessaie dans une minute.",
      err_email: "Merci d'indiquer une adresse e-mail valide.",
      err_consent: "Coche la case pour confirmer que tu veux la newsletter.",
    },
  };

  var INTERESTS = [
    ["stand-up", {en: "Stand-up", fr: "Stand-up"}],
    ["improv", {en: "Improv", fr: "Impro"}],
    ["sketch", {en: "Sketch", fr: "Sketch"}],
    ["english-shows", {en: "English-language shows", fr: "Spectacles en anglais"}],
    ["french-shows", {en: "French-language shows", fr: "Spectacles en français"}],
    ["festivals", {en: "Festivals", fr: "Festivals"}],
    ["open-mics", {en: "Open mics", fr: "Scènes ouvertes"}],
    ["christian-comedy", {en: "Christian comedy", fr: "Comédie chrétienne"}],
    ["indian-comedy", {en: "Indian comedy", fr: "Comédie indienne"}],
  ];

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
  }

  function render(mount) {
    var t = COPY[LANG];
    var interestsHtml = INTERESTS.map(function (pair) {
      var id = pair[0], labels = pair[1];
      return (
        '<label style="display:inline-flex;align-items:center;gap:5px;margin:3px 10px 3px 0;font-size:13px;color:var(--muted,#8899aa)">' +
        '<input type="checkbox" name="nl-interest" value="' + id + '"> ' + escapeHtml(labels[LANG]) +
        "</label>"
      );
    }).join("");

    mount.innerHTML =
      '<div class="atlas-newsletter-box" style="max-width:520px;margin:0 auto;padding:20px;border:1px solid var(--border,#1e2a3a);border-radius:10px;text-align:left">' +
      '<h3 style="margin:0 0 4px;font-size:18px;color:var(--text,#f0f0f0)">' + escapeHtml(t.heading) + "</h3>" +
      '<p style="margin:0 0 14px;font-size:13.5px;color:var(--muted,#8899aa)">' + escapeHtml(t.sub) + "</p>" +
      '<form id="atlas-newsletter-form" novalidate>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
      '<input type="email" id="nl-email" required placeholder="' + escapeHtml(t.email_ph) + '" ' +
      'aria-label="Email" style="flex:1 1 220px;padding:9px 10px;border-radius:6px;border:1px solid var(--border,#1e2a3a);background:transparent;color:inherit">' +
      '<input type="text" id="nl-city" placeholder="' + escapeHtml(t.city_ph) + '" ' +
      'aria-label="City" style="flex:1 1 140px;padding:9px 10px;border-radius:6px;border:1px solid var(--border,#1e2a3a);background:transparent;color:inherit">' +
      "</div>" +
      // Honeypot -- visually hidden, unlabeled, never filled by a real
      // person; apps/atlas_api/routes_newsletter.py treats any non-empty
      // value here as a bot and silently no-ops.
      '<input type="text" id="nl-website" name="website" tabindex="-1" autocomplete="off" ' +
      'style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" aria-hidden="true">' +
      '<div style="margin-bottom:8px">' +
      '<div style="font-size:12.5px;color:var(--muted,#8899aa);margin-bottom:4px">' + escapeHtml(t.interests_label) + "</div>" +
      interestsHtml +
      "</div>" +
      '<label style="display:flex;align-items:flex-start;gap:6px;font-size:12.5px;color:var(--muted,#8899aa);margin-bottom:10px">' +
      '<input type="checkbox" id="nl-consent" required style="margin-top:2px"> <span>' + escapeHtml(t.consent) + "</span>" +
      "</label>" +
      '<button type="submit" id="nl-submit" style="padding:10px 18px;border-radius:6px;border:none;background:var(--gold-btn,#c9a84c);color:#100c00;font-weight:700;cursor:pointer">' +
      escapeHtml(t.submit) + "</button>" +
      '<div id="nl-status" role="status" style="margin-top:8px;font-size:13px"></div>' +
      "</form>" +
      "</div>";

    var form = mount.querySelector("#atlas-newsletter-form");
    var status = mount.querySelector("#nl-status");

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      status.textContent = "";
      status.style.color = "";

      var email = mount.querySelector("#nl-email").value.trim();
      var consent = mount.querySelector("#nl-consent").checked;
      if (!email || email.indexOf("@") === -1) {
        status.textContent = t.err_email;
        status.style.color = "#d9534f";
        return;
      }
      if (!consent) {
        status.textContent = t.err_consent;
        status.style.color = "#d9534f";
        return;
      }

      var interests = Array.prototype.slice
        .call(mount.querySelectorAll('input[name="nl-interest"]:checked'))
        .map(function (el) { return el.value; });

      var submitBtn = mount.querySelector("#nl-submit");
      submitBtn.disabled = true;
      var prevLabel = submitBtn.textContent;
      submitBtn.textContent = t.sending;

      fetch(API_BASE + "/newsletter/subscribe", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          email: email,
          source_site: SOURCE_SITE,
          city: mount.querySelector("#nl-city").value.trim() || null,
          language: LANG,
          interests: interests,
          website: mount.querySelector("#nl-website").value,
        }),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (!res.ok) throw new Error(body.detail || res.statusText);
            return body;
          });
        })
        .then(function (body) {
          status.style.color = "#3a9a5c";
          status.textContent = body.already_confirmed ? t.ok_already : t.ok;
          form.reset();
        })
        .catch(function () {
          status.style.color = "#d9534f";
          status.textContent = t.err;
        })
        .then(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = prevLabel;
        });
    });
  }

  function init() {
    var mount = document.getElementById("atlas-newsletter-mount");
    if (mount) render(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
