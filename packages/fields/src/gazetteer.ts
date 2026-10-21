/**
 * The places a `location` question can seal.
 *
 * ONE HIERARCHICAL STRING PER ANSWER — `US`, `US-AZ`, `DE`, and at county
 * depth `US-AZ-04013`. Rolling a county up to its state, or a state up to its
 * country, is a prefix and never a join. Why a county is written that way is
 * in tools/geo/build-gazetteer.js (owner decision 44).
 *
 * THE DATA IS DERIVED FROM THE MAP'S OWN OUTLINES (the maps workstream owns
 * the builder), so a form cannot offer a place no map can draw.
 *
 * A CODE IS NEVER REMOVED. A sealed answer holds its code forever, so
 * everything here tolerates an unknown code: `placeName` returns null rather
 * than throwing, and callers show the bare code.
 */
import data from './gazetteer.json' with { type: 'json' };
import type { LocationCode, LocationDepth, LocationScope } from './types.ts';

interface Gazetteer {
  countries: Record<string, string>;
  subdivisions: Record<string, Record<string, string>>;
  /** Keyed by the full code, `US-AZ-04013`; the value is the Census name. */
  counties: Record<string, string>;
}

export const GAZETTEER: Gazetteer = data;

/**
 * `us` — a US state, DC or territory. `world` — a country. `both` — either.
 * The scope narrows which codes are accepted; every scope seals one string.
 */
export const LOCATION_SCOPES: readonly LocationScope[] = ['us', 'world', 'both'];
export const DEFAULT_LOCATION_SCOPE: LocationScope = 'us';

/**
 * How deep a `us` question asks. `state` is what every location question did
 * before counties existed, and it is what an ABSENT `depth` means: the
 * setting is written only when it is `county`, so no form made before it,
 * and no seal over one, changes. At `county` a state on its own is still an
 * answer ("Not sure which county"): a reporter who knows the state and not
 * the county must not be pushed into a guess.
 */
export const LOCATION_DEPTHS: readonly LocationDepth[] = ['state', 'county'];

/** The only country with subdivisions in the outline data. */
const SUBDIVIDED = 'US';

function subdivisions(): Record<string, string> {
  return GAZETTEER.subdivisions[SUBDIVIDED] ?? {};
}

export function isCountryCode(code: string): boolean {
  return Object.hasOwn(GAZETTEER.countries, code);
}

export function isSubdivisionCode(code: string): boolean {
  return Object.hasOwn(subdivisions(), code);
}

export function isCountyCode(code: string): boolean {
  return Object.hasOwn(GAZETTEER.counties, code);
}

export function isPlaceCode(code: string): boolean {
  return isCountryCode(code) || isSubdivisionCode(code) || isCountyCode(code);
}

const COUNTY_SHAPE = /^([A-Z]{2}-[A-Z0-9]{1,3})-\d{5}$/;

/**
 * The state a county code rolls up to, by prefix; any other code is its own
 * area. By SHAPE, not by table, so a county this deployment cannot name
 * still counts toward its state.
 */
export function stateOfPlace(code: string): string {
  return COUNTY_SHAPE.exec(code)?.[1] ?? code;
}

/** The name, or null for a code this deployment cannot name. Never throws. */
export function placeName(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const county = GAZETTEER.counties[code];
  // WITH ITS STATE, because county names repeat across states.
  if (county !== undefined) {
    const state = subdivisions()[stateOfPlace(code)];
    return state ? `${county}, ${state}` : county;
  }
  return subdivisions()[code] ?? GAZETTEER.countries[code] ?? null;
}

/** What to show for a code, which for an unknown one is the code. */
export function placeLabel(code: unknown): string {
  return placeName(code) ?? (typeof code === 'string' ? code : '');
}

export function scopeOf(settings: { scope?: unknown } | null | undefined): LocationScope {
  const s = settings?.scope;
  return LOCATION_SCOPES.includes(s as LocationScope)
    ? (s as LocationScope)
    : DEFAULT_LOCATION_SCOPE;
}

export function depthOf(settings: { depth?: unknown } | null | undefined): LocationDepth {
  return settings?.depth === 'county' ? 'county' : 'state';
}

export function scopeAccepts(
  scope: LocationScope,
  code: string,
  depth: LocationDepth = 'state',
): boolean {
  // Counties are only ever under `us`: setup refuses county depth elsewhere,
  // and this refuses a county code from any question not asking for one.
  if (isCountyCode(code)) return scope === 'us' && depth === 'county';
  switch (scope) {
    // A state, DC or territory, NOT bare `US`: under this scope the question
    // is which state, and "the United States" is an answer no map can place.
    case 'us':
      return isSubdivisionCode(code);
    case 'world':
      return isCountryCode(code);
    case 'both':
      return isCountryCode(code) || isSubdivisionCode(code);
  }
}

/**
 * How a question writes its answer: absent is the hierarchical code. `postal`
 * and `fips` are read only on a US question at the matching depth; setup
 * refuses any other combination, so here an unexpected one is simply absent.
 */
export function codeOf(
  settings: { scope?: unknown; depth?: unknown; code?: unknown } | null | undefined,
): LocationCode | null {
  const c = settings?.code;
  if (scopeOf(settings) !== 'us') return null;
  if (c === 'postal' && depthOf(settings) === 'state') return 'postal';
  if (c === 'fips' && depthOf(settings) === 'county') return 'fips';
  return null;
}

let byFips: Map<string, string> | null = null;

/**
 * A county's full code from its five digits alone. FIPS codes are unique
 * across the country (the first two digits are the state's), so this needs
 * no state, and a sealed `04013` can always be named.
 */
export function countyCodeOfFips(fips: string): string | null {
  if (!byFips) {
    byFips = new Map();
    for (const code of Object.keys(GAZETTEER.counties)) byFips.set(code.slice(-5), code);
  }
  return byFips.get(fips) ?? null;
}

/**
 * Any written form of an answer back into the hierarchical code, so maps,
 * alerts and labels have one thing to read: `AZ` under `postal` is `US-AZ`,
 * `04013` under `fips` is `US-AZ-04013`. Null for what no form could seal.
 */
export function placeCodeOf(
  value: unknown,
  settings: { scope?: unknown; depth?: unknown; code?: unknown } | null | undefined,
): string | null {
  if (typeof value !== 'string' || !value) return null;
  switch (codeOf(settings)) {
    case 'postal':
      return /^[A-Z]{2}$/.test(value) ? `US-${value}` : null;
    case 'fips':
      return /^\d{5}$/.test(value) ? countyCodeOfFips(value) : null;
    default:
      return value;
  }
}

/**
 * A `postal` state or a `fips` county, checked. A county must lie in the
 * state already answered under `within`; with no state answered there is no
 * county to accept, which is what keeps the county box inactive until a state
 * is picked from being only a matter of the screen.
 */
function normalizeCoded(
  code: string,
  how: LocationCode,
  settings: { within?: unknown },
  answers: Record<string, unknown> | undefined,
): string | null {
  if (how === 'postal') return isSubdivisionCode(`US-${code}`) ? code : null;
  if (!/^\d{5}$/.test(code)) return null;
  const full = countyCodeOfFips(code);
  if (!full) return null;
  if (typeof settings.within !== 'string') return code;
  const state = answers?.[settings.within];
  return typeof state === 'string' && full === `US-${state}-${code}` ? code : null;
}

/**
 * A raw value into the code that gets sealed, or null. UPPERCASED FIRST, so
 * `us-az` and `US-AZ` seal the same string. A place NAME is never accepted in
 * place of a code: that is a bug, and sealing a guess would hide it.
 */
export function normalizeLocation(
  value: unknown,
  settings?: { scope?: unknown; depth?: unknown; code?: unknown; within?: unknown } | null,
  answers?: Record<string, unknown>,
): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!code) return null;
  const how = codeOf(settings);
  if (how) return normalizeCoded(code, how, settings ?? {}, answers);
  return scopeAccepts(scopeOf(settings), code, depthOf(settings)) ? code : null;
}

export interface PlaceOption {
  code: string;
  name: string;
}

/** The picker's list for one question, scoped, grouped and sorted by name. */
export function placeOptions(settings?: { scope?: unknown } | null): {
  subdivisions: PlaceOption[];
  countries: PlaceOption[];
} {
  const scope = scopeOf(settings);
  const byName = (a: PlaceOption, b: PlaceOption) => a.name.localeCompare(b.name);
  const subs = Object.entries(subdivisions())
    .map(([code, name]) => ({ code, name }))
    .sort(byName);
  const countries = Object.entries(GAZETTEER.countries)
    .map(([code, name]) => ({ code, name }))
    .sort(byName);
  if (scope === 'us') return { subdivisions: subs, countries: [] };
  if (scope === 'world') return { subdivisions: [], countries };
  return { subdivisions: subs, countries };
}

let byState: Map<string, PlaceOption[]> | null = null;

/** A state's counties for the second picker, sorted by name; [] for anything else. */
export function countyOptions(state: string): PlaceOption[] {
  if (!byState) {
    byState = new Map();
    for (const [code, name] of Object.entries(GAZETTEER.counties)) {
      const s = stateOfPlace(code);
      const list = byState.get(s) ?? [];
      list.push({ code, name });
      byState.set(s, list);
    }
    for (const list of byState.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return byState.get(state) ?? [];
}
