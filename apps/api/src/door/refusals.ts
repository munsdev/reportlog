/**
 * COUNTING REFUSALS, BY CHECK AND HOUR, AND NOTHING ELSE (brief §02 and §05).
 *
 * The moderator screen shows refusals per hour at the door, by check, so a
 * flood is visible as it arrives. What is counted is the name of the check
 * and the hour. Not the content (a refused submission is not stored at all),
 * not the logbook or list, not the minute, not who.
 *
 * MINIMAL ON PURPOSE. Session PE3 builds the flood screen and may replace
 * this module; `countRefusal(db, check)` is the one call every check makes,
 * and `refusalsSince` the one read.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/** Every check the door can refuse on, as it is counted. */
export const REFUSAL_CHECKS = [
  'honeypot',
  'start_missing',
  'too_fast',
  'puzzle_missing',
  'puzzle_wrong',
  'puzzle_expired',
  'puzzle_reused',
  'rate_minute',
  'rate_hour',
  'requests',
  'answers',
] as const;
export type RefusalCheck = (typeof REFUSAL_CHECKS)[number];

const hourOf = (ms: number) => new Date(Math.floor(ms / 3_600_000) * 3_600_000);

/**
 * Count one refusal. Never throws: a counter that could not be written must
 * not turn a refusal into an error, nor leak why through a different answer.
 */
export async function countRefusal(
  db: Kysely<DB>,
  check: RefusalCheck,
  now: number = Date.now(),
): Promise<void> {
  try {
    await db
      .insertInto('door_refusals')
      .values({ hour: hourOf(now), check_id: check, count: 1 })
      .onConflict((oc) =>
        oc.columns(['hour', 'check_id']).doUpdateSet({ count: sql`door_refusals.count + 1` }),
      )
      .execute();
  } catch {
    // See above.
  }
}

/** Refusals per hour and check since a moment, oldest first. */
export async function refusalsSince(
  db: Kysely<DB>,
  since: Date,
): Promise<{ hour: string; check: string; count: number }[]> {
  const rows = await db
    .selectFrom('door_refusals')
    .select(['hour', 'check_id', 'count'])
    .where('hour', '>=', hourOf(since.getTime()))
    .orderBy('hour')
    .orderBy('check_id')
    .execute();
  return rows.map((r) => ({ hour: r.hour.toISOString(), check: r.check_id, count: r.count }));
}
