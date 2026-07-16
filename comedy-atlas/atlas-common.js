/*
 * COMEDY ATLAS — shared client helpers (site/comedy-atlas/atlas-common.js)
 *
 * Loaded by both index.html (hub) and city.html (per-city view). No build
 * step, no external CDN — plain script tag, same-origin fetch only.
 *
 * Data contract: data/comedy-atlas/upcoming_events.json + MANIFEST.json,
 * published by scripts/publish_atlas_data.py from the public_upcoming_events
 * view (migration 0046). That view is NOT city-scoped — it already carries
 * every city with approved, English-only (or explicitly-null-language)
 * upcoming events, so both pages read the exact same file.
 */
(function (global) {
  "use strict";

  var DATA_URL = "../data/comedy-atlas/upcoming_events.json";
  var MANIFEST_URL = "../data/comedy-atlas/MANIFEST.json";

  // Known Edinburgh Fringe free-festival umbrella organizations. These are
  // ORG names that appear on Edinburgh events (source IS the org — see
  // BUILD_STATE.md "EDINBURGH" section) — there is no separate `festivals`
  // table row for them yet (public_festivals is empty today), so the
  // festivals section is derived directly from event organizer names.
  var FESTIVAL_ORGS = ["PBH's Free Fringe", "Laughing Horse Free Festival"];

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDayHeading(d) {
    return d.toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris"
    });
  }

  function fmtTime(d) {
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris"
    });
  }

  // Price 0 always renders as "Free" — true both for Paris free open-mics
  // and for every Edinburgh Free Fringe / Laughing Horse show (donation
  // model, price_min = 0.00 in the data, never a real currency amount).
  function fmtPrice(ev) {
    if (ev.price_min == null && ev.price_max == null) return null;
    var cur = ev.currency ? (" " + ev.currency) : "";
    if (ev.price_min != null && ev.price_max != null && ev.price_min !== ev.price_max) {
      if (ev.price_min === 0) return "Free" + (ev.price_max ? (" – " + ev.price_max + cur) : "");
      return ev.price_min + "–" + ev.price_max + cur;
    }
    var p = ev.price_min != null ? ev.price_min : ev.price_max;
    return (Number(p) === 0 ? "Free" : (p + cur));
  }

  function statusBadge(ev) {
    if (ev.status === "cancelled") return '<span class="badge cancelled">Cancelled</span>';
    if (ev.sold_out_status === "sold_out") return '<span class="badge soldout">Sold out</span>';
    return '<span class="badge verified">Verified</span>';
  }

  // Defense in depth, mirroring publish_atlas_data.py's own French refusal:
  // never RENDER a French-labeled event even if one somehow reached the
  // JSON. Never infers language for anything the data leaves blank.
  function dropFrench(events) {
    return events.filter(function (ev) { return ev.language !== "fr"; });
  }

  // --- Format derivation (Phase-3 listing-filtering-ux, 2026-07-14) -------
  // The canonical `genre` column is populated for a minority of rows today
  // (see docs/research/listing-filtering-ux-2026-07-14.md — Edinburgh export
  // is ~23% "standup", the rest "unknown"; this is a DATA GAP in the
  // upstream pipeline, not something this client-side code can fully close).
  // We derive a best-effort format from genre + title keywords so the format
  // filter/grid has real, non-fabricated buckets. Anything we can't place
  // goes in "unclassified" rather than being guessed into "Stand-up" —
  // never invent a fact the data doesn't support.
  var FORMAT_LABELS = {
    standup: "Stand-up",
    improv: "Improv",
    showcase: "Showcase",
    openmic: "Open Mic",
    sketch: "Sketch / Variety",
    unclassified: "Unclassified"
  };

  function deriveFormat(ev) {
    var title = (ev.title || "").toLowerCase();
    if (/\bopen mic\b/.test(title)) return "openmic";
    if (/\bimprov/.test(title)) return "improv";
    if (/\bshowcase\b/.test(title)) return "showcase";
    if (/\bsketch\b/.test(title)) return "sketch";
    if (ev.genre === "standup") return "standup";
    return "unclassified";
  }

  // --- Time-bucket helpers --------------------------------------------
  // All bucketing is done against Europe/Paris wall-clock "now", matching
  // the existing day-heading convention in renderEventCards. This does NOT
  // correct the upstream offset quirk visible in some Edinburgh starts_at
  // values (data-quality issue, out of scope here) — it only keeps "today" /
  // "this weekend" consistent with what the page already renders.
  function parisNow() {
    var s = new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" });
    return new Date(s);
  }

  function parisDateKey(d) {
    return d.toLocaleDateString("en-GB", { timeZone: "Europe/Paris" });
  }

  function parisHour(d) {
    return Number(d.toLocaleString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }));
  }

  // Returns { tonight: fn, weekend: fn, week: fn, day: fn(dateKey) } — each
  // fn(date) -> bool, evaluated against a fixed "now" so every card in one
  // render pass is judged against the same instant.
  function makeTimeBuckets(now) {
    now = now || parisNow();
    var todayKey = parisDateKey(now);
    // Weekend = the Fri/Sat/Sun containing "now" if now is already Fri-Sun,
    // else the coming Fri-Sun. JS getDay(): 0=Sun..6=Sat.
    var dow = now.getDay();
    var daysToFriday = (5 - dow + 7) % 7; // 0 if today is already Friday
    if (dow === 6) daysToFriday = -1; // Saturday: weekend already started
    if (dow === 0) daysToFriday = -2; // Sunday: weekend already started
    var friStart = new Date(now.getTime());
    friStart.setDate(friStart.getDate() + daysToFriday);
    friStart.setHours(0, 0, 0, 0);
    var sunEnd = new Date(friStart.getTime());
    sunEnd.setDate(sunEnd.getDate() + 2);
    sunEnd.setHours(23, 59, 59, 999);

    var weekEnd = new Date(now.getTime());
    weekEnd.setDate(weekEnd.getDate() + 7);

    return {
      tonight: function (d) { return parisDateKey(d) === todayKey && d.getTime() >= now.getTime(); },
      weekend: function (d) { return d.getTime() >= friStart.getTime() && d.getTime() <= sunEnd.getTime() && d.getTime() >= now.getTime(); },
      week: function (d) { return d.getTime() >= now.getTime() && d.getTime() <= weekEnd.getTime(); },
      day: function (d, dateKey) { return parisDateKey(d) === dateKey; },
      timeOfDay: function (d, bucket) {
        var h = parisHour(d);
        if (bucket === "afternoon") return h >= 12 && h < 17;
        if (bucket === "evening") return h >= 17 && h < 21;
        if (bucket === "late") return h >= 21 || h < 4;
        return true;
      }
    };
  }

  function fetchEvents() {
    return fetch(DATA_URL, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      if (!Array.isArray(data)) throw new Error("unexpected payload shape");
      return dropFrench(data);
    });
  }

  function fetchManifest() {
    return fetch(MANIFEST_URL, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("no manifest"); return r.json(); })
      .catch(function () { return null; });
  }

  function setFreshness(dotEl, textEl, manifest) {
    if (!manifest || !manifest.generated_at) {
      textEl.textContent = "Freshness unknown.";
      dotEl.classList.add("stale");
      return;
    }
    var when = new Date(manifest.generated_at);
    if (isNaN(when.getTime())) {
      textEl.textContent = "Freshness unknown.";
      dotEl.classList.add("stale");
      return;
    }
    var ageHours = (Date.now() - when.getTime()) / 36e5;
    if (ageHours > 48) dotEl.classList.add("stale");
    textEl.textContent = "Data updated " + when.toLocaleString("en-GB", {
      timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    }) + " (Paris time).";
  }

  function groupByCity(events) {
    var counts = {};
    events.forEach(function (ev) {
      var city = ev.city_name || "Unknown";
      counts[city] = (counts[city] || 0) + 1;
    });
    return Object.keys(counts).map(function (city) {
      return { city: city, count: counts[city] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  function groupFestivals(events) {
    var counts = {};
    events.forEach(function (ev) {
      if (FESTIVAL_ORGS.indexOf(ev.organization_name) === -1) return;
      var key = ev.organization_name + "||" + (ev.city_name || "");
      if (!counts[key]) counts[key] = { org: ev.organization_name, city: ev.city_name, count: 0 };
      counts[key].count += 1;
    });
    return Object.keys(counts).map(function (k) { return counts[k]; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // Groups already-filtered events into day-buckets in chronological order,
  // then returns the HTML for the shared event-card list markup. Used by
  // both the hub's "recently verified" strip (small N) and the full
  // per-city view (all matching events).
  function renderEventCards(events) {
    var withDates = events.map(function (ev) {
      return { ev: ev, d: new Date(ev.starts_at) };
    }).filter(function (x) {
      return !isNaN(x.d.getTime());
    }).sort(function (a, b) { return a.d - b.d; });

    var groups = [];
    var lastKey = null;
    withDates.forEach(function (x) {
      var key = x.d.toLocaleDateString("en-GB", { timeZone: "Europe/Paris" });
      if (key !== lastKey) {
        groups.push({ key: key, day: x.d, items: [] });
        lastKey = key;
      }
      groups[groups.length - 1].items.push(x);
    });

    var html = "";
    groups.forEach(function (g) {
      html += '<section class="day-group">';
      html += '<div class="day-heading">' + escapeHtml(fmtDayHeading(g.day)) + '</div>';
      g.items.forEach(function (x) {
        var ev = x.ev;
        var venueBit = ev.venue_name ? escapeHtml(ev.venue_name) : null;
        var orgBit = ev.organization_name ? escapeHtml(ev.organization_name) : null;
        var price = fmtPrice(ev);
        var metaParts = [];
        if (venueBit) metaParts.push(venueBit);
        if (orgBit && orgBit !== venueBit) metaParts.push(orgBit);
        if (ev.language === "en") metaParts.push("English");
        if (price) metaParts.push(price);
        var meta = metaParts.join(' <span class="sep">·</span> ');

        // Ticket-referral click-tracking (D1, docs/ATLAS_ROADMAP_DECISIONS_2026-07-16.md):
        // every outbound ticket link routes through go.html rather than
        // linking straight to canonical_event_url. go.html allowlists the
        // destination, appends any future PARTNER_PARAMS, and its own page
        // load is the click-count evidence (see go.html + atlas-track.js).
        var hasUrl = ev.canonical_event_url && /^https?:\/\//.test(ev.canonical_event_url);
        var ticket = "";
        if (hasUrl) {
          var destHost = "";
          try { destHost = new URL(ev.canonical_event_url).hostname.replace(/^www\./, ""); } catch (_) { destHost = ""; }
          var goHref = "go.html?e=" + encodeURIComponent(ev.id) + (destHost ? "&dest=" + encodeURIComponent(destHost) : "");
          ticket = '<a class="ticket-link" href="' + escapeHtml(goHref) + '" rel="noopener noreferrer" target="_blank">Official tickets →</a>';
        } else {
          ticket = '<span class="ticket-link disabled">No ticket link yet</span>';
        }

        html += '<article class="event-card">';
        html += '  <div class="event-top">';
        html += '    <div class="event-title">' + escapeHtml(ev.title || "Untitled show") + "</div>";
        html += '    <div class="event-time">' + escapeHtml(fmtTime(x.d)) + "</div>";
        html += "  </div>";
        html += '  <div class="event-meta">' + meta + " " + statusBadge(ev) + "</div>";
        html += '  <div class="event-actions">' + ticket + "</div>";
        html += "</article>";
      });
      html += "</section>";
    });
    return html;
  }

  global.AtlasCommon = {
    DATA_URL: DATA_URL,
    MANIFEST_URL: MANIFEST_URL,
    FESTIVAL_ORGS: FESTIVAL_ORGS,
    escapeHtml: escapeHtml,
    fmtDayHeading: fmtDayHeading,
    fmtTime: fmtTime,
    fmtPrice: fmtPrice,
    statusBadge: statusBadge,
    dropFrench: dropFrench,
    fetchEvents: fetchEvents,
    fetchManifest: fetchManifest,
    setFreshness: setFreshness,
    groupByCity: groupByCity,
    groupFestivals: groupFestivals,
    renderEventCards: renderEventCards,
    FORMAT_LABELS: FORMAT_LABELS,
    deriveFormat: deriveFormat,
    parisNow: parisNow,
    parisDateKey: parisDateKey,
    makeTimeBuckets: makeTimeBuckets
  };
})(window);
