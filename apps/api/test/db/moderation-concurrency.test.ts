/**
 * Two moderators on one report.
 *
 * What it holds:
 *   - NOBODY OVERWRITES A DECISION THEY NEVER SAW. Every act on a report
 *     sends the `seen` its page was given, and is refused (409, `changed`,
 *     a sentence saying who did what) if the report moved since: another
 *     decision, a take-off, a correction, its reporter's withdrawal. A
 *     refused act records nothing and emails nobody.
 *   - The check holds when both press at once: exactly one wins.
 *   - Batch approval and bulk decline skip a report that changed since it
 *     was selected, and act on the rest.
 *   - A note revision is refused the same way, and leaves nothing behind.
 *   - Who has a report open is presence, not a record: others see you, you
 *     never see yourself, closing the page takes you off, and a heartbeat
 *     that stopped stops counting.
 */
import { VIEWING_WINDOW_MS } from '@reportlog/contracts';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FilingHarness } from './filing-helpers.ts';
import { fileThroughRoutes, threadOf } from './filing-helpers.ts';
import { QUESTIONS, launchedLogbook } from './helpers.ts';
import { address, as, signIn } from './identity-helpers.ts';
import {
  correctThread,
  fileThread,
  moderationHarness,
  resetModerationSettings,
  seenMap,
  seenOf,
  staff,
} from './moderation-helpers.ts';
import type { Thread } from './moderation-helpers.ts';

type Caller = Awaited<ReturnType<typeof staff>>['call'];
interface Refusal {
  error: { code: string; message: string };
}

let h: FilingHarness;
let lb: { id: number; slug: string };
let ana: { email: string; call: Caller };
let ben: { email: string; call: Caller };
let admin: { email: string; call: Caller };

const file = (what: string): Promise<Thread> => fileThread(h.db, lb, QUESTIONS, { what });

const post = (who: Caller, url: string, payload: Record<string, unknown>) =>
  who({ method: 'POST', url, payload });

const decide = (who: Caller, t: string, status: string, seen: unknown) =>
  post(who, `/api/moderation/reports/${t}/decision`, {
    status,
    comment: 'Read it.',
    ...(status === 'invalid' ? { reason_code: 'duplicate' } : {}),
    ...(seen === undefined ? {} : { seen }),
  });

/** The queue item as a page gets it. */
const item = async (who: Caller, t: string) =>
  (await who({ method: 'GET', url: `/api/moderation/reports/${t}` })).json<{
    report: { seen: string; moderation_status: string; withdrawn: boolean };
  }>().report;

const reviews = (t: string) =>
  h.db
    .selectFrom('moderation_log')
    .select(['action', 'new_status', 'actor_email'])
    .where('thread_id', '=', t)
    .where('action', 'in', ['review', 'withdraw', 'restore'])
    .orderBy('id')
    .execute();

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  lb = await launchedLogbook(h.db, QUESTIONS);
  ana = await staff(h, 'conc-ana', 'moderator');
  ben = await staff(h, 'conc-ben', 'moderator');
  admin = await staff(h, 'conc-admin', 'admin');
});
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

describe('a decision on a report that moved since the page read it', () => {
  it('is refused, says who did what, and records nothing', async () => {
    const t = await file('Two moderators open this one.');
    const anaSaw = (await item(ana.call, t.threadId)).seen;
    const benSaw = (await item(ben.call, t.threadId)).seen;
    expect(benSaw).toBe(anaSaw);

    expect((await decide(ana.call, t.threadId, 'valid', anaSaw)).statusCode).toBe(200);
    const late = await decide(ben.call, t.threadId, 'invalid', benSaw);
    expect(late.statusCode).toBe(409);
    const { error } = late.json<Refusal>();
    expect(error.code).toBe('changed');
    expect(error.message).toBe(
      `${ana.email} approved it after you opened it. Nothing you sent was recorded. Look at it again before you decide.`,
    );

    // Ana's approval stands, alone on the record, and nobody was emailed a decline.
    expect((await item(ben.call, t.threadId)).moderation_status).toBe('valid');
    expect(await reviews(t.threadId)).toEqual([
      { action: 'review', new_status: 'valid', actor_email: ana.email },
    ]);
    const notices = await h.db
      .selectFrom('decision_notices')
      .select('id')
      .where('thread_id', '=', t.threadId)
      .execute();
    expect(notices).toHaveLength(0);

    // Having looked again, Ben may decide it.
    const fresh = (await item(ben.call, t.threadId)).seen;
    expect(fresh).not.toBe(benSaw);
    expect((await decide(ben.call, t.threadId, 'unknown', fresh)).statusCode).toBe(200);
  });

  it('is refused without a `seen` at all, rather than taken as current', async () => {
    const t = await file('A decision from a page that says nothing about what it showed.');
    for (const seen of [undefined, '', 'latest']) {
      const res = await decide(ana.call, t.threadId, 'valid', seen);
      expect(res.statusCode, String(seen)).toBe(400);
      expect(res.json<Refusal>().error.code).toBe('seen_required');
    }
    // Not even text: the contract refuses it before the route reads it.
    expect((await decide(ana.call, t.threadId, 'valid', 7)).statusCode).toBe(400);
    expect(await reviews(t.threadId)).toEqual([]);
  });

  it('holds when both press at once: one wins, the other is told', async () => {
    const t = await file('Both press Record the decision in the same instant.');
    const seen = await seenOf(h.db, t.threadId);
    const results = await Promise.all([
      decide(ana.call, t.threadId, 'valid', seen),
      decide(ben.call, t.threadId, 'invalid', seen),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await reviews(t.threadId)).toHaveLength(1);
  });

  it('a correction since is named as a new version', async () => {
    const t = await file('The words before a correction.');
    const seen = await seenOf(h.db, t.threadId);
    await correctThread(h.db, lb, QUESTIONS, t, { what: 'The words after a correction.' });
    const res = await decide(ana.call, t.threadId, 'valid', seen);
    expect(res.statusCode).toBe(409);
    expect(res.json<Refusal>().error.message).toMatch(
      /^A new version of it arrived after you opened it\./,
    );
  });

  it("its reporter's withdrawal since is named as theirs", async () => {
    const email = address('conc-reporter');
    const ref = await fileThroughRoutes(h, lb.slug, { what: 'Withdrawn while open.' }, email);
    const thread = await threadOf(h.db, ref);
    const seen = await seenOf(h.db, thread);
    const reporter = as(h, await signIn(h, email));
    const off = await post(reporter, `/api/mine/reports/${thread}/withdraw`, {
      comment: 'I changed my mind.',
    });
    expect(off.statusCode, off.body).toBe(200);
    const res = await decide(ana.call, thread, 'valid', seen);
    expect(res.statusCode).toBe(409);
    expect(res.json<Refusal>().error.message).toMatch(
      /^Its reporter withdrew it after you opened it\./,
    );
  });

  it('taking off and putting back are checked the same way', async () => {
    const t = await file('Taken off by one moderator while another had it open.');
    const seen = await seenOf(h.db, t.threadId);
    const url = `/api/moderation/reports/${t.threadId}`;
    expect(
      (await post(ana.call, `${url}/withdraw`, { comment: 'Names someone.', seen })).statusCode,
    ).toBe(200);
    const late = await post(ben.call, `${url}/withdraw`, { comment: 'Names someone.', seen });
    expect(late.statusCode).toBe(409);
    expect(late.json<Refusal>().error.message).toMatch(
      new RegExp(`^${ana.email} took it off the board after you opened it\\.`),
    );
    const back = await post(ben.call, `${url}/restore`, {
      status: 'pending',
      comment: 'Redacted.',
      seen,
    });
    expect(back.statusCode).toBe(409);
    expect(
      (
        await post(ben.call, `${url}/restore`, {
          status: 'pending',
          comment: 'Redacted.',
          seen: await seenOf(h.db, t.threadId),
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('acting on several at once', () => {
  it('batch approval skips one that changed since it was selected', async () => {
    const a = await file('Batch: untouched.');
    const b = await file('Batch: declined by somebody else meanwhile.');
    const seen = await seenMap(h.db, [a.threadId, b.threadId]);
    expect((await decide(ben.call, b.threadId, 'invalid', seen[b.threadId])).statusCode).toBe(200);
    const res = await post(ana.call, '/api/moderation/reports/batch-approve', {
      thread_ids: [a.threadId, b.threadId],
      seen,
    });
    expect(res.json()).toEqual({
      approved: [a.threadId],
      skipped: [{ thread_id: b.threadId, why: 'It changed after you selected it.' }],
    });
    // Ben's decline stands.
    expect((await item(ana.call, b.threadId)).moderation_status).toBe('invalid');

    const none = await post(ana.call, '/api/moderation/reports/batch-approve', {
      thread_ids: [a.threadId],
    });
    expect(none.statusCode).toBe(400);
    expect(none.json<Refusal>().error.code).toBe('seen_required');
  });

  it('bulk decline skips one that changed since it was selected', async () => {
    const a = await file('Bulk: untouched.');
    const b = await file('Bulk: approved by somebody else meanwhile.');
    const seen = await seenMap(h.db, [a.threadId, b.threadId]);
    expect((await decide(ben.call, b.threadId, 'valid', seen[b.threadId])).statusCode).toBe(200);
    const res = await post(ana.call, '/api/moderation/reports/bulk-decline', {
      thread_ids: [a.threadId, b.threadId],
      seen,
      reason_code: 'abusive_or_spam',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      declined: [a.threadId],
      skipped: [{ thread_id: b.threadId, why: 'It changed after you selected it.' }],
    });
    expect((await item(ana.call, b.threadId)).moderation_status).toBe('valid');
  });
});

describe('a note revised by two at once', () => {
  it('refuses a version written over one its writer never saw, and leaves nothing behind', async () => {
    await admin.call({
      method: 'PUT',
      url: `/api/admin/moderation/logbooks/${lb.slug}/notes`,
      payload: { enabled: true },
    });
    const t = await file('An account two moderators annotate.');
    const url = `/api/moderation/reports/${t.threadId}/note`;
    const body = 'The county office confirmed the hall closed early.';

    // Both write the first version at once: one is published.
    const [fromAna, fromBen] = await Promise.all([
      post(ana.call, url, { body, based_on: 0 }),
      post(ben.call, url, { body: `${body} (Ben)`, based_on: 0 }),
    ]);
    const first = [fromAna, fromBen];
    expect(first.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = fromAna.statusCode === 200 ? ana.email : ben.email;
    const lost = first.find((r) => r.statusCode === 409);
    expect(lost?.json<Refusal>().error.message).toBe(
      `${winner} wrote a new version of the note after you opened it. Nothing you wrote was published. Look at it again before you revise it.`,
    );

    // A revision from a page showing version 0 is refused; from version 1 it goes.
    const stale = await post(ana.call, url, {
      body: `${body} Revised.`,
      revision_reason: 'Detail.',
      based_on: 0,
    });
    expect(stale.statusCode).toBe(409);
    const ok = await post(ana.call, url, {
      body: `${body} Revised.`,
      revision_reason: 'Detail.',
      based_on: 1,
    });
    expect(ok.json()).toEqual({ ok: true, versions: 2 });

    const missing = await post(ana.call, url, { body, revision_reason: 'Again.' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<Refusal>().error.code).toBe('seen_required');
  });

  it('a refused first version leaves no empty note', async () => {
    const t = await file('An account whose only note is refused.');
    const res = await post(ana.call, `/api/moderation/reports/${t.threadId}/note`, {
      body: 'A note from a page that claims to have seen one.',
      based_on: 3,
    });
    expect(res.statusCode).toBe(409);
    const rows = await h.db
      .selectFrom('editorial_notes')
      .select('id')
      .where('thread_id', '=', t.threadId)
      .execute();
    expect(rows).toHaveLength(0);
  });
});

describe('who has a report open', () => {
  const viewing = (who: Caller, t: string) =>
    who({ method: 'POST', url: `/api/moderation/reports/${t}/viewing` });
  const others = async (who: Caller, t: string) =>
    (await viewing(who, t)).json<{ others: { email: string }[]; seen: string }>();
  const queueWide = async (who: Caller) =>
    (await who({ method: 'GET', url: '/api/moderation/viewing' })).json<{
      viewing: { thread_id: string; email: string }[];
    }>().viewing;

  it('shows each moderator the others, never themselves, until they close it', async () => {
    const t = await file('A report two moderators open.');
    expect((await others(ana.call, t.threadId)).others).toEqual([]);
    expect((await others(ben.call, t.threadId)).others).toEqual([{ email: ana.email }]);
    expect((await others(ana.call, t.threadId)).others).toEqual([{ email: ben.email }]);
    expect(await queueWide(ana.call)).toContainEqual({ thread_id: t.threadId, email: ben.email });
    expect((await queueWide(ana.call)).some((v) => v.email === ana.email)).toBe(false);

    const closed = await ben.call({
      method: 'DELETE',
      url: `/api/moderation/reports/${t.threadId}/viewing`,
    });
    expect(closed.statusCode).toBe(200);
    expect((await others(ana.call, t.threadId)).others).toEqual([]);
  });

  it("answers with the report's `seen` now, so an open page can tell it moved", async () => {
    const t = await file('A report decided while another moderator reads it.');
    const before = (await others(ana.call, t.threadId)).seen;
    expect(before).toBe((await item(ana.call, t.threadId)).seen);
    await decide(ben.call, t.threadId, 'valid', before);
    expect((await others(ana.call, t.threadId)).seen).not.toBe(before);
  });

  it('stops counting a heartbeat that stopped, and sweeps it', async () => {
    const t = await file('A report left open on a laptop that was closed.');
    await viewing(ben.call, t.threadId);
    await h.db
      .updateTable('report_viewers')
      .set({
        seen_at: sql<Date>`now() - ${`${String(VIEWING_WINDOW_MS + 1000)} milliseconds`}::interval`,
      })
      .where('thread_id', '=', t.threadId)
      .execute();
    expect((await others(ana.call, t.threadId)).others).toEqual([]);
    await h.db
      .updateTable('report_viewers')
      .set({ seen_at: sql<Date>`now() - interval '1 hour'` })
      .where('thread_id', '=', t.threadId)
      .execute();
    await viewing(ana.call, t.threadId);
    const left = await h.db
      .selectFrom('report_viewers')
      .select('user_id')
      .where('thread_id', '=', t.threadId)
      .execute();
    expect(left).toHaveLength(1);
  });

  it('is for moderators, and only for a report that exists', async () => {
    const t = await file('A report somebody without a role tries to open.');
    const user = await staff(h, 'conc-user', 'user');
    expect((await viewing(user.call, t.threadId)).statusCode).toBe(403);
    expect((await user.call({ method: 'GET', url: '/api/moderation/viewing' })).statusCode).toBe(
      403,
    );
    expect((await viewing(ana.call, '00000000-0000-4000-8000-00000000abcd')).statusCode).toBe(404);
  });
});
