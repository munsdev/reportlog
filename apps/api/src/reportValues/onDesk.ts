/**
 * Which report values may reach the journalist desk at all (W4, W5, D2, D7).
 *
 * A value qualifies only while ALL of these hold, read now, on every request,
 * so a change takes a value off the desk the moment it happens:
 *   - its report is the newest version of its thread (a correction replaces
 *     the earlier version's words and links, which drop off with it);
 *   - the thread is not withdrawn (by the reporter or by a moderator);
 *   - a moderator has not declined the report;
 *   - the reporter's `journalist_sharing` permission is granted now (the
 *     newest row of the permission log wins, and no row means no).
 *
 * This is necessary, never sufficient. A text also needs a check that clears
 * it (moderation/texts/clearance.ts); a link needs its group checked
 * (links/reads.ts). Callers add their own joins and selects to the query.
 */
import { sql } from 'kysely';
import type { Db } from '../links/rows.ts';

export function sharedHeldValues(db: Db) {
  return db
    .selectFrom('report_values as rv')
    .innerJoin('report_heads as h', 'h.current_report_id', 'rv.report_id')
    .innerJoin('reports as r', 'r.id', 'rv.report_id')
    .where('h.withdrawn', '=', false)
    .where('h.moderation_status', '<>', 'invalid')
    .where(
      sql<boolean>`COALESCE((SELECT p.granted FROM report_permissions_log p
        WHERE p.thread_id = h.thread_id AND p.permission = 'journalist_sharing'
        ORDER BY p.id DESC LIMIT 1), false)`,
    );
}
