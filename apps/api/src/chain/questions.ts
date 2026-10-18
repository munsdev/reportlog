/**
 * A logbook's questions as the sealing code reads them, in the operator's
 * order. Logbook authoring lives with the logbooks workstream; this is only
 * the read the chain needs.
 */
import type { FieldDefinition, FieldSettings, Condition } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export async function questionsFor(db: Kysely<DB>, logbookId: number): Promise<FieldDefinition[]> {
  const rows = await db
    .selectFrom('logbook_fields')
    .select(['key', 'kind', 'label', 'help', 'required', 'shown_when', 'settings'])
    .where('logbook_id', '=', logbookId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    label: r.label,
    // Absent, not null, when there is none: the form definition writes these
    // keys only when they apply.
    ...(r.help ? { help: r.help } : {}),
    required: r.required,
    ...(r.shown_when ? { shown_when: r.shown_when as unknown as Condition } : {}),
    settings: r.settings as FieldSettings,
  }));
}
