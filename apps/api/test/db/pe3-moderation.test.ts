/**
 * Plan E, session PE3: in the record and on the moderator screen.
 *
 * Each rule here gets a test that fails if it breaks:
 *   - "publish as counts only" hides a logbook's reports from every surface
 *     that shows a report one by one, and keeps them on every count;
 *   - organization reports and open-form ones are labelled apart;
 *   - declined reports are counted publicly by reason, and nothing else is;
 *   - a bulk decline writes one decision row per report (who, when);
 *   - pausing intake refuses the report form and list entries, says so
 *     publicly, and every switch use is in a public log with its time;
 *   - the organization lane sorts first and is handled as a set;
 *   - an intake link has a use limit and an off switch, in the database too;
 *   - the queue filters by window, place (county included) and answer set;
 *   - refusals are counted per hour by check, without content.
 */
import { cardFor } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedReportRows } from '../../src/anchor/records.ts';
import { runDigest } from '../../src/site/digest.ts';
import { countRefusal } from '../../src/moderation/refusals.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook, uniqueSlug } from './helpers.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { address, as, liftCurtain, seat, signIn } from './identity-helpers.ts';
import {
  approve,
  fileThread,
  moderationHarness,
  resetModerationSettings,
  staff,
} from './moderation-helpers.ts';
import type { Thread } from './moderation-helpers.ts';
import { doorPass } from '../door-pass.ts';

type Caller = Awaited<ReturnType<typeof staff>>['call'];

const PLACE_QUESTIONS = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  {
    key: 'where',
    kind: 'location',
    label: 'Where?',
    settings: { scope: 'country', country: 'US', depth: 'county' },
  },
] as const;

let h: FilingHarness;
let mod: { email: string; call: Caller };
let admin: { email: string; call: Caller };
let hidden: { id: number; slug: string };
let listed: { id: number; slug: string };
let orgId: number;
let orgName: string;
let coordinatorId: number;

// The type is the caller's statement of what the contract says comes back.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const get = async <T = Record<string, unknown>>(url: string, who?: Caller) => {
  const r = who ? await who({ method: 'GET', url }) : await h.app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json<T>(), text: r.body };
};
// The type is the caller's statement of what the contract says comes back.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const post = async <T = Record<string, unknown>>(
  who: Caller,
  url: string,
  payload: Record<string, unknown>,
  method: 'POST' | 'PUT' = 'POST',
) => {
  const r = await who({ method, url, payload });
  return { status: r.statusCode, body: r.json<T>(), text: r.body };
};

/** An open-form report, approved. */
async function openForm(lb: { id: number; slug: string }, what: string, where = 'US-AZ-04013') {
  const t = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what, where });
  await approve(h.db, t.threadId);
  return t;
}

/** A report an organization filed, sealed with its provenance and tied to a batch. Approved unless asked. */
async function fromOrganization(lb: { id: number; slug: string }, what: string, approved = true) {
  const t = await fileThread(
    h.db,
    lb,
    PLACE_QUESTIONS as never,
    { what, where: 'US-AZ' },
    {
      third_party: true,
      filed_via: orgName,
      intake_method: 'paper',
      attested_at: new Date().toISOString(),
      may_publish_digest: cardFor('coordinator').digest,
    },
  );
  const batch = await h.db
    .insertInto('intake_batches')
    .values({
      organization_id: orgId,
      coordinator_id: coordinatorId,
      status: 'submitted',
      submitted_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.db
    .insertInto('intake_drafts')
    .values({ batch_id: batch.id, ordinal: 1, report_id: t.reportId })
    .execute();
  if (approved) await approve(h.db, t.threadId);
  return t;
}

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  mod = await staff(h, 'pe3-mod', 'moderator');
  admin = await staff(h, 'pe3-admin', 'admin');
  hidden = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
  listed = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
  orgName = `PE3 Election Protection ${randomUUID().slice(0, 8)}`;
  const org = await h.db
    .insertInto('organizations')
    .values({ name: orgName, verified_by: 'admin@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  orgId = org.id;
  coordinatorId = await seat(h.db, address('pe3-coord'), 'user');
});
afterAll(async () => {
  await h.db
    .updateTable('flood_settings')
    .set({ intake_paused_at: null, puzzle_level: 'normal' })
    .where('id', '=', true)
    .execute();
  await resetModerationSettings(h.db);
  await h.close();
});

// ── publish as counts only ──────────────────────────────────────────────

describe('publish as counts only', () => {
  let a: Thread;
  let b: Thread;
  let c: Thread;

  beforeAll(async () => {
    a = await openForm(hidden, `counts-only marker ${randomUUID()}`);
    b = await fromOrganization(hidden, `counts-only org marker ${randomUUID()}`);
    c = await openForm(listed, `listed marker ${randomUUID()}`);
    // A digest subscriber following the counts-only logbook.
    const sub = await seat(h.db, address('pe3-digest'), 'user');
    await h.db
      .insertInto('digest_subscriptions')
      .values({ user_id: sub, frequency: 'hourly', logbooks: [hidden.slug, listed.slug] })
      .execute();
    await h.db
      .updateTable('moderation_settings')
      .set({ distribution_enabled: true })
      .where('id', '=', true)
      .execute();
  });

  it('is an administrator’s setting, and a moderator cannot change it', async () => {
    const url = `/api/admin/moderation/logbooks/${hidden.slug}/counts-only`;
    expect((await post(mod.call, url, { counts_only: true }, 'PUT')).status).toBe(403);
    const r = await post(admin.call, url, { counts_only: true }, 'PUT');
    expect(r.status, r.text).toBe(200);
    const all = await get<{ logbooks: { slug: string; counts_only: boolean }[] }>(
      '/api/admin/moderation/counts-only',
      admin.call,
    );
    expect(all.body.logbooks.find((l) => l.slug === hidden.slug)?.counts_only).toBe(true);
  });

  it('the board, one report and the spreadsheet show none of its reports', async () => {
    const page = await get(`/api/board/reports?logbook=${hidden.slug}`);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain(a.publicRef);
    expect(page.text).not.toContain(b.publicRef);
    const all = await get('/api/board/reports');
    expect(all.text).not.toContain(a.publicRef);
    expect(all.text).toContain(c.publicRef);
    expect((await get(`/api/board/reports/${a.publicRef}`)).status).toBe(404);
    const csv = await h.app.inject({
      method: 'GET',
      url: `/api/board/reports.csv?logbook=${hidden.slug}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).not.toContain(a.publicRef);
    // The board says the logbook is counts only, so the page can show the counts.
    const board = await get<{ logbooks: { slug: string; counts_only: boolean }[] }>('/api/board');
    expect(board.body.logbooks.find((l) => l.slug === hidden.slug)?.counts_only).toBe(true);
    expect(board.body.logbooks.find((l) => l.slug === listed.slug)?.counts_only).toBe(false);
  });

  it('the verify page gives its fingerprints and never its text', async () => {
    const v = await get(`/api/reports/${a.publicRef}/verify`);
    expect(v.status).toBe(200);
    expect(v.body.canonical_json).toBeUndefined();
    expect(v.body.hashed_fields).toBeUndefined();
    const shown = await get(`/api/reports/${c.publicRef}/verify`);
    expect(shown.body.canonical_json).toBeDefined();
  });

  it('the published chain file, the daily snapshot and a digest leave it out', async () => {
    const chain = await get(`/api/chain/${hidden.slug}`);
    expect(chain.status, chain.text).toBe(200);
    expect(chain.text).not.toContain(a.publicRef);
    const otherChain = await get(`/api/chain/${listed.slug}`);
    expect(otherChain.text).toContain(c.publicRef);
    // The rows the daily snapshot in the transparency log is built from.
    const refs = (await publishedReportRows(h.db).execute()).map((r) => r.public_ref).join(' ');
    expect(refs).not.toContain(a.publicRef);
    expect(refs).toContain(c.publicRef);
    await runDigest({
      db: h.db,
      mailer: h.mailer,
      siteOrigin: 'https://x.test',
      log: () => undefined,
      frequency: 'hourly',
      now: () => new Date(Date.now() + 120_000),
    });
    const mail = h.mailer.messages.map((m) => m.text).join('\n');
    expect(mail).not.toContain(a.publicRef);
    expect(mail).toContain(c.publicRef);
  });

  it('its reports are still counted: numbers, counts by place and time, maps', async () => {
    const stats = await get<{
      published_reports: { by_logbook: Record<string, { published: number }> };
    }>('/api/board/stats');
    expect(stats.body.published_reports.by_logbook[hidden.slug]?.published).toBe(2);
    const counts = await get<{
      labels: Record<string, string>;
      logbooks: {
        slug: string;
        counts_only: boolean;
        published: { organization: number; open_form: number };
        by_place: { place: string; label: string; organization: number; open_form: number }[];
        withheld_places?: { threshold: number; areas: string[]; reports: number | null };
        by_day: unknown[];
        by_hour: unknown[];
      }[];
    }>('/api/board/counts');
    expect(counts.status).toBe(200);
    const mine = counts.body.logbooks.find((l) => l.slug === hidden.slug);
    expect(mine?.counts_only).toBe(true);
    expect(mine?.published).toEqual({ organization: 1, open_form: 1 });
    // A county counts as itself; a state answer as the state. One report
    // each, under the logbook's small-area threshold (default 2, PE4): named,
    // with no number (pe4-counts.test.ts tests the threshold itself).
    expect(mine?.by_place).toEqual([]);
    expect(mine?.withheld_places).toEqual({
      threshold: 2,
      areas: ['Arizona', 'Maricopa County, Arizona'],
      reports: 2,
    });
    expect(mine?.by_day.length).toBe(1);
    expect(mine?.by_hour.length).toBeGreaterThanOrEqual(1);
    // Counts only: no reference and no answer anywhere in it.
    expect(counts.text).not.toContain(a.publicRef);
    expect(counts.text).not.toContain('counts-only marker');
    // A logbook listed as entries gets arrival hours, and no place breakdown.
    const other = counts.body.logbooks.find((l) => l.slug === listed.slug);
    expect(other?.by_place).toEqual([]);
    expect(other?.by_hour.length).toBeGreaterThanOrEqual(1);
  });

  it('turning it on and off is a public switch use, with its time and not who', async () => {
    const log = await get<{ uses: { switch: string; value: string; subject: string | null }[] }>(
      '/api/board/switches',
    );
    expect(log.body.uses).toContainEqual(
      expect.objectContaining({ switch: 'counts_only', value: 'on', subject: hidden.slug }),
    );
    expect(log.text).not.toContain(admin.email);
  });
});

// ── labels ──────────────────────────────────────────────────────────────

describe('where a report came from, labelled', () => {
  it('an open-form report says unverified, an organization’s says so, in the operator’s words', async () => {
    const open = await openForm(listed, `label open ${randomUUID()}`);
    const org = await fromOrganization(listed, `label org ${randomUUID()}`);
    const one = async (ref: string) =>
      (await get<{ report: { origin: string; label: string } }>(`/api/board/reports/${ref}`)).body
        .report;
    expect(await one(open.publicRef)).toMatchObject({
      origin: 'open_form',
      label: 'Unverified public report',
    });
    expect(await one(org.publicRef)).toMatchObject({
      origin: 'organization',
      label: 'Filed by an organization',
    });
    await h.db
      .insertInto('site_copy')
      .values({ key: 'origin_open_form', body: 'Sent in by the public, not checked' })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({ body: 'Sent in by the public, not checked' }),
      )
      .execute();
    try {
      expect((await one(open.publicRef)).label).toBe('Sent in by the public, not checked');
      const csv = await h.app.inject({
        method: 'GET',
        url: `/api/board/reports.csv?logbook=${listed.slug}`,
      });
      expect(csv.body).toContain('Sent in by the public, not checked');
    } finally {
      await h.db.deleteFrom('site_copy').where('key', '=', 'origin_open_form').execute();
    }
  });
});

// ── declined, counted ───────────────────────────────────────────────────

describe('declined reports, counted publicly by reason', () => {
  it('counts what is declined now, by reason, and shows nothing of the reports', async () => {
    const lb = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
    const marker = `declined marker ${randomUUID()}`;
    const t1 = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: marker });
    const t2 = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: marker });
    const t3 = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: marker });
    const pending = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: marker });
    const decide = (t: Thread, reason_code: string) =>
      post(mod.call, `/api/moderation/reports/${t.threadId}/decision`, {
        status: 'invalid',
        comment: 'Moderator sentence that stays private.',
        reason_code,
      });
    expect((await decide(t1, 'duplicate')).status).toBe(200);
    expect((await decide(t2, 'duplicate')).status).toBe(200);
    expect((await decide(t3, 'abusive_or_spam')).status).toBe(200);
    // Declined, then put back: not a decline any more.
    await post(mod.call, `/api/moderation/reports/${t3.threadId}/decision`, {
      status: 'unknown',
      comment: 'Looking again.',
    });
    const r = await get<{
      logbooks: { slug: string; by_reason: { code: string; reports: number }[] }[];
    }>('/api/board/declined');
    expect(r.status).toBe(200);
    const mine = r.body.logbooks.find((l) => l.slug === lb.slug);
    expect(mine?.by_reason.map((x) => [x.code, x.reports])).toEqual([['duplicate', 2]]);
    for (const t of [t1, t2, t3, pending]) expect(r.text).not.toContain(t.publicRef);
    expect(r.text).not.toContain(marker);
    expect(r.text).not.toContain('Moderator sentence');
    expect(r.text).not.toContain(mod.email);
  });

  it('a closed archive publishes no declined counts either', async () => {
    await h.db
      .updateTable('moderation_settings')
      .set({ public_archive_enabled: false })
      .where('id', '=', true)
      .execute();
    try {
      for (const url of ['/api/board/declined', '/api/board/counts']) {
        expect((await get<{ published: boolean }>(url)).body.published).toBe(false);
      }
    } finally {
      await h.db
        .updateTable('moderation_settings')
        .set({ public_archive_enabled: null })
        .where('id', '=', true)
        .execute();
    }
  });
});

// ── bulk decline ────────────────────────────────────────────────────────

describe('bulk decline', () => {
  it('writes one decision row per report, with who, when and the batch', async () => {
    const lb = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
    const flood = [];
    for (let i = 0; i < 5; i++) {
      flood.push(await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'same words' }));
    }
    const r = await post<{ bulk_id: number; declined: string[]; skipped: unknown[] }>(
      mod.call,
      '/api/moderation/reports/bulk-decline',
      {
        thread_ids: flood.map((t) => t.threadId),
        reason_code: 'abusive_or_spam',
        filter: { logbook: lb.slug },
      },
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body.declined).toHaveLength(5);
    const rows = await h.db
      .selectFrom('moderation_log')
      .selectAll()
      .where('bulk_id', '=', r.body.bulk_id)
      .execute();
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((x) => x.thread_id))).toEqual(new Set(flood.map((t) => t.threadId)));
    for (const row of rows) {
      expect(row).toMatchObject({
        action: 'review',
        new_status: 'invalid',
        actor_email: mod.email,
        reason_code: 'abusive_or_spam',
      });
      expect(row.created_at).toBeInstanceOf(Date);
    }
    const bulk = await h.db
      .selectFrom('moderation_bulk_actions')
      .selectAll()
      .where('id', '=', r.body.bulk_id)
      .executeTakeFirstOrThrow();
    expect(bulk).toMatchObject({ action: 'decline', reached: 5, actor_email: mod.email });
    // No email: a flood's addresses are whatever the flood typed.
    expect(
      await h.db
        .selectFrom('decision_notices')
        .select('id')
        .where(
          'thread_id',
          'in',
          flood.map((t) => t.threadId),
        )
        .execute(),
    ).toHaveLength(0);
    // Counted publicly by its reason.
    const declined = await get<{
      logbooks: { slug: string; by_reason: { code: string; reports: number }[] }[];
    }>('/api/board/declined');
    expect(declined.body.logbooks.find((l) => l.slug === lb.slug)?.by_reason).toEqual([
      expect.objectContaining({ code: 'abusive_or_spam', reports: 5 }),
    ]);
  });

  it('skips what is withdrawn or already declined, and refuses a reason not on the list', async () => {
    const lb = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
    const t = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'x' });
    const w = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'y' });
    await h.db
      .updateTable('report_heads')
      .set({ withdrawn: true })
      .where('thread_id', '=', w.threadId)
      .execute();
    const bad = await post(mod.call, '/api/moderation/reports/bulk-decline', {
      thread_ids: [t.threadId],
      reason_code: 'because',
    });
    expect(bad.status).toBe(400);
    const r = await post<{ declined: string[]; skipped: { thread_id: string }[] }>(
      mod.call,
      '/api/moderation/reports/bulk-decline',
      { thread_ids: [t.threadId, w.threadId], reason_code: 'duplicate' },
    );
    expect(r.body.declined).toEqual([t.threadId]);
    expect(r.body.skipped.map((s) => s.thread_id)).toEqual([w.threadId]);
  });

  it('is for moderators, not anybody signed in', async () => {
    const who = await staff(h, 'pe3-user', 'user');
    const r = await post(who.call, '/api/moderation/reports/bulk-decline', {
      thread_ids: [randomUUID()],
      reason_code: 'duplicate',
    });
    expect(r.status).toBe(403);
  });

  // Step-up on this route is tested with the others in second-factor.test.ts (LISTED).
});

// ── pause intake and the puzzle ─────────────────────────────────────────

describe('pause intake', () => {
  it('refuses the report form and list entries, shows the notice, and logs the use publicly', async () => {
    // A listed tip list, made the way an administrator makes one.
    const listSlug = uniqueSlug('pe3-tips');
    const made = await post<{ id: number }>(admin.call, '/api/admin/lists', {
      template: 'tips',
      slug: listSlug,
    });
    expect(made.status, made.text).toBe(200);
    const patched = await admin.call({
      method: 'PATCH',
      url: `/api/admin/lists/${String(made.body.id)}`,
      payload: { visibility: 'listed' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    // With the door's fields (door-pass.ts), so the only reason left to
    // refuse is the pause.
    const entry = async () =>
      h.app.inject({
        method: 'POST',
        url: `/api/lists/${listSlug}/entries`,
        payload: { ...(await doorPass(h.app)), answers: {} },
      });
    const report = async () =>
      h.app.inject({
        method: 'POST',
        url: '/api/reports',
        payload: {
          ...(await doorPass(h.app)),
          logbook: listed.slug,
          answers: { what: 'during a pause' },
          email: address('pe3-paused'),
          consent: true,
          may_publish: true,
          may_publish_digest: cardFor('general').digest,
        },
      });

    expect((await get<{ paused: boolean }>('/api/intake-pause')).body.paused).toBe(false);
    const on = await post(mod.call, '/api/moderation/switches/pause', { paused: true });
    expect(on.status, on.text).toBe(200);

    const pause = await get<{ paused: boolean; since: string | null; notice: string }>(
      '/api/intake-pause',
    );
    expect(pause.body.paused).toBe(true);
    expect(pause.body.since).not.toBeNull();
    expect(pause.body.notice).toMatch(/^Intake is paused/);

    const refusedReport = await report();
    expect(refusedReport.statusCode).toBe(503);
    expect(refusedReport.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'intake_paused',
      message: expect.stringMatching(/^Intake is paused/) as unknown,
    });
    const before = await h.db.selectFrom('list_entries').select('id').execute();
    const refusedEntry = await entry();
    expect(refusedEntry.statusCode).toBe(503);
    expect((await h.db.selectFrom('list_entries').select('id').execute()).length).toBe(
      before.length,
    );

    const off = await post(mod.call, '/api/moderation/switches/pause', { paused: false });
    expect(off.status).toBe(200);
    expect((await report()).statusCode).toBe(200);
    expect((await entry()).statusCode).not.toBe(503);

    const log = await get<{ uses: { switch: string; value: string; at: string }[] }>(
      '/api/board/switches',
    );
    const uses = log.body.uses.filter((u) => u.switch === 'pause_intake').slice(0, 2);
    expect(uses.map((u) => u.value)).toEqual(['off', 'on']);
    for (const u of uses) expect(Number.isNaN(new Date(u.at).getTime())).toBe(false);
    expect(log.text).not.toContain(mod.email);
    // Staff see who.
    const staffLog = await get<{ uses: { switch: string; by: string }[] }>(
      '/api/moderation/switches',
      mod.call,
    );
    expect(staffLog.body.uses.find((u) => u.switch === 'pause_intake')?.by).toBe(mod.email);
  });

  it('the pause notice is in front of the password, like the forms that ask it', async () => {
    await h.db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('pe3 curtain') })
      .where('id', '=', true)
      .execute();
    try {
      expect((await get('/api/intake-pause')).status).toBe(200);
      expect((await get('/api/board/switches')).status).not.toBe(200);
    } finally {
      await liftCurtain(h.db);
    }
  });

  it('the harder puzzle is stored, logged, and read back for the door', async () => {
    const r = await post<{ puzzle: string }>(mod.call, '/api/moderation/switches/puzzle', {
      level: 'harder',
    });
    expect(r.body.puzzle).toBe('harder');
    const { puzzleLevel } = await import('../../src/moderation/switches.ts');
    expect(await puzzleLevel(h.db)).toBe('harder');
    await post(mod.call, '/api/moderation/switches/puzzle', { level: 'normal' });
    const log = await get<{ uses: { switch: string; value: string }[] }>('/api/board/switches');
    expect(
      log.body.uses
        .filter((u) => u.switch === 'puzzle')
        .map((u) => u.value)
        .slice(0, 2),
    ).toEqual(['normal', 'harder']);
  });

  // Step-up on both switches is tested in second-factor.test.ts (LISTED).
  it('the switch log cannot be rewritten', async () => {
    await expect(h.db.deleteFrom('site_switch_log').execute()).rejects.toThrow(/append-only/);
  });
});

// ── the organization lane ───────────────────────────────────────────────

describe('the organization lane', () => {
  it('organization reports sort first, and one organization’s are found as a set', async () => {
    const lb = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
    const early = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'open, early' });
    const org = await fromOrganization(lb, 'org, later', false);
    const late = await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'open, latest' });
    const q = await get<{
      reports: { thread_id: string; origin: string; organization_id: number | null }[];
    }>(`/api/moderation/reports?status=pending&logbook=${lb.slug}`, mod.call);
    expect(q.body.reports.map((r) => r.thread_id)).toEqual([
      org.threadId,
      late.threadId,
      early.threadId,
    ]);
    expect(q.body.reports[0]).toMatchObject({ origin: 'organization', organization_id: orgId });
    const set = await get<{ reports: { thread_id: string }[] }>(
      `/api/moderation/reports?status=all&organization=${String(orgId)}`,
      mod.call,
    );
    expect(set.body.reports.length).toBeGreaterThanOrEqual(1);
    expect(set.body.reports.map((r) => r.thread_id)).toContain(org.threadId);
    expect(set.body.reports.map((r) => r.thread_id)).not.toContain(early.threadId);
    const lane = await get<{ organizations: { id: number; pending: number }[] }>(
      '/api/moderation/organizations',
      mod.call,
    );
    expect(lane.body.organizations.find((o) => o.id === orgId)?.pending).toBeGreaterThanOrEqual(1);
    // Handled as a set: the existing batch approval takes what the filter showed.
    const ok = await post<{ approved: string[] }>(
      mod.call,
      '/api/moderation/reports/batch-approve',
      {
        thread_ids: set.body.reports.map((r) => r.thread_id),
      },
    );
    expect(ok.body.approved).toContain(org.threadId);
  });
});

// ── intake links ────────────────────────────────────────────────────────

describe('organization intake links', () => {
  let manager: { email: string; call: Caller };
  beforeAll(async () => {
    manager = await staff(h, 'pe3-manager', 'user');
    const id = await h.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', manager.email)
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('organization_memberships')
      .values({ organization_id: orgId, user_id: id.id, role: 'manager' })
      .execute();
    // Sign in again so the session carries the membership.
    manager = { email: manager.email, call: as(h, await signIn(h, manager.email)) };
  });

  const volunteer = async (stem: string) => {
    const email = address(stem);
    await seat(h.db, email, 'user');
    return { email, call: as(h, await signIn(h, email)) };
  };

  it('a manager makes one with a limit; it joins as coordinator until the limit, then refuses', async () => {
    const made = await post<{ link: { id: number }; url: string }>(
      manager.call,
      `/api/orgs/${String(orgId)}/intake-links`,
      { label: 'Polling-place volunteers', max_uses: 2 },
    );
    expect(made.status, made.text).toBe(200);
    const token = /\/organizations\/join\/([0-9a-f]{64})$/.exec(made.body.url)?.[1] ?? '';
    expect(token).not.toBe('');
    const join = (who: Caller) => post(who, `/api/intake-links/${token}/join`, {});
    const v1 = await volunteer('pe3-v1');
    const v2 = await volunteer('pe3-v2');
    const v3 = await volunteer('pe3-v3');
    expect((await join(v1.call)).status).toBe(200);
    // Joining twice uses nothing up.
    expect((await join(v1.call)).body).toMatchObject({ already_member: true });
    expect((await join(v2.call)).status).toBe(200);
    const full = await join(v3.call);
    expect(full.status).toBe(410);
    const role = await h.db
      .selectFrom('organization_memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.role')
      .where('u.email', '=', v1.email)
      .where('m.organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
    expect(role.role).toBe('coordinator');
    const audit = await h.db
      .selectFrom('role_audit')
      .select('detail')
      .where('subject_email', '=', v1.email)
      .execute();
    expect(audit.map((a) => a.detail).join(' ')).toMatch(/intake link/);
    // The list shows uses, never the link.
    const listing = await get<{ links: { id: number; uses: number }[] }>(
      `/api/orgs/${String(orgId)}/intake-links`,
      manager.call,
    );
    expect(listing.body.links.find((l) => l.id === made.body.link.id)?.uses).toBe(2);
    expect(listing.text).not.toContain(token);
  });

  it('the off switch stops it for good, and the database refuses a use past the limit itself', async () => {
    const made = await post<{ link: { id: number }; url: string }>(
      manager.call,
      `/api/orgs/${String(orgId)}/intake-links`,
      { label: 'Phone bank', max_uses: 1 },
    );
    const token = /join\/([0-9a-f]{64})$/.exec(made.body.url)?.[1] ?? '';
    const off = await post(
      manager.call,
      `/api/orgs/${String(orgId)}/intake-links/${String(made.body.link.id)}/off`,
      {},
    );
    expect(off.status).toBe(200);
    const v = await volunteer('pe3-v4');
    expect((await post(v.call, `/api/intake-links/${token}/join`, {})).status).toBe(410);
    expect((await get<{ usable: boolean }>(`/api/intake-links/${token}`, v.call)).body.usable).toBe(
      false,
    );
    // Once off, always off.
    await expect(
      h.db
        .updateTable('organization_intake_links')
        .set({ disabled_at: null, disabled_by: null })
        .where('id', '=', made.body.link.id)
        .execute(),
    ).rejects.toThrow(/stays off/);
    // Past the limit, straight into the table: refused by the trigger.
    const fresh = await post<{ link: { id: number } }>(
      manager.call,
      `/api/orgs/${String(orgId)}/intake-links`,
      { label: 'One use', max_uses: 1 },
    );
    const ids = await h.db.selectFrom('users').select('id').limit(2).execute();
    await h.db
      .insertInto('organization_intake_link_uses')
      .values({ link_id: fresh.body.link.id, user_id: ids[0]?.id ?? 0 })
      .execute();
    await expect(
      h.db
        .insertInto('organization_intake_link_uses')
        .values({ link_id: fresh.body.link.id, user_id: ids[1]?.id ?? 0 })
        .execute(),
    ).rejects.toThrow(/as many times/);
  });

  it('only that organization’s managers, or those who grant access, manage its links', async () => {
    const outsider = await volunteer('pe3-outsider');
    const r = await post(outsider.call, `/api/orgs/${String(orgId)}/intake-links`, {
      label: 'nope',
      max_uses: 5,
    });
    expect(r.status).toBe(403);
    expect((await get(`/api/orgs/${String(orgId)}/intake-links`, admin.call)).status).toBe(200);
  });
});

// ── the flood screen and its filters ────────────────────────────────────

describe('the flood screen', () => {
  it('counts submissions per hour for 24 hours, refusals by check, and identical sets', async () => {
    const lb = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
    for (let i = 0; i < 3; i++) {
      await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'copy paste', where: 'US-OH' });
    }
    await countRefusal(h.db, 'honeypot');
    await countRefusal(h.db, 'honeypot');
    await countRefusal(h.db, 'proof_of_work');
    await countRefusal(h.db, 'NOT A NAME; drop table');
    const r = await get<{
      hours: { hour: string; reports: number; tips: number }[];
      refusals: { check: string; refusals: number }[];
      identical: { answer_set: string; logbook_slug: string; reports: number }[];
    }>('/api/moderation/flood', mod.call);
    expect(r.status, r.text).toBe(200);
    expect(r.body.hours).toHaveLength(24);
    expect(r.body.hours.at(-1)?.reports).toBeGreaterThanOrEqual(3);
    const now = r.body.refusals.filter((x) => x.check === 'honeypot');
    expect(now.reduce((s, x) => s + x.refusals, 0)).toBeGreaterThanOrEqual(2);
    expect(r.body.refusals.some((x) => x.check === 'other')).toBe(true);
    const set = r.body.identical.find((g) => g.logbook_slug === lb.slug);
    expect(set?.reports).toBe(3);

    // The queue filters by that set, by place and by window.
    const bySet = await get<{ reports: unknown[] }>(
      `/api/moderation/reports?status=all&answer_set=${set?.answer_set ?? ''}`,
      mod.call,
    );
    expect(bySet.body.reports).toHaveLength(3);
    const ohio = await get<{ reports: unknown[] }>(
      `/api/moderation/reports?status=all&logbook=${lb.slug}&place=US-OH`,
      mod.call,
    );
    expect(ohio.body.reports).toHaveLength(3);
    const elsewhere = await get<{ reports: unknown[] }>(
      `/api/moderation/reports?status=all&logbook=${lb.slug}&place=US-AZ`,
      mod.call,
    );
    expect(elsewhere.body.reports).toHaveLength(0);
    const past = await get<{ reports: unknown[] }>(
      `/api/moderation/reports?status=all&logbook=${lb.slug}&to=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`,
      mod.call,
    );
    expect(past.body.reports).toHaveLength(0);
  });

  it('a county filter takes the county only; a state takes its counties', async () => {
    const lb = await launchedLogbook(h.db, PLACE_QUESTIONS as never);
    await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'a', where: 'US-AZ-04013' });
    await fileThread(h.db, lb, PLACE_QUESTIONS as never, { what: 'b', where: 'US-AZ-04019' });
    const n = async (place: string) =>
      (
        await get<{ reports: unknown[] }>(
          `/api/moderation/reports?status=all&logbook=${lb.slug}&place=${place}`,
          mod.call,
        )
      ).body.reports.length;
    expect(await n('US-AZ')).toBe(2);
    expect(await n('US-AZ-04013')).toBe(1);
  });

  it('the refusal counts hold no content: an hour, a check name and a number', async () => {
    const cols = await h.db
      .selectFrom('information_schema.columns' as never)
      .select('column_name' as never)
      .where('table_name' as never, '=', 'intake_refusal_counts' as never)
      .execute();
    expect((cols as { column_name: string }[]).map((c) => c.column_name).sort()).toEqual([
      'check_name',
      'hour',
      'refusals',
    ]);
  });

  it('is for moderators', async () => {
    expect((await get('/api/moderation/flood')).status).toBe(401);
  });
});
