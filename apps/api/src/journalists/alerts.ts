/**
 * The journalist alert: an email per subscriber saying there are new approved
 * reports in the states they cover.
 *
 * COUNTS ONLY. The email carries a number per state and nothing else: no
 * reference, no logbook, no answers, no link to a report or to the board, and
 * nothing about tips. The one link it holds is the one that takes the
 * address off the list. A journalist who wants the reports reads the public
 * board like anybody else.
 *
 * ONLY WHAT THE BOARD SHOWS. The reports counted are exactly the published
 * ones (`publishedReportIds`, board/published.ts), and a site whose public
 * archive is switched off sends nothing.
 *
 * WHERE A REPORT IS. A report is in a state when an answer to one of its
 * logbook's location questions is that state's code. Counted once per state.
 *
 * WINDOWS follow the digests' (site/digest.ts): the database's clock, a
 * minute behind it, and a subscriber's clock moves only when their send
 * worked, and never backwards. A new subscriber's first window starts when
 * they confirmed.
 */
import { placeLabel } from '@reportlog/fields';
import { sql } from 'kysely';
import { publicArchiveAvailable } from '../board/publication.ts';
import { publishedReportIds } from '../board/published.ts';
import { openWithDek, keyringFrom } from '../filing/contactKeys.ts';
import type { EmailJobDeps, JobOutcome } from '../site/job.ts';
import { SETTLE_MS } from '../site/digest.ts';
import { dekOf, issueLink, stopLinkFor } from './list.ts';

export interface AlertCount {
  state: string;
  n: number;
}

export function alertEmail(
  counts: readonly AlertCount[],
  stopLink: string,
): { subject: string; text: string } {
  const total = counts.reduce((sum, c) => sum + c.n, 0);
  const reports = (n: number) =>
    n === 1 ? '1 new approved report' : `${String(n)} new approved reports`;
  return {
    subject: `${reports(total)} in the states you cover`,
    text: [
      'There are new approved reports in the states you cover:',
      '',
      ...counts.map((c) => `  ${placeLabel(c.state)}: ${String(c.n)}`),
      '',
      'This alert says how many, and nothing more.',
      '',
      `You asked for these alerts by joining the journalist alert list. To leave it, open this link (you do not need to sign in): ${stopLink}`,
    ].join('\n'),
  };
}

export async function runJournalistAlerts(
  deps: EmailJobDeps & { contactKey: string | undefined; previousContactKey?: string | undefined },
): Promise<JobOutcome> {
  if (!(await publicArchiveAvailable(deps.db))) {
    return {
      ok: true,
      summary: 'journalist alerts: the public archive is switched off, so nothing was sent.',
    };
  }
  const now = deps.now
    ? deps.now()
    : ((await sql<{ now: Date }>`SELECT now() AS now`.execute(deps.db)).rows[0]?.now ?? new Date());
  const until = new Date(now.getTime() - SETTLE_MS);
  // Unconfirmed signups whose link has run out are not kept.
  await deps.db
    .deleteFrom('journalist_subscribers')
    .where('status', '=', 'pending')
    .where('created_at', '<', new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000))
    .execute();
  await deps.db.deleteFrom('journalist_links').where('expires_at', '<', now).execute();

  const subscribers = await deps.db
    .selectFrom('journalist_subscribers')
    .select(['id', 'states', 'last_sent_at', 'dek_wrapped', 'email_enc'])
    .where('status', '=', 'active')
    .orderBy('id')
    .execute();
  if (!subscribers.length)
    return { ok: true, summary: 'journalist alerts: nobody is on the list.' };
  if (!deps.contactKey) {
    return {
      ok: false,
      summary: 'journalist alerts: CONTACT_KEY is not set, so no address can be opened.',
    };
  }
  const ring = keyringFrom(deps.contactKey, deps.previousContactKey);

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const since = sub.last_sent_at ?? until;
    const rows = await deps.db
      .selectFrom('report_heads as h')
      .innerJoin('reports as r', 'r.id', 'h.current_report_id')
      .innerJoin('logbook_fields as f', (j) =>
        j.onRef('f.logbook_id', '=', 'r.logbook_id').on('f.kind', '=', 'location'),
      )
      .select([
        sql<string>`r.answers ->> f.key`.as('place'),
        sql<string>`count(distinct r.id)`.as('n'),
      ])
      .where('r.id', 'in', publishedReportIds(deps.db))
      .where('h.updated_at', '>', since)
      .where('h.updated_at', '<=', until)
      .where(sql<boolean>`(r.answers ->> f.key) = any(${sub.states}::text[])`)
      .groupBy('place')
      .orderBy('place')
      .execute();

    if (rows.length) {
      try {
        const token = await issueLink(deps.db, sub.id, 'stop');
        const to = openWithDek(dekOf(ring, sub.dek_wrapped), sub.email_enc);
        await deps.mailer.send({
          to,
          ...alertEmail(
            rows.map((r) => ({ state: r.place, n: Number(r.n) })),
            stopLinkFor(deps.siteOrigin, token),
          ),
        });
        sent += 1;
      } catch {
        failed += 1;
        continue;
      }
    }
    await deps.db
      .updateTable('journalist_subscribers')
      .set({ last_sent_at: until })
      .where((eb) => eb.or([eb('last_sent_at', 'is', null), eb('last_sent_at', '<', until)]))
      .where('id', '=', sub.id)
      .execute();
  }
  return {
    ok: failed === 0,
    summary:
      `journalist alerts: ${String(subscribers.length)} subscriber(s), ${String(sent)} email(s) sent` +
      (failed ? `, ${String(failed)} could not be sent and will be tried again next time.` : '.'),
  };
}
