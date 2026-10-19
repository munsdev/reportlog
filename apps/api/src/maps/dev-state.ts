/**
 * Published reports with places in them, for the browser tests.
 *
 *   node src/maps/dev-state.ts fixture
 *       Make a launched logbook with a location question, file reports in
 *       Arizona (4), California (3), Alaska (3), Nevada (2), Wyoming (1) and
 *       Guam (1), and print {"id":…,"slug":…,"title":…}. A new logbook every
 *       run, so parallel tests never share one.
 *
 * THE REPORTS ARE APPROVED HERE, standing in for a moderator, because the
 * moderation workstream's routes do not exist yet and a map counts only
 * approved reports. That is exactly why this refuses to run in production:
 * nothing may approve a report except a moderator. It does not mark which
 * question places a report; the test does that through the staff screen.
 */
import { buildAnswers } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { cardFor, normalizeReportFields } from '@reportlog/seal';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendReportVersion } from '../chain/append.ts';
import { loadConfig } from '../config.ts';
import { recordCardTexts } from '../consent/cards.ts';
import { createDatabase } from '../db/database.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-state does not run in production: it approves reports.');
}

const QUESTIONS: FieldDefinition[] = [
  { key: 'where', kind: 'location', label: 'Where did it happen?', settings: { scope: 'us' } },
];
const PLAN: [string, number][] = [
  ['US-AZ', 4],
  ['US-CA', 3],
  ['US-AK', 3],
  ['US-NV', 2],
  ['US-WY', 1],
  ['US-GU', 1],
];

const [mode] = process.argv.slice(2);
if (mode !== 'fixture') throw new Error('Usage: dev-state.ts fixture');

const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  await recordCardTexts(db);
  const slug = `maps-${randomBytes(4).toString('hex')}`;
  const title = `Map test ${slug.slice(5)}`;
  const lb = await db
    .insertInto('logbooks')
    .values({ slug, title })
    .returning(['id', 'slug'])
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

  for (const [where, times] of PLAN) {
    for (let i = 0; i < times; i++) {
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
          .values({ thread_id: threadId, current_report_id: row.id, moderation_status: 'valid' })
          .execute();
      });
    }
  }
  process.stdout.write(`${JSON.stringify({ id: lb.id, slug, title })}\n`);
} finally {
  await db.destroy();
}
