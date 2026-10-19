/**
 * The hourly and weekly email digests: reports published since each
 * subscriber's last digest, in one email.
 *
 * PEOPLE FOLLOW LOGBOOKS. A subscription names logbook slugs, or none for
 * every logbook.
 *
 * ONLY WHAT THE BOARD WOULD SHOW. A subscriber is a member of the public, so
 * a digest carries exactly what the public board carries and nothing more:
 * approved by a moderator, not withdrawn, and the reporter permitted
 * publication. The old digest once checked only the first two and emailed
 * reports whose reporters had said no. `boardVisible` below is that rule in
 * one place; when the board workstream has its own, this should call it.
 * Files are never in an email: only the answers.
 */
import { placeLabel } from '@reportlog/fields';
import { sql } from 'kysely';
import type { ExpressionBuilder } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { EmailJobDeps, JobOutcome } from './job.ts';

export type DigestFrequency = 'hourly' | 'weekly';

/** How far behind the database's clock a run stops: long enough for any moderation to commit. */
export const SETTLE_MS = 60 * 1000;

const PERIOD_MS: Record<DigestFrequency, number> = {
  hourly: 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * What the public board shows, as a condition on a report's head (`h`) and
 * its current version (`r`). Nothing is public until a moderator approves
 * it; consent is the ceiling.
 *
 * TODO(workstream D): replace with the board's own predicate, including the
 * public-archive switch, once it exists, so the two can never disagree.
 */
export function boardVisible(
  eb: ExpressionBuilder<DB & { h: DB['report_heads']; r: DB['reports'] }, 'h' | 'r'>,
) {
  return eb.and([
    eb('h.moderation_status', '=', 'valid'),
    eb('h.withdrawn', '=', false),
    eb('r.may_publish', '=', true),
  ]);
}

export interface DigestQuestion {
  key: string;
  label: string;
  kind: string;
}

export interface DigestReport {
  public_ref: string;
  logbook_title: string;
  answers: Record<string, unknown> | null;
  questions: readonly DigestQuestion[];
}

/** One sealed answer as a person reads it. */
export function answerText(value: unknown, kind: string): string {
  if (Array.isArray(value)) return value.map((v) => answerText(v, kind)).join(', ');
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (kind === 'location' || kind === 'place') return placeLabel(value);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * One report: its reference, its logbook, and each question it answered in
 * the logbook's order and in the words the reporter read. A key no question
 * names any more is shown under its key rather than dropped.
 */
export function reportText(report: DigestReport): string {
  const answers = report.answers ?? {};
  const named = new Set<string>();
  const lines: string[] = [];
  for (const q of report.questions) {
    if (!(q.key in answers)) continue;
    named.add(q.key);
    lines.push(`  ${q.label}: ${answerText(answers[q.key], q.kind)}`);
  }
  for (const [key, value] of Object.entries(answers)) {
    if (!named.has(key)) lines.push(`  ${key}: ${answerText(value, '')}`);
  }
  return [
    `${report.public_ref}, ${report.logbook_title}`,
    ...(lines.length ? lines : ['  No answers recorded.']),
  ].join('\n');
}

export function digestEmail(
  frequency: DigestFrequency,
  reports: readonly DigestReport[],
  siteOrigin: string,
): { subject: string; text: string } {
  const n = reports.length;
  const count = n === 1 ? 'one new report' : `${String(n)} new reports`;
  const period = frequency === 'hourly' ? 'in the last hour' : 'in the last week';
  return {
    subject: frequency === 'hourly' ? `Hourly update: ${count}` : `Weekly digest: ${count}`,
    text: [
      `${count.charAt(0).toUpperCase()}${count.slice(1)} published ${period}.`,
      '',
      reports.map(reportText).join('\n\n'),
      '',
      `Read them on the board: ${siteOrigin}/board`,
      '',
      `You asked for these emails. To change how often they come, or stop them, sign in and go to ${siteOrigin}/notifications`,
    ].join('\n'),
  };
}

async function questionsFor(deps: EmailJobDeps, logbookIds: readonly number[]) {
  const byLogbook = new Map<number, DigestQuestion[]>();
  if (!logbookIds.length) return byLogbook;
  const rows = await deps.db
    .selectFrom('logbook_fields')
    .select(['logbook_id', 'key', 'label', 'kind'])
    .where('logbook_id', 'in', [...logbookIds])
    .orderBy('position')
    .orderBy('id')
    .execute();
  for (const r of rows) {
    const list = byLogbook.get(r.logbook_id) ?? [];
    list.push({ key: r.key, label: r.label, kind: r.kind });
    byLogbook.set(r.logbook_id, list);
  }
  return byLogbook;
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
      .select(['r.public_ref', 'r.answers', 'r.logbook_id', 'lb.title as logbook_title'])
      .where(boardVisible)
      .where('h.updated_at', '>', since)
      .where('h.updated_at', '<=', until)
      .orderBy('r.received_at')
      .orderBy('r.id');
    if (sub.logbooks) q = q.where('lb.slug', 'in', sub.logbooks);
    const rows = await q.execute();

    if (rows.length) {
      const questions = await questionsFor(deps, [...new Set(rows.map((r) => r.logbook_id))]);
      const reports: DigestReport[] = rows.map((r) => ({
        public_ref: r.public_ref,
        logbook_title: r.logbook_title,
        answers: r.answers as Record<string, unknown> | null,
        questions: questions.get(r.logbook_id) ?? [],
      }));
      try {
        await deps.mailer.send({
          to: sub.email,
          ...digestEmail(deps.frequency, reports, deps.siteOrigin),
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
