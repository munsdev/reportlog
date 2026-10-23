/**
 * County outlines for the lower 48 and DC, built by tools/geo/build-geo.js
 * into their own file (about half a megabyte) so a map that shows states only
 * never downloads them. Projected exactly as the state plane, so a county
 * lies inside its state. Served from this site's own origin, like every
 * outline: no tile layer, ever (outlines.ts).
 */
import countiesUrl from './counties.json?url';

export interface CountyOutline {
  name: string;
  /** One SVG path: the county is only ever filled. */
  d: string;
  at: [number, number] | null;
}

export interface CountyOutlines {
  width: number;
  height: number;
  areas: Record<string, CountyOutline>;
}

let loader = async (): Promise<CountyOutlines> => {
  const res = await fetch(countiesUrl, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('The county outlines could not be loaded.');
  return (await res.json()) as CountyOutlines;
};
let pending: Promise<CountyOutlines> | null = null;

/** Fetched once per page, and only when a map has a county to draw. */
export function loadCountyOutlines(): Promise<CountyOutlines> {
  pending ??= loader().catch((err: unknown) => {
    pending = null;
    throw err;
  });
  return pending;
}

/** For tests, which have no server to fetch from. */
export function setCountyLoader(next: () => Promise<CountyOutlines>): void {
  loader = next;
  pending = null;
}
