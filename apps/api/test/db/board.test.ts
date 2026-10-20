/**
 * The public board, its search and filters, the CSV, the counts and the
 * figures.
 *
 * NOTHING IS FILTERABLE UNLESS AN OPERATOR SAID SO: an answer filter works
 * only for a question its logbook's maker marked, and there is no built-in
 * date or place filter. Counts are always broken out, with the denominator.
 */
import { createHash } from 'node:crypto';
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setDistribution } from '../../src/board/publication.ts';
import { checkText, parseExpression, renderText, valueId } from '../../src/board/figures.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import { reviewEntries } from '../../src/lists/review.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook, uniqueSlug } from './helpers.ts';
import {
  approve,
  fileThread,
  moderationHarness,
  resetModerationSettings,
} from './moderation-helpers.ts';
import type { Thread } from './moderation-helpers.ts';

const Q: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  { key: 'when', kind: 'date', label: 'When?' },
  { key: 'where', kind: 'location', label: 'Where?', settings: { scope: 'world' } },
  { key: 'station', kind: 'short_text', label: 'Which station?' },
  {
    key: 'tags',
    kind: 'choice_many',
    label: 'What kind?',
    settings: { options: ['Police', 'Queue', 'Ballots'] },
  },
];

let h: FilingHarness;
let lb: { id: number; slug: string };
const t: Record<string, Thread> = {};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the body's shape
const get = async <T = Record<string, unknown>>(url: string) => {
  const res = await h.app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json<T>(), text: res.body, headers: res.headers };
};
interface Page {
  published: true;
  reports: { public_ref: string; answers: Record<string, unknown> }[];
  total: number;
}
const refs = async (query: string) =>
  (await get<Page>(`/api/board/reports?logbook=${lb.slug}${query}`)).body.reports.map(
    (r) => r.public_ref,
  );

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  // The spreadsheet is a bulk download: it needs the distribution switch
  // (decision 11), tested in publication-switch.test.ts.
  await setDistribution(h.db, true, 'admin@example.org');
  lb = await launchedLogbook(h.db, Q);
  // The operator marks two questions as filters, after launch (allowed: it is
  // delivery, not meaning). `when` and `where` are deliberately NOT marked.
  await h.db
    .updateTable('logbook_fields')
    .set({ filterable: true })
    .where('logbook_id', '=', lb.id)
    .where('key', 'in', ['station', 'tags'])
    .execute();

  const file = (body: Record<string, unknown>, extra = {}) => fileThread(h.db, lb, Q, body, extra);
  t.a = await file({
    what: 'Ballots were left unattended in the corridor.',
    station: 'Station 12',
    tags: ['Ballots'],
    when: '2026-11-03',
    where: 'DE',
  });
  t.b = await file({
    what: 'A long queue outside, people gave up and left.',
    station: 'Station 7',
    tags: ['Queue', 'Police'],
  });
  t.c = await file({
    what: 'Pending report about ballots that nobody approved.',
    station: 'Station 12',
  });
  t.d = await file(
    { what: 'A coordinator typed this account up from paper.', station: 'Station 7' },
    {
      third_party: true,
      filed_via: 'Example Watch',
      intake_method: 'paper',
      attested_at: new Date().toISOString(),
    },
  );
  t.e = await file({ what: 'Declined: this one was found to be a duplicate.' });
  for (const k of ['a', 'b', 'd']) await approve(h.db, t[k]?.threadId ?? '');
  await h.db
    .updateTable('report_heads')
    .set({ moderation_status: 'invalid' })
    .where('thread_id', '=', t.e.threadId)
    .execute();
});
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

describe('what the board shows', () => {
  it('only approved, permitted, not-withdrawn reports, newest first', async () => {
    expect(await refs('')).toEqual([t.d?.publicRef, t.b?.publicRef, t.a?.publicRef]);
    expect(await refs('&sort=oldest')).toEqual([t.a?.publicRef, t.b?.publicRef, t.d?.publicRef]);
  });

  it('a coordinator’s filing says which organization, never who typed it', async () => {
    const one = await get<{ report: Record<string, unknown> }>(
      `/api/board/reports/${t.d?.publicRef ?? ''}`,
    );
    expect(one.body.report.third_party).toMatchObject({
      filed_via: 'Example Watch',
      intake_method: 'paper',
    });
    expect(one.text).not.toMatch(/coordinator@|attested/);
  });

  it('a pending or declined report is "not found", exactly like one that does not exist', async () => {
    for (const ref of [t.c?.publicRef, t.e?.publicRef, 'RL-NOTHING-AA']) {
      const r = await get<{ error: { code: string } }>(`/api/board/reports/${ref ?? ''}`);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('not_found');
    }
  });

  it('never serves moderation’s workings: no status, reasons, flags or contact', async () => {
    const r = await get(`/api/board/reports?logbook=${lb.slug}`);
    expect(r.text).not.toMatch(/moderation_status|needs_review|review_terms|email|thread_id/);
  });
});

describe('search', () => {
  it('finds published reports by their words or reference, and never a pending one', async () => {
    expect(await refs('&q=ballots')).toEqual([t.a?.publicRef]);
    expect(await refs(`&q=${encodeURIComponent(t.b?.publicRef ?? '')}`)).toEqual([t.b?.publicRef]);
    expect(await refs('&q=nobody%20approved')).toEqual([]);
  });

  it('accepts whatever a person types without an error', async () => {
    for (const q of ['"long queue"', 'queue -police', 'ballots OR queue', '((( & | !', "o'brien"]) {
      expect((await get(`/api/board/reports?q=${encodeURIComponent(q)}`)).status).toBe(200);
    }
    expect(await refs(`&q=${encodeURIComponent('"long queue"')}`)).toEqual([t.b?.publicRef]);
  });
});

// Legacy's ownership-selftest ended with a block on how NULL behaves in
// Postgres filters: a NULL location failed `&&` and a NULL date failed `>=`,
// so a report that skipped an optional question silently fell out of a
// search. Here an unanswered question is an ABSENT KEY (and a report with
// nothing answered has no `answers` at all), so the risk is the same shape:
// a NULL that makes a condition NULL rather than false-or-true.
describe('a report with an unanswered optional question', () => {
  const page = (query: string) => get<Page>(`/api/board/reports?${query}`);

  it('is still found and counted by the search and by a filter on another question', async () => {
    // t.d answered neither `when`, `where` nor `tags`.
    expect(t.d?.answers).not.toHaveProperty('tags');
    const words = await page(`logbook=${lb.slug}&q=coordinator`);
    expect(words.body.reports.map((r) => r.public_ref)).toEqual([t.d?.publicRef]);
    expect(words.body.total).toBe(1);
    const filtered = await page(`logbook=${lb.slug}&a.station=Station%207`);
    expect(filtered.body.reports.map((r) => r.public_ref)).toEqual([
      t.d?.publicRef,
      t.b?.publicRef,
    ]);
    expect(filtered.body.total).toBe(2);
  });

  it('with nothing answered at all, is found by its reference and counted in its logbook', async () => {
    const optional: FieldDefinition[] = [
      { key: 'note', kind: 'short_text', label: 'Anything to add?' },
      { key: 'when', kind: 'date', label: 'When?' },
    ];
    const bare = await launchedLogbook(h.db, optional);
    const empty = await fileThread(h.db, bare, optional, {});
    const said = await fileThread(h.db, bare, optional, { note: 'Only this was said.' });
    for (const x of [empty, said]) await approve(h.db, x.threadId);
    // Sealed without an `answers` key, so the column is NULL: the case coalesce is for.
    expect(empty.answers).toBeNull();

    const byRef = await page(`q=${encodeURIComponent(empty.publicRef)}`);
    expect(byRef.body.reports.map((r) => r.public_ref)).toEqual([empty.publicRef]);
    expect(byRef.body.total).toBe(1);
    const all = await page(`logbook=${bare.slug}`);
    expect(all.body.total).toBe(2);
    // A search that matches only the other report leaves the empty one out, and errors on nothing.
    const words = await page(`logbook=${bare.slug}&q=said`);
    expect(words.body.reports.map((r) => r.public_ref)).toEqual([said.publicRef]);

    const stats = await get<{
      published_reports: { by_logbook: Record<string, { published: number }> };
    }>('/api/board/stats');
    expect(stats.body.published_reports.by_logbook[bare.slug]?.published).toBe(2);
  });
});

describe('NOTHING IS FILTERABLE UNLESS AN OPERATOR SAID SO', () => {
  it('the board offers only the questions the operator marked', async () => {
    const r = await get<{ logbooks: { slug: string; filters: { key: string }[] }[] }>('/api/board');
    const mine = r.body.logbooks.find((l) => l.slug === lb.slug);
    expect(mine?.filters.map((f) => f.key)).toEqual(['station', 'tags']);
  });

  it('a marked question filters, by a plain answer and by one choice in many', async () => {
    expect(await refs('&a.station=Station%2012')).toEqual([t.a?.publicRef]);
    expect(await refs('&a.tags=Police')).toEqual([t.b?.publicRef]);
    expect(await refs('&a.station=Station%207&a.tags=Queue')).toEqual([t.b?.publicRef]);
  });

  it('an unmarked question is refused, so there is no built-in date or place filter', async () => {
    for (const q of ['&a.when=2026-11-03', '&a.where=DE', '&a.what=x', '&a.nothing=x']) {
      const r = await get<{ error: { code: string; message: string } }>(
        `/api/board/reports?logbook=${lb.slug}${q}`,
      );
      expect(r.status).toBe(400);
      expect(r.body.error.message).toMatch(/not one this logbook offers/);
    }
    // And without a logbook there is no question to filter by at all.
    expect((await get('/api/board/reports?a.station=Station%207')).status).toBe(400);
  });

  it('there is no date or place parameter to pass, and an unknown one narrows nothing', async () => {
    const all = await refs('');
    expect(await refs('&from=2026-11-01&to=2026-11-02&place=DE&date=2026-11-03')).toEqual(all);
  });
});

describe('the CSV', () => {
  it('carries the published reports, one column per question for one logbook, keyed by question key', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: `/api/board/reports.csv?logbook=${lb.slug}`,
    });
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    const lines = r.body.trim().split('\n');
    expect(lines[0]).toContain('"answer.station"'.replace(/"/g, ''));
    expect(lines[0]).toContain('answer.tags');
    expect(lines).toHaveLength(4);
    expect(r.body).not.toContain(t.c?.publicRef ?? 'x');
    expect(r.body).toContain('"Ballots"');
  });

  it('defuses a cell a spreadsheet would run as a formula', async () => {
    const f = await fileThread(h.db, lb, Q, { what: '=HYPERLINK("http://evil.example","click")' });
    await approve(h.db, f.threadId);
    const r = await h.app.inject({
      method: 'GET',
      url: `/api/board/reports.csv?logbook=${lb.slug}`,
    });
    expect(r.body).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    await h.db
      .updateTable('report_heads')
      .set({ withdrawn: true })
      .where('thread_id', '=', f.threadId)
      .execute();
  });
});

describe('the counts', () => {
  it('break out the published reports only, and no bare total', async () => {
    const r = await get<{
      published_reports: {
        by_logbook: Record<
          string,
          {
            published: number;
            by_question: Record<string, { counts: Record<string, number>; unanswered: number }>;
          }
        >;
      };
    }>('/api/board/stats');
    expect(r.status).toBe(200);
    // P3: the line beside every number, as the one constant.
    expect((r.body as unknown as { not_a_sample: string }).not_a_sample).toBe(
      'These are reports people chose to file. They are not a sample and cannot be read as a rate.',
    );
    // Counts of unapproved reports are on no public surface (decision 36).
    expect(r.text).not.toMatch(/confirmed_reports|by_disposition|under_review|declined|withdrawn/);
    expect(r.text).not.toMatch(/"total"/);

    const mine = r.body.published_reports.by_logbook[lb.slug];
    expect(mine?.published).toBe(3);
    // Only the marked questions are broken out, and a multiple choice counts under each choice.
    expect(Object.keys(mine?.by_question ?? {})).toEqual(['station', 'tags']);
    expect(mine?.by_question.tags?.counts).toEqual({ Ballots: 1, Queue: 1, Police: 1 });
    expect(mine?.by_question.tags?.unanswered).toBe(1);
  });

  it('the public API serves the same counts, with its version and licence', async () => {
    const site = await get('/api/board/stats');
    const v1 = await get('/api/v1/stats');
    expect(v1.body.api_version).toBe(1);
    expect(v1.body.confirmed_reports).toEqual(site.body.confirmed_reports);
    expect(String(v1.body.licence)).toMatch(/not the reports/);
    expect((await get<{ version: number }>('/api/v1')).body.version).toBe(1);
  });
});

describe('the consent wordings (/api/v1/consent-texts)', () => {
  interface Texts {
    texts: { digest: string; variant: string; body: string; introduced_by_role: string }[];
    api_version: number;
    licence: string;
  }

  it('reads back the sentence behind a published report’s sealed digest, and the digest checks', async () => {
    const r = await get<Texts>('/api/v1/consent-texts');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
    expect(r.body.api_version).toBe(1);
    expect(r.body.licence).toMatch(/these wordings only; not the reports/);

    const sealed = await h.db
      .selectFrom('reports')
      .select('may_publish_digest')
      .where('public_ref', '=', t.a?.publicRef ?? '')
      .executeTakeFirstOrThrow();
    const row = r.body.texts.find((x) => x.digest === sealed.may_publish_digest);
    expect(row?.variant).toBe('general');
    // Anybody can check the wording is the one the digest names.
    for (const x of r.body.texts) {
      expect(createHash('sha256').update(x.body.normalize('NFC'), 'utf8').digest('hex')).toBe(
        x.digest,
      );
    }
    expect(new Set(r.body.texts.map((x) => x.variant))).toEqual(
      new Set(['general', 'coordinator']),
    );
  });

  it('names a role, never a person, and is listed in the API’s index', async () => {
    const r = await get<Texts>('/api/v1/consent-texts');
    expect(r.text).not.toMatch(/@/);
    expect(r.body.texts.every((x) => x.introduced_by_role === 'deployment')).toBe(true);
    const index = await get<{ endpoints: Record<string, string>; licence: { covers: string } }>(
      '/api/v1',
    );
    expect(Object.keys(index.body.endpoints)).toContain('/api/v1/consent-texts');
    expect(index.body.licence.covers).toMatch(/consent wordings/);
  });
});

describe('the figures', () => {
  it('offers filed and published counts per window, overall and per logbook', async () => {
    const r = await get<{ figures: { id: string; value: number }[] }>('/api/board/figures');
    const ids = new Map(r.body.figures.map((f) => [f.id, f.value]));
    expect(ids.get(`logbook.${lb.slug}.published.all`)).toBe(3);
    expect(ids.get(`logbook.${lb.slug}.filed.7d`)).toBeGreaterThanOrEqual(5);
    expect(ids.has('reports.filed.24h')).toBe(true);
    const values = Object.fromEntries(ids);
    expect(
      renderText(
        `{{ [logbook.${lb.slug}.published.all] }} of {{[logbook.${lb.slug}.filed.all]}}`,
        values,
      ),
    ).toMatch(/^3 of \d+$/);
  });

  it('offers a list’s counts only once it is listed AND its counts are published', async () => {
    const list = await createFromTemplate(h.db, 'check-ins', { slug: uniqueSlug('figs') });
    const ids: number[] = [];
    for (const [verdict, n] of [
      ['It went fine', 3],
      ['Something went wrong', 2],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const got = await fileEntry(
          h.db,
          list.slug,
          { answers: { verdict, state: 'Not sure' }, address: `203.0.113.${String(i)}` },
          { settings: DEFAULT_LIST_SETTINGS },
        );
        ids.push(got.id);
      }
    }
    expect(ids).toHaveLength(5);
    // Two of the fine ones and one of the others approved.
    await reviewEntries(h.db, list.id, [ids[0], ids[1], ids[3]], { state: 'approved' });

    const figures = async () => {
      const r = await get<{ figures: { id: string; group: string; value: number }[] }>(
        '/api/board/figures',
      );
      return new Map(
        r.body.figures
          .filter((f) => f.id.startsWith(`list.${list.slug}.`))
          .map((f) => [f.id, f.value]),
      );
    };
    const set = (cols: { visibility?: string; aggregates_published?: boolean }) =>
      h.db.updateTable('lists').set(cols).where('id', '=', list.id).execute();

    // Hidden, unpublished; then published but hidden; then listed but not published.
    expect((await figures()).size).toBe(0);
    await set({ aggregates_published: true });
    expect((await figures()).size).toBe(0);
    await set({ aggregates_published: false, visibility: 'listed' });
    expect((await figures()).size).toBe(0);

    await set({ aggregates_published: true });
    const f = await figures();
    const fine = valueId('It went fine');
    const wrong = valueId('Something went wrong');
    expect(f.get(`list.${list.slug}.received.all`)).toBe(5);
    expect(f.get(`list.${list.slug}.approved.all`)).toBe(3);
    expect(f.get(`list.${list.slug}.received.7d`)).toBe(5);
    expect(f.get(`list.${list.slug}.verdict.${fine}.received.all`)).toBe(3);
    expect(f.get(`list.${list.slug}.verdict.${fine}.approved.all`)).toBe(2);
    expect(f.get(`list.${list.slug}.verdict.${wrong}.approved.24h`)).toBe(1);
    // Legacy's name for an answer, so an old placeholder still works.
    expect(fine).toBe(createHash('sha256').update('It went fine').digest('hex').slice(0, 6));
    expect(
      renderText(
        `{{ percent([list.${list.slug}.verdict.${fine}.approved.all], [list.${list.slug}.approved.all]) }}%`,
        Object.fromEntries(f),
      ),
    ).toBe('66.7%');

    await set({ visibility: 'hidden', aggregates_published: false });
  });

  it('parses arithmetic, never evaluates code, and says what is wrong', () => {
    expect(renderText('{{ percent([a], [b]) }}%', { a: 1, b: 4 })).toBe('25%');
    expect(renderText('{{ round([a] / 3, 2) }}', { a: 1 })).toBe('0.3');
    expect(renderText('{{ [missing] }} and {{ alert(1) }}', { a: 1 })).toBe('? and ?');
    expect(() => parseExpression('process.exit()')).toThrow();
    expect(checkText('{{ [nope] }} {{ 1 + }}', {})).toHaveLength(2);
  });
});
