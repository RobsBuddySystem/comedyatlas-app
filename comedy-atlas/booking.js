/* booking.js -- full-screen booking app (confirmed.show structure, Comedy Atlas graphics).
   Talks ONLY to our own proxy API (session cookie) via window.AtlasAuth:
   GET  /booker/confirmed/options | summary | status | shows?include_past | surveys | offers | venues | acts?q=
   POST /booker/confirmed/shows ; PUT /shows/{id} ; POST /shows/{id}/publish
   PUT  /shows/{id}/spots[/{sid}] ; POST/DELETE /shows/{id}/spots/{sid}/offer ; GET/PUT /shows/{id}/link
   GET/PUT /shows/{id}/notes ; GET/POST/PUT/DELETE /shows/{id}/checklists[/{item}] ; GET /shows/{id}/changes
   POST/PUT /venues ; POST /acts {name[,instagram|person_id|invite]} ; GET /shows/{id}/spots/{sid}/offer/share
   GET  /booker/comics/search?available_date= | ?q=
   Every API string is escaped with E(). No contact data is ever handled. */
(function () {
  "use strict";
  var A = window.AtlasAuth;
  if (!A) return;
  var E = A.escapeHtml, P = "/booker/confirmed";
  var S = { opts: null, sum: null, status: null, shows: [], pastShows: null, page: "shows", typeId: "", view: "list",
    q: "", sel: {}, collapsed: { past: true }, openId: null, tab: "spots", target: null, sort: "az", aq: "", dirQ: "", dir: [],
    avail: null, panel: null, note: null, lastFocus: null, cal: null, day: null, secs: {}, tabData: {}, user: "" };
  var CREDIT = '<a class="confirmed-credit" href="https://confirmed.show" rel="noopener" target="_blank"><span class="confirmed-credit-logo" aria-hidden="true"></span>Powered by confirmed.show</a>';
  var CAT = { host: ["Hosts", "Host", 10], act: ["Acts", "Act", 10], production: ["Production", "Production", 75] };
  var NAV = [["shows", "Shows", "▦"], ["surveys", "Surveys", "✉"], ["offers", "Offers", "✔"], ["settlements", "Settlements", "€"],
    ["venues", "Venues", "⌂"], ["acts", "Acts & Contacts", "☺"], ["festivals", "Festivals", "★"], ["settings", "Settings", "⚙"]];
  var SUBS = [["production", "Production"], ["team", "Team"], ["data", "Data & API"], ["subscription", "Subscription"]];
  var main = null, modal = null, drawer = null, timer = null, drag = null, settingsOpen = false, subPage = "production";
  function $(id) { return document.getElementById(id); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function err(e) {
    var d = e && ((e.body && e.body.detail) || e.detail || e.message);
    if (d && typeof d === "object") d = d.message || d.error || "Something went wrong - try again.";
    return d || "Something went wrong - try again.";
  }
  function detailObj(e) { var d = e && e.body && e.body.detail; return d && typeof d === "object" ? d : null; }
  function msg(el, t, ok) { if (el) { el.textContent = t || ""; el.className = "msg " + (ok ? "ok" : "error"); } }
  function smsg(t, ok) { msg($("bk-smsg"), t, ok); }
  function initials(n) {
    var p = String(n || "?").trim().split(/\s+/);
    return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
  }
  function hue(n) { var h = 0, s = String(n || "?"); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pd(d) { var p = String(d).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtDay(d) {
    var dt = pd(d); if (isNaN(dt)) return String(d);
    return dt.toLocaleDateString("en-GB", { weekday: "short" }) + ", " + MON[dt.getMonth()] + " " + dt.getDate();
  }
  function fmtMon(d) { return fmtDay(d).replace(/^\w+, /, ""); }
  function fmtShort(s) { return fmtMon(s.date) + ", " + s.time; }
  function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function today() { return ymd(new Date()); }
  function allShows() { return S.shows.concat((S.pastShows || []).filter(function (p) { return !byIdIn(S.shows, p.id); })); }
  function byIdIn(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  function byId(id) { return byIdIn(allShows(), id); }
  function sortedSpots(s, cat) {
    return s.spots.filter(function (p) { return p.category === cat; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  function findSpot(s, sid) { for (var i = 0; i < s.spots.length; i++) if (s.spots[i].id === sid) return s.spots[i]; return null; }
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
  function actFilled(s) { return s.spots.filter(function (p) { return p.category === "act" && p.act_id; }).length; }
  function actTotal(s) { return s.spots.filter(function (p) { return p.category === "act"; }).length; }
  function opt(rows, sel) {
    return (rows || []).map(function (x) { return '<option value="' + E(x.id) + '"' + (String(x.id) === String(sel) ? " selected" : "") + ">" + E((x.emoji ? x.emoji + " " : "") + x.name) + "</option>"; }).join("");
  }
  function field(id, label, val, type, ph) {
    return '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || "text") + '" value="' + E(val || "") + '"' + (ph ? ' placeholder="' + E(ph) + '"' : "") + ">";
  }
  function v(id) { var e = $(id); return e ? e.value.trim() : undefined; }
  function csv(rows) {
    return rows.map(function (r) { return r.map(function (c) { var t = String(c == null ? "" : c); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(","); }).join("\n");
  }
  function download(name, text) {
    var a = document.createElement("a"), u = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 500);
  }
  function link(path) { return location.origin + path; }

  /* ---------- loading ---------- */
  function fetchShows() { return A.get(P + "/shows?include_past=false").then(function (r) { S.shows = r.shows || []; }); }
  function fetchPast() { return A.get(P + "/shows?include_past=true").then(function (r) { S.pastShows = (r.shows || []).filter(function (s) { return s.date < today(); }); }); }
  function fetchSummary() { return A.get(P + "/summary").then(function (r) { S.sum = r; renderSide(); }).catch(function () { S.sum = S.sum || {}; renderSide(); }); }
  function boot() {
    main.innerHTML = '<div class="bk-muted">Loading your shows…</div>';
    return Promise.all([A.get(P + "/options"), fetchShows(), fetchSummary()]).then(function (r) {
      S.opts = r[0]; route();
    }).catch(function (e) {
      main.innerHTML = '<div class="msg error">' + E(err(e)) + ' <button type="button" class="secondary" id="bk-retry">Retry</button></div>';
      $("bk-retry").onclick = boot;
    });
  }
  function reload() {
    var ps = S.pastShows ? fetchPast() : Promise.resolve();
    return Promise.all([fetchShows(), ps, fetchSummary()]).then(function () {
      if (S.page === "shows") renderShows(); if (S.openId) renderModal();
    });
  }

  /* ---------- routing ---------- */
  function route() {
    var h = (location.hash || "#shows").replace(/^#/, "").split("/"), p = h[0] || "shows";
    if (p === "show" && h[1]) {
      if (!S.opts) return;
      if (S.page && !$("bk-main").innerHTML) renderPage();
      openShow(decodeURIComponent(h[1])); return;
    }
    if (S.openId) hideModal();
    var valid = NAV.map(function (n) { return n[0]; });
    S.page = valid.indexOf(p) >= 0 ? p : "shows";
    if (S.page === "shows") S.typeId = h[1] ? decodeURIComponent(h[1]) : "";
    if (S.page === "settings" && h[1]) subPage = h[1];
    document.getElementById("bk-app").classList.remove("open");
    renderSide(); renderPage();
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function renderPage() {
    var f = { shows: renderShows, surveys: pageSurveys, offers: pageOffers, settlements: pageSettlements, venues: pageVenues,
      acts: pageActs, festivals: pageFestivals, settings: pageSettings }[S.page] || renderShows;
    f();
  }

  /* ---------- sidebar ---------- */
  function renderSide() {
    if (!S.opts && !S.sum) return;
    var offers = S.sum && S.sum.offers_pending;
    $("bk-nav").innerHTML = NAV.map(function (n) {
      var on = S.page === n[0], h = '<button type="button" class="bk-navitem' + (on ? " active" : "") + '" data-go="' + n[0] + '"><span class="bk-ico">' + n[2] + "</span>" + E(n[1]) +
        (n[0] === "offers" && offers ? '<span class="bk-badge">' + E(offers) + "</span>" : "") + (n[0] === "settings" ? '<span class="bk-cog">' + (settingsOpen ? "▴" : "▾") + "</span>" : "") + "</button>";
      if (n[0] === "settings" && settingsOpen) h += SUBS.map(function (s) {
        return '<button type="button" class="bk-navitem bk-sub' + (on && subPage === s[0] ? " active" : "") + '" data-go="settings/' + s[0] + '">' + E(s[1]) + "</button>";
      }).join("");
      return h;
    }).join("");
    var types = (S.sum && S.sum.types) || (S.opts && S.opts.types) || [];
    $("bk-types").innerHTML = types.map(function (t) {
      return '<div class="bk-navitem' + (S.page === "shows" && S.typeId === String(t.id) ? " active" : "") + '" role="button" tabindex="0" data-type="' + E(t.id) + '">' +
        E((t.emoji ? t.emoji + " " : "") + t.name) + '<a class="bk-cog" href="https://confirmed.show" rel="noopener" target="_blank" title="Open in confirmed" aria-label="Open ' + E(t.name) + ' in confirmed">⚙ ↗</a></div>';
    }).join("") || '<div class="bk-muted" style="padding:6px 10px">No show types yet</div>';
  }

  /* ---------- shows page ---------- */
  function matches(s) {
    if (S.typeId && String(s.type) !== S.typeId) return false;
    var q = S.q.trim().toLowerCase(); if (!q) return true;
    var hay = [s.type_name, s.venue_name, s.venue_city, s.venue_country, s.date, s.time, fmtDay(s.date), s.description].concat(s.spots.map(function (p) { return p.act_name; }));
    return hay.join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function avatarStrip(s) {
    var o = { host: 0, act: 1, production: 2 };
    return '<span class="bk-strip" aria-hidden="true">' + s.spots.slice().sort(function (a, b) { return (o[a.category] - o[b.category]) || (a.order - b.order); }).map(function (p) {
      return '<span class="bk-sav ' + E(p.category) + (p.act_id ? " filled" : "") + '"' + (p.act_id ? ' style="--h:' + hue(p.act_name) + '"' : "") + ">" + (p.act_id ? E(initials(p.act_name)) : "") + "</span>";
    }).join("") + "</span>";
  }
  function rowHtml(s) {
    return '<div class="bk-row" role="button" tabindex="0" data-id="' + E(s.id) + '"><input type="checkbox" data-sel="' + E(s.id) + '" aria-label="Select show"' + (S.sel[s.id] ? " checked" : "") + ">" +
      '<span class="bk-count"><span class="bk-sdot ' + (lineupDone(s) ? "ok" : (pendingOffers(s) ? "gold" : "")) + '"></span>' + actFilled(s) + "/" + actTotal(s) + "</span>" + avatarStrip(s) +
      '<span class="bk-time">' + E(s.time) + "</span>" +
      '<span class="bk-what">' + E((s.emoji ? s.emoji + " " : "") + s.type_name) + (s.description ? ' <span class="bk-muted" title="Has notes">🗒</span>' : "") + (s.public ? "" : ' <span class="bk-muted">· private</span>') + "</span>" +
      '<span class="bk-where">' + E(s.venue_name || "") + (s.venue_name ? " 📍" : "") + "</span>" +
      '<span class="bk-menuwrap"><button type="button" class="bk-dots" data-menu="' + E(s.id) + '" aria-label="Show actions" aria-haspopup="true">⋮</button></span></div>';
  }
  function group(title, shows, key, extra) {
    var open = S.collapsed[key] !== true, last = "", html = "";
    shows.forEach(function (s) {
      if (s.date !== last) { last = s.date; html += '<div class="bk-day">' + E(fmtDay(s.date)) + "</div>"; }
      html += rowHtml(s);
    });
    return '<div><button type="button" class="bk-grouphead" data-group="' + key + '" aria-expanded="' + open + '">' + E(title) + " (" + shows.length + ") " + (open ? "⌃" : "⌄") + "</button>" + (open ? (extra || html) : "") + "</div>";
  }
  function viewBtns() {
    return [["list", "▦", "List"], ["acts", "👥", "Acts"], ["month", "📅", "Month"], ["day", "📆", "Day"]].map(function (x) {
      return '<button type="button" class="' + (S.view === x[0] ? "on" : "") + '" data-view="' + x[0] + '" title="' + x[2] + ' view" aria-label="' + x[2] + ' view">' + x[1] + "</button>";
    }).join("");
  }
  function renderShows() {
    var keepFocus = document.activeElement && document.activeElement.id === "bk-filter", pos = keepFocus ? document.activeElement.selectionStart : 0;
    var types = (S.opts && S.opts.types) || [];
    var onb = lsGet("bk-onboard-off") ? "" : '<div class="bk-onboard"><button type="button" class="ghost bk-close" data-do="onb-x" aria-label="Dismiss">✕</button><h3>Nice, your shows are on the calendar! Now you can fill your lineups:</h3>' +
      '<p><b>Looking for general availability?</b> <a href="#surveys">Send a survey.</a> Acts will choose the days they can do, and their replies will land here.</p>' +
      '<p><b>Ready to book?</b> <a href="#offers">Send out your offers</a> and acts will be able to confirm their spots.</p></div>';
    var nsel = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).length;
    main.innerHTML = '<div class="bk-bar"><div class="bk-views" role="group" aria-label="View">' + viewBtns() + "</div>" +
      '<div class="bk-filterwrap"><input id="bk-filter" type="search" autocomplete="off" placeholder="Filter shows by show, act, venue, time, country, town, and so on" aria-label="Filter shows" value="' + E(S.q) + '">' +
      '<button type="button" class="ghost bk-fset" title="Filter settings" aria-label="Filter settings" data-do="fset">⚙</button></div>' +
      '<button type="button" class="bk-plus" data-do="new" title="New show" aria-label="New show">+</button></div>' +
      '<div class="bk-row2"><span class="bk-chip"><select id="bk-type" aria-label="Show type"><option value="">All show types</option>' + opt(types, S.typeId) + "</select></span></div>" +
      '<div class="bk-row3"><input type="checkbox" id="bk-all" aria-label="Select all"' + (nsel && nsel === allVisible().length ? " checked" : "") + '><button type="button" class="ghost" data-do="csv" title="Download shows as CSV" aria-label="Download CSV">⬇</button></div>' +
      (nsel ? '<div class="bk-bulk"><b>' + nsel + ' selected</b><button type="button" data-do="bulk-pub">Publish selected</button><button type="button" class="secondary" data-do="bulk-unpub">Unpublish selected</button><span class="msg" id="bk-bmsg"></span></div>' : "") +
      '<div id="bk-body">' + (S.view === "list" ? onb + listBody() : S.view === "acts" ? actsView() : S.view === "month" ? monthView() : dayView()) + "</div>" +
      '<div class="bk-foot">' + allVisible().length + " shows</div>";
    if (keepFocus) { var i = $("bk-filter"); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} }
  }
  function allVisible() { return allShows().filter(matches).filter(function (s) { return s.date >= today() || S.pastShows; }); }
  function listBody() {
    var t = today(), fut = S.shows.filter(matches).filter(function (s) { return s.date >= t; });
    if (!S.shows.length) return '<div class="bk-empty">No shows yet — tap + to create one.</div>';
    var past = (S.pastShows || []).filter(matches).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var pastHtml = S.pastShows ? null : '<div class="bk-muted" style="padding:8px">Loading…</div>';
    return group("Future Shows", fut, "future") + group("Past Shows", past, "past", pastHtml);
  }
  function actsView() {
    var by = {}; allShows().filter(matches).forEach(function (s) {
      s.spots.forEach(function (p) { if (p.act_id) (by[p.act_name] = by[p.act_name] || []).push(s); });
    });
    var names = Object.keys(by).sort();
    return names.map(function (n) {
      return '<div class="bk-day">' + E(n) + " (" + by[n].length + ")</div>" + by[n].map(rowHtml).join("");
    }).join("") || '<div class="bk-empty">No booked acts match.</div>';
  }
  function monthView() {
    var c = S.cal ? pd(S.cal) : new Date(); c = new Date(c.getFullYear(), c.getMonth(), 1); S.cal = ymd(c);
    var first = (c.getDay() + 6) % 7, days = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate(), cells = "";
    var vis = allShows().filter(matches);
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (d) { cells += '<div class="bk-dh">' + d + "</div>"; });
    for (var i = 0; i < first; i++) cells += '<div class="bk-cell out"></div>';
    for (var d = 1; d <= days; d++) {
      var key = ymd(new Date(c.getFullYear(), c.getMonth(), d));
      cells += '<div class="bk-cell"><b>' + d + "</b>" + vis.filter(function (s) { return s.date === key; }).map(function (s) {
        return '<button type="button" class="bk-ev" data-id="' + E(s.id) + '">' + E(s.time + " " + (s.emoji || "") + " " + s.type_name) + "</button>";
      }).join("") + "</div>";
    }
    return '<div class="bk-bar"><button type="button" class="secondary" data-do="cal-prev">‹</button><b>' + MON[c.getMonth()] + " " + c.getFullYear() + '</b><button type="button" class="secondary" data-do="cal-next">›</button></div><div class="bk-cal">' + cells + "</div>";
  }
  function dayView() {
    var d = S.day || today(); S.day = d;
    var rows = allShows().filter(matches).filter(function (s) { return s.date === d; }).sort(function (a, b) { return a.time < b.time ? -1 : 1; });
    return '<div class="bk-bar"><button type="button" class="secondary" data-do="day-prev">‹</button><b>' + E(fmtDay(d)) + '</b><button type="button" class="secondary" data-do="day-next">›</button></div>' +
      (rows.map(rowHtml).join("") || '<div class="bk-empty">No shows on this day.</div>');
  }
  function shiftDay(n) { var d = pd(S.day || today()); d.setDate(d.getDate() + n); S.day = ymd(d); renderShows(); }
  function shiftMon(n) { var d = pd(S.cal || today()); d = new Date(d.getFullYear(), d.getMonth() + n, 1); S.cal = ymd(d); renderShows(); }
  function closeMenus() { var m = document.querySelector(".bk-menu"); if (m) m.remove(); }
  function openMenu(btn) {
    var id = btn.getAttribute("data-menu"), s = byId(id); closeMenus(); if (!s) return;
    var m = document.createElement("div"); m.className = "bk-menu"; m.setAttribute("role", "menu");
    m.innerHTML = '<button type="button" role="menuitem" data-m="open" data-id="' + E(id) + '">Open</button>' +
      '<button type="button" role="menuitem" data-m="pub" data-id="' + E(id) + '">' + (s.public ? "Unpublish" : "Publish") + "</button>" +
      '<a role="menuitem" href="https://confirmed.show" rel="noopener" target="_blank">Open in confirmed ↗</a>';
    btn.parentNode.appendChild(m);
  }
  function togglePublish(id, to) {
    var s = byId(id); if (!s) return Promise.resolve();
    var val = to === undefined ? !s.public : to; if (s.public === val) return Promise.resolve();
    return A.post(P + "/shows/" + encodeURIComponent(id) + "/publish", { public: val });
  }
  function bulkPub(val) {
    var ids = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }), m = $("bk-bmsg"), i = 0;
    (function next() {
      if (i >= ids.length) { S.sel = {}; reload(); return; }
      msg(m, "Working " + (i + 1) + "/" + ids.length + "…", true);
      togglePublish(ids[i++], val).then(next).catch(function (e) { msg(m, err(e)); });
    })();
  }
  function dlCsv() {
    var rows = [["date", "time", "type", "venue", "filled", "total", "public"]];
    allVisible().forEach(function (s) { rows.push([s.date, s.time, s.type_name, s.venue_name || "", actFilled(s), actTotal(s), s.public ? "yes" : "no"]); });
    download("shows.csv", csv(rows));
  }

  /* ---------- drawers ---------- */
  function openDrawer(title, body, onSave, saveLabel) {
    var d = drawer.querySelector(".bk-dpanel");
    d.innerHTML = '<div class="bk-mhead"><h3>' + E(title) + '</h3><button type="button" class="ghost" data-dr="x" aria-label="Close">✕</button></div>' + body +
      '<div style="margin-top:14px"><button type="button" data-dr="save">' + E(saveLabel || "Save") + '</button> <button type="button" class="secondary" data-dr="x">Cancel</button></div><div class="msg" id="bk-dmsg"></div>';
    drawer.hidden = false; drawer._save = onSave; d.focus();
  }
  function closeDrawer() { drawer.hidden = true; drawer._save = null; }
  function newShowDrawer() {
    var o = S.opts || {};
    openDrawer("New show",
      '<div class="bk-cols4" style="grid-template-columns:1fr 1fr">' + "<div>" + field("nd-date", "Date", "", "date") + "</div><div>" + field("nd-time", "Start", "20:00", "time") + "</div></div>" +
      '<label for="nd-type">Show type</label><select id="nd-type">' + opt(o.types) + "</select>" +
      '<label for="nd-venue">Venue</label><select id="nd-venue"><option value="">— venue —</option>' + opt(o.venues) + "</select>" +
      '<div class="bk-cols4" style="grid-template-columns:1fr 1fr"><div>' + field("nd-hosts", "Hosts", "1", "number") + "</div><div>" + field("nd-acts", "Acts", "5", "number") + "</div></div>" +
      '<label for="nd-desc">Description</label><textarea id="nd-desc" rows="3"></textarea>',
      function () {
        var m = $("bk-dmsg"), d = v("nd-date"); if (!d) { msg(m, "Pick a date first."); return; }
        var body = { date: d, time: v("nd-time") || "20:00", type: $("nd-type").value, hosts: parseInt(v("nd-hosts"), 10) || 0, acts: parseInt(v("nd-acts"), 10) || 1 };
        if ($("nd-venue").value) body.venue_id = $("nd-venue").value;
        if (v("nd-desc")) body.description = v("nd-desc");
        msg(m, "Creating…", true);
        A.post(P + "/shows", body).then(function (r) {
          closeDrawer(); var id = r.created && r.created[0];
          return reload().then(function () { if (id) go("#show/" + encodeURIComponent(id)); });
        }).catch(function (e) { msg(m, err(e)); });
      }, "Create show");
  }

  /* ---------- other pages ---------- */
  function table(head, rows, cls) {
    return '<table class="bk-table"><thead><tr>' + head.map(function (h) { return "<th>" + E(h) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table>";
  }
  function pageLoad(title, fn) {
    main.innerHTML = '<h1 class="bk-h1">' + E(title) + '</h1><div class="bk-muted" id="bk-pg">Loading…</div>';
    var page = S.page; fn(function (html) { if (S.page === page && $("bk-pg")) $("bk-pg").outerHTML = '<div id="bk-pgbody">' + html + "</div>"; }, function (e) {
      if ($("bk-pg")) $("bk-pg").outerHTML = '<div class="msg error">' + E(err(e)) + "</div>";
    });
  }
  function pageSurveys() {
    pageLoad("Surveys", function (ok, bad) {
      A.get(P + "/surveys").then(function (r) {
        var rows = (r.polls || []).map(function (p) {
          return "<tr><td>" + E(p.title) + "</td><td>" + E(p.dates_count) + "</td><td>" + E(p.answered) + " / " + E(p.total) + "</td><td>" + E(p.status) + "</td></tr>";
        }).join("");
        ok('<div class="bk-bar"><a class="badge" href="booker.html#lineups" target="_blank" rel="noopener"><button type="button">Send a survey</button></a></div>' +
          (rows ? table(["Name", "Dates", "Replies", "Status"], rows) : '<div class="bk-empty">No surveys yet. Send one and acts will choose the days they can do.</div>'));
      }).catch(bad);
    });
  }
  function pageOffers() {
    pageLoad("Offers", function (ok, bad) {
      A.get(P + "/offers").then(function (r) {
        S.offersData = r; S.offTab = S.offTab || "planning"; drawOffers(ok);
      }).catch(bad);
    });
  }
  function offRow(o, planning) {
    var nm = o.act_name || o.stage_name || o.name || "", st = o.status || (planning ? "planning" : "offered");
    var date = o.show_ts || o.show_date || o.date || "", sid = o.show_id || o.event_id || "", spot = o.spot_id || o.id || "";
    return "<tr><td>" + E(nm) + "</td><td>" + E(o.show_type_name || o.type_name || o.show || o.title || "") + "</td><td>" + E(date ? fmtDay(date) : "") + " " + E(o.time || "") + "</td><td>" + E(o.role || "") + "</td><td>" +
      (planning ? '<button type="button" data-offdo="offer" data-show="' + E(sid) + '" data-spot="' + E(spot) + '">Offer</button> '
        : '<span class="bk-st offered">' + E(st) + '</span> <button type="button" class="secondary" data-offdo="withdraw" data-show="' + E(sid) + '" data-spot="' + E(spot) + '">Withdraw</button> ' +
          '<button type="button" class="ghost" data-offdo="share" data-show="' + E(sid) + '" data-spot="' + E(spot) + '" data-path="' + E(o.share_url_path || "") + '">Share</button>') +
      ' <button type="button" class="ghost" data-offdo="open" data-show="' + E(sid) + '">Open show</button></td></tr>';
  }
  function drawOffers(ok) {
    var d = S.offersData || {}, pl = d.planning || [], of = d.offered || [], tab = S.offTab;
    var html = '<div class="bk-tabs"><button type="button" class="bk-tab' + (tab === "planning" ? " active" : "") + '" data-offtab="planning">Planning (' + pl.length + ')</button>' +
      '<button type="button" class="bk-tab' + (tab === "offered" ? " active" : "") + '" data-offtab="offered">Offered (' + of.length + ")</button></div>";
    var rows = (tab === "planning" ? pl : of).map(function (o) { return offRow(o, tab === "planning"); }).join("");
    html += (rows ? table(["Act", "Show", "When", "Role", ""], rows) : '<div class="bk-empty">Nothing here yet.</div>') + '<div class="msg" id="bk-omsg"></div>';
    if (ok) ok(html); else $("bk-pgbody").innerHTML = html;
  }
  function offerAction(btn) {
    var a = btn.getAttribute("data-offdo"), sid = btn.getAttribute("data-show"), spot = btn.getAttribute("data-spot"), m = $("bk-omsg");
    if (a === "open") { if (sid) go("#show/" + encodeURIComponent(sid)); return; }
    var sh = byId(sid), p = sh && findSpot(sh, spot);
    if (a === "share") { var path = btn.getAttribute("data-path") || (p && p.offer && p.offer.share_url_path); if (path) copy(link(path), m); else msg(m, "No link on this offer."); return; }
    if (a === "withdraw") {
      if (!window.confirm("Withdraw this offer?")) return;
      A.del(P + "/shows/" + encodeURIComponent(sid) + "/spots/" + encodeURIComponent(spot) + "/offer").then(function () { return reload(); }).then(pageOffers).catch(function (e) { msg(m, err(e)); }); return;
    }
    if (!p || !p.person_id) { go("#show/" + encodeURIComponent(sid)); return; }
    if (!sh.link) { go("#show/" + encodeURIComponent(sid)); return; }
    A.post(P + "/shows/" + encodeURIComponent(sid) + "/spots/" + encodeURIComponent(spot) + "/offer", { person_id: p.person_id })
      .then(function () { return reload(); }).then(pageOffers).catch(function (e) {
        var d = detailObj(e); if (d && d.error === "link_required") { go("#show/" + encodeURIComponent(sid)); return; } msg(m, err(e));
      });
  }
  function copy(url, el) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { msg(el, "Share link copied.", true); }).catch(function () { window.prompt("Copy this link", url); });
    else window.prompt("Copy this link", url);
  }
  function empty(title, text, label) {
    return '<h1 class="bk-h1">' + E(title) + "</h1>" + text + '<p style="margin-top:14px"><a href="https://confirmed.show" rel="noopener" target="_blank"><button type="button">' + E(label) + "</button></a></p>";
  }
  function pageSettlements() {
    main.innerHTML = '<h1 class="bk-h1">Settlements</h1><div class="bk-cols4">' + ["To Settle", "Pending", "To Pay", "Settled"].map(function (c) {
      return '<div class="bk-col"><h4>' + c + '</h4><div class="bk-empty">Nothing here</div></div>';
    }).join("") + '</div><p style="margin-top:14px"><a href="https://confirmed.show" rel="noopener" target="_blank"><button type="button">Open settlements in confirmed ↗</button></a></p>';
  }
  function pageFestivals() {
    main.innerHTML = empty("Festivals", '<div class="bk-empty">No festivals yet.</div>', "Open festivals in confirmed ↗");
  }
  function pageVenues() {
    pageLoad("Venues", function (ok, bad) {
      A.get(P + "/venues").then(function (r) {
        S.venues = r.venues || [];
        ok('<div class="bk-bar"><button type="button" data-do="venue-new">+ Venue</button></div>' +
          (S.venues.length ? table(["Name", "City", "Address", "Rooms"], S.venues.map(function (x) {
            return '<tr class="click" data-venue="' + E(x.id) + '"><td>' + E(x.name) + "</td><td>" + E(x.city || "") + "</td><td>" + E(x.address || "") + "</td><td>" + E(x.rooms == null ? "" : (Array.isArray(x.rooms) ? x.rooms.length : x.rooms)) + "</td></tr>";
          }).join("")) : '<div class="bk-empty">No venues yet.</div>'));
      }).catch(bad);
    });
  }
  function venueDrawer(x) {
    x = x || {};
    openDrawer(x.id ? "Edit venue" : "New venue", field("vd-name", "Name", x.name) + field("vd-city", "City", x.city) + field("vd-addr", "Address", x.address), function () {
      var m = $("bk-dmsg"), b = { name: v("vd-name"), city: v("vd-city"), address: v("vd-addr") };
      if (!b.name) { msg(m, "Name is required."); return; }
      (x.id ? A.put(P + "/venues/" + encodeURIComponent(x.id), b) : A.post(P + "/venues", b)).then(function () {
        closeDrawer(); return A.get(P + "/options").then(function (o) { S.opts = o; pageVenues(); });
      }).catch(function (e) { msg(m, err(e)); });
    });
  }
  function pageActs() {
    main.innerHTML = '<h1 class="bk-h1">Acts &amp; Contacts</h1><div class="bk-bar"><div class="bk-filterwrap"><input id="bk-aq" type="search" placeholder="Search acts" aria-label="Search acts" autocomplete="off" value="' + E(S.aq) + '"></div>' +
      '<button type="button" class="secondary" data-do="acts-csv">Export CSV</button><button type="button" data-do="act-new">Add Contact</button></div><div id="bk-actsbody" class="bk-muted">Loading…</div>';
    loadActs();
  }
  function loadActs() {
    A.get(P + "/acts?q=" + encodeURIComponent(S.aq)).then(function (r) {
      S.actsList = r.acts || []; var b = $("bk-actsbody"); if (!b || S.page !== "acts") return;
      b.className = "";
      b.innerHTML = S.actsList.length ? table(["Name", "Instagram", "Booked", ""], S.actsList.map(function (a) {
        return "<tr><td>" + E(a.name) + "</td><td>" + E(a.instagram || "") + (a.instagram ? ' <a class="bk-ig" href="https://www.instagram.com/' + encodeURIComponent(a.instagram) + '/" target="_blank" rel="noopener">IG ↗</a>' : "") + "</td><td>" + E(a.booked_count || 0) + '</td><td>' + (a.person_id ? '<span class="bk-atlas">Atlas</span>' : "") + "</td></tr>";
      }).join("")) : '<div class="bk-empty">No acts match.</div>';
    }).catch(function (e) { var b = $("bk-actsbody"); if (b) b.innerHTML = '<div class="msg error">' + E(err(e)) + "</div>"; });
  }
  function actDrawer() {
    openDrawer("Add Contact", field("ad-name", "Name", "") + field("ad-ig", "Instagram", "", "text", "@handle") + '<div><button type="button" class="bk-link" id="ad-find">Find on Instagram ↗</button></div><label class="bk-check"><input type="checkbox" id="ad-inv" style="width:auto"> Create their Comedy Atlas page and keep the handle private (invite later)</label><p class="bk-muted" style="margin-top:8px">Names only. No email or phone is stored here.</p>', function () {
      var m = $("bk-dmsg"), b = { name: v("ad-name") }; if (!b.name) { msg(m, "Name is required."); return; }
      if (v("ad-ig")) b.instagram = igClean(v("ad-ig"));
      if ($("ad-inv") && $("ad-inv").checked) { if (!b.instagram) { msg(m, "Add the Instagram handle to create their page."); return; } b.invite = true; }
      A.post(P + "/acts", b).then(function () { closeDrawer(); return A.get(P + "/options").then(function (o) { S.opts = o; loadActs(); }); }).catch(function (e) { msg(m, err(e)); });
    });
  }
  document.addEventListener("click", function (ev) { var f = ev.target.closest && ev.target.closest("#ad-find"); if (f) igFind(v("ad-name")); });
  function pageSettings() {
    settingsOpen = true; renderSide();
    var st = JSON.parse(lsGet("bk-prod") || "{}");
    var body = {
      production: function () {
        main.innerHTML = '<h1 class="bk-h1">Settings · Production</h1><p class="bk-muted">Atlas-side settings — stored in this browser only for now.</p>' +
          field("ps-name", "Production name", st.name || "Comedy Atlas") + field("ps-logo", "Logo URL", st.logo, "url") + field("ps-ig", "Instagram", st.ig) + field("ps-web", "Website", st.web, "url") +
          '<p><button type="button" data-do="prod-save">Save</button></p><div class="msg" id="bk-smsg"></div>';
      },
      team: function () { main.innerHTML = empty("Settings · Team", '<p class="bk-muted">Team members are managed in confirmed.</p>', "Open team in confirmed ↗"); },
      data: function () { main.innerHTML = empty("Settings · Data & API", '<p class="bk-muted">API keys and data exports live in confirmed.</p>', "Open Data & API in confirmed ↗"); },
      subscription: function () {
        main.innerHTML = '<h1 class="bk-h1">Settings · Subscription</h1><div class="bk-muted" id="bk-pg">Loading…</div>';
        A.get(P + "/status").then(function (r) {
          var m = today().slice(0, 7), n = allShows().filter(function (s) { return String(s.date).slice(0, 7) === m; }).length;
          if ($("bk-pg")) $("bk-pg").outerHTML = '<p style="font-size:18px"><b>' + E(n) + "</b> / " + E(r.monthly_limit == null ? 40 : r.monthly_limit) + " shows this month</p>";
        }).catch(function (e) { if ($("bk-pg")) $("bk-pg").outerHTML = '<div class="msg error">' + E(err(e)) + "</div>"; });
      }
    }[subPage] || null;
    if (!body) { subPage = "production"; pageSettings(); return; }
    body();
  }

  /* ---------- modal ---------- */
  function hideModal() {
    modal.hidden = true; S.openId = null; document.body.classList.remove("bk-lock");
    if (S.lastFocus && S.lastFocus.focus) S.lastFocus.focus();
  }
  function closeModal() { hideModal(); var h = "#" + (S.page === "shows" ? "shows" + (S.typeId ? "/" + encodeURIComponent(S.typeId) : "") : S.page); if (location.hash !== h) { history.replaceState(null, "", h); } renderPage(); }
  function openShow(id) {
    var s = byId(id);
    if (!s) {
      A.get(P + "/shows?include_past=true").then(function (r) { S.pastShows = (r.shows || []).filter(function (x) { return x.date < today(); }); if (byId(id)) openShow(id); else { history.replaceState(null, "", "#shows"); route(); } }).catch(function () {});
      return;
    }
    if (S.openId === id && !modal.hidden) return;
    if (!$("bk-main").innerHTML) renderPage();
    S.openId = id; S.tab = "spots"; S.target = null; S.aq = ""; S.dirQ = ""; S.dir = []; S.panel = null; S.note = null; S.ig = null; S.dm = null; S.avail = null; S.tabData = {};
    S.lastFocus = document.activeElement; modal.hidden = false; document.body.classList.add("bk-lock");
    renderModal(); modal.querySelector(".bk-panel").focus(); loadAvail();
  }
  var TABS = [["show", "Show"], ["spots", "Spots"], ["notes", "Notes"], ["tickets", "Tickets"], ["checklists", "Checklists"], ["meta", "Meta"], ["changes", "Changes"]];
  function renderModal() {
    var s = byId(S.openId), panel = modal.querySelector(".bk-panel"), keep = document.activeElement && document.activeElement.id;
    if (!s) { hideModal(); return; }
    panel.innerHTML = '<div class="bk-mhead"><h3>' + E((s.emoji ? s.emoji + " " : "") + s.type_name + " - " + fmtShort(s)) + '</h3><button type="button" class="secondary" data-do="history">History</button>' +
      '<button type="button" class="ghost" data-do="close" aria-label="Close">✕</button></div>' +
      '<div class="bk-tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" class="bk-tab' + (S.tab === t[0] ? " active" : "") + '" role="tab" data-tab="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>" +
      '<div id="bk-mbody">' + tabBody(s) + '</div><div class="bk-mfoot"><span class="bk-muted">Show programming ' + CREDIT.replace("Powered by", "powered by") + '</span><span class="msg" id="bk-smsg"></span></div>';
    if (S.tab === "spots") renderActs();
    if (keep && $(keep)) $(keep).focus();
  }
  function tabBody(s) {
    return { spots: spotsTab, show: showTab, notes: notesTab, tickets: ticketsTab, checklists: checklistsTab, meta: metaTab, changes: changesTab }[S.tab](s);
  }
  function setTab(t) {
    S.tab = t; S.panel = null; renderModal();
    var id = S.openId, base = P + "/shows/" + encodeURIComponent(id);
    var url = { notes: "/notes", checklists: "/checklists", changes: "/changes" }[t];
    if (url) A.get(base + url).then(function (r) { if (S.openId !== id) return; S.tabData[t] = r; if (S.tab === t) { $("bk-mbody").innerHTML = tabBody(byId(id)); } })
      .catch(function (e) { if (S.openId === id && S.tab === t) { S.tabData[t] = { error: err(e) }; $("bk-mbody").innerHTML = tabBody(byId(id)); } });
  }

  /* spots tab */
  function bookingBits(p) {
    var st = offerSt(p);
    return st === "pending" ? '<span class="bk-st offered">Offered</span>' : st === "confirmed" ? '<span class="bk-st confirmed">Confirmed</span>' : st === "declined" ? '<span class="bk-st declined">Declined</span>' : "";
  }
  function menuItems(p) {
    var st = offerSt(p), sid = E(p.id), nm = E(p.act_name), h = "";
    function b(d, t, x) { return '<button type="button" role="menuitem" data-do="' + d + '" data-spot="' + sid + '"' + (x || "") + ">" + t + "</button>"; }
    if (p.act_id) {
      if (st === "none") h += p.person_id ? b("offer", "<b>Offer this spot</b>", ' aria-label="Offer this spot to ' + nm + '"') : '<a role="menuitem" href="https://confirmed.show" rel="noopener" target="_blank">Offer in confirmed ↗</a>';
      if (st === "pending" && p.offer && p.offer.share_url_path) h += '<button type="button" role="menuitem" data-do="share" data-path="' + E(p.offer.share_url_path) + '">Share offer link</button>';
      if (st === "pending") h += b("dm", "Instagram DM text");
      if (st === "pending") h += b("withdraw", "Withdraw offer");
    }
    h += b("up", "Move up") + b("down", "Move down") + b("len", "Set length…") + b("role", "Set role…") + b("status", "Set status…");
    if (p.act_id) h += b("unfill", "Unfill", ' aria-label="Remove ' + nm + '"');
    return h;
  }
  function panelHtml(sp) {
    var Pn = S.panel, s = byId(S.openId);
    if (!Pn || Pn.spot !== sp || !s) return "";
    if (Pn.kind === "link") {
      var sg = (Pn.sugg || []).slice().sort(function (a, b) { return (b.match ? 1 : 0) - (a.match ? 1 : 0); }), sel = sg.filter(function (x) { return x.match; });
      var opts = sg.map(function (x, i) { return '<option value="' + E(x.show_series_id) + '"' + (sel.length === 1 && x.match && i === 0 ? " selected" : "") + ">" + E(x.name) + (x.match ? " (name match)" : "") + "</option>"; }).join("");
      return '<div class="bk-ipanel" role="group" aria-label="Link this night to your Atlas show"><b>Link this night to your Atlas show</b>' +
        (Pn.loading ? '<div class="bk-muted">Loading your Atlas shows…</div>' : (sg.length ? '<select id="bk-link-sel" aria-label="Atlas show">' + (sel.length === 1 ? "" : '<option value="">— choose —</option>') + opts + "</select>" : '<div class="bk-muted">No Atlas shows found on your account.</div>')) +
        '<div style="margin-top:8px"><button type="button" data-do="link-save"' + (sg.length ? "" : " disabled") + '>Link</button> <button type="button" class="secondary" data-do="panel-x">Cancel</button></div>' +
        '<div class="msg' + (Pn.err ? " error" : "") + '">' + E(Pn.err || "") + "</div></div>";
    }
    var p2 = findSpot(s, sp), nm = p2 && p2.act_name;
    return '<div class="bk-ipanel" role="group" aria-label="Send offer"><b>Send an offer to ' + E(nm) + "?</b>" +
      '<div class="bk-muted">For ' + E(p2 && (p2.role || CAT[p2.category][1])) + " on " + E(fmtShort(s)) + ". They'll get it through Comedy Atlas — their contact stays private.</div>" +
      '<label for="bk-offer-msg">Message (optional)</label><textarea id="bk-offer-msg" rows="2" maxlength="500" placeholder="Add a note (max 500 characters)"></textarea>' +
      '<div style="margin-top:8px"><button type="button" data-do="offer-send"' + (Pn.busy ? " disabled" : "") + '>Send offer</button> <button type="button" class="secondary" data-do="panel-x">Cancel</button></div>' +
      '<div class="msg' + (Pn.err ? " error" : "") + '">' + E(Pn.err || "") + "</div></div>";
  }
  function spotRow(s, p) {
    var label = p.role || CAT[p.category][1], tgt = S.target === p.id;
    var len = E(p.spot_length || CAT[p.category][2]);
    var slot = p.act_id ? '<span class="bk-sav filled ' + E(p.category) + '" style="--h:' + hue(p.act_name) + '">' + E(initials(p.act_name)) + '</span><b>' + E(p.act_name) + "</b>" + bookingBits(p)
      : '<span class="bk-sav ' + E(p.category) + '"></span><button type="button" class="bk-link" data-do="target" data-spot="' + E(p.id) + '">Fill Spot</button>';
    var st = (p.status && p.status !== "planning" && p.status !== "confirmed" && p.status !== "offered") ? '<span class="bk-st declined">' + E(p.status) + "</span>" : "";
    return '<div class="bk-spot' + (tgt ? " is-target" : "") + '" draggable="' + (S.panel && S.panel.spot === p.id ? "false" : "true") + '" data-spot="' + E(p.id) + '" data-cat="' + E(p.category) + '">' +
      '<span class="bk-handle" aria-hidden="true">⠿</span><span class="bk-len" title="Spot length (minutes)">' + len + '</span><span class="bk-role">' + E(label) + '</span><span class="bk-handle" aria-hidden="true">⠿</span>' +
      '<span class="bk-slot">' + slot + st + '</span><span class="bk-menuwrap"><button type="button" class="bk-dots" data-do="smenu" data-spot="' + E(p.id) + '" aria-label="Spot actions" aria-haspopup="true">⋮</button></span>' + panelHtml(p.id) + "</div>";
  }
  function spotsTab(s) {
    var secs = Object.keys(CAT).map(function (c) {
      var ps = sortedSpots(s, c); if (!ps.length) return "";
      var open = S.secs[c] !== true;
      return '<div class="bk-sec"><div style="display:flex;align-items:center"><button type="button" class="bk-sechd" data-do="sec" data-cat="' + c + '" aria-expanded="' + open + '">' + (open ? "⌃" : "⌄") + " " + CAT[c][0] + "</button>" +
        (c === "host" ? '<button type="button" class="ghost" data-do="clock" title="Set the show start time" aria-label="Set start time">🕒</button>' : "") + "</div>" +
        (open ? ps.map(function (p) { return spotRow(s, p); }).join("") : "") + "</div>";
    }).join("");
    var n = S.note ? '<div class="msg ok">' + E(S.note.text) + (S.note.path ? ' <button type="button" class="bk-link" data-do="share" data-path="' + E(S.note.path) + '">Share link</button>' : "") + "</div>" : "";
    return '<div class="bk-cols"><div>' + n + dmHtml() + secs +
      '<div class="bk-mfoot" style="border:none"><a class="bk-muted" href="https://confirmed.show" rel="noopener" target="_blank" title="Spots are set when you create a show — add more in confirmed">Add Spot…</a><button type="button" class="secondary" data-do="close">Close</button></div></div>' +
      '<div id="bk-right"></div></div>';
  }
  function targetLabel(s) {
    for (var i = 0; i < s.spots.length; i++) if (s.spots[i].id === S.target) return s.spots[i].role || CAT[s.spots[i].category][1];
    return null;
  }
  function otherShows(a, cur) {
    return S.shows.filter(function (s) { return s.id !== cur && s.date >= today() && s.spots.some(function (p) { return p.act_id === a.id; }); }).length;
  }
  function everBooked(a, type) {
    return allShows().some(function (s) { return String(s.type) === String(type) && s.spots.some(function (p) { return p.act_id === a.id; }); });
  }
  function actRow(a, kind, extra, s) {
    var sub, good = false;
    if (kind === "mine") {
      var n = otherShows(a, s.id);
      if (n) { sub = "Planning/offering for " + n + " other show" + (n > 1 ? "s" : ""); good = true; }
      else sub = everBooked(a, s.type) ? "No prior bookings" : "New to this show";
      if (!n && !everBooked(a, s.type)) sub = allShows().some(function (x) { return x.spots.some(function (p) { return p.act_id === a.id; }); }) ? "New to this show" : "No prior bookings";
    } else sub = "Comedy Atlas directory";
    var av = extra && extra.photo_url ? '<img alt="" loading="lazy" style="width:32px;height:32px;border-radius:50%;object-fit:cover" src="' + E(extra.photo_url) + '">' : '<span class="bk-sav filled act" style="--h:' + hue(a.name) + '">' + E(initials(a.name)) + "</span>";
    return '<button type="button" class="bk-act" data-do="pick" data-kind="' + kind + '" data-id="' + E(a.id) + '" data-name="' + E(a.name) + '">' + av + "<span><b>" + E(a.name) + "</b><small" + (good ? ' class="ok"' : "") + ">" + E(sub) + "</small></span>" + (kind === "dir" ? '<span class="bk-atlas">Atlas</span>' : "") + "</button>";
  }
  function mineActs(s) {
    var q = S.aq.toLowerCase(), rows = ((S.opts && S.opts.acts) || []).filter(function (a) { return !q || String(a.name).toLowerCase().indexOf(q) >= 0; });
    return rows.slice().sort(function (a, b) {
      return S.sort === "booked" ? (otherShows(b, s.id) - otherShows(a, s.id)) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name);
    });
  }
  function loadAvail() {
    var s = byId(S.openId), id = S.openId; if (!s) return;
    A.get("/booker/comics/search?available_date=" + encodeURIComponent(s.date)).then(function (r) {
      if (S.openId !== id) return; S.avail = Array.isArray(r) ? r.slice(0, 20) : []; renderActs();
    }).catch(function () { if (S.openId === id) { S.avail = []; renderActs(); } });
  }
  function renderActs() {
    var s = byId(S.openId), box = $("bk-right"); if (!s || !box) return;
    var tl = targetLabel(s), mine = mineActs(s), names = {};
    ((S.opts && S.opts.acts) || []).forEach(function (a) { names[String(a.name).toLowerCase()] = true; });
    var dirRows = (S.dir || []).filter(function (c) { return !names[String(c.stage_name).toLowerCase()]; });
    var na = S.avail ? S.avail.length : 0;
    var availHtml = S.avail === null ? '<div class="bk-muted">Loading…</div>' : !na ? '<div class="bk-muted">No availability data from surveys</div>' : S.avail.map(function (c) {
      return actRow({ id: c.person_id, name: c.stage_name }, "dir", c, s).replace("Comedy Atlas directory", E(c.availability_note || "Available"));
    }).join("");
    box.innerHTML = '<div class="bk-search"><input id="bk-act-q" type="search" placeholder="Search by Name" autocomplete="off" value="' + E(S.aq) + '"><button type="button" class="secondary" data-do="sort" title="Sort" aria-label="Sort acts">⇅ ' + (S.sort === "az" ? "A-Z" : "Booked") + "</button></div>" +
      (tl ? '<div class="bk-muted">Pick an act for: <b>' + E(tl) + "</b></div>" : "") +
      '<h4 class="bk-rh">Available Acts (' + (S.avail === null ? "…" : na) + ")</h4>" + availHtml +
      '<h4 class="bk-rh">All Acts (' + mine.length + ")</h4>" + (mine.map(function (a) { return actRow(a, "mine", null, s); }).join("") || '<div class="bk-muted">No acts match.</div>') +
      (S.aq.trim().length >= 2 ? '<h4 class="bk-rh">Comedy Atlas directory</h4>' + (dirRows.map(function (c) { return actRow({ id: c.person_id, name: c.stage_name }, "dir", c, s); }).join("") || '<div class="bk-muted">No other matches.</div>') : "") +
      (S.aq.trim().length >= 2 || (S.ig && S.ig.open) ? igRow(S.aq.trim()) : "");
  }
  function onModalInput(ev) {
    if (ev.target.id === "bk-ig-name" || ev.target.id === "bk-ig-handle") { igSync(); return; }
    if (ev.target.id !== "bk-act-q") return;
    S.aq = ev.target.value; var pos = ev.target.selectionStart; renderActs();
    var i = $("bk-act-q"); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {}
    clearTimeout(timer); var q = S.aq.trim();
    if (q.length < 2) { S.dir = []; return; }
    timer = setTimeout(function () {
      A.get("/booker/comics/search?q=" + encodeURIComponent(q)).then(function (r) {
        if (S.aq.trim() !== q) return; S.dir = Array.isArray(r) ? r.slice(0, 12) : [];
        var inp = $("bk-act-q"), p = inp ? inp.selectionStart : 0; renderActs();
        if (inp) { $("bk-act-q").focus(); try { $("bk-act-q").setSelectionRange(p, p); } catch (e) {} }
      }).catch(function (e) { smsg(err(e)); });
    }, 300);
  }

  /* ---------- add by Instagram + DM text ---------- */
  function igClean(x) { return String(x || "").trim().replace(/^@+/, ""); }
  function igFind(name) { window.open("https://www.instagram.com/explore/search/keyword/?q=" + encodeURIComponent(name || ""), "_blank", "noopener"); }
  function igFor(actId) { var a = ((S.opts && S.opts.acts) || []).filter(function (x) { return x.id === actId; })[0]; return a && a.instagram ? a.instagram : ((S.igByAct || {})[actId] || ""); }
  function igRow(q) {
    var o = S.ig, nm = o ? o.name : q;
    if (!o || !o.open) return '<div class="bk-igrow"><button type="button" class="bk-link" data-do="ig-open" data-name="' + E(q) + '">Not on Atlas or confirmed? Add by Instagram</button></div>';
    return '<div class="bk-ipanel bk-igpanel" role="group" aria-label="Add by Instagram"><b>Add by Instagram</b>' +
      '<label for="bk-ig-name">Name</label><input id="bk-ig-name" maxlength="120" value="' + E(nm) + '">' +
      '<label for="bk-ig-handle">Instagram handle</label><input id="bk-ig-handle" maxlength="61" placeholder="@handle" value="' + E(o.handle || "") + '">' +
      '<div><button type="button" class="bk-link" data-do="ig-find">Find on Instagram ↗</button></div>' +
      '<div style="margin-top:8px"><button type="button" data-do="ig-add"' + (o.busy ? " disabled" : "") + '>Add &amp; fill spot</button> <button type="button" data-do="ig-add-invite"' + (o.busy ? " disabled" : "") + '>Add, fill &amp; send invite</button> <button type="button" class="secondary" data-do="ig-x">Cancel</button></div>' +
      '<div class="bk-muted">The handle stays private. Nobody is contacted until you send the invite.</div>' +
      '<div class="msg' + (o.err ? " error" : "") + '">' + E(o.err || "") + "</div></div>";
  }
  function dmHtml() {
    var d = S.dm; if (!d) return "";
    return '<div class="bk-ipanel bk-dmpanel" role="group" aria-label="Instagram DM text"><b>Paste this into their Instagram DMs</b> — the link lets them claim their Comedy Atlas page and add email, photos and availability.' +
      '<textarea id="bk-dm-text" rows="6" readonly>' + E(d.text) + "</textarea>" +
      '<div style="margin-top:8px"><button type="button" data-do="dm-copy">Copy DM</button> ' +
      (d.handle ? '<a href="https://www.instagram.com/' + encodeURIComponent(d.handle) + '/" target="_blank" rel="noopener"><button type="button" class="secondary">Open their Instagram ↗</button></a> ' : "") +
      '<button type="button" class="secondary" data-do="dm-x">Close</button></div><div class="msg ok" id="bk-dm-msg"></div></div>';
  }
  function igSync() { if (!S.ig) return; var n = $("bk-ig-name"), h = $("bk-ig-handle"); if (n) S.ig.name = n.value; if (h) S.ig.handle = h.value; }
  function igSubmit(invite) {
    igSync(); var o = S.ig, name = (o.name || "").trim(), handle = igClean(o.handle), s = byId(S.openId);
    if (!name) { o.err = "Name is required."; renderActs(); return; }
    if (!/^[A-Za-z0-9._]{1,60}$/.test(handle)) { o.err = "Enter the Instagram handle (letters, numbers, . and _)."; renderActs(); return; }
    if (!S.target) S.target = autoTarget(s);
    if (!S.target) { o.err = "All spots are filled — unfill one first."; renderActs(); return; }
    var sid = S.target; o.busy = true; o.err = null; renderActs();
    A.post(P + "/acts", { name: name, instagram: handle, invite: true }).then(function (a) {
      S.igByAct = S.igByAct || {}; S.igByAct[a.id] = handle;
      if (!((S.opts.acts || []).some(function (x) { return x.id === a.id; }))) S.opts.acts = (S.opts.acts || []).concat([{ id: a.id, name: a.name || name, instagram: a.instagram }]);
      return A.put(spotUrl(sid), { act_id: a.id }).then(reload).then(function () {
        S.ig = null; S.target = null; S.dm = null;
        smsg("Added " + name + " — nobody was contacted.", true);
        renderModal();
        if (invite) offerStart(sid); else renderActs();
      });
    }).catch(function (e) { if (S.ig) { S.ig.busy = false; S.ig.err = err(e); renderActs(); } else smsg(err(e)); });
  }
  function showDmFor(sid) {
    var p = findSpot(byId(S.openId), sid);
    A.get(spotUrl(sid) + "/offer/share").then(function (r) {
      var sh = r && r.share; if (!sh || !sh.instagram_dm_text) { smsg("No DM text available for this offer."); return; }
      S.dm = { text: sh.instagram_dm_text, handle: p ? igFor(p.act_id) : "" }; renderModal();
    }).catch(function (e) { smsg(err(e)); });
  }

  /* spot actions */
  function spotUrl(sid) { return P + "/shows/" + encodeURIComponent(S.openId) + "/spots" + (sid ? "/" + encodeURIComponent(sid) : ""); }
  function act(p, okText) { return p.then(reload).then(function () { if (okText) smsg(okText, true); }).catch(function (e) { smsg(err(e)); }); }
  function autoTarget(s) {
    var ord = function (c) { return sortedSpots(s, c).filter(function (p) { return !p.act_id; })[0]; };
    var p = ord("act") || ord("host") || ord("production"); return p ? p.id : null;
  }
  function fillWith(actId, extra) { act(A.put(spotUrl(S.target), { act_id: actId }), extra).then(function () { S.target = null; renderModal(); }); }
  function pick(btn) {
    var s = byId(S.openId), kind = btn.getAttribute("data-kind"), id = btn.getAttribute("data-id"), name = btn.getAttribute("data-name");
    if (!S.target) S.target = autoTarget(s);
    if (!S.target) { smsg("All spots are filled — unfill one first."); return; }
    if (kind === "mine") { fillWith(id); return; }
    var known = ((S.opts && S.opts.acts) || []).filter(function (a) { return String(a.name).toLowerCase() === String(name).toLowerCase(); })[0];
    if (known && kind === "dir") { fillWith(known.id); return; }
    A.post(P + "/acts", { name: name, person_id: /^\d+$/.test(id) ? parseInt(id, 10) : id }).then(function (a) {
      S.opts.acts = (S.opts.acts || []).concat([{ id: a.id, name: a.name || name, instagram: a.instagram }]);
      fillWith(a.id, "Added " + name + " to your acts — nobody was contacted.");
    }).catch(function (e) { smsg(err(e)); });
  }
  function move(sid, dir) {
    var s = byId(S.openId), p = findSpot(s, sid); if (!p) return;
    var ps = sortedSpots(s, p.category), i = ps.indexOf(p), j = i + dir; if (j < 0 || j >= ps.length) return;
    ps.splice(i, 1); ps.splice(j, 0, p); saveOrder(ps);
  }
  function saveOrder(ps) { var u = {}; ps.forEach(function (p, i) { u[p.id] = { order: i + 1 }; }); act(A.put(spotUrl(), { updates: u })); }
  function promptSet(sid, field) {
    var p = findSpot(byId(S.openId), sid), body = {};
    if (field === "len") {
      var x = window.prompt("Spot length in minutes (1-180)", p.spot_length || CAT[p.category][2]); if (x === null) return;
      x = parseInt(x, 10); if (!(x >= 1 && x <= 180)) { smsg("Enter a number between 1 and 180."); return; } body.spot_length = x;
    } else if (field === "status") {
      var st = window.prompt("Status (planning, offered, confirmed, rejected, cancelled, no-show)", p.status || "planning"); if (st === null || !st.trim()) return; body.status = st.trim();
    } else {
      var r = window.prompt("Role label", p.role || CAT[p.category][1]); if (r === null || !r.trim()) return; body.role = r.trim();
    }
    act(A.put(spotUrl(sid), body));
  }
  function focusPanel() { setTimeout(function () { var f = modal.querySelector(".bk-ipanel select, .bk-ipanel textarea, .bk-ipanel button"); if (f) f.focus(); }, 0); }
  function openLink(sp, then) {
    S.panel = { kind: "link", spot: sp, then: then || null, sugg: [], loading: true }; S.note = null; renderModal();
    var id = S.openId;
    A.get(P + "/shows/" + encodeURIComponent(id) + "/link").then(function (r) {
      if (!S.panel || S.openId !== id || S.panel.kind !== "link") return; S.panel.loading = false; S.panel.sugg = (r && r.suggestions) || []; renderModal(); focusPanel();
    }).catch(function (e) { if (S.panel) { S.panel.loading = false; S.panel.err = err(e); renderModal(); } });
  }
  function offerStart(sid) { var s = byId(S.openId); S.note = null; if (!s.link) { openLink(sid, "offer"); return; } S.panel = { kind: "offer", spot: sid }; renderModal(); focusPanel(); }
  function linkSave() {
    var sel = $("bk-link-sel"), Pn = S.panel; if (!sel || !sel.value) { if (Pn) { Pn.err = "Choose an Atlas show first."; renderModal(); } return; }
    var id = S.openId, then = Pn.then, sp = Pn.spot;
    A.put(P + "/shows/" + encodeURIComponent(id) + "/link", { show_series_id: /^\d+$/.test(sel.value) ? parseInt(sel.value, 10) : sel.value }).then(fetchShows).then(function () {
      S.panel = null; if (then === "offer" && sp !== "show") S.panel = { kind: "offer", spot: sp }; else S.note = { text: "Linked to your Atlas show." };
      renderModal(); if (S.panel) focusPanel();
    }).catch(function (e) { if (S.panel) { S.panel.err = err(e); renderModal(); } });
  }
  function offerSend() {
    var Pn = S.panel, sid = Pn.spot, s = byId(S.openId), p = findSpot(s, sid), ta = $("bk-offer-msg");
    var body = { person_id: p.person_id }, m = ta ? ta.value.trim().slice(0, 500) : ""; if (m) body.message = m;
    Pn.busy = true; Pn.err = null;
    A.post(spotUrl(sid) + "/offer", body).then(function (r) {
      var held = r && r.delivery && r.delivery.state === "held"; S.panel = null;
      S.note = held ? { text: "Offer created — this comic hasn't opted in to email, so send them the link yourself:", path: r.share_url_path } : { text: "Offer sent to " + p.act_name + ".", path: null };
      if (r && r.share && r.share.instagram_dm_text && (r.share.claim_url || held)) S.dm = { text: r.share.instagram_dm_text, handle: igFor(p.act_id) };
      return reload();
    }).catch(function (e) {
      var d = detailObj(e);
      if (d && d.error === "link_required") { S.panel = { kind: "link", spot: sid, then: "offer", sugg: d.suggestions || [] }; renderModal(); focusPanel(); return; }
      if (S.panel) { S.panel.busy = false; S.panel.err = err(e); renderModal(); }
    });
  }
  function withdraw(sid) {
    var p = findSpot(byId(S.openId), sid), nm = (p.offer && p.offer.stage_name) || p.act_name;
    if (!window.confirm("Withdraw the offer to " + nm + "?")) return; S.note = null;
    act(A.del(spotUrl(sid) + "/offer"), "Offer withdrawn.");
  }
  function onDragStart(ev) { var r = ev.target.closest && ev.target.closest(".bk-spot"); if (!r) return; drag = r; try { ev.dataTransfer.setData("text/plain", r.getAttribute("data-spot")); ev.dataTransfer.effectAllowed = "move"; } catch (e) {} }
  function onDragOver(ev) { var r = ev.target.closest && ev.target.closest(".bk-spot"); if (drag && r && r.getAttribute("data-cat") === drag.getAttribute("data-cat")) ev.preventDefault(); }
  function onDrop(ev) {
    var r = ev.target.closest && ev.target.closest(".bk-spot");
    if (!drag || !r || r === drag || r.getAttribute("data-cat") !== drag.getAttribute("data-cat")) { drag = null; return; }
    ev.preventDefault();
    var s = byId(S.openId), cat = drag.getAttribute("data-cat"), ps = sortedSpots(s, cat);
    var a = findSpot(s, drag.getAttribute("data-spot")), b = findSpot(s, r.getAttribute("data-spot"));
    ps.splice(ps.indexOf(a), 1); ps.splice(ps.indexOf(b), 0, a); drag = null; saveOrder(ps);
  }

  /* other tabs */
  function tagsKey(id) { return "bk-tags-" + id; }
  function getTags(id) { try { return JSON.parse(lsGet(tagsKey(id)) || "[]"); } catch (e) { return []; } }
  function showTab(s) {
    var lk = s.link, lkh = lk ? '<span>Atlas show: <b>' + E(lk.series_name) + "</b>" + (lk.event_id ? " · event #" + E(lk.event_id) : "") + '</span> <button type="button" class="bk-link" data-do="link-open">change</button>'
      : '<span class="bk-muted">Not linked to an Atlas show yet — link it to send offers</span> <button type="button" class="bk-link" data-do="link-open">link</button>';
    var m = s.meta || {}, tags = getTags(s.id);
    return '<div>' + lkh + "</div>" + panelHtml("show") + '<div class="bk-cols4" style="grid-template-columns:1fr 1fr 1fr"><div>' + field("bk-f-date", "Date", s.date, "date") + "</div><div>" + field("bk-f-time", "Start", s.time, "time") + "</div><div>" + field("bk-f-doors", "Doors", m.doors, "time") + "</div></div>" +
      '<label for="bk-f-venue">Venue</label><select id="bk-f-venue"><option value="">— venue —</option>' + opt(S.opts.venues, s.venue_id) + "</select>" +
      '<label for="bk-f-desc">Description</label><textarea id="bk-f-desc" rows="3">' + E(s.description || "") + "</textarea>" +
      '<label>Tags (kept in this browser)</label><div id="bk-tags">' + tags.map(function (t, i) { return '<span class="bk-tagchip">' + E(t) + ' <a href="#" data-do="tag-del" data-i="' + i + '" aria-label="Remove tag">✕</a></span>'; }).join("") + '</div><div class="bk-search"><input id="bk-f-tag" placeholder="Add a tag"><button type="button" class="secondary" data-do="tag-add">Add</button></div>' +
      '<p class="bk-muted" style="margin-top:8px">Production contacts: managed privately in confirmed — never shown here.</p>' +
      '<label><input type="checkbox" id="bk-f-pub" style="width:auto"' + (s.public ? " checked" : "") + '> Published</label>' +
      '<p style="margin-top:10px"><button type="button" data-do="save-show">Save</button></p><p class="bk-muted">Comics are never contacted from here — selecting a name only places it in your lineup.</p>';
  }
  function td(t) { var d = S.tabData[t]; return d ? (d.error ? '<div class="msg error">' + E(d.error) + "</div>" : null) : '<div class="bk-muted">Loading…</div>'; }
  var KINDS = [["overall", "Overall"], ["act_praise", "Act praise"], ["crew_praise", "Crew praise"], ["technical", "Technical"], ["act_issue", "Act issue"], ["audience_issue", "Audience issue"]];
  function notesTab() {
    var e = td("notes"); if (e) return e; var d = S.tabData.notes, rep = (d.report || []).slice().sort(function (a, b) { return String(b.ts) < String(a.ts) ? -1 : 1; });
    return '<label for="bk-n-rider">Tech rider (visible to crew)</label><textarea id="bk-n-rider" rows="4">' + E(d.tech_rider || "") + '</textarea><p><button type="button" data-do="rider-save">Save rider</button></p>' +
      '<h4 class="bk-rh">Show report</h4><div class="bk-search"><select id="bk-n-kind" style="width:auto">' + KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + "</option>"; }).join("") + '</select><input id="bk-n-text" placeholder="What happened?"><button type="button" data-do="report-add">Add</button></div>' +
      (rep.map(function (r) { return '<div class="bk-entry"><b>' + E((KINDS.filter(function (k) { return k[0] === r.kind; })[0] || [0, r.kind])[1]) + '</b> <span class="bk-muted">' + E(r.ts || "") + (r.by ? " · " + E(r.by) : "") + "</span><div>" + E(r.text) + "</div></div>"; }).join("") || '<div class="bk-muted">No entries yet.</div>');
  }
  function ticketsTab(s) {
    var m = s.meta || {};
    return field("bk-f-tix", "Tickets URL", m.tickets_url, "url") + field("bk-f-evt", "Event page URL", m.event_url, "url") + '<p><button type="button" data-do="save-meta">Save</button></p>' +
      '<h4 class="bk-rh">Ticket sales</h4><p class="bk-muted">Connect ticket imports in <a href="https://confirmed.show" rel="noopener" target="_blank">confirmed ↗</a></p>';
  }
  function checklistsTab() {
    var e = td("checklists"); if (e) return e; var items = S.tabData.checklists.items || [];
    return '<div class="bk-search"><input id="bk-c-new" placeholder="Add an item"><button type="button" data-do="ck-add">Add</button></div>' +
      (items.map(function (it) {
        return '<div class="bk-ck' + (it.done ? " done" : "") + '"><input type="checkbox" data-ck="' + E(it.id) + '"' + (it.done ? " checked" : "") + ' aria-label="Done"><span style="flex:1;cursor:pointer" data-do="ck-edit" data-id="' + E(it.id) + '" data-text="' + E(it.text) + '">' + E(it.text) + '</span><button type="button" class="ghost" data-do="ck-del" data-id="' + E(it.id) + '" aria-label="Delete">🗑</button></div>';
      }).join("") || '<div class="bk-muted" style="margin-top:8px">No checklist items yet.</div>');
  }
  function metaTab(s) {
    var m = s.meta || {};
    return field("bk-f-img", "Promo image (URL)", m.promo_image, "url") + '<label for="bk-f-blurb">Promo blurb</label><textarea id="bk-f-blurb" rows="4">' + E(m.promo_blurb || "") + "</textarea>" +
      ["Poster", "Thumbnail", "Social image"].map(function (n) { return '<label>' + n + '</label><input disabled placeholder="Generated in confirmed">'; }).join("") + '<p><button type="button" data-do="save-meta">Save</button></p>';
  }
  function changesTab() {
    var e = td("changes"); if (e) return e; var c = (S.tabData.changes.changes || []).slice().sort(function (a, b) { return String(b.ts) < String(a.ts) ? -1 : 1; });
    return c.map(function (x) { return '<div class="bk-entry"><b>' + E(x.action) + '</b> <span class="bk-muted">' + E(x.ts || "") + (x.by ? " · " + E(x.by) : "") + "</span><div>" + E(x.detail || "") + "</div></div>"; }).join("") || '<div class="bk-muted">No changes recorded.</div>';
  }
  function showUrl() { return P + "/shows/" + encodeURIComponent(S.openId); }
  function saveMeta() {
    var s = byId(S.openId), m = Object.assign({}, s.meta || {});
    [["bk-f-tix", "tickets_url"], ["bk-f-evt", "event_url"], ["bk-f-img", "promo_image"], ["bk-f-blurb", "promo_blurb"]].forEach(function (k) { var x = v(k[0]); if (x !== undefined) m[k[1]] = x; });
    act(A.put(showUrl(), { meta: m }), "Saved.");
  }
  function saveShow() {
    var s = byId(S.openId), m = Object.assign({}, s.meta || {}), doors = v("bk-f-doors"); if (doors !== undefined) m.doors = doors;
    var b = { date: v("bk-f-date"), time: v("bk-f-time"), description: v("bk-f-desc"), meta: m };
    if ($("bk-f-venue").value) b.venue_id = $("bk-f-venue").value;
    var pub = $("bk-f-pub").checked;
    A.put(showUrl(), b).then(function () { return pub !== !!s.public ? A.post(showUrl() + "/publish", { public: pub }) : null; }).then(reload).then(function () { smsg("Saved.", true); }).catch(function (e) { smsg(err(e)); });
  }
  function tabAct(p, url, then) { return p.then(function () { return A.get(showUrl() + url); }).then(function (r) { S.tabData[then] = r; $("bk-mbody").innerHTML = tabBody(byId(S.openId)); }).catch(function (e) { smsg(err(e)); }); }

  function onModalClick(ev) {
    var om = modal.querySelector(".bk-menu"); if (om) om.remove();
    var t = ev.target.closest("[data-tab],[data-do]");
    if (!t) { if (ev.target === modal) closeModal(); return; }
    var d = t.getAttribute("data-do"), sid = t.getAttribute("data-spot");
    if (t.hasAttribute("data-tab") && !d) { setTab(t.getAttribute("data-tab")); return; }
    if (d === "tag-del") ev.preventDefault();
    var h = {
      close: closeModal, history: function () { setTab("changes"); }, clock: function () { setTab("show"); },
      smenu: function () {
        var s = byId(S.openId), p = findSpot(s, sid), m = document.createElement("div");
        if (!p || (om && om.getAttribute("data-spot") === sid)) return;
        m.className = "bk-menu"; m.setAttribute("role", "menu"); m.setAttribute("data-spot", sid); m.innerHTML = menuItems(p); t.parentNode.appendChild(m);
      },
      sec: function () { var k = t.getAttribute("data-cat"); S.secs[k] = S.secs[k] !== true; renderModal(); },
      target: function () { S.target = sid; renderModal(); },
      offer: function () { offerStart(sid); }, "offer-send": offerSend, withdraw: function () { withdraw(sid); },
      share: function () { copy(link(t.getAttribute("data-path")), $("bk-smsg")); },
      "link-open": function () { openLink("show", null); }, "link-save": linkSave, "panel-x": function () { S.panel = null; renderModal(); },
      unfill: function () { act(A.put(spotUrl(sid), { unfill: true })); },
      up: function () { move(sid, -1); }, down: function () { move(sid, 1); },
      len: function () { promptSet(sid, "len"); }, role: function () { promptSet(sid, "role"); }, status: function () { promptSet(sid, "status"); },
      sort: function () { S.sort = S.sort === "az" ? "booked" : "az"; renderActs(); },
      pick: function () { pick(t); },
      dm: function () { showDmFor(sid); },
      "ig-open": function () { S.ig = { open: true, name: t.getAttribute("data-name") || S.aq.trim(), handle: "" }; renderActs(); var i = $("bk-ig-handle"); if (i) i.focus(); },
      "ig-x": function () { S.ig = null; renderActs(); },
      "ig-find": function () { igSync(); igFind(S.ig && S.ig.name); },
      "ig-add": function () { igSubmit(false); }, "ig-add-invite": function () { igSubmit(true); },
      "dm-copy": function () {
        var ta = $("bk-dm-text"), m = $("bk-dm-msg"), tx = ta ? ta.value : "";
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tx).then(function () { msg(m, "DM text copied.", true); }).catch(function () { if (ta) { ta.select(); } msg(m, "Press Ctrl/Cmd+C to copy.", true); });
        else { if (ta) ta.select(); msg(m, "Press Ctrl/Cmd+C to copy.", true); }
      },
      "dm-x": function () { S.dm = null; renderModal(); },
      "save-show": saveShow, "save-meta": saveMeta,
      "tag-add": function () { var x = v("bk-f-tag"); if (!x) return; var a = getTags(S.openId); a.push(x); lsSet(tagsKey(S.openId), JSON.stringify(a)); renderModal(); },
      "tag-del": function () { var a = getTags(S.openId); a.splice(+t.getAttribute("data-i"), 1); lsSet(tagsKey(S.openId), JSON.stringify(a)); renderModal(); },
      "rider-save": function () { A.put(showUrl() + "/notes", { tech_rider: $("bk-n-rider").value }).then(function () { smsg("Saved.", true); }).catch(function (e) { smsg(err(e)); }); },
      "report-add": function () {
        var x = v("bk-n-text"); if (!x) return;
        tabAct(A.put(showUrl() + "/notes", { add_report: { kind: $("bk-n-kind").value, text: x } }), "/notes", "notes");
      },
      "ck-add": function () { var x = v("bk-c-new"); if (!x) return; tabAct(A.post(showUrl() + "/checklists", { text: x }), "/checklists", "checklists"); },
      "ck-edit": function () {
        var x = window.prompt("Edit item", t.getAttribute("data-text")); if (x === null || !x.trim()) return;
        tabAct(A.put(showUrl() + "/checklists/" + encodeURIComponent(t.getAttribute("data-id")), { text: x.trim() }), "/checklists", "checklists");
      },
      "ck-del": function () { tabAct(A.del(showUrl() + "/checklists/" + encodeURIComponent(t.getAttribute("data-id"))), "/checklists", "checklists"); }
    }[d];
    if (h) h();
  }
  function onModalChange(ev) {
    var id = ev.target.getAttribute && ev.target.getAttribute("data-ck");
    if (id) tabAct(A.put(showUrl() + "/checklists/" + encodeURIComponent(id), { done: ev.target.checked }), "/checklists", "checklists");
  }

  /* ---------- global wiring ---------- */
  function wire() {
    main = $("bk-main"); modal = $("bk-modal"); drawer = $("bk-drawer");
    $("bk-burger").onclick = function () { $("bk-app").classList.toggle("open"); };
    $("bk-scrim").onclick = function () { $("bk-app").classList.remove("open"); };
    $("bk-side").addEventListener("click", function (ev) {
      var g = ev.target.closest("[data-go]"), ty = ev.target.closest("[data-type]");
      if (ev.target.closest(".bk-cog[href]")) return;
      if (g) {
        var k = g.getAttribute("data-go");
        if (k === "settings") { settingsOpen = !settingsOpen || S.page !== "settings"; go("#settings/" + subPage); renderSide(); return; }
        go("#" + k);
      } else if (ty) go("#shows/" + encodeURIComponent(ty.getAttribute("data-type")));
    });
    $("bk-side").addEventListener("keydown", function (ev) { var ty = ev.target.closest("[data-type]"); if (ty && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go("#shows/" + encodeURIComponent(ty.getAttribute("data-type"))); } });
    main.addEventListener("input", function (ev) {
      if (ev.target.id === "bk-filter") { S.q = ev.target.value; renderShows(); }
      if (ev.target.id === "bk-aq") { S.aq = ev.target.value; clearTimeout(timer); timer = setTimeout(loadActs, 250); }
    });
    main.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t.id === "bk-type") { go(t.value ? "#shows/" + encodeURIComponent(t.value) : "#shows"); }
      else if (t.id === "bk-all") { allVisible().forEach(function (s) { S.sel[s.id] = t.checked; }); renderShows(); }
      else if (t.hasAttribute("data-sel")) { S.sel[t.getAttribute("data-sel")] = t.checked; renderShows(); }
    });
    main.addEventListener("click", function (ev) {
      var t = ev.target, b;
      if (t.hasAttribute("data-sel")) { ev.stopPropagation(); return; }
      if ((b = t.closest("[data-menu]"))) { ev.stopPropagation(); openMenu(b); return; }
      if ((b = t.closest("[data-m]"))) {
        var id = b.getAttribute("data-id"); closeMenus();
        if (b.getAttribute("data-m") === "open") go("#show/" + encodeURIComponent(id)); else togglePublish(id).then(reload).catch(function (e) { window.alert(err(e)); });
        return;
      }
      if ((b = t.closest("[data-offtab]"))) { S.offTab = b.getAttribute("data-offtab"); drawOffers(); return; }
      if ((b = t.closest("[data-offdo]"))) { offerAction(b); return; }
      if ((b = t.closest("[data-venue]"))) { var vid = b.getAttribute("data-venue"); venueDrawer((S.venues || []).filter(function (x) { return String(x.id) === vid; })[0]); return; }
      if ((b = t.closest("[data-view]"))) { S.view = b.getAttribute("data-view"); renderShows(); return; }
      if ((b = t.closest("[data-group]"))) {
        var k = b.getAttribute("data-group"); S.collapsed[k] = S.collapsed[k] !== true;
        if (k === "past" && !S.collapsed.past && !S.pastShows) fetchPast().then(renderShows).catch(function (e) { window.alert(err(e)); });
        renderShows(); return;
      }
      if ((b = t.closest("[data-do]"))) {
        var d = b.getAttribute("data-do"), f = {
          "onb-x": function () { lsSet("bk-onboard-off", "1"); renderShows(); }, fset: function () { S.q = ""; S.typeId = ""; S.sel = {}; go("#shows"); renderShows(); },
          "new": newShowDrawer, csv: dlCsv, "bulk-pub": function () { bulkPub(true); }, "bulk-unpub": function () { bulkPub(false); },
          "cal-prev": function () { shiftMon(-1); }, "cal-next": function () { shiftMon(1); }, "day-prev": function () { shiftDay(-1); }, "day-next": function () { shiftDay(1); },
          "venue-new": function () { venueDrawer(null); }, "act-new": actDrawer,
          "acts-csv": function () { download("acts.csv", csv([["name", "instagram", "atlas", "booked_count"]].concat((S.actsList || []).map(function (a) { return [a.name, a.instagram || "", a.person_id ? "yes" : "no", a.booked_count || 0]; })))); },
          "prod-save": function () { lsSet("bk-prod", JSON.stringify({ name: v("ps-name"), logo: v("ps-logo"), ig: v("ps-ig"), web: v("ps-web") })); smsg("Saved in this browser.", true); }
        }[d];
        if (f) { f(); return; }
      }
      if ((b = t.closest("[data-id]")) && (b.classList.contains("bk-row") || b.classList.contains("bk-ev"))) go("#show/" + encodeURIComponent(b.getAttribute("data-id")));
    });
    main.addEventListener("keydown", function (ev) {
      if (ev.target.classList && ev.target.classList.contains("bk-row") && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go("#show/" + encodeURIComponent(ev.target.getAttribute("data-id"))); }
    });
    document.addEventListener("click", function (ev) { if (!ev.target.closest(".bk-menuwrap")) closeMenus(); });
    modal.addEventListener("click", onModalClick); modal.addEventListener("input", onModalInput); modal.addEventListener("change", onModalChange);
    modal.addEventListener("dragstart", onDragStart); modal.addEventListener("dragover", onDragOver); modal.addEventListener("drop", onDrop);
    drawer.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-dr]");
      if (ev.target === drawer || (b && b.getAttribute("data-dr") === "x")) closeDrawer();
      else if (b && drawer._save) drawer._save();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (!drawer.hidden) closeDrawer(); else if (!modal.hidden) { if (S.panel) { S.panel = null; renderModal(); } else closeModal(); }
    });
    window.addEventListener("hashchange", route);
  }
  function start(r) {
    $("bk-app").style.display = ""; var nm = (r && (r.stage_name || r.email)) || "";
    $("bk-uname").textContent = nm; $("bk-uav").textContent = initials(nm);
    var st = {}; try { st = JSON.parse(lsGet("bk-prod") || "{}"); } catch (e) {}
    if (st.name) document.title = st.name + " — Booking";
    wire(); boot();
  }
  (A.meIfSession ? A.meIfSession() : A.me()).then(function (r) { if (!r) throw new Error("no session"); start(r); }).catch(function () {
    $("bk-signedout").style.display = "block";
    setTimeout(function () { location.href = "/comedy-atlas/login.html?role=booker&next=/comedy-atlas/booking.html"; }, 1200);
  });
})();
