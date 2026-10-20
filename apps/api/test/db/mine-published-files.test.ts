/**
 * "My reports" says how many of a report's files are on the public site, so
 * the page can ask before the reporter switches off file publication: that
 * switch takes published files down at once (legacy's permissions.test.js,
 * "taking published files down asks first").
 *
 * The count is the files' own record of what is published, the same rows
 * the take-down acts on, so what the page warns about is what goes down.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workOnce } from '../../src/files/worker.ts';
import { attach, filesHarness, jpegWithGps, pngWithText, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, threadOf, tokenFor } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
let thread: string;
let fileIds: number[];
let reporter: ReturnType<typeof as>;
let moderator: ReturnType<typeof as>;

const detail = async () => {
  const r = await reporter({ method: 'GET', url: `/api/mine/reports/${thread}` });
  expect(r.statusCode).toBe(200);
  return r.json<{ published_files: number; permissions: Record<string, boolean> }>();
};
const grant = (granted: boolean) =>
  reporter({
    method: 'POST',
    url: `/api/mine/reports/${thread}/permissions`,
    payload: { permission: 'attachment_publication', granted },
  });
const publish = (id: number) =>
  moderator({
    method: 'POST',
    url: `/api/moderate/files/file/${String(id)}/publication`,
    payload: { publication: 'published', alt_text: 'A queue at a door', reason: 'shows it' },
  });

describe.skipIf(toolsMissing)('how many of my files are published', () => {
  beforeAll(async () => {
    h = await filesHarness();
    const lb = await launchedLogbook(h.db, [
      { key: 'what', kind: 'long_text', label: 'What happened', required: true },
      { key: 'photos', kind: 'file', label: 'Photos' },
    ]);
    const email = address('mine-files');
    const draft = (await h.app.inject({ method: 'POST', url: '/api/uploads/draft' })).json<{
      draft_token: string;
    }>().draft_token;
    for (const [name, body, type] of [
      ['one.jpg', jpegWithGps(h.files.dir), 'image/jpeg'],
      ['two.png', pngWithText(h.files.dir), 'image/png'],
    ] as const) {
      await attach(h, { draft, logbook: lb.slug, email, body, type, name });
    }
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
    const ref = done.json<{ confirmation: { public_ref: string } }>().confirmation.public_ref;
    thread = await threadOf(h.db, ref);
    fileIds = (
      await h.db
        .selectFrom('attachments')
        .select('id')
        .where('thread_id', '=', thread)
        .orderBy('ordinal')
        .execute()
    ).map((r) => r.id);
    await h.db
      .updateTable('report_heads')
      .set({ moderation_status: 'valid' })
      .where('thread_id', '=', thread)
      .execute();
    reporter = as(h, await signIn(h, email));
    const mod = address('mine-files-mod');
    await seat(h.db, mod, 'moderator');
    moderator = as(h, await signIn(h, mod));
  });
  afterAll(async () => {
    await h.close();
  });

  it('is 0 while nothing is published, permission or not', async () => {
    expect(fileIds).toHaveLength(2);
    expect((await detail()).published_files).toBe(0);
    expect((await grant(true)).statusCode).toBe(200);
    expect(await detail()).toMatchObject({
      published_files: 0,
      permissions: { attachment_publication: true },
    });
  });

  it('counts each file a moderator publishes', async () => {
    expect((await publish(fileIds[0] ?? 0)).statusCode).toBe(200);
    expect((await detail()).published_files).toBe(1);
    expect((await publish(fileIds[1] ?? 0)).statusCode).toBe(200);
    expect((await detail()).published_files).toBe(2);
  });

  it('and is 0 again once switching the permission off has taken them down', async () => {
    expect((await grant(false)).statusCode).toBe(200);
    expect(await detail()).toMatchObject({
      published_files: 0,
      permissions: { attachment_publication: false },
    });
  });
});
