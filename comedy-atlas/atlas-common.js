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

  // --- Duration derivation (Phase 3b deliverable #6, 2026-07-17) ----------
  // event_instances.ends_at is real, source-parsed data (never a fabricated
  // default -- pipeline/parse.py leaves it NULL rather than guess a bad one)
  // and is populated for ~100% of upcoming rows today. BUT: for umbrella
  // festival listings where venue_name is null (Edinburgh PBH/Laughing Horse
  // -- the organizer's whole run stands in for a venue, see the file-header
  // note above and atlas-common's own FESTIVAL_ORGS), starts_at/ends_at span
  // the ENTIRE announced run (verified: median ~90min for venued rows vs.
  // multi-day spans for umbrella rows) -- using that span as a per-show
  // duration would be actively misleading, not just imprecise. So duration
  // is derived ONLY for events with a real venue_name; umbrella rows return
  // null (excluded from the facet entirely, never bucketed into a wrong
  // guess) rather than fabricate a number the data doesn't support.
  var DURATION_LABELS = {
    under45: "Under 45 min",
    "45to90": "45–90 min",
    over90: "Over 90 min"
  };

  function deriveDurationBucket(ev) {
    if (!ev.venue_name) return null; // umbrella listing -- span is unreliable
    if (!ev.starts_at || !ev.ends_at) return null;
    var start = new Date(ev.starts_at);
    var end = new Date(ev.ends_at);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    var minutes = (end.getTime() - start.getTime()) / 60000;
    if (minutes <= 0) return null; // degenerate/equal timestamps -- unknown, not zero
    if (minutes <= 45) return "under45";
    if (minutes <= 90) return "45to90";
    return "over90";
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

    // "Tonight" cutoff (Robert, 2026-07-18): extends past midnight to 4am,
    // a standard nightlife-industry convention -- a show starting at 1am is
    // still "tonight" to a real visitor, not "tomorrow". Mirrors the exact
    // same anchor logic as apps/atlas_api/main.py's /shows/near default
    // window so the UI and API never disagree: if it's already past 4am,
    // tonight's window runs through 4am TOMORROW; if it's still before 4am,
    // tonight already started yesterday evening and its window closes at
    // 4am TODAY (no reset to a "new tonight" at midnight).
    var tonightCutoff = new Date(now.getTime());
    if (parisHour(now) < 4) {
      tonightCutoff.setHours(4, 0, 0, 0);
    } else {
      tonightCutoff.setDate(tonightCutoff.getDate() + 1);
      tonightCutoff.setHours(4, 0, 0, 0);
    }

    return {
      tonight: function (d) { return d.getTime() >= now.getTime() && d.getTime() < tonightCutoff.getTime(); },
      weekend: function (d) { return d.getTime() >= friStart.getTime() && d.getTime() <= sunEnd.getTime() && d.getTime() >= now.getTime(); },
      week: function (d) { return d.getTime() >= now.getTime() && d.getTime() <= weekEnd.getTime(); },
      day: function (d, dateKey) { return parisDateKey(d) === dateKey; },
      timeOfDay: function (d, bucket) {
        var h = parisHour(d);
        if (bucket === "morning") return h >= 4 && h < 12;
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

        // 2026-07-18, Robert (4th report of this exact bug class): the
        // card's ONLY clickable element used to be the "Official tickets"
        // button, going straight to go.html -> the real ticket seller --
        // the event's own dedicated page was never linked from here at
        // all, even though it has always existed and worked when visited
        // directly. This is exactly the "listing card MUST link to our
        // own event page" rule (spec/phase-3b-fan-experience.md's Standing
        // rules #1) -- satisfied on the static SEO pages
        // (scripts/generate_entity_pages.py) but never built into THIS
        // renderer, the one real visitors actually browse (city.html,
        // linked from the homepage). Title now links to the event's own
        // page; "Official tickets" stays as a distinct, clearly secondary
        // action for tracked ticket-referral clicks (a real, separate
        // metric this product also cares about), unchanged.
        var eventHref = ev.slug ? "event/" + encodeURIComponent(ev.slug) + "/" : null;
        var titleHtml = escapeHtml(ev.title || "Untitled show");
        if (eventHref) {
          titleHtml = '<a class="event-title-link" href="' + escapeHtml(eventHref) + '">' + titleHtml + "</a>";
        }

        html += '<article class="event-card">';
        html += '  <div class="event-top">';
        html += '    <div class="event-title">' + titleHtml + "</div>";
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

  // --- Recurring-show grouping (Phase 3b refinement, 2026-07-18) ---------
  // A single show_series (the recurring show, e.g. "Laughing Spree Comedy")
  // can have dozens of individual event_instances (dated occurrences) live
  // at once -- confirmed live on Berlin's city page: 64 listed events, only
  // 10 distinct show titles, one show appearing as 21 separate full-width
  // duplicate cards with no grouping (BUILD_STATE.md frontend-audit finding,
  // 2026-07-17). Groups an already-filtered event list into one entry per
  // recurring show -- keyed by show_series_id (migration 0079/0086, already
  // present on public_upcoming_events / upcoming_events.json) when present,
  // falling back to organization_name+title when no series relationship
  // exists yet (e.g. some Edinburgh umbrella listings) so those rows still
  // consolidate with their own same-org/same-title duplicates rather than
  // silently skip grouping. Each group's member events are sorted
  // chronologically; groups themselves are sorted by their EARLIEST
  // upcoming occurrence -- a single-occurrence show sorts exactly where it
  // would have before this change.
  function groupEventsByShow(events) {
    var groups = {};
    var order = [];
    events.forEach(function (ev) {
      var key = ev.show_series_id != null
        ? "series:" + ev.show_series_id
        : "orgtitle:" + (ev.organization_name || "") + "||" + (ev.title || "");
      if (!groups[key]) {
        groups[key] = {
          key: key,
          title: ev.show_series_name || ev.title || "Untitled show",
          events: []
        };
        order.push(key);
      }
      groups[key].events.push(ev);
    });
    var result = order.map(function (key) { return groups[key]; });
    result.forEach(function (g) {
      g.events.sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
      g.earliest = new Date(g.events[0].starts_at);
    });
    result.sort(function (a, b) { return a.earliest - b.earliest; });
    return result;
  }

  function _ticketLinkHtml(ev) {
    var hasUrl = ev.canonical_event_url && /^https?:\/\//.test(ev.canonical_event_url);
    if (!hasUrl) return '<span class="ticket-link disabled">No ticket link yet</span>';
    var destHost = "";
    try { destHost = new URL(ev.canonical_event_url).hostname.replace(/^www\./, ""); } catch (_) { destHost = ""; }
    var goHref = "go.html?e=" + encodeURIComponent(ev.id) + (destHost ? "&dest=" + encodeURIComponent(destHost) : "");
    return '<a class="ticket-link" href="' + escapeHtml(goHref) + '" rel="noopener noreferrer" target="_blank">Official tickets →</a>';
  }

  // Renders groupEventsByShow()'s output: one card per show, its earliest
  // occurrence's venue/price/language as the card's headline meta, and a
  // compact date list (first 3 dates inline, the rest behind a native
  // <details> disclosure) instead of N duplicate cards. Single-occurrence
  // groups render exactly like the old renderEventCards per-event card
  // (title, date/time, meta, ticket link) -- only a genuinely recurring
  // show gets the date-list treatment.
  var GROUPED_VISIBLE_DATES = 3;

  function renderGroupedEventCards(groups) {
    var html = "";
    groups.forEach(function (g) {
      var primary = g.events[0];
      var venueBit = primary.venue_name ? escapeHtml(primary.venue_name) : null;
      var orgBit = primary.organization_name ? escapeHtml(primary.organization_name) : null;
      var price = fmtPrice(primary);
      var metaParts = [];
      if (venueBit) metaParts.push(venueBit);
      if (orgBit && orgBit !== venueBit) metaParts.push(orgBit);
      if (primary.language === "en") metaParts.push("English");
      if (price) metaParts.push(price);
      var meta = metaParts.join(' <span class="sep">·</span> ');

      // 2026-07-18: same "listing card MUST link to our own event page"
      // fix as renderEventCards -- the group's title links to its earliest
      // occurrence's own page; each individual date in the list below
      // links to THAT occurrence's own page too, so a recurring show is
      // never a click-straight-to-tickets dead end at any level.
      var primaryHref = primary.slug ? "event/" + encodeURIComponent(primary.slug) + "/" : null;
      var groupTitleHtml = escapeHtml(g.title);
      if (primaryHref) {
        groupTitleHtml = '<a class="event-title-link" href="' + escapeHtml(primaryHref) + '">' + groupTitleHtml + "</a>";
      }

      html += '<article class="event-card">';
      html += '  <div class="event-top">';
      html += '    <div class="event-title">' + groupTitleHtml + "</div>";
      if (g.events.length > 1) {
        html += '    <div class="event-date-count">' + g.events.length + " dates</div>";
      } else {
        html += '    <div class="event-time">' + escapeHtml(fmtTime(g.earliest)) + "</div>";
      }
      html += "  </div>";
      html += '  <div class="event-meta">' + meta + " " + statusBadge(primary) + "</div>";

      if (g.events.length > 1) {
        var visible = g.events.slice(0, GROUPED_VISIBLE_DATES);
        var rest = g.events.slice(GROUPED_VISIBLE_DATES);
        html += _datesListHtml(visible);
        if (rest.length) {
          html += '  <details class="more-dates">';
          html += '    <summary>+' + rest.length + " more date" + (rest.length === 1 ? "" : "s") + "</summary>";
          html += _datesListHtml(rest);
          html += "  </details>";
        }
      }

      html += '  <div class="event-actions">' + _ticketLinkHtml(primary) + "</div>";
      html += "</article>";
    });
    return html;
  }

  function _datesListHtml(evs) {
    var html = '<ul class="event-dates">';
    evs.forEach(function (ev) {
      var d = new Date(ev.starts_at);
      var label = escapeHtml(fmtDayHeading(d)) + ", " + escapeHtml(fmtTime(d));
      var href = ev.slug ? "event/" + encodeURIComponent(ev.slug) + "/" : null;
      html += "<li>" + (href
        ? '<a class="event-date-link" href="' + escapeHtml(href) + '">' + label + "</a>"
        : label);
      if (ev.status === "cancelled" || ev.sold_out_status === "sold_out") {
        html += " " + statusBadge(ev);
      }
      html += "</li>";
    });
    html += "</ul>";
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
    groupEventsByShow: groupEventsByShow,
    renderGroupedEventCards: renderGroupedEventCards,
    FORMAT_LABELS: FORMAT_LABELS,
    deriveFormat: deriveFormat,
    DURATION_LABELS: DURATION_LABELS,
    deriveDurationBucket: deriveDurationBucket,
    parisNow: parisNow,
    parisDateKey: parisDateKey,
    makeTimeBuckets: makeTimeBuckets
  };
})(window);
