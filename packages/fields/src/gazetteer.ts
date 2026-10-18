/**
 * The places a `location` question can seal.
 *
 * ONE HIERARCHICAL STRING PER ANSWER — `US`, `US-AZ`, `DE`. Rolling a state up
 * to its country is a prefix and never a join.
 *
 * THE DATA IS DERIVED FROM THE MAP'S OWN OUTLINES (the maps workstream owns
 * the builder), so a form cannot offer a place no map can draw.
 *
 * A CODE IS NEVER REMOVED. A sealed answer holds its code forever, so
 * everything here tolerates an unknown code: `placeName` returns null rather
 * than throwing, and callers show the bare code.
 */
import data from './gazetteer.json' with { type: 'json' };
import type { LocationScope } from './types.ts';

interface Gazetteer {
  countries: Record<string, string>;
  subdivisions: Record<string, Record<string, string>>;
}

export const GAZETTEER: Gazetteer = data;

/**
 * `us` — a US state, DC or territory. `world` — a country. `both` — either.
 * The scope narrows which codes are accepted; every scope seals one string.
 */
export const LOCATION_SCOPES: readonly LocationScope[] = ['us', 'world', 'both'];
export const DEFAULT_LOCATION_SCOPE: LocationScope = 'us';

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

export function isPlaceCode(code: string): boolean {
  return isCountryCode(code) || isSubdivisionCode(code);
}

/** The name, or null for a code this deployment cannot name. Never throws. */
export function placeName(code: unknown): string | null {
  if (typeof code !== 'string') return null;
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

export function scopeAccepts(scope: LocationScope, code: string): boolean {
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
 * A raw value into the code that gets sealed, or null. UPPERCASED FIRST, so
 * `us-az` and `US-AZ` seal the same string. A place NAME is never accepted in
 * place of a code: that is a bug, and sealing a guess would hide it.
 */
export function normalizeLocation(
  value: unknown,
  settings?: { scope?: unknown } | null,
): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!code) return null;
  return scopeAccepts(scopeOf(settings), code) ? code : null;
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
