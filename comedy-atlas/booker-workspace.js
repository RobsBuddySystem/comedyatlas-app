/* booker-workspace.js -- native "Programme your shows" workspace (My shows tab).
   Talks ONLY to our own proxy API (session cookie), via window.AtlasAuth:
   GET  /booker/confirmed/options            -> {credit,types,venues,acts}
   GET  /booker/confirmed/shows?include_past -> {shows:[{id,type_name,emoji,date,time,venue_*,public,meta,spots[],filled,total}]}
   POST /booker/confirmed/shows              -> {created:[ids]}      (409 = plan cap)
   PUT  /booker/confirmed/shows/{id}         -> {ok}                 (date,time,venue_id,description,meta)
   POST /booker/confirmed/shows/{id}/publish {public}
   PUT  /booker/confirmed/shows/{id}/spots/{sid} {act_id}|{unfill}|{role,spot_length,...}
   PUT  /booker/confirmed/shows/{id}/spots {updates:{sid:{order}}}   (batch reorder)
   POST /booker/confirmed/acts {name[,person_id]}  (name only, never contact)
   GET/PUT /booker/confirmed/shows/{id}/link   (link night to an Atlas show)
   POST/DELETE /booker/confirmed/shows/{id}/spots/{sid}/offer   (booking loop)
   GET  /booker/comics/search?available_date=YYYY-MM-DD
   GET  /booker/comics/search?q=       (Comedy Atlas directory)
   Every API string is escaped with E(). No contact data is ever handled. */
(function () {
  "use strict";
  var A = window.AtlasAuth, E = A.escapeHtml, list = document.getElementById("cfw-list");
  if (!A || !list) return;
  var S = { opts: null, shows: [], past: false, loaded: false, openId: null, tab: "spots", target: null,
            sort: "az", q: "", dirQ: "", dir: [], collapsed: {}, futureOpen: true, lastFocus: null, panel: null, note: null, avail: null };
  var CREDIT = '<a class="confirmed-credit" href="https://confirmed.show" rel="noopener" target="_blank"><span class="confirmed-credit-logo" aria-hidden="true"></span>Powered by confirmed.show</a>';
  var CAT = { host: ["Hosts", "Host"], act: ["Acts", "Act"], production: ["Production", "Production"] };
  var timer = null, modal = null;
  function $(id) { return document.getElementById(id); }
  function err(e) {
    var d = e && ((e.body && e.body.detail) || e.detail || e.message);
    if (d && typeof d === "object") d = d.message || d.error || "Something went wrong - try again.";
    return d || "Something went wrong - try again.";
  }
  function detailObj(e) { var d = e && e.body && e.body.detail; return d && typeof d === "object" ? d : null; }
  function offerSt(p) {
    var o = p.offer, st = o && o.status;
    if (st === "withdrawn" || st === "expired") o = null, st = null;
    if (st === "accepted" || (p.status === "confirmed" && st !== "pending")) return "confirmed";
    if (st === "declined" || p.status === "rejected") return "declined";
    return st === "pending" ? "pending" : (p.status === "confirmed" ? "confirmed" : "none");
  }
  function pendingOffers(s) { return s.spots.some(function (p) { return offerSt(p) === "pending"; }); }
  function lineupDone(s) {
    var as = s.spots.filter(function (p) { return p.category === "act"; });
    return as.length > 0 && as.every(function (p) { return p.act_id && offerSt(p) === "confirmed"; });
  }
  function fmtMon(d) { return fmtDay(d).replace(/^\w+, /, ""); }
  function msg(el, t, ok) { if (el) { el.textContent = t || ""; el.className = "msg " + (ok ? "ok" : "error"); } }
  function initials(n) {
    var p = String(n || "?").trim().split(/\s+/);
    return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
  }
  function hue(n) { var h = 0, s = String(n || "?"); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function fmtDay(d) {
    var p = String(d).split("-"), dt = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(dt)) return String(d);
    var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()];
    return dt.toLocaleDateString("en-GB", { weekday: "short" }) + ", " + mo + " " + dt.getDate();
  }
  function fmtShort(s) { return fmtDay(s.date).replace(/^\w+, /, "") + ", " + s.time; }
  function byId(id) { for (var i = 0; i < S.shows.length; i++) if (S.shows[i].id === id) return S.shows[i]; return null; }
  function sortedSpots(s, cat) {
    return s.spots.filter(function (p) { return p.category === cat; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  /* ---------- loading ---------- */
  function fetchShows() {
    return A.get("/booker/confirmed/shows?include_past=" + (S.past ? "true" : "false")).then(function (r) { S.shows = r.shows || []; });
  }
  function load() {
    list.innerHTML = '<div class="privacy">Loading your shows…</div>';
    return Promise.all([A.get("/booker/confirmed/options"), fetchShows()]).then(function (r) {
      S.opts = r[0]; fillForm(); renderList();
    }).catch(function (e) {
      list.innerHTML = '<div class="msg error">' + E(err(e)) + ' <button type="button" class="secondary" id="cfw-retry">Retry</button></div>';
      $("cfw-retry").onclick = function () { S.loaded = false; ensure(); };
    });
  }
  function ensure() { if (!S.loaded) { S.loaded = true; load(); } }
  function reload() {
    return fetchShows().then(function () { renderList(); if (S.openId) renderModal(); });
  }
  function opt(rows, sel) {
    return rows.map(function (x) { return '<option value="' + E(x.id) + '"' + (x.id === sel ? " selected" : "") + ">" + E((x.emoji ? x.emoji + " " : "") + x.name) + "</option>"; }).join("");
  }
  function fillForm() {
    $("cf-type").innerHTML = opt(S.opts.types);
    $("cf-venue").innerHTML = '<option value="">— venue —</option>' + opt(S.opts.venues);
    $("cfw-type").innerHTML = '<option value="">All show types</option>' + opt(S.opts.types);
  }

  /* ---------- shows list ---------- */
  function avatarStrip(s) {
    return '<span class="cfw-strip" aria-hidden="true">' + s.spots.slice().sort(function (a, b) {
      var o = { host: 0, act: 1, production: 2 }; return (o[a.category] - o[b.category]) || (a.order - b.order);
    }).map(function (p) {
      return '<span class="cfw-av ' + E(p.category) + (p.act_id ? " filled" : " empty") + '"' + (p.act_id ? ' style="--h:' + hue(p.act_name) + '"' : "") + '>' + (p.act_id ? E(initials(p.act_name)) : "") + "</span>";
    }).join("") + "</span>";
  }
  function matches(s) {
    var t = $("cfw-type").value;
    if (t && s.type !== t) return false;
    var q = $("cfw-filter").value.trim().toLowerCase();
    if (!q) return true;
    var hay = [s.type_name, s.venue_name, s.venue_city, s.date, s.time, fmtDay(s.date), s.description].concat(s.spots.map(function (p) { return p.act_name; }));
    return hay.join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function rowHtml(s) {
    return '<div class="cfw-row" role="button" tabindex="0" data-id="' + E(s.id) + '">' +
      '<span class="cfw-count"><span class="cfw-sdot ' + (lineupDone(s) ? "ok" : (pendingOffers(s) ? "gold" : "")) + '" aria-hidden="true"></span>' + s.filled + "/" + s.total + "</span>" + avatarStrip(s) +
      '<span class="cfw-time">' + E(s.time) + "</span>" +
      '<span class="cfw-what">' + E((s.emoji ? s.emoji + " " : "") + s.type_name) + "</span>" +
      '<span class="cfw-where">' + E(s.venue_name || "") + "" + "</span>" +
      '<span class="cfw-right">' + '<span class="cfw-pill' + (s.public ? " live" : "") + '">' + (s.public ? "Published" : "Private") + "</span>" +
      '<span class="cfw-menu-wrap"><button type="button" class="cfw-dots" data-menu="' + E(s.id) + '" aria-label="Show actions" aria-haspopup="true">⋮</button></span></span></div>';
  }
  function group(title, shows, key) {
    var open = S.collapsed[key] !== true, last = "", html = "";
    shows.forEach(function (s) {
      if (s.date !== last) { last = s.date; html += '<div class="cfw-dayhead">' + E(fmtDay(s.date)) + "</div>"; }
      html += rowHtml(s);
    });
    return '<div class="cfw-group"><button type="button" class="cfw-grouphead" data-group="' + key + '" aria-expanded="' + open + '">' +
      '<span class="cfw-caret">' + (open ? "▾" : "▸") + "</span> " + E(title) + " (" + shows.length + ")</button>" + (open ? html : "") + "</div>";
  }
  function renderList() {
    var t = today(), vis = S.shows.filter(matches);
    var fut = vis.filter(function (s) { return s.date >= t; }), past = vis.filter(function (s) { return s.date < t; }).reverse();
    var html = "";
    if (!S.shows.length) html = '<div class="privacy">No shows yet — tap + New show.</div>';
    else {
      html = group("Future shows", fut, "future");
      if (S.past) html += group("Past shows", past, "past");
    }
    list.innerHTML = html;
  }
  function closeMenus() { var m = list.querySelector(".cfw-menu"); if (m) m.remove(); }
  function openMenu(btn) {
    var id = btn.getAttribute("data-menu"), s = byId(id); closeMenus(); if (!s) return;
    var m = document.createElement("div"); m.className = "cfw-menu"; m.setAttribute("role", "menu");
    m.innerHTML = '<button type="button" role="menuitem" data-m="open" data-id="' + E(id) + '">Open</button>' +
      '<button type="button" role="menuitem" data-m="pub" data-id="' + E(id) + '">' + (s.public ? "Unpublish" : "Publish") + "</button>";
    btn.parentNode.appendChild(m);
  }
  list.addEventListener("click", function (ev) {
    var t = ev.target, b;
    if ((b = t.closest("[data-menu]"))) { ev.stopPropagation(); openMenu(b); return; }
    if ((b = t.closest("[data-m]"))) {
      var id = b.getAttribute("data-id"); closeMenus();
      if (b.getAttribute("data-m") === "open") openShow(id); else togglePublish(id);
      return;
    }
    if ((b = t.closest("[data-group]"))) { var k = b.getAttribute("data-group"); S.collapsed[k] = S.collapsed[k] !== true; renderList(); return; }
    if ((b = t.closest(".cfw-row"))) openShow(b.getAttribute("data-id"));
  });
  list.addEventListener("keydown", function (ev) {
    var r = ev.target.classList && ev.target.classList.contains("cfw-row");
    if (r && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openShow(ev.target.getAttribute("data-id")); }
  });
  document.addEventListener("click", function (ev) { if (!ev.target.closest(".cfw-menu-wrap")) closeMenus(); });
  function togglePublish(id) {
    var s = byId(id); if (!s) return;
    A.post("/booker/confirmed/shows/" + encodeURIComponent(id) + "/publish", { public: !s.public }).then(reload)
      .catch(function (e) { list.insertAdjacentHTML("afterbegin", '<div class="msg error">' + E(err(e)) + "</div>"); });
  }

  /* ---------- toolbar + create ---------- */
  function wireToolbar() {
    $("cfw-filter").addEventListener("input", renderList);
    $("cfw-type").addEventListener("change", renderList);
    $("cfw-past").addEventListener("click", function () {
      S.past = !S.past; this.classList.toggle("on", S.past); this.setAttribute("aria-pressed", S.past);
      fetchShows().then(renderList).catch(function (e) { list.innerHTML = '<div class="msg error">' + E(err(e)) + "</div>"; });
    });
    $("cfw-new").addEventListener("click", function () { var p = $("cfw-create"); p.hidden = !p.hidden; });
    $("cf-create").addEventListener("click", createShow);
  }
  function createShow() {
    var m = $("cf-new-msg"), d = $("cf-date").value;
    if (!d) { msg(m, "Pick a date first."); return; }
    var body = { date: d, time: $("cf-time").value || "20:00", type: $("cf-type").value,
      hosts: parseInt($("cf-hosts").value, 10) || 0, acts: parseInt($("cf-acts").value, 10) || 1 };
    if ($("cf-venue").value) body.venue_id = $("cf-venue").value;
    if ($("cf-desc").value.trim()) body.description = $("cf-desc").value.trim();
    msg(m, "Creating…", true);
    A.post("/booker/confirmed/shows", body).then(function (r) {
      msg(m, ""); $("cfw-create").hidden = true;
      var id = r.created && r.created[0];
      return reload().then(function () { if (id) openShow(id); });
    }).catch(function (e) { msg(m, err(e)); });
  }

  /* ---------- modal ---------- */
  function buildModal() {
    modal = document.createElement("div"); modal.id = "cfw-modal"; modal.hidden = true;
    modal.innerHTML = '<div class="cfw-panel" role="dialog" aria-modal="true" aria-label="Show card" tabindex="-1"></div>';
    document.body.appendChild(modal);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) closeModal(); });
    modal.addEventListener("click", onModalClick);
    modal.addEventListener("input", onModalInput);
    modal.addEventListener("dragstart", onDragStart); modal.addEventListener("dragover", onDragOver);
    modal.addEventListener("drop", onDrop);
    document.addEventListener("keydown", function (ev) {
      if (modal.hidden) return;
      if (ev.key === "Escape") { if (S.panel) { S.panel = null; renderModal(); } else closeModal(); }
      if (ev.key === "Tab") trapFocus(ev);
    });
  }
  function trapFocus(ev) {
    var f = modal.querySelectorAll("button,input,select,textarea,a[href],[tabindex='0']");
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  function openShow(id) {
    if (!byId(id)) return;
    S.openId = id; S.tab = "spots"; S.target = null; S.q = ""; S.dirQ = ""; S.dir = []; S.panel = null; S.note = null; S.avail = null;
    S.lastFocus = document.activeElement;
    modal.hidden = false; document.body.classList.add("cfw-lock"); renderModal();
    modal.querySelector(".cfw-panel").focus(); loadAvail();
  }
  function closeModal() {
    modal.hidden = true; S.openId = null; document.body.classList.remove("cfw-lock");
    if (S.lastFocus && S.lastFocus.focus) S.lastFocus.focus();
  }
  function renderModal() {
    var s = byId(S.openId), panel = modal.querySelector(".cfw-panel"), keep = document.activeElement && document.activeElement.id;
    if (!s) { closeModal(); return; }
    var tabs = ["spots", "show", "tickets", "meta"].map(function (t) {
      return '<button type="button" class="cfw-tab' + (S.tab === t ? " active" : "") + '" data-tab="' + t + '">' + (t.charAt(0).toUpperCase() + t.slice(1)) + "</button>";
    }).join("");
    panel.innerHTML = '<div class="cfw-mhead"><h3>' + E((s.emoji ? s.emoji + " " : "") + s.type_name + " · " + fmtShort(s)) + (s.venue_name ? ' <small class="cfw-muted">' + E(s.venue_name) + "</small>" : "") + "</h3>" +
      '<span class="cfw-pill' + (s.public ? " live" : "") + '">' + (s.public ? "Published" : "Private") + "</span>" +
      '<button type="button" class="secondary cfw-x" data-do="close" aria-label="Close">✕</button></div>' +
      '<div class="cfw-tabrow"><div class="cfw-tabs" role="tablist">' + tabs + "</div>" +
      '<a class="cfw-morelink" href="https://confirmed.show" rel="noopener" target="_blank">More in confirmed ↗</a></div>' +
      '<div class="cfw-body">' + tabBody(s) + "</div>" +
      '<div class="cfw-mfoot">Show programming ' + CREDIT.replace("Powered by", "powered by") + "</div>";
    if (S.tab === "spots") renderActs();
    if (keep && $(keep)) $(keep).focus();
  }
  function tabBody(s) {
    return { spots: spotsTab, show: showTab, tickets: ticketsTab, meta: metaTab }[S.tab](s);
  }

  /* ---------- spots tab ---------- */
  function statusChip(st) {
    var c = { confirmed: "ok", offered: "gold", planning: "", rejected: "bad", cancelled: "bad", "no-show": "bad", no_show: "bad" }[st];
    return st ? '<span class="cfw-chip ' + (c || "") + '">' + E(st) + "</span>" : "";
  }
  function shareBtn(path) {
    return path ? '<button type="button" class="cfw-link" data-do="share" data-path="' + E(path) + '" aria-label="Copy share link">Share link</button>' : "";
  }
  function bookingBits(p) {
    var st = offerSt(p);
    if (st === "pending") return '<span class="cfw-chip offered">Offered</span>';
    if (st === "confirmed") return '<span class="cfw-chip confirmed">Confirmed</span>';
    if (st === "declined") return '<span class="cfw-chip declined">Declined</span>';
    return "";
  }
  function menuItems(p) {
    var st = offerSt(p), sid = E(p.id), nm = E(p.act_name), h = "";
    function b(d, t, x) { return '<button type="button" role="menuitem" data-do="' + d + '" data-spot="' + sid + '"' + (x || "") + ">" + t + "</button>"; }
    if (p.act_id) {
      if (st === "none") h += p.person_id ? b("offer", "<b>Offer this spot</b>", ' aria-label="Offer this spot to ' + nm + '"')
        : '<a role="menuitem" href="https://confirmed.show" rel="noopener" target="_blank">offer in confirmed ↗</a>';
      if (st === "pending" && p.offer && p.offer.share_url_path)
        h += '<button type="button" role="menuitem" data-do="share" data-path="' + E(p.offer.share_url_path) + '">Share offer link</button>';
      if (st === "pending") h += b("withdraw", "Withdraw offer", ' aria-label="Withdraw the offer to ' + E((p.offer && p.offer.stage_name) || p.act_name) + '"');
    }
    h += b("up", "Move up") + b("down", "Move down") + b("len", "Set length…") + b("role", "Set role…");
    if (p.act_id) h += b("unfill", "Unfill", ' aria-label="Remove ' + nm + '"');
    return h;
  }
  function panelHtml(sp) {
    var P = S.panel, s = byId(S.openId);
    if (!P || P.spot !== sp || !s) return "";
    if (P.kind === "link") {
      var sg = P.sugg || [], sel = sg.filter(function (x) { return x.match; });
      sg = sg.slice().sort(function (a, b) { return (b.match ? 1 : 0) - (a.match ? 1 : 0); });
      var opts = sg.map(function (x, i) {
        return '<option value="' + E(x.show_series_id) + '"' + (sel.length === 1 && x.match && i === 0 ? " selected" : "") + ">" + E(x.name) + (x.match ? " (name match)" : "") + "</option>";
      }).join("");
      return '<div class="cfw-ipanel" role="group" aria-label="Link this night to your Atlas show"><b>Link this night to your Atlas show</b>' +
        (P.loading ? '<div class="privacy">Loading your Atlas shows…</div>' :
          (sg.length ? '<select id="cfw-link-sel" aria-label="Atlas show">' + (sel.length === 1 ? "" : '<option value="">— choose —</option>') + opts + "</select>"
            : '<div class="privacy">No Atlas shows found on your account.</div>')) +
        '<div class="cfw-iacts"><button type="button" data-do="link-save"' + (sg.length ? "" : " disabled") + '>Link</button> <button type="button" class="secondary" data-do="panel-x">Cancel</button></div>' +
        '<div class="msg' + (P.err ? " error" : "") + '" id="cfw-pmsg">' + E(P.err || "") + "</div></div>";
    }
    var sp2 = findSpot(s, sp), nm = sp2 && sp2.act_name;
    return '<div class="cfw-ipanel" role="group" aria-label="Send offer"><b>Send an offer to ' + E(nm) + "?</b>" +
      '<div class="privacy">Send an offer to ' + E(nm) + " for " + E(sp2 && (sp2.role || CAT[sp2.category][1])) + " on " + E(fmtMon(s.date) + " " + s.time) +
      "? They'll get it through Comedy Atlas — their contact stays private.</div>" +
      '<label for="cfw-offer-msg">Message (optional)</label><textarea id="cfw-offer-msg" rows="2" maxlength="500" placeholder="Add a note (max 500 characters)"></textarea>' +
      '<div class="cfw-iacts"><button type="button" data-do="offer-send"' + (P.busy ? " disabled" : "") + '>Send offer</button> <button type="button" class="secondary" data-do="panel-x">Cancel</button></div>' +
      '<div class="msg' + (P.err ? " error" : "") + '" id="cfw-pmsg">' + E(P.err || "") + "</div></div>";
  }
  function noteHtml() {
    var n = S.note; if (!n) return "";
    return '<div class="msg ok cfw-note" id="cfw-note">' + E(n.text) + (n.path ? " " + shareBtn(n.path) : "") + "</div>";
  }
  function spotRow(s, p, i, n) {
    var label = p.role || CAT[p.category][1], tgt = S.target === p.id;
    var len = (p.spot_length || p.category === "act") ? E(p.spot_length || 10) : "—";
    var slot = p.act_id
      ? '<span class="cfw-av filled ' + E(p.category) + '" style="--h:' + hue(p.act_name) + '">' + E(initials(p.act_name)) + '</span><span class="cfw-actname">' + E(p.act_name) + "</span>" + bookingBits(p)
      : '<span class="cfw-av empty ' + E(p.category) + '"></span><button type="button" class="cfw-link" data-do="target" data-spot="' + E(p.id) + '">Fill Spot</button>';
    return '<div class="cfw-spot' + (tgt ? " is-target" : "") + '" draggable="' + (S.panel && S.panel.spot === p.id ? "false" : "true") + '" data-spot="' + E(p.id) + '" data-cat="' + E(p.category) + '">' +
      '<span class="cfw-handle" aria-hidden="true">⠿</span>' +
      '<span class="cfw-len" title="Spot length (minutes)">' + len + "</span>" +
      '<span class="cfw-role">' + E(label) + "</span>" +
      '<span class="cfw-slot">' + slot + "</span>" +
      '<span class="cfw-smwrap"><button type="button" class="cfw-dots" data-do="smenu" data-spot="' + E(p.id) + '" aria-label="Spot actions" aria-haspopup="true">⋮</button></span>' +
      panelHtml(p.id) + "</div>";
  }
  function spotsTab(s) {
    var secs = Object.keys(CAT).map(function (c) {
      var ps = sortedSpots(s, c); if (!ps.length) return "";
      var open = S.collapsed["sec" + c] !== true;
      return '<div class="cfw-sec"><button type="button" class="cfw-sechead" data-do="sec" data-cat="' + c + '" aria-expanded="' + open + '">' +
        '<span class="cfw-caret">' + (open ? "▾" : "▸") + "</span> " + CAT[c][0] + "</button>" +
        (open ? ps.map(function (p, i) { return spotRow(s, p, i, ps.length); }).join("") : "") + "</div>";
    }).join("");
    return '<div class="cfw-cols"><div class="cfw-left">' + noteHtml() + secs +
      '<div class="cfw-foot"><a class="cfw-addspot" href="https://confirmed.show" rel="noopener" target="_blank" title="Spot count is set when you create a show">Add Spot…</a><button type="button" class="secondary" data-do="close">Close</button></div><div class="msg" id="cfw-smsg"></div></div>' +
      '<div class="cfw-rcol" id="cfw-right"></div></div>';
  }
  function targetLabel(s) {
    for (var i = 0; i < s.spots.length; i++) if (s.spots[i].id === S.target) return s.spots[i].role || CAT[s.spots[i].category][1];
    return null;
  }
  function bookedCount(a) {
    return S.shows.filter(function (s) { return s.spots.some(function (p) { return p.act_id === a.id; }); }).length;
  }
  function actRow(a, kind, extra) {
    var n = kind === "mine" ? bookedCount(a) : 0;
    var sub = kind === "mine" ? (n ? "Booked on " + n + " of your shows" : "No prior bookings") : "Comedy Atlas directory";
    var good = kind === "mine" && n > 0;
    var av = extra && extra.photo_url ? '<img class="cfw-photo" alt="" loading="lazy" src="' + E(extra.photo_url) + '">' : '<span class="cfw-av filled act" style="--h:' + hue(a.name) + '">' + E(initials(a.name)) + "</span>";
    return '<button type="button" class="cfw-act" data-do="pick" data-kind="' + kind + '" data-id="' + E(a.id) + '" data-name="' + E(a.name) + '">' + av +
      '<span class="cfw-actinfo"><b>' + E(a.name) + "</b><small" + (good ? ' class="ok"' : "") + ">" + E(sub) + "</small></span>" + (kind === "dir" ? '<span class="cfw-atlas">Atlas</span>' : "") + "</button>";
  }
  function mineActs() {
    var q = S.q.toLowerCase(), rows = (S.opts.acts || []).filter(function (a) { return !q || String(a.name).toLowerCase().indexOf(q) >= 0; });
    rows = rows.slice().sort(function (a, b) {
      return S.sort === "booked" ? (bookedCount(b) - bookedCount(a)) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name);
    });
    return rows;
  }
  function availHtml() {
    if (S.avail === null) return '<div class="privacy">Loading…</div>';
    if (!S.avail.length) return "";
    return '<div class="cfw-acts cfw-avail">' + S.avail.map(function (c) {
      var av = c.photo_url ? '<img class="cfw-photo" alt="" loading="lazy" src="' + E(c.photo_url) + '">' : '<span class="cfw-av filled act" style="--h:' + hue(c.stage_name) + '">' + E(initials(c.stage_name)) + "</span>";
      return '<button type="button" class="cfw-act" data-do="pick" data-kind="dir" data-id="' + E(c.person_id) + '" data-name="' + E(c.stage_name) + '">' + av +
        '<span class="cfw-actinfo"><b>' + E(c.stage_name) + "</b>" + (c.availability_note ? "<small>" + E(c.availability_note) + "</small>" : "") + "</span>" +
        (c.can_travel ? '<span class="cfw-tag">can travel</span>' : "") + '<span class="cfw-atlas">Atlas</span></button>';
    }).join("") + "</div>";
  }
  function loadAvail() {
    var s = byId(S.openId), id = S.openId; if (!s) return;
    A.get("/booker/comics/search?available_date=" + encodeURIComponent(s.date)).then(function (r) {
      if (S.openId !== id) return;
      S.avail = Array.isArray(r) ? r.slice(0, 20) : []; renderActs();
    }).catch(function () { if (S.openId === id) { S.avail = []; renderActs(); } });
  }
  function renderActs() {
    var s = byId(S.openId), box = $("cfw-right"); if (!s || !box) return;
    var tl = targetLabel(s), mine = mineActs();
    var names = {}; (S.opts.acts || []).forEach(function (a) { names[String(a.name).toLowerCase()] = true; });
    var dirRows = (S.dir || []).filter(function (c) { return !names[String(c.stage_name).toLowerCase()]; });
    var ds = fmtMon(s.date), na = S.avail ? S.avail.length : 0;
    box.innerHTML = '<div class="cfw-search"><input id="cfw-act-q" type="search" placeholder="Search by name" autocomplete="off" value="' + E(S.q) + '">' +
      '<button type="button" class="secondary cfw-sort" data-do="sort" title="Sort" aria-label="Sort acts">' + (S.sort === "az" ? "A-Z" : "Most booked") + "</button></div>" +
      (tl ? '<div class="cfw-pickfor">Pick an act for: ' + E(tl) + "</div>" : "") +
      '<h4 class="cfw-rh">Available on ' + E(ds) + (S.avail === null ? "" : " (" + na + ")") + (S.avail !== null && !na ? ' <span class="cfw-rhnote">— No one has marked this date yet</span>' : "") + "</h4>" +
      (S.avail !== null && !na ? "" : availHtml()) + (na ? availHtml() : "") +
      '<h4 class="cfw-rh">All acts (' + mine.length + ")</h4>" +
      '<div class="cfw-acts">' + (mine.map(function (a) { return actRow(a, "mine"); }).join("") || '<div class="privacy">No acts match.</div>') + "</div>" +
      (S.q.trim().length >= 2 ? '<h4 class="cfw-rh">Comedy Atlas directory</h4><div class="cfw-acts" id="cfw-dir">' +
        (dirRows.map(function (c) { return actRow({ id: c.person_id, name: c.stage_name }, "dir", c); }).join("") || '<div class="privacy">No other matches.</div>') + "</div>" : "");
  }
  function onModalInput(ev) {
    if (ev.target.id !== "cfw-act-q") return;
    S.q = ev.target.value; var pos = ev.target.selectionStart; renderActs();
    var i = $("cfw-act-q"); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {}
    clearTimeout(timer);
    var q = S.q.trim();
    if (q.length < 2) { S.dir = []; return; }
    timer = setTimeout(function () {
      A.get("/booker/comics/search?q=" + encodeURIComponent(q)).then(function (r) {
        if (S.q.trim() !== q) return;
        S.dir = Array.isArray(r) ? r.slice(0, 12) : [];
        var inp = $("cfw-act-q"), p = inp ? inp.selectionStart : 0; renderActs();
        if (inp) { $("cfw-act-q").focus(); try { $("cfw-act-q").setSelectionRange(p, p); } catch (e) {} }
      }).catch(function (e) { msg($("cfw-smsg"), err(e)); });
    }, 300);
  }

  /* ---------- spot actions ---------- */
  function spotUrl(sid) { return "/booker/confirmed/shows/" + encodeURIComponent(S.openId) + "/spots" + (sid ? "/" + encodeURIComponent(sid) : ""); }
  function act(p, okText) {
    return p.then(reload).then(function () { if (okText) msg($("cfw-smsg"), okText, true); })
      .catch(function (e) { msg($("cfw-smsg"), err(e)); });
  }
  function findSpot(s, sid) { for (var i = 0; i < s.spots.length; i++) if (s.spots[i].id === sid) return s.spots[i]; return null; }
  function autoTarget(s) {
    var ord = function (c) { return sortedSpots(s, c).filter(function (p) { return !p.act_id; })[0]; };
    var p = ord("act") || ord("host") || ord("production"); return p ? p.id : null;
  }
  function fillWith(actId, extraMsg) {
    act(A.put(spotUrl(S.target), { act_id: actId }), extraMsg).then(function () { S.target = null; renderModal(); });
  }
  function pick(btn) {
    var s = byId(S.openId), kind = btn.getAttribute("data-kind"), id = btn.getAttribute("data-id"), name = btn.getAttribute("data-name");
    if (!S.target) S.target = autoTarget(s);
    if (!S.target) { msg($("cfw-smsg"), "All spots are filled — unfill one first."); return; }
    if (kind === "mine") { fillWith(id); return; }
    var known = (S.opts.acts || []).filter(function (a) { return String(a.name).toLowerCase() === String(name).toLowerCase(); })[0];
    if (known && kind === "dir") { fillWith(known.id); return; }
    A.post("/booker/confirmed/acts", { name: name, person_id: /^\d+$/.test(id) ? parseInt(id, 10) : id }).then(function (a) {
      S.opts.acts = (S.opts.acts || []).concat([{ id: a.id, name: a.name || name, instagram: a.instagram }]);
      fillWith(a.id, "Added " + name + " to your acts — nobody was contacted.");
    }).catch(function (e) { msg($("cfw-smsg"), err(e)); });
  }
  function move(sid, dir) {
    var s = byId(S.openId), p = findSpot(s, sid); if (!p) return;
    var ps = sortedSpots(s, p.category), i = ps.indexOf(p), j = i + dir;
    if (j < 0 || j >= ps.length) return;
    ps.splice(i, 1); ps.splice(j, 0, p); saveOrder(ps);
  }
  function saveOrder(ps) {
    var u = {}; ps.forEach(function (p, i) { u[p.id] = { order: i + 1 }; });
    act(A.put(spotUrl(), { updates: u }));
  }
  function promptSet(sid, field) {
    var p = findSpot(byId(S.openId), sid), body = {};
    if (field === "len") {
      var v = window.prompt("Spot length in minutes (1-180)", p.spot_length || 10); if (v === null) return;
      v = parseInt(v, 10); if (!(v >= 1 && v <= 180)) { msg($("cfw-smsg"), "Enter a number between 1 and 180."); return; }
      body.spot_length = v;
    } else {
      var r = window.prompt("Role label", p.role || CAT[p.category][1]); if (r === null || !r.trim()) return;
      body.role = r.trim();
    }
    act(A.put(spotUrl(sid), body));
  }
  function openLink(sp, then) {
    S.panel = { kind: "link", spot: sp, then: then || null, sugg: [], loading: true }; S.note = null; renderModal();
    var id = S.openId;
    A.get("/booker/confirmed/shows/" + encodeURIComponent(id) + "/link").then(function (r) {
      if (!S.panel || S.openId !== id || S.panel.kind !== "link") return;
      S.panel.loading = false; S.panel.sugg = (r && r.suggestions) || []; renderModal(); focusPanel();
    }).catch(function (e) { if (S.panel) { S.panel.loading = false; S.panel.err = err(e); renderModal(); } });
  }
  function focusPanel() {
    setTimeout(function () { var f = modal.querySelector(".cfw-ipanel select, .cfw-ipanel textarea, .cfw-ipanel button"); if (f) f.focus(); }, 0);
  }
  function offerStart(sid) {
    var s = byId(S.openId); S.note = null;
    if (!s.link) { openLink(sid, "offer"); return; }
    S.panel = { kind: "offer", spot: sid }; renderModal(); focusPanel();
  }
  function linkSave() {
    var sel = $("cfw-link-sel"), P = S.panel; if (!sel || !sel.value) { if (P) { P.err = "Choose an Atlas show first."; renderModal(); } return; }
    var id = S.openId, then = P.then, sp = P.spot;
    A.put("/booker/confirmed/shows/" + encodeURIComponent(id) + "/link", { show_series_id: /^\d+$/.test(sel.value) ? parseInt(sel.value, 10) : sel.value })
      .then(fetchShows).then(function () {
        renderList(); S.panel = null;
        if (then === "offer" && sp !== "show") { S.panel = { kind: "offer", spot: sp }; }
        else S.note = { text: "Linked to your Atlas show." };
        renderModal(); if (S.panel) focusPanel();
      }).catch(function (e) { if (S.panel) { S.panel.err = err(e); renderModal(); } });
  }
  function offerSend() {
    var P = S.panel, sid = P.spot, s = byId(S.openId), p = findSpot(s, sid), ta = $("cfw-offer-msg");
    var body = { person_id: p.person_id }, m = ta ? ta.value.trim().slice(0, 500) : "";
    if (m) body.message = m;
    P.busy = true; P.err = null;
    A.post(spotUrl(sid) + "/offer", body).then(function (r) {
      var held = r && r.delivery && r.delivery.state === "held";
      S.panel = null;
      S.note = held ? { text: "Offer created — this comic hasn't opted in to email, so send them the link yourself:", path: r.share_url_path }
                    : { text: "Offer sent to " + p.act_name + ".", path: null };
      return reload();
    }).catch(function (e) {
      var d = detailObj(e);
      if (d && d.error === "link_required") {
        S.panel = { kind: "link", spot: sid, then: "offer", sugg: d.suggestions || [] }; renderModal(); focusPanel(); return;
      }
      if (S.panel) { S.panel.busy = false; S.panel.err = err(e); renderModal(); }
    });
  }
  function withdraw(sid) {
    var p = findSpot(byId(S.openId), sid), nm = (p.offer && p.offer.stage_name) || p.act_name;
    if (!window.confirm("Withdraw the offer to " + nm + "?")) return;
    S.note = null;
    act(A.del(spotUrl(sid) + "/offer"), "Offer withdrawn.");
  }
  function share(path) {
    var url = location.origin + path;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { msg($("cfw-smsg"), "Share link copied.", true); })
        .catch(function () { window.prompt("Copy this link", url); });
    } else window.prompt("Copy this link", url);
  }
  var drag = null;
  function onDragStart(ev) { var r = ev.target.closest && ev.target.closest(".cfw-spot"); if (!r) return; drag = r; try { ev.dataTransfer.setData("text/plain", r.getAttribute("data-spot")); ev.dataTransfer.effectAllowed = "move"; } catch (e) {} }
  function onDragOver(ev) { var r = ev.target.closest && ev.target.closest(".cfw-spot"); if (drag && r && r.getAttribute("data-cat") === drag.getAttribute("data-cat")) ev.preventDefault(); }
  function onDrop(ev) {
    var r = ev.target.closest && ev.target.closest(".cfw-spot");
    if (!drag || !r || r === drag || r.getAttribute("data-cat") !== drag.getAttribute("data-cat")) { drag = null; return; }
    ev.preventDefault();
    var s = byId(S.openId), cat = drag.getAttribute("data-cat"), ps = sortedSpots(s, cat);
    var a = findSpot(s, drag.getAttribute("data-spot")), b = findSpot(s, r.getAttribute("data-spot"));
    ps.splice(ps.indexOf(a), 1); ps.splice(ps.indexOf(b), 0, a); drag = null; saveOrder(ps);
  }

  /* ---------- other tabs ---------- */
  function field(id, label, val, type) {
    return '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || "text") + '" value="' + E(val || "") + '">';
  }
  function showTab(s) {
    var lk = s.link, lkh = lk
      ? '<span>Atlas show: <b>' + E(lk.series_name) + "</b>" + (lk.event_id ? " · event #" + E(lk.event_id) : "") + '</span> <button type="button" class="cfw-link" data-do="link-open" data-spot="show" aria-label="Change linked Atlas show">change</button>'
      : '<span class="cfw-muted">Not linked to an Atlas show yet — link it to send offers</span> <button type="button" class="cfw-link" data-do="link-open" data-spot="show" aria-label="Link to an Atlas show">link</button>';
    return '<div class="cfw-linkrow">' + lkh + "</div>" + panelHtml("show") + '<div class="row"><div>' + field("cfw-f-date", "Date", s.date, "date") + "</div><div>" + field("cfw-f-time", "Start", s.time, "time") + "</div></div>" +
      '<label for="cfw-f-venue">Venue</label><select id="cfw-f-venue"><option value="">— venue —</option>' + opt(S.opts.venues, s.venue_id) + "</select>" +
      '<label for="cfw-f-desc">Description</label><textarea id="cfw-f-desc" rows="3">' + E(s.description || "") + "</textarea>" +
      '<button type="button" data-do="save-show">Save</button> <button type="button" class="secondary" data-do="publish">' + (s.public ? "Unpublish" : "Publish") + "</button>" +
      '<div class="msg" id="cfw-smsg"></div><p class="privacy">Comics are never contacted from here — selecting a name only places it in your lineup.</p>';
  }
  function ticketsTab(s) {
    var m = s.meta || {};
    return field("cfw-f-tix", "Tickets URL", m.tickets_url, "url") + field("cfw-f-evt", "Event page URL", m.event_url, "url") +
      '<button type="button" data-do="save-meta">Save</button><div class="msg" id="cfw-smsg"></div>';
  }
  function metaTab(s) {
    var m = s.meta || {};
    return field("cfw-f-img", "Promo image (URL)", m.promo_image, "url") +
      '<label for="cfw-f-blurb">Promo blurb</label><textarea id="cfw-f-blurb" rows="4">' + E(m.promo_blurb || "") + "</textarea>" +
      '<button type="button" data-do="save-meta">Save</button><div class="msg" id="cfw-smsg"></div>';
  }
  function v(id) { var e = $(id); return e ? e.value.trim() : undefined; }
  function saveMeta() {
    var s = byId(S.openId), m = Object.assign({}, s.meta || {});
    [["cfw-f-tix", "tickets_url"], ["cfw-f-evt", "event_url"], ["cfw-f-img", "promo_image"], ["cfw-f-blurb", "promo_blurb"]].forEach(function (k) {
      var x = v(k[0]); if (x !== undefined) m[k[1]] = x;
    });
    act(A.put("/booker/confirmed/shows/" + encodeURIComponent(S.openId), { meta: m }), "Saved.");
  }
  function saveShow() {
    var b = { date: v("cfw-f-date"), time: v("cfw-f-time"), description: v("cfw-f-desc") };
    if ($("cfw-f-venue").value) b.venue_id = $("cfw-f-venue").value;
    act(A.put("/booker/confirmed/shows/" + encodeURIComponent(S.openId), b), "Saved.");
  }

  /* ---------- modal click router ---------- */
  function onModalClick(ev) {
    var om = modal.querySelector(".cfw-smenu"); if (om) om.remove();
    var t = ev.target.closest("[data-tab],[data-do]"); if (!t) return;
    var d = t.getAttribute("data-do"), sid = t.getAttribute("data-spot");
    if (t.hasAttribute("data-tab") && !d) { S.tab = t.getAttribute("data-tab"); renderModal(); return; }
    var h = {
      close: closeModal,
      smenu: function () {
        var s = byId(S.openId), p = findSpot(s, sid), m = document.createElement("div");
        if (!p || (om && om.getAttribute("data-spot") === sid)) return;
        m.className = "cfw-smenu"; m.setAttribute("role", "menu"); m.setAttribute("data-spot", sid); m.innerHTML = menuItems(p);
        t.parentNode.appendChild(m);
      },
      sec: function () { var k = "sec" + t.getAttribute("data-cat"); S.collapsed[k] = S.collapsed[k] !== true; renderModal(); },
      target: function () { S.target = sid; renderModal(); },
      offer: function () { offerStart(sid); }, "offer-send": offerSend, withdraw: function () { withdraw(sid); },
      share: function () { share(t.getAttribute("data-path")); },
      "link-open": function () { openLink("show", null); }, "link-save": linkSave,
      "panel-x": function () { S.panel = null; renderModal(); },
      unfill: function () { act(A.put(spotUrl(sid), { unfill: true })); },
      up: function () { move(sid, -1); }, down: function () { move(sid, 1); },
      len: function () { promptSet(sid, "len"); }, role: function () { promptSet(sid, "role"); },
      sort: function () { S.sort = S.sort === "az" ? "booked" : "az"; renderActs(); },
      pick: function () { pick(t); },
      "save-show": saveShow, "save-meta": saveMeta, publish: function () { togglePublish(S.openId); }
    }[d];
    if (h) h();
  }

  wireToolbar(); buildModal();
  ensure();
})();
