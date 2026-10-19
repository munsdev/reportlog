/**
 * Files through the filing routes, end to end: attach, send, confirm.
 *
 * What is proved here is the join between the files workstream and filing
 * (C): the sealed manifest goes in through appendReportVersion, EXACTLY those
 * files are linked in report_attachments in the same transaction, the report
 * verifies, and confirming waits for a file still being prepared rather than
 * sealing a report that silently does not hold it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { workOnce } from '../../src/files/worker.ts';
import { attach, filesHarness, jpegWithGps, pdfWithAuthor, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, tokenFor } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, liftCurtain } from './identity-helpers.ts';

let h: FilesHarness;
let lb: { id: number; slug: string };
let plain: { id: number; slug: string };

const WHAT = { key: 'what', kind: 'long_text', label: 'What happened', required: true };
const QS = [WHAT, { key: 'photos', kind: 'file', label: 'Photos' }];

const newDraft = async () => {
  const r = await h.app.inject({ method: 'POST', url: '/api/uploads/draft' });
  return r.json<{ draft_token: string }>().draft_token;
};
const sendReport = (body: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: '/api/reports', payload: body });
const confirm = async (token: string) =>
  (await h.app.inject({ method: 'POST', url: `/api/reports/confirm/${token}` })).json<{
    confirmation: {
      state: string;
      public_ref?: string;
      files?: { attached: number; not_attached: { name: string; reason: string }[] };
    };
    just_confirmed: boolean;
  }>();

beforeAll(async () => {
  h = await filesHarness();
  lb = await launchedLogbook(h.db, QS);
  plain = await launchedLogbook(h.db, [WHAT]);
});
afterAll(async () => {
  await h.close();
});

describe('the upload config', () => {
  it('says what a logbook asking for files takes, and says no for one that does not ask', async () => {
    const on = await h.app.inject({ method: 'GET', url: `/api/uploads/config?logbook=${lb.slug}` });
    expect(on.json()).toMatchObject({
      enabled: true,
      kinds: ['photo', 'video', 'audio', 'document'],
      max_files: 10,
    });
    expect(on.json<{ accept: string[] }>().accept).toContain('image/heic');
    const offHere = await h.app.inject({
      method: 'GET',
      url: `/api/uploads/config?logbook=${plain.slug}`,
    });
    expect(offHere.json()).toMatchObject({ enabled: false });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/uploads',
      payload: {
        draft_token: await newDraft(),
        logbook: plain.slug,
        email: 'a@example.org',
        name: 'a.jpg',
        type: 'image/jpeg',
        size: 10,
      },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe.skipIf(toolsMissing)('attach, send, confirm', () => {
  it('seals exactly the finished files, links exactly those, and verifies', async () => {
    const email = address('files');
    const draft = await newDraft();
    const photo = jpegWithGps(h.files.dir);
    const pdf = pdfWithAuthor(1);
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: photo,
      type: 'image/jpeg',
      name: 'IMG_0001.jpg',
    });
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: pdf,
      type: 'application/pdf',
      name: 'letter.pdf',
    });
    // A file the worker will refuse: what it is comes from its bytes.
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: Buffer.from('not a picture at all'),
      type: 'image/png',
      name: 'fake.png',
    });

    // Nothing is worked on before Send.
    await workOnce(h.files);
    const before = await h.app.inject({
      method: 'GET',
      url: '/api/uploads/status',
      headers: { 'x-draft-token': draft },
    });
    expect(before.json<{ files: { status: string }[] }>().files.map((f) => f.status)).toEqual([
      'uploaded',
      'uploaded',
      'uploaded',
    ]);

    const sent = await sendReport({
      ...spine(email),
      logbook: lb.slug,
      answers: { what: 'Queue turned away' },
      draft_token: draft,
    });
    expect(sent.statusCode).toBe(200);
    const token = tokenFor(h.mailer, email) ?? '';

    // Confirming before the worker has run waits, and files nothing.
    const early = await confirm(token);
    expect(early.just_confirmed).toBe(false);
    expect(early.confirmation).toMatchObject({ state: 'preparing' });
    expect(
      await h.db
        .selectFrom('report_submissions')
        .select('confirmed_at')
        .where('email', '=', email)
        .executeTakeFirst(),
    ).toMatchObject({ confirmed_at: null });

    await workOnce(h.files);
    const done = await confirm(token);
    expect(done.just_confirmed).toBe(true);
    expect(done.confirmation.state).toBe('received');
    // Said, never dropped quietly.
    expect(done.confirmation.files?.attached).toBe(2);
    expect(done.confirmation.files?.not_attached.map((f) => f.name)).toEqual(['fake.png']);
    expect(done.confirmation.files?.not_attached[0]?.reason).toMatch(/not a photo/);

    const ref = done.confirmation.public_ref ?? '';
    const report = await h.db
      .selectFrom('reports')
      .selectAll()
      .where('public_ref', '=', ref)
      .executeTakeFirstOrThrow();
    const links = await h.db
      .selectFrom('report_attachments as ra')
      .innerJoin('attachments as a', 'a.id', 'ra.attachment_id')
      .select(['a.ordinal', 'a.sha256', 'a.media_type', 'a.byte_size'])
      .where('ra.report_id', '=', report.id)
      .orderBy('a.ordinal')
      .execute();
    expect(links.map((l) => l.media_type)).toEqual(['image/jpeg', 'application/pdf']);
    expect(links.map((l) => l.ordinal)).toEqual([1, 2]);
    expect(links[0]?.byte_size).toBe(photo.length);

    const v = await verifyReport(h.db, ref);
    expect(v?.content.ok && v.link.ok).toBe(true);
    expect(v?.hashed_fields).toMatchObject({ attachments: links });

    // The key moved: one copy, on the file's head, none left on the slot.
    const slots = await h.db
      .selectFrom('upload_slots')
      .selectAll()
      .where('submission_id', 'is not', null)
      .where('promoted_at', 'is not', null)
      .execute();
    expect(slots.length).toBeGreaterThanOrEqual(2);
    expect(
      slots.every((s) => s.dek_wrapped === null && s.contact_hmac === null && s.meta_enc === null),
    ).toBe(true);
    const heads = await h.db
      .selectFrom('attachment_heads')
      .selectAll()
      .where('thread_id', '=', report.thread_id)
      .execute();
    expect(heads.map((x) => x.publication)).toEqual(['withheld', 'withheld']);
    expect(heads.every((x) => x.dek_wrapped !== null)).toBe(true);
    expect(heads[0]?.original_name).toBe('IMG_0001.jpg');
  });

  it('a report sent with no files has no attachments key at all', async () => {
    const email = address('nofiles');
    await sendReport({
      ...spine(email),
      logbook: lb.slug,
      answers: { what: 'Nothing to attach' },
      draft_token: await newDraft(),
    });
    const done = await confirm(tokenFor(h.mailer, email) ?? '');
    expect(done.confirmation.files).toBeUndefined();
    const v = await verifyReport(h.db, done.confirmation.public_ref ?? '');
    expect(v?.content.ok && v.link.ok).toBe(true);
    expect(v && 'attachments' in v.hashed_fields).toBe(false);
  });

  it('a draft token that is not one is refused while the reporter can still hear it', async () => {
    const r = await sendReport({
      ...spine(address('bad')),
      logbook: lb.slug,
      answers: { what: 'x' },
      draft_token: 'nope',
    });
    expect(r.statusCode).toBe(400);
  });

  it('files staged for one logbook never ride on a report to another', async () => {
    const email = address('other');
    const draft = await newDraft();
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: jpegWithGps(h.files.dir),
      type: 'image/jpeg',
    });
    await sendReport({
      ...spine(email),
      logbook: plain.slug,
      answers: { what: 'Elsewhere' },
      draft_token: draft,
    });
    await workOnce(h.files);
    const done = await confirm(tokenFor(h.mailer, email) ?? '');
    expect(done.just_confirmed).toBe(true);
    const v = await verifyReport(h.db, done.confirmation.public_ref ?? '');
    expect(v && 'attachments' in v.hashed_fields).toBe(false);
  });

  it('a correction carries the files, and the report still verifies', async () => {
    const email = address('correct');
    const draft = await newDraft();
    await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: jpegWithGps(h.files.dir),
      type: 'image/jpeg',
    });
    await sendReport({
      ...spine(email),
      logbook: lb.slug,
      answers: { what: 'First words' },
      draft_token: draft,
    });
    await workOnce(h.files);
    const done = await confirm(tokenFor(h.mailer, email) ?? '');
    const first = done.confirmation.public_ref ?? '';
    const { signIn, as } = await import('./identity-helpers.ts');
    const me = as(h, await signIn(h, email));
    const thread = (
      await h.db
        .selectFrom('reports')
        .select('thread_id')
        .where('public_ref', '=', first)
        .executeTakeFirstOrThrow()
    ).thread_id;
    const fixed = await me({
      method: 'POST',
      url: `/api/mine/reports/${thread}/correct`,
      payload: { answers: { what: 'Better words' }, comment: 'typo' },
    });
    expect(fixed.statusCode).toBe(200);
    const second = fixed.json<{ public_ref: string }>().public_ref;
    const a = await verifyReport(h.db, first);
    const b = await verifyReport(h.db, second);
    expect(b?.content.ok && b.link.ok).toBe(true);
    expect(b?.hashed_fields.attachments).toEqual(a?.hashed_fields.attachments);
  });
});

describe('uploads past the site password (FILING_CALLS)', () => {
  let outside: { id: number; slug: string };
  let outsideNoFiles: { id: number; slug: string };
  const locked = (r: { statusCode: number; body: string }) =>
    r.statusCode === 401 && r.body.includes('"locked"');

  beforeAll(async () => {
    outside = await launchedLogbook(h.db, QS);
    outsideNoFiles = await launchedLogbook(h.db, [WHAT]);
    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'link' })
      .where('id', 'in', [outside.id, outsideNoFiles.id])
      .execute();
    await h.db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword(randomBytes(8).toString('hex')) })
      .where('id', '=', true)
      .execute();
  });
  afterAll(async () => {
    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'closed' })
      .where('id', 'in', [outside.id, outsideNoFiles.id])
      .execute();
    await liftCurtain(h.db);
  });

  it('pass for a logbook opened outside that asks for files', async () => {
    const cfg = await h.app.inject({
      method: 'GET',
      url: `/api/uploads/config?logbook=${outside.slug}`,
    });
    expect(cfg.statusCode).toBe(200);
    const draft = await newDraft();
    expect(draft).toMatch(/^[a-f0-9]{48}$/);
    const slot = await attach(h, {
      draft,
      logbook: outside.slug,
      email: address('door'),
      body: Buffer.from([0xff, 0xd8, 0xff, 1]),
      type: 'image/jpeg',
    });
    const status = await h.app.inject({
      method: 'GET',
      url: '/api/uploads/status',
      headers: { 'x-draft-token': draft },
    });
    expect(status.statusCode).toBe(200);
    const gone = await h.app.inject({
      method: 'DELETE',
      url: `/api/uploads/${slot}`,
      headers: { 'x-draft-token': draft },
    });
    expect(gone.statusCode).toBe(200);
  });

  it('but not for a logbook that is not opened outside, nor one that does not ask for files', async () => {
    for (const slug of [lb.slug, outsideNoFiles.slug]) {
      expect(
        locked(await h.app.inject({ method: 'GET', url: `/api/uploads/config?logbook=${slug}` })),
      ).toBe(true);
      const r = await h.app.inject({
        method: 'POST',
        url: '/api/uploads',
        payload: {
          draft_token: 'a'.repeat(48),
          logbook: slug,
          email: 'x@example.org',
          name: 'a',
          type: 'image/jpeg',
          size: 4,
        },
      });
      expect(locked(r)).toBe(true);
    }
  });

  it('and nothing else of the files routes comes through with them', async () => {
    for (const url of [
      '/api/admin/files/settings',
      '/api/moderate/files/00000000-0000-4000-8000-000000000000',
      '/api/files/report/RL-X',
    ]) {
      expect(locked(await h.app.inject({ method: 'GET', url }))).toBe(true);
    }
  });

  it('with no logbook taking files outside, the draft-only calls stop passing too', async () => {
    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'closed' })
      .where('id', '=', outside.id)
      .execute();
    expect(locked(await h.app.inject({ method: 'POST', url: '/api/uploads/draft' }))).toBe(true);
    expect(
      locked(
        await h.app.inject({
          method: 'GET',
          url: '/api/uploads/status',
          headers: { 'x-draft-token': 'a'.repeat(48) },
        }),
      ),
    ).toBe(true);
    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'link' })
      .where('id', '=', outside.id)
      .execute();
  });
});
