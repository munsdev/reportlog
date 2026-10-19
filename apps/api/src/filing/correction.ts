/**
 * What every correction does, whoever makes it: a reporter from "My
 * reports" (mine.ts) or the coordinator who filed it (intakeCorrection.ts).
 * One copy, so the two cannot drift apart on the parts that decide what is
 * sealed. What differs, who may and where the act is recorded, stays with
 * each caller.
 *
 * A CORRECTION IS A NEW VERSION, never an edit: appended to the same
 * logbook's chain, in the same thread, pointing at the version it corrects.
 * That version is not touched and still verifies.
 */
import type { FieldDefinition } from '@reportlog/fields';
import type { ReportFields } from '@reportlog/seal';
import type { Selectable, Transaction } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { ensureFormVersion } from '../chain/forms.ts';
import { manifestFor } from '../chain/record.ts';
import type { DB, Reports } from '../db/schema.gen.ts';
import { flagReport } from '../moderation/flags.ts';

/** Take the thread's head. Two corrections at once must not both correct the same version. */
export async function lockHead(trx: Transaction<DB>, threadId: string): Promise<number> {
  const head = await trx
    .selectFrom('report_heads')
    .select('current_report_id')
    .where('thread_id', '=', threadId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return head.current_report_id;
}

export async function appendCorrection(
  trx: Transaction<DB>,
  input: {
    threadId: string;
    /** From lockHead, in this transaction. */
    headId: number;
    logbookId: number;
    /** The logbook's questions the answers were checked against. */
    questions: FieldDefinition[];
    fields: ReportFields;
    publicRefPrefix: string;
  },
): Promise<Selectable<Reports>> {
  const lb = await trx
    .selectFrom('logbooks')
    .select(['id', 'slug', 'launched_at'])
    .where('id', '=', input.logbookId)
    .executeTakeFirstOrThrow();
  const form = await ensureFormVersion(trx, lb, input.questions);

  // THE FILES COME WITH IT. A correction is a new version of the same
  // report, so it commits to the same files, in the same order, read from
  // the archive and never from the request. Without this somebody fixing a
  // typo loses the photographs, and the new version VERIFIES CLEANLY,
  // because its manifest is simply absent.
  const manifest = await manifestFor(trx, input.headId);
  const inherited = await trx
    .selectFrom('report_attachments')
    .select('attachment_id')
    .where('report_id', '=', input.headId)
    .execute();

  const { row } = await appendReportVersion(trx, {
    logbookId: lb.id,
    threadId: input.threadId,
    correctsId: input.headId,
    fields: input.fields,
    attachments: manifest,
    formId: form.id,
    publicRefPrefix: input.publicRefPrefix,
  });
  if (inherited.length) {
    await trx
      .insertInto('report_attachments')
      .values(inherited.map((a) => ({ report_id: row.id, attachment_id: a.attachment_id })))
      .execute();
  }
  // Changed words need a fresh look, even on a report that was approved.
  await trx
    .updateTable('report_heads')
    .set({ current_report_id: row.id, moderation_status: 'pending', updated_at: new Date() })
    .where('thread_id', '=', input.threadId)
    .execute();
  // A correction gets its own look for the review flag: words that were
  // unremarkable before may not be now.
  await flagReport(trx, {
    reportId: row.id,
    threadId: input.threadId,
    logbookId: lb.id,
    answers: row.answers,
  });
  return row;
}
