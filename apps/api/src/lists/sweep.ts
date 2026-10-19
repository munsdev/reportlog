/**
 * THE LIST SWEEP: ERASING COLUMNS, NOT DELETING ROWS.
 *
 * There are two sweeps and they do different things. The credentials sweep
 * (operations workstream) DELETEs whole rows from a named list of tables of
 * expired credentials. This one UPDATEs, and the row is meant to survive it:
 * the links stay, the words and the contact details go. A list table must
 * never be added to the other one. Neither finds its tables by scanning for a
 * column, so a new table is never swept by accident.
 *
 * ERASING A COLUMN DOES NOT TAKE ITS WORDS OUT OF THE TEXT INDEX: GIN keeps
 * every key it ever held until it is rebuilt. So the last step rebuilds it,
 * after the erasing, whenever anything was erased lately.
 *
 * NOTHING HERE TOUCHES link_index or list_entry_links. They hold no text and
 * no submitter, so there is nobody in them to erase.
 *
 * Each step reports rather than throws: this runs on a timer, and a failure to
 * tidy one thing must never stop the rest.
 */
import { sql } from 'kysely';
import { blanks } from './erasure.ts';
import type { Db } from './rows.ts';
import { forgetCachedSalts } from './salt.ts';
import { INDEX_NAME, rebuildTextIndex } from './search.ts';

type Outcome = number | { error: string };

const failed = (e: unknown): { error: string } => ({
  error: e instanceof Error ? e.message : String(e),
});

/**
 * Erase the erasable half of every entry whose time has come. NULL
 * `personal_expires_at` means kept, and is skipped: an entry kept indefinitely
 * is erased by its holder through the link, never by the clock.
 */
export async function sweepPersonal(db: Db): Promise<{ list_entries: Outcome }> {
  try {
    const out = await db
      .updateTable('list_entries')
      .set({ ...blanks(), erased_at: sql<Date>`now()` })
      .where('erased_at', 'is', null)
      .where('personal_expires_at', 'is not', null)
      .where('personal_expires_at', '<', sql<Date>`now()`)
      .executeTakeFirst();
    return { list_entries: Number(out.numUpdatedRows) };
  } catch (e) {
    return { list_entries: failed(e) };
  }
}

/**
 * Destroy expired hashing secrets. THIS IS THE STEP THAT MAKES THE HASHES
 * ONE-WAY: until a day's secret is gone, somebody holding the database can
 * enumerate the IPv4 space against it. Today's secret is never a candidate.
 */
export async function sweepSalts(db: Db, saltDays: number): Promise<{ list_salts: Outcome }> {
  try {
    const out = await db
      .deleteFrom('list_salts')
      .where('day', '<', sql<string>`current_date - ${Math.max(1, Math.floor(saltDays))}::int`)
      .executeTakeFirst();
    forgetCachedSalts();
    return { list_salts: Number(out.numDeletedRows) };
  } catch (e) {
    return { list_salts: failed(e) };
  }
}

/**
 * Spent and expired links: erasure links, and the links that confirm who
 * receives a list's entries. Short-lived credentials, done here anyway so
 * everything with a list's lifetime is in one place.
 */
export async function sweepListTokens(
  db: Db,
): Promise<{ list_erasures: Outcome; list_notify_confirmations: Outcome }> {
  let erasures: Outcome;
  let confirmations: Outcome;
  try {
    const out = await db
      .deleteFrom('list_erasures')
      .where((eb) =>
        eb.or([eb('expires_at', '<', sql<Date>`now()`), eb('used_at', 'is not', null)]),
      )
      .executeTakeFirst();
    erasures = Number(out.numDeletedRows);
  } catch (e) {
    erasures = failed(e);
  }
  try {
    const out = await db
      .deleteFrom('list_notify_confirmations')
      .where((eb) =>
        eb.or([eb('expires_at', '<', sql<Date>`now()`), eb('used_at', 'is not', null)]),
      )
      .executeTakeFirst();
    confirmations = Number(out.numDeletedRows);
  } catch (e) {
    confirmations = failed(e);
  }
  return { list_erasures: erasures, list_notify_confirmations: confirmations };
}

/**
 * Take erased words out of the text index (`rebuildTextIndex`). After
 * `sweepPersonal`, so what it just erased goes too.
 */
export async function sweepTextIndex(db: Db): Promise<Record<typeof INDEX_NAME, Outcome>> {
  try {
    return { [INDEX_NAME]: await rebuildTextIndex(db) };
  } catch (e) {
    return { [INDEX_NAME]: failed(e) };
  }
}

/** Everything, for the timer. */
export async function sweepLists(db: Db, { saltDays }: { saltDays: number }) {
  return {
    ...(await sweepPersonal(db)),
    ...(await sweepSalts(db, saltDays)),
    ...(await sweepListTokens(db)),
    ...(await sweepTextIndex(db)),
  };
}
