/**
 * The two lookups F2's staff screens need: the moderator's queue of files
 * nobody has decided on, and an administrator finding a report's files by
 * its reference to erase one.
 *
 * THE PROMISES UNDER TEST:
 *   - a file waits until somebody decides on it; a deliberate withhold is a
 *     decision, so it leaves the queue as publishing does;
 *   - a reference finds its report whatever version it names, and an unknown
 *     one finds nothing rather than an error;
 *   - each is for its own role only (admin does not imply moderator).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workOnce } from '../../src/files/worker.ts';
import { attach, filesHarness, jpegWithGps, pngWithText, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, tokenFor } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
let thread: string;
let ref: string;
let fileIds: number[];
let moderator: ReturnType<typeof as>;
let reporter: ReturnType<typeof as>;
let admin: ReturnType<typeof as>;

interface Listed {
  thread_id: string;
  public_ref: string;
  files: number;
  undecided: number;
  published: number;
  files_permitted: boolean;
}
const queue = async (query = '') =>
  (await moderator({ method: 'GET', url: `/api/moderate/files${query}` })).json<{
    reports: Listed[];
  }>().reports;

describe.skipIf(toolsMissing)('the files staff lookups', () => {
  beforeAll(async () => {
    h = await filesHarness();
    const lb = await launchedLogbook(h.db, [
      { key: 'what', kind: 'long_text', label: 'What happened', required: true },
      { key: 'photos', kind: 'file', label: 'Photos' },
    ]);
    const email = address('staff');
    const draft = (await h.app.inject({ method: 'POST', url: '/api/uploads/draft' })).json<{
      draft_token: string;
    }>().draft_token;
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: jpegWithGps(h.files.dir),
      type: 'image/jpeg',
      name: 'one.jpg',
    });
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: pngWithText(h.files.dir),
      type: 'image/png',
      name: 'two.png',
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
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
    ref = done.json<{ confirmation: { public_ref: string } }>().confirmation.public_ref;
    thread = (
      await h.db
        .selectFrom('reports')
        .select('thread_id')
        .where('public_ref', '=', ref)
        .executeTakeFirstOrThrow()
    ).thread_id;
    fileIds = (
      await h.db
        .selectFrom('attachments')
        .select('id')
        .where('thread_id', '=', thread)
        .orderBy('ordinal')
        .execute()
    ).map((r) => r.id);
    reporter = as(h, await signIn(h, email));
    const modEmail = address('mod');
    await seat(h.db, modEmail, 'moderator');
    moderator = as(h, await signIn(h, modEmail));
    const adminEmail = address('admin');
    await seat(h.db, adminEmail, 'admin');
    admin = as(h, await signIn(h, adminEmail));
  });
  afterAll(async () => {
    await h.close();
  });

  it('a report whose files nobody has decided on is in the queue', async () => {
    const mine = (await queue()).find((r) => r.thread_id === thread);
    expect(mine).toMatchObject({
      public_ref: ref,
      files: 2,
      undecided: 2,
      published: 0,
      files_permitted: false,
    });
  });

  it('a deliberate withhold is a decision: the file leaves the queue', async () => {
    const r = await moderator({
      method: 'POST',
      url: `/api/moderate/files/file/${String(fileIds[0])}/publication`,
      payload: { publication: 'withheld', reason: 'Shows a face' },
    });
    expect(r.statusCode).toBe(200);
    expect((await queue()).find((x) => x.thread_id === thread)?.undecided).toBe(1);
    await moderator({
      method: 'POST',
      url: `/api/moderate/files/file/${String(fileIds[1])}/publication`,
      payload: { publication: 'refused', reason: 'Not about this' },
    });
    expect((await queue()).find((x) => x.thread_id === thread)).toBeUndefined();
  });

  it('a reference still finds the report once it has left the queue, and an unknown one finds nothing', async () => {
    const found = await queue(`?ref=${ref.toLowerCase()}`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ thread_id: thread, undecided: 0, files: 2 });
    expect(await queue('?ref=RL-NOPE-NOPE')).toEqual([]);
  });

  it('the queue is for moderators and administrators, as moderation is', async () => {
    expect((await admin({ method: 'GET', url: '/api/moderate/files' })).statusCode).toBe(200);
    // Somebody with neither role, signed in, is still refused.
    expect((await reporter({ method: 'GET', url: '/api/moderate/files' })).statusCode).toBe(403);
  });

  it('an administrator finds the files by reference, and a moderator cannot', async () => {
    const r = await admin({ method: 'GET', url: `/api/admin/files/report/${ref}` });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ thread_id: string; files: { id: number; erased: boolean }[] }>();
    expect(body.thread_id).toBe(thread);
    expect(body.files.map((f) => f.id)).toEqual(fileIds);
    expect(
      (await admin({ method: 'GET', url: '/api/admin/files/report/RL-NOPE' })).statusCode,
    ).toBe(404);
    expect(
      (await moderator({ method: 'GET', url: `/api/admin/files/report/${ref}` })).statusCode,
    ).toBe(403);
  });

  it('a withdrawn report says so, and none of its files go back up, permission or not', async () => {
    await reporter({
      method: 'POST',
      url: `/api/mine/reports/${thread}/permissions`,
      payload: { permission: 'attachment_publication', granted: true },
    });
    const w = await reporter({
      method: 'POST',
      url: `/api/mine/reports/${thread}/withdraw`,
      payload: { comment: 'Filed in error' },
    });
    expect(w.statusCode, w.body).toBe(200);
    const seen = await moderator({ method: 'GET', url: `/api/moderate/files/${thread}` });
    expect(seen.json<{ withdrawn: boolean }>().withdrawn).toBe(true);
    const r = await moderator({
      method: 'POST',
      url: `/api/moderate/files/file/${String(fileIds[0])}/publication`,
      payload: { publication: 'published', alt_text: 'A door', reason: 'Try' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: { code: string } }>().error.code).toBe('withdrawn');
  });
});
