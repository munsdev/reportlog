/**
 * Counting a list, for whatever asks.
 *
 * WHAT THIS IS FOR. A tool — a tally on a page, a breakdown by state,
 * something not written yet — should be able to ask "how many entries have
 * this or that" and get an answer, without doing arithmetic of its own and
 * without ever being handed a row.
 *
 * TWO STRUCTURAL GUARANTEES, both in the shape rather than in the care of
 * whoever writes the next query:
 *
 *   1. EVERY QUERY HERE READS `answers` AND NEVER `erasable_answers`. The
 *      durable and erasable halves are different COLUMNS, so a count
 *      cannot reach anything the sweep is going to blank, and cannot reach
 *      anything a person typed. There is no filter to remember.
 *
 *   2. ONLY FIELDS AN OPERATOR TICKED ARE COUNTABLE. A key that is not
 *      marked `aggregatable` is refused by name, so asking for one is an
 *      error rather than a silent disclosure. A contact form ticks nothing,
 *      so a tool that asks it finds nothing — WHICH IS THE ANSWER, not a
 *      failure.
 *
 * RECEIVED AND APPROVED ARE BOTH REPORTED, ALWAYS AND SEPARATELY. Counting
 * only approved understates what was collected; counting everything
 * publishes a figure about content no moderator cleared. Reporting both is
 * honest about volume AND makes the review backlog visible, which is itself
 * accountability — it answers "are you sitting on submissions" before
 * anybody asks. It also shows a flood as received far exceeding approved,
 * visible rather than paused, which is what the cut spike freeze was
 * reaching for.
 *
 * NOTHING HERE PUBLISHES ANYTHING. These are reads. What crosses into the
 * transparency log is `snapshotDocument`, and that is called by a script an
 * operator runs, not by this module.
 */
import { pool } from '../db.js';

/** The fields an operator has ticked as countable, in form order. */
export function aggregatableFields(list) {
  return (list.fields || []).filter((f) => f.aggregatable && f.retention !== 'absent');
}

/**
 * The definition a count was computed under: which fields were countable,
 * and what they were called.
 *
 * A SNAPSHOT SEALS THIS, for the same reason a report seals `logbook_form`.
 * A list's form stays editable — that is most of what makes it the lighter
 * format — so two counts taken a week apart may have been computed over
 * different questions. Without the definition beside the number, a reader
 * seeing the series jump would conclude something happened in the world
 * when something happened in the configuration.
 */
export function definitionOf(list) {
  return aggregatableFields(list).map((f) => ({
    key: f.key,
    label: f.label,
    kind: f.kind,
    options: f.options ?? null,
  }));
}

function assertCountable(list, key) {
  const field = aggregatableFields(list).find((f) => f.key === key);
  if (!field) {
    throw new Error(
      `${key} is not countable on ${list.slug}: a field is counted only when an `
      + 'operator ticks it, and free text can never be',
    );
  }
  return field;
}

/** Received and approved for a whole list. */
export async function totalsFor(list, { client = pool, since = null, until = null } = {}) {
  const { rows } = await client.query(
    `SELECT count(*) AS received,
            count(*) FILTER (WHERE review_state = 'approved') AS approved,
            count(*) FILTER (WHERE review_state = 'rejected') AS rejected,
            max(created_at) AS last_entry
       FROM list_entries
      WHERE list_id = $1
        AND ($2::timestamptz IS NULL OR created_at >= $2)
        AND ($3::timestamptz IS NULL OR created_at <  $3)`,
    [list.id, since, until],
  );
  const r = rows[0];
  return {
    received: Number(r.received),
    approved: Number(r.approved),
    rejected: Number(r.rejected),
    // The "last updated" line that belongs wherever a count appears.
    lastEntry: r.last_entry,
  };
}

/**
 * Value counts for one countable field.
 *
 * Handles a multi-answer field (choice_many) by expanding its array, so an
 * entry that ticked two boxes counts once under each — which is what
 * somebody asking "how many mentioned X" means. A scalar is wrapped in a
 * one-element array and goes down the same path, so there is one code path
 * rather than two that can disagree.
 */
export async function fieldValueCounts(
  list, key, { client = pool, since = null, until = null } = {},
) {
  const field = assertCountable(list, key);
  const { rows } = await client.query(
    `SELECT val AS value,
            count(*) AS received,
            count(*) FILTER (WHERE e.review_state = 'approved') AS approved
       FROM list_entries e
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(e.answers -> $2) = 'array'
              THEN e.answers -> $2
              ELSE jsonb_build_array(e.answers -> $2)
         END
       ) AS val
      WHERE e.list_id = $1
        AND e.answers ? $2
        AND ($3::timestamptz IS NULL OR e.created_at >= $3)
        AND ($4::timestamptz IS NULL OR e.created_at <  $4)
      GROUP BY val
      ORDER BY count(*) DESC, val`,
    [list.id, key, since, until],
  );
  return {
    key,
    label: field.label,
    kind: field.kind,
    values: rows.map((r) => ({
      value: r.value,
      received: Number(r.received),
      approved: Number(r.approved),
    })),
  };
}

/**
 * Everything countable about a list, in one answer.
 *
 * This is the shape a tool should ask for: the definition, the totals, and
 * a breakdown per countable field. A list with nothing ticked comes back
 * with an empty definition and no breakdowns, and its totals only.
 */
export async function summaryFor(
  slugOrList, { client = pool, since = null, until = null } = {},
) {
  const list = typeof slugOrList === 'string'
    ? await loadList(slugOrList, { client })
    : slugOrList;
  if (!list) return null;

  const fields = aggregatableFields(list);
  const breakdowns = [];
  for (const f of fields) {
    breakdowns.push(await fieldValueCounts(list, f.key, { client, since, until }));
  }
  return {
    slug: list.slug,
    title: list.title,
    aggregatesPublished: list.aggregates_published === true,
    definition: definitionOf(list),
    totals: await totalsFor(list, { client, since, until }),
    fields: breakdowns,
  };
}

/**
 * A cross-tabulation over several countable fields at once — "how many in
 * each state, by category".
 *
 * Single-value fields only. Crossing two multi-answer fields multiplies
 * rows in a way nobody reading the result would expect, so it is refused
 * rather than quietly produced.
 */
export async function crossTabFor(
  list, keys = [], { client = pool, since = null, until = null } = {},
) {
  if (!keys.length) throw new Error('a cross-tabulation needs at least one field');
  const fields = keys.map((k) => assertCountable(list, k));
  for (const f of fields) {
    if (f.kind === 'choice_many') {
      throw new Error(
        `${f.key} can hold several answers, so crossing it would multiply rows — `
        + 'ask for its value counts on their own instead',
      );
    }
  }
  // The keys are parameters, never interpolated: they reach the query as
  // $4, $5, … so a field key can never be SQL. They are whitelisted
  // against the list's own ticked fields above as well.
  const sel = keys.map((_, i) => `e.answers ->> $${i + 4} AS k${i}`).join(', ');
  const grp = keys.map((_, i) => `k${i}`).join(', ');
  const { rows } = await client.query(
    `SELECT ${sel},
            count(*) AS received,
            count(*) FILTER (WHERE e.review_state = 'approved') AS approved
       FROM list_entries e
      WHERE e.list_id = $1
        AND ($2::timestamptz IS NULL OR e.created_at >= $2)
        AND ($3::timestamptz IS NULL OR e.created_at <  $3)
      GROUP BY ${grp}
      ORDER BY count(*) DESC`,
    [list.id, since, until, ...keys],
  );
  return rows.map((r) => {
    const values = {};
    keys.forEach((k, i) => { values[k] = r[`k${i}`]; });
    return { values, received: Number(r.received), approved: Number(r.approved) };
  });
}

/** Load a list and its form. Kept here so a caller needs one import. */
export async function loadList(slug, { client = pool } = {}) {
  const { rows } = await client.query('SELECT * FROM lists WHERE slug = $1', [slug]);
  if (!rows[0]) return null;
  const { rows: fields } = await client.query(
    'SELECT * FROM list_fields WHERE list_id = $1 ORDER BY position, id', [rows[0].id],
  );
  return { ...rows[0], fields };
}

/**
 * The deduplicated link layer, which is a count of its own and belongs to
 * no single list.
 *
 * Ranked by how many people sent each one, because that is the useful fact.
 * No description, no submitter: there is nobody in this table.
 */
export async function linkCounts({ client = pool, limit = 100, minCount = 1 } = {}) {
  const { rows } = await client.query(
    `SELECT url_key, host, first_seen, last_seen, submission_count
       FROM link_index
      WHERE submission_count >= $1
      ORDER BY submission_count DESC, last_seen DESC
      LIMIT $2`,
    [minCount, Math.min(Number(limit) || 100, 1000)],
  );
  return rows.map((r) => ({
    urlKey: r.url_key,
    host: r.host,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    submissionCount: Number(r.submission_count),
  }));
}

export const SNAPSHOT_FORMAT = 1;

/**
 * The document that would go beside the anchor.
 *
 * ONLY LISTS WHOSE AGGREGATES AN OPERATOR PUBLISHED. The internal reads
 * above answer for any list, because a tool inside the app asking a
 * question is not publication. This one is the boundary, so it reads the
 * switch.
 *
 * WIRED INTO scripts/anchor.js as a file
 * of its own — counts/<date>.json with its own timestamp — rather than a
 * change to the anchor's format. src/countsFile.js says why.
 */
export async function snapshotDocument({ client = pool, since = null, until = null } = {}) {
  // LISTED AND PUBLISHED, the same two conditions as the public counts
  // route. A hidden list somebody ticked by mistake must not go into a log
  // that is never rewritten.
  const { rows } = await client.query(
    "SELECT slug FROM lists WHERE aggregates_published AND visibility = 'listed' ORDER BY slug",
  );
  const lists = [];
  for (const r of rows) {
    lists.push(await summaryFor(r.slug, { client, since, until }));
  }
  return {
    reportlog_list_aggregates: SNAPSHOT_FORMAT,
    generated_at: new Date().toISOString(),
    window: { since, until },
    lists,
  };
}
