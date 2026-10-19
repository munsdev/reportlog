/**
 * The weekly feedback digest: every open issue, the longest-untouched first,
 * to the administrator's address. With no outside tracker nothing else nags
 * about issues that were filed and then quietly forgotten, so this is the
 * backstop.
 *
 * Ordered by when the status last changed, not when the issue was filed: one
 * filed months ago and moved yesterday is not the one at risk.
 */
import { OPEN_FEEDBACK_STATUSES } from '@reportlog/contracts';
import { sql } from 'kysely';
import type { EmailJobDeps, JobOutcome } from '../site/job.ts';
import { staleDigestEmail } from './emails.ts';

/** Untouched this long, an issue is called out as stale. */
export const STALE_DAYS = 7;

export async function runFeedbackDigest(
  deps: EmailJobDeps & { adminEmail: string | undefined; staleDays?: number },
): Promise<JobOutcome> {
  const staleDays = deps.staleDays ?? STALE_DAYS;
  if (!deps.adminEmail) {
    // Not a failure: a deployment may choose not to have one. Said, so an
    // operator who expected the email knows why it never came.
    return { ok: true, summary: 'No ADMIN_EMAIL is set, so there is nobody to send it to.' };
  }
  const now = (deps.now ?? (() => new Date()))();
  const rows = await deps.db
    .selectFrom('feedback as f')
    .innerJoin('users as u', 'u.id', 'f.submitter_id')
    .select([
      'f.id',
      'f.type',
      'f.severity',
      'f.title',
      'f.status',
      'u.email as submitter_email',
      sql<number>`floor(extract(epoch FROM ${now}::timestamptz - f.status_changed_at) / 86400)::int`.as(
        'days_untouched',
      ),
    ])
    .where('f.status', 'in', [...OPEN_FEEDBACK_STATUSES])
    .orderBy('f.status_changed_at', 'asc')
    .orderBy('f.id', 'asc')
    .execute();
  if (!rows.length) return { ok: true, summary: 'No open feedback, so nothing was sent.' };
  const email = staleDigestEmail(rows, staleDays, deps.siteOrigin);
  await deps.mailer.send({ to: deps.adminEmail, ...email });
  const stale = rows.filter((r) => r.days_untouched >= staleDays).length;
  return {
    ok: true,
    summary: `Sent: ${String(rows.length)} open issue(s), ${String(stale)} stale.`,
  };
}
