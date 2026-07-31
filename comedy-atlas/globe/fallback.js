/**
 * COMEDY ATLAS — Interactive Globe: no-WebGL fallback
 * (site/comedy-atlas/globe/fallback.js)
 *
 * CHECKPOINT 4 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * THIS IS THE ACCESSIBILITY GUARANTEE FOR THE WHOLE FEATURE. If WebGL is
 * unavailable, or three.js fails to load, or a user's browser/AT setup
 * can't drive the 3D scene, this module must be a fully usable, complete
 * substitute on its own: a semantic list, real counts, a text filter,
 * full keyboard navigation, and an accessible name on every control.
 * It does not touch <canvas> or any WebGL API — it is pure DOM.
 *
 * Every count rendered here comes from the injected GlobeCity[] payload
 * (see the plan's "GlobeCity contract"). No hard-coded statistic ever
 * appears in this file (Global Constraint #7).
 *
 * Exports:
 *   mountGlobeFallback(rootEl, payload, opts) -> {destroy, setFilter(text), getVisibleCount()}
 *     opts.cityHref(city) -> string   (defaults to `../city/<slug>/`)
 *     opts.reason -> string           (why the fallback is showing, e.g.
 *                                      "WebGL is not available in this browser.")
 */

function slugFallback(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function defaultCityHref(city) {
  const slug = (city && (city.slug || slugFallback(city.name))) || "";
  return "../city/" + slug + "/";
}

function cityMatches(city, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    city && city.name,
    city && city.normalizedName,
    city && city.countryName,
    city && city.region,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.indexOf(q) !== -1;
}

function summarize(city) {
  const parts = [];
  const upcoming = Number(city && city.upcomingShowCount) || 0;
  const venues = Number(city && city.venueCount) || 0;
  const festivals = Number(city && city.festivalCount) || 0;
  const comics = Number(city && city.comicCount) || 0;
  parts.push(upcoming === 1 ? "1 upcoming show" : upcoming + " upcoming shows");
  parts.push(venues === 1 ? "1 venue" : venues + " venues");
  if (festivals > 0) parts.push(festivals === 1 ? "1 festival" : festivals + " festivals");
  if (comics > 0) parts.push(comics === 1 ? "1 comic" : comics + " comics");
  return parts.join(" · ");
}

export function mountGlobeFallback(rootEl, payload, opts) {
  const options = opts || {};
  const cityHref = typeof options.cityHref === "function" ? options.cityHref : defaultCityHref;
  const allCities = (payload && Array.isArray(payload.cities)) ? payload.cities.slice() : [];
  let currentQuery = "";

  rootEl.innerHTML = "";
  rootEl.setAttribute("role", "region");
  rootEl.setAttribute("aria-label", "Comedy Atlas city list (fallback for browsers without 3D support)");

  const wrap = document.createElement("div");
  wrap.className = "atlas-globe-fallback";

  if (options.reason) {
    const note = document.createElement("p");
    note.className = "atlas-globe-fallback-empty";
    note.style.textAlign = "left";
    note.style.padding = "0 0 10px";
    note.textContent = options.reason;
    wrap.appendChild(note);
  }

  const searchWrap = document.createElement("div");
  searchWrap.className = "atlas-globe-fallback-search";
  const searchLabel = document.createElement("label");
  const inputId = "atlas-globe-fallback-search-" + Math.random().toString(36).slice(2);
  searchLabel.setAttribute("for", inputId);
  searchLabel.className = "atlas-globe-fallback-search-label";
  searchLabel.style.position = "absolute";
  searchLabel.style.width = "1px";
  searchLabel.style.height = "1px";
  searchLabel.style.overflow = "hidden";
  searchLabel.style.clip = "rect(0 0 0 0)";
  searchLabel.textContent = "Search a comic, city, show, venue or festival";
  const input = document.createElement("input");
  input.type = "text";
  input.id = inputId;
  input.placeholder = "Search a comic, city, show, venue or festival…";
  input.setAttribute("aria-label", "Search a comic, city, show, venue or festival");
  searchWrap.appendChild(searchLabel);
  searchWrap.appendChild(input);
  wrap.appendChild(searchWrap);

  const statusEl = document.createElement("p");
  statusEl.className = "atlas-globe-fallback-status";
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");
  statusEl.style.fontSize = "11.5px";
  statusEl.style.margin = "0 0 8px";
  statusEl.style.color = "var(--atlas-globe-muted)";
  wrap.appendChild(statusEl);

  const list = document.createElement("ul");
  list.className = "atlas-globe-fallback-list";
  wrap.appendChild(list);

  rootEl.appendChild(wrap);

  function render() {
    const visible = allCities.filter((c) => cityMatches(c, currentQuery));
    list.innerHTML = "";

    if (allCities.length === 0) {
      const empty = document.createElement("li");
      empty.className = "atlas-globe-fallback-empty";
      empty.textContent = "No cities are currently published.";
      list.appendChild(empty);
    } else if (visible.length === 0) {
      const empty = document.createElement("li");
      empty.className = "atlas-globe-fallback-empty";
      empty.textContent = "No cities match “" + currentQuery + "”.";
      list.appendChild(empty);
    } else {
      visible.forEach((city) => {
        const li = document.createElement("li");
        li.className = "atlas-globe-fallback-item";

        const link = document.createElement("a");
        link.href = cityHref(city);
        const country = city && city.countryName ? ", " + city.countryName : "";
        link.textContent = (city && city.name ? city.name : "Unknown city") + country;
        link.setAttribute(
          "aria-label",
          "Explore " + (city && city.name ? city.name : "this city") + country + " on Comedy Atlas"
        );
        li.appendChild(link);

        const meta = document.createElement("div");
        meta.className = "atlas-globe-fallback-item-meta";
        meta.textContent = summarize(city);
        li.appendChild(meta);

        list.appendChild(li);
      });
    }

    statusEl.textContent =
      allCities.length === 0
        ? "0 cities loaded."
        : visible.length + " of " + allCities.length + (allCities.length === 1 ? " city shown." : " cities shown.");
  }

  function setFilter(text) {
    currentQuery = text || "";
    input.value = currentQuery;
    render();
  }

  input.addEventListener("input", (ev) => {
    currentQuery = ev.target.value;
    render();
  });

  render();

  return {
    setFilter,
    getVisibleCount() {
      return allCities.filter((c) => cityMatches(c, currentQuery)).length;
    },
    destroy() {
      rootEl.innerHTML = "";
    },
  };
}

export const __internal = { cityMatches, summarize, defaultCityHref, slugFallback };
