import { buildAnswers } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { cardFor, normalizeReportFields } from '@reportlog/seal';
import type { AttachmentEntry, ReportSubmission } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { appendReportVersion } from '../../src/chain/append.ts';
import { recordCardTexts } from '../../src/consent/cards.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';

export function testDatabase(): Database {
  return createDatabase(inject('databaseUrl'), 20);
}

let n = 0;
/** A slug no other test uses. */
export function uniqueSlug(stem = 'lb'): string {
  n += 1;
  return `${stem}-${String(process.pid)}-${String(n)}-${String(Date.now() % 100000)}`;
}

export const QUESTIONS: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  { key: 'when', kind: 'date', label: 'When?' },
  { key: 'has', kind: 'evidence_declaration', label: 'Do you have photos?' },
  { key: 'of', kind: 'short_text', label: 'Of what?', shown_when: { field: 'has', in: ['yes'] } },
];

/** A logbook with these questions, launched. */
export async function launchedLogbook(
  db: Database,
  questions: readonly FieldDefinition[] = QUESTIONS,
): Promise<{ id: number; slug: string }> {
  await recordCardTexts(db);
  const slug = uniqueSlug();
  const lb = await db
    .insertInto('logbooks')
    .values({ slug, title: `Logbook ${slug}` })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
  for (const [position, q] of questions.entries()) {
    await db
      .insertInto('logbook_fields')
      .values({
        logbook_id: lb.id,
        key: q.key,
        kind: q.kind,
        label: q.label,
        help: q.help ?? null,
        required: Boolean(q.required),
        shown_when: q.shown_when ? JSON.stringify(q.shown_when) : null,
        settings: JSON.stringify(q.settings ?? {}),
        position,
      })
      .execute();
  }
  await db
    .updateTable('logbooks')
    .set({
      launched_at: new Date(),
      // Held questions are only asked while the logbook takes notes and links.
      ...(questions.some((q) => q.kind === 'private_text' || q.kind === 'private_link')
        ? { accepts_notes: true }
        : {}),
    })
    .where('id', '=', lb.id)
    .execute();
  return lb;
}

export const GENERAL_DIGEST = cardFor('general').digest;

/** File a report the way the filing path will: build answers, normalize, append. */
export async function fileReport(
  db: Database,
  logbook: { id: number; slug: string },
  body: Record<string, unknown>,
  extra: {
    threadId?: string;
    correctsId?: number;
    submission?: Partial<ReportSubmission>;
    attachments?: AttachmentEntry[];
    questions?: readonly FieldDefinition[];
  } = {},
) {
  const { answers, errors } = buildAnswers(extra.questions ?? QUESTIONS, body);
  if (errors.length) throw new Error(errors.join('; '));
  const fields = normalizeReportFields({
    logbook: logbook.slug,
    answers,
    may_publish: true,
    may_publish_digest: GENERAL_DIGEST,
    ...extra.submission,
  });
  return db.transaction().execute((trx) =>
    appendReportVersion(trx, {
      logbookId: logbook.id,
      threadId: extra.threadId ?? randomUUID(),
      correctsId: extra.correctsId ?? null,
      fields,
      attachments: extra.attachments ?? null,
      publicRefPrefix: 'RL-',
    }),
  );
}
