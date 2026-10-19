/**
 * The map's outline data and the gazetteer the forms read, and the promises
 * about what the map code may never do.
 *
 * THE GAZETTEER IS DERIVED FROM THE OUTLINES (tools/geo/build-gazetteer.js),
 * and either direction of drift is silent: a code a form can seal but no map
 * can draw puts reports in a place that never appears; a code a map can draw
 * but no form can seal is an area that reads as "nothing happened there".
 * This test derives the gazetteer again, here, and fails if the committed
 * one differs in a single code or name.
 */
import { GAZETTEER, isPlaceCode, normalizeLocation } from '@reportlog/fields';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Outlines } from '../../src/features/maps/outlines.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const outlines = JSON.parse(
  readFileSync(here('../../src/features/maps/outlines.json'), 'utf8'),
) as Outlines;

const sortKeys = (o: Record<string, string>) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );

describe('the gazetteer and the outlines', () => {
  it('hold exactly the same places, under exactly the same names', () => {
    const countries: Record<string, string> = {};
    for (const [code, a] of Object.entries(outlines.world.areas)) countries[code] = a.name;
    const us: Record<string, string> = {};
    for (const [code, a] of Object.entries(outlines.us.areas)) us[code] = a.name;
    for (const t of outlines.tiles) us[t.code] = t.name;

    expect(GAZETTEER.countries).toEqual(sortKeys(countries));
    expect(GAZETTEER.subdivisions).toEqual({ US: sortKeys(us) });
  });

  it('say where the gazetteer was built from', () => {
    const raw = JSON.parse(
      readFileSync(here('../../../../packages/fields/src/gazetteer.json'), 'utf8'),
    ) as { built_from: string };
    expect(raw.built_from).toBe('apps/web/src/features/maps/outlines.json');
  });

  it('give every place a form can seal somewhere to be drawn', () => {
    const drawable = new Set([
      ...Object.keys(outlines.us.areas),
      ...outlines.tiles.map((t) => t.code),
      ...Object.keys(outlines.world.areas),
    ]);
    const sealable = [
      ...Object.keys(GAZETTEER.countries),
      ...Object.keys(GAZETTEER.subdivisions.US ?? {}),
    ];
    for (const code of sealable) expect(drawable.has(code), code).toBe(true);
    for (const code of drawable) expect(isPlaceCode(code), code).toBe(true);
  });

  it('draw the lower 48 and DC on the map and the other seven as tiles', () => {
    expect(Object.keys(outlines.us.areas)).toHaveLength(49);
    expect(outlines.tiles.map((t) => t.code)).toEqual([
      'US-AK',
      'US-HI',
      'US-PR',
      'US-VI',
      'US-GU',
      'US-MP',
      'US-AS',
    ]);
    expect(normalizeLocation('us-az', { scope: 'us' })).toBe('US-AZ');
  });
});

/** Every source file of the map code, read as text. */
function mapSources(): { file: string; text: string }[] {
  const dir = here('../../src/features/maps/');
  return readdirSync(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((file) => ({ file, text: readFileSync(`${dir}${file}`, 'utf8') }));
}

describe('no tile layer, ever', () => {
  /* A tile request tells a third party which places the readers of an
     incident archive are looking at. This fails if the map code names a tile
     layer, a tile URL template, or a map library or tile service that would
     bring one. The browser suite separately fails if a page with a map asks
     any other host for anything. */
  const FORBIDDEN =
    /tileLayer|TileLayer|\{z\}\/\{x\}\/\{y\}|openstreetmap|tile\.|mapbox|maplibre|leaflet|openlayers|googleapis|arcgis|carto(cdn)?\.|stamen|thunderforest/i;

  it('is not named anywhere in the map code', () => {
    const sources = mapSources();
    expect(sources.length).toBeGreaterThan(3);
    for (const { file, text } of sources) {
      // Comments may explain the rule; code may not break it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(FORBIDDEN.test(code), file).toBe(false);
    }
  });

  it('has no map library to bring one in', () => {
    const pkg = JSON.parse(readFileSync(here('../../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  it('really would catch one', () => {
    expect(
      FORBIDDEN.test("L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')"),
    ).toBe(true);
  });
});

describe('nothing inside a map is found by id', () => {
  /* Several maps can be on one page. An id lookup from the second map's code
     finds the FIRST map's element and paints the wrong one, silently. */
  const WIDGET = ['HeatMap.tsx', 'MapSlot.tsx', 'MapPage.tsx', 'outlines.ts', 'scale.ts'];
  it('has no id lookups and sets no id', () => {
    for (const { file, text } of mapSources().filter((s) => WIDGET.includes(s.file))) {
      expect(text, file).not.toMatch(/getElementById|querySelector\(\s*['"`]#|useId\b|\bid=\{/);
    }
  });
});
