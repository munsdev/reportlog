/**
 * The places a `location` question can seal.
 *
 * ONE HIERARCHICAL STRING PER ANSWER — `US`, `US-AZ`, `DE` — and that is
 * the whole reason this type exists beside the free-text `place` one.
 * Rolling a state up to its country is a prefix and never a join, which is
 * what makes `src/mapData.js` able to aggregate without a gazetteer lookup
 * per report. `areaOf()` over there parses exactly the shape written here.
 *
 * THE DATA IS DERIVED FROM THE MAP'S OWN OUTLINES, by
 * tools/build-gazetteer.mjs, so a form cannot offer a place no map can
 * draw and a map cannot carry an area no form can reach. `npm test`
 * asserts the two files still agree; that script's header says why each
 * direction of drift is silent.
 *
 * A CODE IS NEVER REMOVED. A sealed answer holds its code forever, so
 * everything here tolerates a code it does not know and falls back to
 * showing the code itself — `placeName()` returns null rather than
 * throwing, and callers render the bare code. That is the honest display
 * for a place whose name this deployment has lost, and it is why a
 * location answer can never be made unverifiable by a data update.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Read once at import, like src/templates.js reads a template. The file is
   7 KB and committed; a deployment must not need a build step to answer a
   request. */
export const GAZETTEER = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'gazetteer.json'), 'utf8'),
);

/**
 * WHICH PLACES A QUESTION OFFERS, and it is the operator's choice.
 *
 * `us`      — a US state, DC or territory. A reporter names a state.
 * `world`   — a country, which is as fine as the world plane draws.
 * `both`    — either, so somebody outside the US can still answer.
 *
 * There are three because the map has two planes and some deployments want
 * both. Nothing here is a default for anybody: `us` is the shipped value
 * because the US plane is the only subdivision set the outline data has,
 * and an operator elsewhere changes it.
 *
 * NOT A SEALED-ANSWER SHAPE. The scope narrows which codes are accepted;
 * every scope seals the same thing, one string. So an operator who widens
 * a launched logbook's scope has changed no existing report's fingerprint
 * — and cannot, because `assertDraft` will not let them change a question
 * at all after launch.
 */
export const LOCATION_SCOPES = ['us', 'world', 'both'];
export const DEFAULT_LOCATION_SCOPE = 'us';

/** The only country with subdivisions in the outline data. See the builder. */
const SUBDIVIDED = 'US';

export function isCountryCode(code) {
  return Object.hasOwn(GAZETTEER.countries, code);
}

export function isSubdivisionCode(code) {
  const subs = GAZETTEER.subdivisions[SUBDIVIDED] || {};
  return Object.hasOwn(subs, code);
}

/** Every code this deployment can name, country and subdivision alike. */
export function isPlaceCode(code) {
  return isCountryCode(code) || isSubdivisionCode(code);
}

/** The name, or null for a code this deployment cannot name. Never throws. */
export function placeName(code) {
  if (typeof code !== 'string') return null;
  const subs = GAZETTEER.subdivisions[SUBDIVIDED] || {};
  return subs[code] || GAZETTEER.countries[code] || null;
}

/** What to show for a code, which for an unknown one is the code. */
export function placeLabel(code) {
  return placeName(code) || String(code || '');
}

function scopeOf(settings) {
  const s = settings && settings.scope;
  return LOCATION_SCOPES.includes(s) ? s : DEFAULT_LOCATION_SCOPE;
}

/** Does this scope accept this code? */
export function scopeAccepts(scope, code) {
  switch (LOCATION_SCOPES.includes(scope) ? scope : DEFAULT_LOCATION_SCOPE) {
    // A state, DC or a territory. NOT bare `US`: under this scope the
    // question is which state, and an answer of "the United States" is the
    // one `src/mapData.js` has to drop as unplaced. Refusing it at the form
    // is better than sealing an answer no map can use.
    case 'us':    return isSubdivisionCode(code);
    case 'world': return isCountryCode(code);
    case 'both':  return isCountryCode(code) || isSubdivisionCode(code);
    default:      return false;
  }
}

/**
 * A raw value from a form into the code that gets sealed, or null.
 *
 * UPPERCASED BEFORE CHECKING, because a browser that sent `us-az` and one
 * that sent `US-AZ` must produce the same seal — the same care
 * `normalizeEmail` takes for the same reason. Nothing else is coerced: a
 * place name is not accepted in place of a code, because "Arizona" typed
 * into a picker that meant to send `US-AZ` is a bug, and sealing a
 * best guess for it would hide the bug in the archive.
 */
export function normalizeLocation(value, settings = {}) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!code) return null;
  return scopeAccepts(scopeOf(settings), code) ? code : null;
}

/**
 * The picker's list for one question, already scoped and sorted by name.
 *
 * Countries and subdivisions are kept apart rather than merged, so a
 * picker can group them — `both` otherwise files Arizona between Argentina
 * and Armenia, which is a list nobody can use.
 */
export function placeOptions(settings = {}) {
  const scope = scopeOf(settings);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const subs = Object.entries(GAZETTEER.subdivisions[SUBDIVIDED] || {})
    .map(([code, name]) => ({ code, name })).sort(byName);
  const countries = Object.entries(GAZETTEER.countries)
    .map(([code, name]) => ({ code, name })).sort(byName);

  if (scope === 'us') return { subdivisions: subs, countries: [] };
  if (scope === 'world') return { subdivisions: [], countries };
  return { subdivisions: subs, countries };
}
