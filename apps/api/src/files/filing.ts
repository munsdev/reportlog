/**
 * Files in the filing flow: what C's Send and confirmation call.
 *
 *   Send          `releaseForSubmission` ties the draft's files to the
 *                 submission and releases them to the worker
 *   the link      `stillPreparing` says whether to wait; `sealFiles` gives the
 *                 manifest for appendReportVersion and links exactly those
 *                 rows afterwards, in the same transaction
 *   the answer    `fileOutcome` names which files made it and which did not
 *
 * Confirming is the last moment the manifest can change, so it is the last
 * honest moment to say which files are in the record. A file that did not
 * make it is named with its reason, never quietly dropped.
 */
import type { AttachmentEntry } from '@reportlog/seal';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { manifestOf, nextOrdinal, promote } from './promote.ts';
import {
  clearedSlots,
  draftFrom,
  inFlightSlots,
  releaseDraft,
  slotsOfSubmission,
} from './slots.ts';
import { CONFIRM_WAIT_MS } from './worker.ts';

/** Send: the files staged under this draft now belong to this submission. */
export async function releaseForSubmission(
  db: Kysely<DB>,
  input: { draftToken: unknown; submissionId: number; logbookId: number; expiresAt: Date },
): Promise<number> {
  if (input.draftToken === undefined || input.draftToken === null || input.draftToken === '')
    return 0;
  return releaseDraft(db, {
    draft: draftFrom(input.draftToken),
    submissionId: input.submissionId,
    logbookId: input.logbookId,
    expiresAt: input.expiresAt,
  });
}

/**
 * The names of files still being prepared, if confirming should wait for
 * them. Bounded by when they were RELEASED, not by this click, so somebody
 * who opens the link a day later is not made to wait again; past the bound
 * the report goes ahead and those files are named as not included.
 */
export async function stillPreparing(db: Kysely<DB>, submissionId: number): Promise<string[]> {
  const waiting = await inFlightSlots(db, { submissionId });
  const now = Date.now();
  const within = waiting.filter(
    (s) => !s.released_at || now - s.released_at.getTime() < CONFIRM_WAIT_MS,
  );
  return within.map((s) => s.declared_name || 'a file');
}

export interface SealedFiles {
  /** For appendReportVersion's `attachments`: null when there are none. */
  manifest: AttachmentEntry[] | null;
  /** Write and link exactly the sealed files to the version just appended. */
  link(reportId: number): Promise<void>;
}

/**
 * The finished files of a submission (or an evidence request), with the
 * thread's next ordinals. Call inside the transaction that appends the
 * version, before appending; call `link` right after.
 */
export async function sealFiles(
  trx: Transaction<DB>,
  source: { submissionId: number } | { evidenceRequestId: number },
  threadId: string,
  carried: readonly AttachmentEntry[] = [],
): Promise<SealedFiles & { count: number }> {
  const slots = await clearedSlots(trx, source);
  const from = await nextOrdinal(trx, threadId);
  const fresh = manifestOf(slots, from);
  const all = [...carried, ...fresh];
  return {
    count: slots.length,
    manifest: all.length ? all : null,
    async link(reportId) {
      await promote(trx, { slots, ordinalFrom: from, threadId, reportId });
    },
  };
}

const REASONS: Readonly<Record<string, string>> = {
  pending: 'it had not finished uploading',
  uploaded: 'it was still being prepared',
  processing: 'it was still being prepared',
  clean: 'it was ready too late',
  unreadable: 'it could not be read',
  infected: 'it did not pass the virus check',
};

/** Which files made it into the report, and why any did not. Null when none were sent. */
export async function fileOutcome(
  db: Kysely<DB>,
  submissionId: number,
): Promise<{ attached: number; not_attached: { name: string; reason: string }[] } | null> {
  const slots = await slotsOfSubmission(db, submissionId);
  if (!slots.length) return null;
  return {
    attached: slots.filter((s) => s.promoted_at).length,
    not_attached: slots
      .filter((s) => !s.promoted_at && s.status !== 'withdrawn' && s.status !== 'expired')
      .map((s) => ({
        name: s.declared_name || 'A file',
        reason:
          s.status === 'rejected'
            ? (s.status_detail ?? 'it was not accepted')
            : (REASONS[s.status] ?? s.status),
      })),
  };
}
