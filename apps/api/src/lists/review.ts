/**
 * Review, in bulk.
 *
 * NOTHING IS COUNTED PUBLICLY UNTIL A MODERATOR APPROVES IT. The difference
 * from a logbook is the UNIT of review, not whether there is one: a page of
 * entries is skimmed and approved together.
 *
 * SO THE PAGE HAS TO SHOW WHAT MAKES SKIMMING SAFE, because a reviewer
 * approving fifty rows can only catch what the page puts in front of them: the
 * host of every link with unfamiliar ones marked, and clusters (a flood from
 * one source is only ever visible as a cluster, never row by row).
 *
 * REJECTING IS NOT DELETING. The row stays, the retention clock still governs
 * its erasable half, and a subject access request can still be answered about
 * it. Nothing here deletes anything.
 */
import { sql } from 'kysely';
import type { AnswerValue } from '@reportlog/fields';
import { REVIEW_STATES, TRIAGE_STATES } from './policy.ts';
import type { ReviewState, TriageState } from './policy.ts';
import { refuse } from './refusals.ts';
import type { Db } from './rows.ts';

type Answers = Record<string, AnswerValue>;

export interface ReviewEntry {
  id: number;
  created_at: string;
  review_state: ReviewState;
  triage_state: TriageState;
  answers: Answers;
  erasable_answers: Answers | null;
  has_email: boolean;
  erased: boolean;
  links: { field_key: string; url_raw: string; host: string; known_host: boolean }[];
}

export interface Clusters {
  repeated_submitters: number;
  largest_repeated_submitter: number;
  entries_from_repeated_submitters: number[];
  busiest_minutes: { minute: string; count: number }[];
}

const asAnswers = (v: unknown): Answers =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Answers) : {};

/**
 * A page of entries to review. `knownHosts` is the operator's familiar list:
 * it SORTS, never blocks. Nothing is rejected for being unfamiliar; it is just
 * where a reviewer's eye should go first.
 */
export async function reviewBatch(
  db: Db,
  listId: number,
  {
    state = 'received',
    limit = 100,
    knownHosts = [],
  }: { state?: ReviewState; limit?: number; knownHosts?: readonly string[] } = {},
): Promise<{ entries: ReviewEntry[]; clusters: Clusters }> {
  const size = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  const rows = await db
    .selectFrom('list_entries')
    .select([
      'id',
      'created_at',
      'review_state',
      'triage_state',
      'answers',
      'erasable_answers',
      'email',
      'ip_hash',
      'erased_at',
    ])
    .where('list_id', '=', listId)
    .where('review_state', '=', state)
    .orderBy('created_at')
    .orderBy('id')
    .limit(size)
    .execute();
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await db
        .selectFrom('list_entry_links')
        .select(['entry_id', 'field_key', 'url_raw', 'host'])
        .where('entry_id', 'in', ids)
        .orderBy('id')
        .execute()
    : [];
  const known = new Set(knownHosts.map((h) => h.trim().toLowerCase()));

  const entries: ReviewEntry[] = rows.map((r) => ({
    id: r.id,
    created_at: new Date(r.created_at).toISOString(),
    review_state: r.review_state as ReviewState,
    triage_state: r.triage_state as TriageState,
    answers: asAnswers(r.answers),
    // Shown to a MODERATOR, the one person who has to read it to do their job.
    // Not published, and still swept on schedule.
    erasable_answers: r.erasable_answers === null ? null : asAnswers(r.erasable_answers),
    has_email: r.email !== null,
    erased: r.erased_at !== null,
    links: links
      .filter((l) => l.entry_id === r.id)
      .map((l) => ({
        field_key: l.field_key,
        url_raw: l.url_raw,
        host: l.host,
        known_host: known.has(l.host.toLowerCase()),
      })),
  }));
  return { entries, clusters: clustersIn(entries, rows) };
}

/**
 * Suspicious sameness, which a reviewer cannot see row by row.
 *
 * Fifty check-ins from one state in one minute is usually a local radio
 * mention: the system working. Fifty from one hashed address is one person
 * pressing a button fifty times. They look identical in a list of timestamps,
 * and the hashed address is the only thing that tells them apart. THE HASH
 * NEVER LEAVES THIS FUNCTION: entries are grouped by it and the group is
 * reported by size. Reported, never acted on.
 */
export function clustersIn(
  entries: readonly { id: number; created_at: string }[],
  rows: readonly { ip_hash?: string | null }[] = [],
): Clusters {
  const byAddress = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const entry = entries[i];
    if (!r.ip_hash || !entry) return;
    const group = byAddress.get(r.ip_hash) ?? [];
    group.push(entry.id);
    byAddress.set(r.ip_hash, group);
  });
  const repeated = [...byAddress.values()].filter((ids) => ids.length > 1);

  // The same minute, whatever the source: the shape of a burst. Timestamps are
  // durable, so the shape of a flood survives the sweep.
  const byMinute = new Map<string, number>();
  for (const e of entries) {
    const minute = new Date(e.created_at).toISOString().slice(0, 16);
    byMinute.set(minute, (byMinute.get(minute) ?? 0) + 1);
  }
  const busiest = [...byMinute.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([minute, count]) => ({ minute, count }));

  return {
    repeated_submitters: repeated.length,
    largest_repeated_submitter: repeated.reduce((m, ids) => Math.max(m, ids.length), 0),
    entries_from_repeated_submitters: repeated.flat(),
    busiest_minutes: busiest,
  };
}

const idsOf = (ids: readonly unknown[]) =>
  ids.filter((n): n is number => typeof n === 'number' && Number.isInteger(n));

/**
 * Approve or reject THE IDS GIVEN, in one statement. Never "everything
 * matching": a reviewer approves the page they looked at, and a filter that
 * moved between the render and the click would approve rows nobody saw.
 */
export async function reviewEntries(
  db: Db,
  listId: number,
  ids: readonly unknown[],
  { state, by = null }: { state: string; by?: number | null },
): Promise<{ changed: number }> {
  if (!REVIEW_STATES.includes(state as ReviewState)) refuse('review-state');
  if (state === 'received') refuse('un-review');
  if (!ids.length || ids.length > 500) refuse('review-ids');
  const list = idsOf(ids);
  if (!list.length) return { changed: 0 };
  const out = await db
    .updateTable('list_entries')
    .set({ review_state: state, reviewed_at: sql<Date>`now()`, reviewed_by: by })
    .where('list_id', '=', listId)
    .where('id', 'in', list)
    .executeTakeFirst();
  return { changed: Number(out.numUpdatedRows) };
}

export async function setTriageState(
  db: Db,
  listId: number,
  ids: readonly unknown[],
  state: string,
): Promise<{ changed: number }> {
  if (!TRIAGE_STATES.includes(state as TriageState)) refuse('triage-state');
  if (ids.length > 500) refuse('review-ids');
  const list = idsOf(ids);
  if (!list.length) return { changed: 0 };
  const out = await db
    .updateTable('list_entries')
    .set({ triage_state: state })
    .where('list_id', '=', listId)
    .where('id', 'in', list)
    .executeTakeFirst();
  return { changed: Number(out.numUpdatedRows) };
}

/** How much is waiting: the number that says whether anybody is reading. */
export async function pendingCount(
  db: Db,
  listId: number,
): Promise<{ waiting: number; oldest: string | null }> {
  const r = await db
    .selectFrom('list_entries')
    .select([sql<string>`count(*)`.as('waiting'), sql<Date | null>`min(created_at)`.as('oldest')])
    .where('list_id', '=', listId)
    .where('review_state', '=', 'received')
    .executeTakeFirstOrThrow();
  return { waiting: Number(r.waiting), oldest: r.oldest ? new Date(r.oldest).toISOString() : null };
}
