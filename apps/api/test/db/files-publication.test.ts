/**
 * Publishing files, taking them down, and erasing one.
 *
 * THE PROMISES UNDER TEST:
 *   - consent is the ceiling: no file is published without the reporter's
 *     files permission, and the database refuses it too;
 *   - taking that permission back takes published files down, through the
 *     same path a moderator's withholding takes, and the database refuses a
 *     revocation that left one up;
 *   - a published copy is served only while every gate holds, checked at
 *     each request;
 *   - destroying a file's key erases exactly that file and leaves its
 *     fingerprint, so the report still verifies.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { decryptBuffer } from '../../src/files/envelope.ts';
import { readAll } from '../../src/files/storage.ts';
import { workOnce } from '../../src/files/worker.ts';
import { attach, filesHarness, jpegWithGps, pngWithText, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, tokenFor } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
let lb: { id: number; slug: string };
let thread: string;
let ref: string;
let fileIds: number[];
let reporter: ReturnType<typeof as>;
let moderator: ReturnType<typeof as>;
let admin: ReturnType<typeof as>;
let moderatorEmail: string;

const grant = (permission: string, granted: boolean) =>
  reporter({
    method: 'POST',
    url: `/api/mine/reports/${thread}/permissions`,
    payload: { permission, granted },
  });
const publication = (id: number, body: Record<string, unknown>) =>
  moderator({
    method: 'POST',
    url: `/api/moderate/files/file/${String(id)}/publication`,
    payload: body,
  });
const head = (id: number) =>
  h.db
    .selectFrom('attachment_heads')
    .selectAll()
    .where('attachment_id', '=', id)
    .executeTakeFirstOrThrow();
const publicKey = async (id: number) =>
  ((await head(id)).rendition_key ?? '').slice('rendition/'.length);
const fetchPublic = (key: string, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url: `/api/files/public/${key}`, headers });
const approve = (status = 'valid') =>
  h.db
    .updateTable('report_heads')
    .set({ moderation_status: status })
    .where('thread_id', '=', thread)
    .execute();

describe.skipIf(toolsMissing)('files on the public record', () => {
  beforeAll(async () => {
    h = await filesHarness();
    lb = await launchedLogbook(h.db, [
      { key: 'what', kind: 'long_text', label: 'What happened', required: true },
      { key: 'photos', kind: 'file', label: 'Photos' },
    ]);
    const email = address('pub');
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
    moderatorEmail = address('mod');
    await seat(h.db, moderatorEmail, 'moderator');
    moderator = as(h, await signIn(h, moderatorEmail));
    const adminEmail = address('admin');
    await seat(h.db, adminEmail, 'admin');
    admin = as(h, await signIn(h, adminEmail));
    await approve();
  });
  afterAll(async () => {
    await h.close();
  });

  it('a moderator sees the files, withheld, and who may publish them', async () => {
    const r = await moderator({ method: 'GET', url: `/api/moderate/files/${thread}` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      may_publish: true,
      files_permitted: false,
      files: [
        { original_name: 'one.jpg', publication: 'withheld', media_type: 'image/jpeg' },
        { original_name: 'two.png', publication: 'withheld', media_type: 'image/png' },
      ],
    });
    // Not for anybody else, and an administrator is not a moderator.
    expect(
      (await reporter({ method: 'GET', url: `/api/moderate/files/${thread}` })).statusCode,
    ).toBe(403);
    expect((await admin({ method: 'GET', url: `/api/moderate/files/${thread}` })).statusCode).toBe(
      403,
    );
  });

  it('CONSENT IS THE CEILING: without the reporter’s files permission nothing is published', async () => {
    const r = await publication(fileIds[0] ?? 0, {
      publication: 'published',
      alt_text: 'A queue at a door',
      reason: 'shows the queue',
    });
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatch(/permission/);
    // And the database refuses a path that forgot to ask.
    await expect(
      sql`UPDATE attachment_heads SET publication = 'published', rendition_key = 'rendition/x', alt_text = 'x' WHERE attachment_id = ${fileIds[0]}`.execute(
        h.db,
      ),
    ).rejects.toThrow(/not permitted/);
  });

  it('with it, a moderator publishes the re-encoded copy, described', async () => {
    expect((await grant('attachment_publication', true)).statusCode).toBe(200);
    expect(
      (await publication(fileIds[0] ?? 0, { publication: 'published', reason: 'x' })).statusCode,
    ).toBe(400);
    expect(
      (
        await publication(fileIds[0] ?? 0, {
          publication: 'published',
          alt_text: 'A queue at a door',
          reason: 'shows the queue',
        })
      ).statusCode,
    ).toBe(200);

    const listed = await h.app.inject({ method: 'GET', url: `/api/files/report/${ref}` });
    expect(listed.json()).toMatchObject({
      attached: 2,
      published: [{ ordinal: 1, media_type: 'image/jpeg', alt_text: 'A queue at a door' }],
    });

    const key = await publicKey(fileIds[0] ?? 0);
    const got = await fetchPublic(key);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['cache-control']).toContain('no-cache');
    expect(got.rawPayload.includes('Exif')).toBe(false);
    expect(got.rawPayload.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    const part = await fetchPublic(key, { range: 'bytes=0-9' });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(10);
  });

  it('served only while the report itself is public, checked at every request', async () => {
    const key = await publicKey(fileIds[0] ?? 0);
    await approve('pending');
    expect((await fetchPublic(key)).statusCode).toBe(404);
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/files/report/${ref}` })).statusCode,
    ).toBe(404);
    await approve();
    expect((await fetchPublic(key)).statusCode).toBe(200);
  });

  it('TAKING THE PERMISSION BACK TAKES PUBLISHED FILES DOWN', async () => {
    const key = await publicKey(fileIds[0] ?? 0);
    expect((await grant('attachment_publication', false)).statusCode).toBe(200);
    expect((await fetchPublic(key)).statusCode).toBe(404);
    expect(await h.files.storage.head('renditions', `rendition/${key}`)).toBeNull();
    const after = await head(fileIds[0] ?? 0);
    expect(after).toMatchObject({ publication: 'withheld', rendition_key: null });
    const ev = await h.db
      .selectFrom('attachment_events')
      .selectAll()
      .where('attachment_id', '=', fileIds[0] ?? 0)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    // The reporter's act, with no address against it: this log cannot forget.
    expect(ev).toMatchObject({ action: 'taken_down', actor: 'reporter', actor_email: null });
  });

  it('and the database refuses a revocation that left a file up', async () => {
    await grant('attachment_publication', true);
    await publication(fileIds[0] ?? 0, {
      publication: 'published',
      alt_text: 'A queue at a door',
      reason: 'again',
    });
    await expect(
      h.db
        .transaction()
        .execute((trx) =>
          trx
            .insertInto('report_permissions_log')
            .values({ thread_id: thread, permission: 'attachment_publication', granted: false })
            .execute(),
        ),
    ).rejects.toThrow(/still published/);
    expect((await head(fileIds[0] ?? 0)).publication).toBe('published');
  });

  it('a moderator withholding goes down the same path', async () => {
    const key = await publicKey(fileIds[0] ?? 0);
    expect((await publication(fileIds[0] ?? 0, { publication: 'withheld' })).statusCode).toBe(400);
    expect(
      (await publication(fileIds[0] ?? 0, { publication: 'refused', reason: 'a face is visible' }))
        .statusCode,
    ).toBe(200);
    expect(await h.files.storage.head('renditions', `rendition/${key}`)).toBeNull();
    const ev = await h.db
      .selectFrom('attachment_events')
      .selectAll()
      .where('attachment_id', '=', fileIds[0] ?? 0)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(ev).toMatchObject({
      action: 'refused',
      actor: 'moderator',
      actor_email: moderatorEmail,
      reason: 'a face is visible',
    });
  });

  it('opening an original needs a reason, and is on the record', async () => {
    expect(
      (
        await moderator({
          method: 'GET',
          url: `/api/moderate/files/file/${String(fileIds[0])}/original`,
        })
      ).statusCode,
    ).toBe(400);
    const r = await moderator({
      method: 'GET',
      url: `/api/moderate/files/file/${String(fileIds[0])}/original?reason=checking%20the%20time`,
    });
    expect(r.statusCode).toBe(200);
    // The original, as submitted: the GPS is in it, which is why it is evidence and never public.
    expect(r.rawPayload.includes('Exif')).toBe(true);
    const rend = await moderator({
      method: 'GET',
      url: `/api/moderate/files/file/${String(fileIds[0])}/rendition`,
    });
    expect(rend.rawPayload.includes('Exif')).toBe(false);
    const ev = await h.db
      .selectFrom('attachment_events')
      .selectAll()
      .where('action', '=', 'viewed_original')
      .executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ actor_email: moderatorEmail, reason: 'checking the time' });
  });

  it('DESTROYING THE KEY ERASES EXACTLY ONE FILE AND LEAVES ITS FINGERPRINT', async () => {
    const [one = 0, two = 0] = fileIds;
    const before = await verifyReport(h.db, ref);
    const storageKey = (
      await h.db
        .selectFrom('attachments')
        .select('storage_key')
        .where('id', '=', one)
        .executeTakeFirstOrThrow()
    ).storage_key;
    const cipher = await h.files.storage.get('evidence', storageKey);
    const ciphertext = cipher ? await readAll(cipher) : Buffer.alloc(0);
    const oldKey = (await head(one)).dek_wrapped ?? Buffer.alloc(0);

    expect(
      (
        await moderator({
          method: 'POST',
          url: `/api/admin/files/file/${String(one)}/erase`,
          payload: { reason: 'asked to' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await admin({
          method: 'POST',
          url: `/api/admin/files/file/${String(one)}/erase`,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin({
          method: 'POST',
          url: `/api/admin/files/file/${String(one)}/erase`,
          payload: { reason: 'the reporter asked' },
        })
      ).statusCode,
    ).toBe(200);

    const gone = await head(one);
    expect(gone).toMatchObject({
      dek_wrapped: null,
      meta_enc: null,
      original_name: null,
      publication: 'refused',
    });
    expect(gone.dek_destroyed_at).not.toBeNull();
    // No other copy of the key anywhere: the slot gave its up when the file was sealed.
    const keys = await h.db
      .selectFrom('upload_slots')
      .select('dek_wrapped')
      .where('dek_wrapped', '=', oldKey)
      .execute();
    expect(keys).toEqual([]);
    // The bytes are gone from storage, and any copy kept elsewhere is noise.
    expect(await h.files.storage.head('evidence', storageKey)).toBeNull();
    expect(ciphertext.length).toBeGreaterThan(0);
    // The other file is untouched and still opens.
    const other = await head(two);
    const otherKey = (
      await h.db
        .selectFrom('attachments')
        .select('storage_key')
        .where('id', '=', two)
        .executeTakeFirstOrThrow()
    ).storage_key;
    const obj = await h.files.storage.get('evidence', otherKey);
    expect(
      decryptBuffer(
        h.files.ring.unwrap(other.dek_wrapped ?? Buffer.alloc(0)),
        obj ? await readAll(obj) : Buffer.alloc(0),
      ).length,
    ).toBeGreaterThan(0);
    // The record is unchanged: still the same fingerprint, still verifying.
    const after = await verifyReport(h.db, ref);
    expect(after?.content.ok && after.link.ok).toBe(true);
    expect(after?.hashed_fields.attachments).toEqual(before?.hashed_fields.attachments);
    // Publishing an erased file is impossible, and the database agrees.
    expect(
      (await publication(one, { publication: 'published', alt_text: 'x x x', reason: 'x' }))
        .statusCode,
    ).toBe(410);
    await expect(
      sql`UPDATE attachment_heads SET dek_wrapped = ${Buffer.alloc(60)} WHERE attachment_id = ${one}`.execute(
        h.db,
      ),
    ).rejects.toThrow(/never comes back/);
    await expect(
      sql`DELETE FROM attachment_heads WHERE attachment_id = ${one}`.execute(h.db),
    ).rejects.toThrow(/never deleted/);
  });

  it('a withdrawn report’s files come down with it', async () => {
    const two = fileIds[1] ?? 0;
    await publication(two, { publication: 'published', alt_text: 'A blue square', reason: 'fine' });
    const key = await publicKey(two);
    expect((await fetchPublic(key)).statusCode).toBe(200);
    expect(
      (
        await reporter({
          method: 'POST',
          url: `/api/mine/reports/${thread}/withdraw`,
          payload: { comment: 'changed my mind' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await fetchPublic(key)).statusCode).toBe(404);
    expect((await head(two)).publication).toBe('withheld');
    await workOnce(h.files);
    expect(await h.files.storage.head('renditions', `rendition/${key}`)).toBeNull();
  });
});
