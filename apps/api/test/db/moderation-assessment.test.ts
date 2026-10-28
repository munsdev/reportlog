/**
 * Severity, incidents and corroboration (legacy's moderation extras), through
 * the routes.
 *
 * What it holds: both are a moderator's judgement, given with a reason and
 * logged with who; neither is ever inside a seal; corroboration counts only
 * PUBLISHED accounts, by the board's one rule, so it is a number a reader
 * could check; and the board itself serves neither.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { QUESTIONS, launchedLogbook } from './helpers.ts';
import {
  approve,
  fileThread,
  moderationHarness,
  resetModerationSettings,
  seenOf,
  staff,
} from './moderation-helpers.ts';
import type { Thread } from './moderation-helpers.ts';

type Caller = Awaited<ReturnType<typeof staff>>['call'];

let h: FilingHarness;
let lb: { id: number; slug: string };
let mod: { email: string; call: Caller };

const file = (what: string) => fileThread(h.db, lb, QUESTIONS, { what });
const rate = (t: Thread, payload: Record<string, unknown>) =>
  mod.call({
    method: 'POST',
    url: `/api/moderation/reports/${t.threadId}/severity`,
    payload,
  });
const link = (t: Thread, payload: Record<string, unknown>) =>
  mod.call({
    method: 'POST',
    url: `/api/moderation/reports/${t.threadId}/incident`,
    payload,
  });

interface Item {
  report: { severity: string | null; corroboration: number; incident_size: number };
  assessment: {
    severity: string | null;
    incident_id: string | null;
    linked: { public_ref: string; published: boolean }[];
    published_accounts: number;
  };
}
const item = async (t: Thread) =>
  (await mod.call({ method: 'GET', url: `/api/moderation/reports/${t.threadId}` })).json<Item>();
const queue = async (query: string) =>
  (await mod.call({ method: 'GET', url: `/api/moderation/reports?status=all&${query}` })).json<{
    reports: { public_ref: string }[];
  }>().reports;
interface Summary {
  published: number;
  corroborated_accounts: number;
  single_accounts: number;
  incidents_with_several_accounts: number;
  by_severity: Record<string, number>;
}
const logOf = (t: Thread) =>
  h.db
    .selectFrom('moderation_log')
    .select(['action', 'new_status', 'actor_email', 'comment'])
    .where('thread_id', '=', t.threadId)
    .where('action', 'in', ['severity', 'incident'])
    .orderBy('id')
    .execute();

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  lb = await launchedLogbook(h.db);
  mod = await staff(h, 'assess-mod', 'moderator');
});
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

describe('severity', () => {
  it('is for moderators and administrators only', async () => {
    const t = await file('A report somebody without a role tries to rate.');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/moderation/reports/${t.threadId}/severity`,
      payload: { severity: 'serious', comment: 'Not mine to rate.' },
    });
    expect(res.statusCode).toBe(401);
    const user = await staff(h, 'assess-user', 'user');
    expect(
      (
        await user.call({
          method: 'POST',
          url: `/api/moderation/reports/${t.threadId}/severity`,
          payload: { severity: 'serious', comment: 'Not mine to rate.' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('starts unrated, needs one of the four words and a reason, and is logged with who', async () => {
    const t = await file('Leaflets handed out inside the hall.');
    expect((await item(t)).assessment.severity).toBeNull();
    expect((await rate(t, { severity: 'serious' })).statusCode).toBe(400);
    expect((await rate(t, { severity: 'catastrophic', comment: 'Bad.' })).statusCode).toBe(400);
    // A request that forgot the field is refused, never read as "clear it".
    expect((await rate(t, { comment: 'Forgot the rating.' })).statusCode).toBe(400);
    expect(await logOf(t)).toHaveLength(0);

    const res = await rate(t, { severity: 'irregularity', comment: 'Against the rules, no harm.' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, severity: 'irregularity' });
    expect((await item(t)).report.severity).toBe('irregularity');
    expect(await logOf(t)).toEqual([
      {
        action: 'severity',
        new_status: 'irregularity',
        actor_email: mod.email,
        comment: 'Against the rules, no harm.',
      },
    ]);
  });

  it('can be changed and cleared ("none"), and every change stays on the record', async () => {
    const t = await file('A report rated twice and then cleared.');
    await rate(t, { severity: 'note', comment: 'First look.' });
    await rate(t, { severity: 'systemic', comment: 'Seen in three halls now.' });
    expect((await item(t)).assessment.severity).toBe('systemic');
    expect(
      (await rate(t, { severity: 'none', comment: 'Rated the wrong report.' })).json(),
    ).toEqual({ ok: true, severity: null });
    expect((await item(t)).assessment.severity).toBeNull();
    expect((await logOf(t)).map((l) => l.new_status)).toEqual(['note', 'systemic', 'none']);
    // Cleared by NULL, never by deleting the row.
    await expect(
      h.db.deleteFrom('report_assessments').where('thread_id', '=', t.threadId).execute(),
    ).rejects.toThrow();
  });

  it('filters the queue by rating, and "none" finds the reports nobody rated', async () => {
    const rated = await file(`A rated report ${String(Date.now())}.`);
    const unrated = await file(`An unrated report ${String(Date.now())}.`);
    await rate(rated, { severity: 'serious', comment: 'People were turned away.' });
    const serious = (await queue('severity=serious')).map((r) => r.public_ref);
    expect(serious).toContain(rated.publicRef);
    expect(serious).not.toContain(unrated.publicRef);
    const none = (await queue('severity=none')).map((r) => r.public_ref);
    expect(none).toContain(unrated.publicRef);
    expect(none).not.toContain(rated.publicRef);
    const bad = await mod.call({ method: 'GET', url: '/api/moderation/reports?severity=awful' });
    expect(bad.statusCode).toBe(400);
  });

  it('IS NEVER PART OF THE SEAL: a rated report verifies exactly as before', async () => {
    const t = await file('A report whose fingerprint must not move.');
    const before = await verifyReport(h.db, t.publicRef);
    await rate(t, { severity: 'serious', comment: 'Rated after filing.' });
    await link(t, { link_to: (await file('Its twin.')).publicRef, comment: 'Same hall.' });
    const after = await verifyReport(h.db, t.publicRef);
    expect(after).toEqual(before);
    expect(after?.content.ok && after.link.ok).toBe(true);
    expect(JSON.stringify(after)).not.toContain('serious');
  });
});

describe('incidents and corroboration', () => {
  it('links two reports into an incident, and a third joins it', async () => {
    const a = await file('The doors opened an hour late.');
    const b = await file('We waited outside until nine.');
    const c = await file('The queue went round the block.');
    const res = await link(a, { link_to: b.publicRef, comment: 'Same hall, same morning.' });
    expect(res.statusCode).toBe(200);
    const incident = res.json<{ incident_id: string }>().incident_id;
    expect(incident).toMatch(/^[0-9a-f-]{36}$/);
    expect((await item(b)).assessment.incident_id).toBe(incident);

    await link(c, { link_to: b.publicRef, comment: 'Also that morning.' });
    const seen = await item(a);
    expect(seen.assessment.incident_id).toBe(incident);
    expect(seen.assessment.linked.map((l) => l.public_ref).sort()).toEqual(
      [b.publicRef, c.publicRef].sort(),
    );
    expect(seen.report.incident_size).toBe(3);
    expect((await logOf(c))[0]).toMatchObject({
      action: 'incident',
      new_status: `linked to ${b.publicRef}`,
      actor_email: mod.email,
      comment: 'Also that morning.',
    });
  });

  it('COUNTS ONLY PUBLISHED ACCOUNTS, by the board’s own rule', async () => {
    const a = await file('Ballot papers ran out at noon.');
    const b = await file('No papers left by lunchtime.');
    const c = await file('They had run out of papers.');
    await link(b, { link_to: a.publicRef, comment: 'Same shortage.' });
    await link(c, { link_to: a.publicRef, comment: 'Same shortage.' });
    // Nothing approved yet: linked, but nothing a reader could check.
    expect((await item(a)).report).toMatchObject({ corroboration: 0, incident_size: 3 });

    await approve(h.db, a.threadId);
    await approve(h.db, b.threadId);
    let seen = await item(a);
    expect(seen.report.corroboration).toBe(2);
    expect(seen.assessment.published_accounts).toBe(2);
    expect(seen.assessment.linked.find((l) => l.public_ref === c.publicRef)?.published).toBe(false);

    // Taken off the board: no longer counted, though still linked.
    await mod.call({
      method: 'POST',
      url: `/api/moderation/reports/${b.threadId}/withdraw`,
      payload: { comment: 'Taken down while we check.', seen: await seenOf(h.db, b.threadId) },
    });
    seen = await item(a);
    expect(seen.report).toMatchObject({ corroboration: 1, incident_size: 3 });
  });

  it('unlinks, and refuses a report linked to itself or to a reference that does not exist', async () => {
    const a = await file('A report linked and then unlinked.');
    const b = await file('Its partner.');
    expect((await link(a, { link_to: b.publicRef })).statusCode).toBe(400);
    expect((await link(a, { link_to: a.publicRef, comment: 'Itself.' })).statusCode).toBe(400);
    expect((await link(a, { link_to: 'RL-NOPE-0000', comment: 'Nothing.' })).statusCode).toBe(404);

    await link(a, { link_to: b.publicRef, comment: 'Same thing.' });
    const res = await link(a, { comment: 'Not the same thing after all.' });
    expect(res.json()).toEqual({ ok: true, incident_id: null });
    expect((await item(a)).assessment).toMatchObject({ incident_id: null, linked: [] });
    expect((await logOf(a)).map((l) => l.new_status)).toEqual([
      `linked to ${b.publicRef}`,
      'unlinked',
    ]);
  });

  it('a summary across published reports, broken out, never one headline number', async () => {
    const before = (
      await mod.call({ method: 'GET', url: '/api/moderation/corroboration' })
    ).json<Summary>();
    const a = await file('Summary: the first account.');
    const b = await file('Summary: the second account.');
    const lone = await file('Summary: an account on its own.');
    await link(a, { link_to: b.publicRef, comment: 'Same incident.' });
    await rate(lone, { severity: 'serious', comment: 'Somebody was shut out.' });
    for (const t of [a, b, lone]) await approve(h.db, t.threadId);
    const after = (
      await mod.call({ method: 'GET', url: '/api/moderation/corroboration' })
    ).json<Summary>();
    expect(after.published - before.published).toBe(3);
    expect(after.corroborated_accounts - before.corroborated_accounts).toBe(2);
    expect(after.single_accounts - before.single_accounts).toBe(1);
    expect(after.incidents_with_several_accounts - before.incidents_with_several_accounts).toBe(1);
    expect((after.by_severity.serious ?? 0) - (before.by_severity.serious ?? 0)).toBe(1);
    expect((after.by_severity.none ?? 0) - (before.by_severity.none ?? 0)).toBe(2);
  });

  it('the board serves neither the severity nor the incident', async () => {
    const t = await file('A published, rated, linked report.');
    const twin = await file('Its published twin.');
    await rate(t, { severity: 'systemic', comment: 'Across several halls.' });
    await link(t, { link_to: twin.publicRef, comment: 'Same day.' });
    await approve(h.db, t.threadId);
    const page = await h.app.inject({ method: 'GET', url: `/api/board/reports/${t.publicRef}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('systemic');
    expect(page.body).not.toMatch(/incident|corroborat|severity/);
  });
});
