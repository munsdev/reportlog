/**
 * Who has a report open right now (migration 20261028182027_report_viewers).
 *
 * PRESENCE, NOT A RECORD. A row says a person's page is open on a report and
 * still sending its heartbeat; it goes when the page closes, and one whose
 * heartbeat stopped (a closed laptop, a lost connection) is swept by the next
 * heartbeat from anybody. Nothing here is kept, and nothing reads it as a
 * history of who read what.
 *
 * ADVISORY ONLY. Two moderators can still open one report in the same
 * second. What stops the second decision overwriting the first is `seen`,
 * checked under the row lock in queue.ts.
 */
import { VIEWING_WINDOW_MS } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { notFound } from '../http/errors.ts';
import { seenToken } from './queue.ts';

/** Rows older than this are nobody's: twice the window, so a late heartbeat is not swept. */
const SWEEP_MS = VIEWING_WINDOW_MS * 2;

const since = (ms: number) => sql<Date>`now() - ${`${String(ms)} milliseconds`}::interval`;

/**
 * This person has the report open. Answers with the others who do, and the
 * report's `seen` now, so the page can say it changed without reloading it.
 */
export async function markViewing(db: Kysely<DB>, threadId: string, userId: number) {
  const head = await db
    .selectFrom('report_heads as h')
    .select(seenToken.as('seen'))
    .where('h.thread_id', '=', threadId)
    .executeTakeFirst();
  if (!head) throw notFound('There is no report with that reference.');
  await db.deleteFrom('report_viewers').where('seen_at', '<', since(SWEEP_MS)).execute();
  await db
    .insertInto('report_viewers')
    .values({ thread_id: threadId, user_id: userId })
    .onConflict((oc) => oc.columns(['thread_id', 'user_id']).doUpdateSet({ seen_at: sql`now()` }))
    .execute();
  const others = await viewers(db, userId)
    .where('v.thread_id', '=', threadId)
    .select('u.email')
    .execute();
  return { others: others.map((o) => ({ email: o.email })), seen: head.seen };
}

export async function stopViewing(db: Kysely<DB>, threadId: string, userId: number) {
  await db
    .deleteFrom('report_viewers')
    .where('thread_id', '=', threadId)
    .where('user_id', '=', userId)
    .execute();
}

/** Every report somebody other than this person has open, for the queue's badges. */
export async function othersViewing(db: Kysely<DB>, userId: number) {
  return viewers(db, userId)
    .select(['v.thread_id', 'u.email'])
    .orderBy('v.thread_id')
    .orderBy('u.email')
    .execute();
}

function viewers(db: Kysely<DB>, userId: number) {
  return db
    .selectFrom('report_viewers as v')
    .innerJoin('users as u', 'u.id', 'v.user_id')
    .where('v.user_id', '!=', userId)
    .where('v.seen_at', '>=', since(VIEWING_WINDOW_MS));
}
