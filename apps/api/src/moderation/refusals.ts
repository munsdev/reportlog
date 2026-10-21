/**
 * Refusals at the door, counted per hour by check (Plan E, PE3, for PE2).
 *
 * THE WHOLE INTERFACE IS `countRefusal(db, check)`: the door's checks
 * (session PE2: proof of work, honeypot, minimum time, rate limit, date
 * limits, unknown fields) call it with the name of the check that refused,
 * and nothing else is written. No content, no address, no hash of one, no
 * request id, and no time finer than the hour, so the table cannot become a
 * record of who tried. The moderator's flood screen reads it back.
 *
 * A LEAF MODULE, so filing/ and lists/ may both call it.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/** A check's name: lower case, as the table's CHECK constraint says. */
const CHECK_NAME = /^[a-z][a-z_]{1,39}$/;

/**
 * One more refusal by `check`, this hour. Never throws for a bad name:
 * counting must not become a way for a refusal to fail differently. A name
 * the table would refuse is counted as `other`.
 */
export async function countRefusal(db: Kysely<DB>, check: string): Promise<void> {
  const name = CHECK_NAME.test(check) ? check : 'other';
  await db
    .insertInto('intake_refusal_counts')
    .values({ hour: sql<Date>`date_trunc('hour', now())`, check_name: name, refusals: 1 })
    .onConflict((oc) =>
      oc
        .columns(['hour', 'check_name'])
        .doUpdateSet({ refusals: sql<number>`intake_refusal_counts.refusals + 1` }),
    )
    .execute();
}

/** Every hour from `since` with a refusal, by check. */
export async function refusalsSince(db: Kysely<DB>, since: Date) {
  const rows = await db
    .selectFrom('intake_refusal_counts')
    .select(['hour', 'check_name', 'refusals'])
    .where('hour', '>=', since)
    .orderBy('hour')
    .orderBy('check_name')
    .execute();
  return rows.map((r) => ({
    hour: r.hour.toISOString(),
    check: r.check_name,
    refusals: r.refusals,
  }));
}
