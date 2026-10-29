/**
 * What the moderation and board tests share: filing a thread the way filing
 * does (append, then `startThread`, which reads the words for the review
 * flag in the same transaction), correcting it, and a moderator's session.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { buildAnswers } from '@reportlog/fields';
import { normalizeReportFields } from '@reportlog/seal';
import type { ReportSubmission } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.ts';
import { appendReportVersion } from '../../src/chain/append.ts';
import type { Database } from '../../src/db/database.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { startThread } from '../../src/filing/filing.ts';
import { flagReport } from '../../src/moderation/flags.ts';
import { seenToken } from '../../src/moderation/queue.ts';
import { CONTACT_KEY } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { GENERAL_DIGEST, testDatabase } from './helpers.ts';
import { SITE, address, as, seat, signIn } from './identity-helpers.ts';

export interface Thread {
  threadId: string;
  reportId: number;
  publicRef: string;
  answers: unknown;
}

export async function fileThread(
  db: Database,
  lb: { id: number; slug: string },
  questions: readonly FieldDefinition[],
  body: Record<string, unknown>,
  submission: Partial<ReportSubmission> = {},
): Promise<Thread> {
  const { answers, errors } = buildAnswers(questions, body);
  if (errors.length) throw new Error(errors.join('; '));
  const threadId = randomUUID();
  return db.transaction().execute(async (trx) => {
    const { row } = await appendReportVersion(trx, {
      logbookId: lb.id,
      threadId,
      fields: normalizeReportFields({
        logbook: lb.slug,
        answers,
        may_publish: true,
        may_publish_digest: GENERAL_DIGEST,
        ...submission,
      }),
      publicRefPrefix: 'RL-',
    });
    await startThread(trx, threadId, row);
    return { threadId, reportId: row.id, publicRef: row.public_ref, answers: row.answers };
  });
}

/** A correction as "My reports" makes one: new version, head moved, back to pending, flagged afresh. */
export async function correctThread(
  db: Database,
  lb: { id: number; slug: string },
  questions: readonly FieldDefinition[],
  thread: Thread,
  body: Record<string, unknown>,
) {
  const { answers } = buildAnswers(questions, body);
  return db.transaction().execute(async (trx) => {
    const { row } = await appendReportVersion(trx, {
      logbookId: lb.id,
      threadId: thread.threadId,
      correctsId: thread.reportId,
      fields: normalizeReportFields({
        logbook: lb.slug,
        answers,
        may_publish: true,
        may_publish_digest: GENERAL_DIGEST,
      }),
      publicRefPrefix: 'RL-',
    });
    await trx
      .updateTable('report_heads')
      .set({ current_report_id: row.id, moderation_status: 'pending' })
      .where('thread_id', '=', thread.threadId)
      .execute();
    const flag = await flagReport(trx, {
      reportId: row.id,
      threadId: thread.threadId,
      logbookId: lb.id,
      answers: row.answers,
    });
    return { reportId: row.id, publicRef: row.public_ref, flag };
  });
}

/** Approve directly, as a fixture (the route is tested on its own). */
export async function approve(db: Database, threadId: string): Promise<void> {
  await db
    .updateTable('report_heads')
    .set({ moderation_status: 'valid' })
    .where('thread_id', '=', threadId)
    .execute();
}

/** Put the shared settings row back as a fresh install has it: archive on, downloads off. */
export async function resetModerationSettings(db: Database): Promise<void> {
  await db
    .updateTable('moderation_settings')
    .set({ public_archive_enabled: null, distribution_enabled: null, review_keywords: null })
    .where('id', '=', true)
    .execute();
}

// ── an app, and people signed in to it ──────────────────────────────────

/** An app that can take reports and open contact details, with counts never cached. */
export async function moderationHarness(db: Database = testDatabase()): Promise<FilingHarness> {
  const mailer = capturingMailer();
  const logs: string[] = [];
  const app = await buildApp({
    config: { LOG_LEVEL: 'info', SITE_ORIGIN: SITE, CONTACT_KEY },
    db,
    mailer,
    logStream: { write: (line) => logs.push(line) },
    statsTtlMs: 0,
  });
  return {
    db,
    app,
    mailer,
    logs,
    async close() {
      await app.close();
      await db.destroy();
    },
  };
}

/** Seat somebody in a role and sign them in; returns a caller with their session. */
export async function staff(h: FilingHarness, stem: string, role: string) {
  const email = address(stem);
  await seat(h.db, email, role);
  const session = await signIn(h, email);
  return { email, call: as(h, session) };
}

/**
 * A report's `seen` as the queue would hand it out: what every moderator act
 * sends back, so it is refused if the report moved since (queue.ts).
 */
export async function seenOf(db: Database, threadId: string): Promise<string> {
  const row = await db
    .selectFrom('report_heads as h')
    .select(seenToken.as('seen'))
    .where('h.thread_id', '=', threadId)
    .executeTakeFirstOrThrow();
  return row.seen;
}

/** `seenOf` for each, as the queue's batch and bulk calls send it. */
export async function seenMap(
  db: Database,
  threadIds: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of threadIds) out[id] = await seenOf(db, id);
  return out;
}
