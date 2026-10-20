/**
 * The rules the publication card's wording keeps. The legacy vectors pin
 * today's exact text by its digest, which holds the rules only by accident:
 * a new wording is a new digest and a new vector, and nothing would say it
 * broke a rule. These say it.
 */
import { describe, expect, it } from 'vitest';
import { CARD, CARD_VARIANTS, cardFor, cardLines } from '../src/index.ts';

const every = (fn: (text: string) => void) => {
  for (const v of CARD_VARIANTS) fn(cardLines(v).join(' '));
};

describe('the publication card', () => {
  it('never says consent', () => {
    // The lawful basis is deliberately not Article 6(1)(a) consent; see
    // src/consent.ts. This is the text a reporter actually reads.
    every((text) => {
      expect(text).not.toMatch(/consent/i);
    });
    // Nor the key name, which a card could be tempted to echo.
    for (const v of CARD_VARIANTS) expect(JSON.stringify(cardFor(v))).not.toMatch(/consent/i);
  });

  it('promises nothing about timing', () => {
    every((text) => {
      for (const word of ['soon', 'later this', 'when we', 'once we', 'in future', 'shortly']) {
        expect(text.toLowerCase(), word).not.toContain(word);
      }
    });
  });

  it('describes two permissions: the words, sealed for good, and the files, asked separately and revocable', () => {
    const body = CARD.body.join(' ');
    // The old single sentence, which assumed one permission.
    expect(body).not.toMatch(/your report and anything you attached to it/);
    expect(body).toMatch(/the report itself/);
    expect(body).toMatch(/asked about separately/);
    expect(body).toMatch(/back down/);
    expect(body).toMatch(/cannot be changed afterwards/);
    expect(body).toMatch(/email address is not part of what would be published/);
  });

  it('says publication is permanent, searchable and downloadable, and that filing works either way', () => {
    every((text) => {
      const t = text.toLowerCase();
      for (const word of ['permanent', 'search', 'download', 'either way']) {
        expect(t, word).toContain(word);
      }
    });
  });
});
