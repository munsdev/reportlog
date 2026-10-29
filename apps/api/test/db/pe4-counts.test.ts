/**
 * Plan E, session PE4: the owner's answers to PE3's open questions.
 *
 *   - a bulk decline sends no email, where a single decline does;
 *   - staff see every report by where it stands (received, accepted,
 *     declined, waiting, withdrawn); the public sees none of the unaccepted;
 *   - a counts-only logbook's place counts keep its SMALL-AREA THRESHOLD:
 *     a place under it is sent as a name with no number, on every public
 *     surface that carries them (the counts route, the numbers and
 *     /api/v1/stats, a heat map), and nothing else counts by place;
 *   - the threshold is an administrator's setting with a floor of 2, in the
 *     database too, and every change is a public switch use;
 *   - a counts-only logbook's accepted report is "counted", never "public".
 *
 * Every assertion on a withheld count reads the PAYLOAD, the bytes a
 * reader's browser gets: a number the page declines to draw is published.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedReportRows } from '../../src/anchor/records.ts';
import { setDistribution } from '../../src/board/publication.ts';
import { catalogue } from '../../src/board/figures.ts';
import { countGuards, placeGuards } from '../../src/board/places.ts';
import { createMap, setLogbookPlace } from '../../src/maps/manage.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { confirm, fileThroughRoutes, send, threadOf, tokenFor, spine } from './filing-helpers.ts';
import { launchedLogbook, uniqueSlug } from './helpers.ts';
import { address } from './identity-helpers.ts';
import {
  approve,
  fileThread,
  moderationHarness,
  resetModerationSettings,
  seenMap,
  seenOf,
  staff,
} from './moderation-helpers.ts';

type Caller = Awaited<ReturnType<typeof staff>>['call'];

const Q: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  {
    key: 'where',
    kind: 'location',
    label: 'Where?',
    settings: { scope: 'us', depth: 'county' },
  },
];

let h: FilingHarness;
let mod: { email: string; call: Caller };
let admin: { email: string; call: Caller };
let plain: { email: string; call: Caller };

// The type is the caller's statement of what the contract says comes back.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const get = async <T = Record<string, unknown>>(url: string, who?: Caller) => {
  const r = who ? await who({ method: 'GET', url }) : await h.app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json<T>(), text: r.body };
};
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const put = async <T = Record<string, unknown>>(
  who: Caller,
  url: string,
  payload: Record<string, unknown>,
) => {
  const r = await who({ method: 'PUT', url, payload });
  return { status: r.statusCode, body: r.json<T>(), text: r.body };
};
const countsOnly = (lb: { slug: string }, on = true) =>
  put(admin.call, `/api/admin/moderation/logbooks/${lb.slug}/counts-only`, { counts_only: on });
const smallArea = (lb: { slug: string }, n: unknown, who: Caller = admin.call) =>
  put<{ small_area: number; error?: { code: string; message: string } }>(
    who,
    `/api/admin/moderation/logbooks/${lb.slug}/small-area`,
    { small_area: n },
  );

/** n accepted reports at one place. */
async function fileAt(lb: { id: number; slug: string }, where: string, n: number) {
  for (let i = 0; i < n; i += 1) {
    const t = await fileThread(h.db, lb, Q, { what: `Seen at ${where}, ${String(i)}.`, where });
    await approve(h.db, t.threadId);
  }
}

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  await h.db
    .updateTable('flood_settings')
    .set({ intake_paused_at: null })
    .where('id', '=', true)
    .execute();
  mod = await staff(h, 'pe4-mod', 'moderator');
  admin = await staff(h, 'pe4-admin', 'admin');
  plain = await staff(h, 'pe4-user', 'user');
});
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

// ── 1. a bulk decline sends no email ────────────────────────────────────

describe('a bulk decline sends no email', () => {
  it('a single decline emails its reporter; a bulk decline of reports with addresses emails nobody', async () => {
    const lb = await launchedLogbook(h.db, Q);
    const filed = [];
    for (let i = 0; i < 3; i += 1) {
      const email = address('pe4-flood');
      const ref = await fileThroughRoutes(h, lb.slug, { what: 'Same words.' }, email);
      filed.push({ email, thread: await threadOf(h.db, ref) });
    }
    const [single, ...rest] = filed;
    if (!single) throw new Error('nothing filed');

    // The control: the same kind of report, declined alone, is told why.
    h.mailer.messages.length = 0;
    const one = await mod.call({
      method: 'POST',
      url: `/api/moderation/reports/${single.thread}/decision`,
      payload: {
        status: 'invalid',
        reason_code: 'duplicate',
        comment: 'Checked.',
        seen: await seenOf(h.db, single.thread),
      },
    });
    expect(one.json()).toEqual({ ok: true, notice: 'sent' });
    expect(h.mailer.lastTo(single.email)).toBeDefined();

    h.mailer.messages.length = 0;
    const bulk = await mod.call({
      method: 'POST',
      url: '/api/moderation/reports/bulk-decline',
      payload: {
        thread_ids: rest.map((r) => r.thread),
        seen: await seenMap(
          h.db,
          rest.map((r) => r.thread),
        ),
        reason_code: 'abusive_or_spam',
      },
    });
    expect(bulk.statusCode, bulk.body).toBe(200);
    expect(bulk.json<{ declined: string[] }>().declined).toHaveLength(2);
    // Nothing to anybody, and nothing to these addresses in particular.
    expect(h.mailer.messages).toHaveLength(0);
    for (const r of rest) expect(h.mailer.lastTo(r.email)).toBeUndefined();
    const notices = await h.db
      .selectFrom('decision_notices')
      .select('id')
      .where(
        'thread_id',
        'in',
        rest.map((r) => r.thread),
      )
      .execute();
    expect(notices).toEqual([]);
  });
});

// ── 2. totals for staff; nothing unaccepted in public ───────────────────

describe('every report by where it stands, for staff only', () => {
  let lb: { id: number; slug: string };

  beforeAll(async () => {
    lb = await launchedLogbook(h.db, Q);
    const states = ['valid', 'invalid', 'unknown', 'pending', 'pending'] as const;
    for (const [i, s] of states.entries()) {
      const t = await fileThread(h.db, lb, Q, { what: `Totals ${String(i)}.` });
      await h.db
        .updateTable('report_heads')
        .set({ moderation_status: s, withdrawn: i === 4 })
        .where('thread_id', '=', t.threadId)
        .execute();
    }
  });

  it('the flood screen has received, accepted, declined, waiting and withdrawn', async () => {
    const r = await get<{
      totals: {
        all: Record<string, number>;
        by_logbook: { slug: string; [k: string]: unknown }[];
        unconfirmed: number;
      };
    }>('/api/moderation/flood', mod.call);
    expect(r.status, r.text).toBe(200);
    expect(r.body.totals.by_logbook.find((l) => l.slug === lb.slug)).toEqual({
      slug: lb.slug,
      title: expect.any(String) as unknown,
      received: 5,
      accepted: 1,
      declined: 1,
      waiting: 2,
      withdrawn: 1,
    });
    const all = r.body.totals.all;
    expect(all.received).toBe(
      (all.accepted ?? 0) + (all.declined ?? 0) + (all.waiting ?? 0) + (all.withdrawn ?? 0),
    );
    expect(r.body.totals.unconfirmed).toBeGreaterThanOrEqual(0);
  });

  it('is not for anybody signed in, nor for a stranger', async () => {
    expect((await get('/api/moderation/flood', plain.call)).status).toBe(403);
    expect((await get('/api/moderation/flood')).status).toBe(401);
  });

  it('the public counts the one accepted report, and nothing waiting', async () => {
    const stats = await get<{
      published_reports: { by_logbook: Record<string, { published: number }> };
    }>('/api/board/stats');
    expect(stats.body.published_reports.by_logbook[lb.slug]?.published).toBe(1);
    const counts = await get('/api/board/counts');
    expect(counts.text).not.toMatch(/"(waiting|received|pending|unclear)"\s*:/);
    // Declined, by reason only: the one public exception (decision 36, amended).
    const declined = await get<{ logbooks: { slug: string; by_reason: unknown[] }[] }>(
      '/api/board/declined',
    );
    expect(declined.text).not.toMatch(/"(waiting|received|pending|unclear)"\s*:/);
    expect(declined.body.logbooks.find((l) => l.slug === lb.slug)?.by_reason).toHaveLength(1);
  });
});

// ── 3. the small-area threshold ─────────────────────────────────────────

describe('the small-area threshold: the setting', () => {
  let lb: { id: number; slug: string };
  beforeAll(async () => {
    lb = await launchedLogbook(h.db, Q);
  });

  it('is 2 until an administrator sets it, and a moderator cannot', async () => {
    const list = await get<{ logbooks: { slug: string; small_area: number }[] }>(
      '/api/admin/moderation/counts-only',
      admin.call,
    );
    expect(list.body.logbooks.find((l) => l.slug === lb.slug)?.small_area).toBe(2);
    expect((await smallArea(lb, 5, mod.call)).status).toBe(403);
    const r = await smallArea(lb, 5);
    expect(r.status, r.text).toBe(200);
    expect(r.body.small_area).toBe(5);
    const again = await get<{
      logbooks: { slug: string; small_area: number; counts_only: boolean }[];
    }>('/api/admin/moderation/counts-only', admin.call);
    // Set ahead of time, it does not switch counts only on.
    expect(again.body.logbooks.find((l) => l.slug === lb.slug)).toMatchObject({
      small_area: 5,
      counts_only: false,
    });
  });

  it('refuses anything under 1, or not a whole number, in a sentence', async () => {
    for (const bad of [0, -3, 2.5]) {
      const r = await smallArea(lb, bad);
      expect(r.status, String(bad)).toBe(400);
      expect(r.body.error?.code).toBe('small_area');
      expect(r.body.error?.message).toMatch(/at least 1/);
    }
  });

  it('the database refuses a threshold under 1 whatever the code says', async () => {
    await expect(
      h.db
        .updateTable('logbook_publication')
        .set({ small_area: 0 })
        .where('logbook_id', '=', lb.id)
        .execute(),
    ).rejects.toThrow(/check/i);
  });

  it('every change is in the public switch log, with its time and never who', async () => {
    await smallArea(lb, 3);
    await smallArea(lb, 3); // the same again is not a use
    const log = await get<{
      uses: { switch: string; value: string; subject: string | null; at: string }[];
    }>('/api/board/switches');
    const mine = log.body.uses.filter((u) => u.switch === 'small_area' && u.subject === lb.slug);
    expect(mine.map((u) => u.value)).toEqual(['3', '5']);
    expect(log.text).not.toContain(admin.email);
    const staffLog = await get<{ uses: { switch: string; subject: string | null; by: string }[] }>(
      '/api/moderation/switches',
      mod.call,
    );
    expect(
      staffLog.body.uses.find((u) => u.switch === 'small_area' && u.subject === lb.slug)?.by,
    ).toBe(admin.email);
  });
});

describe('the small-area threshold on every public surface of a counts-only logbook', () => {
  let lb: { id: number; slug: string };
  let listed: { id: number; slug: string };

  beforeAll(async () => {
    await setDistribution(h.db, true, 'admin@example.org');
    lb = await launchedLogbook(h.db, Q);
    listed = await launchedLogbook(h.db, Q);
    for (const l of [lb, listed]) {
      // The operator offers the place question as a filter, so the numbers
      // and /api/v1/stats break the logbook out by it.
      await h.db
        .updateTable('logbook_fields')
        .set({ filterable: true })
        .where('logbook_id', '=', l.id)
        .where('key', '=', 'where')
        .execute();
    }
    // Maricopa 3, Pima 1, Wyoming (state only) 1, California 2.
    await fileAt(lb, 'US-AZ-04013', 3);
    await fileAt(lb, 'US-AZ-04019', 1);
    await fileAt(lb, 'US-WY', 1);
    await fileAt(lb, 'US-CA', 2);
    await fileAt(listed, 'US-WY', 1);
    expect((await countsOnly(lb)).status).toBe(200);
  });

  interface Counts {
    logbooks: {
      slug: string;
      published: { organization: number; open_form: number };
      by_place: { place: string; organization: number; open_form: number }[];
      withheld_places?: { threshold: number; areas: string[]; reports: number | null };
    }[];
  }
  const countsFor = async (slug: string) => {
    const r = await get<Counts>('/api/board/counts');
    const mine = r.body.logbooks.find((l) => l.slug === slug);
    if (!mine) throw new Error(`no counts for ${slug}`);
    return { mine, text: JSON.stringify(mine) };
  };

  it('the counts route, at the default 2: a place with one report is a name with no number', async () => {
    const { mine, text } = await countsFor(lb.slug);
    expect(mine.published).toEqual({ organization: 0, open_form: 7 });
    expect(mine.by_place.map((p) => [p.place, p.organization + p.open_form])).toEqual([
      ['US-AZ-04013', 3],
      ['US-CA', 2],
    ]);
    expect(mine.withheld_places).toEqual({
      threshold: 2,
      areas: ['Pima County, Arizona', 'Wyoming'].sort((a, b) => a.localeCompare(b)),
      reports: 2,
    });
    // Neither code travels with a number: not in by_place, nowhere else.
    expect(text).not.toContain('US-AZ-04019');
    expect(text).not.toContain('"US-WY"');
  });

  it('raised to 3, California goes too', async () => {
    expect((await smallArea(lb, 3)).status).toBe(200);
    const { mine, text } = await countsFor(lb.slug);
    expect(mine.by_place.map((p) => p.place)).toEqual(['US-AZ-04013']);
    expect(mine.withheld_places?.threshold).toBe(3);
    expect(mine.withheld_places?.areas).toHaveLength(3);
    expect(mine.withheld_places?.reports).toBe(4);
    expect(text).not.toContain('"US-CA"');
  });

  it('the numbers and /api/v1/stats keep it on the place question', async () => {
    for (const url of ['/api/board/stats', '/api/v1/stats']) {
      const r = await get<{
        published_reports: {
          by_logbook: Record<
            string,
            {
              published: number;
              by_question: Record<
                string,
                {
                  counts: Record<string, number>;
                  withheld?: { threshold: number; areas: string[]; reports: number | null };
                }
              >;
            }
          >;
        };
      }>(url);
      expect(r.status, url).toBe(200);
      const q = r.body.published_reports.by_logbook[lb.slug]?.by_question.where;
      expect(q?.counts, url).toEqual({ 'Maricopa County, Arizona': 3 });
      expect(q?.withheld, url).toEqual({
        threshold: 3,
        areas: ['California', 'Pima County, Arizona', 'Wyoming'],
        reports: 4,
      });
      // A listed logbook keeps its counts: its reports show their own place
      // (decisions 20 and 21), so the threshold is for counts-only ones.
      expect(r.body.published_reports.by_logbook[listed.slug]?.by_question.where?.counts).toEqual({
        Wyoming: 1,
      });
    }
  });

  it('a heat map reading it keeps the higher of the two thresholds', async () => {
    await setLogbookPlace(h.db, lb.id, 'where');
    const slug = uniqueSlug('pe4map');
    await createMap(h.db, {
      slug,
      title: 'Counts only, mapped',
      enabled: true,
      min_area: 2,
      planes: ['us'],
      logbook_ids: [lb.id],
    });
    expect((await smallArea(lb, 4)).status).toBe(200);
    const r = await get<{
      threshold: number;
      areas: Record<string, { n: number }>;
      suppressed: { areas: string[]; reports: number | null };
    }>(`/api/maps/${slug}`);
    expect(r.status, r.text).toBe(200);
    expect(r.body.threshold).toBe(4);
    // Arizona is 4 (its two counties); California 2 and Wyoming 1 go uncounted.
    expect(Object.keys(r.body.areas)).toEqual(['US-AZ']);
    expect(r.body.suppressed.areas.sort()).toEqual(['US-CA', 'US-WY']);
    expect(r.text).not.toMatch(/"US-CA"\s*:\s*\{/);
  });

  it('nothing else counts it by place: the board, its spreadsheet, figures and the snapshot', async () => {
    // The board narrowed to a thin place shows nothing: counts-only reports
    // are listed nowhere, so there is no total to read.
    const narrowed = await get<{ total?: number; reports?: unknown[] }>(
      `/api/board/reports?logbook=${lb.slug}&a.where=US-AZ-04019`,
    );
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.total ?? 0).toBe(0);
    const csv = await h.app.inject({
      method: 'GET',
      url: `/api/board/reports.csv?logbook=${lb.slug}`,
    });
    expect(csv.body).not.toMatch(/US-AZ-04019|Pima/);
    // The front page's figures carry totals per logbook, never per place.
    const figures = (await catalogue(h.db)).filter((f) => f.id.includes(lb.slug));
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.every((f) => /\.(filed|published)\.[a-z0-9]+$/.test(f.id))).toBe(true);
    // The daily snapshot lists none of its reports; the counts snapshot is
    // lists only by its format (anchor/records.ts).
    const rows = await publishedReportRows(h.db).where('r.logbook_id', '=', lb.id).execute();
    expect(rows).toEqual([]);
  });

  it('switched back to entries, the threshold no longer applies', async () => {
    expect((await countsOnly(lb, false)).status).toBe(200);
    // Only the maps' rule is left: whatever threshold the maps reading it
    // hold (another file's map over every logbook may be one), never its own 4.
    const guard = (await countGuards(h.db)).get(lb.id);
    expect(guard?.threshold).toBe((await placeGuards(h.db)).get(lb.id)?.threshold);
    expect([...(guard?.keys ?? [])]).toEqual(['where']);
    const counts = await countsFor(lb.slug);
    expect(counts.mine.by_place).toEqual([]);
    expect((await countsOnly(lb)).status).toBe(200);
    expect((await countGuards(h.db)).get(lb.id)?.threshold).toBeGreaterThanOrEqual(4);
  });
});

// ── 4. "counted", never "public" ────────────────────────────────────────

describe('a counts-only logbook’s accepted report is counted, not public', () => {
  it('the confirmation link says counted; a listed logbook’s says public', async () => {
    const hidden = await launchedLogbook(h.db, Q);
    const shown = await launchedLogbook(h.db, Q);
    expect((await countsOnly(hidden)).status).toBe(200);
    for (const [lb, expected] of [
      [hidden, 'counted'],
      [shown, 'public'],
    ] as const) {
      const email = address('pe4-counted');
      const sent = await send(h, { ...spine(email), logbook: lb.slug, answers: { what: 'x' } });
      expect(sent.status).toBe(200);
      const token = tokenFor(h.mailer, email);
      if (!token) throw new Error('no link');
      const done = await confirm(h, token);
      const ref = done.body.confirmation.public_ref ?? '';
      await approve(h.db, await threadOf(h.db, ref));
      const look = await get<{ confirmation: { state: string } }>(`/api/reports/confirm/${token}`);
      expect(look.body.confirmation.state, lb.slug).toBe(expected);
    }
  });
});
