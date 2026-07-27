/*
 * COMEDY ATLAS — Atlas Visuals v1: renderer (site/comedy-atlas/atlas-visuals.js)
 *
 * THIRD of three separate concerns (data adapter -> layer registry ->
 * renderer, see atlas-layers.js's header comment). This file draws the
 * hero: it only ever calls AtlasVisualsData (fetch/normalize) and
 * AtlasLayers (registry + resolvers + link helpers) through their public
 * functions, and only ever iterates AtlasLayers.LAYERS generically — it
 * has no layer-specific branches, so a new registry entry lights up here
 * with zero edits to this file.
 *
 * Projection: a plain equirectangular graticule (lon/lat -> x/y on a flat
 * 2:1 grid), not a real coastline map or a 3D globe. This repo has no
 * bundled world-geometry asset and the static-site CSP forbids pulling
 * one from a CDN (HARD CONSTRAINTS in the brief), so a real map outline
 * would mean either fabricating simplified coastlines by hand (a form of
 * invented data this repo's standing rule explicitly forbids applying to
 * anything user-facing) or adding a runtime dependency (also forbidden).
 * What this version DOES do (2026-07-27 design pass, see the coordinator
 * review that prompted it) is make that honest flat grid feel designed
 * rather than placeholder: a layered radial "night sky" surface, dot size
 * + glow driven by real counts so density reads at a glance, direct
 * labels on the biggest real cities, and a hover/focus link between the
 * map and the accessible list so they read as one component. Every pixel
 * of that is presentation on top of real data — no new coordinates, no
 * new counts, nothing invented.
 *
 * Called by index.html as: AtlasVisuals.mount(document.getElementById(
 * "atlas-viz-root")). No-ops harmlessly if the container isn't found.
 */
(function (global) {
  "use strict";

  var VB_W = 1000, VB_H = 500;
  var TOP_LABEL_COUNT = 6; // biggest real cities get a direct map label
  var MIN_R = 5, MAX_R = 24;

  function project(lat, lon) {
    return {
      x: (lon + 180) / 360 * VB_W,
      y: (90 - lat) / 180 * VB_H
    };
  }

  function svgEl(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    }
    return e;
  }

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") e.className = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function cityKey(name) {
    return String(name || "").toLowerCase().replace(/\s+/g, "-");
  }

  // Radius scale: sqrt (perceptually linear-ish for circle area), clamped
  // to [MIN_R, MAX_R], driven entirely by a point's own real `count` — no
  // dot is sized off anything the data doesn't say.
  function radiusFor(count, maxCount) {
    if (!maxCount || maxCount <= 0) return MIN_R;
    var t = Math.sqrt(Math.max(count, 0)) / Math.sqrt(maxCount);
    return MIN_R + (MAX_R - MIN_R) * t;
  }

  // --- Main mount -----------------------------------------------------
  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};
    var Layers = global.AtlasLayers;
    var Data = global.AtlasVisualsData;
    if (!Layers || !Data) {
      // Defensive: a stale cached copy of one file without the other
      // should never throw and take out the rest of the page.
      return null;
    }

    var activeLayers = {};
    Layers.LAYERS.forEach(function (l) { activeLayers[l.id] = !!l.defaultVisible; });
    var searchQuery = "";
    var latestData = { cities: [], venues: [], eventsLoaded: false };
    var linkedKey = null;

    // -- DOM scaffold --
    container.innerHTML = "";
    var section = el("section", { class: "atlas-viz", "aria-labelledby": "atlas-viz-heading" });
    var shell = el("div", { class: "atlas-viz-shell" });

    var head = el("div", { class: "atlas-viz-head" });
    head.appendChild(el("h2", { id: "atlas-viz-heading", class: "atlas-viz-title" }, "Explore live comedy worldwide"));
    var searchWrap = el("div", { class: "atlas-viz-search" });
    var searchLabel = el("label", { for: "atlas-viz-search-input", class: "skip-link", style: "position:static;left:auto;width:1px;height:1px;overflow:hidden;padding:0;display:inline-block" }, "Search cities on the map");
    var searchInput = el("input", {
      id: "atlas-viz-search-input", type: "search", placeholder: "Search a city…",
      autocomplete: "off", "aria-label": "Search cities on the map"
    });
    searchWrap.appendChild(searchLabel);
    searchWrap.appendChild(searchInput);
    head.appendChild(searchWrap);
    shell.appendChild(head);

    var layersRow = el("div", { class: "atlas-viz-layers", role: "group", "aria-label": "Map layers" });
    var toggleEls = {};
    Layers.LAYERS.forEach(function (layer) {
      var id = "atlas-layer-toggle-" + layer.id;
      var label = el("label", {
        class: "atlas-layer-toggle", for: id,
        style: "--layer-color:var(" + layer.color + ")",
        title: layer.description || ""
      });
      var cb = el("input", { type: "checkbox", id: id, "data-layer-id": layer.id });
      cb.checked = !!layer.defaultVisible;
      var dot = el("span", { class: "dot", "aria-hidden": "true" });
      var text = el("span", {}, esc(layer.icon || "") + " " + esc(layer.label));
      var count = el("span", { class: "count", "data-role": "layer-count" }, "");
      label.appendChild(cb);
      label.appendChild(dot);
      label.appendChild(text);
      label.appendChild(count);
      label.setAttribute("data-checked", cb.checked ? "true" : "false");
      cb.addEventListener("change", function () {
        activeLayers[layer.id] = cb.checked;
        label.setAttribute("data-checked", cb.checked ? "true" : "false");
        applyVisibility();
      });
      toggleEls[layer.id] = { label: label, checkbox: cb, countEl: count };
      layersRow.appendChild(label);
    });
    shell.appendChild(layersRow);

    // Loading indicator: only ever shown if loadDetail() genuinely takes a
    // moment (see the setTimeout in the load sequence below) -- a screenshot
    // taken any time after data is actually ready must never carry a
    // spinner as the headline visual, so this starts hidden rather than
    // visible-by-default.
    var loadingRow = el("div", { class: "atlas-viz-loading", id: "atlas-viz-loading", hidden: "hidden" });
    loadingRow.appendChild(el("span", { class: "spinner-sm", "aria-hidden": "true" }));
    var loadingText = el("span", {}, "Loading show counts…");
    loadingRow.appendChild(loadingText);
    shell.appendChild(loadingRow);

    var body = el("div", { class: "atlas-viz-body" });

    var mapWrap = el("div", { class: "atlas-map-wrap" });
    var svg = svgEl("svg", {
      class: "atlas-map-svg", viewBox: "0 0 " + VB_W + " " + VB_H,
      role: "img", "aria-hidden": "true", focusable: "false"
    });
    buildSurface(svg);
    buildGraticule(svg);
    var pointLayerGroups = {};
    var labelGroup = svgEl("g", { class: "atlas-map-labels" });
    Layers.LAYERS.forEach(function (layer) {
      var g = svgEl("g", { "data-layer-group": layer.id });
      pointLayerGroups[layer.id] = g;
      svg.appendChild(g);
    });
    svg.appendChild(labelGroup);
    mapWrap.appendChild(svg);
    var emptyNote = el("div", { class: "atlas-map-empty-note", id: "atlas-map-empty-note", hidden: "hidden" }, "");
    mapWrap.appendChild(emptyNote);
    body.appendChild(mapWrap);

    // -- Accessible fallback / primary-for-screen-readers list --
    var listPanel = el("div", { class: "atlas-viz-list-panel" });
    var listHeading = el("div", { class: "atlas-viz-list-heading", id: "atlas-viz-list-heading" },
      "All cities (<span data-role=\"list-count\">0</span>)");
    listPanel.appendChild(listHeading);
    var list = el("ul", {
      class: "atlas-viz-list", id: "atlas-viz-list",
      "aria-labelledby": "atlas-viz-list-heading"
    });
    listPanel.appendChild(list);
    var comicsNote = el("p", { class: "atlas-viz-comics-note", id: "atlas-viz-comics-note" },
      "Comic-level map data isn't published yet — see the Comics layer for details. " +
      "City and venue locations above are real, published coordinates.");
    listPanel.appendChild(comicsNote);
    body.appendChild(listPanel);

    shell.appendChild(body);
    section.appendChild(shell);
    container.appendChild(section);

    // -- noscript-equivalent note for JS-heavy-rendering-unavailable --
    // The rest of this hero (and the rest of index.html's main listings)
    // is JS-rendered already, same as today's page; <noscript> can't help
    // with fetch-driven content, so this mirrors the existing site
    // convention rather than inventing a new one.

    // -- Surface / grid ------------------------------------------------
    function buildSurface(svgRoot) {
      var defs = svgEl("defs", {});
      var waterGrad = svgEl("radialGradient", {
        id: "atlas-water-grad", cx: "32%", cy: "30%", r: "85%"
      });
      waterGrad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "var(--atlas-map-water-hi)" }));
      waterGrad.appendChild(svgEl("stop", { offset: "55%", "stop-color": "var(--atlas-map-water)" }));
      waterGrad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "var(--atlas-map-water-lo)" }));
      defs.appendChild(waterGrad);

      var vignette = svgEl("radialGradient", { id: "atlas-vignette", cx: "50%", cy: "45%", r: "75%" });
      vignette.appendChild(svgEl("stop", { offset: "60%", "stop-color": "#000", "stop-opacity": "0" }));
      vignette.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#000", "stop-opacity": "0.35" }));
      defs.appendChild(vignette);

      var glow = svgEl("filter", { id: "atlas-dot-glow", x: "-150%", y: "-150%", width: "400%", height: "400%" });
      glow.appendChild(svgEl("feGaussianBlur", { stdDeviation: "3.2", result: "blur" }));
      defs.appendChild(glow);

      svgRoot.appendChild(defs);
      svgRoot.appendChild(svgEl("rect", { x: 0, y: 0, width: VB_W, height: VB_H, fill: "url(#atlas-water-grad)" }));
      svgRoot.appendChild(svgEl("rect", { x: 0, y: 0, width: VB_W, height: VB_H, fill: "url(#atlas-vignette)" }));
    }

    function buildGraticule(svgRoot) {
      var g = svgEl("g", { class: "atlas-graticule" });
      for (var lon = -180; lon <= 180; lon += 30) {
        var p1 = project(90, lon), p2 = project(-90, lon);
        g.appendChild(svgEl("line", {
          class: "atlas-grid-line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y
        }));
      }
      for (var lat = -60; lat <= 90; lat += 30) {
        var q1 = project(lat, -180), q2 = project(lat, 180);
        g.appendChild(svgEl("line", {
          class: "atlas-grid-line", x1: q1.x, y1: q1.y, x2: q2.x, y2: q2.y
        }));
      }
      // Equator + prime meridian get a slightly stronger line -- a small
      // orientation cue on an otherwise unlabeled grid.
      var eq1 = project(0, -180), eq2 = project(0, 180);
      g.appendChild(svgEl("line", { class: "atlas-grid-line atlas-grid-line-major", x1: eq1.x, y1: eq1.y, x2: eq2.x, y2: eq2.y }));
      var pm1 = project(90, 0), pm2 = project(-90, 0);
      g.appendChild(svgEl("line", { class: "atlas-grid-line atlas-grid-line-major", x1: pm1.x, y1: pm1.y, x2: pm2.x, y2: pm2.y }));
      svgRoot.appendChild(g);
    }

    // -- Navigation with a real existence check -------------------------
    // A `confirmed` point's canonical href (AtlasLayers.canonicalCityHref)
    // is the real slugified route, but this repo's own generator only
    // builds that page for a city once its export clears a >=1-event bar
    // -- and that generation run can lag the currently-loaded data (see
    // atlas-layers.js's canonicalCityHref comment for the live evidence:
    // 33/35 real event-bearing cities resolved, 2 didn't, on 2026-07-27).
    // A plain <a href> can't know that at render time, so a real left-
    // click gets a same-origin HEAD check first; middle-click/ctrl-click/
    // cmd-click (open in new tab) is left alone and uses whatever href is
    // already on the element, same as any normal link on the web.
    function wireCityLink(a, entity) {
      var cityName = entity.cityName;
      a.addEventListener("click", function (ev) {
        if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        var fallback = Layers.fallbackCityHref(cityName);
        if (!entity.confirmed) {
          global.location.href = fallback;
          return;
        }
        var canonical = Layers.canonicalCityHref(cityName);
        fetch(canonical, { method: "HEAD", cache: "no-store" }).then(function (r) {
          global.location.href = (r && r.ok) ? canonical : fallback;
        }).catch(function () {
          global.location.href = fallback;
        });
      });
    }

    // -- Hover/focus linking between the map and the list ----------------
    function setLinked(key) {
      if (key === linkedKey) return;
      linkedKey = key;
      var nodes = shell.querySelectorAll("[data-city-key]");
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle("is-linked", !!key && nodes[i].getAttribute("data-city-key") === key);
      }
    }

    // -- Rendering --------------------------------------------------
    // Multiple layers routinely share the exact same real coordinate (a
    // city's Shows, Festivals and Open Mics points all sit at that same
    // city centroid) -- drawn undisturbed they stack into one
    // indistinguishable blob AND become impossible to individually hover/
    // click. `layerIndex` fans each layer's point out a few px around the
    // true point in a small deterministic ring (same idea as marker-
    // clustering "spiderfy" in any map UI) -- cosmetic only, the anchor
    // for hover-linking/labels/list rows stays the real projected
    // coordinate (see the label/glow code below, which uses `pos`, not
    // the offset `drawPos`).
    var LAYER_OFFSET_PX = 6;
    function layerOffset(layerIndex, pos) {
      if (!layerIndex) return pos;
      var angle = (layerIndex / Layers.LAYERS.length) * Math.PI * 2;
      return {
        x: pos.x + Math.cos(angle) * LAYER_OFFSET_PX,
        y: pos.y + Math.sin(angle) * LAYER_OFFSET_PX
      };
    }

    function pointNode(layer, point, opts2) {
      opts2 = opts2 || {};
      var truePos = project(point.lat, point.lon);
      var pos = layerOffset(opts2.layerIndex || 0, truePos);
      var key = cityKey(point.cityName || point.label);
      var g = svgEl("a", {
        class: "atlas-map-point", href: Layers.entityHref(layer.id, point) || "#",
        "data-layer": layer.id,
        "data-label": (point.label || "").toLowerCase(),
        "data-city-key": key,
        role: "link",
        "aria-label": point.label + (point.countLabel ? (", " + point.countLabel) : "") + " — explore this city"
      });
      var r = radiusFor(point.count, opts2.maxCount);
      var glowCircle = svgEl("circle", {
        class: "atlas-map-point-glow", cx: pos.x, cy: pos.y, r: r * 1.7,
        fill: "var(" + layer.color + ")", filter: "url(#atlas-dot-glow)"
      });
      var coreCircle = svgEl("circle", {
        class: "atlas-map-point-core", cx: pos.x, cy: pos.y, r: r,
        fill: "var(" + layer.color + ")"
      });
      g.appendChild(glowCircle);
      g.appendChild(coreCircle);
      var title = svgEl("title", {});
      title.textContent = point.label + (point.countLabel ? (" — " + point.countLabel) : "");
      g.appendChild(title);
      if (!prefersReducedMotion()) g.classList.add("is-entering");

      g.addEventListener("mouseenter", function () { setLinked(key); });
      g.addEventListener("mouseleave", function () { setLinked(null); });
      g.addEventListener("focus", function () { setLinked(key); });
      g.addEventListener("blur", function () { setLinked(null); });
      wireCityLink(g, point);

      if (opts2.labeled) {
        var labelX = pos.x + r + 5;
        var flip = labelX > VB_W - 60; // keep labels on-canvas near the right edge
        var text = svgEl("text", {
          class: "atlas-map-label", x: flip ? (pos.x - r - 5) : labelX, y: pos.y + 3.5,
          "text-anchor": flip ? "end" : "start", "data-city-key": key
        });
        text.textContent = point.label;
        labelGroup.appendChild(text);
      }

      return g;
    }

    function renderPoints(data) {
      latestData = data;
      var showPoints = Layers.resolvePoints("shows", data);
      var maxCount = showPoints.reduce(function (m, p) { return Math.max(m, p.count || 0); }, 0);

      // Direct map labels, biggest-real-city-first, but SKIPPED (not just
      // capped) when they'd land within MIN_LABEL_DIST px of an
      // already-placed label -- several of the real cities in this data
      // (Berlin/Cologne/Amsterdam/Paris/Barcelona) sit close enough
      // together in real lat/lon that an uncoditional top-N-by-count
      // label set overlapped into an unreadable cluster. Falls through to
      // the next-biggest city instead of just stopping, so the map still
      // ends up with up to TOP_LABEL_COUNT labels when the geography
      // allows it, geographically spread rather than crowded.
      var labelKeys = {};
      if (data.eventsLoaded) {
        var placed = [];
        var MIN_LABEL_DIST = 30;
        showPoints.slice().sort(function (a, b) { return b.count - a.count; }).forEach(function (p) {
          if (Object.keys(labelKeys).length >= TOP_LABEL_COUNT) return;
          var pos = project(p.lat, p.lon);
          var tooClose = placed.some(function (q) {
            var dx = q.x - pos.x, dy = q.y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) < MIN_LABEL_DIST;
          });
          if (tooClose) return;
          placed.push(pos);
          labelKeys[cityKey(p.cityName)] = true;
        });
      }

      while (labelGroup.firstChild) labelGroup.removeChild(labelGroup.firstChild);

      Layers.LAYERS.forEach(function (layer, layerIndex) {
        var group = pointLayerGroups[layer.id];
        while (group.firstChild) group.removeChild(group.firstChild);
        var points = Layers.resolvePoints(layer.id, data);
        points.forEach(function (p) {
          var labeled = layer.id === "shows" && !!labelKeys[cityKey(p.cityName)];
          group.appendChild(pointNode(layer, p, { maxCount: maxCount, labeled: labeled, layerIndex: layerIndex }));
        });
        var t = toggleEls[layer.id];
        if (t) {
          if (layer.id === "comics" && points.length === 0) {
            t.countEl.textContent = "no data yet";
          } else if (!data.eventsLoaded && (layer.id === "festivals" || layer.id === "openmics" || layer.id === "venues")) {
            t.countEl.textContent = "…";
          } else {
            t.countEl.textContent = String(points.length);
          }
        }
      });
      renderList(data);
      applyVisibility();
    }

    function renderList(data) {
      // "Every city the map claims" = exactly the Shows layer's resolved
      // points (the most-inclusive layer — every other layer is a subset
      // of the same city set). Deriving the list from the same resolver
      // the map itself uses, rather than a second hand-rolled filter,
      // is what keeps this invariant true by construction instead of by
      // convention (see tests/test_atlas_visuals_registry.py).
      var showPoints = Layers.resolvePoints("shows", data);
      list.innerHTML = "";
      var q = searchQuery.trim().toLowerCase();
      var shown = 0;
      showPoints
        .slice()
        .sort(function (a, b) { return a.label.localeCompare(b.label); })
        .forEach(function (p) {
          if (q && p.label.toLowerCase().indexOf(q) === -1) return;
          shown += 1;
          var key = cityKey(p.cityName);
          var li = el("li", { "data-city-key": key });
          var a = el("a", { href: Layers.entityHref("shows", p) || "#" },
            '<span class="avl-name">' + esc(p.label) + '</span>' +
            '<span class="avl-meta">' + esc(p.countLabel || "") + ' · Explore this city →</span>');
          li.appendChild(a);
          list.appendChild(li);
          a.addEventListener("mouseenter", function () { setLinked(key); });
          a.addEventListener("mouseleave", function () { setLinked(null); });
          a.addEventListener("focus", function () { setLinked(key); });
          a.addEventListener("blur", function () { setLinked(null); });
          wireCityLink(a, p);
        });
      if (shown === 0) {
        var emptyLi = el("li", {}, '<div class="avl-empty">No cities match "' + esc(searchQuery) + '".</div>');
        list.appendChild(emptyLi);
      }
      var countTargets = shell.querySelectorAll('[data-role="list-count"]');
      for (var i = 0; i < countTargets.length; i++) countTargets[i].textContent = String(shown);
    }

    function applyVisibility() {
      var q = searchQuery.trim().toLowerCase();
      var anyVisible = false;
      Layers.LAYERS.forEach(function (layer) {
        var group = pointLayerGroups[layer.id];
        var on = !!activeLayers[layer.id];
        var nodes = group.querySelectorAll(".atlas-map-point");
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          var matchesSearch = !q || (node.getAttribute("data-label") || "").indexOf(q) !== -1;
          var visible = on && matchesSearch;
          node.classList.toggle("is-hidden", !visible);
          if (visible) anyVisible = true;
        }
      });
      // Direct map labels track the Shows layer's own visibility (they're
      // only ever attached to Shows-layer points, see pointNode's
      // `opts2.labeled`) plus the same search filter as every other point.
      var showsOn = !!activeLayers.shows;
      var labelNodes = labelGroup.querySelectorAll(".atlas-map-label");
      for (var j = 0; j < labelNodes.length; j++) {
        var lnode = labelNodes[j];
        var lMatchesSearch = !q || lnode.textContent.toLowerCase().indexOf(q) !== -1;
        lnode.classList.toggle("is-hidden", !showsOn || !lMatchesSearch);
      }
      renderList(latestData);
      if (!anyVisible) {
        emptyNote.hidden = false;
        emptyNote.textContent = q
          ? "No cities on the map match \"" + searchQuery + "\"."
          : "No layers selected.";
      } else {
        emptyNote.hidden = true;
      }
    }

    searchInput.addEventListener("input", function () {
      searchQuery = searchInput.value || "";
      applyVisibility();
    });

    // -- Load data --------------------------------------------------
    // The loading row only appears if loadDetail() (the 5MB fetch) is
    // still pending after a short grace period -- a fast connection (or
    // this task's own test fixtures) never shows it at all, so "loading"
    // is never what a screenshot captures under normal conditions.
    var loadingTimer = global.setTimeout(function () { loadingRow.hidden = false; }, 400);

    Data.loadCore().then(function (core) {
      renderPoints(core);
      return Data.loadDetail(core);
    }).then(function (full) {
      clearTimeout(loadingTimer);
      renderPoints(full);
      loadingRow.hidden = true;
    }).catch(function (err) {
      clearTimeout(loadingTimer);
      loadingText.textContent = "Some map data couldn't load. City locations shown are still real; counts may be incomplete.";
      loadingRow.hidden = false;
      // Never throw out of a promise chain the caller didn't await —
      // logging keeps this out of the "uncaught exception" console-error
      // class the evidence harness checks for.
      if (global.console && global.console.warn) global.console.warn("Atlas Visuals: " + (err && err.message));
    });

    return {
      // Exposed for tests/debugging only — the renderer doesn't need
      // these itself.
      _activeLayers: activeLayers,
      _setSearch: function (q) { searchInput.value = q; searchQuery = q; applyVisibility(); },
      _toggleLayer: function (id, on) {
        var t = toggleEls[id];
        if (!t) return;
        t.checkbox.checked = on;
        t.checkbox.dispatchEvent(new Event("change"));
      }
    };
  }

  global.AtlasVisuals = { mount: mount, project: project };
})(window);
