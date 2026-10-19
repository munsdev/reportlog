/**
 * The pure halves of moderation and the board. Ports of legacy selftest.js
 * groups "The review flag" and "The words that raise a review flag", and the
 * figures' expression language.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { disposition } from '../../src/board/stats.ts';
import {
  evaluate,
  figuresIn,
  formatNumber,
  parseExpression,
  renderText,
} from '../../src/board/figures.ts';
import { PROSE_KINDS, proseOf } from '../../src/moderation/flags.ts';
import {
  DEFAULT_REVIEW_KEYWORDS,
  MAX_KEYWORDS,
  keywordMatcher,
  matchedKeywords,
  normalizeKeywords,
} from '../../src/moderation/keywords.ts';

describe('the review flag reads prose only', () => {
  it("reads a reporter's own words, never the operator's wording", () => {
    const fields = [
      { key: 'account', kind: 'long_text' },
      { key: 'name', kind: 'short_text' },
      { key: 'outcome', kind: 'choice_one' },
      { key: 'when', kind: 'date' },
      { key: 'where', kind: 'place' },
      { key: 'armed', kind: 'yes_no' },
    ];
    const got = proseOf(
      {
        account: 'they turned me away',
        name: 'a short line',
        outcome: 'Turned away',
        when: '2026-11-03',
        where: 'A hall',
        armed: 'yes',
      },
      fields,
    );
    expect(got).toMatch(/they turned me away/);
    expect(got).toMatch(/a short line/);
    expect(got).not.toContain('Turned away');
    expect(got).not.toContain('2026-11-03');
    expect(got).not.toContain('A hall');
    // Deliberately short. A third prose kind is a decision, not an oversight.
    expect([...PROSE_KINDS].sort()).toEqual(['long_text', 'short_text']);
  });

  it('skips a value in an unexpected shape rather than stringifying it', () => {
    const fields = [{ key: 'a', kind: 'long_text' }];
    expect(proseOf({ a: ['x', 'y'] }, fields)).toBe('');
    expect(proseOf({ a: { x: 1 } }, fields)).toBe('');
    expect(proseOf({ a: 42 }, fields)).toBe('');
    expect(proseOf(null, fields)).toBe('');
    expect(proseOf({ a: 'kept' }, null)).toBe('');
  });
});

describe('the words that raise a review flag', () => {
  it('a term is trimmed, lowercased, deduplicated, sorted and capped', () => {
    expect(normalizeKeywords([' Turned Away ', 'threatened', 'TURNED AWAY', '', '  '])).toEqual([
      'threatened',
      'turned away',
    ]);
    expect(normalizeKeywords('not an array')).toBeNull();
    expect(normalizeKeywords(['x'.repeat(400)])?.[0]).toHaveLength(120);
  });

  it('an empty list is a choice, and matches nothing rather than everything', () => {
    expect(keywordMatcher([])).toBeNull();
    expect(matchedKeywords('anything at all', [])).toEqual([]);
    expect(matchedKeywords('', ['gun'])).toEqual([]);
  });

  it('a phrase matches as a phrase and a word matches on its boundaries', () => {
    expect(matchedKeywords('They turned me away at the door', ['turned me away'])).toEqual([
      'turned me away',
    ]);
    expect(matchedKeywords('The count had begun', ['gun'])).toEqual([]);
    expect(matchedKeywords('He had a gun.', ['gun'])).toEqual(['gun']);
  });

  it('a term that starts or ends with punctuation keeps a looser edge', () => {
    expect(matchedKeywords('a man with an AR-15 outside', ['ar-15'])).toEqual(['ar-15']);
    expect(matchedKeywords('he said (loudly) to leave', ['(loudly)'])).toEqual(['(loudly)']);
  });

  it('an operator list is text, so a stray bracket cannot break the flag', () => {
    expect(() => keywordMatcher(['what(', '[', '*', 'a|b', '\\'])).not.toThrow();
    expect(matchedKeywords('he said what( then left', ['what('])).toEqual(['what(']);
  });

  it('records which terms fired, not just that one did', () => {
    expect(
      matchedKeywords('The judge turned me away and the police were called.', [
        'the judge',
        'turned me away',
        'police were called',
        'threatened',
      ]),
    ).toEqual(['police were called', 'the judge', 'turned me away']);
  });

  it('the shipped list is normalized already, so saving it unedited changes nothing', () => {
    expect(normalizeKeywords([...DEFAULT_REVIEW_KEYWORDS])).toEqual([...DEFAULT_REVIEW_KEYWORDS]);
    expect(DEFAULT_REVIEW_KEYWORDS.length).toBeGreaterThan(100);
    expect(DEFAULT_REVIEW_KEYWORDS.length).toBeLessThanOrEqual(MAX_KEYWORDS);
  });
});

describe('nothing that computes a fingerprint reaches moderation or the board', () => {
  // The boundary check (.dependency-cruiser.cjs) holds this transitively; this
  // is the same promise as a plain read, so it fails with a readable message.
  it('no file under chain/ or packages/seal names them', () => {
    const dirs = [
      new URL('../../src/chain/', import.meta.url),
      new URL('../../../../packages/seal/src/', import.meta.url),
    ];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
        const src = readFileSync(new URL(f, dir), 'utf8');
        expect({
          f,
          reaches: /moderation\/|board\/|report_review_flags|editorial_note|review_keywords/.test(
            src,
          ),
        }).toEqual({
          f,
          reaches: false,
        });
      }
    }
  });
});

describe('what happened to a report, for the counts', () => {
  it('consent is the ceiling: approved without permission is not published', () => {
    expect(disposition({ withdrawn: false, moderation_status: 'valid', may_publish: false })).toBe(
      'not_permitted',
    );
    expect(disposition({ withdrawn: false, moderation_status: 'valid', may_publish: true })).toBe(
      'published',
    );
    expect(disposition({ withdrawn: true, moderation_status: 'valid', may_publish: true })).toBe(
      'withdrawn',
    );
    expect(disposition({ withdrawn: false, moderation_status: 'pending', may_publish: true })).toBe(
      'under_review',
    );
    expect(disposition({ withdrawn: false, moderation_status: 'invalid', may_publish: true })).toBe(
      'declined',
    );
    expect(disposition({ withdrawn: false, moderation_status: 'unknown', may_publish: true })).toBe(
      'unclear',
    );
  });
});

describe('the figures language', () => {
  it('does arithmetic, brackets, percent and round, over any figures', () => {
    const v = { a: 10, b: 4 };
    expect(evaluate(parseExpression('[a] + [b] * 2'), v)).toBe(18);
    expect(evaluate(parseExpression('([a] + [b]) * 2'), v)).toBe(28);
    expect(evaluate(parseExpression('-[a] / 4'), v)).toBe(-2.5);
    expect(evaluate(parseExpression('percent([b], [a])'), v)).toBe(40);
    expect(evaluate(parseExpression('round(2 / 3, 2)'), v)).toBe(0.67);
    expect([...figuresIn(parseExpression('percent([x.y], [z]) + 1'))]).toEqual(['x.y', 'z']);
  });

  it('refuses anything that is not the language, with a sentence', () => {
    for (const bad of ['eval(1)', '[a] +', '1 2', '[A B]', '"x"', 'round(1,2,3)', '[a]; drop']) {
      expect(() => parseExpression(bad)).toThrow();
    }
  });

  it('never evaluates code: the module names no eval and no Function', () => {
    const src = readFileSync(new URL('../../src/board/figures.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\beval\(|new Function|\bFunction\(/);
  });

  it('writes numbers plainly, and an unknown figure as "?"', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(2 / 3)).toBe('0.7');
    expect(formatNumber(1 / 0)).toBe('—');
    expect(renderText('Filed: {{ [n] }}. Bad: {{ [m] }}. Broken: {{ ( }}.', { n: 5 })).toBe(
      'Filed: 5. Bad: ?. Broken: ?.',
    );
  });
});
