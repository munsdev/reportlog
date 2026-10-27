/**
 * The day every report contact is deleted (D4).
 *
 * NOT THE CREDENTIAL SWEEP (sweep.ts), and never merged into it: that one
 * deletes expired rows from named tables, and `contact_keys` is never among
 * them. This one does a reporter's own erasure for everybody at once, on a
 * date an operator can see and move (filing_settings.contacts_delete_on,
 * default 2027-01-31). Before the date it does nothing. From the date on it
 * runs every night, so an address collected after it is also gone by the
 * next morning.
 *
 * WHAT GOES is what the reporter's own erasure removes (`eraseContact`): the
 * key the address is encrypted under, the digest that links the report to
 * the address, and the confirmation rows of that thread. Plus the address a
 * report still waiting for its link holds in the clear: that report is
 * deleted whole, since without an address its link can never be followed.
 * NOT TOUCHED: the sealed reports, the append-only `report_contacts`
 * ciphertext (unreadable once the key is gone), and permissions already given.
 * A reporter who erased earlier is not touched again.
 */
import { sql } from 'kysely';
import { eraseContact } from '../filing/contactKeys.ts';
import { filingLimits, utcDay } from '../filing/limits.ts';
import type { JobContext, JobOutcome } from './context.ts';

export async function eraseDueContacts(
  db: JobContext['db'],
  now: Date = new Date(),
  /** Tests only: leave every thread and submission not named here alone. */
  only?: { threads: readonly string[]; submissions: readonly number[] },
): Promise<{ due: boolean; erased: number; waiting: number }> {
  const { contacts_delete_on } = await filingLimits(db);
  if (utcDay(now) < contacts_delete_on) return { due: false, erased: 0, waiting: 0 };
  let erased = 0;
  for (;;) {
    const batch = await db
      .selectFrom('contact_keys')
      .select('thread_id')
      .$if(only !== undefined, (q) => q.where('thread_id', 'in', [...(only?.threads ?? [])]))
      .limit(200)
      .execute();
    if (!batch.length) break;
    for (const { thread_id } of batch) {
      await db.transaction().execute(async (trx) => {
        if (await eraseContact(trx, thread_id)) {
          erased += 1;
          await trx
            .insertInto('reporter_actions')
            .values({
              thread_id,
              action: 'erase',
              comment: `Contact details deleted on the date set for all report contacts (${contacts_delete_on}). The report was not withdrawn.`,
            })
            .execute();
        }
      });
    }
  }
  // Held reports: the address is in the clear until the link is used.
  const held = await db
    .selectFrom('report_submissions')
    .select('id')
    .where('confirmed_at', 'is', null)
    .$if(only !== undefined, (q) => q.where('id', 'in', [...(only?.submissions ?? [])]))
    .execute();
  const ids = held.map((r) => r.id);
  let deleted = 0n;
  if (ids.length) {
    // The file pointer first, or the foreign key keeps the submission alive.
    await sql`UPDATE upload_slots SET submission_id = NULL WHERE submission_id IN (${sql.join(ids)})`.execute(
      db,
    );
    deleted = (await db.deleteFrom('report_submissions').where('id', 'in', ids).executeTakeFirst())
      .numDeletedRows;
  }
  const waiting = { numDeletedRows: deleted };
  return { due: true, erased, waiting: Number(waiting.numDeletedRows) };
}

export async function runContactsSweep(ctx: JobContext): Promise<JobOutcome> {
  const r = await eraseDueContacts(ctx.db, ctx.now());
  if (!r.due) return { ok: true, summary: 'The day for deleting report contacts has not come.' };
  ctx.log(`${String(r.erased).padStart(7)}  report contacts deleted`);
  ctx.log(`${String(r.waiting).padStart(7)}  held reports deleted with their addresses`);
  return {
    ok: true,
    summary:
      r.erased || r.waiting
        ? `${String(r.erased)} report contact(s) deleted, ${String(r.waiting)} held report(s) deleted.`
        : 'No report contacts were left.',
  };
}
