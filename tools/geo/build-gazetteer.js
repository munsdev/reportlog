/* Builds packages/fields/src/gazetteer.json — the places a `location`
 * question offers.
 *
 *     pnpm --filter @reportlog/geo-tools outlines   (both builds, in order)
 *
 * Ported from legacy tools/build-gazetteer.mjs.
 *
 * DERIVED FROM apps/web/src/features/maps/outlines.json, AND THAT IS THE
 * WHOLE POINT. The
 * gazetteer and the outlines have to hold the same codes or the feature is
 * broken in one of two directions, both of which are silent:
 *
 *   a code a form can seal but no map can draw puts a report in a place
 *   the map will never show, and nothing reports a fault — the count
 *   simply never appears;
 *
 *   a code a map can draw but no form can seal is an area that is
 *   permanently empty, which reads as "nothing happened there".
 *
 * Deriving one from the other makes both impossible rather than merely
 * unlikely, and apps/web/test/maps/outlines.test.ts (in `pnpm check`)
 * asserts the two files still agree. So the source of truth for what
 * places exist is the outline data, vendored under tools/geo/data/ and
 * projected by tools/geo/build-geo.js.
 *
 * THE OUTPUT IS COMMITTED, like maps.json. The server reads it at import
 * time; it must not need a build step to answer a request.
 *
 * NAMES ARE THE SOURCE'S, VERBATIM, including "United States of America"
 * rather than a tidier "United States". The map's own labels come from the
 * same strings, and a form that named a place differently from the map it
 * feeds would be two names for one area.
 *
 * ============================================================
 * A CODE IS NEVER REMOVED FROM THIS FILE.
 *
 * A location answer is SEALED. A report filed against `US-AZ` holds that
 * string in its fingerprint forever, so dropping the code later does not
 * tidy anything — it leaves reports pointing at a place this deployment
 * can no longer name. If the upstream outline data ever stops carrying an
 * area, keep its row here by hand and say why. Everything that reads a
 * code also tolerates one it does not know, and falls back to showing the
 * code itself, because that is the honest display for a place whose name
 * has been lost.
 * ============================================================
 *
 * ONLY THE UNITED STATES HAS SUBDIVISIONS, because the US outlines are the
 * only subdivision set the map has. That is a limit of the drawing data
 * and not a position about anywhere: a deployment in Germany asks for a
 * country today. Adding a second country's states is a build-geo change
 * and a rerun of this, and nothing else.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const maps = JSON.parse(
  readFileSync(here('../../apps/web/src/features/maps/outlines.json'), 'utf8'),
);

/** Countries: the world plane's areas, which are ISO 3166-1 alpha-2. */
const countries = {};
for (const [code, area] of Object.entries(maps.world.areas)) {
  countries[code] = area.name;
}

/* US subdivisions: the lower 48 and DC from the US plane, plus the seven
   that are tiles beneath it. A tile is not a lesser place — it is a
   drawing decision about room on a canvas (docs/map.md says why) — so the
   two sets are one list here. */
const us = {};
for (const [code, area] of Object.entries(maps.us.areas)) us[code] = area.name;
for (const tile of maps.tiles) us[tile.code] = tile.name;

const sortKeys = (o) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );

const out = {
  gazetteer: 1,
  // Stated so a reader of the data knows where to go to change it, without
  // having to find this script first.
  built_from: 'apps/web/src/features/maps/outlines.json',
  countries: sortKeys(countries),
  subdivisions: { US: sortKeys(us) },
};

if (!countries.US) {
  // The US plane would then be subdivisions of a country the gazetteer does
  // not have, which is the one inconsistency this script could produce by
  // itself.
  throw new Error('the world plane has no US, so the US subdivisions have no parent');
}

/* Counties: STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT. */
const counties = {};
let dropped = 0;
const census = readFileSync(here('data/census/national_county2020.txt'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean);
for (const line of census.slice(1)) {
  const [usps, statefp, countyfp, , name] = line.split('|');
  if (!/^\d{2}$/.test(statefp) || !/^\d{3}$/.test(countyfp) || !name) {
    throw new Error(`unreadable Census line: ${line}`);
  }
  const state = `US-${usps}`;
  if (!us[state]) {
    dropped += 1;
    continue;
  }
  const code = `${state}-${statefp}${countyfp}`;
  if (counties[code]) throw new Error(`two Census rows for ${code}`);
  counties[code] = name;
}
// Every state the list offers has at least one county-equivalent, or a
// county-depth question would offer that state and then nothing under it.
for (const state of Object.keys(us)) {
  if (!Object.keys(counties).some((c) => c.startsWith(`${state}-`))) {
    throw new Error(`no Census county for ${state}`);
  }
}
out.counties_from = 'tools/geo/data/census/national_county2020.txt';
out.counties = sortKeys(counties);

const OUT = here('../../packages/fields/src/gazetteer.json');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

process.stdout.write(
  `packages/fields/src/gazetteer.json: ${Object.keys(out.countries).length} countries, ` +
    `${Object.keys(out.subdivisions.US).length} US states and territories, ` +
    `${Object.keys(out.counties).length} counties (${String(dropped)} outside them dropped)\n`,
);
