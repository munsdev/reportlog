/* The approved mock-up's page script, ported: Easier reading, looks, headline fitting, the header background engine with parallax, copy buttons. No fetching. */
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Easier reading, remembered per browser */
  var EASY = "el-easy";
  function setEasy(on) {
    root.classList.toggle("easy", on);
    document.querySelectorAll("[data-easy]").forEach(function (b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.textContent = on ? "Easier reading: on" : "Easier reading";
    });
    try { localStorage.setItem(EASY, on ? "1" : "0"); } catch (e) {}
  }
  var easy = false;
  try { easy = localStorage.getItem(EASY) === "1"; } catch (e) {}
  setEasy(easy);
  document.querySelectorAll("[data-easy]").forEach(function (b) {
    b.addEventListener("click", function () { setEasy(!root.classList.contains("easy")); });
  });

  /* Menu dialog */
  var menu = document.getElementById("menu");
  var opener = document.getElementById("menu-open");
  var closer = document.getElementById("menu-close");
  if (menu && opener && closer) {
    function openMenu() { menu.setAttribute("open", ""); opener.setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden"; closer.focus(); }
    function closeMenu() { menu.removeAttribute("open"); opener.setAttribute("aria-expanded", "false"); document.body.style.overflow = ""; opener.focus(); }
    opener.addEventListener("click", openMenu);
    closer.addEventListener("click", closeMenu);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.hasAttribute("open")) closeMenu(); });
    menu.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = menu.querySelectorAll("a[href],button:not([disabled])");
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------- Palettes and themes ----------
     The core ships these. A look pack can add more, and name its defaults. */
  var CORE_PALETTES = {
    "newsprint":  { label: "Newsprint",      chrome: "#1A1814", deep: "#1E1C18", paper: "#F1ECE1", ink: "#1A1814", action: "#E3B23C", onAction: "#1A1814", brand: "#E3B23C" },
    "ranger":     { label: "Ranger station", chrome: "#16201A", deep: "#1F2A22", paper: "#ECE6D6", ink: "#1B231D", action: "#E08A2E", onAction: "#16201A", brand: "#EBB56E" },
    "platinum":   { label: "Platinum",       chrome: "#1C1C1A", deep: "#22221F", paper: "#E4E3DE", ink: "#141413", action: "#2F5BE0", onAction: "#FFFFFF", brand: "#A9BCFF" },
    "boardroom":  { label: "Boardroom",      chrome: "#141726", deep: "#1A1D2E", paper: "#F1F2F6", ink: "#1A1D2E", action: "#5B7CFF", onAction: "#FFFFFF", brand: "#AFC0FF" },
    "press-pass": { label: "Press pass",     chrome: "#111111", deep: "#151515", paper: "#FAFAFA", ink: "#111111", action: "#FFE14D", onAction: "#111111", brand: "#FFE14D" },
    "phosphor":   { label: "Phosphor",       chrome: "#050D08", deep: "#07130B", paper: "#E4EEE6", ink: "#0B1A10", action: "#3DDC84", onAction: "#04120A", brand: "#3DDC84" },
    "porch":      { label: "Porch light",    chrome: "#2A1E16", deep: "#33251B", paper: "#F3ECE3", ink: "#2A1E16", action: "#F0A35E", onAction: "#2A1E16", brand: "#F5C08E" },
    "contrast":   { label: "High contrast",  chrome: "#000000", deep: "#000000", paper: "#FFFFFF", ink: "#000000", action: "#FFD400", onAction: "#000000", brand: "#FFD400" }
  };
  var SANS = '"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif';
  var CORE_THEMES = {
    "signal":      { label: "Signal",      display: '"Archivo",Arial,sans-serif', weight: 800, stretch: "100%", "case": "none", lh: ".98", track: "-.02em", hStretch: "100%", hWeight: 800, fitMax: 96, fitMin: 38, bandMax: 72, bandMin: 32, pageMax: "2.75rem", two: "muted", tag: "rule", radius: "16px", radiusBtn: "999px", line: "2px", shadow: "4px", btnCase: "none" },
    "broadsheet":  { label: "Broadsheet",  display: '"Newsreader",Georgia,serif', weight: 700, stretch: "100%", "case": "none", lh: "1.0", track: "-.02em", hStretch: "100%", hWeight: 700, fitMax: 104, fitMin: 38, bandMax: 76, bandMin: 32, pageMax: "2.75rem", two: "muted", tag: "plain", radius: "2px", radiusBtn: "3px", line: "2px", shadow: "0px", btnCase: "none" },
    "desk":        { label: "Desk",        display: '"Courier Prime","Courier New",monospace', weight: 700, stretch: "100%", "case": "none", lh: "1.02", track: "0", hStretch: "100%", hWeight: 700, fitMax: 72, fitMin: 30, bandMax: 56, bandMin: 28, pageMax: "2.25rem", two: "solid", tag: "rule", radius: "2px", radiusBtn: "2px", line: "2px", shadow: "3px", btnCase: "uppercase" },
    "docket":      { label: "Docket",      display: '"IBM Plex Sans",Arial,sans-serif', weight: 700, stretch: "100%", "case": "none", lh: "1.02", track: "-.015em", hStretch: "100%", hWeight: 700, fitMax: 68, fitMin: 30, bandMax: 52, bandMin: 28, pageMax: "2.25rem", two: "muted", tag: "plain", radius: "6px", radiusBtn: "6px", line: "2px", shadow: "0px", btnCase: "none" },
    "hyperlegible":{ label: "Hyperlegible",display: '"Atkinson Hyperlegible",Verdana,sans-serif', body: '"Atkinson Hyperlegible",Verdana,sans-serif', weight: 700, stretch: "100%", "case": "none", lh: "1.05", track: "0", hStretch: "100%", hWeight: 700, fitMax: 64, fitMin: 30, bandMax: 50, bandMin: 28, pageMax: "2.25rem", two: "solid", tag: "plain", radius: "10px", radiusBtn: "10px", line: "2px", shadow: "0px", btnCase: "none" },
    "terminal":    { label: "Terminal",    display: '"JetBrains Mono",ui-monospace,monospace', weight: 800, stretch: "100%", "case": "uppercase", lh: ".95", track: "-.03em", hStretch: "100%", hWeight: 800, fitMax: 84, fitMin: 30, bandMax: 60, bandMin: 28, pageMax: "2.25rem", two: "action", tag: "bar", radius: "0px", radiusBtn: "0px", line: "2px", shadow: "4px", btnCase: "uppercase" },
    "trailhead":   { label: "Trailhead",   display: '"Bitter",Georgia,serif', weight: 800, stretch: "100%", "case": "none", lh: ".98", track: "-.02em", hStretch: "100%", hWeight: 800, fitMax: 100, fitMin: 36, bandMax: 72, bandMin: 30, pageMax: "2.75rem", two: "action", tag: "rule", radius: "8px", radiusBtn: "10px", line: "3px", shadow: "4px", btnCase: "none" },
    "compact-poster": { label: "Poster, tempered", display: '"Archivo","Arial Narrow",Arial,sans-serif', weight: 800, stretch: "112%", "case": "uppercase", lh: ".9", track: "-.01em", hStretch: "105%", hWeight: 800, fitMax: 84, fitMin: 36, bandMax: 60, bandMin: 30, pageMax: "2.5rem", two: "outline", tag: "bar", radius: "10px", radiusBtn: "12px", line: "3px", shadow: "4px", btnCase: "uppercase" }
  };
  /* The catalogue is rebuilt IN PLACE by setPacks(), so everything that holds one
     of these objects (the look switcher, window.elLook.palettes) keeps seeing
     the current one. */
  var PACKS = [];
  var PALETTES = {}, THEMES = {}, ELEMENTS = [], SHAPES = {};
  var CORE_DEFAULTS = { palette: "platinum", theme: "desk", bg: { on: { ruled: false } } };
  var DEFAULTS = CORE_DEFAULTS;
  function addAll(dst, src, from) { for (var k in src) dst[k] = Object.assign({ from: from }, src[k]); }
  function clear(o) { if (Array.isArray(o)) o.length = 0; else for (var k in o) delete o[k]; }
  function setPacks(packs) {
    clear(PACKS); clear(PALETTES); clear(THEMES); clear(ELEMENTS); clear(SHAPES);
    DEFAULTS = CORE_DEFAULTS;
    (packs || []).forEach(function (p) { PACKS.push(p); });
    ELEMENTS.push({ id: "ruled", label: "Ruled lines", kind: "ruled", from: "ReportLog" });
    PACKS.forEach(function (p) {
      addAll(PALETTES, p.palettes || {}, p.label); addAll(THEMES, p.themes || {}, p.label);
      if (p.defaults) DEFAULTS = p.defaults;
      for (var s in p.shapes || {}) SHAPES[s] = p.shapes[s];
      (p.elements || []).forEach(function (e) { ELEMENTS.push(Object.assign({ from: p.label }, e)); });
    });
    addAll(PALETTES, CORE_PALETTES, "ReportLog"); addAll(THEMES, CORE_THEMES, "ReportLog");
  }
  setPacks(window.RL_LOOK_PACKS || []);

  function applyPalette(id) {
    var P = PALETTES[id]; if (!P) return;
    var map = { chrome: "--p-chrome", deep: "--p-deep", paper: "--p-paper", ink: "--p-ink", action: "--p-action", onAction: "--p-on-action", brand: "--p-brand" };
    for (var k in map) root.style.setProperty(map[k], P[k]);
  }
  function applyTheme(id) {
    var T = THEMES[id]; if (!T) return;
    var st = root.style;
    st.setProperty("--rl-font-display", T.display);
    st.setProperty("--rl-font-sans", T.body || SANS);
    st.setProperty("--d-weight", T.weight); st.setProperty("--d-stretch", T.stretch); st.setProperty("--d-case", T["case"]);
    st.setProperty("--d-lh", T.lh); st.setProperty("--d-track", T.track);
    st.setProperty("--h-stretch", T.hStretch); st.setProperty("--h-weight", T.hWeight);
    st.setProperty("--fit-max", T.fitMax); st.setProperty("--fit-min", T.fitMin);
    st.setProperty("--band-max", T.bandMax); st.setProperty("--band-min", T.bandMin); st.setProperty("--page-max", T.pageMax);
    st.setProperty("--rl-radius", T.radius); st.setProperty("--rl-radius-btn", T.radiusBtn);
    st.setProperty("--rl-line", T.line); st.setProperty("--rl-shadow-offset", T.shadow); st.setProperty("--btn-case", T.btnCase);
    root.setAttribute("data-two", T.two); root.setAttribute("data-tag", T.tag);
  }

  /* ---------- Look settings ----------
     The app hands the site's saved look to window.elSetLook(look, packs). With
     nothing handed over, the core defaults apply. */
  var LOOK_KEY = "el-look";
  function freshBg() {
    var on = {}; var d = (DEFAULTS.bg && DEFAULTS.bg.on) || {};
    for (var k in d) on[k] = d[k];
    return { on: on, patOp: 0.14, shapeOp: 0.2, style: {}, img: null, imgPlace: "behind", imgShape: "", imgMode: "under", imgTone: "mono", imgOp: 0.4, imgFocus: 60, fade: "side", fadeAmt: 0.5 };
  }
  function freshLook() { return { palette: DEFAULTS.palette, theme: DEFAULTS.theme, bg: freshBg(), motion: "on", zones: "alternate" }; }
  var look = freshLook(), serverLook = null;
  var IMG_KEY = "el-look-img", imgVolatile = false;
  function adopt(saved) {
    look = freshLook();
    try {
      saved = saved || {};
      for (var k in saved) if (k !== "bg" && k !== "decor") look[k] = saved[k];
      if (saved.bg) { for (var b in saved.bg) look.bg[b] = saved.bg[b]; }
      look.bg.img = saved.img || (saved.bg && saved.bg.img) || null;
    } catch (e) {}
    if (!PALETTES[look.palette]) look.palette = DEFAULTS.palette;
    if (!THEMES[look.theme]) look.theme = DEFAULTS.theme;
  }
  adopt(window.RL_SITE_LOOK);
  function applyLook() {
    applyPalette(look.palette); applyTheme(look.theme);
    root.setAttribute("data-motion", look.motion);
    root.setAttribute("data-zones", look.zones);
    document.querySelectorAll(".zone").forEach(function (z) {
      z.classList.toggle("scope-light", z.getAttribute("data-zone") === "b" && look.zones === "alternate");
    });
  }
  function save() { try { var c = JSON.parse(JSON.stringify(look)); c.bg.img = null; localStorage.setItem(LOOK_KEY, JSON.stringify(c)); } catch (e) {} }
  window.elLook = {
    get: function () { return JSON.parse(JSON.stringify(look)); },
    set: function (k, v) { look[k] = v; save(); applyLook(); redrawAll(); fitAll(); },
    setBg: function (k, v) { look.bg[k] = v; save(); redrawAll(); },
    setImage: function (dataUrl) { look.bg.img = dataUrl; imgVolatile = false; try { if (dataUrl) localStorage.setItem(IMG_KEY, dataUrl); else localStorage.removeItem(IMG_KEY); } catch (e) { imgVolatile = true; } save(); redrawAll(); return !imgVolatile; },
    reset: function () { adopt(serverLook); try { localStorage.removeItem(LOOK_KEY); localStorage.removeItem(IMG_KEY); } catch (e) {} applyLook(); redrawAll(); fitAll(); },
    palettes: PALETTES, themes: THEMES
  };
  applyLook();
  /* Sets the site's look and the look packs' parts (palettes, themes, header
     elements and shapes, in the shape this script uses), then redraws and
     refits. The app calls it whenever the saved look or the installed packs
     change. */
  window.elSetLook = function (saved, packs) {
    setPacks(packs);
    serverLook = saved ? JSON.parse(JSON.stringify(saved)) : null;
    adopt(serverLook);
    applyLook(); redrawAll(); fitAll();
    if (document.getElementById("lookfab")) { window.elLookSwitcher(false); window.elLookSwitcher(true); }
  };

  /* ---------- Headline fitting ----------
     Each headline line keeps to one line at the largest size that fits,
     between the theme's minimum and maximum. If a line still does not fit at
     the minimum, the headline is allowed to wrap. */
  function splitLines(h) {
    if (h.querySelector(":scope > .ln")) return;
    var groups = [[]];
    Array.from(h.childNodes).forEach(function (n) { if (n.nodeName === "BR") groups.push([]); else groups[groups.length - 1].push(n); });
    h.textContent = "";
    groups.forEach(function (g) {
      if (!g.length) return;
      var s = document.createElement("span"); s.className = "ln";
      if (g.length === 1 && g[0].nodeType === 1 && g[0].classList.contains("two")) s.classList.add("two");
      g.forEach(function (n) { if (n.nodeType === 1 && n.classList.contains("two")) { while (n.firstChild) s.appendChild(n.firstChild); } else s.appendChild(n); });
      h.appendChild(s);
    });
    h.classList.add("fit");
  }
  function fit(h) {
    splitLines(h);
    var cs = getComputedStyle(root);
    var band = h.classList.contains("h-band");
    var max = parseFloat(cs.getPropertyValue(band ? "--band-max" : "--fit-max")) || 120;
    var min = parseFloat(cs.getPropertyValue(band ? "--band-min" : "--fit-min")) || 32;
    if (h.dataset.fitMax) max = Math.min(max, parseFloat(h.dataset.fitMax));
    var easy = root.classList.contains("easy"); if (easy) max = Math.min(max, 64);
    h.classList.remove("wrapit");
    var avail = h.clientWidth; if (!avail) return;
    var lines = h.querySelectorAll(":scope > .ln");
    function widest() { var w = 0; lines.forEach(function (l) { w = Math.max(w, l.scrollWidth); }); return w; }
    function search(ok) { var lo = min, hi = max, best = 0; h.style.fontSize = hi + "px"; if (ok()) return hi; for (var i = 0; i < 9; i++) { var mid = (lo + hi) / 2; h.style.fontSize = mid + "px"; if (ok()) { best = mid; lo = mid; } else hi = mid; } return best; }
    /* 1. every line on one line */
    var single = search(function () { return widest() <= avail; });
    /* 2. if that came out small, try letting each line break once (at most two rows per line) */
    var wrapped = 0;
    if (single < max * 0.62) {
      h.classList.add("wrapit");
      wrapped = search(function () {
        if (widest() > avail) return false;
        var lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(h.style.fontSize);
        for (var i = 0; i < lines.length; i++) if (lines[i].getBoundingClientRect().height > lh * 2.2) return false;
        return true;
      });
      h.classList.remove("wrapit");
    }
    if (wrapped > single * 1.2) { h.classList.add("wrapit"); h.style.fontSize = Math.floor(wrapped) + "px"; return; }
    if (single) { h.style.fontSize = Math.floor(single) + "px"; return; }
    h.classList.add("wrapit"); h.style.fontSize = min + "px";
  }
  function fitAll() { document.querySelectorAll(".display, .h-band").forEach(fit); }
  window.elFitAll = fitAll;
  fitAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(fitAll, 80); });
  document.querySelectorAll("[data-easy]").forEach(function (b) { b.addEventListener("click", function () { setTimeout(fitAll, 0); }); });

  /* ---------- Header background engine (core) ----------
     Layers behind a headline: pattern elements (lines, stars, stripes), big
     shapes (outline or filled), and an optional image placed behind, inside
     a shape, or as a taped print. The core knows how to draw each kind; a look
     pack decides which elements exist and supplies the shapes. */
  var NS = "http://www.w3.org/2000/svg";
  function el(t, a, p) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  function rng(seed) { return function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; }
  window.elDecor = { elements: ELEMENTS, shapes: SHAPES, packs: PACKS };

  function svgLayer(cls, depth) {
    var svg = el("svg", { viewBox: "0 0 1200 900", preserveAspectRatio: "xMaxYMid slice", "aria-hidden": "true", focusable: "false", "class": cls });
    svg.setAttribute("data-depth", depth || 0);
    return svg;
  }
  function drawPattern(kind, seed) {
    var svg = svgLayer("pat", kind === "stars" ? 0.3 : kind === "stripes" ? 0.1 : 0.05);
    var g = el("g", { fill: "currentColor" }, svg);
    if (kind === "stripes") {
      g.setAttribute("transform", "skewY(-9)"); g.setAttribute("fill-opacity", ".55");
      for (var k = -3; k < 12; k++) el("rect", { x: 0, y: k * 92 + 60, width: 1200, height: 30 }, g);
    } else if (kind === "stars") {
      var R = rng(seed);
      for (var i = 0; i < 56; i++) {
        var x = 460 + R() * 740, y = R() * 900, r = 5 + R() * 16, o = 0.45 + R() * 0.55, pts = [];
        for (var j = 0; j < 10; j++) { var q = j % 2 ? r * 0.42 : r, a = -Math.PI / 2 + j * Math.PI / 5; pts.push((x + Math.cos(a) * q).toFixed(1) + "," + (y + Math.sin(a) * q).toFixed(1)); }
        el("polygon", { points: pts.join(" "), "fill-opacity": o.toFixed(2) }, g);
      }
    } else if (kind === "ruled") {
      g.setAttribute("fill", "none"); g.setAttribute("stroke", "currentColor"); g.setAttribute("stroke-opacity", ".8");
      for (var y = 30; y < 900; y += 38) el("line", { x1: 0, y1: y, x2: 1200, y2: y, "stroke-width": 2 }, g);
      el("line", { x1: 84, y1: 0, x2: 84, y2: 900, "stroke-width": 3 }, g);
      el("line", { x1: 94, y1: 0, x2: 94, y2: 900, "stroke-width": 1.5 }, g);
    }
    return svg;
  }
  function shapeBox(E, slot) {
    var S = SHAPES[E.shape], vb = S.v.split(/\s+/).map(Number);
    var h = 900 * (E.h || 0.7) * (slot === "band" ? 0.95 : 1), w = h * vb[2] / vb[3];
    if (w > 760) { w = 760; h = w * vb[3] / vb[2]; }
    return { S: S, vb: vb, x: 1200 - w - 30, y: 450 - h / 2, w: w, h: h };
  }
  function drawShape(E, slot, style, imgUrl) {
    var B = shapeBox(E, slot), svg = svgLayer("shp", 0.16);
    var inner = el("svg", { x: B.x.toFixed(1), y: B.y.toFixed(1), width: B.w.toFixed(1), height: B.h.toFixed(1), viewBox: B.S.v, preserveAspectRatio: "xMidYMid meet" }, svg);
    if (imgUrl) {
      var id = "clip-" + E.id + "-" + Math.round(Math.random() * 1e6);
      var cp = el("clipPath", { id: id }, el("defs", {}, inner));
      el("path", { d: B.S.d }, cp);
      var im = el("image", { href: imgUrl, x: B.vb[0], y: B.vb[1], width: B.vb[2], height: B.vb[3], preserveAspectRatio: "xMidYMid slice", "clip-path": "url(#" + id + ")" }, inner);
      im.setAttribute("class", "shp-img");
      el("path", { d: B.S.d, fill: "none", stroke: "currentColor", "stroke-width": (B.vb[2] / 300).toFixed(2), "stroke-opacity": ".6" }, inner);
    } else if (style === "outline") {
      el("path", { d: B.S.d, fill: "none", stroke: "currentColor", "stroke-width": (B.vb[2] / 240).toFixed(2), "stroke-linejoin": "round" }, inner);
    } else {
      el("path", { d: B.S.d, fill: "currentColor" }, inner);
    }
    return svg;
  }
  function maskFor(fade, amt, small) {
    amt = Math.max(0, Math.min(1, amt));
    if (fade === "none" || amt === 0) return "none";
    if (fade === "bottom" || (small && fade === "side")) return "linear-gradient(180deg,#000 " + Math.round(100 - amt * 75) + "%,transparent 100%)";
    if (fade === "radial") return "radial-gradient(ellipse 70% 90% at 78% 50%,#000 " + Math.round(70 - amt * 50) + "%,transparent " + Math.round(100 - amt * 15) + "%)";
    var a0 = Math.round(amt * 40); return "linear-gradient(90deg,transparent " + a0 + "%,#000 " + Math.round(a0 + 10 + amt * 30) + "%)";
  }
  var hosts = [];
  function drawHost(ov, n) {
    ov.textContent = "";
    var slot = ov.getAttribute("data-slot") || "band", B = look.bg;
    if (slot === "cover") { ov.appendChild(drawPattern("ruled", 3)); ov.hidden = false; return; }
    var img = slot === "hero" ? B.img : null;
    var hidePattern = img && B.imgMode === "replace";
    var count = 0;
    if (img && B.imgPlace === "behind") {
      var d = document.createElement("div"); d.className = "bgimg tone-" + B.imgTone; d.setAttribute("data-depth", "0.08");
      d.style.backgroundImage = 'url("' + img + '")'; d.style.backgroundPosition = B.imgFocus + "% 50%"; d.style.opacity = window.innerWidth < 700 ? Math.min(B.imgOp, 0.35) : B.imgOp;
      ov.appendChild(d); count++;
    }
    if (!hidePattern) ELEMENTS.forEach(function (E, i) {
      if (!B.on[E.id] || E.kind === "shape") return;
      ov.appendChild(drawPattern(E.kind, 11 + n * 7 + i * 3)); count++;
    });
    ELEMENTS.forEach(function (E) {
      if (E.kind !== "shape" || !SHAPES[E.shape]) return;
      var holdsImg = img && B.imgPlace === "shape" && B.imgShape === E.id;
      if (!holdsImg && (hidePattern || !B.on[E.id])) return;
      var svg = drawShape(E, slot, (B.style[E.id] || E.style || "filled"), holdsImg ? img : null);
      svg.style.opacity = holdsImg ? B.imgOp : B.shapeOp * (slot === "band" ? 0.8 : 1);
      if (holdsImg) svg.classList.add("tone-" + B.imgTone);
      ov.appendChild(svg); count++;
    });
    if (img && B.imgPlace === "taped") {
      var t = document.createElement("div"); t.className = "taped"; t.setAttribute("data-depth", "0.12");
      var ph = document.createElement("div"); ph.className = "taped-ph tone-" + B.imgTone; ph.style.backgroundImage = 'url("' + img + '")'; ph.style.backgroundPosition = B.imgFocus + "% 50%";
      var tape = document.createElement("span"); tape.className = "tape";
      t.append(ph, tape); t.style.opacity = Math.max(0.35, B.imgOp * 1.6);
      ov.appendChild(t); count++;
    }
    ov.hidden = !count;
  }
  function applyMask() {
    root.style.setProperty("--ov-mask", maskFor(look.bg.fade, look.bg.fadeAmt, false));
    root.style.setProperty("--ov-mask-sm", maskFor(look.bg.fade, look.bg.fadeAmt, true));
    root.style.setProperty("--pat-op", look.bg.patOp);
  }
  function redrawAll() {
    applyMask();
    hosts = Array.from(document.querySelectorAll(".ov"));
    hosts.forEach(drawHost);
    move();
  }
  var ticking = false;
  function move() {
    var still = reduce || look.motion === "off";
    hosts.forEach(function (ov) {
      var top = ov.parentElement.getBoundingClientRect().top;
      ov.querySelectorAll("[data-depth]").forEach(function (L) {
        var d = still ? 0 : Number(L.getAttribute("data-depth"));
        L.style.transform = d ? "translate3d(0," + (-top * d).toFixed(1) + "px,0)" : "";
      });
    });
    ticking = false;
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(move); } }, { passive: true });
  var rdw; window.addEventListener("resize", function () { clearTimeout(rdw); rdw = setTimeout(redrawAll, 150); });
  window.elDrawOverlays = redrawAll;
  redrawAll();

  /* ---------- Header background editor (one component, used by the Look
     panel, Settings > Look and the page editor) ---------- */
  function h(tag, attrs, kids) { var e = document.createElement(tag); for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } (kids || []).forEach(function (c) { if (c) e.appendChild(c); }); return e; }
  var bgUid = 0;
  function bgEditor() {
    var uid = "bge" + (++bgUid), box = h("div", { "class": "bge" });
    function group(title, kids, note) { var g = h("div", { "class": "bge-g" }, [h("h4", { text: title })].concat(kids)); if (note) g.appendChild(h("p", { "class": "bge-note", text: note })); box.appendChild(g); return g; }
    function chips(key, opts, sub) {
      var r = h("div", { "class": "bge-row", role: "group" });
      opts.forEach(function (o) { r.appendChild(h("button", { type: "button", "class": "bge-chip", "data-bg": key, "data-v": o[0], "data-sub": sub || "", text: o[1] })); });
      return r;
    }
    function slider(key, label, min, max, step, fmt) {
      var id = uid + "-" + key, out = h("output", { "for": id });
      var inp = h("input", { type: "range", id: id, min: min, max: max, step: step, "data-bgr": key });
      inp.addEventListener("input", function () { out.textContent = fmt(+inp.value); window.elLook.setBg(key, +inp.value); });
      return h("div", { "class": "bge-slider" }, [h("label", { "for": id, text: label }), inp, out]);
    }
    var pct = function (v) { return Math.round(v * 100) + "%"; };
    // elements
    var toggles = h("div", { "class": "bge-row" });
    ELEMENTS.forEach(function (E) { toggles.appendChild(h("button", { type: "button", "class": "bge-chip", "data-tog": E.id, text: E.label })); });
    group("Elements", [toggles, slider("patOp", "Lines, stars, stripes", 0.04, 0.4, 0.01, pct)], "Each one is on or off. With none on, the header is plain.");
    var shapeRows = h("div", { "class": "bge-shapes" });
    ELEMENTS.filter(function (E) { return E.kind === "shape"; }).forEach(function (E) {
      shapeRows.appendChild(h("div", { "class": "bge-shape", "data-shape-row": E.id }, [h("span", { text: E.label }), chips("style", [["filled", "Filled"], ["outline", "Outline"]], E.id)]));
    });
    if (shapeRows.children.length) group("Big shapes", [shapeRows, slider("shapeOp", "Shape strength", 0.05, 0.6, 0.01, pct)]);
    // image
    var file = h("input", { type: "file", accept: "image/*", id: uid + "-file", "class": "vh" });
    var addLbl = h("label", { "for": uid + "-file", "class": "bge-btn", text: "Add an image" });
    var thumb = h("div", { "class": "bge-thumb", "aria-hidden": "true" });
    var remove = h("button", { type: "button", "class": "bge-btn ghost", text: "Remove image" });
    var imgMsg = h("p", { "class": "bge-note", role: "status" });
    var imgOpts = h("div", { "class": "bge-imgopts" }, [
      h("span", { "class": "bge-sub", text: "Place" }), chips("imgPlace", [["behind", "Behind"], ["shape", "Inside a shape"], ["taped", "Taped print"]]),
      h("div", { "class": "bge-row", "data-for-place": "shape" }, ELEMENTS.filter(function (E) { return E.kind === "shape"; }).map(function (E) { return h("button", { type: "button", "class": "bge-chip", "data-bg": "imgShape", "data-v": E.id, text: E.label }); })),
      h("span", { "class": "bge-sub", text: "With the elements" }), chips("imgMode", [["under", "Elements on top"], ["replace", "Image only"]]),
      h("span", { "class": "bge-sub", text: "Color" }), chips("imgTone", [["color", "Full color"], ["mono", "Black and white"], ["dark", "Darkened"]]),
      slider("imgOp", "Image strength", 0.1, 1, 0.01, pct),
      slider("imgFocus", "Focus, left to right", 0, 100, 1, function (v) { return v + "%"; })
    ]);
    group("Image", [h("div", { "class": "bge-row" }, [addLbl, remove]), thumb, file, imgMsg, imgOpts], "Only the front-page header uses the image. No stock photos are loaded from anywhere; the file stays on this site.");
    // fade
    group("Fade", [chips("fade", [["side", "From the side"], ["bottom", "Toward the bottom"], ["radial", "Spotlight"], ["none", "None"]]), slider("fadeAmt", "Fade strength", 0, 1, 0.01, pct)], "Keeps the headline side clear. On a phone a side fade becomes a fade toward the bottom.");

    file.addEventListener("change", function () {
      var f = file.files && file.files[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { imgMsg.textContent = "That file is not an image."; return; }
      var rd = new FileReader();
      rd.onload = function () {
        var im = new Image();
        im.onload = function () {
          var k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement("canvas");
          c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          var url = c.toDataURL("image/jpeg", 0.82);
          var kept = window.elLook.setImage(url);
          imgMsg.textContent = kept ? "Image added." : "Image added for this visit. It is too large to keep in this browser.";
          sync();
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f); file.value = "";
    });
    remove.addEventListener("click", function () { window.elLook.setImage(null); imgMsg.textContent = "Image removed."; sync(); });
    box.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tog]");
      if (t) { var on = Object.assign({}, look.bg.on); on[t.dataset.tog] = !on[t.dataset.tog]; window.elLook.setBg("on", on); sync(); return; }
      var c = e.target.closest("[data-bg]"); if (!c) return;
      if (c.dataset.sub) { var st = Object.assign({}, look.bg.style); st[c.dataset.sub] = c.dataset.v; window.elLook.setBg("style", st); }
      else window.elLook.setBg(c.dataset.bg, c.dataset.v);
      sync();
    });
    function sync() {
      var B = look.bg;
      box.querySelectorAll("[data-tog]").forEach(function (b) { b.setAttribute("aria-pressed", B.on[b.dataset.tog] ? "true" : "false"); });
      box.querySelectorAll("[data-bg]").forEach(function (b) {
        var cur = b.dataset.sub ? (B.style[b.dataset.sub] || (ELEMENTS.filter(function (E) { return E.id === b.dataset.sub; })[0] || {}).style || "filled") : B[b.dataset.bg];
        b.setAttribute("aria-pressed", String(cur) === b.dataset.v ? "true" : "false");
      });
      box.querySelectorAll("[data-bgr]").forEach(function (i) { i.value = B[i.dataset.bgr]; i.nextElementSibling.textContent = i.dataset.bgr === "imgFocus" ? B.imgFocus + "%" : Math.round(B[i.dataset.bgr] * 100) + "%"; });
      box.querySelectorAll("[data-shape-row]").forEach(function (r) { r.hidden = !B.on[r.dataset.shapeRow]; });
      thumb.hidden = !B.img; remove.hidden = !B.img; imgOpts.hidden = !B.img;
      thumb.style.backgroundImage = B.img ? 'url("' + B.img + '")' : "";
      addLbl.textContent = B.img ? "Replace image" : "Add an image";
      var fp = box.querySelector('[data-for-place="shape"]'); if (fp) fp.hidden = B.imgPlace !== "shape";
    }
    box.sync = sync; sync();
    return box;
  }
  window.elBgEditor = { create: bgEditor };

  /* ---------- Floating look switcher ----------
     Shown to administrators and the owner only: the app calls
     window.elLookSwitcher(true) for them and (false) for everybody else. */
  function buildLookSwitcher() {
    if (document.getElementById("lookfab")) return;
    var fabBtn = h("button", { type: "button", id: "lookfab", "class": "lookfab", "aria-expanded": "false", "aria-controls": "lookpanel" });
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2zM6.5 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg><span>Look</span>';
    var panel = h("div", { id: "lookpanel", "class": "lookpanel", role: "dialog", "aria-label": "Try a look" });
    var close = h("button", { type: "button", "class": "lp-x", text: "Close" });
    panel.appendChild(h("div", { "class": "lp-head" }, [h("b", { text: "Try a look" }), close]));

    function section(title, body) { var s = h("section", {}, [h("h3", { text: title }), body]); panel.appendChild(s); return s; }
    var palGrid = h("div", { "class": "lp-grid" }), thmGrid = h("div", { "class": "lp-grid" }), motRow = h("div", { "class": "lp-row" });
    Object.keys(PALETTES).forEach(function (id) {
      var P = PALETTES[id];
      var sw = h("span", { "class": "lp-sw", "aria-hidden": "true" }, [P.deep, P.paper, P.action, P.brand].map(function (c) { var i = h("i"); i.style.background = c; return i; }));
      var b = h("button", { type: "button", "class": "lp-opt", "data-k": "palette", "data-v": id }, [sw, h("span", { "class": "nm", text: P.label }), h("span", { "class": "src", text: P.from })]);
      palGrid.appendChild(b);
    });
    Object.keys(THEMES).forEach(function (id) {
      var T = THEMES[id];
      var aa = h("span", { "class": "lp-aa", text: T["case"] === "uppercase" ? "AA" : "Aa", "aria-hidden": "true" });
      aa.style.fontFamily = T.display; aa.style.fontWeight = T.weight; aa.style.fontStretch = T.stretch;
      var b = h("button", { type: "button", "class": "lp-opt", "data-k": "theme", "data-v": id }, [aa, h("span", { "class": "nm", text: T.label }), h("span", { "class": "src", text: T.from })]);
      thmGrid.appendChild(b);
    });
    [["on", "Parallax"], ["off", "Still"]].forEach(function (m) { motRow.appendChild(h("button", { type: "button", "class": "lp-chip", "data-k": "motion", "data-v": m[0], text: m[1] })); });
    section("Palette", palGrid); section("Theme", thmGrid); var bgSec = section("Header background", bgEditor()); bgSec.id = "lp-bg"; section("Motion", motRow);
    var reset = h("button", { type: "button", "class": "lp-chip", text: "Back to the saved look" });
    panel.appendChild(h("section", {}, [reset]));
    panel.appendChild(h("p", { "class": "lp-note", text: "A mock-up tool for trying combinations. In the product these are the owner's choices in Settings › Look, and visitors don't see this button." }));

    function sync() {
      var cur = window.elLook.get();
      panel.querySelectorAll("[data-k]").forEach(function (b) { b.setAttribute("aria-pressed", cur[b.dataset.k] === b.dataset.v ? "true" : "false"); });
    }
    panel.addEventListener("click", function (e) {
      var b = e.target.closest("[data-k]"); if (!b) return;
      window.elLook.set(b.dataset.k, b.dataset.v); sync();
    });
    reset.addEventListener("click", function () { window.elLook.reset(); sync(); panel.querySelectorAll(".bge").forEach(function (b) { b.sync(); }); });
    window.elOpenLook = function (toBg) { open(); if (toBg) { var sec = document.getElementById("lp-bg"); panel.scrollTop = sec.offsetTop - 56; } };
    function open() { panel.setAttribute("open", ""); panel.querySelectorAll(".bge").forEach(function (b) { b.sync(); }); fabBtn.setAttribute("aria-expanded", "true"); sync(); var p = panel.querySelector('[aria-pressed="true"]') || close; p.focus(); }
    function shut() { panel.removeAttribute("open"); fabBtn.setAttribute("aria-expanded", "false"); fabBtn.focus(); }
    fabBtn.addEventListener("click", function () { panel.hasAttribute("open") ? shut() : open(); });
    close.addEventListener("click", shut);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.hasAttribute("open")) shut(); });
    document.body.append(panel, fabBtn);
  }
  window.elLookSwitcher = function (on) {
    var fab = document.getElementById("lookfab"), pnl = document.getElementById("lookpanel");
    if (on) { if (!fab) buildLookSwitcher(); }
    else { if (fab) fab.remove(); if (pnl) pnl.remove(); }
  };

  /* Copy buttons */
  var toast = document.getElementById("toast");
  function say(msg) { if (!toast) return; toast.textContent = msg; toast.classList.add("show"); clearTimeout(say.t); say.t = setTimeout(function () { toast.classList.remove("show"); }, 1800); }
  document.querySelectorAll("button[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var txt = b.getAttribute("data-copy");
      function fallback() { var ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); say("Copied"); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { say("Copied"); }, fallback); else fallback();
    });
  });

  window.elSay = say;
  /* The app renders pages without reloading: it calls this after every page is drawn. */
  window.elRefresh = function () {
    applyLook(); redrawAll(); fitAll();
    setEasy(root.classList.contains("easy"));
  };
})();
