/**
 * The review keyword list, against a real database. Port of legacy
 * scripts/review-keywords-selftest.mjs, check for check.
 *
 * What only exists once a row round-trips through Postgres is the THREE-STATE
 * column: NULL ("use the shipped list"), an array ("this is our list"), and
 * an EMPTY array ("we chose no keyword matching").
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/database.ts';
import {
  DEFAULT_REVIEW_KEYWORDS,
  matchedKeywords,
  reviewKeywords,
  setReviewKeywords,
} from '../../src/moderation/keywords.ts';
import { testDatabase } from './helpers.ts';
import { resetModerationSettings } from './moderation-helpers.ts';

let db: Database;
beforeAll(async () => {
  db = testDatabase();
  await resetModerationSettings(db);
});
afterAll(async () => {
  // Left as found, so the next file sees an untouched row.
  await resetModerationSettings(db);
  await db.destroy();
});

describe('the three states', () => {
  it('an untouched install uses the shipped list', async () => {
    expect((await reviewKeywords(db)).length).toBe(DEFAULT_REVIEW_KEYWORDS.length);
  });

  it('an operator list is stored normalized and read back as stored', async () => {
    const out = await setReviewKeywords(
      db,
      ['Turned Away', 'threatened', 'turned away'],
      'm@example.org',
    );
    expect(out).toMatchObject({ ok: true, terms: ['threatened', 'turned away'] });
    expect(await reviewKeywords(db)).toEqual(['threatened', 'turned away']);
  });

  it('an EMPTY list is honoured as a choice, not read as unset', async () => {
    await setReviewKeywords(db, [], 'm@example.org');
    expect(await reviewKeywords(db)).toEqual([]);
  });

  it('and null puts the shipped list back, and says so', async () => {
    const out = await setReviewKeywords(db, null, 'm@example.org');
    expect(await reviewKeywords(db)).toHaveLength(DEFAULT_REVIEW_KEYWORDS.length);
    expect(out).toMatchObject({ ok: true, using_default: true });
  });
});

describe('who changed it', () => {
  it('records the person and when', async () => {
    await setReviewKeywords(db, ['harassed'], 'someone@example.org');
    const row = await db
      .selectFrom('moderation_settings')
      .select(['review_keywords_set_by', 'review_keywords_set_at'])
      .executeTakeFirstOrThrow();
    expect(row.review_keywords_set_by).toBe('someone@example.org');
    expect(row.review_keywords_set_at).toBeInstanceOf(Date);
  });
});

describe('what the database refuses', () => {
  const huge = Array.from({ length: 2001 }, (_, i) => `term${String(i)}`);

  it('2001 terms are refused before the query runs, leaving the list alone', async () => {
    await setReviewKeywords(db, ['harassed'], 'm@example.org');
    expect(await setReviewKeywords(db, huge, 'm@example.org')).toEqual({
      ok: false,
      reason: 'too-many',
    });
    expect(await reviewKeywords(db)).toEqual(['harassed']);
  });

  it('the CHECK stops it at the database too, not only in the module', async () => {
    await expect(
      db
        .updateTable('moderation_settings')
        .set({ review_keywords: huge })
        .where('id', '=', true)
        .execute(),
    ).rejects.toThrow();
  });

  it('2000 exactly is allowed', async () => {
    const out = await setReviewKeywords(db, huge.slice(0, 2000), 'm@example.org');
    expect(out.ok && out.terms.length).toBe(2000);
  });
});

describe('the flag reads the operator list, not the shipped one', () => {
  it('a term the operator kept fires, and one they CUT does not', async () => {
    await setReviewKeywords(db, ['turned me away'], 'm@example.org');
    const terms = await reviewKeywords(db);
    expect(matchedKeywords('They turned me away at the door', terms)).toEqual(['turned me away']);
    expect(matchedKeywords('He had a gun.', terms)).toEqual([]);
  });
});
