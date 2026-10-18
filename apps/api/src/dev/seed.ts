/**
 * Demo data for development and the browser tests: one launched logbook
 * with a few questions, and two reports filed through the real chain code.
 *
 * Refuses to run when NODE_ENV is production. Safe to run repeatedly: the
 * logbook is created once, and each run files two more reports. Prints the
 * new references, one per line, as its last output.
 */
import { buildAnswers } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { cardFor, normalizeReportFields } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { appendReportVersion } from '../chain/append.ts';
import { loadConfig } from '../config.ts';
import { recordCardTexts } from '../consent/cards.ts';
import { createDatabase } from '../db/database.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The demo seed does not run in production.');
}

const QUESTIONS: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  { key: 'when', kind: 'date', label: 'When did it happen?' },
  { key: 'where', kind: 'location', label: 'Where?', settings: { scope: 'both' } },
];

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL, 2);
try {
  await recordCardTexts(db);
  let logbook = await db
    .selectFrom('logbooks')
    .select(['id', 'slug'])
    .where('slug', '=', 'demo')
    .executeTakeFirst();
  if (!logbook) {
    logbook = await db
      .insertInto('logbooks')
      .values({ slug: 'demo', title: 'Demo logbook', blurb: 'Made by the development seed.' })
      .returning(['id', 'slug'])
      .executeTakeFirstOrThrow();
    for (const [position, q] of QUESTIONS.entries()) {
      await db
        .insertInto('logbook_fields')
        .values({
          logbook_id: logbook.id,
          key: q.key,
          kind: q.kind,
          label: q.label,
          required: Boolean(q.required),
          settings: JSON.stringify(q.settings ?? {}),
          position,
        })
        .execute();
    }
    await db
      .updateTable('logbooks')
      .set({ launched_at: new Date() })
      .where('id', '=', logbook.id)
      .execute();
  }

  const lb = logbook;
  const refs: string[] = [];
  for (const body of [
    { what: 'A polling station opened two hours late.', when: '2026-10-01', where: 'US-AZ' },
    { what: 'Leaflets were handed out inside the building.', where: 'DE' },
  ]) {
    const { answers, errors } = buildAnswers(QUESTIONS, body);
    if (errors.length) throw new Error(errors.join('; '));
    const { row } = await db.transaction().execute((trx) =>
      appendReportVersion(trx, {
        logbookId: lb.id,
        threadId: randomUUID(),
        fields: normalizeReportFields({
          logbook: lb.slug,
          answers,
          may_publish: true,
          may_publish_digest: cardFor('general').digest,
        }),
        publicRefPrefix: config.PUBLIC_REF_PREFIX,
      }),
    );
    refs.push(row.public_ref);
  }
  console.log(refs.join('\n'));
} finally {
  await db.destroy();
}
