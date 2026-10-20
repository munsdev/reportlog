/**
 * Decision 6: where a heat map and the board ask the same place question, the
 * board keeps the map's threshold. An area under it is sent WITHOUT ITS COUNT,
 * so every test here reads the payload (the bytes a reader's browser gets),
 * not a page: a number the page declines to draw is still published.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setDistribution } from '../../src/board/publication.ts';
import { placeGuards } from '../../src/board/places.ts';
import { createMap, setLogbookPlace, updateMap } from '../../src/maps/manage.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook, uniqueSlug } from './helpers.ts';
import {
  approve,
  fileThread,
  moderationHarness,
  resetModerationSettings,
} from './moderation-helpers.ts';

const Q: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  { key: 'where', kind: 'location', label: 'Where?', settings: { scope: 'world' } },
];

let h: FilingHarness;
let lb: { id: number; slug: string };
let other: { id: number; slug: string };
let mapId: number;
let k: number;

const get = async (url: string) => {
  const res = await h.app.inject({ method: 'GET', url });
  return { status: res.statusCode, text: res.body, body: res.json<Record<string, unknown>>() };
};
const fileAt = async (where: string, n: number, into = lb) => {
  for (let i = 0; i < n; i += 1) {
    const t = await fileThread(h.db, into, Q, {
      what: `Seen at ${where}, number ${String(i)}.`,
      where,
    });
    await approve(h.db, t.threadId);
  }
};
const threshold = async (id: number) => (await placeGuards(h.db)).get(id)?.threshold;

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  // The spreadsheet is a bulk download: it needs the distribution switch
  // (decision 11), tested in publication-switch.test.ts.
  await setDistribution(h.db, true, 'admin@example.org');
  lb = await launchedLogbook(h.db, Q);
  other = await launchedLogbook(h.db, Q);
  for (const l of [lb, other]) {
    // The operator offers the place question as a board filter...
    await h.db
      .updateTable('logbook_fields')
      .set({ filterable: true })
      .where('logbook_id', '=', l.id)
      .where('key', '=', 'where')
      .execute();
  }
  // ...and, for `lb` only, a heat map reads the same question.
  await setLogbookPlace(h.db, lb.id, 'where');
  const made = await createMap(h.db, {
    slug: uniqueSlug('places'),
    title: 'Where reports came from',
    min_area: 3,
    planes: ['world'],
    logbook_ids: [lb.id],
  });
  mapId = made.id;
  // Another file's map with no logbooks named (every logbook) may hold a
  // higher threshold; the highest wins, so the test works from what is set.
  k = (await threshold(lb.id)) ?? 0;
  expect(k).toBeGreaterThanOrEqual(3);
  // One report in Germany, one in France: both thin. Enough in Italy to show.
  await fileAt('DE', 1);
  await fileAt('FR', 1);
  await fileAt('IT', k);
  // The other logbook has no map on its place question: nothing is withheld.
  await fileAt('DE', 1, other);
});
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

describe('the board narrowed to one place', () => {
  it('a place under the threshold sends no reports and no count', async () => {
    for (const area of ['DE', 'FR']) {
      const r = await get(`/api/board/reports?logbook=${lb.slug}&a.where=${area}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        published: true,
        withheld: true,
        threshold: k,
        reason: expect.stringContaining(`Fewer than ${String(k)}`) as unknown,
      });
      // The payload, not the page: no report, no total, no reference.
      expect(r.text).not.toMatch(/"total"|"reports"|RL-/);
    }
  });

  it('a place at the threshold or over is the board as usual', async () => {
    const r = await get(`/api/board/reports?logbook=${lb.slug}&a.where=IT`);
    expect(r.body.total).toBe(k);
    expect(r.body.reports).toHaveLength(k);
  });

  it('a place with nothing in it says nothing was found, as the map says "none counted"', async () => {
    const r = await get(`/api/board/reports?logbook=${lb.slug}&a.where=ES`);
    expect(r.body).toMatchObject({ published: true, total: 0, reports: [] });
  });

  it('narrowing further inside a large place cannot single out a thin one', async () => {
    const r = await get(`/api/board/reports?logbook=${lb.slug}&a.where=IT&q=number%200`);
    expect(r.body.withheld).toBe(true);
    expect(r.text).not.toMatch(/"total"/);
  });

  it('the spreadsheet withholds the same rows: a header and nothing else', async () => {
    const thin = await h.app.inject({
      method: 'GET',
      url: `/api/board/reports.csv?logbook=${lb.slug}&a.where=DE`,
    });
    expect(thin.statusCode).toBe(200);
    expect(thin.body.trim().split('\n')).toHaveLength(1);
    const wide = await h.app.inject({
      method: 'GET',
      url: `/api/board/reports.csv?logbook=${lb.slug}&a.where=IT`,
    });
    expect(wide.body.trim().split('\n')).toHaveLength(1 + k);
  });

  it('a logbook whose place question no map reads is not affected', async () => {
    const r = await get(`/api/board/reports?logbook=${other.slug}&a.where=DE`);
    expect(r.body).toMatchObject({ published: true, total: 1 });
  });
});

interface Breakdown {
  counts: Record<string, number>;
  unanswered: number;
  withheld?: { threshold: number; areas: string[]; reports: number | null };
}
const breakdown = async (url: string, slug: string) => {
  const r = await get(url);
  const by = (
    r.body.published_reports as {
      by_logbook: Record<string, { by_question: Record<string, Breakdown> }>;
    }
  ).by_logbook;
  return { text: r.text, where: by[slug]?.by_question.where };
};

describe('the numbers', () => {
  for (const url of ['/api/board/stats', '/api/v1/stats']) {
    it(`${url}: a thin area is named without its count, and two thin areas only as a sum`, async () => {
      const { where } = await breakdown(url, lb.slug);
      expect(where?.counts).toEqual({ Italy: k });
      expect(where?.withheld).toEqual({ threshold: k, areas: ['France', 'Germany'], reports: 2 });
      expect(where?.counts).not.toHaveProperty('Germany');
    });
  }

  it('with exactly one thin area there is no sum, because the sum would be its count', async () => {
    // Raise Italy's neighbour: France reaches the threshold, Germany stays at one.
    await fileAt('FR', k - 1);
    const { where } = await breakdown('/api/board/stats', lb.slug);
    expect(where?.counts).toEqual({ Italy: k, France: k });
    expect(where?.withheld).toEqual({ threshold: k, areas: ['Germany'], reports: null });
  });

  it('the other logbook, with no map on its question, is counted area by area', async () => {
    const { where } = await breakdown('/api/board/stats', other.slug);
    expect(where?.counts).toEqual({ Germany: 1 });
    expect(where?.withheld).toBeUndefined();
  });

  it('a map switched off still keeps its threshold; deleting the place question lifts it', async () => {
    await updateMap(h.db, mapId, { enabled: false });
    expect(await threshold(lb.id)).toBe(k);
    expect((await get(`/api/board/reports?logbook=${lb.slug}&a.where=DE`)).body.withheld).toBe(
      true,
    );
    await setLogbookPlace(h.db, lb.id, null);
    expect(await threshold(lb.id)).toBeUndefined();
    const r = await get(`/api/board/reports?logbook=${lb.slug}&a.where=DE`);
    expect(r.body).toMatchObject({ published: true, total: 1 });
    await setLogbookPlace(h.db, lb.id, 'where');
  });

  it('the highest threshold of the maps reading a question is the one kept', async () => {
    await updateMap(h.db, mapId, { min_area: k + 5 });
    expect(await threshold(lb.id)).toBe(k + 5);
    const { where } = await breakdown('/api/board/stats', lb.slug);
    expect(where?.counts).toEqual({});
    expect(where?.withheld?.areas).toEqual(['France', 'Germany', 'Italy']);
    await updateMap(h.db, mapId, { min_area: 3 });
  });
});
