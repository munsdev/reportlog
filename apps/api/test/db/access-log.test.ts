/**
 * The access log, wherever protected data is opened (port of legacy
 * accessLog.js's kinds: identity, original, preview, audit).
 *
 *   - a file's cleaned copy, a still or a page: 'file_preview', written before
 *     the bytes go out, one entry per look rather than per request, for
 *     oversight; NOT shown to the reporter;
 *   - a file's original: F's 'viewed_original' event, with its reason; shown
 *     to the reporter, and to administrators with who;
 *   - an address opened to ask a reporter for files: 'contact_used', shown to
 *     the reporter, never with who.
 *
 * Contact details opened by staff ('contact') are D1's, tested in
 * moderation.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sealContact } from '../../src/filing/contactKeys.ts';
import { workOnce } from '../../src/files/worker.ts';
import { PREVIEW_WINDOW_MINUTES } from '../../src/moderation/accessLog.ts';
import { setPermission } from '../../src/permissions/log.ts';
import { attach, filesHarness, jpegWithGps, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { RING, spine, tokenFor } from './filing-helpers.ts';
import { QUESTIONS, fileReport, launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';
import { doorPass } from '../door-pass.ts';

let h: FilesHarness;
let lb: { id: number; slug: string };
let mod: ReturnType<typeof as>;
let modEmail: string;
let admin: ReturnType<typeof as>;

interface Access {
  what: string;
  reason: string | null;
}
const accessesOf = async (who: ReturnType<typeof as>, thread: string) => {
  const res = await who({ method: 'GET', url: `/api/mine/reports/${thread}/accesses` });
  expect(res.statusCode).toBe(200);
  return { body: res.body, accesses: res.json<{ accesses: Access[] }>().accesses };
};
const adminLog = async (thread: string) =>
  (await admin({ method: 'GET', url: `/api/admin/moderation/access-log?thread=${thread}` })).json<{
    entries: {
      kind: string;
      staff_email: string;
      reason: string | null;
      attachment_id: number | null;
    }[];
  }>().entries;

beforeAll(async () => {
  h = await filesHarness();
  lb = await launchedLogbook(h.db, [
    ...QUESTIONS,
    { key: 'photos', kind: 'file', label: 'Photos' },
  ]);
  modEmail = address('log-mod');
  await seat(h.db, modEmail, 'moderator');
  mod = as(h, await signIn(h, modEmail));
  const adminEmail = address('log-admin');
  await seat(h.db, adminEmail, 'admin');
  admin = as(h, await signIn(h, adminEmail));
});
afterAll(async () => {
  await h.close();
});

describe.skipIf(toolsMissing)('opening a file', () => {
  let thread = '';
  let fileId = 0;
  let reporter: ReturnType<typeof as>;

  beforeAll(async () => {
    const email = address('log-rep');
    const draft = (await h.app.inject({ method: 'POST', url: '/api/uploads/draft' })).json<{
      draft_token: string;
    }>().draft_token;
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: jpegWithGps(h.files.dir),
      type: 'image/jpeg',
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        ...(await doorPass(h.app)),
        ...spine(email),
        logbook: lb.slug,
        answers: { what: 'At the door' },
        draft_token: draft,
      },
    });
    await workOnce(h.files);
    const done = await h.app.inject({
      method: 'POST',
      url: `/api/reports/confirm/${tokenFor(h.mailer, email) ?? ''}`,
    });
    const ref = done.json<{ confirmation: { public_ref: string } }>().confirmation.public_ref;
    thread = (
      await h.db
        .selectFrom('reports')
        .select('thread_id')
        .where('public_ref', '=', ref)
        .executeTakeFirstOrThrow()
    ).thread_id;
    fileId = (
      await h.db
        .selectFrom('attachments')
        .select('id')
        .where('thread_id', '=', thread)
        .executeTakeFirstOrThrow()
    ).id;
    reporter = as(h, await signIn(h, email));
  });

  const previews = () =>
    h.db
      .selectFrom('contact_access_log')
      .selectAll()
      .where('kind', '=', 'file_preview')
      .where('attachment_id', '=', fileId)
      .execute();

  it('a look at the cleaned copy is recorded once, however many requests it takes', async () => {
    expect(await previews()).toHaveLength(0);
    for (let i = 0; i < 3; i++) {
      const res = await mod({
        method: 'GET',
        url: `/api/moderate/files/file/${String(fileId)}/rendition`,
      });
      expect(res.statusCode).toBe(200);
    }
    const rows = await previews();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ staff_email: modEmail, thread_id: thread, reason: null });
    expect(PREVIEW_WINDOW_MINUTES).toBeGreaterThan(0);
  });

  it('a look by somebody else, or after the window, is a new entry', async () => {
    const otherEmail = address('log-mod2');
    await seat(h.db, otherEmail, 'moderator');
    const other = as(h, await signIn(h, otherEmail));
    // Their earlier look, from before the window: the log is append-only, so
    // the old entry is written already backdated rather than moved back.
    const head = await h.db
      .selectFrom('report_heads')
      .select('current_report_id')
      .where('thread_id', '=', thread)
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('contact_access_log')
      .values({
        staff_email: otherEmail,
        kind: 'file_preview',
        thread_id: thread,
        report_id: head.current_report_id,
        attachment_id: fileId,
        accessed_at: new Date(Date.now() - (PREVIEW_WINDOW_MINUTES + 1) * 60_000),
      })
      .execute();
    const res = await other({
      method: 'GET',
      url: `/api/moderate/files/file/${String(fileId)}/rendition`,
    });
    expect(res.statusCode).toBe(200);
    const who = (await previews()).map((r) => r.staff_email);
    expect(who.filter((w) => w === modEmail)).toHaveLength(1);
    expect(who.filter((w) => w === otherEmail)).toHaveLength(2);
  });

  it('a preview cannot be written without its file, and the log stays append-only', async () => {
    await expect(
      h.db
        .insertInto('contact_access_log')
        .values({ staff_email: modEmail, kind: 'file_preview', thread_id: thread, report_id: 1 })
        .execute(),
    ).rejects.toThrow();
    await expect(
      h.db.updateTable('contact_access_log').set({ reason: 'rewritten afterwards' }).execute(),
    ).rejects.toThrow();
  });

  it('an over-long reason for the original is refused, not cut short, and nothing is recorded or sent (decision 31)', async () => {
    const res = await mod({
      method: 'GET',
      url: `/api/moderate/files/file/${String(fileId)}/original?reason=${'x'.repeat(501)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string; message: string } }>().error).toEqual({
      code: 'reason_too_long',
      message: 'Please keep the reason under 500 characters.',
    });
    expect((await accessesOf(reporter, thread)).accesses).toEqual([]);
  });

  it('the original, with a reason: the reporter sees it without who, and previews are not shown to them', async () => {
    const res = await mod({
      method: 'GET',
      url: `/api/moderate/files/file/${String(fileId)}/original?reason=${encodeURIComponent('To check where it was taken.')}`,
    });
    expect(res.statusCode).toBe(200);
    const seen = await accessesOf(reporter, thread);
    expect(seen.accesses).toEqual([
      expect.objectContaining({ what: 'file_original', reason: 'To check where it was taken.' }),
    ]);
    expect(seen.body).not.toContain('@');
  });

  it('administrators see every look with who: the original and the copies', async () => {
    const entries = await adminLog(thread);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain('file_original');
    expect(kinds).toContain('file_preview');
    const original = entries.find((e) => e.kind === 'file_original');
    expect(original).toMatchObject({
      staff_email: modEmail,
      reason: 'To check where it was taken.',
      attachment_id: fileId,
    });
  });
});

describe.skipIf(toolsMissing)('asking a reporter for files', () => {
  it('opening their address to send the ask is recorded first, and the reporter is shown it without who', async () => {
    const email = address('log-ask');
    const { row } = await fileReport(h.db, lb, {
      what: 'A long queue outside.',
      has: 'yes',
      of: 'a photo of the queue',
    });
    await h.db
      .insertInto('report_heads')
      .values({ thread_id: row.thread_id, current_report_id: row.id })
      .execute();
    await h.db
      .transaction()
      .execute((trx) =>
        sealContact(trx, RING, { threadId: row.thread_id, email, filedBy: 'reporter' }),
      );
    await setPermission(h.db, {
      threadId: row.thread_id,
      permission: 'evidence_request',
      granted: true,
    });
    const ask = await mod({
      method: 'POST',
      url: `/api/moderate/evidence/${row.thread_id}`,
      payload: { message: 'Could you send the photo of the queue?' },
    });
    expect(ask.statusCode).toBe(200);
    const logged = await h.db
      .selectFrom('contact_access_log')
      .selectAll()
      .where('thread_id', '=', row.thread_id)
      .execute();
    expect(logged).toEqual([
      expect.objectContaining({ kind: 'contact_used', staff_email: modEmail, report_id: row.id }),
    ]);
    const reporter = as(h, await signIn(h, email));
    const seen = await accessesOf(reporter, row.thread_id);
    expect(seen.accesses).toEqual([
      expect.objectContaining({ what: 'contact_used', reason: null }),
    ]);
    expect(seen.body).not.toContain(modEmail);
    expect(seen.body).not.toContain('@');
  });
});
