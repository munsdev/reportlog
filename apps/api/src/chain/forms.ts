/**
 * Versions of a logbook's form: the exact text each report was answered
 * against. The pure half (what a definition is, how it hashes) is
 * `formText` in @reportlog/seal.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { formText } from '@reportlog/seal';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/**
 * The version row for a question set, written if it is new.
 *
 * Takes the questions the caller already read and checked answers against,
 * not a fresh read, so the version sealed is the one the answers were checked
 * against even if a question was added a moment later. Idempotent: the
 * unique key on (logbook, hash) makes two callers land on one row.
 *
 * Only a launched logbook has versions.
 */
export async function ensureFormVersion(
  db: Kysely<DB>,
  logbook: { id: number; slug: string; launched_at: Date | string | null },
  questions: readonly FieldDefinition[],
): Promise<{ id: number; hash: string }> {
  if (!logbook.launched_at) {
    throw new Error('ensureFormVersion: only a launched logbook has a form version');
  }
  const { definition, hash } = formText(logbook.slug, questions);
  await db
    .insertInto('logbook_forms')
    .values({ logbook_id: logbook.id, form_hash: hash, definition })
    .onConflict((oc) => oc.columns(['logbook_id', 'form_hash']).doNothing())
    .execute();
  const row = await db
    .selectFrom('logbook_forms')
    .select(['id', 'form_hash'])
    .where('logbook_id', '=', logbook.id)
    .where('form_hash', '=', hash)
    .executeTakeFirstOrThrow();
  return { id: row.id, hash: row.form_hash };
}

/** Every version of a logbook's form, oldest first. */
export async function formVersions(
  db: Kysely<DB>,
  logbookId: number,
): Promise<{ hash: string; definition: string }[]> {
  const rows = await db
    .selectFrom('logbook_forms')
    .select(['form_hash', 'definition'])
    .where('logbook_id', '=', logbookId)
    .orderBy('id')
    .execute();
  return rows.map((r) => ({ hash: r.form_hash, definition: r.definition }));
}
