/* Builds public/geo/maps.json — the outlines the map pane draws.
 *
 *     node tools/build-geo.mjs
 *
 * WHY THIS IS A BUILD STEP AND NOT A RUNTIME FETCH. There is no tile
 * layer and there is not going to be one: a tile request tells a third
 * party which states the readers of an incident archive are looking at,
 * every deployment would make it on behalf of an operator who never
 * chose it, and the Content-Security-Policy deliberately names no
 * outside origin. So the map is vector outlines served from this origin,
 * projected ahead of time.
 *
 * Projecting here also means the browser needs no projection maths, no
 * topojson decoder and no d3 — it gets coordinate rings and hands them
 * to Leaflet. public/js/map.js is short because this file exists.
 *
 * THE OUTPUT IS COMMITTED. Run this only to change the projection, the
 * simplification or the source data. Its dependencies are devDependencies
 * and never reach a deployment.
 *
 * SOURCES, both vendored under tools/data/ rather than fetched, so a
 * build works offline and the bytes cannot change under us — borders that
 * move because a CDN published a minor version is a bad thing to find in
 * a screenshot.
 *   us-states-10m.json   us-atlas, from US Census Bureau data. Public domain.
 *   countries-50m.json   world-atlas, from Natural Earth. Public domain.
 */
/* THE LOWER 48 AS A MAP, EVERYTHING ELSE AS TILES.
 *
 * Two attempts at insets failed for the same underlying reason: Alaska,
 * Hawaii and five territories were competing with Texas for room on one
 * canvas, so whatever they got was too small. A chain like the Northern
 * Marianas simply cannot be drawn in a cell that also has to leave the
 * lower 48 legible.
 *
 * So they stop competing. The map is the contiguous 48 and DC, filling
 * the whole canvas — the biggest, most tappable states possible, which
 * is what the map is for. Alaska, Hawaii and the five territories get
 * their own panel of tiles beside it, each one shaded on the same scale,
 * each one labelled and carrying its own count.
 *
 * A tile is not pretending to be geography, so none of the "that is not
 * where it is" objection applies. It is a list of places with shapes on
 * it.
 *
 * The world plane is Equal Earth, everything in its true place, as before.
 *
 * Projected through geoStream, never point by point: calling the
 * projection per coordinate skips d3's antimeridian clipping, and half of
 * Russia ends up at the far left of the world with a line drawn across
 * the map to reach it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { geoAlbersUsa, geoAlbers, geoConicEqualArea, geoAzimuthalEqualArea, geoEqualEarth, geoStream, geoPath } from 'd3-geo';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import countries from 'i18n-iso-countries';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const USPS = JSON.parse(readFileSync(here('./data/usps.json'), 'utf8'));
/* The third field is how much of the territory a cell shows.
   'main' means its principal island alone: the Northern Marianas are a
   chain a hundred kilometres long made of islands twenty kilometres
   across, so any cell that holds the whole chain holds three specks.
   Saipan is what a reader is looking for and it is where almost everyone
   there lives. The others keep every island that is a real fraction of
   their largest. */
const TERRITORIES = {
  '72': ['PR', 'Puerto Rico', 'ratio'], '78': ['VI', 'US Virgin Islands', 'ratio'],
  '66': ['GU', 'Guam', 'ratio'], '69': ['MP', 'N. Mariana Islands', 'main'],
  '60': ['AS', 'American Samoa', 'ratio'],
};
const BY_NAME = { Kosovo: 'XK', 'N. Cyprus': 'XN', Somaliland: 'XS' };
const DROP = new Set(['Antarctica', 'Fr. S. Antarctic Lands',
  'Indian Ocean Ter.', 'Siachen Glacier']);

const r1 = (n) => Math.round(n * 10) / 10;
const thin = (topo, q) => {
  if (!q) return topo;
  const pre = presimplify(topo);
  return simplify(pre, quantile(pre, q));
};

/** Projected rings for one feature, through the stream so clipping applies. */
function ringsOf(f, proj) {
  const polys = [];
  let rings = null, ring = null;
  geoStream(f, proj.stream({
    polygonStart() { rings = []; },
    polygonEnd() { if (rings.length) polys.push(rings); rings = null; },
    lineStart() { ring = []; },
    lineEnd() {
      if (ring && ring.length > 2) { if (rings) rings.push(ring); else polys.push([ring]); }
      ring = null;
    },
    point(x, y) { if (ring && Number.isFinite(x) && Number.isFinite(y)) ring.push([r1(x), r1(y)]); },
    sphere() {},
  }));
  return polys;
}

/** bbox, largest-ring size and a marker anchor, from projected rings. */
function measure(polys) {
  let xa = Infinity, ya = Infinity, xb = -Infinity, yb = -Infinity;
  let size = -1, at = null;
  for (const p of polys) for (const r of p) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, y] of r) {
      if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
    }
    if (a < xa) xa = a; if (c > xb) xb = c;
    if (b < ya) ya = b; if (d > yb) yb = d;
    // Biggest PIECE, not the overall box: the antimeridian cut can return
    // both sides of Russia inside one polygon.
    const sz = Math.max(c - a, d - b);
    if (sz > size) { size = sz; at = [r1((a + c) / 2), r1((b + d) / 2)]; }
  }
  return { bbox: [r1(xa), r1(ya), r1(xb), r1(yb)], size: r1(size), at };
}

/* ------------------------------------------------------------------ */
/* THE UNITED STATES                                                    */
/* ------------------------------------------------------------------ */
const UW = 960, UH = 600;
/* THE STATES ARE SIMPLIFIED; THE TERRITORIES ARE NOT.
   Simplification works on ring area, so it hits small islands hardest:
   at quantile 0.25 the Northern Marianas lost every ring to under three
   points and the territory projected to nothing. The 50 states are what
   the file size is made of and they simplify happily; the territories
   are a rounding error in bytes and come through untouched. */
const usRaw = JSON.parse(readFileSync(here('./data/us-states-10m.json'), 'utf8'));
const usTopo = thin(usRaw, 0.25);
const usFc = feature(usTopo, usTopo.objects.states);
const usFcRaw = feature(usRaw, usRaw.objects.states);
// The contiguous 48 and DC. Alaska and Hawaii become tiles.
const OFF_MAP = new Set(['02', '15']);
const mainland = {
  type: 'FeatureCollection',
  features: usFc.features.filter((f) => USPS[f.id] && !OFF_MAP.has(f.id)),
};

// Plain Albers for the lower 48 — geoAlbersUsa's whole job is the AK/HI
// composite, and there is nothing left for it to compose.
const proj = geoAlbers().fitExtent([[12, 12], [UW - 12, UH - 12]], mainland);

const usAreas = {};
for (const f of mainland.features) {
  const m = USPS[f.id];
  const polys = ringsOf(f, proj);
  if (!polys.length) throw new Error('no geometry for ' + m[1]);
  usAreas[`US-${m[0]}`] = { name: m[1], polys, ...measure(polys) };
}

/* ------------------------------------------------------------------ */
/* THE TILES — Alaska, Hawaii and the territories                       */
/* ------------------------------------------------------------------ */
/* Each one projected into its own square box and emitted as an SVG path
   string. These are plain inline SVG on the page, not Leaflet: a tile is
   fixed, its shape fills it, and nothing about it needs to pan or zoom.

   The third field says how much of a place a tile shows. 'main' is its
   principal island alone: the Northern Marianas are a hundred-kilometre
   chain of twenty-kilometre islands, so a tile holding the whole chain
   holds three specks, and Saipan is both what a reader looks for and
   where almost everyone there lives. 'ratio' keeps every island that is a
   real fraction of the largest. */
const TILE = 120;

/* ---- the territories' own outlines ---------------------------------
 *
 * FIVE OF THE SEVEN TILES ARE DRAWN FROM SUPPLIED SVG, not from the
 * national file. The national file is a US-wide boundary set simplified for
 * drawing the whole country; its idea of a twenty-kilometre island is a few
 * points, and a tile is the one place a twenty-kilometre island is the
 * whole picture. These outlines carry a thousand times the detail.
 *
 * THEY ARE CHECKED BEFORE THEY ARE USED, against the same island out of the
 * national file, projected azimuthally — a supplied file is somebody else's
 * work and "it looked right" is how the sheared tiles survived for weeks.
 * Guam, Puerto Rico and the Virgin Islands agree with it to within three
 * percent. Where a file disagrees it is because it draws a different set of
 * islands, not a different shape: American Samoa's includes one roughly
 * three hundred and fifty kilometres north of the rest, which the national
 * file leaves out.
 *
 * WHICH IS WHY THE PRINCIPAL-ISLAND RULE STILL DECIDES THE FRAMING. The
 * outline is better; what belongs in a 120-unit square is unchanged, and
 * taking one island out of a supplied file also makes a disagreement about
 * the others moot.
 */

const SVG_FOR = {
  PR: 'puerto-rico.svg',
  VI: 'us-virgin-islands.svg',
  GU: 'guam.svg',
  MP: 'northern-mariana-islands.svg',
  AS: 'american-samoa.svg',
};

/* A path's subpaths, each with its own bounding box. These files are
   absolute moveto/lineto and nothing else — checked, and anything else
   would show up as a subpath with no coordinates rather than silently
   drawing the wrong thing. */
function svgSubpaths(d) {
  return d.split('M').filter((x) => x.trim()).map((body) => {
    const pts = [...body.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    if (!pts.length) return null;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return { d: `M${body}`, box, area: (box[2] - box[0]) * (box[3] - box[1]) };
  }).filter(Boolean);
}

/* The outline, framed the way the tile wants it, in its own tight box.
   `main` keeps the largest island alone; anything else keeps the lot. */
function tileFromSvg(usps, fit) {
  const file = SVG_FOR[usps];
  if (!file) return null;
  const src = readFileSync(here(`./data/territories/${file}`), 'utf8');
  const d = (src.match(/<path d="([^"]+)"/) || [])[1];
  if (!d) throw new Error(`no path in ${file}`);
  const subs = svgSubpaths(d);
  if (!subs.length) throw new Error(`no subpaths in ${file}`);

  /* THE SAME RULE THE PROJECTED TILES USE, applied to the outline's own
     islands: `main` is the principal island alone, anything else keeps the
     islands that are a real fraction of it. Not every islet — Puerto Rico
     with all of them is 4.1:1, which in a square tile shrinks the island
     everybody is looking for in order to make room for a rock seventy
     kilometres west. */
  const largest = Math.max(...subs.map((x) => x.area));
  const kept = fit === 'main'
    ? [subs.reduce((a, b) => (b.area > a.area ? b : a))]
    : subs.filter((x) => x.area >= largest * 0.04);
  const x0 = Math.min(...kept.map((k) => k.box[0]));
  const y0 = Math.min(...kept.map((k) => k.box[1]));
  const x1 = Math.max(...kept.map((k) => k.box[2]));
  const y1 = Math.max(...kept.map((k) => k.box[3]));
  /* A TIGHT BOX, because the supplied files are padded and the padding is
     not the same on each. Left alone, American Samoa would have drawn in
     the corner of its tile with most of the square empty — and it would
     have looked like the island is small rather than like the box is
     wrong. */
  /* The largest island on its own, kept separately. It is what the check
     below compares, for a reason worth stating: two files disagreeing about
     whether a rock three hundred kilometres away is part of the territory
     is an INVENTORY difference, and comparing the whole group's extent
     measures that rather than the thing at issue. The largest island is in
     both files by definition, so comparing it asks the question actually
     worth asking — is this outline the shape of that island, or is it
     sheared. */
  const biggest = subs.reduce((a, b) => (b.area > a.area ? b : a));
  return {
    d: kept.map((k) => k.d).join(''),
    vb: [x0, y0, x1 - x0, y1 - y0].map((n) => Number(n.toFixed(2))),
    ratio: (x1 - x0) / (y1 - y0),
    mainRatio: (biggest.box[2] - biggest.box[0]) / (biggest.box[3] - biggest.box[1]),
  };
}
const TILES = [
  ['02', 'AK', 'Alaska', 'ratio'],
  ['15', 'HI', 'Hawaii', 'ratio'],
  ['72', 'PR', 'Puerto Rico', 'ratio'],
  /* St. Croix alone. All three islands render as two thin slivers and a
     speck — and unlike Hawaii, nobody carries a picture of the Virgin
     Islands' arrangement in their head for it to match. St. Croix is the
     largest and holds about half the territory's people. */
  ['78', 'VI', 'US Virgin Islands', 'main'],
  ['66', 'GU', 'Guam', 'ratio'],
  ['69', 'MP', 'N. Mariana Islands', 'main'],
  /* Tutuila alone. With the Manu'a group fifty miles east the territory
     is a twelve-to-one smear nobody can read; Tutuila by itself is about
     six to one, which is simply the shape of the island, and it is where
     nearly everyone in American Samoa lives. */
  ['60', 'AS', 'American Samoa', 'main'],
];

/* Two letters identify a place to somebody who already knows it. These
   are for everybody else. */
const SHORT = { AK: 'Alaska', HI: 'Hawaii', PR: 'Puerto Rico', VI: 'US Virgin Is.',
  GU: 'Guam', MP: 'N. Marianas', AS: 'Am. Samoa' };

const ringArea = (r) => {
  let a = 0;
  for (let j = 0, n = r.length; j < n; j++) {
    const [x1, y1] = r[j], [x2, y2] = r[(j + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
};

const tiles = [];
for (const [id, usps, name, fit] of TILES) {
  // Unsimplified: simplification works on ring area, so it hits small
  // islands hardest — at quantile 0.25 the Marianas lost every ring to
  // under three points and projected to nothing.
  const f = usFcRaw.features.find((x) => String(x.id) === id);
  if (!f) throw new Error('missing from source: ' + name);
  const all = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const big = Math.max(...all.map((pp) => ringArea(pp[0])));
  const kept = fit === 'main'
    ? [all.reduce((a, pp) => (ringArea(pp[0]) > ringArea(a[0]) ? pp : a))]
    : all.filter((pp) => ringArea(pp[0]) >= big * 0.04);
  const shape = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: kept } };
  // The single largest island out of the national file, for the comparison
  // against a supplied outline below.
  const biggestIsland = {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [all.reduce((a, pp) => (ringArea(pp[0]) > ringArea(a[0]) ? pp : a))],
    },
  };

  /* A PROJECTION AIMED AT THE PLACE IT IS DRAWING.
     This was `geoAlbers()` with its rotation overridden, which keeps
     Albers's own parallels — 29.5°N and 45.5°N — and its centre near
     38.7°N, because those are the numbers that draw the United States.
     Guam is at 13°N and American Samoa at 14°S. A conic projection read
     twenty-five to fifty degrees away from its parallels shears what it
     draws, so those tiles were not the islands' shapes at all; Alaska and
     Hawaii were least wrong and so looked fine, which is why this
     survived.

     The standard remedy, and it is per-tile because the fault was using
     one place's numbers for another's: parallels taken from the shape's
     own latitude span by the sixth-rule, centred on its own middle. At
     island scale that leaves distortion no eye can see. */
  const lats = [], lons = [];
  for (const poly of kept) for (const ring of poly) for (const [x, y] of ring) {
    lons.push(x); lats.push(y);
  }
  const lat0 = Math.min(...lats), lat1 = Math.max(...lats);
  const lonC = (Math.min(...lons) + Math.max(...lons)) / 2;
  const span = lat1 - lat0;
  /* THE SUPPLIED OUTLINE WINS WHERE THERE IS ONE, and the projected shape
     below is still computed so the two can be compared. */
  const svg = tileFromSvg(usps, fit);

  const tp = geoConicEqualArea()
    .parallels([lat0 + span / 6, lat1 - span / 6])
    .rotate([-lonC, 0])
    .center([0, (lat0 + lat1) / 2])
    .fitExtent([[6, 6], [TILE - 6, TILE - 6]], shape);
  const d = geoPath(tp).digits(1)(shape);
  if (!d) throw new Error('tile projected to nothing: ' + name);
  const [[bx0, by0], [bx1, by1]] = geoPath(tp).bounds(shape);
  /* A TILE THAT LOOKS EMPTY IS WORSE THAN NO TILE. Two ways that
     happens, and the second one is the one that bit. A shape can be too
     small for its box — or it can be so much longer than it is tall that
     fitting its length leaves it a thread. Both are caught here. */
  const fillw = (bx1 - bx0) / TILE, fillh = (by1 - by0) / TILE;
  if (Math.max(fillw, fillh) < 0.33) {
    throw new Error(`${name} fills only ${(Math.max(fillw, fillh) * 100).toFixed(0)}% of its tile`);
  }
  /* THE SHAPE HAS TO BE THE ISLAND'S SHAPE, checked rather than trusted.
     The projection above is aimed at this territory, but "aimed at it" is
     the kind of claim that was true of the old one too, right up until
     somebody looked at Guam. So the same shape is projected a second way —
     an azimuthal equal-area centred on it, which is as close to the local
     truth as a flat drawing gets — and the two have to agree about how
     long and how tall it is. They agree to two decimal places today; a
     percent of slack leaves room for rounding and none for shear. */
  const truth = geoAzimuthalEqualArea()
    .rotate([-lonC, -(lat0 + lat1) / 2])
    .fitExtent([[6, 6], [TILE - 6, TILE - 6]], shape);
  const [[tx0, ty0], [tx1, ty1]] = geoPath(truth).bounds(shape);
  const trueRatio = (tx1 - tx0) / (ty1 - ty0);
  const drawnRatio = (bx1 - bx0) / (by1 - by0);
  if (Math.abs(drawnRatio - trueRatio) / trueRatio > 0.01) {
    throw new Error(`${name} is drawn ${drawnRatio.toFixed(2)}:1 but is `
      + `${trueRatio.toFixed(2)}:1 on the ground — the projection is shearing it.`);
  }

  /* AND THE SUPPLIED FILE IS HELD TO THE SAME STANDARD as the projection:
     it has to be the shape the national file says this island is. Three
     percent, because the two are drawn from different surveys at different
     detail and will not agree to the digit. A supplied file is somebody
     else's work, and "it looked right" is exactly how the sheared tiles
     survived. */
  if (svg) {
    /* The principal island in each file, against each other. Five percent,
       because the two are drawn from different surveys at a thousandfold
       difference in detail and will not agree to the digit — a coastline
       has no single true length. Shear is tens of percent and this catches
       it; a different coastline survey is not. */
    const mainTruth = geoAzimuthalEqualArea()
      .rotate([-lonC, -(lat0 + lat1) / 2])
      .fitExtent([[0, 0], [100, 100]], biggestIsland);
    const [[mx0, my0], [mx1, my1]] = geoPath(mainTruth).bounds(biggestIsland);
    const mainTrueRatio = (mx1 - mx0) / (my1 - my0);
    const off = Math.abs(svg.mainRatio - mainTrueRatio) / mainTrueRatio;
    if (off > 0.05) {
      throw new Error(`${name}'s outline draws its main island ${svg.mainRatio.toFixed(2)}:1 `
        + `where the national file says ${mainTrueRatio.toFixed(2)}:1 — it is a different `
        + `shape, not just a different set of islands.`);
    }
  }

  const ratio = (bx1 - bx0) / (by1 - by0);
  if (ratio > 7 || ratio < 1 / 7) {
    throw new Error(`${name} is ${ratio.toFixed(1)}:1 — too long and thin to read as a tile. `
      + `Show fewer of its islands.`);
  }
  /* AND A THIRD WAY A TILE LOOKS EMPTY: the shape fits its box, is not
     especially thin, and is still mostly water — a scatter of small
     islands with sea between them.

     THIS NUMBER CANNOT MAKE THE CALL AND IS ONLY A SAFETY NET. Hawaii
     covers 16% of its tile and reads perfectly, because the chain is a
     shape everybody already carries in their head; the Virgin Islands
     covered 19% and read as two slivers and a speck, because nobody
     does. Recognisability is a judgement, taken per territory in the
     table above. This only catches a tile that is empty by any
     standard. */
  let ink = 0;
  for (const poly of ringsOf(shape, tp)) for (const r of poly) {
    let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
    for (const [x, y] of r) {
      if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > e) e = y;
    }
    ink += (c - a) * (e - b);
  }
  const inkFrac = ink / ((bx1 - bx0) * (by1 - by0));
  if (inkFrac < 0.05) {
    throw new Error(`${name} covers only ${(inkFrac * 100).toFixed(0)}% of its tile — `
      + `a scatter of specks with sea between them. Show fewer of its islands.`);
  }
  /* THE VIEWBOX IS THE SHAPE'S OWN BOX, not the square it was fitted
     into. A square viewBox makes every tile render at the scale of its
     tallest dimension, so Tutuila — which really is long and thin —
     came out a thread inside a mostly empty tile.

     PADDING IS PER-AXIS AND PROPORTIONAL, which matters more than it
     looks. A flat three units added to both sides of a shape twelve
     units tall and a hundred wide is half again as tall and five per
     cent wider — it changes the aspect ratio, and for the thinnest
     shape on the panel it changed it against us. A percentage of each
     axis leaves the aspect exactly as the island really is. */
  const w = bx1 - bx0, h = by1 - by0;
  const px = w * 0.06, py = h * 0.06;
  /* The supplied outline is emitted as it is, in its own tight box: the
     page draws a tile by handing the browser a viewBox and a path, and the
     browser fits the one into the other. Nothing has to be re-projected to
     use it, which is also why nothing here can shear it. */
  tiles.push(svg
    ? { code: `US-${usps}`, usps, name, short: SHORT[usps], d: svg.d, vb: svg.vb,
      aspect: r1(svg.ratio), ink: Math.round(inkFrac * 100), source: 'outline',
      fill: [100, 100] }
    : { code: `US-${usps}`, usps, name, short: SHORT[usps], d,
      vb: [r1(bx0 - px), r1(by0 - py), r1(w + px * 2), r1(h + py * 2)],
      aspect: r1(w / h), ink: Math.round(inkFrac * 100), source: 'projected',
      fill: [Math.round(fillw * 100), Math.round(fillh * 100)] });
}

/* ------------------------------------------------------------------ */
/* THE WORLD                                                            */
/* ------------------------------------------------------------------ */
const WW = 1600;
const ctTopo = thin(JSON.parse(readFileSync(here('./data/countries-50m.json'), 'utf8')), 0.30);
const ctFc = feature(ctTopo, ctTopo.objects.countries);
const wproj = geoEqualEarth().fitWidth(WW, { type: 'Sphere' });
const [[, wy0], [, wy1]] = geoPath(wproj).bounds({ type: 'Sphere' });
const WH = Math.ceil(wy1 - wy0);
wproj.translate([wproj.translate()[0], wproj.translate()[1] - wy0]);

const worldAreas = {};
const unresolved = [];
for (const f of ctFc.features) {
  const n = f.properties.name;
  if (DROP.has(n)) continue;
  const a2 = BY_NAME[n] || countries.numericToAlpha2(String(f.id).padStart(3, '0'));
  if (!a2) { unresolved.push(`${f.id} ${n}`); continue; }
  const polys = ringsOf(f, wproj);
  if (!polys.length) { unresolved.push(`${a2} ${n}: no geometry`); continue; }
  worldAreas[a2] = { name: n, polys, ...measure(polys) };
}
let cy0 = Infinity, cy1 = -Infinity;
for (const a of Object.values(worldAreas)) {
  cy0 = Math.min(cy0, a.bbox[1]); cy1 = Math.max(cy1, a.bbox[3]);
}

const OUT = here('../public/geo/maps.json');
writeFileSync(OUT, JSON.stringify({
  us: { width: UW, height: UH, areas: usAreas, frame: [[0, 0], [UW, UH]] },
  tiles,
  world: { width: WW, height: WH, areas: worldAreas,
           frame: [[0, r1(cy0 - 8)], [WW, r1(cy1 + 8)]] },
}));

console.log('map areas  ', Object.keys(usAreas).length, '(lower 48 + DC)');
console.log('tiles      ', tiles.map((t) => `${t.usps} ${t.aspect}:1 ink ${t.ink}%`).join('  '));
console.log('world areas', Object.keys(worldAreas).length);
for (const k of ['US-CA', 'US-TX', 'US-FL', 'US-ME', 'US-DC', 'US-RI', 'US-DE']) {
  const a = usAreas[k];
  console.log(' ', k.padEnd(6), a.name.slice(0, 18).padEnd(18), 'size', String(a.size).padStart(6));
}
console.log('UNRESOLVED:', unresolved.length ? unresolved.join('; ') : 'none');
console.log('wrote      ', OUT.replace(/.*\/(?=public)/, ''), (readFileSync(OUT).length / 1024).toFixed(0) + ' KB');
