/*
 * COMEDY ATLAS — free poster maker (site/comedy-atlas/poster.js)
 *
 * Canvas-based poster editor, no framework, no build step, no CDN.
 * Everything runs client-side: uploaded photos are drawn onto a local
 * <canvas> and NEVER leave the device. Fonts are bundled woff2 files
 * (assets/fonts/, see OFL-LICENSES.txt) declared in poster.css.
 *
 * Data contract: same as atlas-common.js — ../data/comedy-atlas/
 * upcoming_events.json published by scripts/publish_atlas_data.py.
 * Picking a show prefills title / date / venue / ticket URL; the
 * ?event=<slug> query param (slug or show_series_slug) deep-links a
 * prefilled editor so show pages and the booker portal can offer a
 * one-tap "make a poster for this show".
 *
 * Coordinates: text blocks store x/y/size as FRACTIONS of canvas
 * width/height so a poster survives switching between IG post (1080²),
 * IG story (1080×1920) and A4 print (2480×3508 @300dpi) without
 * re-layout. The canvas element is always full export resolution;
 * CSS scales it down for display, so export is just canvas.toBlob.
 */
(function () {
  "use strict";

  var DATA_URL = "../data/comedy-atlas/upcoming_events.json";
  var STICKER_URL = "assets/brand/atlas-character-hero-600.png";

  var SIZES = {
    "ig-post":  { w: 1080, h: 1080, label: "IG post" },
    "ig-story": { w: 1080, h: 1920, label: "IG story" },
    "a4":       { w: 2480, h: 3508, label: "A4 print" }
  };

  var FONTS = {
    anton:    { family: "PosterAnton",    weight: 400 },
    oswald:   { family: "PosterOswald",   weight: 600 },
    playfair: { family: "PosterPlayfair", weight: 700 },
    inter:    { family: "PosterInter",    weight: 700 },
    marker:   { family: "PosterMarker",   weight: 400 }
  };

  // ---------------------------------------------------------------- state
  var state = {
    sizeKey: "ig-post",
    templateKey: "classic",
    bg: { mode: "gradient", c1: "#0a0e1a", c2: "#2a1a4a", img: null, darken: 0.4 },
    blocks: [],
    sticker: { on: false, x: 0.85, y: 0.88, scaleF: 0.22 },
    credit: true,
    selected: null,
    show: null // prefill data of the picked show, null = blank canvas
  };
  var nextId = 1;
  var stickerImg = null;
  var fontsReady = false;
  var allEvents = null;

  var canvas = document.getElementById("poster-canvas");
  var ctx = canvas.getContext("2d");

  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------- text blocks
  function makeBlock(opts) {
    return {
      id: nextId++,
      text: opts.text || "Your text",
      font: opts.font || "inter",
      sizeF: opts.sizeF || 0.05,     // font size as fraction of canvas width
      color: opts.color || "#ffffff",
      align: opts.align || "center", // anchor interpretation of x
      x: opts.x != null ? opts.x : 0.5,  // anchor x (fraction of W)
      y: opts.y != null ? opts.y : 0.5,  // top y (fraction of H)
      maxwF: opts.maxwF || 0.86,     // wrap width (fraction of W)
      upper: !!opts.upper,
      lineH: opts.lineH || 1.12,
      _bbox: null
    };
  }

  function fontString(block, W) {
    var f = FONTS[block.font] || FONTS.inter;
    var px = Math.max(8, Math.round(block.sizeF * W));
    return f.weight + " " + px + "px " + f.family + ", sans-serif";
  }

  function wrapLines(block, W) {
    var text = block.upper ? block.text.toUpperCase() : block.text;
    ctx.font = fontString(block, W);
    var maxw = block.maxwF * W;
    var out = [];
    text.split("\n").forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); return; }
      var line = words[0];
      for (var i = 1; i < words.length; i++) {
        var probe = line + " " + words[i];
        if (ctx.measureText(probe).width > maxw) { out.push(line); line = words[i]; }
        else { line = probe; }
      }
      out.push(line);
    });
    return out;
  }

  // ------------------------------------------------------------ rendering
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 0;
    var n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  }

  function bgIsLight() {
    if (state.bg.mode === "photo" && state.bg.img) return state.bg.darken < 0.15;
    return luminance(state.bg.c1) > 0.55;
  }

  function drawBackground(W, H) {
    var bg = state.bg;
    if (bg.mode === "photo" && bg.img) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      // cover-fit
      var iw = bg.img.naturalWidth, ih = bg.img.naturalHeight;
      var s = Math.max(W / iw, H / ih);
      var dw = iw * s, dh = ih * s;
      ctx.drawImage(bg.img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      if (bg.darken > 0) {
        ctx.fillStyle = "rgba(0,0,0," + bg.darken + ")";
        ctx.fillRect(0, 0, W, H);
      }
    } else if (bg.mode === "gradient") {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg.c1);
      g.addColorStop(1, bg.c2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = bg.c1;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBlock(block, W, H, withSelection) {
    var lines = wrapLines(block, W);
    ctx.font = fontString(block, W);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = block.color;
    var px = block.sizeF * W;
    // Shrink-to-fit: an unbreakable "word" (a ticket URL) can be wider
    // than the wrap width — scale the drawn font down so it never bleeds
    // off the poster. block.sizeF itself is untouched.
    var widest = 0;
    lines.forEach(function (line) {
      var w = ctx.measureText(line).width;
      if (w > widest) widest = w;
    });
    var maxw = block.maxwF * W;
    if (widest > maxw && widest > 0) {
      px = px * (maxw / widest);
      var f = FONTS[block.font] || FONTS.inter;
      ctx.font = f.weight + " " + Math.max(8, Math.round(px)) + "px " + f.family + ", sans-serif";
    }
    var lh = px * block.lineH;
    var anchorX = block.x * W;
    var topY = block.y * H;
    ctx.textAlign = block.align;
    var maxLineW = 0;
    lines.forEach(function (line, i) {
      var w = ctx.measureText(line).width;
      if (w > maxLineW) maxLineW = w;
      ctx.fillText(line, anchorX, topY + px * 0.82 + i * lh);
    });
    var left = block.align === "left" ? anchorX
             : block.align === "right" ? anchorX - maxLineW
             : anchorX - maxLineW / 2;
    var h = (lines.length - 1) * lh + px * 1.05;
    block._bbox = { x: left, y: topY, w: maxLineW, h: h };
    if (withSelection && state.selected === block.id) {
      ctx.save();
      ctx.strokeStyle = "#c9a84c";
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.setLineDash([10, 7]);
      var pad = px * 0.15;
      ctx.strokeRect(left - pad, topY - pad, maxLineW + pad * 2, h + pad * 2);
      ctx.restore();
    }
  }

  function drawSticker(W, H, withSelection) {
    if (!state.sticker.on || !stickerImg) return;
    var s = state.sticker;
    var w = s.scaleF * W;
    var h = w * (stickerImg.naturalHeight / stickerImg.naturalWidth);
    var x = s.x * W - w / 2, y = s.y * H - h / 2;
    ctx.drawImage(stickerImg, x, y, w, h);
    s._bbox = { x: x, y: y, w: w, h: h };
    if (withSelection && state.selected === "sticker") {
      ctx.save();
      ctx.strokeStyle = "#c9a84c";
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.setLineDash([10, 7]);
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
      ctx.restore();
    }
  }

  function drawCredit(W, H) {
    if (!state.credit) return;
    var px = Math.round(W * 0.018);
    ctx.font = "700 " + px + "px PosterInter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = bgIsLight() ? "rgba(23,21,18,.55)" : "rgba(255,255,255,.55)";
    ctx.fillText("made with COMEDY ATLAS", W - px * 1.2, H - px * 1.2);
  }

  function render(withSelection) {
    if (withSelection === undefined) withSelection = true;
    var sz = SIZES[state.sizeKey];
    var W = sz.w, H = sz.h;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    drawBackground(W, H);
    state.blocks.forEach(function (b) { drawBlock(b, W, H, withSelection); });
    drawSticker(W, H, withSelection);
    drawCredit(W, H);
  }

  // ------------------------------------------------------------ templates
  // Each template returns { bg, blocks } for the current show data (or
  // generic placeholder copy on a blank canvas).
  function showLines() {
    var s = state.show;
    return {
      kicker: "LIVE STAND-UP COMEDY",
      title: s ? (s.title || s.seriesName || "Comedy Night") : "YOUR SHOW NAME",
      date: s && s.dateLine ? s.dateLine : "Friday 1 August · 20:00",
      venue: s && s.venueLine ? s.venueLine : "The Comedy Basement",
      addr: s && s.addrLine ? s.addrLine : "12 Rue de l'Exemple, Paris",
      tickets: s && s.ticketsLine ? s.ticketsLine : "tickets: comedyatlas.app"
    };
  }

  var TEMPLATES = {
    classic: function () {
      var t = showLines();
      return {
        bg: { mode: "gradient", c1: "#0a0e1a", c2: "#3b1a5e" },
        blocks: [
          makeBlock({ text: t.kicker, font: "oswald", sizeF: 0.03, color: "#c9a84c", y: 0.09, upper: true }),
          makeBlock({ text: t.title, font: "anton", sizeF: 0.115, color: "#ffffff", y: 0.16, upper: true, lineH: 1.05 }),
          makeBlock({ text: t.date, font: "oswald", sizeF: 0.042, color: "#e8c96a", y: 0.62, upper: true }),
          makeBlock({ text: t.venue, font: "inter", sizeF: 0.034, color: "#ffffff", y: 0.70 }),
          makeBlock({ text: t.addr, font: "inter", sizeF: 0.024, color: "#8899aa", y: 0.755 }),
          makeBlock({ text: t.tickets, font: "oswald", sizeF: 0.027, color: "#c9a84c", y: 0.86 })
        ]
      };
    },
    minimal: function () {
      var t = showLines();
      return {
        bg: { mode: "solid", c1: "#f7f5f0", c2: "#f7f5f0" },
        blocks: [
          makeBlock({ text: t.title, font: "playfair", sizeF: 0.105, color: "#171512", align: "left", x: 0.08, y: 0.12, maxwF: 0.84, lineH: 1.08 }),
          makeBlock({ text: t.date, font: "inter", sizeF: 0.033, color: "#171512", align: "left", x: 0.08, y: 0.60 }),
          makeBlock({ text: t.venue + " — " + t.addr, font: "inter", sizeF: 0.026, color: "#5a5348", align: "left", x: 0.08, y: 0.665, maxwF: 0.84 }),
          makeBlock({ text: t.tickets, font: "inter", sizeF: 0.026, color: "#7c3aed", align: "left", x: 0.08, y: 0.80 })
        ]
      };
    },
    photo: function () {
      var t = showLines();
      return {
        bg: { mode: "photo", c1: "#0a0e1a", c2: "#101828" },
        blocks: [
          makeBlock({ text: t.kicker, font: "oswald", sizeF: 0.026, color: "#e8c96a", align: "left", x: 0.07, y: 0.55, upper: true }),
          makeBlock({ text: t.title, font: "oswald", sizeF: 0.095, color: "#ffffff", align: "left", x: 0.07, y: 0.60, upper: true, maxwF: 0.86, lineH: 1.05 }),
          makeBlock({ text: t.date + "  ·  " + t.venue, font: "inter", sizeF: 0.028, color: "#ffffff", align: "left", x: 0.07, y: 0.82, maxwF: 0.86 }),
          makeBlock({ text: t.tickets, font: "inter", sizeF: 0.024, color: "#e8c96a", align: "left", x: 0.07, y: 0.885 })
        ]
      };
    },
    fringe: function () {
      var t = showLines();
      return {
        bg: { mode: "solid", c1: "#c9a84c", c2: "#c9a84c" },
        blocks: [
          makeBlock({ text: "COMEDY", font: "anton", sizeF: 0.17, color: "#171512", y: 0.06, upper: true, lineH: 0.98 }),
          makeBlock({ text: t.title, font: "anton", sizeF: 0.085, color: "#c41e3a", y: 0.30, upper: true, lineH: 1.02 }),
          makeBlock({ text: "★ " + t.date + " ★", font: "oswald", sizeF: 0.04, color: "#171512", y: 0.60, upper: true }),
          makeBlock({ text: t.venue, font: "oswald", sizeF: 0.036, color: "#171512", y: 0.68, upper: true }),
          makeBlock({ text: t.addr, font: "inter", sizeF: 0.024, color: "#3d3728", y: 0.745 }),
          makeBlock({ text: t.tickets, font: "oswald", sizeF: 0.028, color: "#171512", y: 0.85 })
        ]
      };
    },
    marker: function () {
      var t = showLines();
      return {
        bg: { mode: "solid", c1: "#f7f5f0", c2: "#f7f5f0" },
        blocks: [
          makeBlock({ text: t.kicker, font: "marker", sizeF: 0.038, color: "#c41e3a", y: 0.08 }),
          makeBlock({ text: t.title, font: "marker", sizeF: 0.095, color: "#171512", y: 0.15, lineH: 1.15 }),
          makeBlock({ text: t.date, font: "marker", sizeF: 0.045, color: "#171512", y: 0.58 }),
          makeBlock({ text: t.venue + ", " + t.addr, font: "inter", sizeF: 0.026, color: "#5a5348", y: 0.68, maxwF: 0.8 }),
          makeBlock({ text: t.tickets, font: "marker", sizeF: 0.032, color: "#7c3aed", y: 0.82 })
        ]
      };
    }
  };

  function applyTemplate(key) {
    state.templateKey = key;
    var t = TEMPLATES[key]();
    var keepImg = state.bg.img;         // never throw away an uploaded photo
    var keepDarken = state.bg.darken;
    state.bg.mode = t.bg.mode;
    state.bg.c1 = t.bg.c1;
    state.bg.c2 = t.bg.c2;
    if (keepImg) { state.bg.img = keepImg; state.bg.mode = "photo"; state.bg.darken = keepDarken; }
    state.blocks = t.blocks;
    state.selected = null;
    syncToolbar();
    render();
  }

  // ------------------------------------------------------- show data load
  function fmtDateLine(iso) {
    // Use the event's own wall-clock time (strip the offset) so the poster
    // always shows venue-local time no matter where it's being made.
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var day = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return day + " · " + m[4] + ":" + m[5];
  }

  function showFromEvent(ev) {
    var slug = ev.show_series_slug || ev.slug;
    return {
      title: ev.show_series_name || ev.title || "Comedy Night",
      seriesName: ev.show_series_name,
      slug: slug,
      dateLine: fmtDateLine(ev.starts_at),
      venueLine: ev.venue_name || "",
      addrLine: [ev.venue_address, ev.city_name].filter(Boolean).join(", "),
      ticketsLine: slug ? "tickets: comedyatlas.app/comedy-atlas/show/" + slug : "tickets: comedyatlas.app"
    };
  }

  function loadEvents() {
    return fetch(DATA_URL, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) {
        var now = new Date();
        // one entry per series: the NEXT upcoming instance
        var bySeries = {};
        rows.forEach(function (ev) {
          if (ev.status === "cancelled" || !ev.starts_at) return;
          var start = new Date(ev.starts_at);
          if (isNaN(start) || start < now) return;
          var key = ev.show_series_id || ("ev-" + ev.id);
          if (!bySeries[key] || new Date(bySeries[key].starts_at) > start) bySeries[key] = ev;
        });
        allEvents = Object.keys(bySeries).map(function (k) { return bySeries[k]; });
        allEvents.sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
        return allEvents;
      });
  }

  function renderResults(query) {
    var box = $("show-results");
    var note = $("picker-note");
    if (!allEvents) { box.innerHTML = ""; return; }
    var q = (query || "").trim().toLowerCase();
    var matches = allEvents.filter(function (ev) {
      if (!q) return true;
      return [ev.title, ev.show_series_name, ev.venue_name, ev.city_name, ev.organization_name]
        .join(" ").toLowerCase().indexOf(q) !== -1;
    }).slice(0, 30);
    box.innerHTML = "";
    matches.forEach(function (ev) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "show-row";
      btn.setAttribute("role", "listitem");
      var title = document.createElement("div");
      title.className = "sr-title";
      title.textContent = ev.show_series_name || ev.title;
      var meta = document.createElement("div");
      meta.className = "sr-meta";
      meta.textContent = [fmtDateLine(ev.starts_at), ev.venue_name, ev.city_name]
        .filter(Boolean).join(" · ");
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener("click", function () { startFromEvent(ev); });
      box.appendChild(btn);
    });
    note.textContent = matches.length
      ? matches.length + " show" + (matches.length === 1 ? "" : "s") + (q ? " matching “" + query + "”" : " coming up — pick yours")
      : "No upcoming show matches that — try fewer words, or start from a blank canvas.";
  }

  function startFromEvent(ev) {
    state.show = showFromEvent(ev);
    openEditor();
  }

  function openEditor() {
    $("picker").style.display = "none";
    $("editor").style.display = "block";
    applyTemplate(state.templateKey);
  }

  // ------------------------------------------------------------ toolbar UI
  function selectedBlock() {
    if (state.selected === null || state.selected === "sticker") return null;
    for (var i = 0; i < state.blocks.length; i++) {
      if (state.blocks[i].id === state.selected) return state.blocks[i];
    }
    return null;
  }

  function setActivePill(rowId, attr, value) {
    var row = $(rowId);
    Array.prototype.forEach.call(row.querySelectorAll(".pill"), function (p) {
      p.classList.toggle("active", p.getAttribute(attr) === String(value));
    });
  }

  function syncToolbar() {
    var b = selectedBlock();
    $("sel-tools").classList.toggle("on", !!b);
    $("no-sel-card").style.display = b ? "none" : "block";
    setActivePill("size-row", "data-size", state.sizeKey);
    setActivePill("template-row", "data-template", state.templateKey);
    setActivePill("bg-row", "data-bg", state.bg.mode);
    if (b) {
      setActivePill("font-row", "data-font", b.font);
      setActivePill("align-row", "data-align", b.align);
      $("size-value").textContent = Math.round(b.sizeF * SIZES[state.sizeKey].w) + "px";
      Array.prototype.forEach.call(document.querySelectorAll("#swatch-row .swatch[data-color]"), function (s) {
        s.classList.toggle("active", s.getAttribute("data-color").toLowerCase() === b.color.toLowerCase());
      });
    }
    $("toggle-sticker").classList.toggle("active", state.sticker.on);
    $("toggle-credit").classList.toggle("active", state.credit);
  }

  function status(msg, cls) {
    var el = $("status-msg");
    el.textContent = msg || "";
    el.className = cls || "";
  }

  // -------------------------------------------------- pointer interaction
  var drag = null;

  function canvasPoint(evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function hitTest(pt) {
    // sticker sits on top of text
    if (state.sticker.on && state.sticker._bbox) {
      var s = state.sticker._bbox;
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) return "sticker";
    }
    for (var i = state.blocks.length - 1; i >= 0; i--) {
      var b = state.blocks[i]._bbox;
      if (!b) continue;
      var pad = state.blocks[i].sizeF * canvas.width * 0.2;
      if (pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad) {
        return state.blocks[i].id;
      }
    }
    return null;
  }

  canvas.addEventListener("pointerdown", function (evt) {
    if ($("inline-editor").style.display === "block") { commitInlineEdit(); }
    var pt = canvasPoint(evt);
    var hit = hitTest(pt);
    drag = { id: hit, startPt: pt, moved: false, wasSelected: state.selected === hit };
    if (hit !== null) {
      state.selected = hit;
      canvas.setPointerCapture(evt.pointerId);
    } else {
      state.selected = null;
    }
    syncToolbar();
    render();
    evt.preventDefault();
  });

  canvas.addEventListener("pointermove", function (evt) {
    if (!drag || drag.id === null) return;
    var pt = canvasPoint(evt);
    var dx = pt.x - drag.startPt.x, dy = pt.y - drag.startPt.y;
    if (!drag.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    drag.moved = true;
    var W = canvas.width, H = canvas.height;
    if (drag.id === "sticker") {
      state.sticker.x = Math.min(1, Math.max(0, state.sticker.x + dx / W));
      state.sticker.y = Math.min(1, Math.max(0, state.sticker.y + dy / H));
    } else {
      var b = selectedBlock();
      if (b) {
        b.x = Math.min(1.05, Math.max(-0.05, b.x + dx / W));
        b.y = Math.min(1.02, Math.max(-0.02, b.y + dy / H));
      }
    }
    drag.startPt = pt;
    render();
  });

  canvas.addEventListener("pointerup", function (evt) {
    if (!drag) return;
    var wasTapOnSelected = !drag.moved && drag.id !== null && drag.id !== "sticker" && drag.wasSelected;
    if (wasTapOnSelected) startInlineEdit();
    drag = null;
  });

  // --------------------------------------------------------- inline editor
  function startInlineEdit() {
    var b = selectedBlock();
    if (!b || !b._bbox) return;
    var ta = $("inline-editor");
    var rect = canvas.getBoundingClientRect();
    var wrap = $("canvas-wrap").getBoundingClientRect();
    var scale = rect.width / canvas.width;
    var left = rect.left - wrap.left + b._bbox.x * scale;
    var top = rect.top - wrap.top + b._bbox.y * scale;
    ta.value = b.text;
    ta.style.display = "block";
    ta.style.left = Math.max(4, Math.min(left, wrap.width - 190)) + "px";
    ta.style.top = Math.max(4, top - 6) + "px";
    ta.style.width = Math.min(Math.max(b._bbox.w * scale + 40, 200), wrap.width - 16) + "px";
    var f = FONTS[b.font];
    ta.style.fontFamily = f.family + ", sans-serif";
    ta.style.fontWeight = f.weight;
    ta.style.fontSize = Math.max(14, Math.min(28, b.sizeF * canvas.width * scale)) + "px";
    ta.rows = Math.max(1, b.text.split("\n").length);
    ta.focus();
    ta.select();
  }

  function commitInlineEdit() {
    var ta = $("inline-editor");
    if (ta.style.display !== "block") return;
    var b = selectedBlock();
    if (b && ta.value.trim() !== "") b.text = ta.value;
    ta.style.display = "none";
    render();
  }

  $("inline-editor").addEventListener("blur", commitInlineEdit);
  $("inline-editor").addEventListener("keydown", function (evt) {
    if (evt.key === "Enter" && !evt.shiftKey) { evt.preventDefault(); commitInlineEdit(); }
    if (evt.key === "Escape") { $("inline-editor").style.display = "none"; }
  });

  // -------------------------------------------------------- toolbar wiring
  $("size-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-size]");
    if (!pill) return;
    state.sizeKey = pill.getAttribute("data-size");
    syncToolbar();
    render();
  });

  $("template-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-template]");
    if (!pill) return;
    applyTemplate(pill.getAttribute("data-template"));
  });

  $("font-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-font]");
    var b = selectedBlock();
    if (!pill || !b) return;
    b.font = pill.getAttribute("data-font");
    syncToolbar();
    render();
  });

  $("align-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-align]");
    var b = selectedBlock();
    if (!pill || !b) return;
    var newAlign = pill.getAttribute("data-align");
    // keep the block visually in place: move the anchor to the matching
    // edge/center of the current bbox
    if (b._bbox) {
      var W = canvas.width;
      if (newAlign === "left") b.x = b._bbox.x / W;
      else if (newAlign === "right") b.x = (b._bbox.x + b._bbox.w) / W;
      else b.x = (b._bbox.x + b._bbox.w / 2) / W;
    }
    b.align = newAlign;
    syncToolbar();
    render();
  });

  $("size-minus").addEventListener("click", function () {
    var b = selectedBlock();
    if (!b) return;
    b.sizeF = Math.max(0.01, b.sizeF * 0.9);
    syncToolbar(); render();
  });
  $("size-plus").addEventListener("click", function () {
    var b = selectedBlock();
    if (!b) return;
    b.sizeF = Math.min(0.4, b.sizeF * 1.1);
    syncToolbar(); render();
  });

  $("swatch-row").addEventListener("click", function (evt) {
    var sw = evt.target.closest("[data-color]");
    var b = selectedBlock();
    if (!sw || !b) return;
    b.color = sw.getAttribute("data-color");
    syncToolbar(); render();
  });
  $("custom-color").addEventListener("input", function () {
    var b = selectedBlock();
    if (!b) return;
    b.color = this.value;
    syncToolbar(); render();
  });

  $("delete-block").addEventListener("click", function () {
    var b = selectedBlock();
    if (!b) return;
    state.blocks = state.blocks.filter(function (x) { return x.id !== b.id; });
    state.selected = null;
    syncToolbar(); render();
  });

  $("add-text").addEventListener("click", function () {
    var block = makeBlock({
      text: "New text — tap to edit",
      font: "inter",
      sizeF: 0.04,
      color: bgIsLight() ? "#171512" : "#ffffff",
      y: 0.45
    });
    state.blocks.push(block);
    state.selected = block.id;
    syncToolbar(); render();
  });

  // background controls
  $("bg-row").addEventListener("click", function (evt) {
    var pill = evt.target.closest("[data-bg]");
    if (!pill) return;
    state.bg.mode = pill.getAttribute("data-bg");
    syncToolbar(); render();
  });
  $("bg-swatch-row").addEventListener("click", function (evt) {
    var sw = evt.target.closest("[data-bgcolor]");
    if (!sw) return;
    var c = sw.getAttribute("data-bgcolor");
    if (state.bg.mode === "photo") state.bg.mode = "solid";
    if (state.bg.mode === "gradient") { state.bg.c1 = c; }
    else { state.bg.c1 = c; state.bg.c2 = c; }
    syncToolbar(); render();
  });
  $("bg-custom-color").addEventListener("input", function () {
    if (state.bg.mode === "photo") state.bg.mode = "solid";
    state.bg.c1 = this.value;
    if (state.bg.mode === "solid") state.bg.c2 = this.value;
    syncToolbar(); render();
  });

  $("bg-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader(); // local only — the photo never leaves the device
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        state.bg.img = img;
        state.bg.mode = "photo";
        syncToolbar(); render();
        status("Photo added — use the darken slider to keep text readable.", "ok");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  $("darken-range").addEventListener("input", function () {
    state.bg.darken = this.value / 100;
    render();
  });

  $("toggle-sticker").addEventListener("click", function () {
    state.sticker.on = !state.sticker.on;
    if (state.sticker.on && !stickerImg) {
      var img = new Image();
      img.onload = function () { stickerImg = img; render(); };
      img.src = STICKER_URL;
    }
    syncToolbar(); render();
  });

  $("toggle-credit").addEventListener("click", function () {
    state.credit = !state.credit;
    syncToolbar(); render();
  });

  // ---------------------------------------------------------------- export
  function exportBlob() {
    commitInlineEdit();
    render(false); // no selection outline in the export
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        render(true);
        if (blob) resolve(blob); else reject(new Error("toBlob returned null"));
      }, "image/png");
    });
  }

  function exportFilename() {
    var base = (state.show && state.show.slug) ? state.show.slug : "comedy-poster";
    return base + "-" + state.sizeKey + ".png";
  }

  $("export-png").addEventListener("click", function () {
    exportBlob().then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
      var sz = SIZES[state.sizeKey];
      status("Downloaded " + exportFilename() + " (" + sz.w + "×" + sz.h + "px).", "ok");
    }).catch(function (e) { status("Export failed: " + e.message, "error"); });
  });

  $("copy-png").addEventListener("click", function () {
    if (!navigator.clipboard || !window.ClipboardItem) {
      status("Copy isn't supported in this browser — use Download PNG instead.", "error");
      return;
    }
    exportBlob().then(function (blob) {
      return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    }).then(function () {
      status("Poster copied — paste it anywhere.", "ok");
    }).catch(function (e) { status("Copy failed (" + e.message + ") — use Download PNG instead.", "error"); });
  });

  // ------------------------------------------------------------- boot
  $("blank-btn").addEventListener("click", function () {
    state.show = null;
    openEditor();
  });
  $("back-to-picker").addEventListener("click", function (evt) {
    evt.preventDefault();
    $("editor").style.display = "none";
    $("picker").style.display = "block";
  });
  $("show-search").addEventListener("input", function () { renderResults(this.value); });

  function loadFonts() {
    var wanted = [
      "400 20px PosterAnton", "600 20px PosterOswald", "700 20px PosterPlayfair",
      "400 20px PosterInter", "700 20px PosterInter", "400 20px PosterMarker"
    ];
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(wanted.map(function (f) { return document.fonts.load(f); }))
      .then(function () { fontsReady = true; });
  }

  var fontsP = loadFonts();

  loadEvents().then(function () {
    renderResults("");
    // ?event=<slug> deep link: show pages / booker portal link here with the
    // show_series slug (or an event slug) to open a prefilled editor directly.
    var params = new URLSearchParams(location.search);
    var want = params.get("event");
    if (want) {
      var match = allEvents.filter(function (ev) {
        return ev.show_series_slug === want || ev.slug === want;
      })[0];
      if (match) {
        fontsP.then(function () { startFromEvent(match); });
        return;
      }
      $("picker-note").textContent = "Couldn't find that show — pick it below or start blank.";
    }
  }).catch(function (e) {
    $("picker-note").textContent = "Couldn't load the show list (" + e.message + ") — you can still start from a blank canvas.";
  });

  fontsP.then(function () {
    // if the editor is already open (blank start before fonts landed), redraw
    if ($("editor").style.display === "block") render();
  });

  // re-render on resize only affects CSS scale; canvas pixels are fixed.
  // But the inline editor position depends on layout:
  window.addEventListener("resize", function () { $("inline-editor").style.display = "none"; });

  // expose for tests
  window.AtlasPoster = {
    state: state,
    render: render,
    applyTemplate: applyTemplate,
    exportBlob: exportBlob,
    SIZES: SIZES
  };
})();
