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
  var CITIES_URL = "../data/comedy-atlas/cities.json";

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
  //
  // 2026-07-18 (Chuck's editorial desk + daily-blog-build audit, "fans
  // can't tell what's free"): `is_free` (migration 0094 view column,
  // derived from event_instances.audience_payment_type — a SOURCED signal,
  // Eventbrite's own top-level is_free boolean, see pipeline/parse.py's
  // EventbriteApiEventsParser 1.3) is checked FIRST, before price_min/
  // price_max. Root cause this closes: a genuinely free Eventbrite show
  // (most of Paris's real organizers) never carried a $0 ticket_classes
  // entry at all, so price_min/price_max stayed NULL — indistinguishable
  // from "price unknown" — and this function returned null (no badge shown)
  // even though the show WAS free. is_free is a real, independent,
  // source-declared fact, not derived from price being absent.
  function fmtPrice(ev) {
    if (ev.is_free === true) return "Free";
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

  // Location filters (Phase 3b, 2026-07-18): cities.json carries every
  // known city's centroid lat/lon (117 rows today) -- published alongside
  // upcoming_events.json by the same publish_atlas_data.py, same MANIFEST.
  // Used for the "Near me" city-level fallback: venue coordinate coverage
  // is only ~64% overall (Paris ~complete; Berlin/London/Edinburgh mostly
  // missing -- see BUILD_STATE.md), so a per-VENUE distance check alone
  // would silently drop most shows in those cities even when the user is
  // obviously in the right city. Degrades to null (never throws) so a
  // fetch failure just disables city-level near-me fallback, not the page.
  function fetchCities() {
    return fetch(CITIES_URL, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("no cities"); return r.json(); })
      .catch(function () { return null; });
  }

  // Haversine great-circle distance in km. Standard formula, no dependency.
  function distanceKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

  // citiesByName is an optional { "Riga": {country_name, country_iso2, ...}, ... }
  // lookup built from cities.json (fetchCities()). When present, each returned
  // entry carries `country` -- Robert's 2026-07-19 feedback ("I don't know
  // where Riga is") is honored by ALWAYS attaching the country when known,
  // not just for cities judged "not major": consistency beats a subjective
  // major-city list, and it costs nothing for the cities everyone already
  // recognizes (Paris, London).
  function groupByCity(events, citiesByName) {
    var counts = {};
    events.forEach(function (ev) {
      var city = ev.city_name || "Unknown";
      counts[city] = (counts[city] || 0) + 1;
    });
    return Object.keys(counts).map(function (city) {
      var country = null;
      if (citiesByName && citiesByName[city]) {
        country = citiesByName[city].country_name || citiesByName[city].country_iso2 || null;
      }
      return { city: city, count: counts[city], country: country };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  // Builds a { cityName: cityRow } lookup from cities.json's array shape
  // (fetchCities()'s resolved value). Returns {} for null/non-array input
  // rather than throwing, so a fetch failure just means no country labels.
  function citiesByName(citiesArray) {
    var map = {};
    if (!Array.isArray(citiesArray)) return map;
    citiesArray.forEach(function (c) {
      if (c && c.name) map[c.name] = c;
    });
    return map;
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
  //
  // opts (2026-07-19, Robert: "there needs to be a better way of organising
  // the shows" on the homepage strip, which mixed every city into one flat
  // list):
  //   showCityBadge -- prepend each card's meta row with a small city chip
  //     (homepage strip spans many cities; a per-city page already knows
  //     its own city and doesn't need this).
  //   maxPerDay -- cap how many cards render per day-group (the rest are
  //     simply not shown here, same "organization not redesign" spirit as
  //     the day grouping itself; full listings remain on /city/<slug>/).
  //   maxDays -- cap how many day-groups render at all.
  function renderEventCards(events, opts) {
    opts = opts || {};
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

    if (opts.maxDays) groups = groups.slice(0, opts.maxDays);

    var html = "";
    groups.forEach(function (g) {
      var items = opts.maxPerDay ? g.items.slice(0, opts.maxPerDay) : g.items;
      html += '<section class="day-group">';
      html += '<div class="day-heading">' + escapeHtml(fmtDayHeading(g.day)) + '</div>';
      items.forEach(function (x) {
        var ev = x.ev;
        var venueBit = ev.venue_name ? escapeHtml(ev.venue_name) : null;
        var orgBit = ev.organization_name ? escapeHtml(ev.organization_name) : null;
        var price = fmtPrice(ev);
        var metaParts = [];
        if (opts.showCityBadge && ev.city_name) {
          metaParts.push('<span class="badge city-badge">' + escapeHtml(ev.city_name) + '</span>');
        }
        if (venueBit) metaParts.push(venueBit);
        if (orgBit && orgBit !== venueBit) metaParts.push(orgBit);
        if (ev.language === "en") metaParts.push("English");
        if (price) metaParts.push(price);
        var meta = metaParts.join(' <span class="sep">·</span> ');

        // 2026-07-18, Robert (5th report of this exact bug class, this time
        // on the homepage "Recently verified" strip -- rendered by this
        // SAME function, since index.html calls A.renderEventCards too):
        // a listing card's ONLY destination is the event's own dedicated
        // page (spec/phase-3b-fan-experience.md's Standing rules #1). The
        // 2026-07-18-earlier fix added the title link but LEFT the
        // "Official tickets" exit button on the card as a "secondary
        // action" -- that was itself still a policy violation: the
        // Official-tickets link exists ONLY on the event's own page
        // (go.html's tracked choke point, reached from there), never on a
        // card, not even as a secondary control. No ticket link/button of
        // any kind on cards now -- matches scripts/generate_entity_pages.py's
        // related-events card (render_event_card), which has always done
        // this correctly (single link to /comedy-atlas/event/<slug>/, no
        // separate ticket exit). The whole card is the click target when a
        // slug exists (same <a class="place-card"> idiom this file's own
        // cityCard/festivalCard already use in index.html); a card with no
        // slug yet renders as a plain, non-clickable block rather than
        // fabricate a link or fall back to a raw ticket exit.
        var eventHref = ev.slug ? "event/" + encodeURIComponent(ev.slug) + "/" : null;
        var titleText = escapeHtml(ev.title || "Untitled show");
        var cardTag = eventHref ? "a" : "div";
        var cardHrefAttr = eventHref ? ' href="' + escapeHtml(eventHref) + '"' : "";

        html += "<" + cardTag + ' class="event-card"' + cardHrefAttr + ">";
        html += '  <div class="event-top">';
        html += '    <div class="event-title">' + titleText + "</div>";
        html += '    <div class="event-time">' + escapeHtml(fmtTime(x.d)) + "</div>";
        html += "  </div>";
        html += '  <div class="event-meta">' + meta + " " + statusBadge(ev) + "</div>";
        html += "</" + cardTag + ">";
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

      // 2026-07-18: the group's title links to the SHOW's own page
      // (public_upcoming_events.show_series_slug, migration 0090) when a
      // real show identity exists -- added specifically because the
      // 692-show backfill earlier today created 711 real show pages that
      // were technically live but never actually reachable by browsing
      // the site (Robert: "did you put that on the site so people can
      // see it?" -- the honest answer was no, this was the missing
      // link). Falls back to the earliest occurrence's own event page
      // for any group that hasn't been linked to a show_series yet
      // (matches renderEventCards' per-event fallback), so a recurring
      // show is never a click-straight-to-tickets dead end at any level
      // either way.
      var groupHref = primary.show_series_slug
        ? "show/" + encodeURIComponent(primary.show_series_slug) + "/"
        : (primary.slug ? "event/" + encodeURIComponent(primary.slug) + "/" : null);
      var groupTitleHtml = escapeHtml(g.title);
      if (groupHref) {
        groupTitleHtml = '<a class="event-title-link" href="' + escapeHtml(groupHref) + '">' + groupTitleHtml + "</a>";
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

      // 2026-07-18: no card-level ticket exit here either (same standing
      // rule as renderEventCards above) -- the group's own title link
      // (and, for a multi-date group, each date's own link) already route
      // to that show/event's dedicated page; the Official-tickets button
      // belongs exclusively there.
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
    fetchCities: fetchCities,
    distanceKm: distanceKm,
    setFreshness: setFreshness,
    groupByCity: groupByCity,
    citiesByName: citiesByName,
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
