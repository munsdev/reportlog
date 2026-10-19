/**
 * Which upload calls pass the site password. Read only by FILING_CALLS in
 * apps/api/src/identity/doors.ts, which is the one place that decides.
 *
 * Attaching files is part of filing, so the upload calls pass where filing
 * does: for a launched logbook an administrator opened outside (`link` or
 * `door`), and only while such a logbook ASKS FOR FILES (has an upload
 * question). As legacy conditioned them. A call that names its logbook (the
 * config, a new slot) passes for that logbook only; the rest carry a free
 * draft token and no logbook, so they pass while any such logbook exists.
 *
 * Like every door, this only says "the password is not the reason to
 * refuse": each route still applies every rule it applies to anybody.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

async function outsideTakingFiles(db: Kysely<DB>, slug?: string): Promise<boolean> {
  let q = db
    .selectFrom('logbooks as l')
    .select('l.id')
    .where('l.launched_at', 'is not', null)
    .where('l.outside_access', 'in', ['link', 'door'])
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('logbook_fields as f')
          .select(sql`1`.as('one'))
          .whereRef('f.logbook_id', '=', 'l.id')
          .where('f.kind', '=', 'file'),
      ),
    );
  if (slug !== undefined) q = q.where('l.slug', '=', slug);
  return (await q.limit(1).execute()).length > 0;
}

/** A call naming no logbook: passes while any logbook open outside takes files. */
export const anyTakesFilesOutside = (db: Kysely<DB>) => outsideTakingFiles(db);

/** A call naming its logbook: passes for that logbook only. */
export function namedTakesFilesOutside(db: Kysely<DB>, slug: unknown): Promise<boolean> {
  if (typeof slug !== 'string' || !slug) return Promise.resolve(false);
  return outsideTakingFiles(db, slug.trim());
}
