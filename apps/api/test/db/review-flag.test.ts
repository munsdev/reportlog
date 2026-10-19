/**
 * The review flag, against a real database. Port of legacy
 * scripts/review-flag-selftest.mjs, check for check.
 *
 * What is only true once a report exists: that a flag is raised in the same
 * transaction as the report, that a correction gets its own look, that
 * clearing records who and does not delete, and, the one that decides whether
 * the feature is usable at all, that a reporter's PROSE is read and their
 * CHOICES are not.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { buildAnswers } from '@reportlog/fields';
import { normalizeReportFields } from '@reportlog/seal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/db/database.ts';
import { appendCorrection, lockHead } from '../../src/filing/correction.ts';
import { clearFlag, flagForThread, flagReport, openFlagCount } from '../../src/moderation/flags.ts';
import { setReviewKeywords } from '../../src/moderation/keywords.ts';
import { GENERAL_DIGEST, launchedLogbook, testDatabase } from './helpers.ts';
import { correctThread, fileThread, resetModerationSettings } from './moderation-helpers.ts';

// A prose question AND a choice whose option is itself a keyword: the trap.
const Q: FieldDefinition[] = [
  { key: 'account', kind: 'long_text', label: 'What happened?', required: true },
  {
    key: 'outcome',
    kind: 'choice_one',
    label: 'What was the outcome?',
    settings: { options: ['Turned away', 'Allowed to vote'] },
  },
];

let db: Database;
let lb: { id: number; slug: string };
const file = (body: Record<string, unknown>) => fileThread(db, lb, Q, body);
const flagged = async (threadId: string) =>
  (await db
    .selectFrom('report_review_flags as f')
    .innerJoin('report_heads as h', 'h.current_report_id', 'f.report_id')
    .select('f.terms')
    .where('h.thread_id', '=', threadId)
    .where('f.cleared_at', 'is', null)
    .executeTakeFirst()) ?? null;

beforeAll(async () => {
  db = testDatabase();
  // The shipped set, not whatever an earlier file left behind.
  await resetModerationSettings(db);
  lb = await launchedLogbook(db, Q);
});
afterAll(async () => {
  await resetModerationSettings(db);
  await db.destroy();
});

describe('what gets read', () => {
  it('prose that matches raises a flag, recording which terms fired', async () => {
    const a = await file({ account: 'The judge turned me away and the police were called.' });
    const f = await flagged(a.threadId);
    expect(f).not.toBeNull();
    expect(f?.terms).toEqual(expect.arrayContaining(['turned me away', 'the judge']));
  });

  it('prose that matches nothing raises none', async () => {
    const b = await file({ account: 'The queue moved quickly and everyone was polite.' });
    expect(await flagged(b.threadId)).toBeNull();
  });

  it('A CHOICE THE OPERATOR WROTE IS NOT MATCHED', async () => {
    // Matching the form's own wording would flag every report that ticked it.
    const c = await file({
      account: 'Nothing unusual happened and I voted without trouble.',
      outcome: 'Turned away',
    });
    expect(await flagged(c.threadId)).toBeNull();
  });
});

describe('the marker the queue reads', () => {
  it('stands against the thread and is open until somebody clears it', async () => {
    const a = await file({ account: 'They threatened me at the door.' });
    const standing = await flagForThread(db, a.threadId);
    expect(standing?.terms.length).toBeGreaterThan(0);
    expect(standing?.cleared_at).toBeNull();
    const b = await file({ account: 'All calm.' });
    expect(await flagForThread(db, b.threadId)).toBeNull();
  });
});

describe('a correction gets its own look', () => {
  it('THE CORRECTION IS FLAGGED THOUGH THE ORIGINAL WAS NOT', async () => {
    const d = await file({ account: 'Nothing much to report, it was quiet.' });
    expect(await flagged(d.threadId)).toBeNull();
    const out = await correctThread(db, lb, Q, d, {
      account: 'On reflection I was threatened and I am scared.',
    });
    expect(out.flag.flagged).toBe(true);
    // And the flag read back is the correction's, not the original's.
    expect((await flagForThread(db, d.threadId))?.terms).toContain('threatened');
  });

  it('the real correction path flags it too, for the reporter and the coordinator alike', async () => {
    // correctThread above builds its own correction. This goes through
    // appendCorrection, which both "My reports" and a coordinator's
    // correction call, so neither can skip the look.
    const d = await file({ account: 'All quiet at the polling place.' });
    const { answers } = buildAnswers(Q, { account: 'Later the judge turned me away.' });
    await db.transaction().execute(async (trx) =>
      appendCorrection(trx, {
        threadId: d.threadId,
        headId: await lockHead(trx, d.threadId),
        logbookId: lb.id,
        questions: Q,
        fields: normalizeReportFields({
          logbook: lb.slug,
          answers,
          may_publish: true,
          may_publish_digest: GENERAL_DIGEST,
        }),
        publicRefPrefix: 'RL-',
      }),
    );
    expect((await flagged(d.threadId))?.terms).toEqual(
      expect.arrayContaining(['turned me away', 'the judge']),
    );
  });
});

describe('clearing it', () => {
  it('records who read it, keeps the flag, and never rewrites the first reader', async () => {
    const a = await file({ account: 'The judge turned me away.' });
    const out = await clearFlag(db, a.threadId, 'mod@example.org');
    expect(out).toEqual({ ok: true, cleared: 1 });
    expect(await flagged(a.threadId)).toBeNull();

    const cleared = await flagForThread(db, a.threadId);
    // BUT THE FLAG IS STILL THERE: how many were worth raising needs these too.
    expect(cleared).not.toBeNull();
    expect(cleared?.cleared_by).toBe('mod@example.org');
    expect(cleared?.cleared_at).toBeInstanceOf(Date);

    expect(await clearFlag(db, a.threadId, null)).toEqual({ ok: false, reason: 'no-actor' });
    expect(await clearFlag(db, a.threadId, 'other@example.org')).toEqual({ ok: true, cleared: 0 });
    expect((await flagForThread(db, a.threadId))?.cleared_by).toBe('mod@example.org');
  });

  it('the database itself refuses to delete a flag, un-clear one, or rewrite its terms', async () => {
    const a = await file({ account: 'I was threatened.' });
    const { id } = await db
      .selectFrom('report_review_flags')
      .select('id')
      .where('thread_id', '=', a.threadId)
      .executeTakeFirstOrThrow();
    await expect(
      db.deleteFrom('report_review_flags').where('id', '=', id).execute(),
    ).rejects.toThrow();
    await expect(
      db
        .updateTable('report_review_flags')
        .set({ terms: ['nothing'] })
        .where('id', '=', id)
        .execute(),
    ).rejects.toThrow();
    await clearFlag(db, a.threadId, 'mod@example.org');
    await expect(
      db
        .updateTable('report_review_flags')
        .set({ cleared_at: null, cleared_by: null })
        .where('id', '=', id)
        .execute(),
    ).rejects.toThrow();
  });
});

describe("the operator's list is what is used", () => {
  it('a term the operator CUT does not fire, and one they kept does', async () => {
    await setReviewKeywords(db, ['turned me away'], 'moderator@example.org');
    expect(
      await flagged((await file({ account: 'He had a gun and I was terrified.' })).threadId),
    ).toBeNull();
    expect(
      await flagged((await file({ account: 'They turned me away at the door.' })).threadId),
    ).not.toBeNull();
  });

  it('AN EMPTY LIST FLAGS NOTHING, which is a real choice', async () => {
    await setReviewKeywords(db, [], 'moderator@example.org');
    const g = await file({ account: 'The judge turned me away and I was threatened.' });
    expect(await flagged(g.threadId)).toBeNull();
    await resetModerationSettings(db);
  });
});

describe('what it never does', () => {
  it('writes nothing into the report row, and the open queue can be counted', async () => {
    const a = await file({ account: 'I was threatened.' });
    const row = await db
      .selectFrom('reports')
      .selectAll()
      .where('id', '=', a.reportId)
      .executeTakeFirstOrThrow();
    expect(Object.keys(row).some((k) => /review|flag/.test(k))).toBe(false);
    expect(await openFlagCount(db)).toBeGreaterThanOrEqual(1);
  });

  it('a flag that cannot be written does not abort the transaction around it', async () => {
    // A thread id with no head makes the flag's insert violate a foreign key.
    // Without the savepoint the whole filing transaction would be aborted.
    const a = await file({ account: 'All quiet here, nothing to see at all.' });
    const errors: unknown[] = [];
    const quiet = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const after = await db.transaction().execute(async (trx) => {
        const out = await flagReport(trx, {
          reportId: a.reportId,
          threadId: randomUUID(),
          logbookId: lb.id,
          answers: { account: 'I was threatened.' },
        });
        // The transaction still works after the failed flag.
        const head = await trx
          .selectFrom('report_heads')
          .select('current_report_id')
          .where('thread_id', '=', a.threadId)
          .executeTakeFirstOrThrow();
        return { out, head };
      });
      expect(after.out).toMatchObject({ flagged: false, error: true });
      expect(after.head.current_report_id).toBe(a.reportId);
      // Said out loud: a flag that silently stops firing is the one nobody notices.
      expect(errors.length).toBe(1);
    } finally {
      console.error = quiet;
    }
  });
});
