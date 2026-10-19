/* COMEDY ATLAS -- the comic's one-tap availability page (product spec P2.6).
 *
 * The magic link is  avail.html#t=<token>&l=<en|fr>.  The token lives in the URL
 * FRAGMENT, which a browser never sends to any server: it cannot reach an access
 * log, a CDN log or a Referer header. This script reads it and POSTs it to
 * /avail/open and /avail/answer. No cookies, no login, no analytics, no
 * third-party scripts on this page.
 *
 * Everything dynamic goes through escapeHtml (first name, show name, title, date
 * labels). safeHttpUrl is the only way a URL could ever be rendered; today the
 * API sends none, so nothing here renders one.
 *
 * Works in a browser (auto-start) and under node (module.exports, no DOM) so the
 * rendering and the helpers are unit-testable.
 */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.AvailPage = api; }
  if (typeof document !== "undefined" && !root.AVAIL_NO_AUTOSTART) { api.start(); }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  var TEXT = {
    en: {
      hi: "Hi {name}", askShow: "{from} is asking: are you free for {show}?",
      askNoFrom: "Are you free for {show}?",
      yesAll: "Yes to all dates", yes: "Yes", maybe: "Maybe", no: "No",
      saved: "Saved ✓", saving: "Saving…", failed: "Could not save. Check your connection and tap again.",
      validUntil: "This link works until {date}.",
      privacy: "Only your first name and these answers are shown to the person who sent you this link.",
      loading: "Loading…", bad: "This link is not valid.",
      badHelp: "Please ask the person who sent it for a new one.",
      expired: "This link has expired.", expiredHelp: "Ask the person who sent it for a fresh link.",
      closedTitle: "This poll is closed.", locked: "The date is set: {date}",
      youIn: "You said Yes. See you there!", thanks: "Thanks for answering.",
      tooMany: "Too many tries. Wait a minute and try again.",
      netError: "No connection. Tap to retry.", retry: "Try again", lang: "FR",
      dateFor: "Answer for {date}"
    },
    fr: {
      hi: "Salut {name}", askShow: "{from} te demande : es-tu libre pour {show} ?",
      askNoFrom: "Es-tu libre pour {show} ?",
      yesAll: "Oui à toutes les dates", yes: "Oui", maybe: "Peut-être", no: "Non",
      saved: "Enregistré ✓", saving: "Enregistrement…", failed: "Échec de l'enregistrement. Vérifie ta connexion et réessaie.",
      validUntil: "Ce lien fonctionne jusqu'au {date}.",
      privacy: "Seuls ton prénom et ces réponses sont visibles par la personne qui t'a envoyé ce lien.",
      loading: "Chargement…", bad: "Ce lien n'est pas valide.",
      badHelp: "Demande-en un nouveau à la personne qui te l'a envoyé.",
      expired: "Ce lien a expiré.", expiredHelp: "Demande un nouveau lien à la personne qui te l'a envoyé.",
      closedTitle: "Ce sondage est clos.", locked: "La date est fixée : {date}",
      youIn: "Tu as dit Oui. À bientôt sur scène !", thanks: "Merci pour ta réponse.",
      tooMany: "Trop d'essais. Attends une minute et réessaie.",
      netError: "Pas de connexion. Touche pour réessayer.", retry: "Réessayer", lang: "EN",
      dateFor: "Réponse pour le {date}"
    }
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"'`]/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;"}[c];
    });
  }

  function safeHttpUrl(raw) {
    try {
      var u = new URL(String(raw));
      return (u.protocol === "https:" || u.protocol === "http:") ? u.href : "";
    } catch (e) { return ""; }
  }

  function parseFragment(hash) {
    var out = {t: "", l: ""};
    String(hash || "").replace(/^#/, "").split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i < 0) { return; }
      var k = kv.slice(0, i), v = kv.slice(i + 1);
      try { v = decodeURIComponent(v); } catch (e) { return; }
      if (k === "t" || k === "l") { out[k] = v; }
    });
    return out;
  }

  function pickLang(fragLang, navLang) {
    if (fragLang === "fr" || fragLang === "en") { return fragLang; }
    return /^fr/i.test(navLang || "") ? "fr" : "en";
  }

  function t(lang, key, vars) {
    var s = (TEXT[lang] || TEXT.en)[key];
    if (s == null) { s = TEXT.en[key] || key; }
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] != null ? vars[k] : m;
    });
  }

  // "2026-11-05" -> "Thu 5 Nov" / "jeu. 5 nov." -- read as UTC so no timezone can shift the day.
  function formatDate(iso, lang) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (!m) { return String(iso); }
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    try {
      return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB",
        {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"}).format(d);
    } catch (e) { return String(iso); }
  }

  function apiBase(hostname) {
    if (hostname === "atlas-api.pariscomedy.com" || hostname === "api.comedyatlas.app") { return ""; }
    if (hostname === "comedyatlas.app" || hostname === "www.comedyatlas.app") { return "https://api.comedyatlas.app"; }
    return "https://atlas-api.pariscomedy.com";
  }

  function choicesHtml(date, current, lang) {
    var label = formatDate(date, lang);
    return ["yes", "maybe", "no"].map(function (v) {
      var on = current === v;
      return '<button type="button" class="ch ' + v + (on ? " on" : "") + '" data-date="' + escapeHtml(date) +
        '" data-v="' + v + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' +
        escapeHtml(t(lang, "dateFor", {date: label}) + ": " + t(lang, v)) + '">' +
        escapeHtml(t(lang, v)) + "</button>";
    }).join("");
  }

  function renderReady(v, lang) {
    var show = v.show_name || v.title || "";
    var ask = v.from_name
      ? t(lang, "askShow", {from: escapeHtml(v.from_name), show: "<b>" + escapeHtml(show) + "</b>"})
      : t(lang, "askNoFrom", {show: "<b>" + escapeHtml(show) + "</b>"});
    var cards = (v.dates || []).map(function (d) {
      return '<div class="date" data-card="' + escapeHtml(d) + '"><div class="dlabel">' +
        escapeHtml(formatDate(d, lang)) + '</div><div class="choices" role="group">' +
        choicesHtml(d, (v.answers || {})[d], lang) + "</div></div>";
    }).join("");
    return "<h1>" + escapeHtml(t(lang, "hi", {name: v.first_name})) + "</h1>" +
      '<p class="sub">' + ask + "</p>" +
      '<button type="button" class="yesall" data-act="all">✅ ' + escapeHtml(t(lang, "yesAll")) + "</button>" +
      '<div id="dates">' + cards + "</div>" +
      '<p class="status" id="status" role="status" aria-live="polite"></p>' +
      '<p class="fine">' + escapeHtml(t(lang, "validUntil", {date: formatDate(v.expires_on, lang)})) + " " +
      escapeHtml(t(lang, "privacy")) + "</p>";
  }

  function renderClosed(v, lang) {
    var body = "";
    if (v.locked_date) {
      body = '<p class="big">' + escapeHtml(t(lang, "locked", {date: formatDate(v.locked_date, lang)})) + "</p>" +
        "<p>" + escapeHtml(v.your_answer_for_locked === "yes" ? t(lang, "youIn") : t(lang, "thanks")) + "</p>";
    }
    return '<div class="panel"><p class="big">' + escapeHtml(t(lang, "closedTitle")) + "</p>" + body + "</div>";
  }

  function renderMessage(kind, lang) {
    var title = kind === "expired" ? "expired" : kind === "limited" ? "tooMany" : kind === "net" ? "netError" : "bad";
    var help = kind === "expired" ? "expiredHelp" : kind === "bad" ? "badHelp" : null;
    return '<div class="panel"><p class="big">' + escapeHtml(t(lang, title)) + "</p>" +
      (help ? "<p>" + escapeHtml(t(lang, help)) + "</p>" : "") +
      (kind === "net" || kind === "limited"
        ? '<button type="button" class="lang" data-act="retry">' + escapeHtml(t(lang, "retry")) + "</button>" : "") +
      "</div>";
  }

  function render(state, lang) {
    if (state.kind === "ready") { return renderReady(state.view, lang); }
    if (state.kind === "closed") { return renderClosed(state.view, lang); }
    if (state.kind === "loading") { return '<p class="sub">' + escapeHtml(t(lang, "loading")) + "</p>"; }
    return renderMessage(state.kind, lang);
  }

  // ------------------------------------------------------------ browser glue
  function start() {
    var doc = root.document, loc = root.location;
    var app = doc.getElementById("app");
    var frag = parseFragment(loc.hash);
    var lang = pickLang(frag.l, (root.navigator && root.navigator.language) || "");
    var token = frag.t;
    var base = apiBase(loc.hostname);
    var view = null, state = {kind: "loading"};

    function post(path, body) {
      return root.fetch(base + path, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body), cache: "no-store", credentials: "omit",
        referrerPolicy: "no-referrer"
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return {status: res.status, data: data};
        });
      });
    }

    function paint() {
      doc.documentElement.setAttribute("lang", lang);
      var btn = doc.getElementById("lang-toggle");
      if (btn) { btn.textContent = t(lang, "lang"); }
      app.innerHTML = render(state, lang);
    }
    function say(msg, cls) {
      var el = doc.getElementById("status");
      if (el) { el.textContent = msg; el.className = "status" + (cls ? " " + cls : ""); }
    }
    function kindFor(status) {
      if (status === 410) { return "expired"; }
      if (status === 429) { return "limited"; }
      return "bad";
    }
    function load() {
      state = {kind: "loading"}; paint();
      if (!token) { state = {kind: "bad"}; paint(); return; }
      post("/avail/open", {token: token}).then(function (r) {
        if (r.status !== 200) { state = {kind: kindFor(r.status)}; paint(); return; }
        view = r.data;
        if (!frag.l && view.lang) { lang = pickLang(view.lang, ""); }
        state = {kind: view.status === "open" ? "ready" : "closed", view: view};
        paint();
      }).catch(function () { state = {kind: "net"}; paint(); });
    }
    function save(changes) {
      var prev = {};
      Object.keys(changes).forEach(function (d) { prev[d] = view.answers[d]; view.answers[d] = changes[d]; });
      paint(); say(t(lang, "saving"));
      post("/avail/answer", {token: token, answers: changes}).then(function (r) {
        if (r.status === 200) { view.answers = r.data.answers || view.answers; paint(); say(t(lang, "saved"), "ok"); return; }
        if (r.status === 410 || r.status === 404) { load(); return; }
        throw new Error("save " + r.status);
      }).catch(function () {
        Object.keys(prev).forEach(function (d) { if (prev[d] == null) { delete view.answers[d]; } else { view.answers[d] = prev[d]; } });
        paint(); say(t(lang, "failed"), "err");
      });
    }

    app.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (!el || !view) { return; }
      if (el.getAttribute("data-act") === "retry") { load(); return; }
      if (el.getAttribute("data-act") === "all") {
        var all = {}; view.dates.forEach(function (d) { all[d] = "yes"; }); save(all); return;
      }
      var d = el.getAttribute("data-date"), v = el.getAttribute("data-v");
      if (d && v) { var one = {}; one[d] = v; save(one); }
    });
    var tg = doc.getElementById("lang-toggle");
    if (tg) { tg.addEventListener("click", function () { lang = lang === "fr" ? "en" : "fr"; paint(); }); }
    load();
  }

  return {start: start, render: render, escapeHtml: escapeHtml, safeHttpUrl: safeHttpUrl,
          parseFragment: parseFragment, pickLang: pickLang, t: t, formatDate: formatDate,
          apiBase: apiBase, TEXT: TEXT};
});
