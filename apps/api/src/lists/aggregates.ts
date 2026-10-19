/**
 * Counting a list, for whatever asks.
 *
 * TWO GUARANTEES, both in the shape rather than in the care of whoever writes
 * the next query:
 *
 *   1. EVERY QUERY HERE READS `answers`, the durable half, AND NEVER THE OTHER
 *      ONE. They are different columns, so a count cannot reach anything the
 *      sweep is going to blank or anything a person typed. A unit test fails
 *      if this file ever names the erasable column.
 *   2. ONLY QUESTIONS AN OPERATOR TICKED ARE COUNTABLE. Asking for another is
 *      an error, not a silent disclosure. A contact form ticks nothing, so a
 *      tool that asks it finds nothing: that is the answer, not a failure.
 *
 * RECEIVED AND APPROVED ARE BOTH REPORTED, ALWAYS AND SEPARATELY. Counting
 * only approved understates what came in; counting everything publishes a
 * figure about content nobody cleared. Both together also make the review
 * backlog visible, which is itself accountability, and show a flood as
 * received far ahead of approved.
 *
 * These are reads. Publishing is `snapshotDocument`, and the public route.
 */
import { sql } from 'kysely';
import { optionsOf } from './fields.ts';
import { iso, listBySlug } from './rows.ts';
import type { Db, LoadedList, StoredField } from './rows.ts';

/** The questions an operator ticked as countable, in form order. */
export function aggregatableFields(list: LoadedList): StoredField[] {
  return list.fields.filter((f) => f.aggregatable && f.retention !== 'absent');
}

export interface CountDefinition {
  key: string;
  label: string;
  kind: string;
  options: string[] | null;
}

/**
 * The questions a count was computed under. A list's form is editable, so two
 * counts a week apart may be over different questions; without this beside
 * the number, a reader seeing a series jump would conclude something happened
 * in the world when something happened in the configuration. The same reason
 * a report seals the form it was answered against, applied to a number.
 */
export function definitionOf(list: LoadedList): CountDefinition[] {
  return aggregatableFields(list).map((f) => {
    const options = optionsOf(f);
    return { key: f.key, label: f.label, kind: f.kind, options: options.length ? options : null };
  });
}

/** A question nobody ticked, asked for anyway. */
export class NotCountable extends Error {
  override name = 'NotCountable';
}

function assertCountable(list: LoadedList, key: string): StoredField {
  const field = aggregatableFields(list).find((f) => f.key === key);
  if (!field) {
    throw new NotCountable(
      `${key} is not countable on ${list.slug}: a question is counted only when an operator ticks it, and free text never can be.`,
    );
  }
  return field;
}

export interface Window {
  since?: Date | null;
  until?: Date | null;
}

export interface Totals {
  received: number;
  approved: number;
  rejected: number;
  last_entry: string | null;
}

export async function totalsFor(db: Db, list: LoadedList, w: Window = {}): Promise<Totals> {
  let q = db
    .selectFrom('list_entries')
    .select([
      sql<string>`count(*)`.as('received'),
      sql<string>`count(*) FILTER (WHERE review_state = 'approved')`.as('approved'),
      sql<string>`count(*) FILTER (WHERE review_state = 'rejected')`.as('rejected'),
      sql<Date | null>`max(created_at)`.as('last_entry'),
    ])
    .where('list_id', '=', list.id);
  if (w.since) q = q.where('created_at', '>=', w.since);
  if (w.until) q = q.where('created_at', '<', w.until);
  const r = await q.executeTakeFirstOrThrow();
  return {
    received: Number(r.received),
    approved: Number(r.approved),
    rejected: Number(r.rejected),
    // The "last updated" line that belongs wherever a count appears.
    last_entry: iso(r.last_entry),
  };
}

export interface FieldCounts {
  key: string;
  label: string;
  kind: string;
  values: { value: string; received: number; approved: number }[];
}

/**
 * Answer counts for one countable question. A question taking several answers
 * is expanded, so an entry that ticked two boxes counts once under each (what
 * "how many mentioned X" means). A single answer is wrapped in a one-element
 * array and goes down the same path, so there is one way to count, not two
 * that can disagree.
 */
export async function fieldValueCounts(
  db: Db,
  list: LoadedList,
  key: string,
  w: Window = {},
): Promise<FieldCounts> {
  const field = assertCountable(list, key);
  const rows = await sql<{ value: string; received: string; approved: string }>`
    SELECT val AS value,
           count(*) AS received,
           count(*) FILTER (WHERE e.review_state = 'approved') AS approved
      FROM list_entries e
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(e.answers -> ${key}) = 'array'
            THEN e.answers -> ${key}
            ELSE jsonb_build_array(e.answers -> ${key})
       END) AS val
     WHERE e.list_id = ${list.id}
       AND e.answers ? ${key}
       AND (${w.since ?? null}::timestamptz IS NULL OR e.created_at >= ${w.since ?? null})
       AND (${w.until ?? null}::timestamptz IS NULL OR e.created_at < ${w.until ?? null})
     GROUP BY val
     ORDER BY count(*) DESC, val`.execute(db);
  return {
    key,
    label: field.label,
    kind: field.kind,
    values: rows.rows.map((r) => ({
      value: r.value,
      received: Number(r.received),
      approved: Number(r.approved),
    })),
  };
}

export interface Summary {
  slug: string;
  title: string;
  aggregates_published: boolean;
  definition: CountDefinition[];
  totals: Totals;
  fields: FieldCounts[];
}

/** Everything countable about a list in one answer: the shape a tool should ask for. */
export async function summaryFor(
  db: Db,
  listOrSlug: LoadedList | string,
  w: Window = {},
): Promise<Summary | null> {
  const list = typeof listOrSlug === 'string' ? await listBySlug(db, listOrSlug) : listOrSlug;
  if (!list) return null;
  const fields: FieldCounts[] = [];
  for (const f of aggregatableFields(list)) fields.push(await fieldValueCounts(db, list, f.key, w));
  return {
    slug: list.slug,
    title: list.title,
    aggregates_published: list.aggregates_published,
    definition: definitionOf(list),
    totals: await totalsFor(db, list, w),
    fields,
  };
}

/**
 * Several countable questions crossed: "how many in each state, by category".
 * Single-answer questions only: crossing a several-answer one multiplies rows
 * in a way nobody reading the result would expect, so it is refused.
 */
export async function crossTabFor(
  db: Db,
  list: LoadedList,
  keys: readonly string[],
): Promise<{ values: Record<string, string | null>; received: number; approved: number }[]> {
  if (!keys.length) throw new NotCountable('A cross-tabulation needs at least one question.');
  const fields = keys.map((k) => assertCountable(list, k));
  const many = fields.find((f) => f.kind === 'choice_many');
  if (many) {
    throw new NotCountable(
      `${many.key} can hold several answers, so crossing it would multiply rows. Ask for its counts on their own.`,
    );
  }
  // The keys reach the query as parameters, never as SQL, and were checked
  // against the list's own ticked questions above as well.
  const cols = keys.map((k, i) => sql`e.answers ->> ${k} AS ${sql.ref(`k${String(i)}`)}`);
  const groups = keys.map((_, i) => sql.ref(`k${String(i)}`));
  const rows = await sql<Record<string, string | null>>`
    SELECT ${sql.join(cols)},
           count(*) AS received,
           count(*) FILTER (WHERE e.review_state = 'approved') AS approved
      FROM list_entries e
     WHERE e.list_id = ${list.id}
     GROUP BY ${sql.join(groups)}
     ORDER BY count(*) DESC`.execute(db);
  return rows.rows.map((r) => ({
    values: Object.fromEntries(keys.map((k, i) => [k, r[`k${String(i)}`] ?? null])),
    received: Number(r.received),
    approved: Number(r.approved),
  }));
}

/**
 * The deduplicated link layer, ranked by how many people sent each one. No
 * description and no submitter: there is nobody in this table.
 */
export async function linkCounts(db: Db, { limit = 100, minCount = 1 } = {}) {
  const rows = await db
    .selectFrom('link_index')
    .select(['url_key', 'host', 'first_seen', 'last_seen', 'submission_count'])
    .where('submission_count', '>=', minCount)
    .orderBy('submission_count', 'desc')
    .orderBy('last_seen', 'desc')
    .limit(Math.min(Math.max(1, limit), 1000))
    .execute();
  return rows.map((r) => ({
    url_key: r.url_key,
    host: r.host,
    first_seen: iso(r.first_seen),
    last_seen: iso(r.last_seen),
    submission_count: r.submission_count,
  }));
}

export const SNAPSHOT_FORMAT = 1;

/**
 * The document that would go beside the daily anchor: counts for every list
 * an operator published. THIS IS THE PUBLICATION BOUNDARY, so it reads the
 * same two conditions as the public counts route, listed AND published: a
 * hidden list ticked by mistake must not go into a log that is never
 * rewritten.
 *
 * Not wired into the anchor yet (workstream D owns it). Legacy published it as
 * counts/<date>.json with its own digest and timestamp, never folded into the
 * anchor's own signed format.
 */
export async function snapshotDocument(db: Db, w: Window = {}) {
  const rows = await db
    .selectFrom('lists')
    .select('slug')
    .where('aggregates_published', '=', true)
    .where('visibility', '=', 'listed')
    .orderBy('slug')
    .execute();
  const lists: Summary[] = [];
  for (const r of rows) {
    const s = await summaryFor(db, r.slug, w);
    if (s) lists.push(s);
  }
  return {
    reportlog_list_aggregates: SNAPSHOT_FORMAT,
    generated_at: new Date().toISOString(),
    window: { since: iso(w.since ?? null), until: iso(w.until ?? null) },
    lists,
  };
}
