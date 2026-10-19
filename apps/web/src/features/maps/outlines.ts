/**
 * The outlines every map draws, built ahead of time by tools/geo/build-geo.js
 * and served from this site's own origin.
 *
 * NO TILE LAYER, EVER. A tile request tells a third party which places the
 * readers of an incident archive are looking at, and every deployment would
 * make it on behalf of an operator who never chose it. These are vector
 * outlines, already projected, so the browser needs no projection maths and
 * no map library: it draws rings as SVG paths. Open the page with the network
 * unplugged and the map still draws.
 *
 * FETCHED ON FIRST USE AND SHARED. The file is about half a megabyte, so it is
 * never in the main bundle: Vite emits it as its own file, and it is asked for
 * only when a map is on screen. Two maps on one page cost one download.
 */
import outlinesUrl from './outlines.json?url';

export type Ring = [number, number][];
/** A polygon is an outer ring and its holes; an area is several polygons. */
export type Polygon = Ring[];

export interface OutlineArea {
  name: string;
  polys: Polygon[];
  bbox: [number, number, number, number];
  size: number;
  at: [number, number] | null;
}

export interface OutlinePlane {
  width: number;
  height: number;
  areas: Record<string, OutlineArea>;
  frame: [[number, number], [number, number]];
}

/** Alaska, Hawaii and the territories, drawn as tiles below the lower 48. */
export interface OutlineTile {
  code: string;
  name: string;
  short: string;
  d: string;
  vb: [number, number, number, number];
}

export interface Outlines {
  us: OutlinePlane;
  tiles: OutlineTile[];
  world: OutlinePlane;
}

export type OutlineLoader = () => Promise<Outlines>;

async function fetchOutlines(): Promise<Outlines> {
  const res = await fetch(outlinesUrl, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('The map outlines could not be loaded.');
  return (await res.json()) as Outlines;
}

let loader: OutlineLoader = fetchOutlines;
let pending: Promise<Outlines> | null = null;

/** The outlines, fetched once per page however many maps ask. */
export function loadOutlines(): Promise<Outlines> {
  pending ??= loader().catch((err: unknown) => {
    // A failed download is not remembered: the next map to ask tries again.
    pending = null;
    throw err;
  });
  return pending;
}

/** For tests, which have no server to fetch from. */
export function setOutlineLoader(next: OutlineLoader): void {
  loader = next;
  pending = null;
}

/** An area's polygons as one SVG path. Holes draw as holes under the even-odd rule. */
export function pathOf(polys: readonly Polygon[]): string {
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([x, y], i) => {
        d += `${i ? 'L' : 'M'}${String(x)},${String(y)}`;
      });
      d += 'Z';
    }
  }
  return d;
}
