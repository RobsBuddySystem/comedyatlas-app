/*
 * COMEDY ATLAS — free poster maker (site/comedy-atlas/poster.js)
 *
 * Canvas-based poster editor, no framework, no build step, no CDN.
 * Everything runs client-side: uploaded photos are drawn onto a local
 * <canvas> and NEVER leave the device. Fonts are bundled woff2 files
 * (assets/fonts/, see OFL-LICENSES.txt) declared in poster.css. The QR code
 * comes from vendor/qr-encoder.js (offline, MIT).
 *
 * 2026-10-15: FORM PANEL. The page now has a right-hand form (show, when,
 * where, lineup, tickets, brand, extras) plus a "Don't forget" checklist.
 * The form is the source of truth: layout() turns the form into text blocks
 * and items (lineup, ribbons, QR, logo) and re-flows them for every canvas
 * ratio. Direct manipulation still works: a dragged / restyled / retyped
 * element is stored in state.ov[key] (an "override") and survives later form
 * edits. "Reset layout" clears the overrides and re-flows.
 *
 * Data contract: GET /v1/events (apps/atlas_api/routes_public_api.py), via
 * the SAME AtlasAuth.apiBase origin-resolution atlas-auth.js's portal pages
 * use (script tag added 2026-07-25) -- NOT the ../data/comedy-atlas/
 * upcoming_events.json static export atlas-common.js's site pages read.
 * That export only exists on the GitHub-Pages apex deploy tree
 * (comedyatlas.app/data/comedy-atlas/upcoming_events.json); poster.html is
 * ALSO served live off api.comedyatlas.app (apps/atlas_api/main.py's
 * StaticFiles-equivalent /comedy-atlas/{file_path} mount), which has no
 * /data/ route at all -- every "Start from a show" search there 404'd
 * (2026-07-25 Robert portal punch list, item 4a). /v1/events is a real API
 * route that exists on both origins the page can be loaded from, so this
 * is now correct regardless of which one served this page.
 * Picking a show prefills title / date / venue / ticket URL; the
 * ?event=<slug> query param (slug or show_series_slug) deep-links a
 * prefilled editor so show pages and the booker portal can offer a
 * one-tap "make a poster for this show".
 *
 * Coordinates: text blocks store x/y/size as FRACTIONS of canvas
 * width/height so a poster survives switching between sizes without
 * re-layout of the stored overrides. The canvas element is always full
 * export resolution; CSS scales it down for display, so export is just
 * canvas.toBlob.
 */
(function () {
  "use strict";

  var EVENTS_ENDPOINT = "/v1/events?limit=200";
  var STICKER_URL = "assets/brand/atlas-character-hero-600.png";
  var DRAFT_KEY = "atlas.poster.draft.v1";
  var PREFS_KEY = "atlas.poster.prefs.v1";

  var SIZES = {
    "ig-post":     { w: 1080, h: 1080, label: "Square" },
    "ig-portrait": { w: 1080, h: 1350, label: "IG post 4:5" },
    "ig-story":    { w: 1080, h: 1920, label: "IG story" },
    "fb-cover":    { w: 1920, h: 1005, label: "Facebook event cover" },
    "a4":          { w: 2480, h: 3508, label: "A4 print" },
    // A3 at 250 dpi (not 300): 3508x4961 is over the 16.7 megapixel canvas
    // limit of iPhone/iPad browsers and the export would silently fail there.
    "a3":          { w: 2923, h: 4134, label: "A3 print" }
  };

  var FONTS = {
    anton:    { family: "PosterAnton",    weight: 400 },
    oswald:   { family: "PosterOswald",   weight: 600 },
    playfair: { family: "PosterPlayfair", weight: 700 },
    inter:    { family: "PosterInter",    weight: 700 },
    marker:   { family: "PosterMarker",   weight: 400 }
  };

  // Font pairings: display = titles, accent = date / kicker / buttons, body = small print.
  var PAIRS = {
    poster:    { display: "anton",    accent: "oswald",   body: "inter" },
    classic:   { display: "playfair", accent: "inter",    body: "inter" },
    condensed: { display: "oswald",   accent: "oswald",   body: "inter" },
    hand:      { display: "marker",   accent: "marker",   body: "inter" },
    editorial: { display: "playfair", accent: "oswald",   body: "inter" }
  };

  var PALETTES = {
    velvet:  { bg1: "#7A163C", bg2: "#34081C", text: "#F7ECDE", accent: "#E2B05C" },
    neutral: { bg1: "#f7f5f0", bg2: "#e6e0d2", text: "#171512", accent: "#7c3aed" },
    dark:    { bg1: "#0a0e1a", bg2: "#1b2238", text: "#f0f0f0", accent: "#c9a84c" },
    bright:  { bg1: "#ffd23f", bg2: "#ff9f1c", text: "#171512", accent: "#c41e3a" }
  };

  // ------------------------------------------------------------ templates
  // C = colours by role, F = fonts by role. roles = which colour role each slot uses.
  var TEMPLATES = {
    classic: {
      bg: { mode: "gradient", c1: "#0a0e1a", c2: "#3b1a5e" },
      C: { text: "#ffffff", accent: "#c9a84c", accent2: "#e8c96a", muted: "#8899aa" },
      F: { display: "anton", accent: "oswald", body: "inter" },
      align: "center", vAlign: "center", titleSize: 0.115, upperTitle: true,
      dateRole: "accent", dateUpper: true, dateSize: 0.045, venueRole: "body", venueUpper: false,
      roles: {}
    },
    house: {
      bg: { mode: "gradient", c1: "#7A163C", c2: "#34081C" },
      C: { text: "#F7ECDE", accent: "#E2B05C", accent2: "#E2B05C", muted: "#d8c2ae" },
      F: { display: "playfair", accent: "oswald", body: "inter" },
      align: "center", vAlign: "center", titleSize: 0.092, upperTitle: true, rules: true,
      dateRole: "accent", dateUpper: true, dateSize: 0.042, venueRole: "accent", venueUpper: true,
      roles: { date: "accent", price: "accent" }
    },
    minimal: {
      bg: { mode: "solid", c1: "#f7f5f0", c2: "#f7f5f0" },
      C: { text: "#171512", accent: "#7c3aed", accent2: "#7c3aed", muted: "#5a5348" },
      F: { display: "playfair", accent: "inter", body: "inter" },
      align: "left", vAlign: "center", mX: 0.08, titleSize: 0.105, upperTitle: false,
      dateRole: "body", dateUpper: false, dateSize: 0.036, venueRole: "body", venueUpper: false,
      roles: { date: "text", kicker: "muted" }
    },
    photo: {
      bg: { mode: "photo", c1: "#0a0e1a", c2: "#101828" },
      C: { text: "#ffffff", accent: "#e8c96a", accent2: "#e8c96a", muted: "#d0d6e0" },
      F: { display: "oswald", accent: "oswald", body: "inter" },
      align: "left", vAlign: "bottom", mX: 0.07, titleSize: 0.095, upperTitle: true,
      dateRole: "body", dateUpper: false, dateSize: 0.036, venueRole: "body", venueUpper: false,
      roles: { date: "text" }
    },
    fringe: {
      bg: { mode: "solid", c1: "#c9a84c", c2: "#c9a84c" },
      C: { text: "#171512", accent: "#c41e3a", accent2: "#171512", muted: "#3d3728" },
      F: { display: "anton", accent: "oswald", body: "inter" },
      align: "center", vAlign: "top", titleSize: 0.085, upperTitle: true, banner: "COMEDY",
      dateRole: "accent", dateUpper: true, dateSize: 0.042, venueRole: "accent", venueUpper: true, star: true,
      roles: { title: "accent", date: "text", venue: "text", tickets: "text", kicker: "text" }
    },
    marker: {
      bg: { mode: "solid", c1: "#f7f5f0", c2: "#f7f5f0" },
      C: { text: "#171512", accent: "#c41e3a", accent2: "#7c3aed", muted: "#5a5348" },
      F: { display: "marker", accent: "marker", body: "inter" },
      align: "center", vAlign: "center", titleSize: 0.095, upperTitle: false,
      dateRole: "accent", dateUpper: false, dateSize: 0.05, venueRole: "body", venueUpper: false,
      roles: { date: "text", tickets: "accent2" }
    }
  };

  // ------------------------------------------------------- poster wording
  // b:1 = in "English and French" mode show both ("Free entry / Entrée libre").
  var LBL = {
    liveComedy: { en: "Live comedy", fr: "Comédie en direct" },
    doors:      { en: "Doors", fr: "Portes" },
    show:       { en: "Show", fr: "Début" },
    ends:       { en: "Ends", fr: "Fin" },
    tickets:    { en: "Tickets", fr: "Billets" },
    scan:       { en: "Scan for tickets", fr: "Scannez pour réserver", b: 1 },
    free:       { en: "Free entry", fr: "Entrée libre", b: 1 },
    pwyw:       { en: "Pay what you want", fr: "Prix libre", b: 1 },
    from:       { en: "From", fr: "À partir de" },
    allAges:    { en: "All ages", fr: "Tout public" },
    langEn:     { en: "In English", fr: "En anglais" },
    langFr:     { en: "In French", fr: "En français" },
    langBi:     { en: "In English and French", fr: "En anglais et en français" },
    presented:  { en: "Presented by", fr: "Présenté par" },
    transit:    { en: "Getting there", fr: "Accès" },
    entrance:   { en: "Entrance", fr: "Entrée" },
    sold:       { en: "Sold out", fr: "Complet", b: 1 },
    last:       { en: "Last tickets", fr: "Dernières places", b: 1 },
    resa:       { en: "Reservations recommended", fr: "Réservation conseillée", b: 1 },
    doorsAt:    { en: "Doors open at", fr: "Ouverture des portes à" },
    bar:        { en: "Bar open", fr: "Bar ouvert", b: 1 },
    special:    { en: "Special guest", fr: "Invité spécial", b: 1 },
    roleHeadliner: { en: "Headliner", fr: "Tête d'affiche" },
    roleMc:     { en: "MC", fr: "MC" },
    roleHost:   { en: "Host", fr: "Hôte" },
    roleGuest:  { en: "Guest", fr: "Invité" },
    roleFeature: { en: "Feature", fr: "Feature" },
    listed:     { en: "Listed on ComedyAtlas.app", fr: "Listed on ComedyAtlas.app" },
    madeWith:   { en: "Made with ComedyAtlas.app", fr: "Made with ComedyAtlas.app" }
  };
  var ROLE_KEYS = { headliner: "roleHeadliner", mc: "roleMc", host: "roleHost", guest: "roleGuest", feature: "roleFeature" };

  var EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var EN_DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var FR_DAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  var FR_EVERY = ["dimanches", "lundis", "mardis", "mercredis", "jeudis", "vendredis", "samedis"];
  var FR_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  var FORMAT_LABEL = {
    standup: "Stand-up", openmic: "Open mic", improv: "Improv", showcase: "Showcase",
    storytelling: "Storytelling", roast: "Roast"
  };
  var FORMAT_PHRASE = {
    standup: "stand-up comedy", openmic: "open mic", improv: "improv comedy", showcase: "comedy showcase",
    storytelling: "storytelling", roast: "roast comedy"
  };

  // ---------------------------------------------------------------- state
  var state = {
    sizeKey: "ig-post",
    templateKey: "classic",
    bg: { mode: "gradient", c1: "#0a0e1a", c2: "#2a1a4a", img: null, darken: 0.4 },
    blocks: [],      // text blocks produced by layout() (+ your own added text)
    items: [],       // non-text things: lineup, ribbons, qr, logo, rules
    ov: {},          // manual overrides by block/item key (position, font, colour, text...)
    custom: [],      // text you added with "Add text"
    sticker: { on: false, x: 0.85, y: 0.88, scaleF: 0.22 },
    credit: true,
    selected: null,
    show: null       // prefill data of the picked show, null = blank canvas
  };
  var form = defaultForm();
  var nextCustom = 1;
  var stickerImg = null;
  var fontsReady = false;
  var allEvents = null;
  var imgs = {};          // image store: id -> { img, url }
  var nextImg = 1;
  var qrCache = { url: null, q: null };
  var captionEdited = false;

  var canvas = document.getElementById("poster-canvas");
  var ctx = canvas.getContext("2d");

  function $(id) { return document.getElementById(id); }

  function defaultForm() {
    return {
      title: "", tagline: "", formats: ["standup"], formatOther: "", lang: "en", age: "",
      priceKind: "", priceAmt: "", promo: "",
      date: "", weekly: false, doors: "19:30", start: "20:00", end: "", timeFmt: prefTimeFmt(),
      venue: "", address: "", city: "", transit: "", mapUrl: "", entrance: "",
      lineup: [], nextLu: 1, showHeads: true, showHandles: true,
      ticketUrl: "", qr: false, qrCorner: "br", website: "", instagram: "", hashtag: "",
      presented: "", sponsor: "",
      logoId: null, logoPos: "tl", logoSize: 16, palette: null, pair: "none",
      ribbons: [], note: ""
    };
  }

  // -------------------------------------------------------- safe storage
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }
  function lsDel(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
  }
  function prefTimeFmt() {
    var raw = lsGet(PREFS_KEY), p = null;
    try { p = raw ? JSON.parse(raw) : null; } catch (e) { p = null; }
    return p && /^(12|24|fr)$/.test(p.timeFmt) ? p.timeFmt : "24";
  }
  function savePrefs() { lsSet(PREFS_KEY, JSON.stringify({ timeFmt: form.timeFmt })); }

  // ---------------------------------------------------------- text blocks
  function makeBlock(opts) {
    return {
      id: opts.id != null ? opts.id : "b" + (nextCustom++),
      text: opts.text || "Your text",
      font: opts.font || "inter",
      sizeF: opts.sizeF || 0.05,     // font size as fraction of canvas width
      color: opts.color || "#ffffff",
      align: opts.align || "center", // anchor interpretation of x
      x: opts.x != null ? opts.x : 0.5,  // anchor x (fraction of W)
      y: opts.y != null ? opts.y : 0.5,  // top y (fraction of H)
      maxwF: opts.maxwF || 0.86,     // wrap width (fraction of W)
      upper: !!opts.upper,
      lineH: opts.lineH || 1.12,
      _bbox: null
    };
  }

  function fontString(block, W) {
    var f = FONTS[block.font] || FONTS.inter;
    var px = Math.max(8, Math.round(block.sizeF * W));
    return f.weight + " " + px + "px " + f.family + ", sans-serif";
  }
  function fontCss(key, px) {
    var f = FONTS[key] || FONTS.inter;
    return f.weight + " " + Math.max(6, Math.round(px)) + "px " + f.family + ", sans-serif";
  }

  function wrapLines(block, W) {
    var text = block.upper ? block.text.toUpperCase() : block.text;
    ctx.font = fontString(block, W);
    var maxw = block.maxwF * W;
    var out = [];
    text.split("\n").forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); return; }
      var line = words[0];
      for (var i = 1; i < words.length; i++) {
        var probe = line + " " + words[i];
        if (ctx.measureText(probe).width > maxw) { out.push(line); line = words[i]; }
        else { line = probe; }
      }
      out.push(line);
    });
    return out;
  }

  // ------------------------------------------------------------ colour utils
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 0;
    var n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  }
  function mixHex(a, b, t) {
    var ma = /^#?([0-9a-f]{6})$/i.exec(a || ""), mb = /^#?([0-9a-f]{6})$/i.exec(b || "");
    if (!ma || !mb) return a;
    var na = parseInt(ma[1], 16), nb = parseInt(mb[1], 16), out = 0;
    [16, 8, 0].forEach(function (sh) {
      var ca = na >> sh & 255, cb = nb >> sh & 255;
      out = (out << 8) | Math.round(ca + (cb - ca) * t);
    });
    return "#" + ("000000" + out.toString(16)).slice(-6);
  }

  function bgIsLight() {
    if (state.bg.mode === "photo" && state.bg.img) return state.bg.darken < 0.15;
    return luminance(state.bg.c1) > 0.55;
  }

  function themeColors(T) {
    var C = { text: T.C.text, accent: T.C.accent, accent2: T.C.accent2, muted: T.C.muted };
    var p = form.palette;
    if (p) {
      C.text = p.text; C.accent = p.accent; C.accent2 = p.accent;
      C.muted = mixHex(p.text, p.bg1, 0.38);
    }
    return C;
  }
  function themeFonts(T) {
    var F = { display: T.F.display, accent: T.F.accent, body: T.F.body };
    var pr = PAIRS[form.pair];
    if (pr) { F.display = pr.display; F.accent = pr.accent; F.body = pr.body; }
    return F;
  }

  // ------------------------------------------------------- text formatting
  function L(key) {
    var o = LBL[key], lang = form.lang;
    if (!o) return key;
    if (lang === "fr") return o.fr;
    if (lang === "bi" && o.b) return o.en + " / " + o.fr;
    return o.en;
  }

  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return null;
    return { y: y, m: mo, d: d, wd: dt.getDay() };
  }

  // Thu 22 Oct (English / bilingual)  |  jeu. 22 oct. (French)
  function dateText(f) {
    var p = parseDate(f.date);
    if (!p) return "";
    var fr = f.lang === "fr";
    if (f.weekly) return fr ? "Tous les " + FR_EVERY[p.wd] : "Every " + EN_DAYS_LONG[p.wd];
    var yr = p.y !== new Date().getFullYear() ? " " + p.y : "";
    return fr ? FR_DAYS[p.wd] + " " + p.d + " " + FR_MONTHS[p.m - 1] + yr
              : EN_DAYS[p.wd] + " " + p.d + " " + EN_MONTHS[p.m - 1] + yr;
  }

  // 12-hour 8pm / 7:30pm | 24-hour 20:00 | French 20h00
  function fmtTime(hhmm, style) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
    if (!m) return "";
    var h = +m[1], mi = m[2];
    if (style === "fr") return h + "h" + mi;
    if (style === "12") {
      var h12 = h % 12 === 0 ? 12 : h % 12;
      return h12 + (mi === "00" ? "" : ":" + mi) + (h < 12 ? "am" : "pm");
    }
    return ("0" + h).slice(-2) + ":" + mi;
  }

  function timeLine(f) {
    var parts = [];
    if (f.doors) parts.push(L("doors") + " " + fmtTime(f.doors, f.timeFmt));
    if (f.start) parts.push(L("show") + " " + fmtTime(f.start, f.timeFmt));
    if (f.end) parts.push(L("ends") + " " + fmtTime(f.end, f.timeFmt));
    return parts.join("  ·  ");
  }

  function priceText(f) {
    var amt = String(f.priceAmt || "").replace(",", ".").trim();
    var n = amt === "" ? NaN : parseFloat(amt);
    var money = isNaN(n) ? "" : (f.lang === "fr" ? String(n).replace(".", ",") + " €" : "€" + n);
    if (f.priceKind === "free") return L("free");
    if (f.priceKind === "pwyw") return L("pwyw");
    if (f.priceKind === "amount") return money;
    if (f.priceKind === "from") return money ? L("from") + " " + money : "";
    return "";
  }

  function ageText(f) {
    if (f.age === "all") return L("allAges");
    if (f.age === "16" || f.age === "18") return f.age + "+";
    return "";
  }
  function langText(f) {
    return f.lang === "fr" ? LBL.langFr.fr : f.lang === "bi" ? LBL.langBi.en : LBL.langEn.en;
  }

  function formatsLine(f) {
    var out = [];
    (f.formats || []).forEach(function (k) {
      if (k === "other") { if ((f.formatOther || "").trim()) out.push(f.formatOther.trim()); }
      else if (FORMAT_LABEL[k]) out.push(FORMAT_LABEL[k]);
    });
    return out.join("  ·  ");
  }

  function normUrl(u) {
    u = (u || "").trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "";
    return /\./.test(u) && !/\s/.test(u) ? "https://" + u : "";
  }
  function shortUrl(u) {
    return (u || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  }
  function handle(h, ch) {
    h = (h || "").trim().replace(/^[@#]+/, "").replace(/\s+/g, "");
    return h ? ch + h : "";
  }

  function ribbonText(key) {
    if (key === "doors") {
      return form.doors ? L("doorsAt") + " " + fmtTime(form.doors, form.timeFmt) : "";
    }
    return L(key === "free" ? "free" : key === "sold" ? "sold" : key === "last" ? "last" : key === "resa" ? "resa" : "bar");
  }

  function roleText(c) {
    if (c.special) return L("special");
    var k = ROLE_KEYS[c.role];
    return k ? L(k) : "";
  }

  function initials(name) {
    var w = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "?";
    return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
  }

  // ------------------------------------------------------------ QR code
  function getQR() {
    var url = normUrl(form.ticketUrl);
    if (!form.qr || !url || !window.AtlasQR) return null;
    if (qrCache.url !== url) qrCache = { url: url, q: window.AtlasQR.encode(url) };
    return qrCache.q;
  }

  // ------------------------------------------------------------ layout engine
  function getOv(key) {
    if (!state.ov[key]) state.ov[key] = {};
    return state.ov[key];
  }

  function imgOf(id) { return id && imgs[id] ? imgs[id].img : null; }

  function buildSlots(T, C, F) {
    var f = form, S = [];
    var role = function (k, d) { return C[(T.roles && T.roles[k]) || d]; };
    function add(o) { o.kind = o.kind || "text"; o.col = o.col || "A"; S.push(o); }

    if (T.banner) {
      add({ key: "banner", text: T.banner, font: F.display, color: C.text, sizeF: 0.17, upper: true, lineH: 0.98, gapF: 0 });
    }
    var fmt = formatsLine(f);
    add({ key: "kicker", text: fmt || L("liveComedy"), font: F.accent, color: role("kicker", "accent"), sizeF: 0.03, upper: true, gapF: 0.01 });

    var title = (f.title || "").trim();
    add({ key: "title", field: "title", text: title || "YOUR SHOW NAME", ph: !title, font: F.display,
      color: role("title", "text"), sizeF: T.titleSize, upper: T.upperTitle, lineH: 1.05, gapF: 0.022 });

    var tag = (f.tagline || "").trim();
    if (tag) add({ key: "tagline", field: "tagline", text: tag, font: F.body, color: C.muted, sizeF: 0.032, gapF: 0.014 });

    var metaParts = [];
    if (f.lang === "fr") metaParts.push(LBL.langFr.fr);
    else if (f.lang === "bi") metaParts.push(LBL.langBi.en);
    else metaParts.push(LBL.langEn.en);
    var at = ageText(f);
    if (at) metaParts.push(at);
    add({ key: "meta", text: metaParts.join("  ·  "), font: F.body, color: C.muted, sizeF: 0.025, gapF: 0.012 });

    if (f.ribbons && f.ribbons.length) add({ key: "ribbons", kind: "ribbons", gapF: 0.026 });

    var hasLineup = f.lineup.some(function (c) { return (c.name || "").trim(); });
    if (hasLineup) {
      if (T.rules) add({ key: "rule1", kind: "rule", col: "B", gapF: 0.03 });
      add({ key: "lineup", kind: "lineup", gapF: 0.034, col: "B" });
    }

    var dt = dateText(f);
    var dtext = dt || "DATE TO ADD";
    if (T.star) dtext = "★ " + dtext + " ★";
    if (T.rules) add({ key: "rule2", kind: "rule", col: "A", gapF: 0.03 });
    add({ key: "date", text: dtext, ph: !dt, font: T.dateRole === "accent" ? F.accent : T.dateRole === "display" ? F.display : F.body,
      color: role("date", "accent2"), sizeF: T.dateSize, upper: T.dateUpper && !!dt, gapF: 0.038 });

    var tl = timeLine(f);
    if (tl) add({ key: "times", text: tl, font: F.body, color: C.text, sizeF: 0.03, gapF: 0.01 });

    if (T.rules) add({ key: "rule3", kind: "rule", col: "B", gapF: 0.03 });
    var venue = (f.venue || "").trim();
    add({ key: "venue", field: "venue", text: venue || "Venue name", ph: !venue,
      font: T.venueRole === "accent" ? F.accent : F.body, color: role("venue", "text"), sizeF: 0.036,
      upper: T.venueUpper && !!venue, gapF: 0.03, col: "B" });
    var addr = [(f.address || "").trim(), (f.city || "").trim()].filter(Boolean).join(", ");
    add({ key: "address", text: addr || "Street address, City", ph: !addr, font: F.body, color: C.muted, sizeF: 0.025, gapF: 0.008, col: "B" });
    if ((f.transit || "").trim()) add({ key: "transit", text: L("transit") + ": " + f.transit.trim(), font: F.body, color: C.muted, sizeF: 0.022, gapF: 0.006, col: "B" });
    if ((f.entrance || "").trim()) add({ key: "entrance", text: L("entrance") + ": " + f.entrance.trim(), font: F.body, color: C.muted, sizeF: 0.022, gapF: 0.006, col: "B" });

    var pt = priceText(f);
    if (pt) add({ key: "price", text: pt, font: F.accent, color: role("price", "accent2"), sizeF: 0.036, upper: true, gapF: 0.03 });
    var promo = (f.promo || "").trim();
    if (promo) add({ key: "promo", field: "promo", text: promo, font: F.body, color: C.accent, sizeF: 0.026, gapF: 0.008 });

    var tick = shortUrl(f.ticketUrl);
    add({ key: "tickets", text: tick ? L("tickets") + ": " + tick : "Ticket link to add", ph: !tick, font: F.accent,
      color: role("tickets", "accent"), sizeF: 0.03, gapF: 0.026 });

    var links = [shortUrl(f.website), handle(f.instagram, "@"), handle(f.hashtag, "#")].filter(Boolean).join("  ·  ");
    if (links) add({ key: "links", text: links, font: F.body, color: C.text, sizeF: 0.024, gapF: 0.02, col: "B" });
    var pres = (f.presented || "").trim();
    if (pres) {
      var has = /^(presented by|présenté par|presente par)/i.test(pres);
      add({ key: "presented", text: has ? pres : L("presented") + " " + pres, font: F.body, color: C.muted, sizeF: 0.022, gapF: 0.018, col: "B" });
    }
    var spons = (f.sponsor || "").trim();
    if (spons) add({ key: "sponsor", field: "sponsor", text: spons, font: F.body, color: C.muted, sizeF: 0.022, gapF: 0.006, col: "B" });
    var note = (f.note || "").trim();
    if (note) add({ key: "note", field: "note", text: note, font: F.body, color: C.text, sizeF: 0.026, gapF: 0.02, col: "B" });
    return S;
  }

  // text + geometry for one slot at scale s inside a column of width colW
  function measureText(n, s, colW, W, T) {
    var o = state.ov[n.key] || {};
    var align = o.align || T.align;
    var b = makeBlock({
      id: n.key, text: o.text != null ? o.text : n.text, font: o.font || n.font,
      sizeF: o.sizeF != null ? o.sizeF : n.sizeF * s, color: o.color || n.color,
      align: align, maxwF: colW / W, upper: n.upper, lineH: n.lineH
    });
    b.key = n.key; b.field = o.text != null ? null : n.field; b.ph = o.text != null ? false : !!n.ph;
    b._src = getOv(n.key);
    var lines = wrapLines(b, W);
    var px = b.sizeF * W;
    n.block = b;
    n.h = (lines.length - 1) * px * b.lineH + px * 1.05;
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fitPx(text, fontKey, px, maxw) {
    ctx.font = fontCss(fontKey, px);
    var w = ctx.measureText(text).width;
    return w > maxw && w > 0 ? px * (maxw / w) : px;
  }

  // ---- lineup geometry: returns { h, draw(x, y, w) }
  function lineupGeom(colW, s, W, T, C, F) {
    var cs = form.lineup.filter(function (c) { return (c.name || "").trim(); });
    var heads = form.showHeads && cs.some(function (c) { return c.photoId && imgs[c.photoId]; });
    var align = T.align;
    var k, gap;
    if (!heads) {
      var namePx = 0.036 * W * s, subPx = 0.02 * W * s;
      gap = namePx * 0.4;
      var rows = cs.map(function (c) {
        var sub = [roleText(c)].filter(Boolean);
        var h = handle(c.handle, "@");
        if (form.showHandles && h) sub.push(h);
        return { name: c.name.trim(), sub: sub.join("  ·  "), special: c.special };
      });
      var total = 0;
      rows.forEach(function (r, i) { r.h = namePx * 1.15 + (r.sub ? subPx * 1.35 : 0); total += r.h + (i ? gap : 0); });
      return {
        h: total, w: colW,
        draw: function (x, y) {
          var cy = y, ax = align === "left" ? x : align === "right" ? x + colW : x + colW / 2;
          ctx.textAlign = align; ctx.textBaseline = "alphabetic";
          rows.forEach(function (r) {
            var np = fitPx(r.name.toUpperCase(), F.accent, namePx, colW);
            ctx.font = fontCss(F.accent, np);
            ctx.fillStyle = C.text;
            ctx.fillText((r.special ? "★ " : "") + r.name.toUpperCase(), ax, cy + namePx * 0.88);
            if (r.sub) {
              var sp = fitPx(r.sub, "inter", subPx, colW);
              ctx.font = fontCss("inter", sp);
              ctx.fillStyle = C.accent;
              ctx.fillText(r.sub, ax, cy + namePx * 1.15 + subPx * 1.0);
            }
            cy += r.h + gap;
          });
        }
      };
    }
    // headshot grid
    var n = cs.length;
    var cols = n <= 4 ? n : (n <= 6 ? 3 : 4);
    var cellW = colW / cols;
    var d = Math.min(cellW * 0.66, 0.17 * W) * Math.max(0.45, s);
    var namePx2 = Math.min(0.028 * W * s, cellW * 0.17), subPx2 = namePx2 * 0.74;
    gap = 0.022 * W * s;
    var nRows = Math.ceil(n / cols);
    var cellH = d + namePx2 * 0.5 + namePx2 * 1.2 + subPx2 * 1.3 * 2;
    var cells = cs.map(function (c) {
      var h = handle(c.handle, "@");
      return { c: c, role: roleText(c), handle: form.showHandles ? h : "" };
    });
    return {
      h: nRows * cellH + (nRows - 1) * gap, w: colW,
      draw: function (x, y) {
        for (var i = 0; i < cells.length; i++) {
          var row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols), col = i % cols;
          var rowW = inRow * cellW, startX = x + (colW - rowW) / 2;
          var cx = startX + col * cellW + cellW / 2, top = y + row * (cellH + gap);
          var cell = cells[i], r = d / 2, cy = top + r;
          var photo = cell.c.photoId ? imgOf(cell.c.photoId) : null;
          ctx.save();
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
          if (photo) {
            ctx.clip();
            var iw = photo.naturalWidth || 1, ih = photo.naturalHeight || 1;
            var sc = Math.max(d / iw, d / ih);
            ctx.drawImage(photo, cx - iw * sc / 2, cy - ih * sc / 2, iw * sc, ih * sc);
          } else {
            ctx.fillStyle = mixHex(C.accent, state.bg.c1, 0.65);
            ctx.fill();
            ctx.fillStyle = C.text;
            ctx.font = fontCss(F.accent, d * 0.36);
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(initials(cell.c.name), cx, cy + d * 0.02);
          }
          ctx.restore();
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(2, d * 0.04); ctx.strokeStyle = C.accent; ctx.stroke();
          ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
          var nm = (cell.c.special ? "★ " : "") + cell.c.name.trim().toUpperCase();
          var np = fitPx(nm, F.accent, namePx2, cellW * 0.94);
          ctx.font = fontCss(F.accent, np); ctx.fillStyle = C.text;
          var ty = top + d + namePx2 * 0.5 + namePx2 * 0.9;
          ctx.fillText(nm, cx, ty);
          var yy = ty;
          [cell.role, cell.handle].forEach(function (t) {
            if (!t) return;
            yy += subPx2 * 1.3;
            ctx.font = fontCss("inter", fitPx(t, "inter", subPx2, cellW * 0.94));
            ctx.fillStyle = C.accent;
            ctx.fillText(t, cx, yy);
          });
        }
      }
    };
  }

  // ---- ribbons geometry
  function ribbonsGeom(colW, s, W, T, C) {
    var px = 0.022 * W * s, padX = px * 0.8, padY = px * 0.42, gapR = px * 0.5;
    var list = [];
    form.ribbons.forEach(function (k) {
      var t = ribbonText(k);
      if (!t) return;
      var p = fitPx(t.toUpperCase(), "oswald", px, colW - padX * 2);
      ctx.font = fontCss("oswald", p);
      list.push({ t: t.toUpperCase(), px: p, w: ctx.measureText(t.toUpperCase()).width + padX * 2, key: k });
    });
    var lines = [], cur = [], curW = 0;
    list.forEach(function (r) {
      if (cur.length && curW + gapR + r.w > colW) { lines.push({ items: cur, w: curW }); cur = []; curW = 0; }
      curW += (cur.length ? gapR : 0) + r.w; cur.push(r);
    });
    if (cur.length) lines.push({ items: cur, w: curW });
    var lineH = px + padY * 2;
    return {
      h: lines.length ? lines.length * lineH + (lines.length - 1) * gapR : 0, w: colW,
      draw: function (x, y) {
        var align = T.align;
        lines.forEach(function (ln, i) {
          var sx = align === "left" ? x : align === "right" ? x + colW - ln.w : x + (colW - ln.w) / 2;
          ln.items.forEach(function (r) {
            var bg = r.key === "sold" ? "#c41e3a" : C.accent;
            var fg = r.key === "sold" ? "#ffffff" : (luminance(bg) > 0.55 ? "#171512" : "#ffffff");
            roundRectPath(sx, y + i * (lineH + gapR), r.w, lineH, lineH / 2);
            ctx.fillStyle = bg; ctx.fill();
            ctx.font = fontCss("oswald", r.px); ctx.fillStyle = fg;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(r.t, sx + r.w / 2, y + i * (lineH + gapR) + lineH / 2 + px * 0.04);
            sx += r.w + gapR;
          });
        });
      }
    };
  }

  // ---- corner items (logo, QR)
  function logoBox(minWH) {
    var img = imgOf(form.logoId);
    if (!img) return null;
    var box = form.logoSize / 100 * minWH;
    var iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
    var sc = Math.min(box / iw, box / ih);
    return { img: img, w: iw * sc, h: ih * sc };
  }

  function qrGeom(minWH, W, C) {
    var q = getQR();
    if (!q) return null;
    var target = 0.2 * minWH, quiet = 4;
    var mod = Math.max(2, Math.floor(target / (q.size + quiet * 2)));
    var side = mod * (q.size + quiet * 2);
    var labelPx = Math.max(10, side * 0.075);
    var label = L("scan");
    ctx.font = fontCss("inter", labelPx);
    var lw = ctx.measureText(label).width;
    var labelPx2 = lw > side * 0.94 ? labelPx * side * 0.94 / lw : labelPx;
    return { q: q, mod: mod, side: side, labelPx: labelPx2, label: label, w: side, h: side + labelPx2 * 1.9 };
  }

  function layout() {
    var sz = SIZES[state.sizeKey], W = sz.w, H = sz.h, minWH = Math.min(W, H);
    var T = TEMPLATES[state.templateKey], C = themeColors(T), F = themeFonts(T);
    var wide = W / H >= 1.3;
    var mX = (wide ? 0.05 : (T.mX || 0.07)) * W;
    var gapX = 0.05 * W;
    var colWd = wide ? (W - 2 * mX - gapX) / 2 : W - 2 * mX;
    var cols = { A: { x0: mX, w: colWd }, B: wide ? { x0: mX + colWd + gapX, w: colWd } : { x0: mX, w: colWd } };
    var m = 0.035 * minWH;
    var creditBand = state.credit ? 0.045 * W : 0;
    var topBase = 0.06 * H, botBase = 0.05 * H + creditBand;

    // corner items first (they reserve space)
    var corner = [];
    var lg = logoBox(minWH);
    if (lg) corner.push({ id: "logo", kind: "logo", pos: form.logoPos, w: lg.w, h: lg.h, img: lg.img });
    var qg = qrGeom(minWH, W, C);
    if (qg) corner.push({ id: "qr", kind: "qr", pos: form.qrCorner, w: qg.w, h: qg.h, geom: qg });
    var res = { A: { top: topBase, bot: botBase }, B: { top: topBase, bot: botBase } };
    corner.forEach(function (ci) {
      var isTop = ci.pos.charAt(0) === "t", isRight = ci.pos.charAt(1) === "r";
      var colKey = wide ? (isRight ? "B" : "A") : "A";
      var keys = wide ? [colKey] : ["A"];
      keys.forEach(function (k) {
        if (isTop) res[k].top = Math.max(res[k].top, m + ci.h + 0.02 * H);
        else res[k].bot = Math.max(res[k].bot, creditBand * 0.9 + m + ci.h + 0.02 * H);
      });
      var x = isRight ? W - m - ci.w : m;
      var y = isTop ? m : H - creditBand * 0.9 - m - ci.h;
      ci.x = x; ci.y = y;
    });

    // slots -> per-column flow
    var slots = buildSlots(T, C, F).filter(function (n) { return !(state.ov[n.key] && state.ov[n.key].hidden); });
    var blocks = [], items = [];
    ["A", "B"].forEach(function (ck) {
      if (ck === "B" && !wide) return;
      var nodes = slots.filter(function (n) { return wide ? n.col === ck : true; });
      if (!nodes.length) return;
      var col = cols[ck], rs = res[ck];
      var avail = Math.max(40, H - rs.top - rs.bot);
      var s = 1, total = 0, gaps = [];
      for (var it = 0; it < 5; it++) {
        total = 0; gaps = [];
        nodes.forEach(function (n, i) {
          if (n.kind === "text") measureText(n, s, col.w, W, T);
          else if (n.kind === "lineup") { n.geom = lineupGeom(col.w, s, W, T, C, F); n.h = n.geom.h; }
          else if (n.kind === "ribbons") { n.geom = ribbonsGeom(col.w, s, W, T, C); n.h = n.geom.h; }
          else if (n.kind === "rule") { n.h = Math.max(2, W * 0.003); }
          var g = i === 0 || n.h <= 0 ? 0 : n.gapF * W * s;
          gaps.push(g);
          total += n.h + g;
        });
        if (total <= avail || s <= 0.4 || it === 4) break;
        s = Math.max(0.4, s * avail / total * 0.985);
      }
      var sumGap = gaps.reduce(function (a, b) { return a + b; }, 0);
      var extra = avail - total;
      if (extra > 0 && sumGap > 0) {
        var boost = Math.min(extra / sumGap, 1.7);
        gaps = gaps.map(function (g) { return g * (1 + boost); });
        extra -= boost * sumGap;
      }
      var y = rs.top + (extra > 0 ? extra * (T.vAlign === "bottom" ? 1 : T.vAlign === "top" ? 0 : 0.5) : 0);
      nodes.forEach(function (n, i) {
        y += gaps[i];
        n.y = y;
        y += n.h;
        var o = state.ov[n.key] || {};
        if (n.kind === "text") {
          var b = n.block, al = b.align;
          b.x = (al === "left" ? col.x0 : al === "right" ? col.x0 + col.w : col.x0 + col.w / 2) / W;
          b.y = n.y / H;
          if (o.x != null) b.x = o.x;
          if (o.y != null) b.y = o.y;
          blocks.push(b);
        } else {
          var it2 = { id: n.key, kind: n.kind, x: col.x0, y: n.y, w: col.w, h: n.h, geom: n.geom, noselect: n.kind === "rule" };
          if (o.x != null) it2.x = o.x * W;
          if (o.y != null) it2.y = o.y * H;
          items.push(it2);
        }
      });
    });

    corner.forEach(function (ci) {
      var o = state.ov[ci.id] || {};
      if (o.x != null) ci.x = o.x * W;
      if (o.y != null) ci.y = o.y * H;
      items.push(ci);
    });

    // text the user added with "Add text" (free-floating)
    state.custom.forEach(function (c) {
      var b = makeBlock({ id: c.id, text: c.text, font: c.font, sizeF: c.sizeF, color: c.color, align: c.align, x: c.x, y: c.y, maxwF: c.maxwF });
      b.key = c.id; b.custom = true; b._src = c;
      blocks.push(b);
    });

    state.blocks = blocks;
    state.items = items;
    items.forEach(function (it3) {
      it3._bbox = { x: it3.x, y: it3.y, w: it3.w, h: it3.h };
    });
    if (state.selected && state.selected !== "sticker") {
      var still = blocks.some(function (b) { return b.id === state.selected; }) ||
                  items.some(function (i2) { return i2.id === state.selected && !i2.noselect; });
      if (!still) state.selected = null;
    }
    state.layoutInfo = { wide: wide };
  }

  // ------------------------------------------------------------ rendering
  function drawBackground(W, H) {
    var bg = state.bg;
    if (bg.mode === "photo" && bg.img) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      // cover-fit
      var iw = bg.img.naturalWidth, ih = bg.img.naturalHeight;
      var s = Math.max(W / iw, H / ih);
      var dw = iw * s, dh = ih * s;
      ctx.drawImage(bg.img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      if (bg.darken > 0) {
        ctx.fillStyle = "rgba(0,0,0," + bg.darken + ")";
        ctx.fillRect(0, 0, W, H);
      }
    } else if (bg.mode === "gradient" || bg.mode === "photo") {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg.c1);
      g.addColorStop(1, bg.c2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = bg.c1;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBlock(block, W, H, withSelection) {
    var lines = wrapLines(block, W);
    ctx.font = fontString(block, W);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = block.color;
    var px = block.sizeF * W;
    // Shrink-to-fit: an unbreakable "word" (a ticket URL) can be wider
    // than the wrap width — scale the drawn font down so it never bleeds
    // off the poster. block.sizeF itself is untouched.
    var widest = 0;
    lines.forEach(function (line) {
      var w = ctx.measureText(line).width;
      if (w > widest) widest = w;
    });
    var maxw = block.maxwF * W;
    if (widest > maxw && widest > 0) {
      px = px * (maxw / widest);
      var f = FONTS[block.font] || FONTS.inter;
      ctx.font = f.weight + " " + Math.max(8, Math.round(px)) + "px " + f.family + ", sans-serif";
    }
    var lh = px * block.lineH;
    var anchorX = block.x * W;
    var topY = block.y * H;
    ctx.textAlign = block.align;
    var maxLineW = 0;
    ctx.save();
    if (block.ph) ctx.globalAlpha = 0.6; // placeholder text for a missing field
    lines.forEach(function (line, i) {
      var w = ctx.measureText(line).width;
      if (w > maxLineW) maxLineW = w;
      ctx.fillText(line, anchorX, topY + px * 0.82 + i * lh);
    });
    ctx.restore();
    var left = block.align === "left" ? anchorX
             : block.align === "right" ? anchorX - maxLineW
             : anchorX - maxLineW / 2;
    var h = (lines.length - 1) * lh + px * 1.05;
    block._bbox = { x: left, y: topY, w: maxLineW, h: h };
    if (withSelection && state.selected === block.id) {
      ctx.save();
      ctx.strokeStyle = "#c9a84c";
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.setLineDash([10, 7]);
      var pad = px * 0.15;
      ctx.strokeRect(left - pad, topY - pad, maxLineW + pad * 2, h + pad * 2);
      ctx.restore();
    }
  }

  function drawItem(it, W, H, withSelection, C) {
    ctx.save();
    if (it.kind === "lineup" || it.kind === "ribbons") {
      if (it.geom && it.h > 0) it.geom.draw(it.x, it.y);
    } else if (it.kind === "rule") {
      ctx.fillStyle = C.accent;
      var rw = it.w * 0.28;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(it.x + (it.w - rw) / 2, it.y, rw, it.h);
    } else if (it.kind === "logo") {
      ctx.drawImage(it.img, it.x, it.y, it.w, it.h);
    } else if (it.kind === "qr") {
      var g = it.geom, q = g.q, quiet = 4;
      roundRectPath(it.x, it.y, it.w, it.h, g.side * 0.04);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.fillStyle = "#000000";
      for (var yy = 0; yy < q.size; yy++) {
        for (var xx = 0; xx < q.size; xx++) {
          if (q.get(xx, yy)) ctx.fillRect(it.x + (xx + quiet) * g.mod, it.y + (yy + quiet) * g.mod, g.mod, g.mod);
        }
      }
      ctx.font = fontCss("inter", g.labelPx);
      ctx.fillStyle = "#000000"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText(g.label, it.x + it.w / 2, it.y + g.side + g.labelPx * 1.0);
    }
    ctx.restore();
    if (withSelection && state.selected === it.id && !it.noselect) {
      ctx.save();
      ctx.strokeStyle = "#c9a84c";
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.setLineDash([10, 7]);
      ctx.strokeRect(it.x - 6, it.y - 6, it.w + 12, it.h + 12);
      ctx.restore();
    }
  }

  function drawSticker(W, H, withSelection) {
    if (!state.sticker.on || !stickerImg) return;
    var s = state.sticker;
    var w = s.scaleF * W;
    var h = w * (stickerImg.naturalHeight / stickerImg.naturalWidth);
    var x = s.x * W - w / 2, y = s.y * H - h / 2;
    ctx.drawImage(stickerImg, x, y, w, h);
    s._bbox = { x: x, y: y, w: w, h: h };
    if (withSelection && state.selected === "sticker") {
      ctx.save();
      ctx.strokeStyle = "#c9a84c";
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.setLineDash([10, 7]);
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
      ctx.restore();
    }
  }

  function creditText() { return state.show ? L("listed") : L("madeWith"); }

  function drawCredit(W, H) {
    if (!state.credit) return;
    var px = Math.round(W * 0.018);
    ctx.font = "700 " + px + "px PosterInter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = bgIsLight() ? "rgba(23,21,18,.6)" : "rgba(255,255,255,.6)";
    ctx.fillText(creditText(), W - px * 1.2, H - px * 1.2);
  }

  function render(withSelection) {
    if (withSelection === undefined) withSelection = true;
    var sz = SIZES[state.sizeKey];
    var W = sz.w, H = sz.h;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    var T = TEMPLATES[state.templateKey], C = themeColors(T);
    ctx.clearRect(0, 0, W, H);
    drawBackground(W, H);
    state.items.forEach(function (it) { if (it.kind === "rule" || it.kind === "lineup" || it.kind === "ribbons") drawItem(it, W, H, withSelection, C); });
    state.blocks.forEach(function (b) { drawBlock(b, W, H, withSelection); });
    state.items.forEach(function (it) { if (it.kind === "qr" || it.kind === "logo") drawItem(it, W, H, withSelection, C); });
    drawSticker(W, H, withSelection);
    drawCredit(W, H);
  }

  function fitCanvas() {
    var wrap = $("canvas-wrap");
    var availW = wrap.clientWidth - 24;
    if (availW <= 0) return;
    var W = canvas.width, H = canvas.height;
    var maxH = window.innerWidth >= 900 ? Math.max(300, window.innerHeight - 190) : Infinity;
    var sc = Math.min(availW / W, maxH / H);
    canvas.style.width = Math.floor(W * sc) + "px";
    canvas.style.height = Math.floor(H * sc) + "px";
  }

  // layout + draw + canvas fit. Call this after ANY change to form or state.
  function refresh() {
    layout();
    render();
    fitCanvas();
    var parts = [];
    state.blocks.forEach(function (b) { if (!b.ph) parts.push(b.text); });
    canvas.setAttribute("aria-label", "Poster preview. " + parts.slice(0, 8).join(". ") + ". Tap text to select it, tap again to edit, drag to move.");
  }

  // ------------------------------------------------------------ templates
  function applyTemplateBg(key) {
    var t = TEMPLATES[key];
    var keepImg = state.bg.img;         // never throw away an uploaded photo
    var keepDarken = state.bg.darken;
    var p = form.palette;
    state.bg.mode = t.bg.mode;
    state.bg.c1 = p ? p.bg1 : t.bg.c1;
    state.bg.c2 = p ? p.bg2 : t.bg.c2;
    if (p && state.bg.mode === "solid") state.bg.mode = "gradient";
    if (keepImg) { state.bg.img = keepImg; state.bg.mode = "photo"; state.bg.darken = keepDarken; }
  }

  function applyTemplate(key) {
    state.templateKey = key;
    state.ov = {};                       // a new template starts from its own layout
    applyTemplateBg(key);
    state.selected = null;
    syncToolbar();
    syncControls();
    refresh();
  }

  // ------------------------------------------------------- show data load
  function fmtDateLine(iso) {
    // Use the event's own wall-clock time (strip the offset) so the poster
    // always shows venue-local time no matter where it's being made.
    // Accept BOTH separators. The static export (data/comedy-atlas/
    // upcoming_events.json) writes ISO-8601 "T", but the live API
    // (/v1/events, which is what this picker actually fetches) serializes
    // datetimes with a SPACE: "2026-07-27 19:30:00+02:00". This regex required
    // "T", so on the live site fmtDateLine returned null for EVERY show and the
    // poster's date line was silently blank -- both in the prefilled state and
    // in each search row's meta line. Caught by test_poster_maker's
    // "date must be prefilled" assertion, which was being written off as a
    // fixture/date-prefill quirk; it was reporting a real user-facing bug.
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso || "");
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var day = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return day + " · " + m[4] + ":" + m[5];
  }

  function showFromEvent(ev) {
    var slug = ev.show_series_slug || ev.slug;
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(ev.starts_at || "");
    return {
      title: ev.show_series_name || ev.title || "Comedy Night",
      seriesName: ev.show_series_name,
      slug: slug,
      dateLine: fmtDateLine(ev.starts_at),
      venueLine: ev.venue_name || "",
      addrLine: [ev.venue_address, ev.city_name].filter(Boolean).join(", "),
      // Real show page path (scripts/generate_entity_pages.py's show_href):
      // /comedy-atlas/show/<slug>/ -- comedyatlas.app is the canonical short
      // form shown on a printed poster; the full canonical URL still works,
      // this is just the human-typeable line.
      ticketsLine: slug ? "tickets: comedyatlas.app/comedy-atlas/show/" + slug + "/" : "tickets: comedyatlas.app",
      // raw fields for the form
      date: m ? m[1] : "",
      time: m ? m[2] : "",
      venueName: ev.venue_name || "",
      street: ev.venue_address || "",
      city: ev.city_name || ""
    };
  }

  function prefillForm(show) {
    form = defaultForm();
    if (!show) return;
    form.title = show.title || "";
    form.date = show.date || "";
    if (show.time) { form.start = show.time; form.doors = ""; } // only the start time is known
    form.venue = show.venueName || "";
    form.address = show.street || "";
    form.city = show.city || "";
    form.ticketUrl = show.slug ? "https://comedyatlas.app/comedy-atlas/show/" + show.slug + "/" : "";
  }

  function loadEvents() {
    // /v1/events is a public, unauthenticated, CORS-open-for-GET route
    // (Access-Control-Allow-Origin: *) -- no credentials, which is also
    // required here: a wildcard ACAO is incompatible with credentialed
    // fetches. Same AtlasAuth.apiBase origin-resolution as the portal
    // pages, so this works whether poster.html is loaded from the apex
    // (static) or api.comedyatlas.app (dynamic) origin.
    var base = (window.AtlasAuth && window.AtlasAuth.apiBase) || "";
    return fetch(base + EVENTS_ENDPOINT, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var rows = data.events || [];
        var now = new Date();
        // one entry per series: the NEXT upcoming instance
        var bySeries = {};
        rows.forEach(function (ev) {
          if (ev.status === "cancelled" || !ev.starts_at) return;
          var start = new Date(ev.starts_at);
          // Boundary must match public_upcoming_events' own definition
          // (migration 0141_ongoing_runs_stay_upcoming, 2026-08-12): a
          // multi-day run (Edinburgh-Fringe-style residency, one row
          // spanning the whole run) stays upcoming until it ENDS, not
          // until it starts -- COALESCE(ends_at, starts_at) >= now() on
          // the server. Re-deriving "upcoming" here with starts_at alone
          // reintroduces exactly the bug 0141 fixed server-side: the API
          // now legitimately returns ongoing runs whose starts_at is in
          // the past, sorted starts_at ASC, so they sort FIRST and this
          // filter threw every one of them back out -- during festival
          // season that can empty the whole limit=200 page before a
          // single truly-future show is reached ("Couldn't load the show
          // list" / blank picker for every visitor, not a fixture issue).
          var boundary = ev.ends_at ? new Date(ev.ends_at) : start;
          if (isNaN(start) || isNaN(boundary) || boundary < now) return;
          var key = ev.show_series_id || ("ev-" + ev.id);
          if (!bySeries[key] || new Date(bySeries[key].starts_at) > start) bySeries[key] = ev;
        });
        allEvents = Object.keys(bySeries).map(function (k) { return bySeries[k]; });
        allEvents.sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
        return allEvents;
      });
  }

  function renderResults(query) {
    var box = $("show-results");
    var note = $("picker-note");
    if (!allEvents) { box.innerHTML = ""; return; }
    var q = (query || "").trim().toLowerCase();
    var matches = allEvents.filter(function (ev) {
      if (!q) return true;
      return [ev.title, ev.show_series_name, ev.venue_name, ev.city_name, ev.organization_name]
        .join(" ").toLowerCase().indexOf(q) !== -1;
    }).slice(0, 30);
    box.innerHTML = "";
    matches.forEach(function (ev) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "show-row";
      btn.setAttribute("role", "listitem");
      var title = document.createElement("div");
      title.className = "sr-title";
      title.textContent = ev.show_series_name || ev.title;
      var meta = document.createElement("div");
      meta.className = "sr-meta";
      meta.textContent = [fmtDateLine(ev.starts_at), ev.venue_name, ev.city_name]
        .filter(Boolean).join(" · ");
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener("click", function () { startFromEvent(ev); });
      box.appendChild(btn);
    });
    note.textContent = matches.length
      ? matches.length + " show" + (matches.length === 1 ? "" : "s") + (q ? " matching “" + query + "”" : " coming up — pick yours")
      : "No upcoming show matches that — try fewer words, or start from a blank canvas.";
  }

  function startFromEvent(ev) {
    state.show = showFromEvent(ev);
    openEditor(false);
  }

  function resetStateForNewPoster() {
    state.ov = {};
    state.custom = [];
    state.selected = null;
    state.bg.img = null;
    state.bg.darken = 0.4;
    state.sticker.on = false;
    state.credit = true;
    captionEdited = false;
    histReset();
  }

  function openEditor(fromDraft) {
    $("picker").style.display = "none";
    $("editor").style.display = "block";
    if (!fromDraft) {
      resetStateForNewPoster();
      prefillForm(state.show);
      applyTemplateBg(state.templateKey);
    }
    syncToolbar();
    syncControls();
    refresh();
    updateChecklist();
    updateCaption(true);
    histCommit(true);
    initSections();
    watchCanvas();
  }

  // ------------------------------------------------------------ toolbar UI
  function selectedBlock() {
    if (state.selected === null || state.selected === "sticker") return null;
    for (var i = 0; i < state.blocks.length; i++) {
      if (state.blocks[i].id === state.selected) return state.blocks[i];
    }
    return null;
  }
  function selectedItem() {
    if (state.selected === null || state.selected === "sticker") return null;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === state.selected && !state.items[i].noselect) return state.items[i];
    }
    return null;
  }

  function setActivePill(rowId, attr, value) {
    var row = $(rowId);
    Array.prototype.forEach.call(row.querySelectorAll(".pill"), function (p) {
      p.classList.toggle("active", p.getAttribute(attr) === String(value));
    });
  }
  function setPressed(rowId, attr, values) {
    var row = $(rowId);
    Array.prototype.forEach.call(row.querySelectorAll("button[" + attr + "]"), function (p) {
      p.setAttribute("aria-pressed", values.indexOf(p.getAttribute(attr)) !== -1 ? "true" : "false");
    });
  }

  function syncToolbar() {
    var b = selectedBlock();
    var it = selectedItem();
    $("sel-tools").classList.toggle("on", !!b);
    $("no-sel-card").style.display = b ? "none" : "block";
    $("no-sel-note").textContent = it
      ? "This part is built from the form. Drag it to move it. Tap it again to jump to its form fields."
      : "Tap any text on the poster to change its font, size, color or alignment — or add a new line in Extras. The form below fills the poster in for you.";
    setActivePill("size-row", "data-size", state.sizeKey);
    setActivePill("template-row", "data-template", state.templateKey);
    setActivePill("bg-row", "data-bg", state.bg.mode);
    if (b) {
      setActivePill("font-row", "data-font", b.font);
      setActivePill("align-row", "data-align", b.align);
      $("size-value").textContent = Math.round(b.sizeF * SIZES[state.sizeKey].w) + "px";
      Array.prototype.forEach.call(document.querySelectorAll("#swatch-row .swatch[data-color]"), function (s) {
        s.classList.toggle("active", s.getAttribute("data-color").toLowerCase() === b.color.toLowerCase());
      });
    }
    $("toggle-sticker").classList.toggle("active", state.sticker.on);
  }

  function status(msg, cls) {
    var el = $("status-msg");
    el.textContent = msg || "";
    el.className = cls || "";
  }

  // ------------------------------------------------------- form <-> controls
  // [form key, element id, kind]
  var BIND = [
    ["title", "f-title", "text"], ["tagline", "f-tagline", "text"], ["formatOther", "f-format-other", "text"],
    ["lang", "f-lang", "text"], ["age", "f-age", "text"], ["priceKind", "f-price-kind", "text"],
    ["priceAmt", "f-price-amt", "text"], ["promo", "f-promo", "text"],
    ["date", "f-date", "text"], ["weekly", "f-weekly", "check"], ["doors", "f-doors", "text"],
    ["start", "f-start", "text"], ["end", "f-end", "text"],
    ["venue", "f-venue", "text"], ["address", "f-address", "text"], ["city", "f-city", "text"],
    ["transit", "f-transit", "text"], ["mapUrl", "f-map", "text"], ["entrance", "f-entrance", "text"],
    ["showHeads", "f-show-heads", "check"], ["showHandles", "f-show-handles", "check"],
    ["ticketUrl", "f-ticket", "text"], ["qr", "f-qr", "check"], ["qrCorner", "f-qr-corner", "text"],
    ["website", "f-website", "text"], ["instagram", "f-instagram", "text"], ["hashtag", "f-hashtag", "text"],
    ["presented", "f-presented", "text"], ["sponsor", "f-sponsor", "text"],
    ["logoPos", "f-logo-pos", "text"], ["logoSize", "f-logo-size", "num"], ["note", "f-note", "text"]
  ];
  var BIND_BY_ID = {};
  BIND.forEach(function (b) { BIND_BY_ID[b[1]] = b; });

  function syncControls() {
    BIND.forEach(function (b) {
      var el = $(b[1]);
      if (!el) return;
      var v = form[b[0]];
      if (b[2] === "check") el.checked = !!v;
      else if (el !== document.activeElement || el.value !== String(v)) el.value = v == null ? "" : v;
    });
    $("f-credit").checked = state.credit;
    $("f-credit-label").textContent = "Add a small credit (“" + creditText() + "”)";
    setPressed("f-formats", "data-format", form.formats);
    $("f-format-other-wrap").hidden = form.formats.indexOf("other") === -1;
    $("f-price-amt-wrap").hidden = !(form.priceKind === "amount" || form.priceKind === "from");
    setPressed("f-timefmt", "data-timefmt", [form.timeFmt]);
    setPressed("f-ribbons", "data-ribbon", form.ribbons);
    var rd = $("ribbon-doors");
    rd.textContent = form.doors ? "Doors open at " + fmtTime(form.doors, form.timeFmt) : "Doors open at …";
    $("logo-remove").hidden = !form.logoId;
    var T = TEMPLATES[state.templateKey], C = themeColors(T);
    $("f-c-bg1").value = state.bg.c1;
    $("f-c-bg2").value = state.bg.c2;
    $("f-c-text").value = C.text;
    $("f-c-accent").value = C.accent;
    $("bg-custom-color").value = state.bg.c1;
    $("darken-range").value = Math.round(state.bg.darken * 100);
    var palKeys = [];
    if (!form.palette) palKeys = ["none"]; else palKeys = [form.palette.key || "custom"];
    setPressed("palette-row", "data-palette", palKeys);
    setPressed("pair-row", "data-pair", [form.pair]);
    var help = $("f-ticket-help");
    var tu = (form.ticketUrl || "").trim();
    if (tu && !normUrl(tu)) help.textContent = "That does not look like a web link. Start it with https://";
    else if (form.qr && tu && !getQR()) help.textContent = "This link is too long for a QR code. Use a shorter link.";
    else help.textContent = "Short links look best on a poster.";
    renderLineupUI(true);
  }

  function afterFormChange() {
    refresh();
    updateChecklist();
    updateCaption(false);
    syncControlsLight();
    scheduleCommit();
  }

  // cheap sync used while typing (does not touch the field being typed in)
  function syncControlsLight() {
    $("f-price-amt-wrap").hidden = !(form.priceKind === "amount" || form.priceKind === "from");
    $("f-format-other-wrap").hidden = form.formats.indexOf("other") === -1;
    var rd = $("ribbon-doors");
    rd.textContent = form.doors ? "Doors open at " + fmtTime(form.doors, form.timeFmt) : "Doors open at …";
    var tu = (form.ticketUrl || "").trim(), help = $("f-ticket-help");
    if (tu && !normUrl(tu)) help.textContent = "That does not look like a web link. Start it with https://";
    else if (form.qr && tu && !getQR()) help.textContent = "This link is too long for a QR code. Use a shorter link.";
    else help.textContent = "Short links look best on a poster.";
    var T = TEMPLATES[state.templateKey], C = themeColors(T);
    ["f-c-bg1:" + state.bg.c1, "f-c-bg2:" + state.bg.c2, "f-c-text:" + C.text, "f-c-accent:" + C.accent].forEach(function (p) {
      var kv = p.split(":"); $(kv[0]).value = kv[1];
    });
  }

  function onPanelInput(evt) {
    var el = evt.target, b = BIND_BY_ID[el.id];
    if (!b) return;
    var v = b[2] === "check" ? el.checked : b[2] === "num" ? +el.value : el.value;
    form[b[0]] = v;
    afterFormChange();
  }
  var panel = $("form-panel");
  panel.addEventListener("input", onPanelInput);
  panel.addEventListener("change", onPanelInput);

  $("f-credit").addEventListener("change", function () {
    state.credit = this.checked;
    afterFormChange();
  });

  // chips: formats (many), ribbons (many), time format (one)
  function toggleIn(arr, v) {
    var i = arr.indexOf(v);
    if (i === -1) arr.push(v); else arr.splice(i, 1);
  }
  $("f-formats").addEventListener("click", function (evt) {
    var b = evt.target.closest("[data-format]");
    if (!b) return;
    toggleIn(form.formats, b.getAttribute("data-format"));
    setPressed("f-formats", "data-format", form.formats);
    afterFormChange();
    if (b.getAttribute("data-format") === "other" && form.formats.indexOf("other") !== -1) $("f-format-other").focus();
  });
  $("f-ribbons").addEventListener("click", function (evt) {
    var b = evt.target.closest("[data-ribbon]");
    if (!b) return;
    toggleIn(form.ribbons, b.getAttribute("data-ribbon"));
    if (b.getAttribute("data-ribbon") === "doors" && !form.doors && form.ribbons.indexOf("doors") !== -1) {
      status("Add a doors time in “2 · When” so this ribbon can show it.", "error");
      openSection("sec-when"); $("f-doors").focus();
    }
    setPressed("f-ribbons", "data-ribbon", form.ribbons);
    afterFormChange();
  });
  $("f-timefmt").addEventListener("click", function (evt) {
    var b = evt.target.closest("[data-timefmt]");
    if (!b) return;
    form.timeFmt = b.getAttribute("data-timefmt");
    savePrefs();
    setPressed("f-timefmt", "data-timefmt", [form.timeFmt]);
    afterFormChange();
  });

  // palette presets, custom colours, font pairs
  function setPalette(p, key) {
    form.palette = p ? { bg1: p.bg1, bg2: p.bg2, text: p.text, accent: p.accent, key: key } : null;
    var T = TEMPLATES[state.templateKey];
    if (p) {
      state.bg.c1 = p.bg1; state.bg.c2 = p.bg2;
      if (state.bg.mode === "solid") state.bg.mode = "gradient";
      if (state.bg.mode === "photo" && !state.bg.img) state.bg.mode = "gradient";
    } else {
      state.bg.c1 = T.bg.c1; state.bg.c2 = T.bg.c2;
      if (!state.bg.img) state.bg.mode = T.bg.mode;
    }
  }
  $("palette-row").addEventListener("click", function (evt) {
    var b = evt.target.closest("[data-palette]");
    if (!b) return;
    var k = b.getAttribute("data-palette");
    setPalette(k === "none" ? null : PALETTES[k], k);
    syncToolbar(); syncControls(); afterFormChange();
  });
  $("pair-row").addEventListener("click", function (evt) {
    var b = evt.target.closest("[data-pair]");
    if (!b) return;
    form.pair = b.getAttribute("data-pair");
    syncControls(); afterFormChange();
  });
  function onCustomColour(field) {
    return function () {
      var T = TEMPLATES[state.templateKey], C = themeColors(T);
      var base = form.palette || { bg1: state.bg.c1, bg2: state.bg.c2, text: C.text, accent: C.accent };
      var p = { bg1: base.bg1, bg2: base.bg2, text: base.text, accent: base.accent };
      p[field] = this.value;
      setPalette(p, "custom");
      syncToolbar();
      setPressed("palette-row", "data-palette", ["custom"]);
      afterFormChange();
    };
  }
  $("f-c-bg1").addEventListener("input", onCustomColour("bg1"));
  $("f-c-bg2").addEventListener("input", onCustomColour("bg2"));
  $("f-c-text").addEventListener("input", onCustomColour("text"));
  $("f-c-accent").addEventListener("input", onCustomColour("accent"));

  // ------------------------------------------------------- image uploads
  // Read a picked image on-device, shrink it, keep it in memory. Nothing is uploaded.
  function loadImageFile(file, maxDim, kind) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read that file")); };
      reader.onload = function () {
        var raw = new Image();
        raw.onerror = function () { reject(new Error("That file is not an image this browser can open")); };
        raw.onload = function () {
          var url = reader.result, img = raw;
          var isSvg = /svg/i.test(file.type);
          var iw = raw.naturalWidth, ih = raw.naturalHeight;
          if (!isSvg && iw > 0 && Math.max(iw, ih) > maxDim) {
            try {
              var sc = maxDim / Math.max(iw, ih);
              var c = document.createElement("canvas");
              c.width = Math.round(iw * sc); c.height = Math.round(ih * sc);
              var cx = c.getContext("2d");
              var keepAlpha = kind === "logo" && /png|webp/i.test(file.type);
              if (!keepAlpha) { cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, c.width, c.height); }
              cx.drawImage(raw, 0, 0, c.width, c.height);
              url = keepAlpha ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
            } catch (e) { url = reader.result; }
            img = new Image();
            img.onload = function () { done(img, url); };
            img.onerror = function () { done(raw, reader.result); };
            img.src = url;
            return;
          }
          done(img, url);
        };
        raw.src = reader.result; // local data: URL, never sent anywhere
      };
      reader.readAsDataURL(file);
      function done(img, url) {
        var id = "i" + (nextImg++);
        imgs[id] = { img: img, url: url };
        resolve(id);
      }
    });
  }

  $("f-logo-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    var input = this;
    if (!file) return;
    loadImageFile(file, 800, "logo").then(function (id) {
      form.logoId = id;
      input.value = "";
      syncControls(); afterFormChange();
      status("Logo added. Pick a corner and a size in Brand.", "ok");
    }).catch(function (e) { status(e.message, "error"); });
  });
  $("logo-remove").addEventListener("click", function () {
    form.logoId = null;
    syncControls(); afterFormChange();
  });

  // ------------------------------------------------------------ lineup UI
  var ROLE_OPTIONS = [["", "No role"], ["headliner", "Headliner"], ["mc", "MC"], ["host", "Host"], ["guest", "Guest"], ["feature", "Feature"]];

  function luEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function luField(labelText, id, input) {
    var wrap = luEl("label", "fld");
    wrap.setAttribute("for", id);
    wrap.appendChild(luEl("span", null, labelText));
    input.id = id;
    wrap.appendChild(input);
    return wrap;
  }

  function renderLineupUI(keepFocus) {
    var box = $("lineup-list");
    var focusId = keepFocus && document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
    box.innerHTML = "";
    var n = form.lineup.length;
    form.lineup.forEach(function (c, i) {
      var row = luEl("div", "lu-row");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Comic " + (i + 1));
      var head = luEl("div", "lu-head");
      head.appendChild(luEl("strong", null, "Comic " + (i + 1)));
      [["up", "↑", "Move comic " + (i + 1) + " up", i === 0], ["down", "↓", "Move comic " + (i + 1) + " down", i === n - 1],
       ["del", "✕", "Remove comic " + (i + 1), false]].forEach(function (d) {
        var b = luEl("button", "lu-btn", d[1]);
        b.type = "button"; b.id = "lu-" + d[0] + "-" + c.id;
        b.setAttribute("aria-label", d[2]); b.setAttribute("data-lu", d[0]); b.setAttribute("data-id", c.id);
        b.disabled = d[3];
        head.appendChild(b);
      });
      row.appendChild(head);
      var name = luEl("input"); name.type = "text"; name.value = c.name || ""; name.maxLength = 60; name.autocomplete = "off";
      name.setAttribute("data-lu-field", "name"); name.setAttribute("data-id", c.id);
      row.appendChild(luField("Comic name", "lu-name-" + c.id, name));
      var hd = luEl("input"); hd.type = "text"; hd.value = c.handle || ""; hd.maxLength = 40; hd.autocomplete = "off"; hd.placeholder = "@handle";
      hd.setAttribute("data-lu-field", "handle"); hd.setAttribute("data-id", c.id);
      row.appendChild(luField("Instagram handle", "lu-handle-" + c.id, hd));
      var role = luEl("select");
      ROLE_OPTIONS.forEach(function (o) {
        var op = luEl("option", null, o[1]); op.value = o[0]; if (o[0] === (c.role || "")) op.selected = true; role.appendChild(op);
      });
      role.setAttribute("data-lu-field", "role"); role.setAttribute("data-id", c.id);
      row.appendChild(luField("Role", "lu-role-" + c.id, role));
      var sp = luEl("label", "fld chk"); sp.setAttribute("for", "lu-special-" + c.id);
      var spc = luEl("input"); spc.type = "checkbox"; spc.id = "lu-special-" + c.id; spc.checked = !!c.special;
      spc.setAttribute("data-lu-field", "special"); spc.setAttribute("data-id", c.id);
      sp.appendChild(spc); sp.appendChild(luEl("span", null, "Special guest"));
      row.appendChild(sp);
      var ph = luEl("div", "lu-photo");
      var photoImg = c.photoId && imgs[c.photoId] ? imgs[c.photoId] : null;
      if (photoImg) { var th = luEl("img", "lu-thumb"); th.src = photoImg.url; th.alt = "Headshot of " + (c.name || "comic " + (i + 1)); ph.appendChild(th); }
      var fl = luEl("label", "pill file-btn", photoImg ? "Change headshot…" : "Add headshot…");
      var fi = luEl("input"); fi.type = "file"; fi.accept = "image/*"; fi.id = "lu-photo-" + c.id;
      fi.setAttribute("data-lu-photo", c.id);
      fl.appendChild(fi);
      ph.appendChild(fl);
      if (photoImg) {
        var rm = luEl("button", "pill", "Remove headshot"); rm.type = "button";
        rm.setAttribute("data-lu", "rmphoto"); rm.setAttribute("data-id", c.id); rm.id = "lu-rmphoto-" + c.id;
        ph.appendChild(rm);
      }
      row.appendChild(ph);
      box.appendChild(row);
    });
    if (focusId && $(focusId)) $(focusId).focus();
  }

  function luFind(id) {
    for (var i = 0; i < form.lineup.length; i++) if (form.lineup[i].id === id) return i;
    return -1;
  }

  $("lineup-add").addEventListener("click", function () {
    var id = "c" + (form.nextLu++);
    form.lineup.push({ id: id, name: "", handle: "", role: form.lineup.length ? "" : "headliner", special: false, photoId: null });
    renderLineupUI(false);
    afterFormChange();
    var inp = $("lu-name-" + id);
    if (inp) inp.focus();
  });

  var luBox = $("lineup-list");
  luBox.addEventListener("input", function (evt) {
    var el = evt.target, f = el.getAttribute("data-lu-field");
    if (!f) return;
    var i = luFind(el.getAttribute("data-id"));
    if (i === -1) return;
    form.lineup[i][f] = el.type === "checkbox" ? el.checked : el.value;
    afterFormChange();
  });
  luBox.addEventListener("click", function (evt) {
    var b = evt.target.closest("[data-lu]");
    if (!b) return;
    var id = b.getAttribute("data-id"), act = b.getAttribute("data-lu"), i = luFind(id);
    if (i === -1) return;
    var focusId = null;
    if (act === "up" && i > 0) { form.lineup.splice(i - 1, 0, form.lineup.splice(i, 1)[0]); focusId = "lu-" + (i - 1 === 0 ? "down" : "up") + "-" + id; }
    else if (act === "down" && i < form.lineup.length - 1) { form.lineup.splice(i + 1, 0, form.lineup.splice(i, 1)[0]); focusId = "lu-" + (i + 1 === form.lineup.length - 1 ? "up" : "down") + "-" + id; }
    else if (act === "del") { form.lineup.splice(i, 1); focusId = form.lineup.length ? "lineup-add" : "lineup-add"; }
    else if (act === "rmphoto") { form.lineup[i].photoId = null; focusId = "lu-photo-" + id; }
    renderLineupUI(false);
    afterFormChange();
    if (focusId && $(focusId)) $(focusId).focus();
  });
  luBox.addEventListener("change", function (evt) {
    var el = evt.target, id = el.getAttribute("data-lu-photo");
    if (!id) return;
    var file = el.files && el.files[0];
    if (!file) return;
    loadImageFile(file, 480, "head").then(function (imgId) {
      var i = luFind(id);
      if (i === -1) return;
      form.lineup[i].photoId = imgId;
      form.showHeads = true;
      $("f-show-heads").checked = true;
      renderLineupUI(false);
      afterFormChange();
      status("Headshot added. It stays on your device.", "ok");
    }).catch(function (e) { status(e.message, "error"); });
  });

  // ------------------------------------------------------------ checklist
  function checklistItems() {
    var f = form;
    return [
      { label: "Show title", ok: !!(f.title || "").trim(), sec: "sec-show", field: "f-title" },
      { label: "Date", ok: !!parseDate(f.date), sec: "sec-when", field: "f-date" },
      { label: "Doors or start time", ok: !!(f.doors || f.start), sec: "sec-when", field: "f-start" },
      { label: "Venue name", ok: !!(f.venue || "").trim(), sec: "sec-where", field: "f-venue" },
      { label: "Street address", ok: !!(f.address || "").trim(), sec: "sec-where", field: "f-address" },
      { label: "Ticket link", ok: !!normUrl(f.ticketUrl), sec: "sec-tickets", field: "f-ticket" },
      { label: "At least one comic", ok: f.lineup.some(function (c) { return (c.name || "").trim(); }), sec: "sec-lineup", field: "lineup-add", special: "lineup" },
      { label: "Logo", ok: !!(f.logoId && imgs[f.logoId]), sec: "sec-brand", field: "f-logo-file", special: "logo" }
    ];
  }

  function updateChecklist() {
    var items = checklistItems(), ul = $("checklist"), done = 0;
    ul.innerHTML = "";
    items.forEach(function (it, idx) {
      if (it.ok) done++;
      var li = document.createElement("li");
      li.className = it.ok ? "done" : "todo";
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-cl", String(idx));
      var tick = document.createElement("span"); tick.className = "tick"; tick.setAttribute("aria-hidden", "true"); tick.textContent = it.ok ? "✓" : "!";
      var lab = document.createElement("span"); lab.textContent = it.label;
      var st = document.createElement("span"); st.className = "cl-state"; st.textContent = it.ok ? "Done" : "Add it";
      b.appendChild(tick); b.appendChild(lab); b.appendChild(st);
      b.setAttribute("aria-label", it.label + ": " + (it.ok ? "done" : "missing. Go to the field"));
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("checklist-count").textContent = "(" + done + " of " + items.length + ")";
    state.missing = items.filter(function (i) { return !i.ok; }).map(function (i) { return i.label.toLowerCase(); });
  }

  $("checklist").addEventListener("click", function (evt) {
    var b = evt.target.closest("[data-cl]");
    if (!b) return;
    var it = checklistItems()[+b.getAttribute("data-cl")];
    openSection(it.sec);
    var target = $(it.field);
    if (it.special === "lineup") {
      var firstEmpty = form.lineup.filter(function (c) { return !(c.name || "").trim(); })[0];
      if (firstEmpty && $("lu-name-" + firstEmpty.id)) target = $("lu-name-" + firstEmpty.id);
    }
    if (target) {
      target.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    }
  });

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function openSection(id) {
    var d = $(id);
    if (d && d.tagName === "DETAILS") d.open = true;
  }
  var sectionsInit = false;
  function initSections() {
    if (sectionsInit) return;
    sectionsInit = true;
    // wide screens: the form is a long right-hand column; open the first three sections
    if (window.innerWidth >= 900) ["sec-show", "sec-when", "sec-where"].forEach(openSection);
  }

  // -------------------------------------------------------------- caption
  function cityTag(c) {
    var t = (c || "").normalize ? c.normalize("NFD").replace(/[̀-ͯ]/g, "") : c;
    return (t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function buildCaption() {
    var f = form, fr = f.lang === "fr", lines = [];
    var title = (f.title || "").trim();
    var phrases = [];
    f.formats.forEach(function (k) {
      if (k === "other") { if ((f.formatOther || "").trim()) phrases.push(f.formatOther.trim().toLowerCase()); }
      else if (FORMAT_PHRASE[k]) phrases.push(FORMAT_PHRASE[k]);
    });
    var what = phrases.length ? phrases.join(", ") : "live comedy";
    what = what.charAt(0).toUpperCase() + what.slice(1);
    var city = (f.city || "").trim();
    var langLine = f.lang === "fr" ? "En français" : f.lang === "bi" ? "In English and French / en anglais et en français" : "In English";
    if (title) lines.push(title.toUpperCase());
    lines.push(what + (city ? (fr ? " à " : " in ") + city : "") + " — " + langLine + ".");
    if (f.tagline && f.tagline.trim()) lines.push(f.tagline.trim());
    var when = [dateText(f), timeLine(f).replace(/  ·  /g, ", ")].filter(Boolean).join(" — ");
    if (when) lines.push((fr ? "Quand : " : "When: ") + when);
    var where = [(f.venue || "").trim(), (f.address || "").trim(), city].filter(Boolean).join(", ");
    if (where) lines.push((fr ? "Où : " : "Where: ") + where);
    if ((f.transit || "").trim()) lines.push(L("transit") + ": " + f.transit.trim());
    var names = f.lineup.filter(function (c) { return (c.name || "").trim(); }).map(function (c) {
      var h = handle(c.handle, "@");
      return c.name.trim() + (h ? " " + h : "");
    });
    if (names.length) lines.push((fr ? "Avec : " : "With: ") + names.join(", "));
    var pt = priceText(f), pr = [pt, (f.promo || "").trim(), ageText(f)].filter(Boolean).join(" · ");
    if (pr) lines.push(pr);
    var tu = normUrl(f.ticketUrl);
    if (tu) lines.push((fr ? "Billets : " : "Tickets: ") + tu);
    var mu = normUrl(f.mapUrl);
    if (mu) lines.push((fr ? "Itinéraire : " : "Directions: ") + mu);
    var note = (f.note || "").trim();
    if (note) lines.push(note);
    var ig = handle(f.instagram, "@");
    if (ig) lines.push(ig);
    var tags = [];
    if (f.formats.indexOf("standup") !== -1) tags.push("#standupcomedy");
    if (f.formats.indexOf("openmic") !== -1) tags.push("#openmic");
    if (f.formats.indexOf("improv") !== -1) tags.push("#improv");
    if (cityTag(city)) tags.push("#" + cityTag(city) + "comedy");
    var ht = handle(f.hashtag, "#");
    if (ht) tags.push(ht);
    if (!tags.length) tags.push("#comedy");
    lines.push(tags.join(" "));
    return lines.join("\n");
  }

  function updateCaption(force) {
    var el = $("caption-text");
    if (captionEdited && !force) return;
    el.value = buildCaption();
  }
  $("caption-text").addEventListener("input", function () { captionEdited = true; scheduleCommit(); });
  $("caption-rebuild").addEventListener("click", function () {
    captionEdited = false;
    updateCaption(true);
    $("caption-status").textContent = "Caption rebuilt from the form.";
  });
  $("caption-copy").addEventListener("click", function () {
    var el = $("caption-text"), btn = $("caption-copy");
    function ok() {
      btn.classList.add("done"); btn.textContent = "Copied";
      $("caption-status").textContent = "Caption copied. Paste it into your post.";
      setTimeout(function () { btn.classList.remove("done"); btn.textContent = "Copy caption"; }, 2000);
    }
    function fallback() {
      el.focus(); el.select();
      var good = false;
      try { good = document.execCommand("copy"); } catch (e) { good = false; }
      if (good) ok(); else $("caption-status").textContent = "Copy is blocked here. Select the text and copy it yourself.";
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(el.value).then(ok, fallback);
    } else { fallback(); }
  });

  // -------------------------------------------------- undo / redo / draft
  var hist = { stack: [], idx: -1, timer: null, restoring: false, dirty: false };

  function captureState() {
    return JSON.stringify({
      v: 1, form: form, sizeKey: state.sizeKey, templateKey: state.templateKey,
      bg: { mode: state.bg.mode, c1: state.bg.c1, c2: state.bg.c2, darken: state.bg.darken },
      ov: state.ov, custom: state.custom, sticker: { on: state.sticker.on, x: state.sticker.x, y: state.sticker.y },
      credit: state.credit, show: state.show, captionEdited: captionEdited,
      caption: captionEdited ? $("caption-text").value : ""
    });
  }

  function restoreState(json) {
    var d = JSON.parse(json);
    hist.restoring = true;
    var base = defaultForm(), k;
    for (k in d.form) if (Object.prototype.hasOwnProperty.call(d.form, k)) base[k] = d.form[k];
    form = base;
    if (!/^(12|24|fr)$/.test(form.timeFmt)) form.timeFmt = prefTimeFmt();
    state.sizeKey = SIZES[d.sizeKey] ? d.sizeKey : "ig-post";
    state.templateKey = TEMPLATES[d.templateKey] ? d.templateKey : "classic";
    state.bg.mode = d.bg.mode; state.bg.c1 = d.bg.c1; state.bg.c2 = d.bg.c2; state.bg.darken = d.bg.darken;
    if (state.bg.mode === "photo" && !state.bg.img) state.bg.mode = "gradient";
    state.ov = d.ov || {};
    state.custom = d.custom || [];
    state.sticker.on = !!d.sticker.on; state.sticker.x = d.sticker.x; state.sticker.y = d.sticker.y;
    if (state.sticker.on && !stickerImg) loadSticker();
    state.credit = d.credit !== false;
    state.show = d.show || null;
    captionEdited = !!d.captionEdited;
    if (captionEdited) $("caption-text").value = d.caption || "";
    state.selected = null;
    syncToolbar(); syncControls();
    refresh();
    updateChecklist();
    updateCaption(false);
    hist.restoring = false;
  }

  function updateUndoButtons() {
    $("undo-btn").disabled = hist.idx <= 0;
    $("redo-btn").disabled = hist.idx >= hist.stack.length - 1;
  }

  function histReset() {
    clearTimeout(hist.timer);
    hist.stack = []; hist.idx = -1; hist.timer = null; hist.dirty = false;
    updateUndoButtons();
  }

  function histCommit(first) {
    clearTimeout(hist.timer); hist.timer = null;
    if (hist.restoring) return;
    var snap = captureState();
    if (hist.idx >= 0 && hist.stack[hist.idx] === snap) { updateUndoButtons(); return; }
    hist.stack = hist.stack.slice(0, hist.idx + 1);
    hist.stack.push(snap);
    if (hist.stack.length > 120) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    updateUndoButtons();
    if (!first) saveDraftSoon();
  }

  function scheduleCommit() {
    if (hist.restoring) return;
    hist.dirty = true;
    clearTimeout(hist.timer);
    hist.timer = setTimeout(function () { histCommit(false); }, 500);
  }

  function undo() {
    if (hist.timer) histCommit(false);
    if (hist.idx <= 0) return;
    hist.idx--;
    restoreState(hist.stack[hist.idx]);
    updateUndoButtons(); saveDraftSoon();
  }
  function redo() {
    if (hist.idx >= hist.stack.length - 1) return;
    hist.idx++;
    restoreState(hist.stack[hist.idx]);
    updateUndoButtons(); saveDraftSoon();
  }
  $("undo-btn").addEventListener("click", undo);
  $("redo-btn").addEventListener("click", redo);
  document.addEventListener("keydown", function (evt) {
    if ($("editor").style.display !== "block") return;
    if (!(evt.metaKey || evt.ctrlKey) || evt.key.toLowerCase() !== "z") return;
    var t = evt.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return; // keep the browser's own text undo
    evt.preventDefault();
    if (evt.shiftKey) redo(); else undo();
  });

  var draftTimer = null;
  function saveDraftSoon() {
    if (!hist.dirty) return; // never overwrite a saved draft until the person actually changes something
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 800);
  }
  function usedImageIds() {
    var ids = [];
    if (form.logoId) ids.push(form.logoId);
    form.lineup.forEach(function (c) { if (c.photoId) ids.push(c.photoId); });
    return ids;
  }
  function saveDraft() {
    if ($("editor").style.display !== "block") return;
    var payload = { savedAt: Date.now(), title: (form.title || "").trim(), state: captureState(), images: {} };
    usedImageIds().forEach(function (id) { if (imgs[id]) payload.images[id] = imgs[id].url; });
    if (!lsSet(DRAFT_KEY, JSON.stringify(payload))) {
      payload.images = {}; // too big for this browser: keep the text, drop the pictures
      lsSet(DRAFT_KEY, JSON.stringify(payload));
    }
  }
  function readDraft() {
    var raw = lsGet(DRAFT_KEY);
    if (!raw) return null;
    try { var d = JSON.parse(raw); return d && d.state ? d : null; } catch (e) { return null; }
  }
  function refreshDraftCard() {
    var d = readDraft(), card = $("draft-card");
    card.hidden = !d;
    if (d) {
      var when = new Date(d.savedAt);
      $("draft-note").textContent = (d.title ? "“" + d.title + "”" : "Untitled poster") + " · saved " + when.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    }
  }
  function continueDraft() {
    var d = readDraft();
    if (!d) return;
    var ids = Object.keys(d.images || {});
    var jobs = ids.map(function (id) {
      return new Promise(function (resolve) {
        var im = new Image();
        im.onload = function () { imgs[id] = { img: im, url: d.images[id] }; var n = parseInt(id.slice(1), 10); if (n >= nextImg) nextImg = n + 1; resolve(); };
        im.onerror = function () { resolve(); };
        im.src = d.images[id];
      });
    });
    Promise.all(jobs).then(function () {
      resetStateForNewPoster();
      restoreState(d.state);
      openEditor(true);
      status("Draft loaded. A background photo is not saved in drafts, so add it again if you used one.", "ok");
    });
  }
  $("draft-continue").addEventListener("click", continueDraft);
  $("draft-discard").addEventListener("click", function () { lsDel(DRAFT_KEY); refreshDraftCard(); });

  // Reset layout / Start over
  $("reset-layout").addEventListener("click", function () {
    state.ov = {};
    state.selected = null;
    syncToolbar(); refresh(); histCommit(false);
    status("Layout reset. Text, photos and the form are unchanged.", "ok");
  });
  var armTimer = null;
  $("start-over").addEventListener("click", function () {
    var btn = this;
    if (!btn.getAttribute("data-armed")) {
      btn.setAttribute("data-armed", "1");
      btn.textContent = "Tap again to erase everything";
      armTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    lsDel(DRAFT_KEY);
    clearTimeout(draftTimer);
    form = defaultForm();
    imgs = {};
    state.show = null;
    resetStateForNewPoster();
    applyTemplateBg(state.templateKey);
    state.sizeKey = "ig-post";
    $("editor").style.display = "none";
    $("picker").style.display = "block";
    refreshDraftCard();
    window.scrollTo(0, 0);
  });
  function disarm() {
    clearTimeout(armTimer);
    var btn = $("start-over");
    btn.removeAttribute("data-armed");
    btn.textContent = "Start over";
  }

  // -------------------------------------------------- pointer interaction
  var drag = null;

  function canvasPoint(evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function hitTest(pt) {
    // order: sticker, QR/logo (drawn on top), text, lineup/ribbons
    if (state.sticker.on && state.sticker._bbox) {
      var s = state.sticker._bbox;
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) return "sticker";
    }
    var i, top = [], low = [];
    state.items.forEach(function (it) {
      if (it.noselect) return;
      (it.kind === "qr" || it.kind === "logo" ? top : low).push(it);
    });
    function inBox(b, pad) { return pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad; }
    for (i = top.length - 1; i >= 0; i--) if (inBox(top[i]._bbox, 0)) return top[i].id;
    // exact hits first, then forgiving (padded) hits
    for (var pass = 0; pass < 2; pass++) {
      for (i = state.blocks.length - 1; i >= 0; i--) {
        var b = state.blocks[i]._bbox;
        if (!b) continue;
        var pad = pass ? state.blocks[i].sizeF * canvas.width * 0.2 : 0;
        if (inBox(b, pad)) return state.blocks[i].id;
      }
      for (i = low.length - 1; i >= 0; i--) if (inBox(low[i]._bbox, pass ? 8 : 0)) return low[i].id;
    }
    return null;
  }

  canvas.addEventListener("pointerdown", function (evt) {
    if ($("inline-editor").style.display === "block") { commitInlineEdit(); }
    var pt = canvasPoint(evt);
    var hit = hitTest(pt);
    drag = { id: hit, startPt: pt, moved: false, wasSelected: state.selected === hit };
    if (hit !== null) {
      state.selected = hit;
      canvas.setPointerCapture(evt.pointerId);
    } else {
      state.selected = null;
    }
    syncToolbar();
    render();
    evt.preventDefault();
  });

  canvas.addEventListener("pointermove", function (evt) {
    if (!drag || drag.id === null) return;
    var pt = canvasPoint(evt);
    var dx = pt.x - drag.startPt.x, dy = pt.y - drag.startPt.y;
    if (!drag.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    drag.moved = true;
    moveSelected(dx, dy);
    drag.startPt = pt;
  });

  // move the selected thing by (dx, dy) canvas pixels and remember it as a manual position
  function moveSelected(dx, dy) {
    var W = canvas.width, H = canvas.height;
    if (state.selected === "sticker") {
      state.sticker.x = Math.min(1, Math.max(0, state.sticker.x + dx / W));
      state.sticker.y = Math.min(1, Math.max(0, state.sticker.y + dy / H));
      render();
      return;
    }
    var b = selectedBlock();
    if (b) {
      var src = b._src;
      src.x = Math.min(1.05, Math.max(-0.05, (src.x != null ? src.x : b.x) + dx / W));
      src.y = Math.min(1.02, Math.max(-0.02, (src.y != null ? src.y : b.y) + dy / H));
      b.x = src.x; b.y = src.y;
      layout(); render();
      return;
    }
    var it = selectedItem();
    if (it) {
      var o = getOv(it.id);
      o.x = Math.min(1, Math.max(-0.05, (o.x != null ? o.x : it.x / W) + dx / W));
      o.y = Math.min(1, Math.max(-0.05, (o.y != null ? o.y : it.y / H) + dy / H));
      layout(); render();
    }
  }

  canvas.addEventListener("pointerup", function () {
    if (!drag) return;
    var wasTapOnSelected = !drag.moved && drag.id !== null && drag.id !== "sticker" && drag.wasSelected;
    var moved = drag.moved;
    drag = null;
    if (moved) { scheduleCommit(); return; }
    if (wasTapOnSelected) {
      if (selectedBlock()) startInlineEdit();
      else if (selectedItem()) jumpToItemFields(selectedItem().id);
    }
  });

  function jumpToItemFields(id) {
    var map = { lineup: ["sec-lineup", "lineup-add"], ribbons: ["sec-extras", "f-ribbons"], qr: ["sec-tickets", "f-ticket"], logo: ["sec-brand", "f-logo-file"] };
    var m = map[id];
    if (!m) return;
    openSection(m[0]);
    var el = $(m[1]);
    if (el) {
      var focusEl = m[1] === "f-ribbons" ? el.querySelector("button") : el;
      focusEl.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      focusEl.focus({ preventScroll: true });
    }
  }

  // keyboard on the canvas: [ and ] pick the previous/next thing, arrows nudge, Enter edits
  canvas.setAttribute("tabindex", "0");
  canvas.addEventListener("keydown", function (evt) {
    var ids = state.blocks.map(function (b) { return b.id; }).concat(state.items.filter(function (i) { return !i.noselect; }).map(function (i) { return i.id; }));
    var k = evt.key, cur = ids.indexOf(state.selected);
    if (k === "]" || k === "[") {
      if (!ids.length) return;
      cur = k === "]" ? (cur + 1) % ids.length : (cur <= 0 ? ids.length - 1 : cur - 1);
      state.selected = ids[cur];
      syncToolbar(); render();
      evt.preventDefault();
    } else if (/^Arrow/.test(k) && state.selected) {
      var step = (evt.shiftKey ? 0.05 : 0.01);
      var dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
      var dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
      moveSelected(dx * canvas.width, dy * canvas.height);
      scheduleCommit();
      evt.preventDefault();
    } else if (k === "Enter" && selectedBlock()) {
      startInlineEdit(); evt.preventDefault();
    } else if (k === "Escape") {
      state.selected = null; syncToolbar(); render();
    }
  });

  // --------------------------------------------------------- inline editor
  function startInlineEdit() {
    var b = selectedBlock();
    if (!b || !b._bbox) return;
    var ta = $("inline-editor");
    var rect = canvas.getBoundingClientRect();
    var wrap = $("canvas-wrap").getBoundingClientRect();
    var scale = rect.width / canvas.width;
    var left = rect.left - wrap.left + b._bbox.x * scale;
    var top = rect.top - wrap.top + b._bbox.y * scale;
    ta.value = b.ph ? "" : b.text;
    ta.style.display = "block";
    ta.style.left = Math.max(4, Math.min(left, wrap.width - 190)) + "px";
    ta.style.top = Math.max(4, top - 6) + "px";
    ta.style.width = Math.min(Math.max(b._bbox.w * scale + 40, 200), wrap.width - 16) + "px";
    var f = FONTS[b.font];
    ta.style.fontFamily = f.family + ", sans-serif";
    ta.style.fontWeight = f.weight;
    ta.style.fontSize = Math.max(14, Math.min(28, b.sizeF * canvas.width * scale)) + "px";
    ta.rows = Math.max(1, b.text.split("\n").length);
    ta.focus();
    ta.select();
  }

  function commitInlineEdit() {
    var ta = $("inline-editor");
    if (ta.style.display !== "block") return;
    var b = selectedBlock();
    ta.style.display = "none";
    if (b && ta.value.trim() !== "") {
      if (b.custom) {
        b._src.text = ta.value;
      } else if (b.field) {
        // this line IS a form field: write it back so form and poster agree
        form[b.field] = b.field === "note" ? ta.value : ta.value.replace(/\s*\n\s*/g, " ");
        syncControls();
        afterFormChange();
        return;
      } else {
        b._src.text = ta.value;
        status("You changed this line by hand. It no longer follows the form. “Reset layout” links it back.", "ok");
      }
      refresh();
      scheduleCommit();
    } else {
      render();
    }
  }

  $("inline-editor").addEventListener("blur", commitInlineEdit);
  $("inline-editor").addEventListener("keydown", function (evt) {
    if (evt.key === "Enter" && !evt.shiftKey) { evt.preventDefault(); commitInlineEdit(); }
    if (evt.key === "Escape") { $("inline-editor").style.display = "none"; }
  });

  // -------------------------------------------------------- toolbar wiring
  $("size-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-size]");
    if (!pill) return;
    state.sizeKey = pill.getAttribute("data-size");
    syncToolbar();
    refresh();
    scheduleCommit();
  });

  $("template-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-template]");
    if (!pill) return;
    applyTemplate(pill.getAttribute("data-template"));
    scheduleCommit();
  });

  // change one style property of the selected text and re-flow
  function styleSelected(fn) {
    var b = selectedBlock();
    if (!b) return;
    fn(b._src, b);
    layout(); syncToolbar(); render(); scheduleCommit();
  }

  $("font-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-font]");
    if (!pill) return;
    styleSelected(function (o) { o.font = pill.getAttribute("data-font"); });
  });

  $("align-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-align]");
    if (!pill) return;
    var newAlign = pill.getAttribute("data-align");
    styleSelected(function (o, b) {
      // a hand-placed block stays visually in place: move the anchor to the
      // matching edge/center of its current box
      if (o.x != null && b._bbox) {
        var W = canvas.width;
        if (newAlign === "left") o.x = b._bbox.x / W;
        else if (newAlign === "right") o.x = (b._bbox.x + b._bbox.w) / W;
        else o.x = (b._bbox.x + b._bbox.w / 2) / W;
      }
      o.align = newAlign;
    });
  });

  $("size-minus").addEventListener("click", function () {
    styleSelected(function (o, b) { o.sizeF = Math.max(0.01, b.sizeF * 0.9); });
  });
  $("size-plus").addEventListener("click", function () {
    styleSelected(function (o, b) { o.sizeF = Math.min(0.4, b.sizeF * 1.1); });
  });

  $("swatch-row").addEventListener("click", function (evt) {
    var sw = evt.target.closest("[data-color]");
    if (!sw) return;
    styleSelected(function (o) { o.color = sw.getAttribute("data-color"); });
  });
  $("custom-color").addEventListener("input", function () {
    var v = this.value;
    styleSelected(function (o) { o.color = v; });
  });

  $("delete-block").addEventListener("click", function () {
    var b = selectedBlock();
    if (!b) return;
    if (b.custom) state.custom = state.custom.filter(function (c) { return c.id !== b.id; });
    else b._src.hidden = true; // a form-built line is hidden, not lost; "Reset layout" brings it back
    state.selected = null;
    syncToolbar(); refresh(); scheduleCommit();
    if (!b.custom) status("Line hidden. “Reset layout” brings it back.", "ok");
  });

  $("add-text").addEventListener("click", function () {
    var c = {
      id: "t" + (nextCustom++), text: "New text — tap to edit", font: "inter", sizeF: 0.04,
      color: bgIsLight() ? "#171512" : "#ffffff", align: "center", x: 0.5, y: 0.45, maxwF: 0.86
    };
    state.custom.push(c);
    state.selected = c.id;
    syncToolbar(); refresh(); scheduleCommit();
  });

  // background controls
  $("bg-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-bg]");
    if (!pill) return;
    state.bg.mode = pill.getAttribute("data-bg");
    syncToolbar(); render(); scheduleCommit();
  });
  function setBgColour(c) {
    if (state.bg.mode === "photo") state.bg.mode = "solid";
    if (state.bg.mode === "gradient") { state.bg.c1 = c; }
    else { state.bg.c1 = c; state.bg.c2 = c; }
    if (form.palette) { form.palette.bg1 = state.bg.c1; form.palette.bg2 = state.bg.c2; form.palette.key = "custom"; }
    syncToolbar(); syncControls(); render(); scheduleCommit();
  }
  $("bg-swatch-row").addEventListener("click", function (evt) {
    var sw = evt.target.closest("[data-bgcolor]");
    if (!sw) return;
    setBgColour(sw.getAttribute("data-bgcolor"));
  });
  $("bg-custom-color").addEventListener("input", function () { setBgColour(this.value); });

  $("bg-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader(); // local only — the photo never leaves the device
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        state.bg.img = img;
        state.bg.mode = "photo";
        syncToolbar(); render(); scheduleCommit();
        status("Photo added — use the darken slider to keep text readable.", "ok");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  $("darken-range").addEventListener("input", function () {
    state.bg.darken = this.value / 100;
    render();
    scheduleCommit();
  });

  function loadSticker() {
    var img = new Image();
    img.onload = function () { stickerImg = img; render(); };
    img.src = STICKER_URL;
  }
  $("toggle-sticker").addEventListener("click", function () {
    state.sticker.on = !state.sticker.on;
    if (state.sticker.on && !stickerImg) loadSticker();
    syncToolbar(); render(); scheduleCommit();
  });

  // ---------------------------------------------------------------- export
  function exportBlob() {
    commitInlineEdit();
    render(false); // no selection outline in the export
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        render(true);
        if (blob) resolve(blob); else reject(new Error("toBlob returned null"));
      }, "image/png");
    });
  }

  function exportFilename() {
    var base = (state.show && state.show.slug) ? state.show.slug : "comedy-poster";
    return base + "-" + state.sizeKey + ".png";
  }

  function missingNote() {
    return state.missing && state.missing.length ? " Still missing: " + state.missing.join(", ") + "." : "";
  }

  $("export-png").addEventListener("click", function () {
    exportBlob().then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
      var sz = SIZES[state.sizeKey];
      status("Downloaded " + exportFilename() + " (" + sz.w + "×" + sz.h + "px)." + missingNote(), state.missing && state.missing.length ? "" : "ok");
    }).catch(function (e) { status("Export failed: " + e.message, "error"); });
  });

  $("copy-png").addEventListener("click", function () {
    if (!navigator.clipboard || !window.ClipboardItem) {
      status("Copy isn't supported in this browser — use Download PNG instead.", "error");
      return;
    }
    exportBlob().then(function (blob) {
      return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    }).then(function () {
      status("Poster copied — paste it anywhere." + missingNote(), state.missing && state.missing.length ? "" : "ok");
    }).catch(function (e) { status("Copy failed (" + e.message + ") — use Download PNG instead.", "error"); });
  });

  // ------------------------------------------------- phone: jump back up
  var watching = false;
  function watchCanvas() {
    if (watching || !window.IntersectionObserver) return;
    watching = true;
    var btn = $("jump-poster");
    new IntersectionObserver(function (entries) {
      btn.hidden = entries[0].isIntersecting || window.innerWidth >= 900 || $("editor").style.display !== "block";
    }).observe($("canvas-wrap"));
    btn.addEventListener("click", function () {
      $("canvas-wrap").scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
  }

  // ------------------------------------------------------------- boot
  $("blank-btn").addEventListener("click", function () {
    state.show = null;
    openEditor(false);
  });
  $("back-to-picker").addEventListener("click", function (evt) {
    evt.preventDefault();
    $("editor").style.display = "none";
    $("picker").style.display = "block";
    refreshDraftCard();
  });
  $("show-search").addEventListener("input", function () { renderResults(this.value); });

  function loadFonts() {
    var wanted = [
      "400 20px PosterAnton", "600 20px PosterOswald", "700 20px PosterPlayfair",
      "400 20px PosterInter", "700 20px PosterInter", "400 20px PosterMarker"
    ];
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(wanted.map(function (f) { return document.fonts.load(f); }))
      .then(function () { fontsReady = true; });
  }

  var fontsP = loadFonts();

  refreshDraftCard();

  loadEvents().then(function () {
    renderResults("");
    // ?event=<slug> deep link: show pages / booker portal link here with the
    // show_series slug (or an event slug) to open a prefilled editor directly.
    var params = new URLSearchParams(location.search);
    var want = params.get("event");
    if (want) {
      var match = allEvents.filter(function (ev) {
        return ev.show_series_slug === want || ev.slug === want;
      })[0];
      if (match) {
        fontsP.then(function () { startFromEvent(match); });
        return;
      }
      $("picker-note").textContent = "Couldn't find that show — pick it below or start blank.";
    }
  }).catch(function (e) {
    $("picker-note").textContent = "Couldn't load the show list (" + e.message + ") — you can still start from a blank canvas.";
  });

  fontsP.then(function () {
    // if the editor is already open (blank start before fonts landed), re-measure and redraw
    if ($("editor").style.display === "block") refresh();
  });

  // re-render on resize only affects CSS scale; canvas pixels are fixed.
  // But the inline editor position depends on layout:
  window.addEventListener("resize", function () {
    $("inline-editor").style.display = "none";
    if ($("editor").style.display === "block") fitCanvas();
  });

  // expose for tests
  window.AtlasPoster = {
    state: state,
    get form() { return form; },
    render: render,
    refresh: refresh,
    layout: layout,
    applyTemplate: applyTemplate,
    exportBlob: exportBlob,
    buildCaption: buildCaption,
    undo: undo,
    redo: redo,
    SIZES: SIZES
  };
})();
