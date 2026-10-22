/**
 * Checking a new arrangement of the front page's quieter sections before it
 * is stored.
 *
 * STRICTER THAN THE READ. `resolveHomeSections` forgives an unknown or
 * repeated id on the way out, because a release can retire a section after
 * a site arranged it. The write has the whole list in front of it, so an id
 * it cannot place is a screen sending something wrong, and is refused in
 * words rather than quietly dropped. What is stored is the resolved list, so
 * a section the screen left out is kept, shown, at the end.
 */
import { HOME_SECTIONS, resolveHomeSections } from '@reportlog/contracts';
import type { HomeSection } from '@reportlog/contracts';
import type { Checked } from './result.ts';

const KNOWN = new Set<string>(HOME_SECTIONS);

export function validateHomeSections(
  sections: readonly { id: string; shown: boolean }[],
): Checked<HomeSection[]> {
  const seen = new Set<string>();
  for (const s of sections) {
    if (!KNOWN.has(s.id)) {
      return { ok: false, error: `The front page has no section called “${s.id}”.` };
    }
    if (seen.has(s.id)) {
      return { ok: false, error: 'A section is listed twice. Each one goes in once.' };
    }
    seen.add(s.id);
  }
  return { ok: true, value: resolveHomeSections(sections) };
}
