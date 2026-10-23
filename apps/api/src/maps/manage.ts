/**
 * Heat maps as an operator makes them: making, changing, arranging and
 * deleting maps, and saying which question places a report. Ported from
 * legacy src/heatMaps.js.
 *
 * THE COUNTING IS NOT HERE. `aggregate.ts` decides what a reader may SEE;
 * this file decides what an operator may ASK FOR.
 *
 * EVERY WRITE VALIDATES, AND REFUSES BY NAME. These refusals are not the
 * security boundary (the aggregate is): they stop a map being configured
 * into a state that silently shows nothing, which is the failure this
 * feature is most prone to. A view with no question behind it, a threshold
 * under the floor, a slot the site does not have, a feed that does not
 * exist: each would draw an empty map and report no fault, so each is
 * refused where it is set.
 */
import type {
  HeatMapAdmin,
  ListCandidate,
  LogbookCandidate,
  MapPlane,
  MapView,
  Stance,
} from '@reportlog/contracts';
import {
  DEFAULT_MAP_SLOT,
  MAP_PLANES,
  MAP_VIEWS,
  MIN_AREA_FLOOR,
  isMapSlot,
} from '@reportlog/contracts';
import { LOCATION_TYPE, allOptionCodes } from '@reportlog/fields';
import type { FieldSettings } from '@reportlog/fields';
import type { Database } from '../db/database.ts';
import { HttpError } from '../http/errors.ts';
import { allMaps, mapById, stancesOf, toAdmin } from './rows.ts';
import type { HeatMapRow } from './rows.ts';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The kinds whose answers are a fixed set, so an operator can read each one. */
export const OUTCOME_KINDS: ReadonlySet<string> = new Set([
  'choice_one',
  'yes_no',
  'evidence_declaration',
]);

export const refused = (code: string, message: string) => new HttpError(400, code, message);
const missing = (message: string) => new HttpError(404, 'not_found', message);

function cleanList<T extends string>(value: unknown, allowed: readonly T[], what: string): T[] {
  const list = Array.isArray(value) ? value.map(String) : [];
  const kept = [...new Set(list)];
  for (const v of kept) {
    if (!allowed.includes(v as T)) throw refused(what, `There is no ${what} called “${v}”.`);
  }
  // Refused rather than defaulted: quietly picking one for an operator who
  // cleared every box is how a setting comes to mean something the panel
  // does not show.
  if (!kept.length) throw refused(what, `Choose at least one ${what}.`);
  return kept as T[];
}

function cleanIds(value: unknown, what: string): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw refused(what, `The ${what} are a list.`);
  const out = new Set<number>();
  for (const v of value) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0)
      throw refused(what, `“${String(v)}” is not one of the ${what}.`);
    out.add(n);
  }
  return [...out];
}

/** The answers a closed question can have, as the outcome reading names them. */
export function answersOf(kind: string, settings: unknown): string[] {
  if (kind === 'yes_no' || kind === 'evidence_declaration') return ['yes', 'no'];
  // Codes, which is what is sealed; a plain string option is its own code.
  return allOptionCodes(settings as FieldSettings | null);
}

interface Columns {
  slug?: string;
  title?: string;
  blurb?: string | null;
  enabled?: boolean;
  min_area?: number;
  county_min?: number | null;
  planes?: MapPlane[];
  views?: MapView[];
  logbook_ids?: number[];
  list_ids?: number[];
  outcome_logbook_id?: number | null;
  outcome_key?: string | null;
  outcome_stances?: string;
  slot?: string;
  position?: number;
}

/** Everything a write has to agree about. Returns the columns to write. */
async function validate(
  db: Database,
  patch: Record<string, unknown>,
  current: HeatMapRow | null,
): Promise<Columns> {
  const out: Columns = {};
  const has = (k: string) => Object.hasOwn(patch, k) && patch[k] !== undefined;

  if (has('slug') || !current) {
    const slug = (typeof patch.slug === 'string' ? patch.slug : '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw refused(
        'slug',
        'Give the map a short name in lowercase letters, numbers and hyphens. It goes in its address.',
      );
    }
    out.slug = slug;
  }

  if (has('title') || !current) {
    const title = (typeof patch.title === 'string' ? patch.title : '').trim();
    if (title.length < 1 || title.length > 160) {
      throw refused('title', 'Give the map a title between 1 and 160 characters.');
    }
    out.title = title;
  }

  if (has('blurb') || Object.hasOwn(patch, 'blurb')) {
    const blurb = typeof patch.blurb === 'string' ? patch.blurb.trim() : '';
    if (blurb.length > 2000) throw refused('blurb', 'Keep the description under 2,000 characters.');
    out.blurb = blurb || null;
  }

  if (has('enabled')) {
    if (typeof patch.enabled !== 'boolean') throw refused('enabled', 'A map is either on or off.');
    out.enabled = patch.enabled;
  }

  if (has('min_area')) {
    const n = Number(patch.min_area);
    if (!Number.isInteger(n) || n < MIN_AREA_FLOOR) {
      throw refused(
        'min_area',
        `The threshold is a whole number of at least ${String(MIN_AREA_FLOOR)}.`,
      );
    }
    if (n > 100000) throw refused('min_area', 'That threshold is larger than any archive.');
    out.min_area = n;
  }

  // Empty or null turns counties off; anything else is a threshold like
  // min_area's, with the same floor.
  if (Object.hasOwn(patch, 'county_min')) {
    const v = patch.county_min;
    if (v === null || v === '' || v === undefined) out.county_min = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < MIN_AREA_FLOOR || n > 100000) {
        throw refused(
          'county_min',
          `The county threshold is a whole number of at least ${String(MIN_AREA_FLOOR)}, or empty for states only.`,
        );
      }
      out.county_min = n;
    }
  }

  if (has('planes')) out.planes = cleanList(patch.planes, MAP_PLANES, 'plane');
  if (has('views')) out.views = cleanList(patch.views, MAP_VIEWS, 'view');

  if (has('slot')) {
    if (!isMapSlot(patch.slot)) throw refused('slot', 'There is no such place on the site.');
    out.slot = patch.slot;
  }

  if (has('position')) {
    const n = Number(patch.position);
    if (!Number.isInteger(n)) throw refused('position', 'The order is a whole number.');
    out.position = n;
  }

  if (has('logbook_ids')) {
    const ids = cleanIds(patch.logbook_ids, 'logbooks');
    // CHECKED ON THE WAY IN, though the aggregate skips an id that no longer
    // exists: that forgiveness is for a draft deleted later. A feed naming a
    // logbook nobody has would be wrong from the start, and the operator would
    // see an empty map and blame the threshold.
    if (ids.length) {
      const found = await db.selectFrom('logbooks').select('id').where('id', 'in', ids).execute();
      if (found.length !== ids.length)
        throw refused('logbook_ids', 'One of those logbooks does not exist.');
    }
    out.logbook_ids = ids;
  }

  if (has('list_ids')) {
    const ids = cleanIds(patch.list_ids, 'lists');
    if (ids.length) {
      const found = await db
        .selectFrom('lists')
        .select(['id', 'aggregates_published'])
        .where('id', 'in', ids)
        .execute();
      if (found.length !== ids.length)
        throw refused('list_ids', 'One of those lists does not exist.');
      // Owner ruling 42: a map counts a list only if the list's counts are
      // published. Counted again at render time (aggregate.ts), in case the
      // switch is turned off later.
      if (found.some((l) => !l.aggregates_published))
        throw refused(
          'list_ids',
          'One of those lists does not publish its counts, so a map cannot count it. Turn on “Publish the counts” for that list first.',
        );
    }
    out.list_ids = ids;
  }

  if (Object.hasOwn(patch, 'outcome')) {
    const o = patch.outcome;
    if (o === null) {
      out.outcome_logbook_id = null;
      out.outcome_key = null;
      out.outcome_stances = '{}';
    } else {
      const spec = (o ?? {}) as { logbook_id?: unknown; key?: unknown; stances?: unknown };
      const logbookId = Number(spec.logbook_id);
      const key = typeof spec.key === 'string' ? spec.key : '';
      const field = Number.isInteger(logbookId)
        ? await db
            .selectFrom('logbook_fields')
            .select(['kind', 'settings'])
            .where('logbook_id', '=', logbookId)
            .where('key', '=', key)
            .executeTakeFirst()
        : undefined;
      if (!field) throw refused('outcome', 'That question does not exist.');
      if (!OUTCOME_KINDS.has(field.kind)) {
        throw refused(
          'outcome',
          'Only a question with a fixed set of answers (one choice, or yes or no) can colour an outcome.',
        );
      }
      const answers = answersOf(field.kind, field.settings);
      const stances = stancesOf(spec.stances);
      for (const answer of Object.keys(stances)) {
        if (!answers.includes(answer)) {
          throw refused('outcome', `“${answer}” is not one of that question’s answers.`);
        }
      }
      if (!Object.values(stances).some((s: Stance) => s !== 'neutral')) {
        throw refused(
          'outcome',
          'Say which of the answers are positive and which are negative, or the outcome colours nothing.',
        );
      }
      out.outcome_logbook_id = logbookId;
      out.outcome_key = key;
      out.outcome_stances = JSON.stringify(stances);
    }
  }

  /* AN OUTCOME VIEW WITH NO QUESTION IS REFUSED HERE, not quietly dropped.
     The aggregate drops one at read time, which is right for a map whose
     question went afterwards. Doing it silently at write time would be the
     panel accepting a setting and then not doing it. */
  const views = out.views ?? current?.views ?? ['volume'];
  const outcomeLogbook =
    out.outcome_logbook_id !== undefined
      ? out.outcome_logbook_id
      : (current?.outcome_logbook_id ?? null);
  if (views.includes('outcome') && outcomeLogbook === null) {
    throw refused(
      'views',
      'An outcome view needs a question to colour it. Pick one, or untick Outcome.',
    );
  }
  const feed = out.logbook_ids ?? current?.logbook_ids ?? [];
  if (outcomeLogbook !== null && feed.length && !feed.includes(outcomeLogbook)) {
    throw refused(
      'outcome',
      'The outcome question’s logbook does not feed this map. Tick that logbook too, or pick another question.',
    );
  }
  return out;
}

async function reread(db: Database, id: number): Promise<HeatMapRow> {
  const row = await mapById(db, id);
  if (!row) throw missing('That map does not exist.');
  return row;
}

const SLUG_TAKEN = () => refused('slug_taken', 'There is already a map with that short name.');
const isUniqueViolation = (err: unknown) => (err as { code?: unknown } | null)?.code === '23505';

export async function createMap(
  db: Database,
  spec: Record<string, unknown>,
): Promise<HeatMapAdmin> {
  const cols = await validate(db, spec, null);
  try {
    const row = await db
      .insertInto('heat_maps')
      .values({
        slug: cols.slug ?? '',
        title: cols.title ?? '',
        ...cols,
        slot: cols.slot ?? DEFAULT_MAP_SLOT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return toAdmin(await reread(db, row.id));
  } catch (err) {
    if (isUniqueViolation(err)) throw SLUG_TAKEN();
    throw err;
  }
}

export async function updateMap(
  db: Database,
  id: number,
  patch: Record<string, unknown>,
): Promise<HeatMapAdmin> {
  const current = await mapById(db, id);
  if (!current) throw missing('That map does not exist.');
  const cols = await validate(db, patch, current);
  if (!Object.keys(cols).length) return toAdmin(current);
  try {
    await db
      .updateTable('heat_maps')
      .set({ ...cols, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  } catch (err) {
    if (isUniqueViolation(err)) throw SLUG_TAKEN();
    throw err;
  }
  return toAdmin(await reread(db, id));
}

/**
 * SAFE IN A WAY ALMOST NOTHING ELSE HERE IS: a heat map holds no reports and
 * nothing references it, so deleting one removes a view and nothing else.
 */
export async function deleteMap(db: Database, id: number): Promise<void> {
  const res = await db.deleteFrom('heat_maps').where('id', '=', id).executeTakeFirst();
  if (!res.numDeletedRows) throw missing('That map does not exist.');
}

/** Put these maps in this slot, in this order. Maps not named keep their place. */
export async function arrangeMaps(
  db: Database,
  slot: unknown,
  ids: unknown,
): Promise<HeatMapAdmin[]> {
  if (!isMapSlot(slot)) throw refused('slot', 'There is no such place on the site.');
  const order = cleanIds(ids, 'maps');
  await db.transaction().execute(async (trx) => {
    for (const [position, id] of order.entries()) {
      const res = await trx
        .updateTable('heat_maps')
        .set({ slot, position, updated_at: new Date() })
        .where('id', '=', id)
        .executeTakeFirst();
      if (!res.numUpdatedRows) throw missing('One of those maps does not exist.');
    }
  });
  return (await allMaps(db)).map(toAdmin);
}

// ── which question places a report ─────────────────────────────────────

/**
 * Every logbook and list, with the questions that could feed a map.
 *
 * A LOGBOOK WITH NO LOCATION QUESTION IS STILL LISTED, with no places, because
 * that is what an operator most needs to see: "this one cannot be mapped,
 * and here is why". A panel that left it out would leave somebody looking
 * for a logbook that is right there.
 */
export async function candidates(
  db: Database,
): Promise<{ logbooks: LogbookCandidate[]; lists: ListCandidate[] }> {
  const rows = await db
    .selectFrom('logbooks as lb')
    .leftJoin('logbook_fields as f', 'f.logbook_id', 'lb.id')
    .leftJoin('map_place_questions as q', 'q.logbook_id', 'lb.id')
    .select([
      'lb.id',
      'lb.slug',
      'lb.title',
      'lb.launched_at',
      'q.field_key as place_key',
      'f.key',
      'f.kind',
      'f.label',
      'f.settings',
    ])
    .orderBy('lb.title')
    .orderBy('lb.id')
    .orderBy('f.position')
    .orderBy('f.id')
    .execute();
  const books = new Map<number, LogbookCandidate>();
  for (const r of rows) {
    let b = books.get(r.id);
    if (!b) {
      b = {
        id: r.id,
        slug: r.slug,
        title: r.title,
        launched: r.launched_at !== null,
        place_key: r.place_key,
        places: [],
        outcomes: [],
      };
      books.set(r.id, b);
    }
    if (r.key === null || r.kind === null || r.label === null) continue;
    const q = { key: r.key, label: r.label, kind: r.kind };
    if (r.kind === LOCATION_TYPE) b.places.push(q);
    if (OUTCOME_KINDS.has(r.kind))
      b.outcomes.push({ ...q, options: answersOf(r.kind, r.settings) });
  }

  const listRows = await db
    .selectFrom('lists as l')
    .leftJoin('list_fields as f', (j) =>
      j.onRef('f.list_id', '=', 'l.id').on('f.kind', '=', LOCATION_TYPE),
    )
    .leftJoin('map_list_place_questions as q', 'q.list_id', 'l.id')
    .select([
      'l.id',
      'l.slug',
      'l.title',
      'q.field_key as place_key',
      'f.key',
      'f.label',
      'f.kind',
      'f.retention',
    ])
    .orderBy('l.title')
    .orderBy('l.id')
    .orderBy('f.position')
    .execute();
  const lists = new Map<number, ListCandidate>();
  for (const r of listRows) {
    let l = lists.get(r.id);
    if (!l) {
      l = { id: r.id, slug: r.slug, title: r.title, place_key: r.place_key, places: [] };
      lists.set(r.id, l);
    }
    if (r.key === null || r.label === null || r.kind === null) continue;
    l.places.push({ key: r.key, label: r.label, kind: r.kind, durable: r.retention === 'durable' });
  }
  return { logbooks: [...books.values()], lists: [...lists.values()] };
}

/**
 * Mark the question that places a logbook's reports, or clear it (`null`).
 *
 * NO LAUNCH GATE. Nothing here is in the sealed form definition, so a
 * logbook that has collected reports for a year (the one somebody most wants
 * to map) can be put on a map without rehashing anything. At most one per
 * logbook is the table's primary key, so marking another replaces it.
 */
export async function setLogbookPlace(
  db: Database,
  logbookId: number,
  key: unknown,
): Promise<void> {
  const lb = await db
    .selectFrom('logbooks')
    .select('id')
    .where('id', '=', logbookId)
    .executeTakeFirst();
  if (!lb) throw missing('That logbook does not exist.');
  if (key === null) {
    await db.deleteFrom('map_place_questions').where('logbook_id', '=', logbookId).execute();
    return;
  }
  const field = await db
    .selectFrom('logbook_fields')
    .select('kind')
    .where('logbook_id', '=', logbookId)
    .where('key', '=', typeof key === 'string' ? key : '')
    .executeTakeFirst();
  if (!field) throw refused('place', 'That logbook has no such question.');
  if (field.kind !== LOCATION_TYPE) {
    throw refused(
      'place',
      'Only a “Location on a map” question can place a report. A written place is free text, so its answers cannot be counted.',
    );
  }
  await db
    .insertInto('map_place_questions')
    .values({ logbook_id: logbookId, field_key: key as string })
    .onConflict((oc) =>
      oc.column('logbook_id').doUpdateSet({ field_key: key as string, marked_at: new Date() }),
    )
    .execute();
}

/**
 * The same for a list. NO LAUNCH GATE either: a list's form stays editable
 * for its whole life and nothing about an entry is sealed.
 */
export async function setListPlace(db: Database, listId: number, key: unknown): Promise<void> {
  const list = await db
    .selectFrom('lists')
    .select('id')
    .where('id', '=', listId)
    .executeTakeFirst();
  if (!list) throw missing('That list does not exist.');
  if (key === null) {
    await db.deleteFrom('map_list_place_questions').where('list_id', '=', listId).execute();
    return;
  }
  const field = await db
    .selectFrom('list_fields')
    .select(['kind', 'retention'])
    .where('list_id', '=', listId)
    .where('key', '=', typeof key === 'string' ? key : '')
    .executeTakeFirst();
  if (!field) throw refused('place', 'That list has no such question.');
  if (field.kind !== LOCATION_TYPE) {
    throw refused('place', 'Only a “Location on a map” question can place an entry.');
  }
  // THE MAP READS ONLY WHAT IS KEPT. A question whose answers the sweep
  // erases would make a published count shrink on its own months later.
  if (field.retention !== 'durable') {
    throw refused(
      'place',
      'That question’s answers are erased after a while, so a map counting them would shrink by itself. Keep its answers first.',
    );
  }
  await db
    .insertInto('map_list_place_questions')
    .values({ list_id: listId, field_key: key as string })
    .onConflict((oc) =>
      oc.column('list_id').doUpdateSet({ field_key: key as string, marked_at: new Date() }),
    )
    .execute();
}
