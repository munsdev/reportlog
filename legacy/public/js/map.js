/* map.js — heat maps: where published reports came from.
 *
 * ONE MAP PER INSTANCE, AND THERE CAN BE SEVERAL ON A PAGE. This module
 * used to be a singleton — one `map`, one `DATA`, one `state`, and every
 * part of its markup addressed by id — which is exactly as many maps as a
 * document can have. An operator can now make as many as they want
 * (migration 049), each with its own threshold, its own feeds and its own
 * slot on the site, so everything that belongs to a map lives in a closure
 * and every element is found through `data-map="..."` INSIDE that map's own
 * root. A lookup by id would have found the first map's legend from the
 * second map's code and painted the wrong one, silently.
 *
 * WHAT IS SHARED is what is genuinely the same for every map: the outlines
 * (470 KB, fetched once) and Leaflet itself (148 KB). Two maps on a page
 * cost one download between them.
 *
 * Two planes, because they answer two different questions. The US plane
 * is the contiguous 48 and DC, filling the panel so the states are as
 * large and as tappable as they can be; Alaska, Hawaii and the five
 * territories are tiles beneath it, so none of them has to compete with
 * Texas for room. The world plane is Equal Earth with every country in
 * its true place.
 *
 * NOTHING IS FETCHED UNTIL THE VIEW IS OPENED, and that promise is now
 * per-slot: a map on the front page is not loaded because somebody opened
 * the board. src/mapSlots.js carries which screen each slot is on, and
 * `renderMapsFor` is given the screen that just opened.
 *
 * WHAT THIS MODULE DOES NOT DECIDE. The threshold, which views are
 * offered and which question supplies the outcome are the operator's,
 * and arrive in the payload. There is no reader-facing control for any
 * of them: a reader who could lower the threshold could undo the one
 * thing it is for. docs/map.md has the whole of it.
 */

var PLACEMENT_URL = '/api/map';
var LEAFLET_JS = '/vendor/leaflet.js';
var LEAFLET_CSS = '/vendor/leaflet.css';
var GEO_URL = '/geo/maps.json';

var STEPS = 5;
var SEVS = ['note', 'irregularity', 'serious', 'systemic'];
var SEV_W = { note: 0, irregularity: 1, serious: 2, systemic: 3 };
/* Below this many pixels on screen an area is a speck nobody can see or
   tap, so a constant-size marker is drawn over it. The shape stays
   underneath — the marker is an addition, never a replacement, so
   nothing can become unclickable. Zoom in and the dot gives way. */
var TINY_PX = 9;

/* ---------- what every map on the page shares ---------- */

var GEO = null;            // the outlines, once fetched
var geoPromise = null;     // so two maps opening at once fetch them once
var PLACEMENT = null;      // which maps exist and where they go
var placementPromise = null;
var INSTANCES = new Map(); // container element -> the map mounted in it

/* ---------- small helpers ---------- */
function mk(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function byId(id) { return document.getElementById(id); }
function isUS(code) { return code.indexOf('US-') === 0; }

function loadScript(src) {
  return new Promise(function (res, rej) {
    if (document.querySelector('script[data-src="' + src + '"]')) return res();
    var s = document.createElement('script');
    s.src = src;
    s.setAttribute('data-src', src);
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

function loadCss(href) {
  if (document.querySelector('link[data-href="' + href + '"]')) return;
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.setAttribute('data-href', href);
  document.head.appendChild(l);
}

/** Leaflet and the outlines, once for the whole page. */
function loadShared() {
  if (geoPromise) return geoPromise;
  loadCss(LEAFLET_CSS);
  geoPromise = Promise.all([
    loadScript(LEAFLET_JS),
    fetch(GEO_URL, { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
  ]).then(function (out) {
    GEO = out[1];
    return GEO;
  });
  return geoPromise;
}

function at(p) { return L.latLng(-p[1], p[0]); }
function boundsOf(b) { return L.latLngBounds(at(b[0]), at(b[1])); }

/* ONE NAME LOOKUP, over the map AND the tiles. Alaska and the
   territories are not in the map's shape set — they are tiles — so a
   readout built only from the map prints `US-PR` where it should print
   "Puerto Rico". Module-level because the outlines are. */
function nameOf(code) {
  if (!GEO) return code;
  if (GEO.us.areas[code]) return GEO.us.areas[code].name;
  if (GEO.world.areas[code]) return GEO.world.areas[code].name;
  for (var i = 0; i < (GEO.tiles || []).length; i++) {
    if (GEO.tiles[i].code === code) return GEO.tiles[i].name;
  }
  return code;
}

/* ================= one map =================
 *
 * Everything below belongs to ONE heat map and nothing in it may reach
 * another. `root` is this map's cloned template; `q` only ever looks
 * inside it.
 */
function createInstance(root, meta) {
  var DATA = null;
  var map = null;
  var groups = {};
  var layers = {};
  var tiles = new Map();
  var SUPPRESSED = new Set();
  var loading = false;
  var loaded = false;

  /* The reader's two switches. `plane` starts on whichever the operator
     actually offers, not on 'us' — a map of countries only would otherwise
     open on a plane it does not have and draw nothing. */
  var planes = (meta.planes && meta.planes.length) ? meta.planes : ['us'];
  var state = { plane: planes[0], view: 'volume', sel: null };

  function q(name) { return root.querySelector('[data-map="' + name + '"]'); }

  function message(text) {
    var box = q('empty');
    if (box) { box.textContent = text; box.hidden = false; }
    var body = q('body');
    if (body) body.hidden = true;
  }

  /* ---------- loading ---------- */

  function load() {
    if (loading) return;
    // Already drawn: repaint rather than refetch. A pane being reopened is
    // not a reason to walk every report head again, and the aggregate is
    // cached server-side for a minute anyway.
    if (loaded && map) { frame(false); paint(); return; }
    loading = true;
    fetch(PLACEMENT_URL + '/' + encodeURIComponent(meta.slug), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        loading = false;
        if (!payload || payload.published === false || !payload.areas) {
          message(payload && payload.reason ? payload.reason
            : 'This deployment does not publish this map.');
          return;
        }
        if (!Object.keys(payload.areas).length) {
          /* TWO DIFFERENT EMPTINESSES AND THE READER IS OWED THE RIGHT ONE.
             Everything suppressed is not the same as nothing filed: the
             first means reports came in and every area is under the
             threshold, which is a working map of a thin archive. Saying
             "no report has a location" there would be false. */
          var anySuppressed = payload.suppressed && payload.suppressed.areas
            && payload.suppressed.areas.length;
          message(anySuppressed
            ? 'Every area is under this map’s threshold of '
              + payload.threshold + ', so none is shaded. The reports are counted; '
              + 'what is withheld is which places they came from.'
            : 'Nothing counted has a location on it yet. A map appears once a '
              + 'logbook asks where, and reports answering it have been published.');
          return;
        }
        DATA = payload;
        SUPPRESSED = new Set((payload.suppressed && payload.suppressed.areas) || []);
        if (DATA.views && DATA.views.length && DATA.views.indexOf(state.view) === -1) {
          state.view = DATA.views[0];
        }
        applyQuery();
        ready();
      })
      .catch(function () {
        loading = false;
        message('The map could not be loaded.');
      });
  }

  /* PREFILTERING FROM A LINK. `?map=<slug>` says which map the rest apply
     to, which is what makes this unambiguous with several maps on a page —
     without it, `?area=US-AZ` on the board would mean three different
     things depending on which map somebody had in mind.

     Only the two switches a reader already has are accepted, and `area` is
     a selection rather than a filter. THE THRESHOLD IS NOT HERE AND MUST
     NOT BE: it is the operator's, and a query parameter that lowered it
     would hand every reader the one control the mechanism exists to
     withhold. */
  function applyQuery() {
    var qs = new URLSearchParams(window.location.search);
    if (qs.get('map') !== meta.slug) return;
    var plane = qs.get('plane');
    if (plane && planes.indexOf(plane) >= 0) state.plane = plane;
    var view = qs.get('view');
    if (view && (DATA.views || []).indexOf(view) >= 0) state.view = view;
    var area = qs.get('area');
    // Only an area this map actually shades. A suppressed or unknown code
    // is ignored rather than selected: selecting one would draw a readout
    // for a place whose count was deliberately not sent.
    if (area && DATA.areas[area]) {
      state.sel = area;
      if (isUS(area) !== (state.plane === 'us') && planes.indexOf(isUS(area) ? 'us' : 'world') >= 0) {
        state.plane = isUS(area) ? 'us' : 'world';
      }
    }
  }

  function ready() {
    var box = q('empty');
    if (box) box.hidden = true;
    var body = q('body');
    if (body) body.hidden = false;

    if (DATA.title) {
      var t = q('title');
      if (t) { t.textContent = DATA.title; t.hidden = false; }
    }
    if (DATA.blurb) {
      var b = q('blurb');
      if (b) { b.textContent = DATA.blurb; b.hidden = false; }
    }

    if (map) { frame(false); paint(); return; }
    loadShared().then(function () {
      build();
      loaded = true;
    }).catch(function () {
      message('The map outlines could not be loaded.');
    });
  }

  function build() {
    map = L.map(q('canvas'), {
      crs: L.CRS.Simple,
      attributionControl: false,
      zoomSnap: 0,
      // A map that eats the page's scroll is a map people fight on a
      // laptop. Drag, the +/- control and a two-finger pinch still zoom.
      scrollWheelZoom: false,
      maxZoom: 7,
      maxBoundsViscosity: 0.9,
    });
    /* A MAP WITH NO VIEW HAS NO LAYERS. Leaflet queues every addLayer
       behind whenReady, and a map is not ready until it has a centre and a
       zoom — without this the layers sit in the queue with no element and
       the shading paints onto nothing. */
    map.setView([0, 0], 0);
    map.on('zoomend', sizeDots);

    groups = { us: L.layerGroup(), world: L.layerGroup() };
    groups[state.plane].addTo(map);
    layers = { us: new Map(), world: new Map() };
    buildPlane('us');
    buildPlane('world');
    buildTiles();
    wire();
    frame(false);
    paint();
  }

  function buildPlane(plane) {
    var geo = GEO[plane];
    Object.keys(geo.areas).forEach(function (code) {
      var a = geo.areas[code];
      var poly = L.polygon(a.polys.map(function (p) {
        return p.map(function (r) { return r.map(at); });
      }), { className: 'map-area', fillOpacity: 1, weight: 1, interactive: true });
      poly.addTo(groups[plane]);

      var dot = null;
      if (a.size < 46 && a.at) {
        dot = L.circleMarker(at(a.at),
          { className: 'map-area map-dot', radius: 5, fillOpacity: 1, weight: 1.5 });
        dot.addTo(groups[plane]);
      }
      layers[plane].set(code, { poly: poly, dot: dot, size: a.size, name: a.name });
      [poly, dot].forEach(function (l) {
        if (!l) return;
        l.on('mouseover', function () { select(code); });
        l.on('click', function () { select(code); });
      });
    });
  }

  /* ONE TOOLTIP FOR THE WHOLE PANEL, moved to whichever tile is being
     pointed at. One per tile would be seven elements waiting to be shown,
     and the panel is addressed by data-map rather than by id because a page
     can hold several maps — so this is found within THIS map's node and
     cannot reach another's. */
  function tipEl() {
    var wrap = q('tiles-wrap');
    if (!wrap) return null;
    var el = wrap.querySelector('.map-tile-tip');
    if (!el) {
      el = mk('div', 'map-tile-tip');
      el.setAttribute('role', 'status');
      el.hidden = true;
      wrap.appendChild(el);
    }
    return el;
  }

  function showTip(btn) {
    var el = tipEl();
    if (!el) return;
    el.textContent = btn.getAttribute('data-tip') || '';
    el.hidden = false;
    /* Positioned against the panel rather than the page, so it travels with
       the map if the page scrolls under it. Clamped to the panel's width:
       the first and last tile in a row would otherwise hang off the side. */
    var wrap = el.offsetParent || el.parentNode;
    var wb = wrap.getBoundingClientRect();
    var bb = btn.getBoundingClientRect();
    var left = (bb.left - wb.left) + (bb.width / 2) - (el.offsetWidth / 2);
    el.style.left = Math.max(2, Math.min(left, wb.width - el.offsetWidth - 2)) + 'px';
    el.style.top = (bb.top - wb.top - el.offsetHeight - 6) + 'px';
  }

  function hideTip() {
    var el = tipEl();
    if (el) el.hidden = true;
  }

  /* Alaska, Hawaii and the territories, as tiles rather than insets. Plain
     inline SVG: a tile is fixed, its shape fills it, and nothing about it
     needs to pan or zoom. */
  function buildTiles() {
    var host = q('tiles');
    if (!host) return;
    var NS = 'http://www.w3.org/2000/svg';
    (GEO.tiles || []).forEach(function (t) {
      var btn = mk('button', 'map-tile');
      btn.type = 'button';
      btn.setAttribute('data-code', t.code);

      var wrap = mk('span', 'shape');
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', t.vb.join(' '));
      svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', t.d);
      path.classList.add('map-area');
      svg.appendChild(path);
      wrap.appendChild(svg);

      var nm = mk('span', 'nm', t.short || t.usps);
      var ct = mk('span', 'ct');
      btn.appendChild(wrap);
      btn.appendChild(nm);
      btn.appendChild(ct);
      /* THE SAME TOOLTIP THE MAP'S OWN AREAS GET. A tile used to carry the
         text in a `title` attribute, which is not the same thing at all: it
         waits a second on a desktop, it is drawn by the browser rather than
         by this page, and ON A PHONE IT NEVER APPEARS — so the territories
         were the one part of the map that said nothing when touched. */
      btn.addEventListener('mouseover', function () { select(t.code); showTip(btn); });
      btn.addEventListener('mouseout', hideTip);
      btn.addEventListener('focus', function () { select(t.code); showTip(btn); });
      btn.addEventListener('blur', hideTip);
      btn.addEventListener('click', function () { select(t.code); showTip(btn); });
      host.appendChild(btn);
      tiles.set(t.code, { btn: btn, path: path, ct: ct, name: t.name });
    });
  }

  /* Which specks need a marker depends on how far out you are, so it is
     recomputed on every zoom rather than decided once. Two conditions, and
     the second matters as much as the first: a dot exists so an area WITH
     REPORTS is never too small to tap, not as a marker for every speck —
     drawing all of them puts a scatter of grey circles across the oceans
     that reads as data and is not. */
  function sizeDots() {
    if (!map || !DATA) return;
    var scale = Math.pow(2, map.getZoom());
    layers[state.plane].forEach(function (entry, code) {
      if (!entry.dot) return;
      var el = entry.dot.getElement();
      if (!el) return;
      var has = DATA.areas[code] || SUPPRESSED.has(code);
      el.classList.toggle('map-dot-off', !(has && entry.size * scale < TINY_PX));
    });
  }

  /* MEASURE AND FIT WITH THE LIMITS OFF, THEN PUT THEM BACK. This order is
     load-bearing: `maxBounds` applies to every setView, fitBounds included,
     so a limit left over from the other plane drags the fit well off
     target. And `getBoundsZoom` clamps its answer to the CURRENT minZoom,
     which for CRS.Simple defaults to 0 — measuring before lowering the
     floor just returns the floor. */
  function frame(animate) {
    if (!map) return;
    map.invalidateSize({ animate: false });
    map.setMaxBounds(null);
    map.setMinZoom(-20);
    var full = boundsOf(GEO[state.plane].frame);
    map.setMinZoom(map.getBoundsZoom(full, false, [8, 8]) - 0.2);
    function cap() { map.setMaxBounds(full.pad(0.12)); }
    if (animate) {
      // Re-applying the cap mid-flight calls panInsideBounds and cancels
      // the animation, so it goes back on when the camera lands.
      map.once('moveend', cap);
      map.flyToBounds(full, { padding: [8, 8], duration: 0.8 });
    } else {
      map.fitBounds(full, { padding: [8, 8], animate: false });
      cap();
    }
    sizeDots();
  }

  /* ---------- the numbers ----------
     The sealed answer is one hierarchical string, so telling a state from
     a country is prefix work and nothing else. */
  function rowsFor(plane) {
    var out = [];
    Object.keys(DATA.areas).forEach(function (code) {
      if ((plane === 'us') !== isUS(code)) return;
      var d = DATA.areas[code];
      out.push({
        code: code, n: d.n, assessed: d.assessed || 0,
        pos: d.pos || 0, neg: d.neg || 0, neu: d.neu || 0,
        sev: d.sev || {}, name: nameOf(code),
      });
    });
    return out;
  }

  /* ONE WORD FOR WHAT IS BEING COUNTED, and the server chooses it. A map
     fed by a list counts entries, and calling an entry a report is the one
     thing `an entry is not a report` exists to stop. */
  /* READ WHEN IT IS NEEDED, NOT WHEN THIS LINE IS REACHED. It was `var
     UNIT = DATA.unit || …`, which runs while DATA is still null — one map
     per page hid it, because by then something had set DATA; two maps on
     one page threw "Cannot read properties of null" and drew neither. */
  var FALLBACK_UNIT = { one: 'published report', many: 'published reports' };
  function unit() { return (DATA && DATA.unit) || FALLBACK_UNIT; }
  function units(n) { var u = unit(); return n + ' ' + (n === 1 ? u.one : u.many); }

  function valueOf(r) {
    if (state.view === 'volume') return r.n;
    /* DIVIDED BY WHAT WAS ASSESSED, not by everything in the area. Only
       rows from the outcome logbook can carry a stance; dividing by `n`
       let every other row drag the colour toward neutral, which was wrong
       on any map fed by more than the outcome logbook and is impossible
       to miss once a list — whose entries can never carry a stance — is
       one of them. An area with nothing assessed has no outcome, and
       `null` keeps it off the scale rather than putting it at zero, which
       is "evenly split" and a different claim. */
    if (state.view === 'outcome') {
      var d = r.assessed || 0;
      return d ? (r.neg - r.pos) / d : null;
    }
    var t = 0;
    SEVS.forEach(function (s) { t += (r.sev[s] || 0) * SEV_W[s]; });
    return t / r.n;
  }

  /* ONE SCALE OVER EVERYTHING on a plane. Outcome is anchored at zero and
     symmetric about it — deliberately not quantiled, because a quantile
     moves the neutral point with the data and two readings of the same map
     stop being comparable. Volume and severity are square-rooted, so one
     very large area does not push everything else into the lightest step. */
  function binner(shown) {
    if (state.view === 'outcome') {
      return function (v) {
        /* NULL IS "NOTHING WAS ASSESSED HERE" AND IT IS NOT ZERO. Without
           this line `null <= 0.12` is true — null coerces to 0 — so an
           area where nobody answered the outcome question was shaded as
           evenly split, which is a claim about the answers rather than
           the absence of them. 0 is the unshaded step the painters
           already use for an area with no row at all. */
        if (v === null || v === undefined || !isFinite(v)) return 0;
        return v <= -0.5 ? 1 : v < -0.12 ? 2 : v <= 0.12 ? 3 : v < 0.5 ? 4 : 5;
      };
    }
    var vals = shown.map(valueOf).filter(isFinite).sort(function (a, b) { return a - b; });
    if (!vals.length) return function () { return 1; };
    var lo = Math.sqrt(vals[0]), hi = Math.sqrt(vals[vals.length - 1]);
    return function (v) {
      if (hi === lo) return STEPS;
      return Math.min(STEPS, Math.max(1, Math.ceil(((Math.sqrt(v) - lo) / (hi - lo)) * STEPS) || 1));
    };
  }

  /* ---------- painting ---------- */
  function paint() {
    if (!DATA || !map) return;
    var k = DATA.threshold || 1;
    var all = rowsFor(state.plane);
    var shown = all.filter(function (r) { return r.n >= k; });
    var step = binner(shown);
    var byCode = {};
    all.forEach(function (r) { byCode[r.code] = r; });

    var stage = q('stage');
    if (stage) stage.setAttribute('data-view', state.view);

    layers[state.plane].forEach(function (entry, code) {
      var r = byCode[code];
      var below = SUPPRESSED.has(code);
      var s = r ? step(valueOf(r)) : 0;
      var tip = tipFor(entry.name, r, below, k);
      [entry.poly, entry.dot].forEach(function (l) {
        if (!l) return;
        var el = l.getElement();
        if (!el) return;
        /* NEVER setAttribute('class', ...) on a Leaflet path. Leaflet puts
           leaflet-interactive on it and that class is what makes the shape
           hoverable and clickable at all; writing the whole attribute takes
           it off and the map goes from filterable to decorative with
           nothing in the console. classList only. */
        for (var i = 1; i <= STEPS; i++) el.classList.toggle('map-s' + i, i === s);
        el.classList.toggle('map-below', Boolean(below));
        el.classList.toggle('map-sel', code === state.sel);
        /* THE SELECTED OUTLINE HAS TO BE THE ONE ON TOP. An SVG path is
           drawn in document order and its stroke straddles the edge, so
           every neighbour drawn after it painted over the inner half of
           the selected area's thicker outline: it came out heavy on some
           edges, missing on others, and ragged where three states meet.
           Nothing is wrong with the shape — it was simply underneath. */
        if (code === state.sel && l.bringToFront) l.bringToFront();
        l.bindTooltip(tip, { sticky: true, direction: 'top' });
      });
    });
    sizeDots();

    tiles.forEach(function (t, code) {
      var r = byCode[code];
      var below = SUPPRESSED.has(code);
      var s = r ? step(valueOf(r)) : 0;
      for (var i = 1; i <= STEPS; i++) t.path.classList.toggle('map-s' + i, i === s);
      t.path.classList.toggle('map-below', below);
      t.btn.classList.toggle('sel', code === state.sel);
      // '<3' rather than a number: honest about the range, silent about
      // the value, which is the threshold doing its job.
      t.ct.textContent = r ? String(r.n) : (below ? '<' + k : '—');
      t.ct.classList.toggle('none', !r);
      /* The text lives on the tile and the tooltip reads it from there, so
         a tile whose count changed while its tooltip is open says the new
         number rather than the one it opened with. */
      t.btn.setAttribute('data-tip', tipFor(t.name, r, below, k));
      t.btn.setAttribute('aria-label', tipFor(t.name, r, below, k));
      var tip = q('tiles-wrap') && q('tiles-wrap').querySelector('.map-tile-tip');
      if (tip && !tip.hidden && code === state.sel) tip.textContent = t.btn.getAttribute('data-tip');
    });
    var tw = q('tiles-wrap');
    if (tw) tw.hidden = state.plane !== 'us';

    drawLegend();
    drawReadout(state.sel, byCode[state.sel], k);
    drawFigures(all, shown, k);
    drawTable(all, shown, k);
  }

  function tipFor(name, r, below, k) {
    if (!r) return name + ' — nothing counted';
    if (below) return name + ' — under the threshold';
    return name + ' — ' + units(r.n);
  }

  function select(code) { state.sel = code; paint(); }

  var ENDS = {
    volume: ['fewest', '', 'most'],
    severity: ['notes', '', 'systemic'],
    outcome: ['', 'evenly split', ''],
  };
  function drawLegend() {
    var e = ENDS[state.view];
    var lo = e[0], hi = e[2];
    if (state.view === 'outcome' && DATA.outcome_labels) {
      lo = DATA.outcome_labels.positive || 'one way';
      hi = DATA.outcome_labels.negative || 'the other';
    }
    q('ramp-lo').textContent = lo;
    q('ramp-mid').textContent = e[1];
    q('ramp-hi').textContent = hi;
  }

  function drawReadout(code, r, k) {
    var box = q('readout');
    box.replaceChildren();
    if (!r && code && SUPPRESSED.has(code)) {
      box.appendChild(mk('h3', null, nameOf(code)));
      box.appendChild(mk('div', 'map-code', code));
      box.appendChild(mk('div', 'map-warn', 'Fewer than ' + k + ' ' + unit().many + ', '
        + 'so this area is not shaded and its exact number is not published. '
        + 'They are counted in the totals.'));
      box.appendChild(mk('p', 'map-note', 'A single one in a thinly covered '
        + 'place can identify the person who filed it. The threshold is the '
        + 'operator’s, and it is applied before the page is sent rather '
        + 'than by the page.'));
      return;
    }
    if (!r) {
      box.appendChild(mk('h3', null, 'An area'));
      box.appendChild(mk('p', 'text-size-small text-color-muted',
        state.plane === 'us'
          ? 'Point at a state to see what is behind its colour.'
          : 'Point at a country to see what is behind its colour.'));
      return;
    }
    box.appendChild(mk('h3', null, r.name));
    box.appendChild(mk('div', 'map-code', r.code));
    var big = mk('div', 'map-big', String(r.n));
    big.appendChild(mk('small', null, r.n === 1 ? unit().one : unit().many));
    box.appendChild(big);

    var bars = mk('div', 'map-bars');
    /* THE BARS ARE A PROPORTION OF WHAT WAS ASSESSED, for the reason the
       colour is: rows that could never carry a stance are not part of the
       question. On the severity view every counted row is in scope, so
       that one is still out of `n`. */
    var total = (state.view === 'severity' ? r.n : r.assessed) || 1;
    function add(cls, label, v) {
      var row = mk('div', 'map-bar ' + cls);
      row.appendChild(mk('u', null, label));
      var track = mk('div');
      var fill = mk('i');
      fill.style.width = Math.round((v / total) * 100) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(mk('b', null, String(v)));
      bars.appendChild(row);
    }
    if (state.view === 'severity') {
      SEVS.forEach(function (s) { add('', s, r.sev[s] || 0); });
    } else {
      var lab = DATA.outcome_labels || {};
      add('pos', lab.positive || 'no problem', r.pos);
      add('neu', lab.neutral || 'neither', r.neu);
      add('neg', lab.negative || 'a problem', r.neg);
    }
    box.appendChild(bars);

    /* THE LINK THAT MAKES A CLICK WORTH SOMETHING. The aggregate hands over
       the one answer key every logbook feeding this map seals its place
       under, or null where they disagree — a filter on one key would
       silently drop every report from the logbook that used another, so
       where there is no single key there is no link rather than a wrong
       one. src/mapData.js, filterKeyFor. */
    if (DATA.filter_key) {
      var a = mk('a', 'linkish',
        'Show these ' + r.n + ' report' + (r.n === 1 ? '' : 's') + ' on the board');
      a.href = '/board?a.' + encodeURIComponent(DATA.filter_key)
        + '=' + encodeURIComponent(r.code);
      a.setAttribute('data-board-filter', '1');
      box.appendChild(a);
    }

    box.appendChild(mk('p', 'map-note', state.view === 'severity'
      ? 'Severity is a moderator’s judgement, not the reporter’s answer. '
        + 'It is its own view for that reason — one colour carrying both would '
        + 'leave nobody able to tell which half was editorial.'
      : 'These come from one question the operator marked as the map’s outcome'
        + (DATA.outcome_question ? ': “' + DATA.outcome_question + '”' : '')
        + '. Nothing about it is built in.'));
  }

  function drawFigures(all, shown, k) {
    var box = q('figures');
    box.replaceChildren();
    function sum(rs) {
      return rs.reduce(function (a, r) { return a + r.n; }, 0);
    }
    var sup = DATA.suppressed || { areas: [], reports: null };
    var supHere = sup.areas.filter(function (c) {
      return (state.plane === 'us') === isUS(c);
    });
    var other = rowsFor(state.plane === 'us' ? 'world' : 'us');
    var unit = state.plane === 'us' ? 'states and territories' : 'countries';

    var dl = mk('dl');
    function row(key, val) {
      dl.appendChild(mk('dt', null, key));
      dl.appendChild(mk('dd', null, String(val)));
    }
    function rule() { dl.appendChild(mk('hr')); }

    row('Shaded on this map', sum(shown));
    row(state.plane === 'us' ? 'States and territories shaded' : 'Countries shaded', shown.length);
    rule();
    /* With ONE suppressed area its subtotal is its count — the number the
       threshold just withheld — so the server sends null and this says how
       many areas and not how many reports. */
    row('Under the threshold', (sup.reports === null || sup.reports === undefined)
      ? supHere.length + ' ' + unit
      : sup.reports + ' in ' + sup.areas.length + ' ' + unit);
    row(state.plane === 'us' ? 'From outside the US' : 'From the United States',
      sum(other) + ' in ' + other.length);
    rule();
    /* THE DENOMINATOR IS VISIBLE — src/stats.js's rule, applied to
       geography. A map showing part of the archive and saying nothing is
       lying about its own coverage. */
    var un = DATA.unplaced || {};
    row('Not on any map — no location asked', un.no_question || 0);
    row('Not on any map — country only', un.country_only || 0);
    rule();
    row('Published reports, all told',
      sum(all) + sum(other) + (sup.reports || 0)
      + (un.no_question || 0) + (un.country_only || 0));

    box.appendChild(mk('h3', null, 'Figures'));
    box.appendChild(dl);
    box.appendChild(mk('p', 'map-note', 'Shaded once an area has '
      + k + ' report' + (k === 1 ? '' : 's') + ' or more.'));
    box.appendChild(mk('p', 'map-note', DATA.note
      || 'These are reviewed first-hand accounts from people who chose to file '
      + 'them. Not a survey and not a sample. A dark area may mean more problems, '
      + 'or more people who knew the form existed.'));
  }

  function drawTable(all, shown, k) {
    var step = binner(shown);
    var t = mk('table');
    var head = mk('tr');
    var lab = DATA.outcome_labels || {};
    [['Area', ''], ['Code', ''], ['Reports', 'n'],
      [lab.positive || 'No problem', 'n'], [lab.neutral || 'Neither', 'n'],
      [lab.negative || 'A problem', 'n'], ['Mean severity', 'n'], ['Step', 'n'],
    ].forEach(function (c) { head.appendChild(mk('th', c[1], c[0])); });
    var thead = mk('thead');
    thead.appendChild(head);
    var tb = mk('tbody');
    all.slice().sort(function (a, b) { return b.n - a.n; }).forEach(function (r) {
      var tr = mk('tr');
      var sv = 0;
      SEVS.forEach(function (s) { sv += (r.sev[s] || 0) * SEV_W[s]; });
      [[r.name, ''], [r.code, ''], [r.n, 'n'], [r.pos, 'n'], [r.neu, 'n'], [r.neg, 'n'],
        [(sv / r.n).toFixed(2), 'n'], [step(valueOf(r)), 'n'],
      ].forEach(function (c) { tr.appendChild(mk('td', c[1], String(c[0]))); });
      tb.appendChild(tr);
    });
    /* The suppressed areas get ONE row between them, not a row each with
       the counts blanked out — a row each would still be a list of which
       places hold between one and k-1 reports, ordered and countable. */
    var sup = DATA.suppressed || { areas: [], reports: null };
    var supHere = sup.areas.filter(function (c) { return (state.plane === 'us') === isUS(c); });
    if (supHere.length) {
      var tr2 = mk('tr', 'below');
      tr2.appendChild(mk('td', null, supHere.length + ' area'
        + (supHere.length === 1 ? '' : 's') + ' under the threshold'));
      tr2.appendChild(mk('td', null, '—'));
      tr2.appendChild(mk('td', 'n', sup.reports === null || sup.reports === undefined
        ? '<' + k : String(sup.reports)));
      for (var c = 0; c < 5; c++) tr2.appendChild(mk('td', 'n', '—'));
      tb.appendChild(tr2);
    }
    t.appendChild(thead);
    t.appendChild(tb);
    q('table').replaceChildren(t);
  }

  /* ---------- controls ----------
     Only the two the reader gets: what the colour shows, and which map.
     Everything else is the operator's and arrives in the payload. */
  function wire() {
    var views = q('views');
    (DATA.views || ['volume']).forEach(function (v) {
      var b = mk('button', 'button is-secondary is-small',
        { volume: 'Volume', outcome: 'Outcome', severity: 'Severity' }[v] || v);
      b.type = 'button';
      b.setAttribute('data-v', v);
      b.setAttribute('aria-pressed', String(v === state.view));
      views.appendChild(b);
    });
    views.hidden = views.children.length < 2;
    views.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.view = b.getAttribute('data-v');
      Array.prototype.forEach.call(views.querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      paint();
    });

    /* THE PLANE SWITCH IS HIDDEN WHEN THERE IS ONE PLANE. An operator who
       offered only the world map gets no "United States / Elsewhere"
       toggle, because one of its two buttons would show a plane this map
       does not have. */
    var planeBox = q('planes');
    Array.prototype.forEach.call(planeBox.querySelectorAll('button'), function (b) {
      var p = b.getAttribute('data-v');
      b.hidden = planes.indexOf(p) < 0;
      b.setAttribute('aria-pressed', String(p === state.plane));
    });
    planeBox.hidden = planes.length < 2;

    planeBox.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.plane = b.getAttribute('data-v');
      state.sel = null;
      Array.prototype.forEach.call(e.currentTarget.querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      map.removeLayer(groups[state.plane === 'us' ? 'world' : 'us']);
      groups[state.plane].addTo(map);
      frame(false);
      paint();
    });
  }

  return {
    slug: meta.slug,
    load: load,
    // One resize listener for the page calls this on every live map, rather
    // than each map adding its own to `window` — several maps meant several
    // listeners, and a slot emptied by an operator would have left one
    // behind holding a detached map alive.
    reframe: function () { if (map) frame(false); },
  };
}

/* ================= mounting =================
 *
 * Which maps exist and where they go, fetched once, then one instance per
 * (map, slot) cloned from the page's template.
 */

function placement() {
  if (placementPromise) return placementPromise;
  placementPromise = fetch(PLACEMENT_URL, { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      PLACEMENT = d && d.published ? d : { published: false, maps: [], slots: [] };
      return PLACEMENT;
    })
    .catch(function () {
      PLACEMENT = { published: false, maps: [], slots: [] };
      return PLACEMENT;
    });
  return placementPromise;
}

/** Clone the template into a host and load that map. Idempotent per key. */
function mount(host, m, slotId) {
  const tmpl = byId('map-template');
  if (!tmpl || !host) return null;
  const key = m.slug + '@' + slotId;
  let instance = INSTANCES.get(key);
  if (!instance) {
    const root = tmpl.content.firstElementChild.cloneNode(true);
    host.appendChild(root);
    instance = createInstance(root, m);
    INSTANCES.set(key, instance);
  }
  instance.load();
  return instance;
}

/**
 * ONE MAP AT ITS OWN ADDRESS, `/board/map/<slug>`.
 *
 * A map placed on the front page is still a thing somebody wants to link
 * to — and the admin panel names this address beside every map, so it has
 * to resolve. It opens the board's map tab and draws that map there
 * whatever slot it was put in, which is why this is not the same as a
 * slot: a slot is where a map appears for everybody, an address is where
 * one person was sent.
 *
 * A SLUG NOBODY HAS SAYS SO, rather than showing an empty tab — and says
 * it the same way a map that is simply not published says it, because
 * answering differently for the two would tell an unauthenticated caller
 * which maps an operator has made and not published.
 */
function showMapNamed(slug) {
  placement().then(function (p) {
    const host = byId('map-slot-board-tab');
    const note = byId('map-slot-board-tab-empty');
    const m = (p.maps || []).find(function (x) { return x.slug === slug; });
    if (!m) {
      if (note) {
        note.hidden = false;
        note.textContent = 'There is no map published at this address.';
      }
      return;
    }
    if (note) note.hidden = true;
    mount(host, m, 'board_tab');
  });
}

/** Mount and load every map whose slot is on the screen that just opened. */
function renderMapsFor(pane, sub) {
  var tmpl = byId('map-template');
  if (!tmpl) return;
  placement().then(function (p) {
    (p.slots || []).forEach(function (slot) {
      if (slot.pane !== pane) return;
      // A board slot is on one of the board's tabs. Called without a sub —
      // which nothing does today — every board slot matches.
      if (sub && slot.sub && slot.sub !== sub) return;
      var host = byId(slot.container);
      if (!host) return;

      var here = (p.maps || []).filter(function (m) { return m.slot === slot.id; });
      // The board's own tab says something when an operator has put no map
      // on it, because an empty tab beside Reports and Figures reads as
      // broken. Every other slot is simply absent, which is correct: a
      // front page with no map should look like a front page.
      var note = byId(slot.container + '-empty');
      if (note) {
        note.hidden = here.length > 0;
        if (!here.length) {
          note.textContent = 'No map is published here yet. An administrator makes one '
            + 'under Admin → Maps, and nothing is drawn until they turn it on.';
        }
      }

      here.forEach(function (m) { mount(host, m, slot.id); });
    });
  });
}

/* What the board's map tab calls. Kept under its old name because that is
   what nav.js imports, and because "the map tab" is still a thing even
   though it may now hold several. */
function renderMap() { renderMapsFor('dash', 'map'); }

window.addEventListener('resize', function () {
  INSTANCES.forEach(function (i) { i.reframe(); });
});

/* The house convention, and `npm test` enforces it: a trailing export
   block, not `export function`. The suite parses this to check that every
   import across the frontend names something that is really exported —
   the one thing a bundler would have caught for free, and there is no
   bundler. */
export {
  renderMap, renderMapsFor, showMapNamed,
};
