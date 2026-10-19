/**
 * Files in a coordinator's intake account, end to end through the routes:
 * attach, prepare, review, file.
 *
 * New here (legacy intake took no files). What is proved is the join between
 * F's files and C's intake: the account is the owner, nobody else's draft
 * token or session reaches it, the review holds an account back while a
 * file is not ready (never filing it without one the coordinator watched
 * upload), and filing seals EXACTLY the account's finished files into the
 * report through appendReportVersion, linked in the same transaction.
 */
import { cardFor } from '@reportlog/seal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { accountDraft } from '../../src/filing/intakeFiles.ts';
import { workOnce } from '../../src/files/worker.ts';
import { filesHarness, jpegWithGps, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
let lb: { id: number; slug: string };
let needsFile: { id: number; slug: string };
let plain: { id: number; slug: string };
let orgId: number;
let coord: ReturnType<typeof as>;
let other: ReturnType<typeof as>;
let photo: Buffer;
const CARD = cardFor('coordinator').digest;
const ORG = `Files Abroad ${String(process.pid)}-${String(Date.now() % 1e6)}`;

const WHAT = { key: 'what', kind: 'long_text', label: 'What happened?', required: true };

const call = async (
  who: ReturnType<typeof as>,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
) => {
  const r = await who({ method, url, ...(body ? { payload: body } : {}) });
  return { status: r.statusCode, body: r.json<Record<string, unknown>>() };
};

const complete = (logbook: string) => ({
  logbook,
  answers: { what: 'Turned away at the door.' },
  intake_method: 'paper',
  may_publish: false,
  may_publish_digest: CARD,
});

/** A batch with one complete account in it. */
async function account(logbook = lb.slug) {
  const batch = await call(coord, 'POST', '/api/intake/batches', { organization_id: orgId });
  const batchId = Number(batch.body.id);
  const d = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/drafts`, {});
  const id = Number(d.body.id);
  await call(coord, 'PUT', `/api/intake/drafts/${String(id)}`, complete(logbook));
  return { batchId, id };
}

/** Attach one file to an account through the routes, as the dialog does. */
async function attach(
  who: ReturnType<typeof as>,
  id: number,
  body: Buffer,
  opts: { type?: string; name?: string; logbook?: string } = {},
) {
  const made = await who({
    method: 'POST',
    url: `/api/intake/drafts/${String(id)}/files`,
    payload: {
      logbook: opts.logbook ?? lb.slug,
      name: opts.name ?? 'photo.jpg',
      type: opts.type ?? 'image/jpeg',
      size: body.length,
    },
  });
  if (made.statusCode !== 200) return { status: made.statusCode, slot: '', made };
  const slot = made.json<{ slot_token: string }>().slot_token;
  const put = await who({
    method: 'PUT',
    url: `/api/intake/drafts/${String(id)}/files/${slot}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: body,
  });
  return { status: put.statusCode, slot, made };
}

const problemsOf = async (batchId: number, id: number) => {
  const r = await call(coord, 'GET', `/api/intake/batches/${String(batchId)}/review`);
  const entries = r.body.entries as { id: number; problems: string[] }[];
  return entries.find((e) => e.id === id)?.problems ?? [];
};

beforeAll(async () => {
  h = await filesHarness();
  lb = await launchedLogbook(h.db, [WHAT, { key: 'photos', kind: 'file', label: 'Photos' }]);
  needsFile = await launchedLogbook(h.db, [
    WHAT,
    { key: 'photos', kind: 'file', label: 'Photos', required: true },
  ]);
  plain = await launchedLogbook(h.db, [WHAT]);
  const email = address('files-coord');
  const userId = await seat(h.db, email, 'user');
  const org = await h.db
    .insertInto('organizations')
    .values({ name: ORG, verified_by: 'admin@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  orgId = org.id;
  await h.db
    .insertInto('organization_memberships')
    .values({ organization_id: orgId, user_id: userId, role: 'coordinator' })
    .execute();
  coord = as(h, await signIn(h, email));
  // A coordinator of the same organization, but not this batch's.
  const otherEmail = address('files-other');
  const otherId = await seat(h.db, otherEmail, 'user');
  await h.db
    .insertInto('organization_memberships')
    .values({ organization_id: orgId, user_id: otherId, role: 'coordinator' })
    .execute();
  other = as(h, await signIn(h, otherEmail));
  photo = toolsMissing ? Buffer.alloc(0) : jpegWithGps(h.files.dir);
});
afterAll(async () => {
  await h.close();
});

describe('attaching files to an account', () => {
  it.skipIf(toolsMissing)(
    'a photo is staged against the account: no address, released at once, kept for weeks',
    async () => {
      const { id } = await account();
      const sent = await attach(coord, id, photo);
      expect(sent.status).toBe(200);
      const slot = await h.db
        .selectFrom('upload_slots')
        .selectAll()
        .where('slot_token', '=', sent.slot)
        .executeTakeFirstOrThrow();
      expect(slot.draft_hash).toBe(accountDraft(id));
      expect(slot.contact_hmac).toBeNull();
      expect(slot.released_at).not.toBeNull();
      expect(slot.expires_at.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      const listed = await call(coord, 'GET', `/api/intake/drafts/${String(id)}/files`);
      expect(listed.body.files).toEqual([
        {
          slot_token: sent.slot,
          name: 'photo.jpg',
          size: photo.length,
          status: 'uploaded',
          detail: null,
        },
      ]);
    },
  );

  it.skipIf(toolsMissing)(
    'nobody else reaches it: not another coordinator, not the public upload routes',
    async () => {
      const { id } = await account();
      const sent = await attach(coord, id, photo);
      expect((await call(other, 'GET', `/api/intake/drafts/${String(id)}/files`)).status).toBe(404);
      expect((await attach(other, id, photo)).status).toBe(404);
      expect(
        (await call(other, 'DELETE', `/api/intake/drafts/${String(id)}/files/${sent.slot}`)).status,
      ).toBe(404);
      // The public routes take a draft token, and no token hashes to an account.
      const asPublic = await h.app.inject({
        method: 'DELETE',
        url: `/api/uploads/${sent.slot}`,
        headers: { 'x-draft-token': 'a'.repeat(48) },
      });
      expect(asPublic.statusCode).toBe(404);
      // Nor somebody not signed in.
      const anon = await h.app.inject({
        method: 'PUT',
        url: `/api/intake/drafts/${String(id)}/files/${sent.slot}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: photo,
      });
      expect(anon.statusCode).toBe(401);
    },
  );

  it('a logbook that does not take files is refused, and so is attaching with no logbook', async () => {
    const { id } = await account(plain.slug);
    const r = await attach(coord, id, Buffer.from('x'), { logbook: plain.slug });
    expect(r.status).toBe(400);
    expect(r.made.json<{ error: { code: string } }>().error.code).toBe('no_files_here');
    const none = await attach(coord, id, Buffer.from('x'), { logbook: '' });
    expect(none.made.json<{ error: { message: string } }>().error.message).toMatch(
      /Choose the logbook/,
    );
  });

  it('removing the account withdraws its files', async () => {
    const { id } = await account();
    const sent = await attach(coord, id, Buffer.from('not really a photo'));
    expect(sent.status).toBe(200);
    expect((await call(coord, 'DELETE', `/api/intake/drafts/${String(id)}`)).status).toBe(200);
    const slot = await h.db
      .selectFrom('upload_slots')
      .select(['status', 'dek_wrapped'])
      .where('slot_token', '=', sent.slot)
      .executeTakeFirstOrThrow();
    expect(slot).toEqual({ status: 'withdrawn', dek_wrapped: null });
  });
});

describe('reviewing and filing', () => {
  it.skipIf(toolsMissing)(
    'an account waits while a file is prepared, then files with exactly its files sealed',
    async () => {
      const { batchId, id } = await account();
      const sent = await attach(coord, id, photo, { name: 'IMG_0042.jpg' });
      expect(sent.status).toBe(200);
      // Before the worker: held back, and said why.
      expect(await problemsOf(batchId, id)).toEqual([
        '“IMG_0042.jpg” is still being prepared: look again in a minute',
      ]);
      const early = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/submit`, {
        attested: true,
      });
      expect(early.body).toMatchObject({ filed: [], still_staged: 1 });

      await workOnce(h.files);
      expect(await problemsOf(batchId, id)).toEqual([]);
      const done = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/submit`, {
        attested: true,
      });
      const filed = done.body.filed as { public_ref: string }[];
      expect(filed).toHaveLength(1);
      const ref = filed[0]?.public_ref ?? '';

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
        .execute();
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ ordinal: 1, media_type: 'image/jpeg' });
      expect(links[0]?.byte_size).toBe(photo.length);
      const v = await verifyReport(h.db, ref);
      expect(v?.content.ok && v.link.ok).toBe(true);
      expect(v?.hashed_fields).toMatchObject({ third_party: true, attachments: links });

      // The key moved to the file's head; the slot keeps none.
      const slot = await h.db
        .selectFrom('upload_slots')
        .selectAll()
        .where('slot_token', '=', sent.slot)
        .executeTakeFirstOrThrow();
      expect(slot.promoted_at).not.toBeNull();
      expect(slot.dek_wrapped).toBeNull();
      const heads = await h.db
        .selectFrom('attachment_heads')
        .selectAll()
        .where('thread_id', '=', report.thread_id)
        .execute();
      expect(heads.map((x) => [x.publication, x.original_name])).toEqual([
        ['withheld', 'IMG_0042.jpg'],
      ]);

      // A filed account's files can no longer change.
      expect((await attach(coord, id, photo)).status).toBe(409);
      expect(
        (await call(coord, 'DELETE', `/api/intake/drafts/${String(id)}/files/${sent.slot}`)).status,
      ).toBe(409);
    },
  );

  it.skipIf(toolsMissing)(
    'a file that was not accepted holds the account back until it is removed',
    async () => {
      const { batchId, id } = await account();
      const fake = await attach(coord, id, Buffer.from('this is not a picture at all'), {
        name: 'fake.jpg',
      });
      expect(fake.status).toBe(200);
      await workOnce(h.files);
      const problems = await problemsOf(batchId, id);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(
        /^“fake\.jpg” was not accepted .*: remove it to file the account without it$/,
      );
      expect(
        (await call(coord, 'DELETE', `/api/intake/drafts/${String(id)}/files/${fake.slot}`)).status,
      ).toBe(200);
      expect(await problemsOf(batchId, id)).toEqual([]);
      const done = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/submit`, {
        attested: true,
      });
      const ref = (done.body.filed as { public_ref: string }[])[0]?.public_ref ?? '';
      const v = await verifyReport(h.db, ref);
      // Filed without it: no attachments key at all.
      expect(v && 'attachments' in v.hashed_fields).toBe(false);
    },
  );

  it('a required upload question needs a file; files attached for another logbook are named', async () => {
    const { batchId, id } = await account(needsFile.slug);
    expect(await problemsOf(batchId, id)).toEqual(['needs at least one file']);
    // Attached while the dialog named one logbook, then saved under another.
    const second = await account();
    const sent = await attach(coord, second.id, Buffer.from('bytes'), { logbook: lb.slug });
    expect(sent.status).toBe(200);
    await call(coord, 'PUT', `/api/intake/drafts/${String(second.id)}`, complete(needsFile.slug));
    expect(await problemsOf(second.batchId, second.id)).toEqual([
      '“photo.jpg” was attached for another logbook: remove it, or attach it again',
      'needs at least one file',
    ]);
  });
});
