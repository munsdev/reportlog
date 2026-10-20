/**
 * A video's still and a document's pages: the poster and page routes, on
 * the public side and the moderators'.
 *
 * THE PROMISES UNDER TEST:
 *   - a published video's still and a published document's pages are served
 *     by the same checks as the file itself, at every request: while it is
 *     published, permitted, current and its report public, and not after;
 *   - a file without a still, a page that does not exist, a page number
 *     that is not one, and a key that is not a key are all "not here",
 *     never a different object;
 *   - a moderator sees the still and the pages decrypted from evidence,
 *     before anything is published, and each look is on the access log;
 *     nobody else does, and an erased file is gone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workOnce } from '../../src/files/worker.ts';
import {
  SECRET,
  attach,
  filesHarness,
  jpegWithGps,
  pdfWithAuthor,
  toolsMissing,
  videoWithLocation,
} from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, tokenFor } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
let thread: string;
let ref: string;
/** By name: the photo, the video and the three-page PDF. */
let ids: { photo: number; video: number; pdf: number };
let reporter: ReturnType<typeof as>;
let moderator: ReturnType<typeof as>;
let moderatorEmail: string;

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const isJpeg = (b: Buffer) => b.subarray(0, 3).equals(JPEG);

const publicGet = (url: string) => h.app.inject({ method: 'GET', url });
const staffGet = (id: number, what: string) =>
  moderator({ method: 'GET', url: `/api/moderate/files/file/${String(id)}/${what}` });
const publicKey = async (id: number) =>
  (
    (
      await h.db
        .selectFrom('attachment_heads')
        .select('rendition_key')
        .where('attachment_id', '=', id)
        .executeTakeFirstOrThrow()
    ).rendition_key ?? ''
  ).slice('rendition/'.length);
const publish = (id: number, alt: string) =>
  moderator({
    method: 'POST',
    url: `/api/moderate/files/file/${String(id)}/publication`,
    payload: { publication: 'published', alt_text: alt, reason: 'shows what happened' },
  });
const approve = (status: string) =>
  h.db
    .updateTable('report_heads')
    .set({ moderation_status: status })
    .where('thread_id', '=', thread)
    .execute();

describe.skipIf(toolsMissing)('stills and pages', () => {
  beforeAll(async () => {
    h = await filesHarness();
    const lb = await launchedLogbook(h.db, [
      { key: 'what', kind: 'long_text', label: 'What happened', required: true },
      { key: 'files', kind: 'file', label: 'Files' },
    ]);
    const email = address('posters');
    const draft = (await h.app.inject({ method: 'POST', url: '/api/uploads/draft' })).json<{
      draft_token: string;
    }>().draft_token;
    for (const [body, type, name] of [
      [jpegWithGps(h.files.dir), 'image/jpeg', 'photo.jpg'],
      [videoWithLocation(h.files.dir), 'video/quicktime', 'clip.mov'],
      [pdfWithAuthor(3), 'application/pdf', 'letter.pdf'],
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
    ref = done.json<{ confirmation: { public_ref: string } }>().confirmation.public_ref;
    thread = (
      await h.db
        .selectFrom('reports')
        .select('thread_id')
        .where('public_ref', '=', ref)
        .executeTakeFirstOrThrow()
    ).thread_id;
    const rows = await h.db
      .selectFrom('attachments')
      .select(['id', 'ordinal'])
      .where('thread_id', '=', thread)
      .orderBy('ordinal')
      .execute();
    const [photo, video, pdf] = rows.map((r) => r.id);
    ids = { photo: photo ?? 0, video: video ?? 0, pdf: pdf ?? 0 };
    reporter = as(h, await signIn(h, email));
    moderatorEmail = address('postermod');
    await seat(h.db, moderatorEmail, 'moderator');
    moderator = as(h, await signIn(h, moderatorEmail));
  });
  afterAll(async () => {
    await h.close();
  });

  describe('for moderators, before anything is published', () => {
    it('a video’s still, decrypted, with nothing of the original in it', async () => {
      const r = await staffGet(ids.video, 'poster');
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/jpeg');
      expect(r.headers['cache-control']).toContain('no-cache');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(isJpeg(r.rawPayload)).toBe(true);
      expect(r.rawPayload.includes(SECRET)).toBe(false);
    });

    it('a document’s pages, one to three; page one is the rendition', async () => {
      const pages = [];
      for (const n of [1, 2, 3]) {
        const r = await staffGet(ids.pdf, `page/${String(n)}`);
        expect(r.statusCode).toBe(200);
        expect(r.headers['content-type']).toBe('image/jpeg');
        expect(isJpeg(r.rawPayload)).toBe(true);
        expect(r.rawPayload.includes(SECRET)).toBe(false);
        pages.push(r.rawPayload);
      }
      expect(pages[0]?.equals((await staffGet(ids.pdf, 'rendition')).rawPayload)).toBe(true);
    });

    it('no still on a photo, no page past the last or before the first, and no page called x', async () => {
      expect((await staffGet(ids.photo, 'poster')).statusCode).toBe(404);
      expect((await staffGet(ids.pdf, 'poster')).statusCode).toBe(404);
      // One address per page: `2e0`, `02` and `0x2` are not page two.
      for (const n of ['0', '4', '-1', 'x', '1.5', '2e0', '02', '0x2', '%202'])
        expect((await staffGet(ids.pdf, `page/${n}`)).statusCode).toBe(404);
      // A photo is one page: its first is its rendition, and there is no second.
      expect((await staffGet(ids.photo, 'page/1')).statusCode).toBe(200);
      expect((await staffGet(ids.photo, 'page/2')).statusCode).toBe(404);
      expect((await staffGet(999_999, 'poster')).statusCode).toBe(404);
    });

    it('each look is on the access log, and the original’s record is not touched', async () => {
      const looks = await h.db
        .selectFrom('contact_access_log')
        .select(['attachment_id'])
        .where('kind', '=', 'file_preview')
        .where('thread_id', '=', thread)
        .where('staff_email', '=', moderatorEmail)
        .execute();
      expect(new Set(looks.map((l) => l.attachment_id))).toEqual(
        new Set([ids.photo, ids.video, ids.pdf]),
      );
      const originals = await h.db
        .selectFrom('attachment_events')
        .select('id')
        .where('thread_id', '=', thread)
        .where('action', '=', 'viewed_original')
        .execute();
      expect(originals).toEqual([]);
    });

    it('not for the reporter, nor for somebody signed out', async () => {
      const url = `/api/moderate/files/file/${String(ids.video)}/poster`;
      expect((await reporter({ method: 'GET', url })).statusCode).toBe(403);
      expect((await publicGet(url)).statusCode).toBe(401);
      const page = `/api/moderate/files/file/${String(ids.pdf)}/page/2`;
      expect((await reporter({ method: 'GET', url: page })).statusCode).toBe(403);
      expect((await publicGet(page)).statusCode).toBe(401);
    });
  });

  describe('on the public side', () => {
    beforeAll(async () => {
      await reporter({
        method: 'POST',
        url: `/api/mine/reports/${thread}/permissions`,
        payload: { permission: 'attachment_publication', granted: true },
      });
      await approve('valid');
      for (const [id, alt] of [
        [ids.photo, 'A queue at a door'],
        [ids.video, 'A queue moving'],
        [ids.pdf, 'A letter, three pages'],
      ] as const) {
        expect((await publish(id, alt)).statusCode).toBe(200);
      }
    });

    it('the board lists the still and the pages', async () => {
      const r = await publicGet(`/api/files/report/${ref}`);
      expect(r.json()).toMatchObject({
        attached: 3,
        published: [
          { ordinal: 1, has_poster: false, pages: 1 },
          { ordinal: 2, has_poster: true, pages: 1, media_type: 'video/mp4' },
          { ordinal: 3, has_poster: false, pages: 3, media_type: 'image/jpeg' },
        ],
      });
    });

    it('a published video’s still is the moderator’s, byte for byte', async () => {
      const key = await publicKey(ids.video);
      const r = await publicGet(`/api/files/public/${key}/poster`);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/jpeg');
      expect(r.headers['cache-control']).toContain('no-cache');
      expect(r.headers['content-security-policy']).toContain('sandbox');
      expect(r.rawPayload.equals((await staffGet(ids.video, 'poster')).rawPayload)).toBe(true);
      // The video itself is the MP4, not the still.
      const v = await publicGet(`/api/files/public/${key}`);
      expect(v.headers['content-type']).toBe('video/mp4');
      // A still is a plain object: ranges work on it as on the video.
      const part = await h.app.inject({
        method: 'GET',
        url: `/api/files/public/${key}/poster`,
        headers: { range: 'bytes=0-2' },
      });
      expect(part.statusCode).toBe(206);
      expect(part.rawPayload.equals(JPEG)).toBe(true);
    });

    it('a published document’s pages, each the moderator’s page, and page one the file', async () => {
      const key = await publicKey(ids.pdf);
      for (const n of [1, 2, 3]) {
        const r = await publicGet(`/api/files/public/${key}/page/${String(n)}`);
        expect(r.statusCode).toBe(200);
        expect(r.headers['content-type']).toBe('image/jpeg');
        expect(r.rawPayload.equals((await staffGet(ids.pdf, `page/${String(n)}`)).rawPayload)).toBe(
          true,
        );
      }
      expect(
        (await publicGet(`/api/files/public/${key}/page/1`)).rawPayload.equals(
          (await publicGet(`/api/files/public/${key}`)).rawPayload,
        ),
      ).toBe(true);
    });

    it('anything else is not here', async () => {
      const photo = await publicKey(ids.photo);
      const pdf = await publicKey(ids.pdf);
      expect((await publicGet(`/api/files/public/${photo}/poster`)).statusCode).toBe(404);
      expect((await publicGet(`/api/files/public/${pdf}/poster`)).statusCode).toBe(404);
      for (const n of ['0', '4', '-1', 'x', '1.5', '2e0', '02', '0x2', '%202'])
        expect((await publicGet(`/api/files/public/${pdf}/page/${n}`)).statusCode).toBe(404);
      expect((await publicGet(`/api/files/public/${photo}/page/2`)).statusCode).toBe(404);
      // A key that is not one never reaches storage, nor does a made-up one.
      expect((await publicGet('/api/files/public/..%2F..%2Fevidence/poster')).statusCode).toBe(404);
      expect((await publicGet(`/api/files/public/${'0'.repeat(32)}/poster`)).statusCode).toBe(404);
      expect((await publicGet(`/api/files/public/${'0'.repeat(32)}/page/1`)).statusCode).toBe(404);
    });

    it('checked again at every request: not while the report is not public', async () => {
      const video = await publicKey(ids.video);
      const pdf = await publicKey(ids.pdf);
      await approve('pending');
      try {
        expect((await publicGet(`/api/files/public/${video}/poster`)).statusCode).toBe(404);
        expect((await publicGet(`/api/files/public/${pdf}/page/2`)).statusCode).toBe(404);
      } finally {
        await approve('valid');
      }
      expect((await publicGet(`/api/files/public/${video}/poster`)).statusCode).toBe(200);
      expect((await publicGet(`/api/files/public/${pdf}/page/2`)).statusCode).toBe(200);
    });

    it('a still and the pages come down with their file, and leave the bucket', async () => {
      const video = await publicKey(ids.video);
      const pdf = await publicKey(ids.pdf);
      for (const id of [ids.video, ids.pdf]) {
        const r = await moderator({
          method: 'POST',
          url: `/api/moderate/files/file/${String(id)}/publication`,
          payload: { publication: 'withheld', reason: 'a face is visible' },
        });
        expect(r.statusCode).toBe(200);
      }
      expect((await publicGet(`/api/files/public/${video}/poster`)).statusCode).toBe(404);
      for (const n of [1, 2, 3])
        expect((await publicGet(`/api/files/public/${pdf}/page/${String(n)}`)).statusCode).toBe(
          404,
        );
      for (const key of [
        `rendition/${video}.poster`,
        `rendition/${pdf}.page2`,
        `rendition/${pdf}.page3`,
      ])
        expect(await h.files.storage.head('renditions', key)).toBeNull();
    });

    it('the reporter taking permission back takes the photo’s pages down too', async () => {
      const photo = await publicKey(ids.photo);
      expect((await publicGet(`/api/files/public/${photo}/page/1`)).statusCode).toBe(200);
      await reporter({
        method: 'POST',
        url: `/api/mine/reports/${thread}/permissions`,
        payload: { permission: 'attachment_publication', granted: false },
      });
      expect((await publicGet(`/api/files/public/${photo}/page/1`)).statusCode).toBe(404);
    });
  });

  it('an erased file has no still and no pages, for anybody', async () => {
    const admin = address('posteradmin');
    await seat(h.db, admin, 'admin');
    const asAdmin = as(h, await signIn(h, admin));
    for (const id of [ids.video, ids.pdf]) {
      const r = await asAdmin({
        method: 'POST',
        url: `/api/admin/files/file/${String(id)}/erase`,
        payload: { reason: 'the reporter asked' },
      });
      expect(r.statusCode).toBe(200);
    }
    expect((await staffGet(ids.video, 'poster')).statusCode).toBe(410);
    expect((await staffGet(ids.pdf, 'page/2')).statusCode).toBe(410);
  });
});
