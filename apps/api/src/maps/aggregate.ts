/**
 * Where published reports came from, as counts, for ONE heat map. Ported from
 * legacy src/mapData.js.
 *
 * THIS FILE DECIDES WHAT A READER MAY SEE; `manage.ts` decides what an
 * operator may ASK FOR. Keeping them apart is why a mistake in the panel
 * cannot become a disclosure: every rule about what may be published (the
 * publication gates, the threshold, a suppressed area travelling without its
 * count) is applied here, from scratch, on every computation, whatever the
 * stored settings say.
 *
 * AN ENTRY IS NOT A REPORT. A list's approved entries are counted in a query
 * of their own with their own gate, never a UNION with the reports one. What
 * the two share is the tally, which was only ever counts. Nothing here reads
 * the seal or the chain, and the boundary check keeps them from reading this.
 */
import type { AreaCount, MapAggregate, MapPlane, MapView, Stance } from '@reportlog/contracts';
import { MIN_AREA_FLOOR, NOT_A_SAMPLE } from '@reportlog/contracts';
import { LOCATION_TYPE } from '@reportlog/fields';
import { sql } from 'kysely';
import { publishedReportIds } from '../board/published.ts';
import type { Database } from '../db/database.ts';
import type { HeatMapRow } from './rows.ts';

/**
 * WHICH REPORTS ARE PUBLISHED, the one rule this module counts by.
 *
 * A report is on a map when the current version of its thread
 *   - was approved by a moderator (`moderation_status = 'valid'`),
 *   - has not been withdrawn by its reporter, and
 *   - was filed with permission to publish (`may_publish`, sealed).
 *
 * The same three conditions as the filing workstream's "public" state
 * (`apps/api/src/filing/filing.ts`) and the chain file's published half
 * (`apps/api/src/chain/chainFile.ts`). It reads the CURRENT version only: a
 * correction sets its thread back to `pending`, so a corrected report leaves
 * the map until it is approved again, rather than being counted at its old
 * place. The moderation workstream (D) owns this state; if it adds a
 * condition (a public-archive switch, a new state), this is the one place to
 * change, and the pull request that brought this file in says so.
 */
function publishedHeads(db: Database) {
  return (
    db
      .selectFrom('report_heads as h')
      .innerJoin('reports as r', 'r.id', 'h.current_report_id')
      // The rule itself lives in board/published.ts, shared with the board and
      // the published chain file.
      .where('r.id', 'in', publishedReportIds(db))
  );
}

/**
 * A sealed location answer is ONE HIERARCHICAL STRING — `US`, `US-AZ`, `DE` —
 * so rolling an area up is a prefix and never a join. Anything else (a place
 * name that slipped in by hand) is no area at all.
 */
export function areaOf(answer: unknown): string | null {
  if (typeof answer !== 'string') return null;
  const m = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.exec(answer);
  return m ? m[0] : null;
}

/**
 * The one answer key a click can filter the board on, or null. A map fed by
 * logbooks that seal their place under different keys has no single filter,
 * and handing over one of them would silently drop every report from the
 * logbook that used the other.
 */
export function filterKeyFor(keys: readonly string[]): string | null {
  const unique = [...new Set(keys)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

/**
 * Where one sealed answer sits on the operator's reading. A yes/no answer is
 * sealed as a boolean and read under "yes" and "no".
 */
export function stanceOf(value: unknown, stances: Readonly<Record<string, Stance>>): Stance | null {
  if (typeof value === 'boolean') return stances[value ? 'yes' : 'no'] ?? null;
  if (typeof value === 'string') return stances[value] ?? null;
  return null;
}

/** What the map counts, in words. The page never calls an entry a report. */
export function unitFor(hasReports: boolean, hasEntries: boolean): { one: string; many: string } {
  if (hasReports && hasEntries) {
    return { one: 'published report or entry', many: 'published reports and entries' };
  }
  if (hasEntries) return { one: 'approved entry', many: 'approved entries' };
  return { one: 'published report', many: 'published reports' };
}

const NOTE =
  'These are reviewed first-hand accounts from people who chose to file them. Not a survey and ' +
  'not a sample. A dark area may mean more problems, or more people who knew the form existed.';

export const NOT_PUBLISHED = 'This map is not published.';

export interface Unplaced {
  /** Counted rows from a logbook or list with no question placing them, or no answer to it. */
  no_question: number;
  /** A bare country on a map that draws only states. */
  country_only: number;
}

export interface Computed {
  map: MapAggregate;
  /** For the staff screen only. Never sent to a reader. */
  unplaced: Unplaced;
}

/**
 * Compute one map. `preview` computes a map that is switched off, for the
 * staff screen, under exactly the same rules.
 *
 * COMPUTED LIVE, never materialised into a table that can drift: a withdrawal
 * or a moderator's change takes an area's count down on the next computation
 * (and within the cache's minute in `MapCache`).
 */
export async function computeMap(
  db: Database,
  row: HeatMapRow | null,
  { preview = false, now = new Date() }: { preview?: boolean; now?: Date } = {},
): Promise<Computed> {
  const unplaced: Unplaced = { no_question: 0, country_only: 0 };
  // A disabled map and one that does not exist answer alike, so neither tells
  // a stranger whether the other exists.
  if (!row || (!row.enabled && !preview)) {
    return { map: { published: false, reason: NOT_PUBLISHED }, unplaced };
  }

  // CLAMPED AGAIN HERE, though the database has a CHECK: the one setting
  // whose wrong value is a disclosure rather than a broken page is checked
  // everywhere it is read.
  const k = Math.max(MIN_AREA_FLOOR, Math.trunc(row.min_area) || MIN_AREA_FLOOR);
  const drawsWorld = row.planes.includes('world');

  // EMPTY logbook_ids MEANS EVERY LOGBOOK. An id naming a logbook that no
  // longer exists simply matches nothing.
  const scope = row.logbook_ids;

  // The questions placing each logbook's reports. Read live and filtered to
  // location questions here as well as where they are marked: a marking left
  // on a draft question whose kind later changed places nothing.
  let placeQuery = db
    .selectFrom('map_place_questions as q')
    .innerJoin('logbook_fields as f', (j) =>
      j.onRef('f.logbook_id', '=', 'q.logbook_id').onRef('f.key', '=', 'q.field_key'),
    )
    .select(['q.logbook_id', 'q.field_key'])
    .where('f.kind', '=', LOCATION_TYPE);
  if (scope.length) placeQuery = placeQuery.where('q.logbook_id', 'in', scope);
  const placeKeys = await placeQuery.execute();

  // An outcome question is used only if it is in this map's feed.
  const outcome =
    row.outcome_logbook_id !== null &&
    row.outcome_key !== null &&
    (!scope.length || scope.includes(row.outcome_logbook_id))
      ? { logbookId: row.outcome_logbook_id, key: row.outcome_key, stances: row.outcome_stances }
      : null;

  // GROUPED IN THE DATABASE, so a map over a large archive sends counts across
  // the wire rather than every report's answers.
  let reportQuery = publishedHeads(db)
    .leftJoin('map_place_questions as q', 'q.logbook_id', 'r.logbook_id')
    .leftJoin('logbook_fields as f', (j) =>
      j
        .onRef('f.logbook_id', '=', 'q.logbook_id')
        .onRef('f.key', '=', 'q.field_key')
        .on('f.kind', '=', LOCATION_TYPE),
    )
    .select([
      // NULL when the logbook has no place question, or this report did not
      // answer it.
      sql<string | null>`r.answers ->> f.key`.as('place'),
      outcome
        ? sql`CASE WHEN r.logbook_id = ${outcome.logbookId} THEN r.answers -> ${outcome.key} END`.as(
            'outcome',
          )
        : sql`NULL::jsonb`.as('outcome'),
      sql<string>`count(*)`.as('n'),
    ])
    .groupBy(['place', 'outcome']);
  if (scope.length) reportQuery = reportQuery.where('r.logbook_id', 'in', scope);
  const reportGroups = await reportQuery.execute();

  const tally = new Map<string, AreaCount>();
  /* ONE PLACE THAT DECIDES WHAT AN AREA DOES WITH A ROW, so the report half
     and the list half cannot drift into counting differently. */
  const place = (answer: unknown, n: number): AreaCount | null => {
    const code = areaOf(answer);
    if (!code) {
      unplaced.no_question += n;
      return null;
    }
    // A reporter who stopped at the country is on no map of states. On a
    // world plane a country IS the area.
    if (code.length === 2 && !drawsWorld) {
      unplaced.country_only += n;
      return null;
    }
    let a = tally.get(code);
    if (!a) {
      a = { n: 0, assessed: 0, pos: 0, neg: 0, neu: 0 };
      tally.set(code, a);
    }
    return a;
  };

  for (const g of reportGroups) {
    const n = Number(g.n);
    const a = place(g.place, n);
    if (!a) continue;
    a.n += n;
    if (outcome) {
      const stance = stanceOf(g.outcome, outcome.stances);
      // ASSESSED MEANS IT HAS A STANCE. Legacy counted every row of the
      // outcome logbook, so an unanswered question dragged the colour toward
      // "evenly split", which is a claim about answers nobody gave.
      if (stance) {
        a.assessed += n;
        if (stance === 'positive') a.pos += n;
        else if (stance === 'negative') a.neg += n;
        else a.neu += n;
      }
    }
  }

  /* THE LIST HALF, in its own query with its own gate.

     THE GATE IS `review_state = 'approved'`: "may this be counted". A list is
     approved in bulk, but it IS approved; there is no auto-count path any
     more than there is an auto-publish path for a report.

     IT READS `answers` AND NEVER `erasable_answers`. A place code lives in the
     durable half, so a published count never shrinks by itself months later
     when the sweep runs. The two columns exist so a query like this CANNOT
     reach anything erasable.

     EMPTY list_ids MEANS NO LISTS. */
  let listsCounted = 0;
  if (row.list_ids.length) {
    const listKeys = await db
      .selectFrom('map_list_place_questions as q')
      .innerJoin('list_fields as f', (j) =>
        j.onRef('f.list_id', '=', 'q.list_id').onRef('f.key', '=', 'q.field_key'),
      )
      .select(['q.list_id'])
      .where('f.kind', '=', LOCATION_TYPE)
      .where('q.list_id', 'in', row.list_ids)
      .execute();
    listsCounted = listKeys.length;
    if (listsCounted) {
      const entryGroups = await db
        .selectFrom('list_entries as e')
        .innerJoin('map_list_place_questions as q', 'q.list_id', 'e.list_id')
        .select([
          sql<string | null>`e.answers ->> q.field_key`.as('place'),
          sql<string>`count(*)`.as('n'),
        ])
        .where('e.review_state', '=', 'approved')
        .where(
          'e.list_id',
          'in',
          listKeys.map((l) => l.list_id),
        )
        .groupBy('place')
        .execute();
      for (const g of entryGroups) {
        const n = Number(g.n);
        const a = place(g.place, n);
        // THE COUNT AND NOTHING ELSE. A list has no outcome reading: it is
        // approved in bulk, so nobody made a judgement about one entry.
        if (a) a.n += n;
      }
    }
  }

  /* THE THRESHOLD IS ENFORCED HERE, NOT IN THE BROWSER, AND AN AREA UNDER IT
     IS SENT WITHOUT ITS COUNT. Sending "Wyoming: 1" and letting the page
     decline to shade it publishes the one number the threshold exists to
     withhold: anybody can open the network tab. A suppressed area travels as
     a bare code, so a reader learns it holds between one and k − 1. */
  const areas: Record<string, AreaCount> = {};
  const suppressed: string[] = [];
  let suppressedTotal = 0;
  for (const [code, a] of [...tally.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    if (a.n >= k) areas[code] = a;
    else {
      suppressed.push(code);
      suppressedTotal += a.n;
    }
  }

  const views: MapView[] = row.views.filter((v) => v !== 'outcome' || outcome !== null);
  return {
    unplaced,
    map: {
      published: true,
      slug: row.slug,
      title: row.title,
      blurb: row.blurb,
      as_of: now.toISOString(),
      note: NOTE,
      not_a_sample: NOT_A_SAMPLE,
      threshold: k,
      unit: unitFor(placeKeys.length > 0 || listsCounted === 0, listsCounted > 0),
      planes: row.planes,
      // An outcome view with no question behind it is a view of nothing. It
      // is refused where it is set (manage.ts) and dropped here, which
      // catches a question deleted afterwards.
      views: views.length ? views : ['volume'],
      outcome_question: outcome ? await labelOf(db, outcome.logbookId, outcome.key) : null,
      filter_key: filterKeyFor(placeKeys.map((p) => p.field_key)),
      areas,
      /* AND THE SAME CARE ON THE SUBTOTAL. With one suppressed area its total
         IS its count. Two or more is a sum nobody can take apart. */
      suppressed: {
        areas: suppressed,
        reports: suppressed.length >= 2 ? suppressedTotal : null,
      },
    },
  };
}

async function labelOf(db: Database, logbookId: number, key: string): Promise<string | null> {
  const f = await db
    .selectFrom('logbook_fields')
    .select('label')
    .where('logbook_id', '=', logbookId)
    .where('key', '=', key)
    .executeTakeFirst();
  return f?.label ?? null;
}

/** The planes a row may name. */
export function planesOf(value: readonly string[]): MapPlane[] {
  return value.filter((p): p is MapPlane => p === 'us' || p === 'world');
}

/**
 * One computation serves every reader of a map for a minute: it walks every
 * published head, and a page open in many browsers would otherwise be a scan
 * per visitor.
 *
 * KEYED BY SLUG, because two maps differ in the one thing a cache must not get
 * wrong: a map with a threshold of 10 must never be served the answer computed
 * for a threshold of 3. Every staff write clears it, so an operator who turns
 * a map off sees it go at once. A withdrawal or a moderator's decision leaves
 * the map within the minute; that is the stated cost.
 */
export class MapCache {
  readonly #ttlMs: number;
  readonly #entries = new Map<string, { at: number; value: MapAggregate }>();
  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs;
  }
  async get(slug: string, compute: () => Promise<MapAggregate>): Promise<MapAggregate> {
    const hit = this.#entries.get(slug);
    if (hit && Date.now() - hit.at < this.#ttlMs) return hit.value;
    const value = await compute();
    if (this.#ttlMs > 0) this.#entries.set(slug, { at: Date.now(), value });
    return value;
  }
  clear(): void {
    this.#entries.clear();
  }
}
