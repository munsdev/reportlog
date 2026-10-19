/**
 * Sealing finished files into a version of a report.
 *
 * TWO STEPS, because the manifest goes INTO the sealed object and the rows
 * need the id of the report that sealed it:
 *
 *   1. `manifestFor…` builds the ordered manifest from the files, numbering
 *      on from the thread's highest ordinal;
 *   2. the caller appends the version with that manifest
 *      (appendReportVersion's `attachments`);
 *   3. `promote` writes exactly those files into `attachments`, links exactly
 *      those rows to the new version in `report_attachments`, all in the
 *      caller's transaction, and moves each file's key to attachment_heads.
 *
 * ORDINALS ARE PER THREAD and never reused, so a correction carrying old files
 * and a later version bringing new ones cannot both claim position 2. They
 * start at 1 (the core table's CHECK).
 *
 * THE KEY MOVES. The slot's wrapped key is copied to attachment_heads and
 * wiped from the slot in the same statement's transaction: two copies of a
 * file's key would make destroying one of them a promise rather than a fact.
 * The address digest goes too, so nothing on the slot links a report to an
 * address once the reporter's details are erased.
 */
import type { AttachmentEntry } from '@reportlog/seal';
import { sql } from 'kysely';
import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DB, UploadSlots } from '../db/schema.gen.ts';

type CleanSlot = Selectable<UploadSlots>;

export async function nextOrdinal(db: Kysely<DB>, threadId: string): Promise<number> {
  const row = await db
    .selectFrom('attachments')
    .select(sql<number>`coalesce(max(ordinal), 0) + 1`.as('next'))
    .where('thread_id', '=', threadId)
    .executeTakeFirstOrThrow();
  return row.next;
}

/** The manifest entries for these files, in the one shape the seal takes. */
export function manifestOf(slots: readonly CleanSlot[], ordinalFrom: number): AttachmentEntry[] {
  return slots.map((s, i) => {
    if (!s.sha256 || s.byte_size === null || !s.media_type) {
      throw new Error(`file ${String(s.id)} is not finished and cannot be sealed`);
    }
    return {
      ordinal: ordinalFrom + i,
      sha256: s.sha256,
      byte_size: s.byte_size,
      media_type: s.media_type,
    };
  });
}

/**
 * Write the files a version just sealed. `slots` and `ordinalFrom` must be
 * exactly what `manifestOf` was given.
 */
export async function promote(
  trx: Transaction<DB>,
  input: { slots: readonly CleanSlot[]; ordinalFrom: number; threadId: string; reportId: number },
): Promise<number[]> {
  const ids: number[] = [];
  for (const [i, s] of input.slots.entries()) {
    if (
      !s.sha256 ||
      s.byte_size === null ||
      !s.media_type ||
      !s.storage_key ||
      !s.dek_wrapped ||
      !s.rendition_media_type
    ) {
      throw new Error(`file ${String(s.id)} is not finished and cannot be sealed`);
    }
    const a = await trx
      .insertInto('attachments')
      .values({
        thread_id: input.threadId,
        report_id: input.reportId,
        ordinal: input.ordinalFrom + i,
        media_type: s.media_type,
        byte_size: s.byte_size,
        sha256: s.sha256,
        storage_key: s.storage_key,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Withheld until a moderator says otherwise: in the archive from now on,
    // publishable by nobody yet.
    await trx
      .insertInto('attachment_heads')
      .values({
        attachment_id: a.id,
        thread_id: input.threadId,
        original_name: s.declared_name || null,
        rendition_media_type: s.rendition_media_type,
        duration_seconds: s.duration_seconds,
        has_poster: s.has_poster,
        page_count: s.page_count,
        dek_wrapped: s.dek_wrapped,
        meta_enc: s.meta_enc,
      })
      .execute();
    await trx
      .insertInto('report_attachments')
      .values({ report_id: input.reportId, attachment_id: a.id })
      .execute();
    const moved = await trx
      .updateTable('upload_slots')
      .set({ promoted_at: new Date(), dek_wrapped: null, meta_enc: null, contact_hmac: null })
      .where('id', '=', s.id)
      .where('promoted_at', 'is', null)
      .executeTakeFirst();
    if (moved.numUpdatedRows !== 1n) throw new Error(`file ${String(s.id)} was sealed twice`);
    ids.push(a.id);
  }
  return ids;
}

/** The files a version commits to, as attachment ids, for carrying forward. */
export async function filesOfVersion(db: Kysely<DB>, reportId: number): Promise<number[]> {
  const rows = await db
    .selectFrom('report_attachments as ra')
    .innerJoin('attachments as a', 'a.id', 'ra.attachment_id')
    .select('a.id')
    .where('ra.report_id', '=', reportId)
    .orderBy('a.ordinal')
    .execute();
  return rows.map((r) => r.id);
}
