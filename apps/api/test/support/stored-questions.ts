/**
 * Test data: a logbook question of a kind `addField` now refuses (plain
 * short_text, long_text, url, email, or an open place).
 *
 * Production refuses to CREATE these (free text on a logbook is an attached
 * note), but questions made before that rule still exist and must keep
 * working, and many tests need one as a fixture. So this writes the row
 * directly, the way a pre-rule database would hold it. It is not a flag on
 * `addField` and does not loosen it. The checks that do not depend on the kind
 * (a key is free, nothing required after launch) are repeated here so a test
 * of those still sees them; a test of any OTHER refusal should use a choice
 * kind and `addField`.
 */
import type { Question } from '@reportlog/contracts';
import { canFilter, isPublishedFreeText } from '@reportlog/fields';
import type { Kysely, Transaction } from 'kysely';
import { ensureFormVersion } from '../../src/chain/forms.ts';
import { questionsFor } from '../../src/chain/questions.ts';
import type { DB } from '../../src/db/schema.gen.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { refuse } from '../../src/logbooks/refusals.ts';

type Db = Parameters<typeof L.addField>[0];

/** `L.addField`, except that a kind it refuses is stored directly instead. */
export async function addStoredQuestion(
  db: Db,
  logbookId: number,
  spec: L.QuestionSpec,
): Promise<Question> {
  const settings = L.settingsFor(spec.kind, spec.settings);
  if (!isPublishedFreeText({ kind: spec.kind, settings })) return L.addField(db, logbookId, spec);

  return (db as Kysely<DB>).transaction().execute(async (trx: Transaction<DB>) => {
    const lb = await trx
      .selectFrom('logbooks')
      .select(['id', 'slug', 'launched_at'])
      .where('id', '=', logbookId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (lb.launched_at && spec.required) refuse('launched-required');
    const existing = await L.fieldsFor(trx, logbookId);
    const key = spec.key?.trim() ? spec.key.trim() : L.keyify(spec.label);
    if (existing.some((f) => f.key === key)) refuse('key-taken');
    const row = await trx
      .insertInto('logbook_fields')
      .values({
        logbook_id: logbookId,
        key,
        kind: spec.kind,
        label: spec.label.trim(),
        help: spec.help?.trim() ? spec.help.trim() : null,
        required: Boolean(spec.required),
        filterable: Boolean(spec.filterable) && canFilter(spec.kind),
        settings: JSON.stringify(settings),
        shown_when: spec.shown_when ? JSON.stringify(spec.shown_when) : null,
        position: existing.length ? Math.max(...existing.map((f) => f.position)) + 1 : 0,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (lb.launched_at) await ensureFormVersion(trx, lb, await questionsFor(trx, logbookId));
    const stored = (await L.fieldsFor(trx, logbookId)).find((f) => f.id === row.id);
    return stored ?? refuse('no-field');
  });
}
