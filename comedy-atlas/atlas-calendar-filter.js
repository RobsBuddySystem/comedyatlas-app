/*
 * COMEDY ATLAS — Comedy Calendar search/filter bar
 * (site/comedy-atlas/atlas-calendar-filter.js)
 *
 * Robert, 2026-09-13, verbatim: "why doesnt the Comedy Calendar still have
 * no search bars for the cities, or times". The day pages
 * (scripts/generate_calendar_pages.py) and the /comedy-atlas/calendar/
 * index page list every real show/day, grouped and counted -- honest,
 * complete, and crawlable with zero JavaScript. This module is the
 * PROGRESSIVE ENHANCEMENT layer on top: a city type-ahead, a time-of-day
 * filter, date navigation that preserves both, live counts, and a
 * "no shows match" state. It never changes what the server rendered; it
 * only shows/hides what is already there and rewrites already-real hrefs'
 * query strings.
 *
 * THE FILTER BAR ITSELF STARTS `hidden` (see generate_calendar_pages.py's
 * _filter_bar_html): a visitor with JS disabled or blocked gets the plain,
 * fully-functional page exactly as before this feature (no dead controls
 * that look interactive but do nothing). This module's very first job on
 * every page it runs on is to un-hide it.
 *
 * Two page shapes this same file drives (detected, never guessed, by DOM
 * markers already in the generated HTML):
 *   - a day page:   `[data-cal-city]` sections of `.cal-event-row`s, each
 *                    carrying `data-start-hour` (generator-stamped, see
 *                    generate_calendar_pages.py's _local_start_hour --
 *                    NEVER parsed from display text here).
 *   - the calendar
 *     index page:   `#cal-index-day-list` of `[data-cal-index-link]`
 *                    anchors, one per day, no per-event data to filter --
 *                    filter selections there only rewrite each day link's
 *                    own query string so the chosen city/time carries
 *                    through to whichever day the visitor opens.
 *
 * City suggestions (ARIA 1.2 combobox/listbox pattern): first the cities
 * actually present on THIS page (instant, no network), then -- once the
 * visitor has actually focused/typed, never eagerly -- every COMEDY ATLAS
 * city, fetched from the same public export atlas-common.js's fetchCities()
 * already reads (root-absolute /data/comedy-atlas/cities.json -- see
 * seo_common.ANALYTICS_INCLUDE_HTML's own comment on why a *relative* path
 * is wrong two directory levels deep under comedy-atlas/, which is exactly
 * where calendar/YYYY-MM-DD/ pages live).
 */
(function (global) {
  "use strict";

  /* Escape a city name before it lands in innerHTML (attribute AND text).
     Added at integration (Opus, 2026-09-13): the first version escaped only
     quotes in the attribute and nothing in the text node. */
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var CITIES_URL = "/data/comedy-atlas/cities.json";

  // ---- pure helpers (unit-tested directly via node --test, no DOM) -------

  /* Accent-stripped, lowercased text for a case/accent-insensitive compare
   * -- same normalization family as scripts/seo_common.py's slugify(),
   * applied client-side instead of server-side. */
  function normalizeForMatch(s) {
    if (s === null || s === undefined) return "";
    var str = String(s).toLowerCase();
    if (typeof str.normalize === "function") {
      // Strip combining diacritical marks (U+0300-U+036F) left behind by
      // NFKD decomposition -- "é" -> "e" + U+0301, "é".normalize("NFKD")
      // splits it into two code points, this removes the second.
      str = str.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    }
    return str;
  }

  /* True if `query` matches `cityName` at a WORD START -- "par" matches
   * "Paris" and "New York" (the "Y" in New York), never a mid-word
   * substring like "yor" matching "New York" only by accident of "or"
   * appearing inside "York" -- word-start matching is what the work order
   * asks for ("Lon" -> London, "par" -> Paris"). Empty query matches
   * everything (no filter typed yet). */
  function cityMatches(query, cityName) {
    var q = normalizeForMatch(query).trim();
    if (!q) return true;
    var name = normalizeForMatch(cityName);
    var words = name.split(/[^a-z0-9]+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) {
      if (words[i].indexOf(q) === 0) return true;
    }
    return false;
  }

  /* Any/Afternoon/Evening/Late bucket for a LOCAL start hour (0-23,
   * generator-stamped `data-start-hour` -- see this module's own docstring
   * and generate_calendar_pages.py's _local_start_hour). Returns null for a
   * missing/invalid hour -- callers must treat "unknown time" as always
   * visible, never silently drop a real show for lack of a time. */
  function timeBucket(hour) {
    if (hour === null || hour === undefined || hour === "" || isNaN(hour)) return null;
    var h = Number(hour);
    if (h < 0 || h > 23) return null;
    if (h < 17) return "afternoon";
    if (h < 21) return "evening";
    return "late";
  }

  /* True if a row with LOCAL start hour `hour` should be visible under
   * time-of-day filter `filterValue` ("any"/"afternoon"/"evening"/"late").
   * A row with no derivable hour is NEVER hidden by this filter -- an
   * honest "unknown" beats a guessed exclusion (same convention every
   * other date/time helper in this codebase follows, see seo_common.py). */
  function matchesTimeFilter(hour, filterValue) {
    if (!filterValue || filterValue === "any") return true;
    var bucket = timeBucket(hour);
    if (bucket === null) return true;
    return bucket === filterValue;
  }

  /* Builds "?city=X&time=Y" (time omitted when "any"/absent) -- the single
   * shared query-string shape every rewritten href on this page uses, so a
   * link built by one code path is always readable by another. */
  function buildQueryString(filters) {
    filters = filters || {};
    var qs = new URLSearchParams();
    if (filters.city) qs.set("city", filters.city);
    if (filters.time && filters.time !== "any") qs.set("time", filters.time);
    var s = qs.toString();
    return s ? "?" + s : "";
  }

  /* Rewrites `href`'s query string to `filters`, keeping its path
   * untouched (works whether `href` already has a query string or not,
   * and whether it's absolute or root-relative). */
  function withFilters(href, filters) {
    var qIndex = href.indexOf("?");
    var path = qIndex === -1 ? href : href.slice(0, qIndex);
    return path + buildQueryString(filters);
  }

  /* Reads {city, time} off a location.search string (or a URLSearchParams-
   * compatible value) -- the exact shape buildQueryString/withFilters
   * produce, read back on page load so a visitor arriving via a ?city=
   * link (city.html's mini-calendar, an emailed link, a bookmark) sees the
   * filter bar already reflecting it. */
  function parseFilters(search) {
    var qs = new URLSearchParams(search || "");
    return {
      city: qs.get("city") || "",
      time: qs.get("time") || "any"
    };
  }

  var AtlasCalendarFilter = {
    normalizeForMatch: normalizeForMatch,
    cityMatches: cityMatches,
    timeBucket: timeBucket,
    matchesTimeFilter: matchesTimeFilter,
    buildQueryString: buildQueryString,
    withFilters: withFilters,
    parseFilters: parseFilters
  };

  // ---- DOM wiring (exercised by Playwright, not node --test) -------------

  if (typeof document !== "undefined") {
    var state = { city: "", time: "any", activeIndex: -1, suggestions: [] };
    var allCitiesPromise = null;

    function fetchAllCityNames() {
      if (allCitiesPromise) return allCitiesPromise;
      allCitiesPromise = fetch(CITIES_URL, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          return (rows || [])
            .map(function (r) { return r && r.name; })
            .filter(Boolean);
        })
        .catch(function () { return []; });
      return allCitiesPromise;
    }

    function onPageCityNames() {
      // Day pages only -- see this module's own docstring: the calendar
      // index page carries no per-event `[data-cal-city]` markup at all,
      // so this always returns [] there and the combobox falls back
      // straight to the fetched all-Atlas-cities list.
      var seen = {};
      var names = [];
      document.querySelectorAll("[data-cal-city]").forEach(function (el) {
        var name = el.getAttribute("data-cal-city");
        if (name && !seen[name]) { seen[name] = true; names.push(name); }
      });
      return names.sort();
    }

    function init() {
      var bar = document.getElementById("cal-filterbar");
      if (!bar) return;
      bar.hidden = false;

      var cityInput = document.getElementById("cal-city-input");
      var cityClear = document.getElementById("cal-city-clear");
      var listbox = document.getElementById("cal-city-listbox");
      var timeSelect = document.getElementById("cal-time-select");
      var dateInput = document.getElementById("cal-date-input");
      var nomatch = document.getElementById("cal-nomatch");
      var clearFiltersBtn = document.getElementById("cal-clear-filters");

      var isIndexPage = !!document.getElementById("cal-index-day-list");

      // ?city= arrives from all kinds of places (an emailed link, a hand-
      // typed URL, city.html's own mini-calendar) and its casing can't be
      // relied on to match this page's exact city_name string ("?city=paris"
      // must still preselect "Paris") -- resolve it case/accent-insensitively
      // against the cities actually on THIS page before adopting it as the
      // filter value. A day with no matching city keeps the raw value
      // (an honest "0 shows match", never a silent no-op).
      function resolveCityCasing(raw) {
        if (!raw) return "";
        var names = onPageCityNames();
        for (var i = 0; i < names.length; i++) {
          if (normalizeForMatch(names[i]) === normalizeForMatch(raw)) return names[i];
        }
        return raw;
      }

      var initial = parseFilters(window.location.search);
      state.city = isIndexPage ? initial.city : resolveCityCasing(initial.city);
      state.time = initial.time;
      if (cityInput) cityInput.value = state.city;
      if (timeSelect) timeSelect.value = initial.time;
      updateCityClearVisibility();

      function applyDayPageFilters() {
        var sections = document.querySelectorAll("[data-cal-city]");
        var totalShows = 0;
        var visibleCities = 0;
        sections.forEach(function (section) {
          var sectionCity = section.getAttribute("data-cal-city") || "";
          var cityOk = !state.city || sectionCity === state.city;
          var rows = section.querySelectorAll(".cal-event-row");
          var sectionVisible = 0;
          rows.forEach(function (row) {
            var hour = row.getAttribute("data-start-hour");
            var show = cityOk && matchesTimeFilter(hour === "" ? null : hour, state.time);
            row.hidden = !show;
            if (show) sectionVisible += 1;
          });
          section.hidden = sectionVisible === 0;
          if (sectionVisible > 0) visibleCities += 1;
          totalShows += sectionVisible;
        });
        var heading = document.getElementById("cal-heading-count");
        if (heading) {
          heading.textContent = totalShows + (totalShows === 1 ? " show" : " shows") +
            (visibleCities > 1 ? " across " + visibleCities + " cities" : "");
        }
        if (nomatch) nomatch.hidden = totalShows !== 0;
        updateDateNavLinks();
      }

      function updateDateNavLinks() {
        var filters = { city: state.city, time: state.time };
        var prev = document.getElementById("cal-prev-link");
        var next = document.getElementById("cal-next-link");
        if (prev) prev.href = withFilters(prev.getAttribute("href"), filters);
        if (next) next.href = withFilters(next.getAttribute("href"), filters);
      }

      function applyIndexPageFilters() {
        var filters = { city: state.city, time: state.time };
        document.querySelectorAll("[data-cal-index-link]").forEach(function (a) {
          a.href = withFilters(a.getAttribute("href"), filters);
        });
        var todayLink = document.getElementById("cal-index-today-link");
        if (todayLink) {
          try {
            var d = new Date();
            var localToday = d.getFullYear() + "-" +
              String(d.getMonth() + 1).padStart(2, "0") + "-" +
              String(d.getDate()).padStart(2, "0");
            var path = "/comedy-atlas/calendar/" + localToday + "/";
            todayLink.href = withFilters(path, filters);
          } catch (e) { /* keep the server-rendered today link */ }
        }
      }

      function syncUrl() {
        var qs = buildQueryString({ city: state.city, time: state.time });
        var newUrl = window.location.pathname + qs;
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, "", newUrl);
        }
      }

      function applyFilters() {
        if (isIndexPage) applyIndexPageFilters();
        else applyDayPageFilters();
        syncUrl();
      }

      function updateCityClearVisibility() {
        if (cityClear) cityClear.hidden = !state.city;
      }

      function closeListbox() {
        if (!listbox) return;
        listbox.hidden = true;
        listbox.innerHTML = "";
        state.suggestions = [];
        state.activeIndex = -1;
        if (cityInput) cityInput.setAttribute("aria-expanded", "false");
      }

      function renderSuggestions(names) {
        if (!listbox) return;
        var query = cityInput ? cityInput.value : "";
        var matches = [];
        var seen = {};
        names.forEach(function (name) {
          if (seen[name]) return;
          if (cityMatches(query, name)) { matches.push(name); seen[name] = true; }
        });
        matches = matches.slice(0, 12);
        state.suggestions = matches;
        state.activeIndex = -1;
        listbox.innerHTML = matches.map(function (name, i) {
          return '<li role="option" id="cal-city-opt-' + i + '" data-city="' +
            escHtml(name) + '">' + escHtml(name) + "</li>";
        }).join("");
        listbox.hidden = matches.length === 0;
        if (cityInput) cityInput.setAttribute("aria-expanded", matches.length > 0 ? "true" : "false");
      }

      function selectCity(name) {
        state.city = name || "";
        if (cityInput) cityInput.value = state.city;
        updateCityClearVisibility();
        closeListbox();
        applyFilters();
      }

      if (cityInput) {
        cityInput.addEventListener("focus", function () {
          fetchAllCityNames(); // warm the cache; suggestions render on input
        });
        cityInput.addEventListener("input", function () {
          var onPage = onPageCityNames();
          renderSuggestions(onPage);
          fetchAllCityNames().then(function (all) {
            // Merge the full Atlas list in once it's back, on-page names
            // first (directive: "suggests from the cities present on that
            // day, then all Atlas cities").
            renderSuggestions(onPage.concat(all));
          });
          if (cityInput.value === "") { state.city = ""; updateCityClearVisibility(); applyFilters(); }
        });
        cityInput.addEventListener("keydown", function (evt) {
          if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
            if (!state.suggestions.length) return;
            evt.preventDefault();
            var delta = evt.key === "ArrowDown" ? 1 : -1;
            state.activeIndex = (state.activeIndex + delta + state.suggestions.length) % state.suggestions.length;
            var opts = listbox.querySelectorAll("li");
            opts.forEach(function (li, i) {
              li.setAttribute("aria-selected", i === state.activeIndex ? "true" : "false");
            });
            var active = opts[state.activeIndex];
            if (active) cityInput.setAttribute("aria-activedescendant", active.id);
          } else if (evt.key === "Enter") {
            if (state.activeIndex >= 0 && state.suggestions[state.activeIndex]) {
              evt.preventDefault();
              selectCity(state.suggestions[state.activeIndex]);
            }
          } else if (evt.key === "Escape") {
            closeListbox();
          }
        });
        cityInput.addEventListener("blur", function () {
          // Delay so a click on a listbox option (which also blurs the
          // input) still registers before the listbox is torn down.
          setTimeout(closeListbox, 150);
        });
      }
      if (listbox) {
        listbox.addEventListener("mousedown", function (evt) {
          var li = evt.target.closest("li[data-city]");
          if (!li) return;
          evt.preventDefault();
          selectCity(li.getAttribute("data-city"));
        });
      }
      if (cityClear) {
        cityClear.addEventListener("click", function () { selectCity(""); });
      }
      if (timeSelect) {
        timeSelect.addEventListener("change", function () {
          state.time = timeSelect.value || "any";
          applyFilters();
        });
      }
      if (dateInput) {
        dateInput.addEventListener("change", function () {
          var val = dateInput.value;
          if (!val) return;
          var filters = { city: state.city, time: state.time };
          window.location.href = withFilters("/comedy-atlas/calendar/" + val + "/", filters);
        });
      }
      if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", function () {
          state.city = ""; state.time = "any";
          if (cityInput) cityInput.value = "";
          if (timeSelect) timeSelect.value = "any";
          updateCityClearVisibility();
          applyFilters();
        });
      }

      applyFilters();
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  global.AtlasCalendarFilter = AtlasCalendarFilter;
})(typeof window !== "undefined" ? window : global);

// CommonJS export for `node --test` -- same convention as
// atlas-calendar.js's own tail (browsers never hit this branch).
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : global).AtlasCalendarFilter;
}
