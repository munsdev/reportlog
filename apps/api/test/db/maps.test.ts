/**
 * Heat maps against a real database. Ported from
 * legacy/scripts/heat-map-selftest.mjs, check for check, plus what only
 * exists once a route sits in front of it.
 *
 * THE SUPPRESSION IS THE POINT OF THIS FILE. A payload carrying "Wyoming: 1"
 * has published the number whatever the page draws, so these assertions read
 * the PAYLOAD, and the HTTP ones read the raw bytes on the wire. A test that
 * asked a browser whether it shaded an area would pass against the exact bug
 * the mechanism exists to prevent.
 */
import type { FieldDefinition } from '@reportlog/fields';
import type { LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { createFromTemplate, replaceFields } from '../../src/lists/manage.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import { reviewEntries } from '../../src/lists/review.ts';
import { MapCache, areaOf, computeMap, filterKeyFor, stanceOf } from '../../src/maps/aggregate.ts';
import {
  candidates,
  createMap,
  deleteMap,
  setListPlace,
  setLogbookPlace,
  updateMap,
} from '../../src/maps/manage.ts';
import { mapById } from '../../src/maps/rows.ts';
import { fileReport, launchedLogbook, testDatabase, uniqueSlug } from './helpers.ts';
import { SITE, address, as, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

const db = testDatabase();

const MAIN: FieldDefinition[] = [
  { key: 'where', kind: 'location', label: 'Where did it happen', settings: { scope: 'us' } },
  {
    key: 'served',
    kind: 'choice_one',
    label: 'Were you served?',
    settings: { options: ['Yes', 'No'] },
  },
  // A free-text place on the same logbook, to prove it cannot be marked.
  { key: 'roughly', kind: 'place', label: 'Whereabouts, roughly' },
  // And a second location question: a logbook can ask where twice.
  { key: 'lives', kind: 'location', label: 'Where do you live', settings: { scope: 'us' } },
];
const OTHER: FieldDefinition[] = [
  { key: 'where', kind: 'location', label: 'Where', settings: { scope: 'us' } },
];
const THIRD: FieldDefinition[] = [
  { key: 'county', kind: 'location', label: 'Which county', settings: { scope: 'us' } },
];

let main: { id: number; slug: string };
let other: { id: number; slug: string };
let third: { id: number; slug: string };

/**
 * File one report and give its thread a head, the way filing and moderation
 * will have left it. `valid` is a moderator's approval; `publish` is the
 * reporter's sealed answer.
 */
async function report(
  logbook: { id: number; slug: string },
  questions: FieldDefinition[],
  answers: Record<string, unknown>,
  { publish = true, valid = true, withdrawn = false } = {},
) {
  const threadId = randomUUID();
  const { row } = await fileReport(db, logbook, answers, {
    threadId,
    questions,
    submission: { may_publish: publish },
  });
  await db
    .insertInto('report_heads')
    .values({
      thread_id: threadId,
      current_report_id: row.id,
      moderation_status: valid ? 'valid' : 'pending',
      withdrawn,
    })
    .execute();
  return { threadId, row };
}

const run = async (spec: Record<string, unknown>) => {
  const made = await createMap(db, { slug: uniqueSlug('map'), title: 'A map', ...spec });
  const row = await mapById(db, made.id);
  if (!row) throw new Error('the map was not stored');
  return { made, row, computed: await computeMap(db, row) };
};

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  return 'accepted';
}

beforeAll(async () => {
  main = await launchedLogbook(db, MAIN);
  other = await launchedLogbook(db, OTHER);
  third = await launchedLogbook(db, THIRD);
});
afterAll(async () => {
  await db.destroy();
});

describe('only a location question can place a report', () => {
  it('marks the location questions, after launch', async () => {
    await setLogbookPlace(db, main.id, 'where');
    await setLogbookPlace(db, other.id, 'where');
    await setLogbookPlace(db, third.id, 'county');
    const c = await candidates(db);
    expect(c.logbooks.find((l) => l.id === main.id)?.place_key).toBe('where');
  });

  it('refuses a free-text Place question, and so does the database', async () => {
    expect(await refusal(setLogbookPlace(db, main.id, 'roughly'))).toBe('place');
    await expect(
      db
        .insertInto('map_place_questions')
        .values({ logbook_id: main.id, field_key: 'roughly' })
        .execute(),
    ).rejects.toThrow(/only a location question/);
  });

  it('keeps one question per logbook: marking another replaces it', async () => {
    await setLogbookPlace(db, main.id, 'lives');
    const rows = await db
      .selectFrom('map_place_questions')
      .selectAll()
      .where('logbook_id', '=', main.id)
      .execute();
    expect(rows.map((r) => r.field_key)).toEqual(['lives']);
    // And the database holds it to one, whatever a path tries.
    await expect(
      db
        .insertInto('map_place_questions')
        .values({ logbook_id: main.id, field_key: 'where' })
        .execute(),
    ).rejects.toThrow();
    await setLogbookPlace(db, main.id, 'where');
  });

  it('offers the panel the location questions and not the prose one, and the closed ones for an outcome', async () => {
    const c = (await candidates(db)).logbooks.find((l) => l.id === main.id);
    expect(c?.places.map((p) => p.key)).toEqual(['where', 'lives']);
    expect(c?.outcomes).toEqual([
      { key: 'served', label: 'Were you served?', kind: 'choice_one', options: ['Yes', 'No'] },
    ]);
  });
});

describe('the tally, and what the publication rule keeps out of it', () => {
  let agg: Awaited<ReturnType<typeof run>>['computed']['map'];
  let mapId = 0;

  beforeAll(async () => {
    /* Arizona gets four, Nevada two, Wyoming one. At a threshold of 3 that is
       one shaded area and two suppressed ones: every branch of the
       suppression rules in one archive. */
    const plan: [string, string][] = [
      ['US-AZ', 'Yes'],
      ['US-AZ', 'Yes'],
      ['US-AZ', 'No'],
      ['US-AZ', 'No'],
      ['US-NV', 'Yes'],
      ['US-NV', 'No'],
      ['US-WY', 'Yes'],
    ];
    for (const [where, served] of plan) await report(main, MAIN, { where, served });
    for (let i = 0; i < 3; i++) await report(other, OTHER, { where: 'US-CA' });

    // One that must never be counted per condition of the rule.
    await report(main, MAIN, { where: 'US-TX' }, { publish: false });
    await report(main, MAIN, { where: 'US-TX' }, { publish: false });
    await report(main, MAIN, { where: 'US-TX' }, { valid: false });
    await report(main, MAIN, { where: 'US-TX' }, { withdrawn: true });

    const r = await run({
      enabled: true,
      min_area: 3,
      logbook_ids: [main.id],
      views: ['volume', 'outcome'],
      planes: ['us'],
      outcome: { logbook_id: main.id, key: 'served', stances: { Yes: 'positive', No: 'negative' } },
    });
    mapId = r.made.id;
    agg = r.computed.map;
  });

  it('publishes, and counts Arizona with its four', () => {
    expect(agg.published).toBe(true);
    if (!agg.published) return;
    expect(agg.areas['US-AZ']?.n).toBe(4);
  });

  it("counts the outcome by the operator's own reading", () => {
    if (!agg.published) throw new Error('unpublished');
    expect(agg.areas['US-AZ']).toMatchObject({ assessed: 4, pos: 2, neg: 2, neu: 0 });
    expect(agg.views).toEqual(['volume', 'outcome']);
    expect(agg.outcome_question).toBe('Were you served?');
  });

  it('leaves out a report whose reporter did not permit publication, one no moderator approved, and one withdrawn', () => {
    if (!agg.published) throw new Error('unpublished');
    expect(agg.areas['US-TX']).toBeUndefined();
    expect(agg.suppressed.areas).not.toContain('US-TX');
  });

  it("does not count a logbook outside this map's feed", () => {
    if (!agg.published) throw new Error('unpublished');
    expect(agg.areas['US-CA']).toBeUndefined();
    expect(agg.suppressed.areas).not.toContain('US-CA');
  });

  it('a correction waiting for moderation leaves the map until it is approved again', async () => {
    const { threadId, row } = await report(main, MAIN, { where: 'US-OH' });
    // Three in Ohio would show; two published and this one corrected.
    await report(main, MAIN, { where: 'US-OH' });
    await report(main, MAIN, { where: 'US-OH' });
    const before = await computeMap(db, await mapById(db, mapId));
    if (!before.map.published) throw new Error('unpublished');
    expect(before.map.areas['US-OH']?.n).toBe(3);

    const corrected = await fileReport(
      db,
      main,
      { where: 'US-OH' },
      { threadId, correctsId: row.id, questions: MAIN },
    );
    await db
      .updateTable('report_heads')
      .set({ current_report_id: corrected.row.id, moderation_status: 'pending' })
      .where('thread_id', '=', threadId)
      .execute();
    const after = await computeMap(db, await mapById(db, mapId));
    if (!after.map.published) throw new Error('unpublished');
    expect(after.map.areas['US-OH']).toBeUndefined();
    expect(after.map.suppressed.areas).toContain('US-OH');
  });
});

describe('the threshold, read off the payload and not off a drawing', () => {
  it('sends an area under the threshold as a bare code, and nothing anywhere carries its count', async () => {
    const { computed } = await run({ enabled: true, min_area: 3, logbook_ids: [main.id] });
    const agg = computed.map;
    if (!agg.published) throw new Error('unpublished');
    expect(Object.hasOwn(agg.areas, 'US-NV')).toBe(false);
    expect(Object.hasOwn(agg.areas, 'US-WY')).toBe(false);
    expect(agg.suppressed.areas).toEqual(expect.arrayContaining(['US-NV', 'US-WY']));
    /* THE ASSERTION THAT MATTERS, on the serialized payload: a suppressed
       code may appear only as a bare string. The moment it appears as a key
       with something behind it, its number has been published. */
    const text = JSON.stringify(agg);
    expect(text).not.toMatch(/"US-NV"\s*:/);
    expect(text).not.toMatch(/"US-WY"\s*:/);
  });

  it('gives a subtotal for several suppressed areas, which nobody can take apart', async () => {
    const { computed } = await run({ enabled: true, min_area: 3, logbook_ids: [main.id] });
    if (!computed.map.published) throw new Error('unpublished');
    // Nevada 2, Wyoming 1, Ohio 2 (its third is the correction waiting).
    expect(computed.map.suppressed.reports).toBe(5);
  });

  it('withholds the subtotal when exactly one area is suppressed: then it IS the count', async () => {
    await report(other, OTHER, { where: 'US-OR' });
    const { computed } = await run({ enabled: true, min_area: 3, logbook_ids: [other.id] });
    if (!computed.map.published) throw new Error('unpublished');
    expect(computed.map.suppressed).toEqual({ areas: ['US-OR'], reports: null });
  });

  it('is per map: a threshold of 5 withholds what 3 showed, on the same archive', async () => {
    const strict = await run({ enabled: true, min_area: 5, logbook_ids: [main.id] });
    const loose = await run({ enabled: true, min_area: 3, logbook_ids: [main.id] });
    if (!strict.computed.map.published || !loose.computed.map.published)
      throw new Error('unpublished');
    expect(strict.computed.map.areas['US-AZ']).toBeUndefined();
    expect(strict.computed.map.suppressed.areas).toContain('US-AZ');
    expect(loose.computed.map.areas['US-AZ']?.n).toBe(4);
  });

  it('has a floor of 1: refused by the module, refused by the database, clamped by the aggregate', async () => {
    expect(await refusal(createMap(db, { slug: uniqueSlug('map'), title: 'x', min_area: 0 }))).toBe(
      'min_area',
    );
    const made = await createMap(db, { slug: uniqueSlug('map'), title: 'x' });
    await expect(
      db.updateTable('heat_maps').set({ min_area: 0 }).where('id', '=', made.id).execute(),
    ).rejects.toThrow(/check/i);
    const row = await mapById(db, made.id);
    if (!row) throw new Error('missing');
    const computed = await computeMap(db, {
      ...row,
      enabled: true,
      min_area: 0,
      logbook_ids: [main.id],
    });
    if (!computed.map.published) throw new Error('unpublished');
    expect(computed.map.threshold).toBe(1);
    expect(computed.map.areas['US-WY']?.n).toBe(1);
  });
});

describe('feeds', () => {
  it('reads every logbook when it names none', async () => {
    const { computed } = await run({ enabled: true, min_area: 3 });
    if (!computed.map.published) throw new Error('unpublished');
    // At least, not exactly: an unscoped map reads every logbook in this
    // database, including what other test files filed (reports are append-only).
    expect(computed.map.areas['US-AZ']?.n).toBeGreaterThanOrEqual(4);
    expect(computed.map.areas['US-CA']?.n).toBeGreaterThanOrEqual(3);
  });

  it('gives the board one filter key when every logbook seals its place under the same key', async () => {
    const agreed = await run({ enabled: true, logbook_ids: [main.id, other.id] });
    const mixed = await run({ enabled: true, logbook_ids: [main.id, third.id] });
    if (!agreed.computed.map.published || !mixed.computed.map.published)
      throw new Error('unpublished');
    expect(agreed.computed.map.filter_key).toBe('where');
    // And none when they differ, rather than one that drops half the reports.
    expect(mixed.computed.map.filter_key).toBeNull();
  });

  it('counts a report that stopped at the country nowhere on a map of states', async () => {
    const both: FieldDefinition[] = [
      { key: 'where', kind: 'location', label: 'Where', settings: { scope: 'both' } },
    ];
    const lb = await launchedLogbook(db, both);
    await setLogbookPlace(db, lb.id, 'where');
    for (let i = 0; i < 3; i++) await report(lb, both, { where: 'US' });
    for (let i = 0; i < 3; i++) await report(lb, both, { where: 'DE' });
    const states = await run({ enabled: true, logbook_ids: [lb.id], planes: ['us'] });
    const world = await run({ enabled: true, logbook_ids: [lb.id], planes: ['us', 'world'] });
    if (!states.computed.map.published || !world.computed.map.published)
      throw new Error('unpublished');
    expect(states.computed.map.areas).toEqual({});
    expect(states.computed.unplaced.country_only).toBe(6);
    expect(world.computed.map.areas.DE?.n).toBe(3);
  });

  it('places nothing from a logbook with no place question, and says so to the staff screen', async () => {
    const lb = await launchedLogbook(db, OTHER);
    await report(lb, OTHER, { where: 'US-AZ' });
    const { computed } = await run({ enabled: true, logbook_ids: [lb.id] });
    if (!computed.map.published) throw new Error('unpublished');
    expect(computed.map.areas).toEqual({});
    expect(computed.map.suppressed.areas).toEqual([]);
    expect(computed.unplaced.no_question).toBe(1);
  });
});

describe('a disabled map and a map that does not exist answer alike', () => {
  it('publishes nothing for either, with the same sentence', async () => {
    const { made } = await run({ enabled: true, logbook_ids: [main.id] });
    await updateMap(db, made.id, { enabled: false });
    const off = await computeMap(db, await mapById(db, made.id));
    const none = await computeMap(db, null);
    expect(off.map).toEqual({ published: false, reason: 'This map is not published.' });
    expect(none.map).toEqual(off.map);
  });

  it('is off until somebody turns it on', async () => {
    const made = await createMap(db, { slug: uniqueSlug('map'), title: 'New' });
    expect(made.enabled).toBe(false);
    expect((await computeMap(db, await mapById(db, made.id))).map.published).toBe(false);
  });
});

describe('the cache is per map, which is the one thing it must not get wrong', () => {
  it('never serves a map with a threshold of 2 the answer computed for 3', async () => {
    const cache = new MapCache(60_000);
    const three = await run({ enabled: true, min_area: 3, logbook_ids: [main.id] });
    const two = await run({ enabled: true, min_area: 2, logbook_ids: [main.id] });
    const get = async (r: typeof three) =>
      cache.get(r.made.slug, async () => (await computeMap(db, await mapById(db, r.made.id))).map);
    const a = await get(three);
    const b = await get(two);
    if (!a.published || !b.published) throw new Error('unpublished');
    expect(a.threshold).toBe(3);
    expect(b.threshold).toBe(2);
    expect(b.areas['US-NV']?.n).toBe(2);
  });
});

describe('the pieces that need no rows but are easy to get wrong', () => {
  it('reads codes, and only codes', () => {
    expect(areaOf('US-AZ')).toBe('US-AZ');
    expect(areaOf('DE')).toBe('DE');
    // A county counts toward its state, by prefix (decision 44).
    expect(areaOf('US-AZ-04013')).toBe('US-AZ');
    expect(areaOf('Phoenix, Arizona')).toBeNull();
    expect(areaOf('us-az')).toBeNull();
    expect(areaOf(42)).toBeNull();
  });

  it('withholds a filter key when two logbooks disagree', () => {
    expect(filterKeyFor(['where', 'location'])).toBeNull();
    expect(filterKeyFor(['where', 'where'])).toBe('where');
    expect(filterKeyFor([])).toBeNull();
  });

  it('reads a yes/no answer, sealed as a boolean, under "yes" and "no"', () => {
    expect(stanceOf(true, { yes: 'positive' })).toBe('positive');
    expect(stanceOf(false, { yes: 'positive' })).toBeNull();
    expect(stanceOf('Other', { Yes: 'positive' })).toBeNull();
  });
});

describe('what an operator may ask for', () => {
  it('refuses, by name, every setting that would draw an empty map', async () => {
    const s = () => uniqueSlug('map');
    expect(await refusal(createMap(db, { slug: 'Not A Slug', title: 'x' }))).toBe('slug');
    expect(await refusal(createMap(db, { slug: s(), title: '' }))).toBe('title');
    expect(await refusal(createMap(db, { slug: s(), title: 'x', planes: [] }))).toBe('plane');
    expect(await refusal(createMap(db, { slug: s(), title: 'x', planes: ['mars'] }))).toBe('plane');
    expect(await refusal(createMap(db, { slug: s(), title: 'x', views: ['severity'] }))).toBe(
      'view',
    );
    expect(await refusal(createMap(db, { slug: s(), title: 'x', slot: 'sidebar' }))).toBe('slot');
    expect(await refusal(createMap(db, { slug: s(), title: 'x', logbook_ids: [987654321] }))).toBe(
      'logbook_ids',
    );
    expect(await refusal(createMap(db, { slug: s(), title: 'x', list_ids: [987654321] }))).toBe(
      'list_ids',
    );
    // An outcome view needs a question, and the question needs a reading.
    expect(
      await refusal(createMap(db, { slug: s(), title: 'x', views: ['volume', 'outcome'] })),
    ).toBe('views');
    expect(
      await refusal(
        createMap(db, {
          slug: s(),
          title: 'x',
          outcome: { logbook_id: main.id, key: 'where', stances: {} },
        }),
      ),
    ).toBe('outcome');
    expect(
      await refusal(
        createMap(db, {
          slug: s(),
          title: 'x',
          outcome: { logbook_id: main.id, key: 'served', stances: {} },
        }),
      ),
    ).toBe('outcome');
    expect(
      await refusal(
        createMap(db, {
          slug: s(),
          title: 'x',
          outcome: { logbook_id: main.id, key: 'served', stances: { Maybe: 'positive' } },
        }),
      ),
    ).toBe('outcome');
    // The outcome question has to be in the map's own feed.
    expect(
      await refusal(
        createMap(db, {
          slug: s(),
          title: 'x',
          logbook_ids: [other.id],
          outcome: { logbook_id: main.id, key: 'served', stances: { Yes: 'positive' } },
        }),
      ),
    ).toBe('outcome');
  });

  it('refuses a short name another map has', async () => {
    const slug = uniqueSlug('map');
    await createMap(db, { slug, title: 'one' });
    expect(await refusal(createMap(db, { slug, title: 'two' }))).toBe('slug_taken');
  });

  it('deletes a map and nothing else', async () => {
    const before = await db
      .selectFrom('reports')
      .select((eb) => eb.fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    const made = await createMap(db, { slug: uniqueSlug('map'), title: 'Gone' });
    await deleteMap(db, made.id);
    expect(await mapById(db, made.id)).toBeNull();
    const after = await db
      .selectFrom('reports')
      .select((eb) => eb.fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});

describe('a list can feed a map, and only its approved entries count', () => {
  it('counts approved entries, from the durable half, and calls them entries', async () => {
    const list = await createFromTemplate(db, 'check-ins', { slug: uniqueSlug('checkins') });
    await replaceFields(db, list.id, [
      {
        key: 'where',
        kind: 'location',
        label: 'Where',
        retention: 'durable',
        settings: { scope: 'us' },
      },
      { key: 'said', kind: 'short_text', label: 'Anything else', retention: 'transient' },
    ]);
    const c = (await candidates(db)).lists.find((l) => l.id === list.id);
    expect(c?.places).toEqual([{ key: 'where', label: 'Where', kind: 'location', durable: true }]);
    await setListPlace(db, list.id, 'where');
    // Marking the same question again is not an error.
    await setListPlace(db, list.id, 'where');

    const filed: number[] = [];
    for (const where of ['US-AZ', 'US-AZ', 'US-AZ', 'US-TX']) {
      const got = await fileEntry(
        db,
        list.slug,
        { answers: { where } },
        { settings: DEFAULT_LIST_SETTINGS },
      );
      filed.push(got.id);
    }

    /* SCOPED TO A LOGBOOK WITH NOTHING PUBLISHED, so the numbers are the
       list's alone. Not an empty logbook_ids: empty means EVERY logbook. */
    const empty = await launchedLogbook(db, OTHER);

    // OWNER RULING 42: a map counts a list only when the list publishes its
    // counts. Off by default, so the map is refused until it is on.
    expect(
      await refusal(
        run({ enabled: true, min_area: 3, logbook_ids: [empty.id], list_ids: [list.id] }),
      ),
    ).toBe('list_ids');
    await db
      .updateTable('lists')
      .set({ aggregates_published: true })
      .where('id', '=', list.id)
      .execute();
    const { row } = await run({
      enabled: true,
      min_area: 3,
      logbook_ids: [empty.id],
      list_ids: [list.id],
    });

    // NOTHING IS COUNTED BEFORE SOMEBODY APPROVES IT. If this ever passes with
    // entries counted, a list has an auto-publish path.
    const before = (await computeMap(db, row)).map;
    if (!before.published) throw new Error('unpublished');
    expect(before.areas['US-AZ']).toBeUndefined();
    expect(before.suppressed.areas).not.toContain('US-AZ');

    await reviewEntries(db, list.id, filed, { state: 'approved' });
    const after = (await computeMap(db, row)).map;
    if (!after.published) throw new Error('unpublished');
    expect(after.areas['US-AZ']?.n).toBe(3);
    expect(after.suppressed).toEqual({ areas: ['US-TX'], reports: null });
    // AN ENTRY IS NOT A REPORT, and the page has to be able to say so.
    expect(after.unit.many).toBe('approved entries');

    // The place code is in the durable half, so the sweep cannot take the map with it.
    const stored = await db
      .selectFrom('list_entries')
      .select(['answers', 'erasable_answers'])
      .where('list_id', '=', list.id)
      .executeTakeFirstOrThrow();
    expect(stored.answers).toMatchObject({ where: expect.any(String) as unknown });
    expect(JSON.stringify(stored.erasable_answers ?? {})).not.toContain('where');

    // TURNED OFF AFTER THE MAP NAMED IT: counted again at render time, so nothing.
    await db
      .updateTable('lists')
      .set({ aggregates_published: false })
      .where('id', '=', list.id)
      .execute();
    const off = (await computeMap(db, row)).map;
    if (!off.published) throw new Error('unpublished');
    expect(off.areas['US-AZ']).toBeUndefined();
    expect(off.suppressed.areas).not.toContain('US-TX');
    await db
      .updateTable('lists')
      .set({ aggregates_published: true })
      .where('id', '=', list.id)
      .execute();

    // A REJECTED entry is not counted either.
    await reviewEntries(db, list.id, filed.slice(0, 1), { state: 'rejected' });
    const rejected = (await computeMap(db, row)).map;
    if (!rejected.published) throw new Error('unpublished');
    expect(rejected.areas['US-AZ']).toBeUndefined();

    // EMPTY list_ids MEANS NO LISTS, where empty logbook_ids means every logbook.
    const unscoped = await run({ enabled: true, min_area: 2, logbook_ids: [empty.id] });
    if (!unscoped.computed.map.published) throw new Error('unpublished');
    expect(unscoped.computed.map.areas['US-AZ']).toBeUndefined();
  });

  it('refuses to place entries by a question whose answers are erased, and so does the database', async () => {
    const list = await createFromTemplate(db, 'check-ins', { slug: uniqueSlug('checkins') });
    // Written directly, whatever the list module would allow: the refusal
    // must hold for a row however it got there.
    await db
      .insertInto('list_fields')
      .values({
        list_id: list.id,
        key: 'where',
        kind: 'location',
        label: 'Where',
        retention: 'transient',
        position: 9,
      })
      .execute();
    const c = (await candidates(db)).lists.find((l) => l.id === list.id);
    expect(c?.places).toEqual([{ key: 'where', label: 'Where', kind: 'location', durable: false }]);
    expect(await refusal(setListPlace(db, list.id, 'where'))).toBe('place');
    await expect(
      db
        .insertInto('map_list_place_questions')
        .values({ list_id: list.id, field_key: 'where' })
        .execute(),
    ).rejects.toThrow(/erased/);
    // And a question that is not a location at all.
    expect(await refusal(setListPlace(db, list.id, 'verdict'))).toBe('place');
  });
});

// ── over HTTP ──────────────────────────────────────────────────────────

describe('over HTTP', () => {
  let h: Harness;
  let admin: ReturnType<typeof as>;
  let mod: ReturnType<typeof as>;
  let anybody: ReturnType<typeof as>;
  // The type is the caller's statement of what the contract says comes back.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  const json = <T>(r: LightMyRequestResponse): T => r.json();

  beforeAll(async () => {
    // The default cache (a minute), on purpose: turning a map off has to take
    // it off at once anyway.
    const mailer = capturingMailer();
    const appDb = testDatabase();
    const app = await buildApp({
      config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE },
      db: appDb,
      mailer,
    });
    h = { db: appDb, app, mailer, close: async () => app.close() };
    const a = address('maps-admin');
    const m = address('maps-mod');
    await seat(db, a, 'admin');
    await seat(db, m, 'moderator');
    admin = as(h, await signIn(h, a));
    mod = as(h, await signIn(h, m));
    anybody = as(h);
  });
  afterAll(async () => {
    await h.close();
    await h.db.destroy();
  });

  it('keeps every staff route to administrators', async () => {
    for (const call of [anybody, mod]) {
      const r = await call({ method: 'GET', url: '/api/admin/maps' });
      expect([401, 403]).toContain(r.statusCode);
      const w = await call({
        method: 'POST',
        url: '/api/admin/maps',
        payload: { slug: 'nope', title: 'x' },
      });
      expect([401, 403]).toContain(w.statusCode);
    }
  });

  it('makes a map, publishes it only when turned on, and sends no suppressed count on the wire', async () => {
    const slug = uniqueSlug('wire');
    const made = await admin({
      method: 'POST',
      url: '/api/admin/maps',
      payload: { slug, title: 'On the wire', min_area: 3, logbook_ids: [main.id] },
    });
    expect(made.statusCode).toBe(200);
    const id = json<{ id: number }>(made).id;

    // Off: the same 404 as a map that does not exist.
    const off = await anybody({ method: 'GET', url: `/api/maps/${slug}` });
    const none = await anybody({ method: 'GET', url: '/api/maps/no-such-map' });
    expect(off.statusCode).toBe(404);
    expect(off.body).toBe(none.body);
    expect(
      json<{ maps: { slug: string }[] }>(
        await anybody({ method: 'GET', url: '/api/maps' }),
      ).maps.map((m) => m.slug),
    ).not.toContain(slug);

    // The preview shows staff what it would publish, under the same threshold.
    const preview = json<{ map: { published: boolean; areas: Record<string, unknown> } }>(
      await admin({ method: 'GET', url: `/api/admin/maps/${String(id)}/preview` }),
    );
    expect(preview.map.published).toBe(true);
    expect(Object.keys(preview.map.areas)).toContain('US-AZ');

    expect(
      (
        await admin({
          method: 'PATCH',
          url: `/api/admin/maps/${String(id)}`,
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(200);
    const on = await anybody({ method: 'GET', url: `/api/maps/${slug}` });
    expect(on.statusCode).toBe(200);
    // P3: the line beside every number, as the one constant.
    expect(on.body).toContain(
      'These are reports people chose to file. They are not a sample and cannot be read as a rate.',
    );
    // THE RAW BYTES. Wyoming has one published report; its count must not be
    // anywhere in what was sent, and neither must the staff-only numbers.
    expect(on.body).toContain('"US-WY"');
    expect(on.body).not.toMatch(/"US-WY"\s*:/);
    expect(on.body).not.toMatch(/"US-NV"\s*:/);
    expect(on.body).not.toContain('unplaced');
    expect(on.body).not.toContain('logbook_ids');
    expect(
      json<{ maps: { slug: string }[] }>(
        await anybody({ method: 'GET', url: '/api/maps' }),
      ).maps.map((m) => m.slug),
    ).toContain(slug);

    // Turning it off takes it off at once, not after the cache's minute.
    await admin({
      method: 'PATCH',
      url: `/api/admin/maps/${String(id)}`,
      payload: { enabled: false },
    });
    expect((await anybody({ method: 'GET', url: `/api/maps/${slug}` })).statusCode).toBe(404);
  });

  it('refuses in a sentence', async () => {
    const r = await admin({
      method: 'POST',
      url: '/api/admin/maps',
      payload: { slug: uniqueSlug('map'), title: 'x', min_area: 0 },
    });
    expect(r.statusCode).toBe(400);
    expect(json<{ error: { code: string; message: string } }>(r).error).toMatchObject({
      code: 'min_area',
      message: expect.stringMatching(/at least 1/) as unknown,
    });
  });

  it('arranges maps within a slot', async () => {
    const a = json<{ id: number }>(
      await admin({
        method: 'POST',
        url: '/api/admin/maps',
        payload: { slug: uniqueSlug('a'), title: 'A' },
      }),
    );
    const b = json<{ id: number }>(
      await admin({
        method: 'POST',
        url: '/api/admin/maps',
        payload: { slug: uniqueSlug('b'), title: 'B' },
      }),
    );
    const r = await admin({
      method: 'PUT',
      url: '/api/admin/maps/arrangement',
      payload: { slot: 'home', ids: [b.id, a.id] },
    });
    expect(r.statusCode).toBe(200);
    const maps = json<{ maps: { id: number; slot: string; position: number }[] }>(r).maps;
    expect(maps.find((m) => m.id === b.id)).toMatchObject({ slot: 'home', position: 0 });
    expect(maps.find((m) => m.id === a.id)).toMatchObject({ slot: 'home', position: 1 });
    const bad = await admin({
      method: 'PUT',
      url: '/api/admin/maps/arrangement',
      payload: { slot: 'nowhere', ids: [a.id] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('marks a place question through the panel, and refuses prose', async () => {
    const r = await admin({
      method: 'PUT',
      url: `/api/admin/maps/places/logbooks/${String(main.id)}`,
      payload: { key: 'roughly' },
    });
    expect(r.statusCode).toBe(400);
    const ok = await admin({
      method: 'PUT',
      url: `/api/admin/maps/places/logbooks/${String(main.id)}`,
      payload: { key: 'where' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('counties shown on their own, past a threshold of their own', () => {
  // Its own logbook, asking for the county, as a real one would.
  const COUNTY_Q: FieldDefinition[] = [
    {
      key: 'where',
      kind: 'location',
      label: 'Which county',
      settings: { scope: 'us', depth: 'county' },
    },
  ];
  let cty: { id: number; slug: string };
  beforeAll(async () => {
    cty = await launchedLogbook(db, COUNTY_Q);
    await setLogbookPlace(db, cty.id, 'where');
    // Maricopa twice and Pima once, both inside Arizona.
    for (const where of ['US-AZ-04013', 'US-AZ-04013', 'US-AZ-04019'])
      await report(cty, COUNTY_Q, { where });
  });

  it('states only when no county threshold is set: counties are not even sent', async () => {
    const { computed } = await run({ enabled: true, min_area: 1, logbook_ids: [cty.id] });
    if (!computed.map.published) throw new Error('unpublished');
    expect(computed.map.county_threshold).toBeNull();
    expect(computed.map.counties).toEqual({});
  });

  it('sends a county from its threshold, and every county stays in its state', async () => {
    const { computed } = await run({
      enabled: true,
      min_area: 1,
      county_min: 2,
      logbook_ids: [cty.id],
    });
    if (!computed.map.published) throw new Error('unpublished');
    expect(computed.map.county_threshold).toBe(2);
    expect(Object.keys(computed.map.counties)).toEqual(['US-AZ-04013']);
    expect(computed.map.counties['US-AZ-04013']?.n).toBe(2);
    // Pima is under the county threshold: not sent on its own, not even as a code.
    expect(JSON.stringify(computed.map)).not.toContain('04019');
    // Both counties are in Arizona's count.
    expect(computed.map.areas['US-AZ']?.n).toBe(3);
  });

  it('never shows a county below the map’s own threshold', async () => {
    const { computed } = await run({
      enabled: true,
      min_area: 3,
      county_min: 1,
      logbook_ids: [cty.id],
    });
    if (!computed.map.published) throw new Error('unpublished');
    expect(computed.map.county_threshold).toBe(3);
    expect(computed.map.counties).toEqual({});
  });

  it('refuses a county threshold under the floor, and the database does too', async () => {
    expect(
      await refusal(createMap(db, { slug: uniqueSlug('map'), title: 'x', county_min: 0 })),
    ).toBe('county_min');
    const made = await createMap(db, { slug: uniqueSlug('map'), title: 'x' });
    await expect(
      db.updateTable('heat_maps').set({ county_min: 0 }).where('id', '=', made.id).execute(),
    ).rejects.toThrow(/check/i);
  });
});
