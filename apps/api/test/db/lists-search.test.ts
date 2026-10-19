/**
 * Finding a person's list entries, for a subject access request, against a
 * real database: the full-text index legacy's 046 kept over the erasable half.
 *
 * What only Postgres can show:
 *
 *   - THE SEARCH USES THE INDEX. Its expression is written twice (the
 *     migration and search.ts) and Postgres uses an expression index only for
 *     the same expression. A drifted copy still answers, slowly, so the plan
 *     is checked rather than the answer.
 *   - WHAT HAS BEEN ERASED IS NOT FOUND, by the sweep or by its holder's link.
 *   - AND IS NOT IN THE INDEX AT ALL once the sweep has run. GIN keeps an
 *     erased key in its pages after UPDATE and after VACUUM; the sweep
 *     rebuilds the index, and this reads the index's raw pages (pageinspect)
 *     to see the word gone. The probe is shown to work first, by finding the
 *     word there before the sweep.
 *   - Only an administrator may search, over HTTP.
 *
 * Other test files share this database, so every word looked for here is made
 * up for this run and appears nowhere else.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileEntry } from '../../src/lists/entries.ts';
import type { EntryInput } from '../../src/lists/entries.ts';
import { erasePersonal } from '../../src/lists/erasure.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { ListRefusal } from '../../src/lists/refusals.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import type { LoadedList } from '../../src/lists/rows.ts';
import { INDEX_NAME, MAX_QUERY, rebuildTextIndex, searchEntries } from '../../src/lists/search.ts';
import { sweepLists, sweepPersonal } from '../../src/lists/sweep.ts';
import { uniqueSlug } from './helpers.ts';
import { address, as, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let tips: LoadedList;
let contact: LoadedList;
// Letters only: the `simple` parser splits a word at a digit-to-letter change
// no more than at a space, but a made-up word is clearer for being one token.
const tag = (stem: string) =>
  `${stem}${(process.pid * 7919 + Date.now())
    .toString(36)
    .replace(/[0-9]/g, (d) => 'qwertyuiop'.charAt(Number(d)))}`;
const PERSON = tag('zorbelina');
const OTHER = tag('quillamor');
const SWEPT = tag('vexantor');
const LINKED = tag('drumbello');
const EMAIL = `${tag('sar')}@example.org`;

const file = (list: LoadedList, input: EntryInput) =>
  fileEntry(h.db, list.slug, input, { settings: DEFAULT_LIST_SETTINGS });

const tip = (description: string, email: string) =>
  file(tips, {
    answers: {
      links: `https://news-${tag('h')}.example.org/story`,
      state: 'Not sure',
      category: 'Not sure',
      description,
    },
    email,
    emailConsent: false,
  });

const found = async (q: string) => (await searchEntries(h.db, q)).entries.map((e) => e.id);

/**
 * How many of the index's pages hold these bytes. Reads the files Postgres
 * keeps, not a query's answer, so it sees what a copy of the disk would.
 */
async function pagesHolding(word: string): Promise<number> {
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n
      FROM generate_series(0, (pg_relation_size(${INDEX_NAME}::regclass) / current_setting('block_size')::int) - 1) AS b
     WHERE position(convert_to(${word}, 'UTF8') IN probe.get_raw_page(${INDEX_NAME}, b::int)) > 0`.execute(
    h.db,
  );
  return r.rows[0]?.n ?? 0;
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ListRefusal) return e.code;
    throw e;
  }
  return 'accepted';
}

beforeAll(async () => {
  h = await harness();
  // In a schema of its own, so nothing that reads the public schema sees it.
  await sql`CREATE SCHEMA IF NOT EXISTS probe`.execute(h.db);
  await sql`CREATE EXTENSION IF NOT EXISTS pageinspect SCHEMA probe`.execute(h.db);
  tips = await createFromTemplate(h.db, 'tips', { slug: uniqueSlug('sar-tips') });
  contact = await createFromTemplate(h.db, 'contact', { slug: uniqueSlug('sar-contact') });
});
afterAll(async () => {
  await h.close();
});

describe('finding somebody', () => {
  let one = 0;
  let two = 0;
  let three = 0;

  it('by what they wrote, on any list, newest first', async () => {
    one = (await tip(`Saw ${PERSON} handing out leaflets by the door.`, EMAIL)).id;
    two = (await tip(`Nothing to do with anybody, ${OTHER} only.`, `${tag('x')}@example.org`)).id;
    three = (
      await file(contact, {
        answers: { subject: 'A request', message: `This is ${PERSON}. What do you hold about me?` },
        email: EMAIL,
      })
    ).id;
    expect(await found(PERSON)).toEqual([three, one]);
    expect(await found(OTHER)).toEqual([two]);
  });

  it('by their address, which is held beside the answers and erased with them', async () => {
    expect(await found(EMAIL)).toEqual([three, one]);
    const r = await searchEntries(h.db, EMAIL);
    expect(r.entries.every((e) => e.email === EMAIL)).toBe(true);
    // Labels to read the answers by, for each list a match is on.
    expect(r.lists.map((l) => l.id).sort()).toEqual([tips.id, contact.id].sort());
    expect(r.lists.find((l) => l.id === tips.id)?.fields.map((f) => f.key)).toContain(
      'description',
    );
  });

  it('whatever is typed: case, phrases, "or", exclusions and stray punctuation', async () => {
    expect(await found(PERSON.toUpperCase())).toEqual([three, one]);
    expect(await found(`"${PERSON} handing out"`)).toEqual([one]);
    expect(await found(`${PERSON} or ${OTHER}`)).toEqual([three, two, one]);
    expect(await found(`${PERSON} -leaflets`)).toEqual([three]);
    expect(await found(`${PERSON} ((( & !`)).toEqual([three, one]);
    expect(await found('!!! &&& |||')).toEqual([]);
  });

  it('a stop word is a word: "will" and "may" are names', async () => {
    const id = (await tip(`Will ${OTHER}son and May were there.`, `${tag('w')}@example.org`)).id;
    expect(await found(`will ${OTHER}son`)).toEqual([id]);
  });

  it("never the durable half, and never a question's key", async () => {
    expect(await found('description')).not.toContain(one);
    expect(await found('Not sure')).not.toContain(one);
  });

  it('an empty search and one too long are refused with a sentence', async () => {
    expect(await refusal(searchEntries(h.db, '   '))).toBe('search-empty');
    expect(await refusal(searchEntries(h.db, undefined))).toBe('search-empty');
    expect(await refusal(searchEntries(h.db, 'a'.repeat(MAX_QUERY + 1)))).toBe('search-too-long');
  });

  it('says when there are more than it sent', async () => {
    const r = await searchEntries(h.db, `${PERSON} or ${OTHER}`, { limit: 2 });
    expect(r.entries).toHaveLength(2);
    expect(r.more).toBe(true);
  });

  it('THE SEARCH USES THE INDEX: its expression is the migration’s, character for character', async () => {
    // Forbid the alternatives, so a plan that cannot use the index reads as
    // a sequential scan rather than a choice the planner happened to make.
    const plan = await h.db.connection().execute(async (c) => {
      await sql`SET enable_seqscan = off`.execute(c);
      try {
        const compiled = c
          .selectFrom('list_entries')
          .select('id')
          .where(
            sql<boolean>`(jsonb_to_tsvector('simple'::regconfig, coalesce(erasable_answers, '{}'::jsonb), '["string"]'::jsonb) || to_tsvector('simple'::regconfig, coalesce(email, ''))) @@ websearch_to_tsquery('simple'::regconfig, ${PERSON})`,
          )
          .compile();
        const r = await c.executeQuery<{ 'QUERY PLAN': string }>({
          ...compiled,
          sql: `EXPLAIN ${compiled.sql}`,
        });
        return r.rows.map((row) => row['QUERY PLAN']).join('\n');
      } finally {
        await sql`RESET enable_seqscan`.execute(c);
      }
    });
    expect(plan).toContain(INDEX_NAME);
    // And the module's own copy: the source text above must be the module's.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../src/lists/search.ts', import.meta.url), 'utf8');
    const migration = await readFile(
      new URL('../../migrations/20261019205538_list_search.sql', import.meta.url),
      'utf8',
    );
    const expression =
      "jsonb_to_tsvector('simple'::regconfig, coalesce(erasable_answers, '{}'::jsonb), '[\"string\"]'::jsonb) || to_tsvector('simple'::regconfig, coalesce(email, ''))";
    expect(source).toContain(expression);
    expect(migration.replace(/\s+/g, ' ')).toContain(expression);
  });
});

describe('WHAT HAS BEEN ERASED IS NOT FOUND, AND IS NOT IN THE INDEX', () => {
  let swept = 0;
  let linked = 0;

  it('the probe works: before erasing, the words are in the index’s pages', async () => {
    swept = (await tip(`Only ${SWEPT} would know this.`, `${tag('s')}@example.org`)).id;
    linked = (await tip(`Ask ${LINKED} about it.`, `${tag('l')}@example.org`)).id;
    expect(await found(SWEPT)).toEqual([swept]);
    expect(await found(LINKED)).toEqual([linked]);
    expect(await pagesHolding(SWEPT)).toBeGreaterThan(0);
    expect(await pagesHolding(LINKED)).toBeGreaterThan(0);
  });

  it('erased by the clock or by the link, neither is found, at once', async () => {
    await h.db
      .updateTable('list_entries')
      .set({ personal_expires_at: sql<Date>`now() - interval '1 minute'` })
      .where('id', '=', swept)
      .execute();
    expect((await sweepPersonal(h.db)).list_entries).toBeGreaterThanOrEqual(1);
    expect(await erasePersonal(h.db, linked)).toBe(1);
    expect(await found(SWEPT)).toEqual([]);
    expect(await found(LINKED)).toEqual([]);
  });

  it('BUT THE BYTES ARE STILL IN THE INDEX, even after VACUUM: why the sweep rebuilds it', async () => {
    await sql`VACUUM list_entries`.execute(h.db);
    expect((await pagesHolding(SWEPT)) + (await pagesHolding(LINKED))).toBeGreaterThan(0);
  });

  it('after the sweep, neither word is anywhere in the index, and neither is found', async () => {
    const out = await sweepLists(h.db, { saltDays: DEFAULT_LIST_SETTINGS.saltDays });
    expect(out[INDEX_NAME]).toBe(1);
    expect(await pagesHolding(SWEPT)).toBe(0);
    expect(await pagesHolding(LINKED)).toBe(0);
    expect(await found(SWEPT)).toEqual([]);
    expect(await found(LINKED)).toEqual([]);
    // The rows stand; only their personal half went.
    const rows = await h.db
      .selectFrom('list_entries')
      .select(['id', 'erasable_answers', 'email', 'erased_at', 'answers'])
      .where('id', 'in', [swept, linked])
      .execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.erasable_answers).toBe(null);
      expect(r.email).toBe(null);
      expect(r.erased_at).not.toBe(null);
      expect(r.answers).toMatchObject({ state: 'Not sure' });
    }
  });

  it('what was not erased is still found after the rebuild', async () => {
    expect((await found(PERSON)).length).toBe(2);
  });

  it('nothing erased lately: nothing rebuilt', async () => {
    // A window that starts tomorrow has nothing in it, whatever the other
    // test files are erasing meanwhile.
    expect(await rebuildTextIndex(h.db, { windowDays: -1 })).toBe(0);
  });

  it('a half-finished rebuild left behind is dropped, erased words and all', async () => {
    // What REINDEX CONCURRENTLY leaves when it fails: an invalid copy, built
    // from the same rows. Made here by hand, marked invalid as Postgres would.
    const copy = `${INDEX_NAME}_ccnew`;
    await sql`DROP INDEX IF EXISTS ${sql.id(copy)}`.execute(h.db);
    await sql`CREATE INDEX ${sql.id(copy)} ON list_entries USING gin ((to_tsvector('simple'::regconfig, coalesce(email, ''))))`.execute(
      h.db,
    );
    await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = ${copy}::regclass`.execute(
      h.db,
    );
    await rebuildTextIndex(h.db, { windowDays: -1 });
    const left = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_class WHERE relname = ${copy}`.execute(h.db);
    expect(left.rows[0]?.n).toBe(0);
  });
});

describe('over HTTP: administrators only', () => {
  const search = (cookie?: string) =>
    as(h, cookie)({ method: 'POST', url: '/api/admin/lists/search', payload: { q: PERSON } });

  it('nobody signed in, a moderator and a user are refused; an administrator finds', async () => {
    const admin = address('sar-admin');
    const mod = address('sar-mod');
    const user = address('sar-user');
    await seat(h.db, admin, 'admin');
    await seat(h.db, mod, 'moderator');
    await seat(h.db, user, 'user');
    expect((await search()).statusCode).toBe(401);
    expect((await search(await signIn(h, mod))).statusCode).toBe(403);
    expect((await search(await signIn(h, user))).statusCode).toBe(403);
    const r = await search(await signIn(h, admin));
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(r.json<{ entries: unknown[] }>().entries.length).toBe(2);
  });

  it('an empty search is refused in words', async () => {
    const admin = address('sar-admin-2');
    await seat(h.db, admin, 'admin');
    const r = await as(
      h,
      await signIn(h, admin),
    )({
      method: 'POST',
      url: '/api/admin/lists/search',
      payload: { q: '' },
    });
    expect(r.statusCode).toBe(400);
    const error = r.json<{ error: { code: string; message: string } }>().error;
    expect(error.code).toBe('search-empty');
    expect(error.message).toMatch(/Type a name/);
  });
});
