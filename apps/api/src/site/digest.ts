/**
 * The hourly and weekly email digests: reports published since each
 * subscriber's last digest, in one email.
 *
 * PEOPLE FOLLOW LOGBOOKS. A subscription names logbook slugs, or none for
 * every logbook.
 *
 * ONLY WHAT THE BOARD WOULD SHOW. A subscriber is a member of the public, so
 * a digest counts exactly what the public board shows and nothing more:
 * approved by a moderator, not withdrawn, and the reporter permitted
 * publication. The old digest once checked only the first two and emailed
 * reports whose reporters had said no. The rule is the board's own
 * (`listedReportIds` in board/published.ts, so a counts-only logbook sends
 * none), and a site whose archive is
 * switched off sends no digest at all.
 * Counts only: no report, reference or answer is ever in an email.
 */
import { NOT_A_SAMPLE } from '@reportlog/contracts';
import { sql } from 'kysely';
import { publicArchiveAvailable } from '../board/publication.ts';
import { listedReportIds } from '../board/published.ts';
import { stopLinkFor } from '../identity/digestStop.ts';
import type { EmailJobDeps, JobOutcome } from './job.ts';

export type DigestFrequency = 'hourly' | 'weekly';

/** How far behind the database's clock a run stops: long enough for any moderation to commit. */
export const SETTLE_MS = 60 * 1000;

const PERIOD_MS: Record<DigestFrequency, number> = {
  hourly: 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** How many reports a logbook had published in the period. */
export interface DigestCount {
  logbook_title: string;
  count: number;
}

const reportsWord = (n: number) => (n === 1 ? 'one new report' : `${String(n)} new reports`);

/**
 * COUNTS ONLY, never a report (owner, 2026-10-24). The email tells a follower
 * that there is something to look at on the board; it does not deliver the
 * archive. Its length is bounded by the logbooks followed, never by how many
 * reports arrived, so a flood (or a spam run that a moderator approved in
 * bulk) cannot make it long.
 */
export function digestEmail(
  frequency: DigestFrequency,
  counts: readonly DigestCount[],
  siteOrigin: string,
  /** This email's own link that stops these emails without signing in (identity/digestStop.ts). */
  stopLink: string,
): { subject: string; text: string } {
  const n = counts.reduce((sum, c) => sum + c.count, 0);
  const count = reportsWord(n);
  const period = frequency === 'hourly' ? 'in the last hour' : 'in the last week';
  return {
    subject: frequency === 'hourly' ? `Hourly update: ${count}` : `Weekly digest: ${count}`,
    text: [
      `${count.charAt(0).toUpperCase()}${count.slice(1)} published ${period}:`,
      ...counts.map((c) => `${c.logbook_title}: ${String(c.count)}`),
      '',
      // A count appears in the subject and the first line: the line goes with it.
      NOT_A_SAMPLE,
      '',
      `Read them on the board: ${siteOrigin}/board`,
      '',
      `You asked for these emails. To stop them, open this link (you do not need to sign in): ${stopLink}`,
      '',
      `To change how often they come, or which logbooks they are about, sign in and go to ${siteOrigin}/notifications`,
    ].join('\n'),
  };
}

/**
 * Send one round of digests. A subscriber with nothing new gets no email,
 * and their clock still moves, so the next email starts where this one
 * would have.
 *
 * A failed send is counted and the subscriber's clock is NOT moved, so the
 * next run tries the same reports again.
 */
export async function runDigest(
  deps: EmailJobDeps & { frequency: DigestFrequency },
): Promise<JobOutcome> {
  // A digest is the archive leaving the building. With the public archive
  // switched off nothing is sent, and no subscriber's clock moves, so what
  // was approved meanwhile is sent once the archive is back.
  if (!(await publicArchiveAvailable(deps.db))) {
    return {
      ok: true,
      summary: `${deps.frequency} digest: the public archive is switched off, so nothing was sent.`,
    };
  }
  // The database's clock, not this process's: `updated_at` was written by
  // it. And a minute behind it: a moderation still committing when this
  // runs carries a time from before it, and would otherwise fall behind the
  // clock this run moves forward and never be sent.
  const now = deps.now
    ? deps.now()
    : ((await sql<{ now: Date }>`SELECT now() AS now`.execute(deps.db)).rows[0]?.now ?? new Date());
  const until = new Date(now.getTime() - SETTLE_MS);
  const subscribers = await deps.db
    .selectFrom('digest_subscriptions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.user_id', 'u.email', 's.logbooks', 's.last_sent_at'])
    .where('s.frequency', '=', deps.frequency)
    .orderBy('s.user_id')
    .execute();

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const since = sub.last_sent_at ?? new Date(until.getTime() - PERIOD_MS[deps.frequency]);
    let q = deps.db
      .selectFrom('report_heads as h')
      .innerJoin('reports as r', 'r.id', 'h.current_report_id')
      .innerJoin('logbooks as lb', 'lb.id', 'r.logbook_id')
      .select((eb) => ['lb.title as logbook_title', eb.fn.countAll<string>().as('count')])
      .where('r.id', 'in', listedReportIds(deps.db))
      .where('h.updated_at', '>', since)
      .where('h.updated_at', '<=', until)
      // New reports only: a correction moves its thread's head too, and
      // would otherwise be counted again as new.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('reports as earlier')
              .whereRef('earlier.thread_id', '=', 'r.thread_id')
              .whereRef('earlier.id', '<', 'r.id'),
          ),
        ),
      )
      .groupBy(['lb.id', 'lb.title'])
      .orderBy('lb.title');
    if (sub.logbooks) q = q.where('lb.slug', 'in', sub.logbooks);
    const rows = await q.execute();

    if (rows.length) {
      const counts: DigestCount[] = rows.map((r) => ({
        logbook_title: r.logbook_title,
        count: Number(r.count),
      }));
      try {
        const stopLink = await stopLinkFor(deps.db, sub.user_id, deps.siteOrigin);
        await deps.mailer.send({
          to: sub.email,
          ...digestEmail(deps.frequency, counts, deps.siteOrigin, stopLink),
        });
        sent += 1;
      } catch {
        failed += 1;
        continue;
      }
    }
    await deps.db
      .updateTable('digest_subscriptions')
      .set({ last_sent_at: until })
      // Never backwards, whatever the clocks say: that would send again.
      .where((eb) => eb.or([eb('last_sent_at', 'is', null), eb('last_sent_at', '<', until)]))
      .where('user_id', '=', sub.user_id)
      .execute();
  }
  const summary =
    `${deps.frequency} digest: ${String(subscribers.length)} subscriber(s), ` +
    `${String(sent)} email(s) sent` +
    (failed ? `, ${String(failed)} could not be sent and will be tried again next time.` : '.');
  return { ok: failed === 0, summary };
}
