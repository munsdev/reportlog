/**
 * Review, in bulk.
 *
 * NOTHING IS COUNTED PUBLICLY UNTIL A MODERATOR APPROVES IT. The difference
 * from a logbook is the UNIT of review, not whether there is one: a page of
 * entries is skimmed and approved together.
 *
 * SO THE PAGE HAS TO SHOW WHAT MAKES SKIMMING SAFE, because a reviewer
 * approving fifty rows can only catch what the page puts in front of them: the
 * host of every link with unfamiliar ones marked, and the busiest minutes (a
 * flood is only ever visible as a cluster, never row by row). Each link also
 * says which group it is in and how that group was checked (links/).
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
import { fieldsOf } from './rows.ts';
import type { Db, LoadedList } from './rows.ts';
import { refOf } from '../moderation/texts/ref.ts';
import { openValue } from '../links/keys.ts';
import type { LinkKeys } from '../links/keys.ts';
import { linksForEntries } from '../links/reads.ts';
import type { Outcome } from '../links/rows.ts';

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
  links: {
    field_key: string;
    url: string;
    host: string;
    known_host: boolean;
    group_id: number;
    outcome: Outcome | null;
    /** What kind of link the tip said it is, in words, where its form asked. */
    kind?: string;
    /** The group's comment for journalists, edited beside the verdict. */
    comment: string | null;
  }[];
  /** Its tip descriptions, named for the written-account routes. Never the words. */
  texts: { ref: string; field_key: string; outcome: 'redacted' | 'withheld' | null }[];
}

/**
 * The shape of a burst. There is no "one address sending many" any more: no
 * network address is kept, hashed or not (owner ruling 40).
 */
export interface Clusters {
  busiest_minutes: { minute: string; count: number }[];
}

/**
 * The work an entry holds, for the review page's filters (owner, 29 October
 * 2026): staff filters on a staff queue, not filters on public data. Read
 * over `list_entries`.
 *
 * A written account is a tip description: a long answer still held, on a
 * list that asks for a link. The same rule as the written-account candidates
 * (moderation/texts/items.ts, CANDIDATES), so the filter finds what the hub
 * offers to check.
 */
const holdsUncheckedLink = sql<boolean>`exists (
  select 1 from links fl join link_groups fg on fg.id = fl.group_id
   where fl.entry_id = list_entries.id and fg.outcome is null)`;
const holdsWritten = sql<boolean>`(list_entries.erasable_answers is not null and exists (
  select 1 from list_fields tf
   where tf.list_id = list_entries.list_id and tf.kind = 'long_text'
     and jsonb_exists(list_entries.erasable_answers, tf.key))
  and exists (select 1 from list_fields uf
               where uf.list_id = list_entries.list_id and uf.kind = 'url'))`;

/** How many waiting entries hold each kind of work, for the lists overview. */
export async function waitingWork(
  db: Db,
  listId: number,
): Promise<{ with_links: number; with_written: number }> {
  const r = await db
    .selectFrom('list_entries')
    .select([
      sql<string>`count(*) filter (where ${holdsUncheckedLink})`.as('links'),
      sql<string>`count(*) filter (where ${holdsWritten})`.as('written'),
    ])
    .where('list_id', '=', listId)
    .where('review_state', '=', 'received')
    .executeTakeFirstOrThrow();
  return { with_links: Number(r.links), with_written: Number(r.written) };
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
    keys = null,
    links: onlyLinks = false,
    written: onlyWritten = false,
  }: {
    state?: ReviewState;
    limit?: number;
    knownHosts?: readonly string[];
    /** Without them the links are not shown; none can have been taken either. */
    keys?: LinkKeys | null;
    /** Only entries holding a link nobody has judged yet. */
    links?: boolean;
    /** Only entries holding a tip description. */
    written?: boolean;
  } = {},
): Promise<{ entries: ReviewEntry[]; clusters: Clusters }> {
  const size = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  let q = db.selectFrom('list_entries');
  if (onlyLinks) q = q.where(holdsUncheckedLink);
  if (onlyWritten) q = q.where(holdsWritten);
  const rows = await q
    .select([
      'id',
      'created_at',
      'review_state',
      'triage_state',
      'answers',
      'erasable_answers',
      'email_enc',
      'erased_at',
    ])
    .where('list_id', '=', listId)
    .where('review_state', '=', state)
    .orderBy('created_at')
    .orderBy('id')
    .limit(size)
    .execute();
  const ids = rows.map((r) => r.id);
  const links = keys ? await linksForEntries(db, keys, ids) : [];
  // The words for each kind of link, from the question that asked it.
  const fields = await fieldsOf(db, listId);
  const kindOf = (l: { field_key: string; link_type: string | null }) =>
    l.link_type
      ? (fields
          .find((f) => f.key === l.field_key)
          ?.settings.link_types?.find((t) => t.code === l.link_type)?.label ?? l.link_type)
      : undefined;
  const known = new Set(knownHosts.map((h) => h.trim().toLowerCase()));
  // Tip descriptions: only on a list that asks for a link, as CANDIDATES says.
  const textKeys = fields.some((f) => f.kind === 'url')
    ? fields.filter((f) => f.kind === 'long_text').map((f) => f.key)
    : [];
  const decided =
    textKeys.length && ids.length
      ? await db
          .selectFrom('text_items')
          .select(['entry_id', 'field_key', 'outcome'])
          .where('entry_id', 'in', ids)
          .execute()
      : [];
  const outcomeOf = (entryId: number, key: string) => {
    const o = decided.find((d) => d.entry_id === entryId && d.field_key === key)?.outcome;
    // An old `checked` (the retired "as written") is read as waiting (texts/items.ts).
    return o === 'redacted' || o === 'withheld' ? o : null;
  };

  const entries: ReviewEntry[] = rows.map((r) => ({
    id: r.id,
    created_at: new Date(r.created_at).toISOString(),
    review_state: r.review_state as ReviewState,
    triage_state: r.triage_state as TriageState,
    answers: asAnswers(r.answers),
    // Shown to a MODERATOR, the one person who has to read it to do their job.
    // Not published, and still swept on schedule.
    erasable_answers: r.erasable_answers === null ? null : asAnswers(r.erasable_answers),
    has_email: r.email_enc !== null,
    erased: r.erased_at !== null,
    links: links
      .filter((l) => l.entry_id === r.id)
      .map((l) => {
        const kind = kindOf(l);
        return {
          field_key: l.field_key,
          url: l.url,
          host: l.host ?? '',
          known_host: known.has((l.host ?? '').toLowerCase()),
          group_id: l.group_id,
          outcome: l.outcome,
          ...(kind ? { kind } : {}),
          comment: l.comment,
        };
      }),
    texts: textKeys
      .filter((k) => r.erasable_answers !== null && k in asAnswers(r.erasable_answers))
      .map((k) => ({
        ref: refOf({ source: 'tip', entryId: r.id, fieldKey: k }),
        field_key: k,
        outcome: outcomeOf(r.id, k),
      })),
  }));
  return { entries, clusters: clustersIn(entries) };
}

/**
 * The same minute, whatever the source: the shape of a burst. Fifty entries
 * in a minute is usually a local radio mention, the system working; the
 * page shows it so a reviewer looks before approving the lot. Timestamps are
 * durable, so the shape of a flood survives the sweep.
 */
export function clustersIn(entries: readonly { id: number; created_at: string }[]): Clusters {
  const byMinute = new Map<string, number>();
  for (const e of entries) {
    const minute = new Date(e.created_at).toISOString().slice(0, 16);
    byMinute.set(minute, (byMinute.get(minute) ?? 0) + 1);
  }
  const busiest = [...byMinute.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([minute, count]) => ({ minute, count }));
  return { busiest_minutes: busiest };
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

/**
 * Open ONE entry's address for a reviewer, on a list that writes back.
 *
 * THE RECORD IS WRITTEN FIRST and the address is decrypted second, so a look
 * that failed to log cannot have happened. Only who, which entry and when are
 * kept: never the address, which would make the log a second copy of it.
 * A list that does not write back refuses before anything is read, so turning
 * the switch off closes this at once, whatever the page still shows.
 */
export async function revealAddress(
  db: Db,
  keys: LinkKeys,
  list: Pick<LoadedList, 'id' | 'write_back'>,
  entryId: number,
  staffEmail: string,
): Promise<{ address: string }> {
  if (!list.write_back) return refuse('no-write-back');
  const row = await db
    .selectFrom('list_entries')
    .select(['id', 'email_enc', 'email_key'])
    .where('list_id', '=', list.id)
    .where('id', '=', entryId)
    .executeTakeFirst();
  if (!row) return refuse('no-entry');
  // Erased, or never given: nothing to open and nothing to record.
  if (!row.email_enc || !row.email_key) return refuse('no-address');
  await db
    .insertInto('list_address_reveals')
    .values({ staff_email: staffEmail, list_id: list.id, entry_id: row.id })
    .execute();
  return { address: openValue(keys, row.email_enc, row.email_key) };
}
