/**
 * The door's own setting: how long a form must have been open before it is
 * sent. How hard the puzzle is belongs to the moderators' "Harder puzzle"
 * switch (moderation/switches.ts, `puzzleLevel`), recorded and shown publicly.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export interface DoorSettings {
  /** A form sent sooner than this after it was opened is refused. */
  minFormMs: number;
}

/** What ships: three seconds (brief §09: start conservative). */
export const DEFAULT_DOOR_SETTINGS: DoorSettings = { minFormMs: 3000 };

export async function doorSettings(db: Kysely<DB>): Promise<DoorSettings> {
  const row = await db
    .selectFrom('door_settings')
    .select(['min_form_ms'])
    .where('id', '=', true)
    .executeTakeFirst();
  return row ? { minFormMs: row.min_form_ms } : DEFAULT_DOOR_SETTINGS;
}

export async function writeDoorSettings(
  db: Kysely<DB>,
  patch: Partial<DoorSettings>,
): Promise<void> {
  const values = patch.minFormMs === undefined ? {} : { min_form_ms: patch.minFormMs };
  await db
    .insertInto('door_settings')
    .values({ id: true, ...values })
    .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, updated_at: sql`now()` }))
    .execute();
}
