/**
 * The feedback tracker and the tester flag, against a real database.
 *
 * Legacy had no self-test for feedback (selftest.js has no feedback group);
 * these check what legacy/src/routes/feedback.js, feedbackTaxonomy.js,
 * feedbackTemplates.js, scripts/feedback-digest.js and setTesterFlag in
 * roles.js promised, in their own words where they gave reasons.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capturingMailer } from '../../src/email/mailer.ts';
import { runFeedbackDigest } from '../../src/feedback/digest.ts';
import { maskedHandle, sanitizeContext } from '../../src/feedback/feedback.ts';
import { address, as, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const ADMIN_EMAIL = address('office');
const testerEmail = address('tester');
const otherTesterEmail = address('tester2');
const adminEmail = address('fb-admin');
const amEmail = address('fb-am');
const modEmail = address('fb-mod');
const plainEmail = address('fb-plain');
const s: Record<string, string> = {};

const issue = {
  type: 'bug',
  severity: 'major',
  title: 'The save button does nothing',
  body: 'I pressed save on the look page and nothing happened at all.',
  context: { page: '/(staff)/settings/look', viewport: '390x844', browser: 'Firefox' },
};

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.ts');
  h = await harness();
  // The same harness, with an administrator's address to announce new issues to.
  await h.app.close();
  h.app = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: 'https://reports.example.test', ADMIN_EMAIL },
    db: h.db,
    mailer: h.mailer,
  });
  await seat(h.db, adminEmail, 'admin');
  await seat(h.db, amEmail, 'access_manager');
  await seat(h.db, modEmail, 'moderator');
  for (const e of [testerEmail, otherTesterEmail, plainEmail]) await seat(h.db, e, 'user');
  for (const [k, e] of Object.entries({
    tester: testerEmail,
    other: otherTesterEmail,
    admin: adminEmail,
    am: amEmail,
    mod: modEmail,
    plain: plainEmail,
  })) {
    s[k] = await signIn(h, e);
  }
});
afterAll(async () => {
  await h.close();
});

const call = (who: string) => as(h, s[who]);

describe('the tester flag', () => {
  it('is given by an Access Manager, written to the audit, and shows on "me"', async () => {
    const res = await call('am')({
      method: 'POST',
      url: '/api/admin/testers',
      payload: { email: testerEmail, tester: true },
    });
    expect(res.json()).toEqual({ ok: true, unchanged: false });
    const audit = await h.db
      .selectFrom('role_audit')
      .selectAll()
      .where('subject_email', '=', testerEmail)
      .execute();
    expect(audit).toMatchObject([
      { axis: 'flag', action: 'grant', detail: 'tester', actor_email: amEmail },
    ]);
    const me = await call('tester')({ method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({ signedIn: true, tester: true, role: 'user' });
  });

  it('and by an administrator; giving it twice changes nothing and writes nothing', async () => {
    await call('admin')({
      method: 'POST',
      url: '/api/admin/testers',
      payload: { email: otherTesterEmail, tester: true },
    });
    const again = await call('admin')({
      method: 'POST',
      url: '/api/admin/testers',
      payload: { email: otherTesterEmail, tester: true },
    });
    expect(again.json()).toEqual({ ok: true, unchanged: true });
    const rows = await h.db
      .selectFrom('role_audit')
      .select('id')
      .where('subject_email', '=', otherTesterEmail)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('is not a role: a tester keeps their role, and the flag grants no role', async () => {
    const row = await h.db
      .selectFrom('users')
      .select(['role', 'is_tester'])
      .where('email', '=', testerEmail)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ role: 'user', is_tester: true });
  });

  it('cannot be given by a moderator, a tester, or anybody with no role', async () => {
    for (const who of ['mod', 'tester', 'plain']) {
      const res = await call(who)({
        method: 'POST',
        url: '/api/admin/testers',
        payload: { email: plainEmail, tester: true },
      });
      expect(res.statusCode, who).toBe(403);
    }
  });

  it('lists the testers for the people who give it', async () => {
    const res = await call('am')({ method: 'GET', url: '/api/admin/testers' });
    const emails = res.json<{ testers: { email: string }[] }>().testers.map((t) => t.email);
    expect(emails).toEqual(expect.arrayContaining([testerEmail, otherTesterEmail]));
  });
});

describe('who may open the tracker', () => {
  it('testers, administrators and Access Managers; not a moderator or somebody with no role', async () => {
    for (const who of ['tester', 'admin', 'am']) {
      expect((await call(who)({ method: 'GET', url: '/api/feedback' })).statusCode, who).toBe(200);
    }
    for (const who of ['mod', 'plain']) {
      const res = await call(who)({ method: 'GET', url: '/api/feedback' });
      expect(res.statusCode, who).toBe(403);
      expect(res.json<{ error: { message: string } }>().error.message).toMatch(/testers/);
    }
    expect((await h.app.inject({ method: 'GET', url: '/api/feedback' })).statusCode).toBe(401);
  });

  it('a tester cannot reach the administrator’s queue', async () => {
    expect((await call('tester')({ method: 'GET', url: '/api/admin/feedback' })).statusCode).toBe(
      403,
    );
    expect((await call('am')({ method: 'GET', url: '/api/admin/feedback' })).statusCode).toBe(403);
  });
});

let issueId = 0;

describe('filing', () => {
  it('refuses with every problem at once, in sentences', async () => {
    const res = await call('tester')({
      method: 'POST',
      url: '/api/feedback',
      payload: { type: 'rant', severity: 'p1', title: 'x', body: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const message = res.json<{ error: { message: string } }>().error.message;
    expect(message).toMatch(/what kind/);
    expect(message).toMatch(/how much/);
    expect(message).toMatch(/title/);
    expect(message).toMatch(/more detail/);
  });

  it('files, records the creation, and tells the administrator’s address', async () => {
    const res = await call('tester')({ method: 'POST', url: '/api/feedback', payload: issue });
    expect(res.statusCode).toBe(200);
    issueId = res.json<{ id: number }>().id;
    const events = await h.db
      .selectFrom('feedback_events')
      .selectAll()
      .where('feedback_id', '=', issueId)
      .execute();
    expect(events).toMatchObject([{ action: 'created', new_status: null, note: null }]);
    // Sent after the answer, without waiting: give it a moment.
    await new Promise((r) => setTimeout(r, 20));
    const mail = h.mailer.lastTo(ADMIN_EMAIL);
    expect(mail?.subject).toBe(`Feedback #${String(issueId)} (major): ${issue.title}`);
    expect(mail?.text).toContain(issue.body);
    expect(mail?.text).toContain('Screen: /(staff)/settings/look');
    expect(mail?.text).toContain('https://reports.example.test/settings/feedback');
  });

  it('keeps only what the form captures, shortened', () => {
    expect(sanitizeContext({ page: ' /x ', viewport: '', browser: 'b'.repeat(500) })).toEqual({
      page: '/x',
      browser: 'b'.repeat(400),
    });
  });
});

describe('what testers see of each other', () => {
  it('every tester’s issues, with a masked handle and never an address', async () => {
    const res = await call('other')({ method: 'GET', url: '/api/feedback' });
    const mine = res
      .json<{ issues: { id: number; author: string; mine: boolean }[] }>()
      .issues.find((i) => i.id === issueId);
    expect(mine).toMatchObject({ mine: false, author: maskedHandle(testerEmail) });
    expect(res.body).not.toContain(testerEmail);
  });

  it('the handle keeps the start of the address and the first part of the domain', () => {
    expect(maskedHandle('alexandra@example.org')).toBe('ale******@example');
    expect(maskedHandle('al@x.org')).toBe('al**@x');
  });

  it('comments are added in order, never edited, and counted', async () => {
    const res = await call('other')({
      method: 'POST',
      url: `/api/feedback/${String(issueId)}/comments`,
      payload: { body: 'Seeing this too, on Firefox.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      comment_count: 1,
      comments: [{ body: 'Seeing this too, on Firefox.', mine: true }],
    });
    const empty = await call('other')({
      method: 'POST',
      url: `/api/feedback/${String(issueId)}/comments`,
      payload: { body: '   ' },
    });
    expect(empty.statusCode).toBe(400);
    await expect(
      h.db
        .updateTable('feedback_comments')
        .set({ body: 'changed' })
        .where('feedback_id', '=', issueId)
        .execute(),
    ).rejects.toThrow();
  });
});

describe('moving an issue', () => {
  it('needs a note, because the tester is sent it', async () => {
    const res = await call('admin')({
      method: 'POST',
      url: `/api/admin/feedback/${String(issueId)}/status`,
      payload: { status: 'investigating', note: '  ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/note/);
  });

  it('moves it, records who and why, and emails the tester the note', async () => {
    const res = await call('admin')({
      method: 'POST',
      url: `/api/admin/feedback/${String(issueId)}/status`,
      payload: { status: 'fixed', note: 'Fixed in today’s release. Thank you.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'fixed',
      submitter_email: testerEmail,
      changes: [{ status: 'fixed', by: adminEmail }],
    });
    await new Promise((r) => setTimeout(r, 20));
    const mail = h.mailer.lastTo(testerEmail);
    expect(mail?.subject).toBe(`Your feedback #${String(issueId)} is now: Fixed`);
    expect(mail?.text).toContain('Fixed in today’s release. Thank you.');
  });

  it('can go back: something marked fixed can be reopened', async () => {
    const res = await call('admin')({
      method: 'POST',
      url: `/api/admin/feedback/${String(issueId)}/status`,
      payload: { status: 'in_progress', note: 'It came back on phones.' },
    });
    expect(res.json()).toMatchObject({ status: 'in_progress' });
  });

  it('the tester sees the notes but not who wrote them', async () => {
    const res = await call('tester')({ method: 'GET', url: `/api/feedback/${String(issueId)}` });
    expect(res.json()).toMatchObject({
      mine: true,
      changes: [{ status: 'fixed' }, { status: 'in_progress', note: 'It came back on phones.' }],
    });
    expect(res.body).not.toContain(adminEmail);
  });

  it('refuses a status the tracker does not have', async () => {
    const res = await call('admin')({
      method: 'POST',
      url: `/api/admin/feedback/${String(issueId)}/status`,
      payload: { status: 'resolved', note: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('the database keeps what a tester wrote, and the history', async () => {
    await expect(
      h.db.updateTable('feedback').set({ title: 'Edited' }).where('id', '=', issueId).execute(),
    ).rejects.toThrow(/only the status/);
    await expect(h.db.deleteFrom('feedback').where('id', '=', issueId).execute()).rejects.toThrow();
    await expect(
      h.db.deleteFrom('feedback_events').where('feedback_id', '=', issueId).execute(),
    ).rejects.toThrow();
  });
});

describe('the queue', () => {
  it('counts by status and totals what is open', async () => {
    const res = await call('admin')({ method: 'GET', url: '/api/admin/feedback?status=open' });
    const body = res.json<{
      open: number;
      counts: Record<string, number>;
      issues: { id: number; status: string }[];
    }>();
    expect(
      body.issues.every((i) =>
        ['new', 'investigating', 'in_progress', 'need_info'].includes(i.status),
      ),
    ).toBe(true);
    expect(body.issues.some((i) => i.id === issueId)).toBe(true);
    expect(body.open).toBeGreaterThanOrEqual(1);
    const bad = await call('admin')({ method: 'GET', url: '/api/admin/feedback?status=nope' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('the weekly feedback digest', () => {
  it('sends nothing without an address to send to, and says so', async () => {
    const mailer = capturingMailer();
    const out = await runFeedbackDigest({
      db: h.db,
      mailer,
      siteOrigin: 'https://x.test',
      log: () => undefined,
      adminEmail: undefined,
    });
    expect(out).toEqual({ ok: true, summary: expect.stringMatching(/ADMIN_EMAIL/) as unknown });
    expect(mailer.messages).toHaveLength(0);
  });

  it('lists every open issue, the longest-untouched first, and calls out the stale', async () => {
    // A second issue, filed now; the first one is made to look old.
    const res = await call('other')({
      method: 'POST',
      url: '/api/feedback',
      payload: { ...issue, title: 'A newer problem', severity: 'minor' },
    });
    const newer = res.json<{ id: number }>().id;
    const mailer = capturingMailer();
    const now = new Date(Date.now() + 10 * 86_400_000);
    const out = await runFeedbackDigest({
      db: h.db,
      mailer,
      siteOrigin: 'https://x.test',
      log: () => undefined,
      adminEmail: ADMIN_EMAIL,
      now: () => now,
    });
    expect(out.ok).toBe(true);
    const mail = mailer.lastTo(ADMIN_EMAIL);
    expect(mail?.subject).toMatch(/^Feedback: \d+ open, \d+ stale$/);
    const text = mail?.text ?? '';
    // Both ten days old from "now"; the one moved earlier comes first.
    expect(text.indexOf(`#${String(issueId)} `)).toBeLessThan(text.indexOf(`#${String(newer)} `));
    expect(text).toContain(`STALE  #${String(newer)} A newer problem`);
  });

  it('closed issues are not in it', async () => {
    await call('admin')({
      method: 'POST',
      url: `/api/admin/feedback/${String(issueId)}/status`,
      payload: { status: 'wont_fix', note: 'Not something we can change.' },
    });
    const mailer = capturingMailer();
    await runFeedbackDigest({
      db: h.db,
      mailer,
      siteOrigin: 'https://x.test',
      log: () => undefined,
      adminEmail: ADMIN_EMAIL,
    });
    expect(mailer.lastTo(ADMIN_EMAIL)?.text ?? '').not.toContain(`#${String(issueId)} `);
  });
});
