/**
 * The door's two settings: how long a form must have been open before it is
 * sent, and how hard the puzzle is.
 *
 * THE PUZZLE LEVEL IS READ IN ONE PLACE, `puzzleLevel`, so the moderator
 * screen's "Harder puzzle" switch (Plan E, session PE3: recorded with who and
 * when, and shown publicly) can take this over by changing one function.
 * Until then the level is the `puzzle` column of `door_settings`, "normal"
 * unless an administrator set it here.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export const PUZZLE_LEVEL_IDS = ['normal', 'harder'] as const;
export type PuzzleLevel = (typeof PUZZLE_LEVEL_IDS)[number];

export interface DoorSettings {
  /** A form sent sooner than this after it was opened is refused. */
  minFormMs: number;
  puzzle: PuzzleLevel;
}

/** What ships: three seconds, and the normal puzzle (brief §09: start conservative). */
export const DEFAULT_DOOR_SETTINGS: DoorSettings = { minFormMs: 3000, puzzle: 'normal' };

export async function doorSettings(db: Kysely<DB>): Promise<DoorSettings> {
  const row = await db
    .selectFrom('door_settings')
    .select(['min_form_ms', 'puzzle'])
    .where('id', '=', true)
    .executeTakeFirst();
  if (!row) return DEFAULT_DOOR_SETTINGS;
  return {
    minFormMs: row.min_form_ms,
    puzzle: (PUZZLE_LEVEL_IDS as readonly string[]).includes(row.puzzle)
      ? (row.puzzle as PuzzleLevel)
      : 'normal',
  };
}

/** How hard the next challenge is. THE one place the level is decided. */
export async function puzzleLevel(db: Kysely<DB>): Promise<PuzzleLevel> {
  return (await doorSettings(db)).puzzle;
}

export async function writeDoorSettings(
  db: Kysely<DB>,
  patch: Partial<{ minFormMs: number; puzzle: PuzzleLevel }>,
): Promise<void> {
  const values = {
    ...(patch.minFormMs === undefined ? {} : { min_form_ms: patch.minFormMs }),
    ...(patch.puzzle === undefined ? {} : { puzzle: patch.puzzle }),
  };
  await db
    .insertInto('door_settings')
    .values({ id: true, ...values })
    .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, updated_at: sql`now()` }))
    .execute();
}
