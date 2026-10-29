/**
 * Plan D, moderation and the EU items, through their routes: the rejection
 * email (M1), batch approval (M2), the agreement (M8), illegal-content notices
 * (D1), the threat flag (D5), the erase link (I5) and what the logs hold (I6).
 */
import { REJECTION_REASONS } from '@reportlog/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { openContact } from '../../src/filing/contactKeys.ts';
import { keyringFrom } from '../../src/filing/contactKeys.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { CONTACT_KEY, fileThroughRoutes, threadOf } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address } from './identity-helpers.ts';
import {
  moderationHarness,
  resetModerationSettings,
  seenMap,
  seenOf,
  staff,
} from './moderation-helpers.ts';
import { doorPass } from '../door-pass.ts';

type Caller = Awaited<ReturnType<typeof staff>>['call'];

let h: FilingHarness;
let lb: { id: number; slug: string };
let mod: { email: string; call: Caller };
let admin: { email: string; call: Caller };
let owner: { email: string; call: Caller };
const RING = keyringFrom(CONTACT_KEY);

async function file(what: string) {
  const email = address('reporter');
  const ref = await fileThroughRoutes(h, lb.slug, { what }, email);
  return { ref, thread: await threadOf(h.db, ref), email };
}
const post = (who: Caller, url: string, payload: Record<string, unknown> = {}) =>
  who({ method: 'POST', url, payload });
const decision = async (
  who: Caller,
  thread: string,
  status: string,
  extra: Record<string, unknown> = {},
) =>
  post(who, `/api/moderation/reports/${thread}/decision`, {
    status,
    comment: 'Checked it.',
    seen: await seenOf(h.db, thread),
    ...extra,
  });

// ITS OWN DATABASE. A published agreement is global and append-only: in the
// database every other file shares, it would shut every moderator route to
// all of them, and it could never be taken back.
let throwaway: Throwaway;

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'platform');
  await migrate(throwaway.url);
  h = await moderationHarness(createDatabase(throwaway.url, 10));
  await resetModerationSettings(h.db);
  lb = await launchedLogbook(h.db);
  mod = await staff(h, 'mod', 'moderator');
  admin = await staff(h, 'admin', 'admin');
  owner = await staff(h, 'owner', 'owner');
});
afterAll(async () => {
  await h.close();
  await throwaway.drop();
});

describe('M1 · a rejection emails the reporter a reason from the fixed list', () => {
  it('refuses a decline that names no reason, and changes nothing', async () => {
    const r = await file('To be declined without a reason.');
    const res = await decision(mod.call, r.thread, 'invalid');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('reason_required');
    expect(await decision(mod.call, r.thread, 'invalid', { reason_code: 'made up' })).toMatchObject(
      {
        statusCode: 400,
      },
    );
    const head = await h.db
      .selectFrom('report_heads')
      .select('moderation_status')
      .where('thread_id', '=', r.thread)
      .executeTakeFirstOrThrow();
    expect(head.moderation_status).toBe('pending');
  });

  it('sends the listed reason and the terms clause, never the moderator’s own words, and logs it as sent', async () => {
    const r = await file('A report that will be declined.');
    h.mailer.messages.length = 0;
    const res = await decision(mod.call, r.thread, 'invalid', { reason_code: 'outside_scope' });
    expect(res.json()).toEqual({ ok: true, notice: 'sent' });
    const mail = h.mailer.lastTo(r.email);
    const label = REJECTION_REASONS.find((x) => x.code === 'outside_scope')?.label ?? '';
    expect(mail?.text).toContain(label);
    expect(mail?.text).toContain('/terms');
    expect(mail?.text).toContain(r.ref);
    expect(mail?.text).not.toContain('Checked it.');
    const notice = await h.db
      .selectFrom('decision_notices')
      .selectAll()
      .where('thread_id', '=', r.thread)
      .execute();
    expect(notice.map((n) => [n.outcome, n.reason_code])).toEqual([['sent', 'outside_scope']]);
    // The server opened the address to send; no person read it, so the log of
    // people opening contact details is untouched.
    const reads = await h.db
      .selectFrom('contact_access_log')
      .select('id')
      .where('thread_id', '=', r.thread)
      .execute();
    expect(reads).toEqual([]);
    // Declining again does not email again.
    h.mailer.messages.length = 0;
    await decision(mod.call, r.thread, 'invalid', { reason_code: 'duplicate' });
    expect(h.mailer.messages).toHaveLength(0);
  });

  it('sends nothing for approve or unclear', async () => {
    const r = await file('Approved, then unclear.');
    h.mailer.messages.length = 0;
    expect((await decision(mod.call, r.thread, 'valid')).json()).toEqual({
      ok: true,
      notice: 'none',
    });
    expect((await decision(mod.call, r.thread, 'unknown')).json()).toEqual({
      ok: true,
      notice: 'none',
    });
    expect(h.mailer.messages).toHaveLength(0);
  });

  it('a report whose email key was destroyed gets no email, and that is recorded', async () => {
    const r = await file('Erased before it was declined.');
    const { eraseReporterContact } = await import('../../src/filing/mine.ts');
    await eraseReporterContact(h.db, r.thread);
    h.mailer.messages.length = 0;
    const res = await decision(mod.call, r.thread, 'invalid', { reason_code: 'duplicate' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, notice: 'no_key' });
    expect(h.mailer.messages).toHaveLength(0);
    const n = await h.db
      .selectFrom('decision_notices')
      .select('outcome')
      .where('thread_id', '=', r.thread)
      .execute();
    expect(n).toEqual([{ outcome: 'no_key' }]);
  });

  it('removing a link or a tip sends nothing: no code path in moderation/ or lists/ mails the reason', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/moderation/rejection.ts', import.meta.url), 'utf8');
    expect(src).toContain('ONLY A REJECTED REPORT SENDS ANYTHING');
  });
});

describe('M2 · batch approval, one record per report', () => {
  it('approves each, writes one log row each, and skips what cannot be approved', async () => {
    const a = await file('Batch one.');
    const b = await file('Batch two.');
    const w = await file('Batch withdrawn.');
    await h.db
      .updateTable('report_heads')
      .set({ withdrawn: true })
      .where('thread_id', '=', w.thread)
      .execute();
    const res = await post(mod.call, '/api/moderation/reports/batch-approve', {
      thread_ids: [a.thread, b.thread, w.thread],
      seen: await seenMap(h.db, [a.thread, b.thread, w.thread]),
    });
    const body = res.json<{ approved: string[]; skipped: { thread_id: string }[] }>();
    expect(body.approved.sort()).toEqual([a.thread, b.thread].sort());
    expect(body.skipped.map((x) => x.thread_id)).toEqual([w.thread]);
    for (const t of [a.thread, b.thread]) {
      const rows = await h.db
        .selectFrom('moderation_log')
        .select(['action', 'new_status', 'actor_email'])
        .where('thread_id', '=', t)
        .execute();
      expect(rows).toEqual([{ action: 'review', new_status: 'valid', actor_email: mod.email }]);
    }
    const wlog = await h.db
      .selectFrom('moderation_log')
      .select('id')
      .where('thread_id', '=', w.thread)
      .execute();
    expect(wlog).toHaveLength(0);
  });

  it('is for moderators and administrators, and an empty or oversized list is refused', async () => {
    const user = await staff(h, 'plain', 'user');
    expect(
      (
        await post(user.call, '/api/moderation/reports/batch-approve', {
          thread_ids: ['00000000-0000-4000-8000-000000000000'],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post(mod.call, '/api/moderation/reports/batch-approve', { thread_ids: [] }))
        .statusCode,
    ).toBe(400);
  });
});

describe('M8 · the agreement, accepted before acting, on every moderator scope', () => {
  const queue = { method: 'GET', url: '/api/moderation/reports' } as const;
  const scopes = [
    queue,
    { method: 'GET', url: '/api/moderate/files' },
    { method: 'GET', url: '/api/list-review' },
    { method: 'GET', url: '/api/moderate/evidence/00000000-0000-4000-8000-000000000000' },
  ] as const;

  it('asks nothing while no agreement is published', async () => {
    expect((await mod.call(queue)).statusCode).toBe(200);
  });

  it('only an administrator publishes one; then every moderator scope asks for it', async () => {
    expect(
      (
        await post(mod.call, '/api/admin/agreement/moderator', {
          body: 'I will not read contact details without need.',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post(admin.call, '/api/admin/agreement/moderator', { body: '   ' })).statusCode,
    ).toBe(400);
    const pub = await post(admin.call, '/api/admin/agreement/moderator', {
      body: 'I will not read contact details without need.',
    });
    expect(pub.json()).toEqual({ version: 1 });
    for (const s of scopes) {
      const res = await mod.call(s);
      expect(res.statusCode, s.url).toBe(403);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('agreement_required');
    }
    // The administrator working through a moderator scope accepts too.
    expect((await admin.call(queue)).statusCode).toBe(403);
  });

  it('accepting names the words read; a changed text must be read again', async () => {
    const state = (await mod.call({ method: 'GET', url: '/api/agreement/moderator' })).json<{
      current: { digest: string; version: number };
      accepted: boolean;
    }>();
    expect(state.accepted).toBe(false);
    expect(
      (await post(mod.call, '/api/agreement/moderator/accept', { digest: 'f'.repeat(64) }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post(mod.call, '/api/agreement/moderator/accept', { digest: state.current.digest }))
        .statusCode,
    ).toBe(200);
    expect((await mod.call(queue)).statusCode).toBe(200);
    // Version 2: everyone accepts again.
    await post(admin.call, '/api/admin/agreement/moderator', { body: 'The second wording.' });
    expect((await mod.call(queue)).statusCode).toBe(403);
    const next = (await mod.call({ method: 'GET', url: '/api/agreement/moderator' })).json<{
      current: { digest: string; version: number };
    }>();
    expect(next.current.version).toBe(2);
    await post(mod.call, '/api/agreement/moderator/accept', { digest: next.current.digest });
    expect((await mod.call(queue)).statusCode).toBe(200);
    const list = (
      await admin.call({ method: 'GET', url: '/api/admin/agreement/moderator/acceptances' })
    ).json<{ acceptances: { user_email: string; version: number }[] }>();
    expect(
      list.acceptances
        .filter((a) => a.user_email === mod.email)
        .map((a) => a.version)
        .sort(),
    ).toEqual([1, 2]);
  });

  it('the texts and acceptances cannot be rewritten', async () => {
    await expect(h.db.updateTable('agreement_texts').set({ body: 'x' }).execute()).rejects.toThrow(
      /append-only/,
    );
    await expect(h.db.deleteFrom('agreement_acceptances').execute()).rejects.toThrow(/append-only/);
  });
});

describe('D1 · reporting illegal content', () => {
  const form = {
    where_found: '/board/RL-1',
    explanation: 'It shows a private address.',
    good_faith: true,
  };
  it('needs the statement and an explanation; an address is optional', async () => {
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/illegal-content',
      payload: { ...form, good_faith: false },
    });
    expect(bad.statusCode).toBe(400);
    const none = await h.app.inject({ method: 'POST', url: '/api/illegal-content', payload: form });
    expect(none.statusCode).toBe(200);
    expect(none.json<{ emailed: boolean }>().emailed).toBe(false);
  });

  it('gives a receipt by email, shows status by link, and emails the decision with its reason, then forgets the address and the name', async () => {
    const email = address('sender');
    h.mailer.messages.length = 0;
    const sent = await h.app.inject({
      method: 'POST',
      url: '/api/illegal-content',
      payload: { ...form, email, name: 'Ada Sender' },
    });
    const { receipt } = sent.json<{ receipt: string }>();
    expect(receipt).toMatch(/^IC-[A-Z2-9]{8}$/);
    const first = h.mailer.lastTo(email);
    expect(first?.text).toContain(receipt);
    const token = /illegal-content\/status\/([0-9a-f]{64})/.exec(first?.text ?? '')?.[1] ?? '';
    const open = await h.app.inject({ method: 'GET', url: `/api/illegal-content/status/${token}` });
    expect(open.json()).toMatchObject({ receipt, status: 'open', decision: null });

    const list = (await mod.call({ method: 'GET', url: '/api/moderation/illegal-content' })).json<{
      notices: { id: number; receipt: string; has_email: boolean }[];
    }>();
    const row = list.notices.find((n) => n.receipt === receipt);
    expect(row?.has_email).toBe(true);
    expect(JSON.stringify(row)).toContain('Ada Sender');
    expect(JSON.stringify(list)).not.toContain(email);
    const id = row?.id ?? 0;

    expect(
      (
        await post(mod.call, `/api/moderation/illegal-content/${String(id)}/decision`, {
          decision: 'removed',
          reason: 'short',
        })
      ).statusCode,
    ).toBe(400);
    const done = await post(mod.call, `/api/moderation/illegal-content/${String(id)}/decision`, {
      decision: 'removed',
      reason: 'The report named a private person; we removed it.',
    });
    expect(done.json()).toEqual({ ok: true, emailed: true });
    const decided = h.mailer.lastTo(email);
    expect(decided?.text).toContain('We removed the content.');
    expect(decided?.text).toContain('we removed it');
    const link = /illegal-content\/status\/([0-9a-f]{64})/.exec(decided?.text ?? '')?.[1] ?? '';
    for (const t of [token, link]) {
      const res = await h.app.inject({ method: 'GET', url: `/api/illegal-content/status/${t}` });
      expect(res.json()).toMatchObject({ status: 'decided', decision: 'removed' });
    }
    const stored = await h.db
      .selectFrom('content_notices')
      .select(['sender_email', 'sender_name'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored.sender_email).toBeNull();
    expect(stored.sender_name).toBeNull();
    expect(
      (
        await post(mod.call, `/api/moderation/illegal-content/${String(id)}/decision`, {
          decision: 'no_action',
          reason: 'Changing my mind.',
        })
      ).statusCode,
    ).toBe(409);
    const events = await h.db
      .selectFrom('content_notice_events')
      .select('action')
      .where('notice_id', '=', id)
      .orderBy('id')
      .execute();
    expect(events.map((e) => e.action)).toEqual([
      'received',
      'receipt_sent',
      'decided',
      'decision_sent',
    ]);
  });

  it('an unknown status link is a plain 404', async () => {
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/illegal-content/status/${'a'.repeat(64)}` }))
        .statusCode,
    ).toBe(404);
  });
});

describe('D5 · a threat to life or safety wakes the owner', () => {
  it('flags a report: the owner is emailed at once, the queue shows it, a clearing is its own row', async () => {
    const r = await file('Somebody said they would hurt a witness.');
    h.mailer.messages.length = 0;
    const noNote = await post(mod.call, '/api/moderation/threats', {
      subject_kind: 'report',
      subject_ref: r.thread,
      note: 'x',
    });
    expect(noNote.statusCode).toBe(400);
    const res = await post(mod.call, '/api/moderation/threats', {
      subject_kind: 'report',
      subject_ref: r.thread,
      note: 'A named witness is threatened.',
    });
    expect(res.json()).toEqual({ ok: true, owner_emailed: true });
    const mail = h.mailer.lastTo(owner.email);
    expect(mail?.subject).toMatch(/threat to life or safety/);
    expect(mail?.text).toContain(r.thread);
    expect(mail?.text).not.toContain('witness');
    const q = (await mod.call({ method: 'GET', url: '/api/moderation/reports?status=all' })).json<{
      reports: { thread_id: string; threat_open: boolean }[];
    }>();
    expect(q.reports.find((x) => x.thread_id === r.thread)?.threat_open).toBe(true);
    const open = (await mod.call({ method: 'GET', url: '/api/moderation/threats' })).json<{
      threats: { subject_ref: string }[];
    }>();
    expect(open.threats.map((t) => t.subject_ref)).toContain(r.thread);
    await post(mod.call, '/api/moderation/threats/clear', {
      subject_kind: 'report',
      subject_ref: r.thread,
      note: 'Police informed; no longer open.',
    });
    const after = (await mod.call({ method: 'GET', url: '/api/moderation/threats' })).json<{
      threats: { subject_ref: string }[];
    }>();
    expect(after.threats.map((t) => t.subject_ref)).not.toContain(r.thread);
    const events = await h.db
      .selectFrom('threat_events')
      .select('action')
      .where('subject_ref', '=', r.thread)
      .orderBy('id')
      .execute();
    expect(events.map((e) => e.action)).toEqual(['raise', 'owner_emailed', 'clear']);
  });

  it('flags a tip by its entry id, and refuses one that does not exist', async () => {
    const missing = await post(mod.call, '/api/moderation/threats', {
      subject_kind: 'tip',
      subject_ref: '999999999',
      note: 'Does not exist at all.',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('the severity rating is not the flag: setting one emails nobody', async () => {
    const r = await file('Rated serious.');
    h.mailer.messages.length = 0;
    await post(mod.call, `/api/moderation/reports/${r.thread}/severity`, {
      severity: 'serious',
      comment: 'Looks serious enough.',
    });
    expect(h.mailer.lastTo(owner.email)).toBeUndefined();
  });
});

describe('I5 · the erase link in the confirmation email', () => {
  it('the email carries it; looking changes nothing; the button erases and does not withdraw', async () => {
    const email = address('eraser');
    h.mailer.messages.length = 0;
    const ref = await fileThroughRoutes(
      h,
      lb.slug,
      { what: 'Erase my address, keep my report.' },
      email,
    );
    const thread = await threadOf(h.db, ref);
    const text = h.mailer.messages.find((m) => m.to === email)?.text ?? '';
    const token = /\/file\/erase\/([0-9a-f]{64})/.exec(text)?.[1] ?? '';
    expect(token).toHaveLength(64);

    const look = await h.app.inject({ method: 'GET', url: `/api/erase/${token}` });
    expect(look.json()).toMatchObject({ state: 'filed', public_ref: ref });
    expect((await openContact(h.db, RING, thread))?.erased).toBe(false);

    expect(
      (await h.app.inject({ method: 'POST', url: `/api/erase/${token}`, payload: {} })).statusCode,
    ).toBe(400);
    expect((await openContact(h.db, RING, thread))?.erased).toBe(false);

    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/erase/${token}`,
          payload: { confirm: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(await openContact(h.db, RING, thread)).toMatchObject({ erased: true, email: null });
    const head = await h.db
      .selectFrom('report_heads')
      .select('withdrawn')
      .where('thread_id', '=', thread)
      .executeTakeFirstOrThrow();
    expect(head.withdrawn).toBe(false);
    expect((await h.app.inject({ method: 'GET', url: `/api/erase/${token}` })).statusCode).toBe(
      404,
    );
  });

  it('before the report is filed there is nothing to erase', async () => {
    const email = address('early');
    await h.app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        ...(await doorPass(h.app)),
        logbook: lb.slug,
        email,
        consent: true,
        answers: { what: 'Not confirmed yet.' },
        may_publish: false,
        may_publish_digest: (await import('./filing-helpers.ts')).GENERAL,
      },
    });
    const text = h.mailer.lastTo(email)?.text ?? '';
    const token = /\/file\/erase\/([0-9a-f]{64})/.exec(text)?.[1] ?? '';
    expect(token).toHaveLength(64);
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/erase/${token}` })).json(),
    ).toMatchObject({ state: 'not_yet_filed' });
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/erase/${token}`,
          payload: { confirm: true },
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('I6 · no email address in the logs', () => {
  it('nothing logged by any of the above holds an address, a token or a full URL', () => {
    const logged = h.logs.join('\n');
    expect(logged).not.toMatch(/@example\.org/);
    expect(logged).not.toMatch(/[0-9a-f]{64}/);
    expect(logged).not.toMatch(/https?:\/\//);
  });
});
