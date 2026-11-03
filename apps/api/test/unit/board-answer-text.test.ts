import { describe, expect, it } from 'vitest';
import { answerText } from '../../src/board/stats.ts';

// The board's Numbers page named US states as countries: a state sealed by
// postal code (`NC`) was read as a bare country code (New Caledonia).
describe('answerText for a place', () => {
  const state = { scope: 'us', code: 'postal' };
  const county = { scope: 'us', depth: 'county', code: 'fips', within: 'state' };

  it('names a postal state as the state, never a country with the same letters', () => {
    expect(answerText('location', 'NC', state)).toBe('North Carolina');
    expect(answerText('location', 'CA', state)).toBe('California');
    expect(answerText('location', 'KY', state)).toBe('Kentucky');
    expect(answerText('location', 'IN', state)).toBe('Indiana');
    expect(answerText('location', 'TX', state)).toBe('Texas');
  });
  it('names a FIPS county with its state', () => {
    expect(answerText('location', '13121', county)).toBe('Fulton County, Georgia');
  });
  it('still reads a question with no code setting as written', () => {
    expect(answerText('location', 'CA', { scope: 'world' })).toBe('Canada');
    expect(answerText('location', 'US-CA')).toBe('California');
  });
});
