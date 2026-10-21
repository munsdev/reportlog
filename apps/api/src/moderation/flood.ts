/**
 * What a moderator needs during a flood, without server access (Plan E, PE3).
 *
 *   SEE IT COMING   submissions per hour for 24 hours (reports and tips),
 *                   refusals per hour by check (refusals.ts), and the answer
 *                   sets more than one report shares.
 *   CLEAN UP FAST   decline what the filter shows with one reason. EACH
 *                   REPORT STILL GETS ITS OWN DECISION ROW, with who and
 *                   when, exactly what a single decline writes, plus the
 *                   bulk action it came in (moderation_bulk_actions). Tip
 *                   links are withheld by time window the same way: one
 *                   check per link group.
 *   THE LANE        each organization's reports, so they can be handled as a
 *                   set (the queue filters by organization; batch approval
 *                   is platformRoutes.ts).
 *
 * A BULK DECLINE SENDS NO EMAIL. A single decline tells the reporter
 * (rejection.ts); a flood's addresses are whatever the flood typed, and a
 * site that mails five thousand of them on one click is a site somebody can
 * use to send mail. The decision rows carry the reason, so the public counts
 * by reason include them (board/counts.ts).
 *
 * NOTHING HERE MAKES ANYTHING PUBLIC. A bulk decline only declines.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { checkGroup } from '../links/checks.ts';
import type { LinkKeys } from '../links/keys.ts';
import { answerSet } from './queue.ts';
import { reasonLabel, requireReasonCode } from './rejection.ts';
import { refusalsSince } from './refusals.ts';

const HOUR = 3_600_000;

/** The start of the hour 23 hours ago: 24 whole buckets, this one included. */
export function screenStart(now = new Date()): Date {
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  return new Date(t.getTime() - 23 * HOUR);
}

export async function floodScreen(db: Kysely<DB>) {
  const since = screenStart();
  // A correction is not a new submission: first versions only.
  const reports = await db
    .selectFrom('reports')
    .select([
      sql<Date>`date_trunc('hour', received_at)`.as('hour'),
      (eb) => eb.fn.countAll<string>().as('n'),
    ])
    .where('received_at', '>=', since)
    .where('corrects_id', 'is', null)
    .groupBy(sql`1`)
    .execute();
  const tips = await db
    .selectFrom('list_entries')
    .select([
      sql<Date>`date_trunc('hour', created_at)`.as('hour'),
      (eb) => eb.fn.countAll<string>().as('n'),
    ])
    .where('created_at', '>=', since)
    .groupBy(sql`1`)
    .execute();
  const at = (rows: { hour: Date; n: string }[], t: number) =>
    Number(rows.find((r) => new Date(r.hour).getTime() === t)?.n ?? 0);
  const hours = Array.from({ length: 24 }, (_, i) => {
    const t = since.getTime() + i * HOUR;
    return { hour: new Date(t).toISOString(), reports: at(reports, t), tips: at(tips, t) };
  });

  const refusals = await refusalsSince(db, since);
  const identical = await db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .select((eb) => [
      answerSet.as('answer_set'),
      'l.slug as logbook_slug',
      eb.fn.countAll<string>().as('reports'),
      eb.fn.countAll<string>().filterWhere('h.moderation_status', '=', 'pending').as('pending'),
      eb.fn.min('r.received_at').as('first_at'),
      eb.fn.max('r.received_at').as('last_at'),
    ])
    .where('r.received_at', '>=', since)
    .where('h.withdrawn', '=', false)
    .groupBy([answerSet, 'l.slug'])
    .having((eb) => eb.fn.countAll(), '>', 1)
    .orderBy(sql`count(*)`, 'desc')
    .limit(20)
    .execute();

  return {
    since: since.toISOString(),
    hours,
    checks: [...new Set(refusals.map((r) => r.check))].sort(),
    refusals,
    identical: identical.map((g) => ({
      answer_set: g.answer_set,
      logbook_slug: g.logbook_slug,
      reports: Number(g.reports),
      pending: Number(g.pending),
      first_at: new Date(g.first_at).toISOString(),
      last_at: new Date(g.last_at).toISOString(),
    })),
  };
}

/**
 * Decline many reports with one reason, in one transaction: every report is
 * declined and logged, or none is. A withdrawn report, or one already
 * declined, is skipped with the reason rather than touched.
 *
 * A bulk decline asks for the second factor again, within 5 minutes
 * (docs/plan-e.md): `stepUpGuard` on its route's scope.
 */
export async function bulkDecline(
  db: Kysely<DB>,
  input: {
    threadIds: readonly string[];
    reasonCode: unknown;
    comment?: string | undefined;
    filter?: Record<string, string> | undefined;
    actor: string;
  },
) {
  const code = requireReasonCode(input.reasonCode);
  const own = input.comment?.trim() ?? '';
  // No sentence of their own: the reason from the list stands as the comment.
  const comment = own === '' ? (reasonLabel(code) ?? code) : own;
  if (comment.length > 2000) {
    throw new HttpError(400, 'reason_too_long', 'Keep the reason under 2000 characters.');
  }
  const ids = [...new Set(input.threadIds)];
  return db.transaction().execute(async (trx) => {
    const heads = await trx
      .selectFrom('report_heads')
      .select(['thread_id', 'current_report_id', 'withdrawn', 'moderation_status'])
      .where('thread_id', 'in', ids)
      .orderBy('thread_id')
      .forUpdate()
      .execute();
    const skipped: { thread_id: string; why: string }[] = [];
    const take: typeof heads = [];
    for (const id of ids) {
      const h = heads.find((x) => x.thread_id === id);
      if (!h) skipped.push({ thread_id: id, why: 'There is no report with that reference.' });
      else if (h.withdrawn) skipped.push({ thread_id: id, why: 'It is withdrawn.' });
      else if (h.moderation_status === 'invalid')
        skipped.push({ thread_id: id, why: 'It is already declined.' });
      else take.push(h);
    }
    const bulk = await trx
      .insertInto('moderation_bulk_actions')
      .values({
        action: 'decline',
        reason_code: code,
        comment,
        filter: JSON.stringify(input.filter ?? {}),
        reached: take.length,
        actor_email: input.actor,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const h of take) {
      await trx
        .updateTable('report_heads')
        .set({ moderation_status: 'invalid', updated_at: new Date() })
        .where('thread_id', '=', h.thread_id)
        .execute();
      // The row a single decline writes, plus the batch it came in.
      await trx
        .insertInto('moderation_log')
        .values({
          thread_id: h.thread_id,
          report_id: h.current_report_id,
          action: 'review',
          new_status: 'invalid',
          actor_email: input.actor,
          comment,
          reason_code: code,
          bulk_id: bulk.id,
        })
        .execute();
    }
    return { bulk_id: bulk.id, declined: take.map((h) => h.thread_id), skipped };
  });
}

/**
 * Withhold every unchecked tip link that arrived in a window. A link group
 * already checked (by anybody, either way) is left as it is: a moderator's
 * considered decision is not overruled by a sweep.
 */
export async function bulkDeclineLinks(
  db: Kysely<DB>,
  keys: LinkKeys,
  input: { from: Date; to: Date; actor: string },
) {
  if (!(input.from < input.to)) {
    throw new HttpError(400, 'invalid_window', 'The window has to start before it ends.');
  }
  const groups = await db
    .selectFrom('link_groups as g')
    .select('g.id')
    .where('g.outcome', 'is', null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('links as k')
          .whereRef('k.group_id', '=', 'g.id')
          .where('k.created_at', '>=', input.from)
          .where('k.created_at', '<=', input.to),
      ),
    )
    .orderBy('g.id')
    .execute();
  const bulk = await db
    .insertInto('moderation_bulk_actions')
    .values({
      action: 'decline_links',
      comment: 'Tip links withheld by time window.',
      filter: JSON.stringify({ from: input.from.toISOString(), to: input.to.toISOString() }),
      reached: groups.length,
      actor_email: input.actor,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  let withheld = 0;
  for (const g of groups) {
    // Each group's own check row, with who and when (links/checks.ts).
    await checkGroup(db, keys, g.id, { outcome: 'withheld', actor: input.actor });
    withheld += 1;
  }
  return { bulk_id: bulk.id, withheld };
}

/** Each organization with reports filed for it, and how many wait. */
export async function organizationLane(db: Kysely<DB>) {
  const rows = await db
    .selectFrom('intake_drafts as d')
    .innerJoin('intake_batches as b', 'b.id', 'd.batch_id')
    .innerJoin('organizations as o', 'o.id', 'b.organization_id')
    .innerJoin('reports as v', 'v.id', 'd.report_id')
    .innerJoin('report_heads as h', 'h.thread_id', 'v.thread_id')
    .select((eb) => [
      'o.id',
      'o.name',
      eb.fn.count<string>('h.thread_id').distinct().as('reports'),
      eb.fn
        .count<string>('h.thread_id')
        .distinct()
        .filterWhere('h.moderation_status', '=', 'pending')
        .filterWhere('h.withdrawn', '=', false)
        .as('pending'),
    ])
    .groupBy(['o.id', 'o.name'])
    .orderBy('o.name')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    reports: Number(r.reports),
    pending: Number(r.pending),
  }));
}
