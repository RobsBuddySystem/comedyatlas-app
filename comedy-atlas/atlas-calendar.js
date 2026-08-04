/*
 * COMEDY ATLAS — calendar day journey (site/comedy-atlas/atlas-calendar.js)
 *
 * Wave 1 §5.2 / task I3. Replaces the live defect (CODEX_ATLAS_BASIC_
 * FUNCTIONALITY_AUDIT_2026-08-04.md, "Calendar — FAIL"): a "+ 166 more"
 * control that expanded a single 338px calendar cell into a 3,974px
 * INTERNAL SCROLL region holding 170 event links, with no dialog, no day
 * page, and no aria-expanded/aria-controls. There was no day-level
 * destination in the product at all.
 *
 * Two pieces:
 *
 *   1. A compact month mini-calendar, added to city.html next to the
 *      existing "Specific date…" filter. Every day cell is ALWAYS just a
 *      real <a href="/comedy-atlas/calendar/YYYY-MM-DD/?city=..."> — never
 *      an inline-expanding box, regardless of whether the day has 0, 1, 5,
 *      or 170 events. That is the actual fix: the narrow-cell-scroll bug
 *      class cannot recur here because a cell never renders event content
 *      at all, only a count.
 *
 *   2. Progressive enhancement on capable clients (directive §5.2: "a
 *      modal may enhance that URL on capable clients"): clicking a day
 *      cell opens an accessible in-page day-sheet (focus trap, labelled
 *      heading, Escape/close, restored focus, aria-expanded/aria-controls
 *      on the trigger) using events already loaded by city.html — no
 *      extra fetch, instant open — and pushState's the address bar to the
 *      real canonical day URL. A reload or copy-pasted link of that URL
 *      is a REAL navigation (this is not a client-side router) to the
 *      real static page scripts/generate_calendar_pages.py generates, so
 *      direct-URL and back-button both resolve correctly with zero special
 *      handling: back is a real history entry, direct URL is a real file.
 *      If JS never runs, the <a href> still takes the visitor to that same
 *      real page — the day journey exists with or without this module.
 *
 * THE MIDNIGHT-TO-4AM RULE — calendarDayKey() below is the client-side
 * mirror of scripts/generate_calendar_pages.py's calendar_day_key(): an
 * event starting 00:00-03:59 in ITS OWN local time is bucketed onto the
 * PREVIOUS calendar day. Deliberate, not incidental — matches the exact
 * 4am cutoff atlas-common.js's makeTimeBuckets() already uses for
 * "Tonight" (Robert, 2026-07-18: "a show starting at 1am is still tonight
 * to a real visitor, not tomorrow"), so a visitor never sees the same
 * night's shows split across two different calendar cells depending on
 * whether a given show happened to start before or after midnight.
 */
(function (global) {
  "use strict";

  var FALLBACK_TZ = "UTC";

  // ---- pure helpers (unit-tested directly via node --test, no DOM) -------

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  /* Extracts {year, month, day, hour} for `date` AS RENDERED in `tzName`,
   * using Intl (same technique atlas-common.js's eventZone/parisHour
   * already use) rather than a fixed-offset guess -- correct across DST. */
  function localParts(date, tzName) {
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tzName,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", hour12: false
      });
    } catch (e) {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: FALLBACK_TZ,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", hour12: false
      });
    }
    var parts = {};
    fmt.formatToParts(date).forEach(function (p) {
      if (p.type !== "literal") parts[p.type] = p.value;
    });
    // hour12:false renders midnight as "24" in some ICU builds -- normalize.
    var hour = Number(parts.hour);
    if (hour === 24) hour = 0;
    return {
      year: Number(parts.year), month: Number(parts.month),
      day: Number(parts.day), hour: hour
    };
  }

  function dateKeyFromParts(p) {
    return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
  }

  function shiftDayKey(dateKey, deltaDays) {
    var bits = dateKey.split("-").map(Number);
    var d = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  /* The listing day a `starts_at` ISO string (or Date) belongs to, in
   * `tzName` (falls back to UTC for a missing/unrecognized zone -- never
   * fabricates one), applying the midnight-to-4am rule described in the
   * module docstring above. Returns null for an unparseable input. */
  function calendarDayKey(startsAt, tzName) {
    var d = startsAt instanceof Date ? startsAt : new Date(startsAt);
    if (isNaN(d.getTime())) return null;
    var p = localParts(d, tzName || FALLBACK_TZ);
    var key = dateKeyFromParts(p);
    if (p.hour < 4) key = shiftDayKey(key, -1);
    return key;
  }

  /* Builds one cell per day of `monthDate`'s month: {date, count, events}.
   * `events` (already filtered by the caller -- this function applies no
   * filter itself) are bucketed by calendarDayKey() using each event's OWN
   * timezone field. Pure -- no DOM, directly testable. */
  function buildMonthCells(events, monthDate) {
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth(); // 0-based
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var byDay = {};
    (events || []).forEach(function (ev) {
      if (!ev || !ev.starts_at) return;
      var key = calendarDayKey(ev.starts_at, ev.timezone);
      if (!key) return;
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(ev);
    });
    var cells = [];
    for (var day = 1; day <= daysInMonth; day++) {
      var key = year + "-" + pad2(month + 1) + "-" + pad2(day);
      var dayEvents = byDay[key] || [];
      cells.push({ date: key, count: dayEvents.length, events: dayEvents });
    }
    return cells;
  }

  /* Canonical day-page href, filters preserved as query params exactly as
   * city.html's own syncUrl() encodes them (directive §5.2: "preserve
   * active filters"). Only non-empty, non-default values are included. */
  function dayPageHref(dateKey, filters) {
    var qs = new URLSearchParams();
    filters = filters || {};
    if (filters.city) qs.set("city", filters.city);
    if (filters.format) qs.set("format", filters.format);
    if (filters.venue) qs.set("venue", filters.venue);
    if (filters.lang && filters.lang !== "en") qs.set("lang", filters.lang);
    var q = qs.toString();
    return "/comedy-atlas/calendar/" + dateKey + "/" + (q ? "?" + q : "");
  }

  // ---- day-sheet dialog (DOM) ---------------------------------------------

  var FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var _openSheet = null; // {overlay, trigger, previouslyFocused}

  function _trapFocus(container, evt) {
    if (evt.key !== "Tab") return;
    var focusable = Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE_SELECTOR));
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (evt.shiftKey && document.activeElement === first) {
      evt.preventDefault(); last.focus();
    } else if (!evt.shiftKey && document.activeElement === last) {
      evt.preventDefault(); first.focus();
    }
  }

  function closeDaySheet() {
    if (!_openSheet) return;
    var s = _openSheet;
    _openSheet = null;
    if (s.overlay && s.overlay.parentNode) s.overlay.parentNode.removeChild(s.overlay);
    document.removeEventListener("keydown", s.keyHandler, true);
    if (s.trigger) {
      s.trigger.setAttribute("aria-expanded", "false");
      s.trigger.focus();
    }
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function _renderEventRow(ev) {
    var thumb = ev.photo_url
      ? '<img class="cal-sheet-thumb" src="' + escapeHtml(ev.photo_url) + '" alt="" loading="lazy" onerror="this.remove()">'
      : "";
    var href = ev.slug ? "/comedy-atlas/event/" + encodeURIComponent(ev.slug) + "/" : "#";
    var time = "";
    try {
      time = new Date(ev.starts_at).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", timeZone: ev.timezone || FALLBACK_TZ
      });
    } catch (e) { /* leave blank rather than show a wrong time */ }
    var meta = [ev.venue_name, ev.city_name].filter(Boolean).map(escapeHtml).join(" · ");
    return (
      '<a class="cal-sheet-row" href="' + escapeHtml(href) + '">' +
      thumb +
      '<span class="cal-sheet-row-body">' +
      '<span class="cal-sheet-row-title">' + escapeHtml(ev.title || "Show") + "</span>" +
      '<span class="cal-sheet-row-meta">' + escapeHtml(time) + (meta ? " · " + meta : "") + "</span>" +
      "</span></a>"
    );
  }

  /* Opens an accessible day-sheet dialog listing `events` for `dateKey`.
   * `trigger` is the day-cell element that opened it -- gets
   * aria-expanded/aria-controls (directive §5.2) and focus restored on
   * close. `dayHref` is the REAL canonical day-page URL (pushState target)
   * so the address bar, direct-URL reload, and back-button all resolve to
   * the actual generated page even though this dialog never navigates. */
  function openDaySheet(opts) {
    closeDaySheet(); // only one open at a time
    var trigger = opts.trigger, dateKey = opts.dateKey, events = opts.events || [];
    var dayHref = opts.dayHref || ("/comedy-atlas/calendar/" + dateKey + "/");
    var headingId = "cal-sheet-heading-" + dateKey;
    var sheetId = "cal-sheet-" + dateKey;

    var overlay = document.createElement("div");
    overlay.className = "cal-sheet-overlay";
    overlay.innerHTML =
      '<div class="cal-sheet" id="' + sheetId + '" role="dialog" aria-modal="true" aria-labelledby="' + headingId + '">' +
      '<div class="cal-sheet-head">' +
      '<h2 id="' + headingId + '">' + escapeHtml(dateKey) + " — " + events.length +
      (events.length === 1 ? " show" : " shows") + "</h2>" +
      '<button type="button" class="cal-sheet-close" aria-label="Close">&times;</button>' +
      "</div>" +
      '<div class="cal-sheet-list">' +
      (events.length
        ? events.map(_renderEventRow).join("")
        : '<p class="cal-sheet-empty">No shows this day yet.</p>') +
      "</div>" +
      '<a class="cal-sheet-fullpage" href="' + escapeHtml(dayHref) + '">Open full day page &rarr;</a>' +
      "</div>";
    document.body.appendChild(overlay);

    if (trigger) {
      var triggerId = trigger.id || ("cal-cell-" + dateKey);
      trigger.id = triggerId;
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-controls", sheetId);
    }

    if (global.history && global.history.pushState) {
      global.history.pushState({ atlasCalendarSheet: dateKey }, "", dayHref);
    }

    var closeBtn = overlay.querySelector(".cal-sheet-close");
    var sheet = overlay.querySelector(".cal-sheet");
    function onKeydown(evt) {
      if (evt.key === "Escape") { evt.preventDefault(); closeDaySheet(); return; }
      _trapFocus(sheet, evt);
    }
    document.addEventListener("keydown", onKeydown, true);
    overlay.addEventListener("click", function (evt) {
      if (evt.target === overlay) closeDaySheet();
    });
    closeBtn.addEventListener("click", closeDaySheet);

    _openSheet = { overlay: overlay, trigger: trigger || null, keyHandler: onKeydown };
    closeBtn.focus();
  }

  // popstate (browser Back) closes any open sheet and restores focus --
  // directive §5.2's "restored focus" requirement, also covering the
  // physical back button, not just Escape/close-button dismissal.
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", function () {
      if (_openSheet) closeDaySheet();
    });
  }

  var AtlasCalendar = {
    calendarDayKey: calendarDayKey,
    buildMonthCells: buildMonthCells,
    dayPageHref: dayPageHref,
    openDaySheet: openDaySheet,
    closeDaySheet: closeDaySheet,
    _renderEventRow: _renderEventRow
  };

  global.AtlasCalendar = AtlasCalendar;
})(typeof window !== "undefined" ? window : global);

// CommonJS export for `node --test` -- browsers never hit this branch
// (module/exports are undefined there), same convention as
// atlas-venue-map.js's own tail.
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : global).AtlasCalendar;
}
