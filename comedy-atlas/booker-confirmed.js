/* booker-confirmed.js -- "Programme your shows" card (My shows tab).
   Talks ONLY to our own /booker/confirmed/* API; the confirmed.show key
   lives on the server. Text credit "Powered by confirmed.show" is in the
   page markup (no logo until confirmed.show gives permission:
   CSS hook .confirmed-credit-logo). */
(function () {
  "use strict";
  var A = window.AtlasAuth, E = A.escapeHtml, root = document.getElementById("cf-root");
  if (!root) return;
  var opts = null, loaded = false, openId = null;
  function $(id) { return document.getElementById(id); }
  function msg(el, text, ok) { el.textContent = text || ""; el.className = "msg " + (ok ? "ok" : "error"); }
  function err(e) { return (e && e.message) || "Something went wrong - try again."; }

  function load() {
    $("cf-list").innerHTML = '<div class="privacy">Loading your shows…</div>';
    return Promise.all([A.get("/booker/confirmed/options"), A.get("/booker/confirmed/shows")]).then(function (r) {
      opts = r[0]; fillForm(); render(r[1].shows);
    }).catch(function (e) {
      $("cf-list").innerHTML = '<div class="msg error">' + E(err(e)) + ' <button type="button" class="secondary" id="cf-retry">Retry</button></div>';
      $("cf-retry").onclick = function () { loaded = false; ensure(); };
    });
  }
  function ensure() { if (!loaded) { loaded = true; load(); } }
  function refresh() {
    return A.get("/booker/confirmed/shows").then(function (r) { render(r.shows); }).catch(function (e) { msg($("cf-new-msg"), err(e)); });
  }
  function opt(rows, val, label, sel) {
    return rows.map(function (x) { return '<option value="' + E(x[val]) + '"' + (x[val] === sel ? " selected" : "") + ">" + E(x[label]) + "</option>"; }).join("");
  }
  function fillForm() {
    $("cf-type").innerHTML = opt(opts.types, "id", "name");
    $("cf-venue").innerHTML = '<option value="">— venue —</option>' + opt(opts.venues, "id", "name");
  }
  function badge(s) {
    return s.public ? '<span class="cf-badge cf-live">Published</span>' : '<span class="cf-badge">Private</span>';
  }
  function render(shows) {
    var box = $("cf-list");
    if (!shows.length) { box.innerHTML = '<div class="privacy">No shows yet. Create your first one below.</div>'; return; }
    box.innerHTML = shows.map(function (s) {
      var open = s.id === openId;
      return '<div class="cf-show' + (open ? " open" : "") + '" data-id="' + E(s.id) + '">' +
        '<button type="button" class="cf-head" aria-expanded="' + open + '" data-act="toggle">' +
        '<span class="cf-date">' + E(s.date) + " · " + E(s.time) + '</span>' +
        '<span class="cf-title">' + E(s.type_name) + (s.venue_name ? " · " + E(s.venue_name) : "") + '</span>' +
        '<span class="cf-fill">' + s.filled + "/" + s.total + " filled</span>" + badge(s) + "</button>" +
        (open ? body(s) : "") + "</div>";
    }).join("");
  }
  function body(s) {
    var spots = s.spots.map(function (p) {
      var o = '<option value="">— empty —</option>' + opt(opts.acts, "id", "name", p.act_id);
      return '<div class="cf-spot"><span class="cf-spot-l">' + E(p.category === "host" ? "Host" : "Act " + p.order) +
        (p.start ? " · " + E(p.start) : "") + '</span><select data-act="fill" data-spot="' + E(p.id) + '" aria-label="Spot">' + o + "</select></div>";
    }).join("");
    var m = s.meta || {};
    return '<div class="cf-body">' +
      '<h3>Lineup</h3>' + spots +
      '<div class="row"><div><label>Add a comic</label><input data-f="an" placeholder="Name"></div>' +
      '<div><label>Instagram</label><input data-f="ai" placeholder="@handle"></div></div>' +
      '<button type="button" class="secondary" data-act="addact">Add comic</button>' +
      '<h3>Show page</h3>' +
      '<label>Ticket link</label><input data-f="tickets_url" value="' + E(m.tickets_url || "") + '" placeholder="https://…">' +
      '<label>Promo image link</label><input data-f="promo_image" value="' + E(m.promo_image || "") + '" placeholder="https://…">' +
      '<label>Blurb</label><textarea data-f="promo_blurb" rows="3" maxlength="1000">' + E(m.promo_blurb || "") + "</textarea>" +
      '<div class="cf-actions"><button type="button" data-act="savemeta">Save details</button>' +
      '<button type="button" class="secondary" data-act="publish" data-pub="' + (s.public ? "0" : "1") + '">' + (s.public ? "Unpublish" : "Publish") + "</button></div>" +
      '<div class="msg" data-m></div>' +
      '<p class="privacy cf-credit-line">Show programming powered by <a href="https://confirmed.show" rel="noopener" target="_blank">confirmed.show</a></p></div>';
  }
  root.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.tagName === "SELECT") return;
    var card = b.closest(".cf-show"), id = card && card.dataset.id, m = card && card.querySelector("[data-m]");
    var act = b.dataset.act;
    if (act === "toggle") { openId = (openId === id) ? null : id; return refresh(); }
    function f(n) { var e = card.querySelector('[data-f="' + n + '"]'); return e ? e.value.trim() : ""; }
    if (act === "savemeta") {
      b.disabled = true; msg(m, "Saving…", true);
      A.put("/booker/confirmed/shows/" + id, {meta: {tickets_url: f("tickets_url"), promo_image: f("promo_image"), promo_blurb: f("promo_blurb")}})
        .then(function () { msg(m, "Saved.", true); }).catch(function (e) { msg(m, err(e)); }).then(function () { b.disabled = false; });
    } else if (act === "publish") {
      b.disabled = true; msg(m, "Updating…", true);
      A.post("/booker/confirmed/shows/" + id + "/publish", {public: b.dataset.pub === "1"})
        .then(refresh).catch(function (e) { msg(m, err(e)); b.disabled = false; });
    } else if (act === "addact") {
      var name = f("an"); if (!name) return msg(m, "Enter the comic's name.");
      b.disabled = true; msg(m, "Adding…", true);
      A.post("/booker/confirmed/acts", {name: name, instagram: f("ai") || null}).then(function (a) {
        opts.acts.push({id: a.id, name: a.name, instagram: a.instagram}); return refresh().then(function () {
          var c = document.querySelector('.cf-show[data-id="' + id + '"] [data-m]'); if (c) msg(c, a.name + " added - pick them in a spot.", true); });
      }).catch(function (e) { msg(m, err(e)); b.disabled = false; });
    }
  });
  root.addEventListener("change", function (ev) {
    var sel = ev.target; if (sel.dataset.act !== "fill") return;
    var card = sel.closest(".cf-show"), m = card.querySelector("[data-m]");
    sel.disabled = true; msg(m, "Saving…", true);
    A.put("/booker/confirmed/shows/" + card.dataset.id + "/spots/" + sel.dataset.spot, {act_id: sel.value || null})
      .then(function () { msg(m, "Lineup saved.", true); }).catch(function (e) { msg(m, err(e)); })
      .then(function () { sel.disabled = false; });
  });
  $("cf-create").addEventListener("click", function () {
    var m = $("cf-new-msg"), b = this;
    var body = {date: $("cf-date").value, time: $("cf-time").value, type: $("cf-type").value,
                venue_id: $("cf-venue").value || null, acts: parseInt($("cf-acts").value || "3", 10), hosts: 1};
    if (!body.date || !body.time) return msg(m, "Pick a date and a start time.");
    b.disabled = true; msg(m, "Creating…", true);
    A.post("/booker/confirmed/shows", body).then(function (r) {
      openId = (r.created || [])[0] || null; msg(m, "Show created.", true); return refresh();
    }).catch(function (e) { msg(m, err(e)); }).then(function () { b.disabled = false; });
  });
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest('.tab2[data-t="shows"], .tab2[data-t="lineups"]'); if (t) ensure();
    if (ev.target.id === "cf-goto") { ev.preventDefault(); var s = document.querySelector('.tab2[data-t="shows"]'); if (s) s.click(); }
  });
  if (document.querySelector('.tab2[data-t="shows"].active')) ensure();
})();
