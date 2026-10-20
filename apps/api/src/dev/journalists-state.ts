/**
 * For the browser tests of the alert list.
 *
 *   node src/dev/journalists-state.ts alert-for <email>
 *       Make a launched logbook with a location question; file reports in it
 *       as a moderator would have approved them (two in Arizona, one in
 *       Texas, and one in Arizona that is NOT approved), then run the
 *       journalist alert so the email lands in MAIL_OUTBOX with its unsubscribe link.
 *   node src/dev/journalists-state.ts listed <email>
 *       Print `pending`, `active` or `none`: how a test checks that opening
 *       a link changed nothing.
 *
 * Approving here stands in for a moderator, which is why this refuses to run
 * in production: nothing may approve a report except a moderator.
 */
import { buildAnswers } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { cardFor, normalizeReportFields } from '@reportlog/seal';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { loadConfig } from '../config.ts';
import { recordCardTexts } from '../consent/cards.ts';
import { createDatabase } from '../db/database.ts';
import { outboxMailer } from '../email/mailer.ts';
import { emailDigest, keyringFrom } from '../filing/contactKeys.ts';
import { runJournalistAlerts } from '../journalists/alerts.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-state does not run in production: it approves reports.');
}

const QUESTIONS: FieldDefinition[] = [
  { key: 'where', kind: 'location', label: 'Where did it happen?', settings: { scope: 'us' } },
];

const [mode, address] = process.argv.slice(2);
const config = loadConfig();
if (!address || !config.CONTACT_KEY || (mode !== 'alert-for' && mode !== 'listed')) {
  throw new Error('Usage: dev-state.ts alert-for|listed <email> (and CONTACT_KEY set)');
}
const ring = keyringFrom(config.CONTACT_KEY);
const db = createDatabase(config.DATABASE_URL, 2);
try {
  const who = await db
    .selectFrom('journalist_subscribers')
    .select(['id', 'status', 'states'])
    .where('email_hmac', '=', emailDigest(ring, address))
    .executeTakeFirst();
  if (mode === 'listed') {
    process.stdout.write(`${who?.status ?? 'none'}\n`);
  } else {
    const outbox = process.env.MAIL_OUTBOX;
    if (!outbox) throw new Error('alert-for needs MAIL_OUTBOX: where the email is written.');
    if (!who) throw new Error('That address is not on the list.');
    await recordCardTexts(db);
    const slug = `alerts-${randomBytes(4).toString('hex')}`;
    const lb = await db
      .insertInto('logbooks')
      .values({ slug, title: `Alert test ${slug.slice(7)}` })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    for (const [position, q] of QUESTIONS.entries()) {
      await db
        .insertInto('logbook_fields')
        .values({
          logbook_id: lb.id,
          key: q.key,
          kind: q.kind,
          label: q.label,
          settings: JSON.stringify(q.settings ?? {}),
          position,
        })
        .execute();
    }
    await db
      .updateTable('logbooks')
      .set({ launched_at: new Date() })
      .where('id', '=', lb.id)
      .execute();
    const own = who.states[0] ?? 'US-AZ';
    const plan: (readonly [string, 'valid' | 'pending'])[] = [
      [own, 'valid'],
      [own, 'valid'],
      ['US-WY', 'valid'],
      [own, 'pending'],
    ];
    for (const [where, status] of plan) {
      const { answers } = buildAnswers(QUESTIONS, { where });
      const threadId = randomUUID();
      await db.transaction().execute(async (trx) => {
        const { row } = await appendReportVersion(trx, {
          logbookId: lb.id,
          threadId,
          correctsId: null,
          fields: normalizeReportFields({
            logbook: slug,
            answers,
            may_publish: true,
            may_publish_digest: cardFor('general').digest,
          }),
          attachments: null,
          publicRefPrefix: 'RL-',
        });
        await trx
          .insertInto('report_heads')
          .values({
            thread_id: threadId,
            current_report_id: row.id,
            moderation_status: status,
            // Two minutes ago: a run stops a minute behind the clock.
            updated_at: sql<Date>`now() - interval '2 minutes'`,
          })
          .execute();
      });
    }
    // Confirmed an hour ago, as far as the alert's window is concerned.
    await db
      .updateTable('journalist_subscribers')
      .set({ last_sent_at: sql<Date>`now() - interval '1 hour'` })
      .where('id', '=', who.id)
      .execute();
    await runJournalistAlerts({
      db,
      mailer: outboxMailer(outbox),
      siteOrigin: config.SITE_ORIGIN,
      log: () => undefined,
      contactKey: config.CONTACT_KEY,
    });
  }
} finally {
  await db.destroy();
}
