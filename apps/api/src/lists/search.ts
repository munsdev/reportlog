/**
 * Finding a person's entries, for a subject access request.
 *
 * "What do you hold about me" is answered from the erasable half, because
 * that is where a person is: what they wrote, and their address. The durable
 * half is choices, with nobody in it, so it is not searched.
 *
 * THE ADDRESS IS ENCRYPTED (owner ruling 40), so it is not in the text index:
 * a query that is an email address is looked up by its keyed digest instead,
 * and the address is never decrypted to answer it.
 *
 * WHAT HAS BEEN ERASED IS NOT FOUND, because it is not there. The index covers
 * only columns the sweep empties, so a blanked entry stops matching the moment
 * it is blanked. Its words' bytes leave the index itself when the sweep
 * rebuilds it (`rebuildTextIndex`): a GIN index keeps an erased key in its
 * pages, VACUUM or no VACUUM, until it is built again.
 *
 * Administrators only, across every list. A moderator reads one list's queue
 * to do their job; searching everybody's words for one person's is a
 * different power.
 */
import type { AnswerValue } from '@reportlog/fields';
import { sql } from 'kysely';
import { emailDigest } from '../links/keys.ts';
import type { LinkKeys } from '../links/keys.ts';
import type { ReviewState, TriageState } from './policy.ts';
import { refuse } from './refusals.ts';
import { iso } from './rows.ts';
import type { Db } from './rows.ts';

/**
 * THE INDEXED EXPRESSION, character for character as migration
 * 20261019205538_list_search.sql has it. Postgres uses an expression index
 * only for the same expression, so a drifted copy here would quietly read
 * every row; test/db/lists-search.test.ts checks the plan.
 */
const DOCUMENT = sql`(jsonb_to_tsvector('simple'::regconfig, coalesce(erasable_answers, '{}'::jsonb), '["string"]'::jsonb))`;

const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export const INDEX_NAME = 'list_entries_text_idx';

/** As legacy's report search: longer than this is not somebody's name. */
export const MAX_QUERY = 200;
export const MAX_RESULTS = 200;

type Answers = Record<string, AnswerValue>;

export interface FoundEntry {
  id: number;
  list_id: number;
  created_at: string;
  review_state: ReviewState;
  triage_state: TriageState;
  answers: Answers;
  erasable_answers: Answers | null;
  /**
   * The address searched for, when this entry is under it. Never decrypted:
   * an entry found by its words says only whether it has an address.
   */
  email: string | null;
  has_email: boolean;
  /** When the clock erases the personal half. Null: kept until its holder erases it. */
  personal_expires_at: string | null;
}

export interface FoundList {
  id: number;
  slug: string;
  title: string;
  fields: { key: string; label: string }[];
}

const asAnswers = (v: unknown): Answers =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Answers) : {};

/**
 * Every entry whose erasable half matches `q`, newest first.
 *
 * `websearch_to_tsquery`, as legacy's report search, because it takes whatever
 * a person types: quoted phrases, `or`, `-word` and stray punctuation all
 * parse, where `to_tsquery` would throw at them.
 */
export async function searchEntries(
  db: Db,
  q: unknown,
  { limit = MAX_RESULTS, keys = null }: { limit?: number; keys?: LinkKeys | null } = {},
): Promise<{ query: string; entries: FoundEntry[]; lists: FoundList[]; more: boolean }> {
  const query = typeof q === 'string' ? q.trim() : '';
  if (!query) refuse('search-empty');
  if (query.length > MAX_QUERY) refuse('search-too-long');
  const size = Math.min(Math.max(Math.floor(limit) || MAX_RESULTS, 1), MAX_RESULTS);
  const digest = keys && LOOKS_LIKE_EMAIL.test(query) ? emailDigest(keys, query) : null;

  // One more than asked, to say whether there are more without counting.
  const rows = await db
    .selectFrom('list_entries')
    .select([
      'id',
      'list_id',
      'created_at',
      'review_state',
      'triage_state',
      'answers',
      'erasable_answers',
      'email_hmac',
      'personal_expires_at',
    ])
    .where((eb) => {
      const words = sql<boolean>`${DOCUMENT} @@ websearch_to_tsquery('simple'::regconfig, ${query})`;
      return digest ? eb.or([words, eb('email_hmac', '=', digest)]) : words;
    })
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(size + 1)
    .execute();
  const more = rows.length > size;
  const page = rows.slice(0, size);

  const listIds = [...new Set(page.map((r) => r.list_id))];
  const [lists, fields] = listIds.length
    ? await Promise.all([
        db
          .selectFrom('lists')
          .select(['id', 'slug', 'title'])
          .where('id', 'in', listIds)
          .orderBy('title')
          .execute(),
        db
          .selectFrom('list_fields')
          .select(['list_id', 'key', 'label'])
          .where('list_id', 'in', listIds)
          .orderBy('position')
          .execute(),
      ])
    : [[], []];

  return {
    query,
    more,
    entries: page.map((r) => ({
      id: r.id,
      list_id: r.list_id,
      created_at: new Date(r.created_at).toISOString(),
      review_state: r.review_state as ReviewState,
      triage_state: r.triage_state as TriageState,
      answers: asAnswers(r.answers),
      erasable_answers: r.erasable_answers === null ? null : asAnswers(r.erasable_answers),
      email: digest !== null && r.email_hmac === digest ? query.toLowerCase() : null,
      has_email: r.email_hmac !== null,
      personal_expires_at: iso(r.personal_expires_at),
    })),
    lists: lists.map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      fields: fields.filter((f) => f.list_id === l.id).map((f) => ({ key: f.key, label: f.label })),
    })),
  };
}

/**
 * Long enough to cover a sweep that did not run for a while: an entry erased
 * in this window may still have its words in the index's pages.
 */
export const REBUILD_WINDOW_DAYS = 31;

/**
 * BUILD THE TEXT INDEX AGAIN, SO AN ERASED WORD IS NOT IN IT AT ALL.
 *
 * A blanked entry stops matching at once. But GIN keeps every key it ever
 * held in its pages, and VACUUM only drops the row pointers under one, so
 * somebody reading the index's files could still learn that a word was
 * written. Rebuilding is the only thing that removes it.
 *
 * Only when something was erased recently, by the clock or by its holder's
 * link: otherwise there is nothing new to take out. `CONCURRENTLY`, so
 * entries keep arriving meanwhile; that cannot run inside a transaction, which
 * the sweep does not open.
 *
 * A rebuild that fails half way leaves an invalid copy (`…_ccnew`) built
 * from the same rows, erased words and all, so any left over is dropped first.
 *
 * Returns 1 if it rebuilt, 0 if there was nothing to do.
 */
export async function rebuildTextIndex(
  db: Db,
  { windowDays = REBUILD_WINDOW_DAYS }: { windowDays?: number } = {},
): Promise<number> {
  const leftover = await sql<{ name: string }>`
    SELECT c.relname AS name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema()
       AND c.relname LIKE ${`${INDEX_NAME}\\_ccnew%`}
       AND NOT i.indisvalid`.execute(db);
  for (const { name } of leftover.rows) {
    await sql`DROP INDEX CONCURRENTLY IF EXISTS ${sql.id(name)}`.execute(db);
  }

  const recent = await db
    .selectFrom('list_entries')
    .select('id')
    .where('erased_at', '>=', sql<Date>`now() - make_interval(days => ${Math.ceil(windowDays)})`)
    .limit(1)
    .executeTakeFirst();
  if (!recent) return 0;
  await sql`REINDEX INDEX CONCURRENTLY ${sql.id(INDEX_NAME)}`.execute(db);
  return 1;
}
