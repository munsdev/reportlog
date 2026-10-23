/**
 * Searching by a place's name (src/board/search.ts): places are sealed as
 * codes, so a name has to be turned into the codes it means.
 */
import { describe, expect, it } from 'vitest';
import { placeCodesFor } from '../../src/board/search.ts';

describe('a place name in a search', () => {
  it('a state means its code, its postal code, and every county inside it', () => {
    const { exact, within } = placeCodesFor('Arizona');
    expect(exact).toEqual(expect.arrayContaining(['US-AZ', 'AZ']));
    expect(within).toEqual(['US-AZ-']);
  });

  it('a county, with or without the word County, in any case', () => {
    expect(placeCodesFor('Maricopa County').exact).toContain('US-AZ-04013');
    expect(placeCodesFor('maricopa').exact).toContain('US-AZ-04013');
  });

  it('a country', () => {
    expect(placeCodesFor('Germany').exact).toEqual(['DE']);
  });

  it('words that are no place, or too short to be one, add nothing', () => {
    expect(placeCodesFor('ballots left out').exact).toEqual([]);
    expect(placeCodesFor('az').exact).toEqual([]);
  });
});
