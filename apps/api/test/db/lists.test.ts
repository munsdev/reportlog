/**
 * Lists against a real database. Ported from legacy/scripts/lists-selftest.mjs.
 *
 * What only exists once rows round-trip through Postgres:
 *
 *   - THE ROW SURVIVES THE SWEEP AND THE PIECES DO NOT. An UPDATE, not a
 *     DELETE, and no unit test can see it.
 *   - THE TWO HALVES ARE TWO COLUMNS, so a count cannot reach anything
 *     erasable: checked by counting after the sweep and getting the same answer.
 *   - The CHECKs that refuse a half-erased row, an uncountable question, and a
 *     question that does not say how long its answers live.
 *   - Deduplication and the submission count.
 *   - Destroying a day's hashing secret.
 *   - THE ERASURE LINK, a path nothing reaches by accident.
 *   - Bulk review moving what is counted, and nothing else.
 *
 * Other test files share this database, so everything here is scoped to its
 * own lists and its own link hosts rather than emptying the tables.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crossTabFor,
  fieldValueCounts,
  linkCounts,
  snapshotDocument,
  summaryFor,
} from '../../src/lists/aggregates.ts';
import type { Summary } from '../../src/lists/aggregates.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import type { EntryInput } from '../../src/lists/entries.ts';
import { mintErasureToken, redeemErasureToken } from '../../src/lists/erasure.ts';
import { createFromTemplate, deleteUnused, replaceFields } from '../../src/lists/manage.ts';
import { ListRefusal } from '../../src/lists/refusals.ts';
import { DEFAULT_LIST_SETTINGS, NEVER } from '../../src/lists/retention.ts';
import { pendingCount, reviewBatch, reviewEntries } from '../../src/lists/review.ts';
import { isAccepting, listById } from '../../src/lists/rows.ts';
import type { LoadedList } from '../../src/lists/rows.ts';
import { forgetCachedSalts, hashAddress, saltForDay, utcDay } from '../../src/lists/salt.ts';
import { sweepListTokens, sweepPersonal, sweepSalts } from '../../src/lists/sweep.ts';
import { testDatabase, uniqueSlug } from './helpers.ts';

const db = testDatabase();
const settings = DEFAULT_LIST_SETTINGS;
const run = `${String(process.pid)}${String(Date.now() % 1e6)}`;
// Hosts nobody else uses, because link_index is one table for every list.
const NEWS = `news-${run}.example.org`;
const SAME = `same-${run}.example.org`;

let tips: LoadedList;
let checkins: LoadedList;
let contact: LoadedList;
let before: { reports: number; logbooks: number; heads: number };

const file = (list: LoadedList, input: EntryInput, opts: { personalDays?: typeof NEVER } = {}) =>
  fileEntry(db, list.slug, input, {
    settings: opts.personalDays ? { ...settings, personalDays: opts.personalDays } : settings,
  });

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ListRefusal) return e.code;
    throw e;
  }
  return 'accepted';
}

async function refuses(statement: Promise<unknown>): Promise<boolean> {
  try {
    await statement;
    return false;
  } catch {
    return true;
  }
}

const entry = (id: number) =>
  db.selectFrom('list_entries').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

const reload = async (l: LoadedList) => (await listById(db, l.id)) ?? l;

async function counts() {
  const r = await sql<{ reports: string; logbooks: string; heads: string }>`
    SELECT (SELECT count(*) FROM reports) AS reports,
           (SELECT count(*) FROM logbooks) AS logbooks,
           (SELECT count(*) FROM report_heads) AS heads`.execute(db);
  const row = r.rows[0];
  return {
    reports: Number(row?.reports),
    logbooks: Number(row?.logbooks),
    heads: Number(row?.heads),
  };
}

beforeAll(async () => {
  before = await counts();
  forgetCachedSalts();
});
afterAll(async () => {
  await db.destroy();
});

describe('the three shipped templates apply', () => {
  it('each makes an ordinary list, hidden', async () => {
    tips = await createFromTemplate(db, 'tips', { slug: uniqueSlug('tips') });
    checkins = await createFromTemplate(db, 'check-ins', { slug: uniqueSlug('checkins') });
    contact = await createFromTemplate(db, 'contact', { slug: uniqueSlug('contact') });
    for (const l of [tips, checkins, contact]) expect(l.visibility).toBe('hidden');
    expect(tips.fields.map((f) => f.key)).toEqual(['links', 'state', 'category', 'description']);
    expect(contact.email_mode).toBe('required');
  });

  it('re-applying over a live list is refused rather than overwriting an operator’s edits', async () => {
    expect(await refusal(createFromTemplate(db, 'tips', { slug: tips.slug }))).toBe('slug-taken');
  });

  it('the operator gives the placeholder vocabularies real options', async () => {
    const withOptions = (l: LoadedList, opts: Record<string, string[]>) =>
      replaceFields(
        db,
        l.id,
        l.fields.map((f) => ({
          ...f,
          ...(opts[f.key] ? { settings: { options: opts[f.key] } } : {}),
        })),
      );
    tips = await withOptions(tips, {
      state: ['Ohio', 'Iowa', 'Not sure'],
      category: ['Polling place', 'Ballot', 'Not sure'],
    });
    checkins = await withOptions(checkins, { state: ['Ohio', 'Iowa', 'Not sure'] });
    expect(tips.fields.find((f) => f.key === 'state')?.settings.options).toContain('Iowa');
  });
});

describe('filing on a list', () => {
  let first = 0;

  it('splits the durable half from the erasable half', async () => {
    const got = await file(tips, {
      answers: {
        links: `https://${NEWS}/story?utm_source=twitter&id=4`,
        state: 'Ohio',
        category: 'Polling place',
        description: 'A queue around the block at 7am, reported by a local paper.',
      },
      email: 'tipster@example.org',
      emailConsent: true,
      address: '203.0.113.7',
    });
    first = got.id;
    const row = await entry(got.id);
    expect(Object.keys(row.answers as object).sort()).toEqual(['category', 'links', 'state']);
    expect(Object.keys(row.erasable_answers as object)).toEqual(['description']);
    expect((row.answers as { links: string[] }).links).toEqual([`https://${NEWS}/story?id=4`]);
    expect(row.review_state).toBe('received');
    expect(row.reviewed_at).toBe(null);
    expect(got.erasureToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('keeps the link as typed beside its key, and which question it answered', async () => {
    const link = await db
      .selectFrom('list_entry_links')
      .selectAll()
      .where('entry_id', '=', first)
      .executeTakeFirstOrThrow();
    expect(link.url_raw).toContain('utm_source');
    expect(link.url_key).toBe(
      createHash('sha256').update(`https://${NEWS}/story?id=4`).digest('hex'),
    );
    expect(link.field_key).toBe('links');
  });

  it('a second entry with no free text needs no address, and gets no erasure link', async () => {
    const got = await file(tips, {
      answers: {
        links: `https://${NEWS.toUpperCase()}/story?id=4&fbclid=zzz#top`,
        state: 'Iowa',
        category: 'Ballot',
      },
      address: '203.0.113.9',
    });
    expect(got.erasureToken).toBe(null);
    const idx = await db.selectFrom('link_index').selectAll().where('host', '=', NEWS).execute();
    // Forty people sending the same clip is ONE row with a count.
    expect(idx).toHaveLength(1);
    expect(idx[0]?.submission_count).toBe(2);
  });

  it('one person pasting the same link twice adds one to the count, not two', async () => {
    await file(tips, {
      answers: {
        links: [`https://${SAME}/same?utm_source=a`, `https://${SAME.toUpperCase()}/same#top`],
        state: 'Ohio',
        category: 'Ballot',
      },
      address: '203.0.113.20',
    });
    const row = await db
      .selectFrom('link_index')
      .select('submission_count')
      .where('host', '=', SAME)
      .executeTakeFirstOrThrow();
    expect(row.submission_count).toBe(1);
  });
});

describe('the gate, on the submission and not only the form', () => {
  it('free text with no address to reach the writer is refused, and nothing is written', async () => {
    const reason = await refusal(
      file(tips, {
        answers: {
          links: `https://${SAME}/refused`,
          state: 'Ohio',
          category: 'Ballot',
          description: 'Words with nobody to reach about them',
        },
      }),
    );
    expect(reason).toBe('email-required-for-personal-data');
    const written = await db
      .selectFrom('list_entries')
      .select('id')
      .where(sql<boolean>`erasable_answers::text LIKE '%nobody to reach%'`)
      .execute();
    expect(written).toEqual([]);
  });

  it('a link that is not a link is refused by the question, not by the form', async () => {
    expect(
      await refusal(
        file(tips, { answers: { links: 'http://bit.ly/x', state: 'Ohio', category: 'Ballot' } }),
      ),
    ).toBe('shortener');
  });

  it('an answer outside the operator’s own options is refused', async () => {
    expect(
      await refusal(
        file(tips, {
          answers: { links: `https://${SAME}/ok`, state: 'Atlantis', category: 'Ballot' },
        }),
      ),
    ).toBe('not-an-option');
  });

  it('a required question left blank is refused', async () => {
    expect(await refusal(file(tips, { answers: { state: 'Ohio', category: 'Ballot' } }))).toBe(
      'missing-required',
    );
  });

  it('a form that always asks refuses an entry without an address', async () => {
    expect(
      await refusal(file(contact, { answers: { subject: 'Hello', message: 'Anybody there' } })),
    ).toBe('email-required-for-personal-data');
  });
});

describe('intake is checked here, not trusted from the form', () => {
  it('a form somebody had open when intake closed cannot submit', async () => {
    await db
      .updateTable('lists')
      .set({ closed_at: new Date() })
      .where('id', '=', contact.id)
      .execute();
    expect(
      await refusal(
        file(contact, { answers: { subject: 'Hello', message: 'Anybody there' }, email: 'a@b.co' }),
      ),
    ).toBe('closed');
    await db.updateTable('lists').set({ closed_at: null }).where('id', '=', contact.id).execute();
  });

  it('is computed, not read from a flag a timer flipped', () => {
    const none = { closed_at: null, opens_at: null, closes_at: null };
    expect(isAccepting(none)).toBe(true);
    expect(isAccepting({ ...none, opens_at: new Date(Date.now() + 8.64e7) })).toBe(false);
    expect(isAccepting({ ...none, closes_at: new Date(Date.now() - 1000) })).toBe(false);
  });
});

describe('the address is never written', () => {
  it('no column holds the address that was passed in, only a digest', async () => {
    const rows = await db
      .selectFrom('list_entries')
      .select(['ip_hash', 'answers', 'erasable_answers'])
      .where('list_id', '=', tips.id)
      .execute();
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
    expect(rows.every((r) => r.ip_hash === null || /^[0-9a-f]{64}$/.test(r.ip_hash))).toBe(true);
    expect(new Set(rows.map((r) => r.ip_hash)).size).toBeGreaterThanOrEqual(2);
  });
});

describe('rotating and then destroying the day’s secret', () => {
  it('one secret per day, the same all day, different the next', async () => {
    const today = utcDay();
    const a = await saltForDay(db, today);
    forgetCachedSalts();
    expect(Buffer.compare(a, await saltForDay(db, today))).toBe(0);
    expect(a.length).toBe(32);
    const yesterday = utcDay(new Date(Date.now() - 864e5));
    expect(Buffer.compare(a, await saltForDay(db, yesterday))).not.toBe(0);
  });

  it('the sweep destroys an expired day’s secret and never today’s', async () => {
    const old = utcDay(new Date(Date.now() - 400 * 864e5));
    const hashed = await hashAddress(db, '203.0.113.7', old);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    const swept = await sweepSalts(db, 2);
    expect(typeof swept.list_salts === 'number' && swept.list_salts >= 1).toBe(true);
    const left = await db.selectFrom('list_salts').select('day').execute();
    expect(left.map((r) => r.day)).toContain(utcDay());
    // Nothing that still exists can recompute a hash taken under it.
    expect(left.map((r) => r.day)).not.toContain(old);
  });
});

describe('counting reads the durable half, and only what was ticked', () => {
  let sum: Summary;

  it('names only the ticked questions, with their labels', async () => {
    tips = await reload(tips);
    const got = await summaryFor(db, tips);
    if (!got) throw new Error('no summary');
    sum = got;
    expect(sum.definition.map((d) => d.key)).toEqual(['state', 'category']);
  });

  it('reports received AND approved, always and separately', () => {
    expect(sum.totals).toMatchObject({ received: 3, approved: 0 });
  });

  it('breaks each ticked question down, highest first, under the operator’s label', () => {
    const states = sum.fields.find((f) => f.key === 'state');
    expect(states?.label).toBe('Where');
    expect(states?.values[0]).toEqual({ value: 'Ohio', received: 2, approved: 0 });
  });

  it('asking for a question nobody ticked is an ERROR, not a silent disclosure', async () => {
    await expect(fieldValueCounts(db, tips, 'description')).rejects.toThrow(/not countable/);
    await expect(crossTabFor(db, tips, ['description'])).rejects.toThrow(/not countable/);
  });

  it('crosses several ticked questions at once', async () => {
    const cross = await crossTabFor(db, tips, ['state', 'category']);
    expect(cross).toHaveLength(3);
    expect(cross.every((c) => 'state' in c.values && 'category' in c.values)).toBe(true);
  });

  it('A CONTACT FORM TICKS NOTHING, so a tool that asks it finds nothing, and still its totals', async () => {
    const s = await summaryFor(db, contact.slug);
    expect(s?.definition).toEqual([]);
    expect(s?.fields).toEqual([]);
    expect(typeof s?.totals.received).toBe('number');
  });
});

describe('review, in bulk', () => {
  let ids: number[] = [];

  it('shows every link with its host, unfamiliar ones marked, and the erasable half to the moderator', async () => {
    const batch = await reviewBatch(db, tips.id, { knownHosts: [NEWS] });
    expect(batch.entries).toHaveLength(3);
    ids = batch.entries.map((e) => e.id);
    const links = batch.entries.flatMap((e) => e.links);
    expect(links.some((l) => l.known_host)).toBe(true);
    expect(links.some((l) => !l.known_host)).toBe(true);
    expect(batch.entries.some((e) => e.erasable_answers !== null)).toBe(true);
    expect((await pendingCount(db, tips.id)).waiting).toBe(3);
  });

  it('APPROVING MOVES WHAT IS COUNTED, and received stays where it was', async () => {
    expect(await reviewEntries(db, tips.id, ids.slice(0, 2), { state: 'approved' })).toEqual({
      changed: 2,
    });
    const after = await summaryFor(db, tips);
    expect(after?.totals).toMatchObject({ received: 3, approved: 2 });
  });

  it('rejecting stops a count without deleting anything', async () => {
    expect(await reviewEntries(db, tips.id, ids.slice(2), { state: 'rejected' })).toEqual({
      changed: 1,
    });
    const left = await db
      .selectFrom('list_entries')
      .select('id')
      .where('list_id', '=', tips.id)
      .execute();
    expect(left).toHaveLength(3);
  });

  it('an entry cannot be un-reviewed, and ids from another list change nothing', async () => {
    expect(await refusal(reviewEntries(db, tips.id, ids, { state: 'received' }))).toBe('un-review');
    expect(await reviewEntries(db, checkins.id, ids, { state: 'approved' })).toEqual({
      changed: 0,
    });
  });
});

describe('the sweep erases the pieces and leaves the row', () => {
  let first: Awaited<ReturnType<typeof entry>>;
  let countedBefore: Summary | null;

  it('erases the erasable half of an expired entry', async () => {
    countedBefore = await summaryFor(db, tips);
    const row = await db
      .selectFrom('list_entries')
      .select('id')
      .where('list_id', '=', tips.id)
      .where('erasable_answers', 'is not', null)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('list_entries')
      .set({ personal_expires_at: sql<Date>`now() - interval '1 day'` })
      .where('id', '=', row.id)
      .execute();
    const swept = await sweepPersonal(db);
    expect(swept.list_entries).toBeGreaterThanOrEqual(1);
    first = await entry(row.id);
  });

  it('THE ROW IS STILL THERE, with its words, email and hashed address gone', () => {
    expect(first.erasable_answers).toBe(null);
    expect(first.email).toBe(null);
    expect(first.ip_hash).toBe(null);
    expect(first.erased_at).not.toBe(null);
  });

  it('THE DURABLE HALF IS UNTOUCHED, and so are the link rows and the index', async () => {
    expect(first.answers).toMatchObject({ state: 'Ohio', category: 'Polling place' });
    expect((first.answers as { links: string[] }).links).toHaveLength(1);
    const links = await db
      .selectFrom('list_entry_links')
      .select('id')
      .where('entry_id', '=', first.id)
      .execute();
    expect(links).toHaveLength(1);
    const idx = await db
      .selectFrom('link_index')
      .select('submission_count')
      .where('host', '=', NEWS)
      .executeTakeFirstOrThrow();
    expect(idx.submission_count).toBe(2);
    expect(first.review_state).toBe('approved');
  });

  it('AND THE COUNT IS UNCHANGED, because it never read the erasable half', async () => {
    const after = await summaryFor(db, tips);
    expect(after?.totals).toEqual(countedBefore?.totals);
    expect(after?.fields).toEqual(countedBefore?.fields);
  });
});

describe('what the database refuses', () => {
  it('a row marked erased that still holds any of the erasable half', async () => {
    const id = (
      await db
        .selectFrom('list_entries')
        .select('id')
        .where('list_id', '=', tips.id)
        .where('erased_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).id;
    const set = (v: Record<string, unknown>) =>
      db.updateTable('list_entries').set(v).where('id', '=', id).execute();
    expect(
      await refuses(set({ erased_at: new Date(), erasable_answers: JSON.stringify({ a: 1 }) })),
    ).toBe(true);
    expect(await refuses(set({ erased_at: new Date(), email: 'a@b.co' }))).toBe(true);
    expect(await refuses(set({ review_state: 'maybe' }))).toBe(true);
    expect(await refuses(set({ review_state: 'approved', reviewed_at: null }))).toBe(true);
    expect(await refuses(set({ erasable_answers: JSON.stringify({}) }))).toBe(true);
  });

  it('a question nobody may save', async () => {
    const add = (v: Record<string, unknown>) =>
      db
        .insertInto('list_fields')
        .values({
          list_id: tips.id,
          label: 'X',
          key: 'x',
          kind: 'choice_one',
          retention: 'durable',
          ...v,
        })
        .execute();
    expect(await refuses(add({ key: 'sneaky', kind: 'long_text', aggregatable: true }))).toBe(true);
    expect(
      await refuses(add({ key: 'absent_but_counted', aggregatable: true, retention: 'absent' })),
    ).toBe(true);
    expect(await refuses(add({ key: 'state' }))).toBe(true);
    expect(await refuses(add({ key: 'weird', retention: 'forever' }))).toBe(true);
    expect(await refuses(add({ key: 'photo', kind: 'file' }))).toBe(true);
    // No safe blanket default exists, so a writer that forgets fails loudly.
    expect(
      await refuses(
        db
          .insertInto('list_fields')
          .values({ list_id: tips.id, key: 'unstated', kind: 'choice_one', label: 'X' } as never)
          .execute(),
      ),
    ).toBe(true);
  });

  it('a question’s key or kind changing after it exists', async () => {
    const f = tips.fields[1];
    const change = (v: Record<string, string>) =>
      db
        .updateTable('list_fields')
        .set(v)
        .where('id', '=', f?.id ?? 0)
        .execute();
    expect(await refuses(change({ key: 'renamed' }))).toBe(true);
    expect(await refuses(change({ kind: 'choice_many' }))).toBe(true);
  });

  it('a link key that is not a sha256, and a hashing secret of the wrong length', async () => {
    expect(
      await refuses(
        db.insertInto('link_index').values({ url_key: 'nope', host: 'x.com' }).execute(),
      ),
    ).toBe(true);
    expect(
      await refuses(
        db
          .insertInto('list_salts')
          .values({ day: '2001-01-01', salt: Buffer.alloc(16) })
          .execute(),
      ),
    ).toBe(true);
  });

  it('a list that has taken entries being deleted, by the module and by the database', async () => {
    expect(await refusal(deleteUnused(db, tips.id))).toBe('has-entries');
    expect(await refuses(db.deleteFrom('lists').where('id', '=', tips.id).execute())).toBe(true);
  });

  it('a list open outside that is not listed', async () => {
    expect(
      await refuses(
        db
          .updateTable('lists')
          .set({ outside_access: 'door' })
          .where('id', '=', contact.id)
          .execute(),
      ),
    ).toBe(true);
  });
});

describe('an entry kept indefinitely is erased by its holder, never by the clock', () => {
  let kept: Awaited<ReturnType<typeof fileEntry>>;

  it('stores no expiry, and the sweep passes over it', async () => {
    kept = await file(
      contact,
      {
        answers: { subject: 'Keeping this', message: 'Indefinitely' },
        email: 'keeper@example.org',
        address: '203.0.113.11',
      },
      { personalDays: NEVER },
    );
    expect(kept.personalExpiresAt).toBe(null);
    await sweepPersonal(db);
    expect((await entry(kept.id)).erasable_answers).toMatchObject({ message: 'Indefinitely' });
  });

  it('the erasure link erases nothing when wrong, and everything personal when right', async () => {
    expect(await redeemErasureToken(db, 'not-real')).toEqual({ ok: false });
    expect(await redeemErasureToken(db, null)).toEqual({ ok: false });
    expect(await redeemErasureToken(db, kept.erasureToken)).toEqual({ ok: true, entryId: kept.id });
    const row = await entry(kept.id);
    expect(row.erasable_answers).toBe(null);
    expect(row.email).toBe(null);
    expect(row.erased_at).not.toBe(null);
  });

  it('works once', async () => {
    expect(await redeemErasureToken(db, kept.erasureToken)).toEqual({ ok: false });
  });

  it('an expired link erases nothing, and spent and expired links are swept away', async () => {
    const other = await file(contact, {
      answers: { subject: 'Expiring', message: 'Soon' },
      email: 'soon@example.org',
    });
    const token = await mintErasureToken(db, { entryId: other.id, personalExpiresAt: null });
    await db
      .updateTable('list_erasures')
      .set({ expires_at: sql<Date>`now() - interval '1 day'` })
      .where('entry_id', '=', other.id)
      .execute();
    expect(await redeemErasureToken(db, token)).toEqual({ ok: false });
    expect((await entry(other.id)).erasable_answers).not.toBe(null);
    const swept = await sweepListTokens(db);
    expect(swept.list_erasures).toBeGreaterThanOrEqual(2);
  });
});

describe('check-ins, where what is left after the sweep is the count', () => {
  let ci: Summary | null;

  it('need no address, and count per verdict and per state', async () => {
    for (const [state, verdict, n] of [
      ['Ohio', 'It went fine', 5],
      ['Ohio', 'Something went wrong', 2],
      ['Iowa', 'It went fine', 3],
    ] as const) {
      for (let i = 0; i < n; i++) {
        await file(checkins, { answers: { state, verdict }, address: `198.51.100.${String(i)}` });
      }
    }
    const ids = (
      await db.selectFrom('list_entries').select('id').where('list_id', '=', checkins.id).execute()
    ).map((r) => r.id);
    await reviewEntries(db, checkins.id, ids, { state: 'approved' });
    checkins = await reload(checkins);
    ci = await summaryFor(db, checkins);
    const verdicts = ci?.fields.find((f) => f.key === 'verdict')?.values ?? [];
    expect(verdicts.find((v) => v.value === 'It went fine')?.approved).toBe(8);
    expect(verdicts).toHaveLength(2);
    expect(ci?.totals.received).toBe(10);
    const emails = await db
      .selectFrom('list_entries')
      .select('id')
      .where('list_id', '=', checkins.id)
      .where('email', 'is not', null)
      .execute();
    expect(emails).toEqual([]);
  });

  it('the sweep erases every address AND THE COUNT IS UNCHANGED, with no rule needed to say so', async () => {
    await db
      .updateTable('list_entries')
      .set({ personal_expires_at: sql<Date>`now() - interval '1 day'` })
      .where('list_id', '=', checkins.id)
      .execute();
    await sweepPersonal(db);
    const hashed = await db
      .selectFrom('list_entries')
      .select('id')
      .where('list_id', '=', checkins.id)
      .where('ip_hash', 'is not', null)
      .execute();
    expect(hashed).toEqual([]);
    expect((await summaryFor(db, checkins))?.fields).toEqual(ci?.fields);
  });
});

describe('what would be published, and what would not', () => {
  const ours = async () =>
    (await snapshotDocument(db)).lists.filter((l) =>
      [tips.slug, checkins.slug, contact.slug].includes(l.slug),
    );

  it('nothing until an operator says so, and published-but-hidden is NOT published', async () => {
    expect(await ours()).toEqual([]);
    await db
      .updateTable('lists')
      .set({ aggregates_published: true })
      .where('id', '=', checkins.id)
      .execute();
    expect(await ours()).toEqual([]);
  });

  it('carries only listed, published lists, and the definition each count was computed under', async () => {
    await db
      .updateTable('lists')
      .set({ visibility: 'listed' })
      .where('id', '=', checkins.id)
      .execute();
    const doc = await snapshotDocument(db);
    const mine = await ours();
    expect(mine.map((l) => l.slug)).toEqual([checkins.slug]);
    expect(mine[0]?.definition).toHaveLength(2);
    expect(mine[0]?.definition.every((d) => d.key && d.label)).toBe(true);
    expect(doc.reportlog_list_aggregates).toBe(1);
    expect(typeof doc.generated_at).toBe('string');
    expect(JSON.stringify(doc)).not.toMatch(/queue around the block|Indefinitely/);
  });

  it('the deduplicated link layer reports counts and no submitter', async () => {
    const links = (await linkCounts(db, { limit: 1000 })).filter((l) => l.host === NEWS);
    expect(links).toHaveLength(1);
    expect(links[0]?.submission_count).toBe(2);
    expect(Object.keys(links[0] ?? {}).some((k) => /email|ip|address/i.test(k))).toBe(false);
  });
});

describe('nothing here went near a chain', () => {
  it('not one report, logbook or chain head was made or moved by any of it', async () => {
    expect(await counts()).toEqual(before);
  });
});
