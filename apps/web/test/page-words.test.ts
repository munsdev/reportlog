/**
 * The corner Edit menu's "Edit this page's words" (features/looks/editor):
 * which wording slots each public page offers.
 */
import { describe, expect, it } from 'vitest';
import { slotsOn } from '../src/features/looks/editor/pageWords.ts';

describe('the words each page offers to edit in place', () => {
  it.each([
    ['/', 'home_headline'],
    ['/about', 'about_archive'],
    ['/how/', 'how_intro'],
    ['/board', 'board_intro'],
    ['/board/numbers', 'board_intro'],
    ['/standards', 'standards'],
    ['/terms', 'terms_of_use'],
    ['/organizations', 'alliance_intro'],
  ])('%s offers %s', (path, slot) => {
    expect(slotsOn(path)).toContain(slot);
  });

  it('offers nothing on a page with no wording of its own, or a staff page', () => {
    for (const path of ['/legal', '/public-api', '/boardroom', '/moderate', '/people'])
      expect(slotsOn(path)).toEqual([]);
  });
});
