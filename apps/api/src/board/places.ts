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
 * WHAT THIS DOES NOT HIDE, ACCEPTED (decisions 20 and 21). With one thin
 * area, a logbook's published total, minus the areas shown, minus "not
 * answered", is that area's count; the map's numbers allow the same sum. And
 * a place's code is an answer like any other, so the board's search finds
 * it. Both are accepted rather than closed, because each published report
 * already shows its own place: a reader can count a thin area by reading its
 * reports. The threshold protects the published counts. It does not hide
 * where a published report came from.
 *
 * Read live, never cached here: the stats cache above it is a minute, and a
 * threshold raised on the maps screen should not wait longer than that.
 */
import { MIN_AREA_FLOOR } from '@reportlog/contracts';
import { LOCATION_TYPE } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { smallAreaThresholds } from '../moderation/switches.ts';

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
      if (m.logbook_ids.length && !m.logbook_ids.map(Number).includes(q.logbook_id)) {
        continue;
      }
      // Clamped as the aggregate clamps it: the one setting whose wrong value
      // is a disclosure is checked everywhere it is read.
      threshold = Math.max(threshold, MIN_AREA_FLOOR, Math.trunc(m.min_area) || MIN_AREA_FLOOR);
    }
    if (threshold) out.set(q.logbook_id, { key: q.field_key, threshold });
  }
  return out;
}

export interface CountGuard {
  /** Every question whose answers are counted by place under this threshold. */
  keys: ReadonlySet<string>;
  /** Fewer published reports than this, and the place is named without its count. */
  threshold: number;
}

/**
 * WHAT EVERY PUBLIC COUNT BY PLACE KEEPS, per logbook (Plan E, PE4): the
 * map's threshold on the question a map reads (above), and, on a logbook
 * published as COUNTS ONLY, its own small-area threshold on EVERY location
 * question, whether or not a map reads it. Where both apply, the higher.
 *
 * WHY COUNTS ONLY IS DIFFERENT. Decisions 20 and 21 left a thin area
 * countable on a listed logbook because each published report shows its own
 * place: a reader can count it by reading. A counts-only logbook shows no
 * report, so its place counts are all a reader has, and they are the thing
 * to protect. A place under the threshold is sent as a name without a
 * number (never a number the page then hides), and "the rest together" only
 * when two or more places are under it, as the map does.
 *
 * WHAT A TOTAL MINUS THE VISIBLE PLACES STILL REVEALS, documented as
 * decision 21 documented it (decisions.md, the PE4 rows). On a counts-only
 * logbook:
 *   - with ONE place under the threshold, the logbook's published total,
 *     minus the places shown, minus the reports that named no place (the
 *     numbers page's "Not answered"), is that place's count. The same holds
 *     per origin, from the counts route's two columns;
 *   - a place under the threshold is named, so at the floor (2) its count
 *     can only be 1. That is the map's rule (an area is drawn as "fewer
 *     than k"); a higher threshold makes the name say less;
 *   - a heat map is state-level (decision 44) and the counts route lists a
 *     county apart from its state, so a state's map count minus its counties
 *     shown, minus its state-only answers, is the sum of its thin counties.
 * None of these is new with PE4: each was there, with no threshold at all,
 * before it. Nothing here adds another figure to subtract from: no new
 * total, no count by place crossed with anything else.
 */
export async function countGuards(db: Kysely<DB>): Promise<Map<number, CountGuard>> {
  const out = new Map<number, CountGuard>();
  for (const [id, g] of await placeGuards(db)) {
    out.set(id, { keys: new Set([g.key]), threshold: g.threshold });
  }
  const small = await smallAreaThresholds(db);
  if (!small.size) return out;
  const fields = await db
    .selectFrom('logbook_fields')
    .select(['logbook_id', 'key'])
    .where('logbook_id', 'in', [...small.keys()])
    .where('kind', '=', LOCATION_TYPE)
    .execute();
  for (const [id, threshold] of small) {
    const map = out.get(id);
    out.set(id, {
      keys: new Set([
        ...(map?.keys ?? []),
        ...fields.filter((f) => f.logbook_id === id).map((f) => f.key),
      ]),
      threshold: Math.max(threshold, map?.threshold ?? 0),
    });
  }
  return out;
}

/** The sentence a withheld board says, with the threshold in it. */
export function withheldReason(threshold: number): string {
  return `Fewer than ${String(threshold)} published reports match, so the board does not show them one place at a time. The heat map keeps the same rule.`;
}
