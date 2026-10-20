/**
 * WHERE THE BOARD AND A HEAT MAP ASK THE SAME PLACE QUESTION, the board keeps
 * the map's threshold (docs/decisions.md, decision 6).
 *
 * A map sends an area under its threshold as a bare code with no count
 * (maps/aggregate.ts), because "Wyoming: 1" in a payload has published the
 * number whatever the page draws. The board can say the same thing two other
 * ways: its numbers break a logbook's reports out by each question marked as
 * a filter, and a board narrowed to one place says how many reports match.
 * Both would hand over exactly the count the map withholds. So, for a
 * logbook's place question that feeds a map:
 *
 *   - the numbers list an area under the threshold by name, without its
 *     count, and give the sum of those areas only when there are two or more
 *     (with one, the sum IS its count), as the map does;
 *   - a board (or its spreadsheet) narrowed by that question to fewer
 *     reports than the threshold sends no reports and no total, only that
 *     it is withheld.
 *
 * EVERY MAP COUNTS, SWITCHED ON OR NOT. The threshold is the operator's
 * statement of how thin an area may be shown; turning a map's display off
 * does not withdraw that statement, and a protection that vanished with a
 * display switch would be one nobody could see go. Where several maps feed
 * from one logbook, the highest threshold wins.
 *
 * Read live, never cached here: the stats cache above it is a minute, and a
 * threshold raised on the maps screen should not wait longer than that.
 */
import { MIN_AREA_FLOOR } from '@reportlog/contracts';
import { LOCATION_TYPE } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export interface PlaceGuard {
  /** The question key the map reads this logbook's place from. */
  key: string;
  /** Fewer published reports than this, and the count is withheld. */
  threshold: number;
}

/** Each logbook whose place question feeds a map, with the threshold to keep. */
export async function placeGuards(db: Kysely<DB>): Promise<Map<number, PlaceGuard>> {
  const questions = await db
    .selectFrom('map_place_questions as q')
    .innerJoin('logbook_fields as f', (j) =>
      j.onRef('f.logbook_id', '=', 'q.logbook_id').onRef('f.key', '=', 'q.field_key'),
    )
    .select(['q.logbook_id', 'q.field_key'])
    // As the aggregate reads it: a marking left on a question that is no
    // longer a location question places nothing on a map, so guards nothing.
    .where('f.kind', '=', LOCATION_TYPE)
    .execute();
  if (!questions.length) return new Map();
  const maps = await db.selectFrom('heat_maps').select(['min_area', 'logbook_ids']).execute();
  const out = new Map<number, PlaceGuard>();
  for (const q of questions) {
    let threshold = 0;
    for (const m of maps) {
      // EMPTY logbook_ids MEANS EVERY LOGBOOK, as on the map itself.
      if (m.logbook_ids.length && !m.logbook_ids.map(Number).includes(Number(q.logbook_id))) {
        continue;
      }
      // Clamped as the aggregate clamps it: the one setting whose wrong value
      // is a disclosure is checked everywhere it is read.
      threshold = Math.max(threshold, MIN_AREA_FLOOR, Math.trunc(m.min_area) || MIN_AREA_FLOOR);
    }
    if (threshold) out.set(Number(q.logbook_id), { key: q.field_key, threshold });
  }
  return out;
}

/** The sentence a withheld board says, with the threshold in it. */
export function withheldReason(threshold: number): string {
  return `Fewer than ${String(threshold)} published reports match, so the board does not show them one place at a time. The heat map keeps the same rule.`;
}
