/**
 * Whether this site is taking new reports at all.
 *
 * THE OTHER END OF THE SITE FROM PUBLISHING, and independent of it: an
 * operator can collect now and decide about publishing later, or shut the
 * window and keep the record readable.
 *
 * NEVER SEALED. A report must not verify differently because the form was
 * closed after it was filed.
 *
 * WHAT CLOSING DOES NOT DO. It does not hide or remove anything filed, does
 * not stop moderation, and does not stop a reporter correcting a report they
 * already filed: a correction amends a record the archive holds, and refusing
 * it would leave the archive knowingly holding a version its author says is
 * wrong. It closes both doors that make NEW reports: the form, and a
 * coordinator's batch.
 *
 * NULL, or no row at all, is OPEN: that is what the software does unless an
 * operator said otherwise.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export async function storedIntakeSwitch(db: Kysely<DB>): Promise<boolean | null> {
  const row = await db
    .selectFrom('intake_settings')
    .select('intake_enabled')
    .where('id', '=', true)
    .executeTakeFirst();
  return row?.intake_enabled ?? null;
}

export async function intakeIsOpen(db: Kysely<DB>): Promise<boolean> {
  return (await storedIntakeSwitch(db)) !== false;
}

export async function setIntakeSwitch(
  db: Kysely<DB>,
  open: boolean | null,
  by: string,
): Promise<void> {
  await db
    .insertInto('intake_settings')
    .values({ id: true, intake_enabled: open, updated_by: by })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({ intake_enabled: open, updated_by: by, updated_at: new Date() }),
    )
    .execute();
}
