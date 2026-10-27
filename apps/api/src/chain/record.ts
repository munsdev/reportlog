/**
 * Reading a stored report back into what was sealed.
 *
 * EVERY QUERY THAT REBUILDS A SEALED OBJECT GOES THROUGH `sealedReportRows`,
 * because it is the one place the form join lives. A row read without the
 * join has a `form_id` and no form hash, and `rebuildSealedObject` refuses it
 * rather than quietly rebuilding a different object.
 */
import type { Answers } from '@reportlog/fields';
import type {
  AttachmentEntry,
  LinkFingerprints,
  StoredReportRecord,
  TextFingerprints,
} from '@reportlog/seal';
import type { Kysely, Selectable } from 'kysely';
import type { DB, Reports } from '../db/schema.gen.ts';

export type SealedReportRow = Selectable<Reports> & {
  logbook_slug: string;
  logbook_title: string;
  logbook_form: string | null;
};

/** Reports joined to their logbook and form version. Add `where`s to narrow. */
export function sealedReportRows(db: Kysely<DB>) {
  return db
    .selectFrom('reports as r')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .leftJoin('logbook_forms as lf', 'lf.id', 'r.form_id')
    .selectAll('r')
    .select(['l.slug as logbook_slug', 'l.title as logbook_title', 'lf.form_hash as logbook_form']);
}

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** A row as plain strings, in the shape @reportlog/seal rebuilds from. */
export function toStoredRecord(row: SealedReportRow): StoredReportRecord {
  return {
    public_ref: row.public_ref,
    received_at: iso(row.received_at),
    thread_id: row.thread_id,
    corrects_id: row.corrects_id,
    recipe: row.recipe,
    logbook_slug: row.logbook_slug,
    form_id: row.form_id,
    logbook_form: row.logbook_form,
    answers: row.answers as Answers | null,
    // Written from the sealed object at insert, in its shape (append.ts).
    // `?? null`: read from a database before their migration, the columns
    // are not there at all, and that report held nothing.
    text_fingerprints: (row.text_fingerprints ?? null) as TextFingerprints | null,
    link_fingerprints: (row.link_fingerprints ?? null) as LinkFingerprints | null,
    third_party: row.third_party,
    filed_via: row.filed_via,
    intake_method: row.intake_method,
    attested_at: row.attested_at === null ? null : iso(row.attested_at),
    collected_on: row.collected_on,
    may_publish: row.may_publish,
    may_publish_digest: row.may_publish_digest,
  };
}

/**
 * The attachment manifest a version commits to: ordered, and null rather
 * than [] when there is none, because an empty array seals differently from
 * an absent key. Read THROUGH report_attachments, which is what a version
 * commits to; `attachments.report_id` only names where a file first arrived.
 */
export async function manifestFor(
  db: Kysely<DB>,
  reportId: number,
): Promise<AttachmentEntry[] | null> {
  const rows = await db
    .selectFrom('report_attachments as ra')
    .innerJoin('attachments as a', 'a.id', 'ra.attachment_id')
    .select(['a.ordinal', 'a.sha256', 'a.byte_size', 'a.media_type'])
    .where('ra.report_id', '=', reportId)
    .orderBy('a.ordinal')
    .execute();
  if (!rows.length) return null;
  return rows.map((a) => ({
    ordinal: a.ordinal,
    sha256: a.sha256,
    byte_size: a.byte_size,
    media_type: a.media_type,
  }));
}
