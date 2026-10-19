/**
 * Reading a list and its questions out of the database, in one shape.
 */
import type { FieldSettings } from '@reportlog/fields';
import type { Kysely, Selectable } from 'kysely';
import type { DB, ListFields, Lists } from '../db/schema.gen.ts';
import type { ListField } from './fields.ts';
import { CLASSES, isRetention } from './retention.ts';
import type { Retention } from './retention.ts';

export type Db = Kysely<DB>;
export type ListRow = Selectable<Lists>;
export type FieldRow = Selectable<ListFields>;

/** A stored question, as the rules read it. */
export interface StoredField extends ListField {
  id: number;
  help: string | null;
  required: boolean;
  settings: FieldSettings;
  max_values: number;
  aggregatable: boolean;
  retention: Retention;
  position: number;
}

export interface LoadedList extends ListRow {
  fields: StoredField[];
}

function settingsOf(raw: unknown): FieldSettings {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as FieldSettings)
    : {};
}

export function toField(row: FieldRow): StoredField {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    label: row.label,
    help: row.help,
    required: row.required,
    settings: settingsOf(row.settings),
    max_values: row.max_values,
    aggregatable: row.aggregatable,
    // The table's CHECK allows only the three; this is the type narrowing it.
    retention: isRetention(row.retention) ? row.retention : CLASSES.TRANSIENT,
    position: row.position,
  };
}

export async function fieldsOf(db: Db, listId: number): Promise<StoredField[]> {
  const rows = await db
    .selectFrom('list_fields')
    .selectAll()
    .where('list_id', '=', listId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  return rows.map(toField);
}

export async function listBySlug(db: Db, slug: string): Promise<LoadedList | null> {
  const row = await db.selectFrom('lists').selectAll().where('slug', '=', slug).executeTakeFirst();
  return row ? { ...row, fields: await fieldsOf(db, row.id) } : null;
}

export async function listById(db: Db, id: number): Promise<LoadedList | null> {
  if (!Number.isInteger(id)) return null;
  const row = await db.selectFrom('lists').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? { ...row, fields: await fieldsOf(db, row.id) } : null;
}

/**
 * Whether a list is taking entries, COMPUTED when asked rather than read from
 * a flag a timer flips. The same shape as a logbook's, so the two formats
 * answer "is this open" the same way.
 */
export function isAccepting(
  list: Pick<ListRow, 'closed_at' | 'opens_at' | 'closes_at'>,
  now: Date = new Date(),
): boolean {
  if (list.closed_at) return false;
  if (list.opens_at && new Date(list.opens_at) > now) return false;
  if (list.closes_at && new Date(list.closes_at) <= now) return false;
  return true;
}

export const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();
