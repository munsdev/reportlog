/**
 * Asking a reporter for evidence, against a real database.
 *
 * Ports legacy `evidence-request-selftest` check for check, the permission
 * half of `evidence-caps-selftest`, and then walks the door through the real
 * routes with a link read out of the email the reporter was sent.
 *
 * THE THREE GATES ARE THE WHOLE POINT: a report that DECLARED something, a
 * reporter who GRANTED the permission, and a link that stops working when it
 * is spent, expires, is withdrawn, and above all WHEN THE REPORTER TAKES THE
 * PERMISSION BACK.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import {
  askableState,
  attachEvidence,
  cancelRequest,
  createRequest,
  markLanded,
  markUsed,
  openRequestFor,
  redeem,
  requestHistory,
} from '../../src/evidence/requests.ts';
import {
  PERMISSIONS,
  isPermission,
  NONE_GRANTED,
  setPermission,
} from '../../src/permissions/log.ts';
import { workOnce } from '../../src/files/worker.ts';
import { filesHarness, jpegWithGps, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { QUESTIONS, fileReport, launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';
import { RING } from './filing-helpers.ts';
import { sealContact } from '../../src/filing/contactKeys.ts';

let h: FilesHarness;
let lb: { id: number; slug: string };
const BY = 'mod@example.org';

/** A report filed and headed, as confirmation leaves one, with an address under its key. */
async function filed(answers: Record<string, unknown>, email = address('rep')) {
  const { row } = await fileReport(h.db, lb, answers);
  await h.db
    .insertInto('report_heads')
    .values({ thread_id: row.thread_id, current_report_id: row.id })
    .execute();
  await h.db
    .transaction()
    .execute((trx) =>
      sealContact(trx, RING, { threadId: row.thread_id, email, filedBy: 'reporter' }),
    );
  return { threadId: row.thread_id, report: row, email };
}
const grant = (threadId: string, granted: boolean) =>
  setPermission(h.db, { threadId, permission: 'evidence_request', granted });

beforeAll(async () => {
  h = await filesHarness();
  lb = await launchedLogbook(h.db, [
    ...QUESTIONS,
    { key: 'photos', kind: 'file', label: 'Photos' },
  ]);
});
afterAll(async () => {
  await h.close();
});

describe('the third permission, and that the declaration is not one (evidence-caps)', () => {
  it('evidence_request is a permission, not granted until somebody grants it', () => {
    expect(isPermission('evidence_request')).toBe(true);
    expect(NONE_GRANTED.evidence_request).toBe(false);
  });

  it('what a reporter said they had is NOT a permission: it is a sealed answer', () => {
    expect(isPermission('has_evidence')).toBe(false);
    expect(isPermission('evidence_declaration')).toBe(false);
  });

  it('the log admits all three, and still only the reporter writes it', async () => {
    const defs = await sql<{ conname: string; def: string }>`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'report_permissions_log'::regclass AND contype = 'c'`.execute(h.db);
    const all = defs.rows.map((r) => r.def).join('\n');
    for (const p of PERMISSIONS) expect(all).toMatch(new RegExp(`\\b${p}\\b`));
    expect(all).toMatch(/actor = 'reporter'/);
  });
});

describe('who may be asked', () => {
  it('declared but not granted: refused, and the moderator is told WHICH half is missing', async () => {
    const d = await filed({
      what: 'A long queue outside.',
      has: 'yes',
      of: 'thirty seconds of it',
    });
    const s = await askableState(h.db, d.threadId);
    expect(s).toMatchObject({
      ok: false,
      reason: 'not-permitted',
      declared: true,
      permitted: false,
    });
  });

  it('granted but declared nothing: refused too. The permission is not an open channel', async () => {
    const d = await filed({ what: 'A long queue outside.' });
    await grant(d.threadId, true);
    expect(await askableState(h.db, d.threadId)).toMatchObject({
      ok: false,
      reason: 'nothing-declared',
    });
  });

  it('BOTH HALVES TRUE, and now it can be asked', async () => {
    const d = await filed({ what: 'x', has: 'yes' });
    await grant(d.threadId, true);
    expect((await askableState(h.db, d.threadId)).ok).toBe(true);
  });
});

describe('asking, the door, and spending it', () => {
  let d: Awaited<ReturnType<typeof filed>>;
  let token: string;
  let requestId: number;

  beforeAll(async () => {
    d = await filed({ what: 'A long queue outside.', has: 'yes', of: '30s of the queue' });
    await grant(d.threadId, true);
  });

  it('a request with no words is refused; a real one hands back its token once, stored only as a hash', async () => {
    expect(await createRequest(h.db, d.threadId, { message: 'x', by: BY })).toEqual({
      ok: false,
      reason: 'message-short',
    });
    const out = await createRequest(h.db, d.threadId, {
      message: 'Could you send the thirty seconds of the queue you mentioned?',
      by: BY,
    });
    if (!out.ok) throw new Error(out.reason);
    token = out.token;
    requestId = out.request.id;
    expect(token).toMatch(/^[a-f0-9]{48}$/);
    const row = await h.db
      .selectFrom('evidence_requests')
      .selectAll()
      .where('id', '=', requestId)
      .executeTakeFirstOrThrow();
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.asked_by).toBe(BY);
  });

  it('ONE LIVE REQUEST PER REPORT', async () => {
    expect(
      await createRequest(h.db, d.threadId, { message: 'And anything else you have.', by: BY }),
    ).toEqual({ ok: false, reason: 'already-open' });
  });

  it('the link opens, with the moderator’s words and which report, and nothing more', async () => {
    const r = await redeem(h.db, token);
    if (!r.ok) throw new Error(r.reason);
    expect(r.request.message).toMatch(/thirty seconds/);
    expect(r.request.threadId).toBe(d.threadId);
    expect(await redeem(h.db, 'nope')).toEqual({ ok: false, reason: 'bad-token' });
    expect(await redeem(h.db, 'a'.repeat(48))).toEqual({ ok: false, reason: 'not-found' });
  });

  it('TAKING THE PERMISSION BACK CLOSES A LINK ALREADY SENT, and giving it again reopens it', async () => {
    await grant(d.threadId, false);
    expect(await redeem(h.db, token)).toEqual({ ok: false, reason: 'permission-withdrawn' });
    await grant(d.threadId, true);
    expect((await redeem(h.db, token)).ok).toBe(true);
  });

  it('the first use wins AND THE SECOND LOSES, so two presses cannot both make a version', async () => {
    const [first, second] = await h.db
      .transaction()
      .execute(async (trx) => [
        await markUsed(trx, { requestId, reportId: d.report.id }),
        await markUsed(trx, { requestId, reportId: d.report.id }),
      ]);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await redeem(h.db, token)).toEqual({ ok: false, reason: 'used' });
  });

  it('withdrawing an ask stops its link; an anonymous withdrawal is refused; every ask stays on the record', async () => {
    const again = await createRequest(h.db, d.threadId, {
      message: 'Sorry, one more thing if you can.',
      by: BY,
    });
    if (!again.ok) throw new Error(again.reason);
    expect(await cancelRequest(h.db, d.threadId, { by: BY })).toEqual({ ok: true, cancelled: 1 });
    expect(await redeem(h.db, again.token)).toEqual({ ok: false, reason: 'cancelled' });
    expect(await cancelRequest(h.db, d.threadId, { by: null })).toEqual({
      ok: false,
      reason: 'no-actor',
    });
    const history = await requestHistory(h.db, d.threadId);
    expect(history.length).toBe(2);
    expect(history.some((x) => x.used_at) && history.some((x) => x.cancelled_at)).toBe(true);
    expect(history.every((x) => !('token_hash' in x))).toBe(true);
  });

  it('an expired link does not open, and AN EXPIRED ASK DOES NOT LOCK THE REPORT', async () => {
    const old = await createRequest(h.db, d.threadId, {
      message: 'This one will be aged out.',
      by: BY,
    });
    if (!old.ok) throw new Error(old.reason);
    await h.db
      .updateTable('evidence_requests')
      .set({ expires_at: new Date(Date.now() - 86_400_000) })
      .where('id', '=', old.request.id)
      .execute();
    expect(await redeem(h.db, old.token)).toEqual({ ok: false, reason: 'expired' });
    expect(await openRequestFor(h.db, d.threadId)).toBeNull();
    const next = await createRequest(h.db, d.threadId, {
      message: 'And this is the next ask.',
      by: BY,
    });
    expect(next.ok).toBe(true);
    const stamped = await h.db
      .selectFrom('evidence_requests')
      .select('expired_at')
      .where('id', '=', old.request.id)
      .executeTakeFirstOrThrow();
    expect(stamped.expired_at).not.toBeNull();
    await cancelRequest(h.db, d.threadId, { by: BY });
  });

  it('A LINK TO A WITHDRAWN REPORT DOES NOT OPEN, and works again if it is restored', async () => {
    const ask = await createRequest(h.db, d.threadId, {
      message: 'Asked just before a withdrawal.',
      by: BY,
    });
    if (!ask.ok) throw new Error(ask.reason);
    await h.db
      .updateTable('report_heads')
      .set({ withdrawn: true })
      .where('thread_id', '=', d.threadId)
      .execute();
    expect(await redeem(h.db, ask.token)).toEqual({ ok: false, reason: 'report-withdrawn' });
    await h.db
      .updateTable('report_heads')
      .set({ withdrawn: false })
      .where('thread_id', '=', d.threadId)
      .execute();
    expect((await redeem(h.db, ask.token)).ok).toBe(true);
    await cancelRequest(h.db, d.threadId, { by: BY });
  });
});

describe('what the reporter sends becomes a version of the report', () => {
  it('THE ANSWERS ARE CARRIED FORWARD BYTE FOR BYTE; the files land on the new version', async () => {
    const d = await filed({
      what: 'They turned the queue away at six.',
      has: 'yes',
      of: 'Thirty seconds of the queue',
    });
    await grant(d.threadId, true);
    const asked = await createRequest(h.db, d.threadId, {
      message: 'Could you send the thirty seconds?',
      by: BY,
    });
    if (!asked.ok) throw new Error(asked.reason);
    // A finished file, written directly: what is under test is the version,
    // not the worker (files-worker.test.ts) or the route (below).
    await h.db
      .insertInto('upload_slots')
      .values({
        slot_token: 'b'.repeat(48),
        evidence_request_id: asked.request.id,
        logbook_id: lb.id,
        declared_name: 'clip.mp4',
        declared_type: 'video/mp4',
        declared_size: 1024,
        staging_key: `staging/${'c'.repeat(32)}`,
        expires_at: new Date(Date.now() + 86_400_000),
        released_at: new Date(),
        status: 'clean',
        media_type: 'video/mp4',
        byte_size: 1024,
        sha256: 'e'.repeat(64),
        storage_key: `evidence/${'d'.repeat(32)}`,
        rendition_media_type: 'video/mp4',
        dek_wrapped: Buffer.alloc(60, 1),
      })
      .execute();

    const done = await h.db.transaction().execute(async (trx) => {
      expect(await markUsed(trx, { requestId: asked.request.id, reportId: d.report.id })).toBe(
        true,
      );
      const out = await attachEvidence(trx, {
        threadId: d.threadId,
        requestId: asked.request.id,
        publicRefPrefix: 'RL-',
      });
      if (!out.ok) throw new Error(out.reason);
      await markLanded(trx, { requestId: asked.request.id, reportId: out.report.id });
      return out;
    });
    expect(done.report.corrects_id).toBe(d.report.id);
    expect(JSON.stringify(done.report.answers)).toBe(JSON.stringify(d.report.answers));
    expect(done.report.content_hash).not.toBe(d.report.content_hash);
    const head = await h.db
      .selectFrom('report_heads')
      .select('current_report_id')
      .where('thread_id', '=', d.threadId)
      .executeTakeFirstOrThrow();
    expect(head.current_report_id).toBe(done.report.id);
    const links = await h.db
      .selectFrom('report_attachments')
      .select('attachment_id')
      .where('report_id', '=', done.report.id)
      .execute();
    expect(links.length).toBe(1);
    const spent = await h.db
      .selectFrom('evidence_requests')
      .selectAll()
      .where('id', '=', asked.request.id)
      .executeTakeFirstOrThrow();
    expect(spent.used_at).not.toBeNull();
    // The version the files LANDED on, not the one asked about.
    expect(spent.used_report_id).toBe(done.report.id);
    expect(await redeem(h.db, asked.token)).toEqual({ ok: false, reason: 'used' });
    const v = await verifyReport(h.db, done.report.public_ref);
    expect(v?.content.ok && v.link.ok).toBe(true);
  });
});

describe.skipIf(toolsMissing)('the door, through the routes, from the email', () => {
  it('a moderator asks; the reporter follows the emailed link, sends a photo, and it lands', async () => {
    const d = await filed({ what: 'Queue at six.', has: 'yes', of: 'a photo' });
    const modEmail = address('mod');
    await seat(h.db, modEmail, 'moderator');
    const mod = as(h, await signIn(h, modEmail));

    // Not askable until the reporter allows it.
    let state = await mod({ method: 'GET', url: `/api/moderate/evidence/${d.threadId}` });
    expect(state.json()).toMatchObject({ askable: false, declared: true, permitted: false });
    expect(
      (
        await mod({
          method: 'POST',
          url: `/api/moderate/evidence/${d.threadId}`,
          payload: { message: 'Could you send the photo?' },
        })
      ).statusCode,
    ).toBe(400);

    await grant(d.threadId, true);
    state = await mod({ method: 'GET', url: `/api/moderate/evidence/${d.threadId}` });
    expect(state.json()).toMatchObject({ askable: true });
    const ask = await mod({
      method: 'POST',
      url: `/api/moderate/evidence/${d.threadId}`,
      payload: { message: 'Could you send the photo you mentioned?' },
    });
    expect(ask.statusCode).toBe(200);

    const mail = h.mailer.lastTo(d.email);
    expect(mail?.text).toContain('Could you send the photo you mentioned?');
    const token = /\/evidence\/([a-f0-9]{48})\b/.exec(mail?.text ?? '')?.[1] ?? '';
    // The email names the reference and never who asked.
    expect(mail?.text).not.toContain(modEmail);

    const door = await h.app.inject({ method: 'GET', url: `/api/evidence/${token}` });
    expect(door.statusCode).toBe(200);
    expect(door.json()).toMatchObject({
      message: 'Could you send the photo you mentioned?',
      uploads: { enabled: true },
    });
    // Nothing of the report's words is on the door.
    expect(door.body).not.toContain('Queue at six');

    const photo = jpegWithGps(h.files.dir);
    const slot = await h.app.inject({
      method: 'POST',
      url: `/api/evidence/${token}/files`,
      payload: { name: 'queue.jpg', type: 'image/jpeg', size: photo.length },
    });
    expect(slot.statusCode).toBe(200);
    const slotToken = slot.json<{ slot_token: string }>().slot_token;
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/evidence/${token}/files/${slotToken}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: photo,
    });
    expect(put.statusCode).toBe(200);
    // Released when made: the worker takes it at once.
    await workOnce(h.files);
    const files = await h.app.inject({ method: 'GET', url: `/api/evidence/${token}/files` });
    expect(files.json()).toMatchObject({ files: [{ name: 'queue.jpg', status: 'clean' }] });

    const sent = await h.app.inject({ method: 'POST', url: `/api/evidence/${token}/send` });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ attached: 1 });
    const v = await verifyReport(h.db, sent.json<{ public_ref: string }>().public_ref);
    expect(v?.content.ok && v.link.ok).toBe(true);
    expect((v?.hashed_fields.attachments as unknown[]).length).toBe(1);

    // Spent: a stranger with the link learns nothing more.
    const again = await h.app.inject({ method: 'GET', url: `/api/evidence/${token}` });
    expect(again.statusCode).toBe(410);
    expect(again.body).toMatch(/no longer open/);
  });

  it('a reporter who switched asking off is told so, plainly, because it is their switch', async () => {
    const d = await filed({ what: 'x', has: 'yes' });
    await grant(d.threadId, true);
    const out = await createRequest(h.db, d.threadId, {
      message: 'Could you send it please?',
      by: BY,
    });
    if (!out.ok) throw new Error(out.reason);
    await grant(d.threadId, false);
    const r = await h.app.inject({ method: 'GET', url: `/api/evidence/${out.token}` });
    expect(r.statusCode).toBe(410);
    expect(r.body).toMatch(/switched off being asked/);
  });

  it('nothing finished: nothing sent, and the link is not spent', async () => {
    const d = await filed({ what: 'x', has: 'yes' });
    await grant(d.threadId, true);
    const out = await createRequest(h.db, d.threadId, {
      message: 'Could you send it please?',
      by: BY,
    });
    if (!out.ok) throw new Error(out.reason);
    const r = await h.app.inject({ method: 'POST', url: `/api/evidence/${out.token}/send` });
    expect(r.statusCode).toBe(400);
    expect((await redeem(h.db, out.token)).ok).toBe(true);
  });
});
