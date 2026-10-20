import { describe, expect, it } from 'vitest';
import {
  GAZETTEER,
  buildAnswers,
  countyOptions,
  depthOf,
  isSubdivisionCode,
  normalizeAnswer,
  placeLabel,
  placeOptions,
  stateOfPlace,
} from '../src/index.ts';
import type { FieldDefinition } from '../src/index.ts';

const COUNTY = { scope: 'us', depth: 'county' } as const;

describe('the county table (owner decision 44)', () => {
  const codes = Object.keys(GAZETTEER.counties);

  it('rolls every county up to a state the list already offers', () => {
    for (const code of codes) {
      expect(code).toMatch(/^US-[A-Z]{2}-\d{5}$/);
      expect(isSubdivisionCode(stateOfPlace(code)), code).toBe(true);
    }
  });

  it('holds each code once, and every state has a county under it', () => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const state of Object.keys(GAZETTEER.subdivisions.US ?? {})) {
      expect(countyOptions(state).length, state).toBeGreaterThan(0);
    }
  });

  it('carries the five-digit FIPS code and the Census name, DC and territories included', () => {
    expect(GAZETTEER.counties['US-AZ-04013']).toBe('Maricopa County');
    expect(GAZETTEER.counties['US-DC-11001']).toBe('District of Columbia');
    expect(countyOptions('US-PR').length).toBe(78);
    // The Minor Outlying Islands are no state on any form, so no county either.
    expect(codes.some((c) => c.startsWith('US-UM'))).toBe(false);
  });

  it('names a county with its state, and leaves an unknown code as itself', () => {
    expect(placeLabel('US-AZ-04013')).toBe('Maricopa County, Arizona');
    expect(placeLabel('US-AZ-99999')).toBe('US-AZ-99999');
    expect(stateOfPlace('US-AZ-99999')).toBe('US-AZ');
    expect(stateOfPlace('US-AZ')).toBe('US-AZ');
    expect(stateOfPlace('DE')).toBe('DE');
  });
});

describe('normalizing a location at county depth', () => {
  it('takes a county or a state, as one string', () => {
    expect(normalizeAnswer('location', 'us-az-04013', COUNTY)).toBe('US-AZ-04013');
    expect(normalizeAnswer('location', 'US-AZ', COUNTY)).toBe('US-AZ');
  });

  it('refuses a county the table does not have, a country, and a name', () => {
    expect(normalizeAnswer('location', 'US-AZ-99999', COUNTY)).toBeNull();
    // A real FIPS code under the wrong state is not a code in the table.
    expect(normalizeAnswer('location', 'US-CA-04013', COUNTY)).toBeNull();
    expect(normalizeAnswer('location', 'DE', COUNTY)).toBeNull();
    expect(normalizeAnswer('location', 'Maricopa County', COUNTY)).toBeNull();
  });

  it('keeps today’s behaviour when depth is absent: a county is refused', () => {
    expect(depthOf({})).toBe('state');
    expect(normalizeAnswer('location', 'US-AZ-04013', { scope: 'us' })).toBeNull();
    expect(
      normalizeAnswer('location', 'US-AZ-04013', { scope: 'both', depth: 'county' }),
    ).toBeNull();
    expect(normalizeAnswer('location', 'US-AZ', { scope: 'us' })).toBe('US-AZ');
  });

  it('seals a county answer as one string, and the state list is unchanged', () => {
    const where: FieldDefinition = {
      key: 'where',
      kind: 'location',
      label: 'Where',
      settings: COUNTY,
    };
    expect(buildAnswers([where], { where: 'US-AZ-04013' })).toEqual({
      answers: { where: 'US-AZ-04013' },
      errors: [],
    });
    expect(placeOptions(COUNTY)).toEqual(placeOptions({ scope: 'us' }));
  });
});
