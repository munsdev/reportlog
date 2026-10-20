/**
 * Decision 19: decision 17's drop, for the two ways files reach a report
 * without a Send. Files staged before a logbook's uploads were frozen are
 * dropped at filing for a coordinator's intake account and for an evidence
 * answer too, and the screen says which (one check, in `sealFiles`).
 *
 * Through the real routes, with real files the worker has finished: both
 * kinds are released at once, so unlike a Send's draft they are usually
 * ready by the time the freeze matters.
 */
import { cardFor } from '@reportlog/seal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequest, redeem } from '../../src/evidence/requests.ts';
import { sealContact } from '../../src/filing/contactKeys.ts';
import { FROZEN_DROP } from '../../src/files/slots.ts';
import { workOnce } from '../../src/files/worker.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { setPermission } from '../../src/permissions/log.ts';
import { filesHarness, jpegWithGps, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { RING } from './filing-helpers.ts';
import { QUESTIONS, fileReport, launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
let photo: Buffer;
const QS = [...QUESTIONS, { key: 'photos', kind: 'file', label: 'Photos' }];

beforeAll(async () => {
  h = await filesHarness();
  photo = toolsMissing ? Buffer.alloc(0) : jpegWithGps(h.files.dir);
});
afterAll(async () => {
  await h.close();
});

/** What happened to a set of slots, and whether their bytes are on their way out. */
async function dropped(where: { logbookId: number }) {
  const slots = await h.db
    .selectFrom('upload_slots')
    .select(['status', 'status_detail', 'dek_wrapped', 'promoted_at', 'staging_key', 'storage_key'])
    .where('logbook_id', '=', where.logbookId)
    .execute();
  const keys = slots.flatMap((s) => [s.staging_key, ...(s.storage_key ? [s.storage_key] : [])]);
  const queued = keys.length
    ? await h.db.selectFrom('storage_deletions').select('key').where('key', 'in', keys).execute()
    : [];
  return { slots, queued: queued.map((q) => q.key).sort(), keys: keys.sort() };
}

describe.skipIf(toolsMissing)('a coordinator files a batch after the logbook froze', () => {
  it('the account is filed without its files, which are named, refused and deleted', async () => {
    const lb = await launchedLogbook(h.db, QS);
    const email = address('freeze-coord');
    const userId = await seat(h.db, email, 'user');
    const org = await h.db
      .insertInto('organizations')
      .values({
        name: `Frozen Intake ${String(process.pid)}-${String(Date.now() % 1e6)}`,
        verified_by: 'admin@example.org',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('organization_memberships')
      .values({ organization_id: org.id, user_id: userId, role: 'coordinator' })
      .execute();
    const coord = as(h, await signIn(h, email));

    const batch = await coord({
      method: 'POST',
      url: '/api/intake/batches',
      payload: { organization_id: org.id },
    });
    const batchId = batch.json<{ id: number }>().id;
    const d = await coord({
      method: 'POST',
      url: `/api/intake/batches/${String(batchId)}/drafts`,
      payload: {},
    });
    const id = d.json<{ id: number }>().id;
    await coord({
      method: 'PUT',
      url: `/api/intake/drafts/${String(id)}`,
      payload: {
        logbook: lb.slug,
        answers: { what: 'Turned away at the door.' },
        intake_method: 'paper',
        may_publish: false,
        may_publish_digest: cardFor('coordinator').digest,
      },
    });
    const made = await coord({
      method: 'POST',
      url: `/api/intake/drafts/${String(id)}/files`,
      payload: { logbook: lb.slug, name: 'door.jpg', type: 'image/jpeg', size: photo.length },
    });
    expect(made.statusCode, made.body).toBe(200);
    const slot = made.json<{ slot_token: string }>().slot_token;
    const put = await coord({
      method: 'PUT',
      url: `/api/intake/drafts/${String(id)}/files/${slot}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: photo,
    });
    expect(put.statusCode).toBe(200);
    await workOnce(h.files);

    await L.setFilesFrozen(h.db, lb.id, true);
    const filed = await coord({
      method: 'POST',
      url: `/api/intake/batches/${String(batchId)}/submit`,
      payload: { attested: true },
    });
    expect(filed.statusCode, filed.body).toBe(200);
    const out = filed.json<{
      filed: { public_ref: string; files_dropped?: string[] }[];
    }>();
    expect(out.filed).toHaveLength(1);
    expect(out.filed[0]?.files_dropped).toEqual(['door.jpg']);

    // Filed, and nothing of the file sealed or linked.
    const report = await h.db
      .selectFrom('reports')
      .select(['id', 'thread_id'])
      .where('public_ref', '=', out.filed[0]?.public_ref ?? '')
      .executeTakeFirstOrThrow();
    const links = await h.db
      .selectFrom('report_attachments')
      .select('attachment_id')
      .where('report_id', '=', report.id)
      .execute();
    expect(links).toEqual([]);

    const after = await dropped({ logbookId: lb.id });
    expect(after.slots).toEqual([
      expect.objectContaining({
        status: 'rejected',
        status_detail: FROZEN_DROP,
        dek_wrapped: null,
        promoted_at: null,
      }),
    ]);
    // The staged bytes and the finished original both leave storage.
    expect(after.queued).toEqual(after.keys);
    // And the moderators' record says a file was sent and not kept (decision 32).
    const noted = await h.db
      .selectFrom('refused_uploads')
      .select(['name', 'status', 'reason'])
      .where('thread_id', '=', report.thread_id)
      .execute();
    expect(noted).toEqual([{ name: 'door.jpg', status: 'rejected', reason: FROZEN_DROP }]);
  });
});

describe.skipIf(toolsMissing)('a reporter answers an evidence request after the logbook froze', () => {
  async function asked() {
    const lb = await launchedLogbook(h.db, QS);
    const { row } = await fileReport(h.db, lb, { what: 'Queue at six.', has: 'yes', of: 'a photo' });
    await h.db
      .insertInto('report_heads')
      .values({ thread_id: row.thread_id, current_report_id: row.id })
      .execute();
    await h.db.transaction().execute((trx) =>
      sealContact(trx, RING, {
        threadId: row.thread_id,
        email: address('freeze-rep'),
        filedBy: 'reporter',
      }),
    );
    await setPermission(h.db, {
      threadId: row.thread_id,
      permission: 'evidence_request',
      granted: true,
    });
    const ask = await createRequest(h.db, row.thread_id, {
      message: 'Could you send the photo you mentioned?',
      by: 'mod@example.org',
    });
    if (!ask.ok) throw new Error(ask.reason);
    const slot = await h.app.inject({
      method: 'POST',
      url: `/api/evidence/${ask.token}/files`,
      payload: { name: 'queue.jpg', type: 'image/jpeg', size: photo.length },
    });
    expect(slot.statusCode).toBe(200);
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/evidence/${ask.token}/files/${slot.json<{ slot_token: string }>().slot_token}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: photo,
    });
    expect(put.statusCode).toBe(200);
    await workOnce(h.files);
    return { lb, row, token: ask.token, requestId: ask.request.id };
  }

  it('nothing is added, the reporter is told which files, and the link is not spent', async () => {
    const { lb, row, token, requestId } = await asked();
    await L.setFilesFrozen(h.db, lb.id, true);

    const sent = await h.app.inject({ method: 'POST', url: `/api/evidence/${token}/send` });
    expect(sent.statusCode).toBe(409);
    expect(sent.json<{ error: { code: string; message: string } }>().error).toEqual({
      code: 'files_frozen',
      message:
        'This logbook stopped taking files before you sent this one, so it was not kept: queue.jpg. Nothing was added to your report.',
    });

    // No new version: the report's head is still the one asked about.
    const head = await h.db
      .selectFrom('report_heads')
      .select('current_report_id')
      .where('thread_id', '=', row.thread_id)
      .executeTakeFirstOrThrow();
    expect(head.current_report_id).toBe(row.id);
    // Not spent by an answer that added nothing.
    const req = await h.db
      .selectFrom('evidence_requests')
      .select(['used_at', 'used_report_id'])
      .where('id', '=', requestId)
      .executeTakeFirstOrThrow();
    expect(req).toEqual({ used_at: null, used_report_id: null });
    expect((await redeem(h.db, token)).ok).toBe(true);

    // The drop stands, and the bytes go.
    const after = await dropped({ logbookId: lb.id });
    expect(after.slots).toEqual([
      expect.objectContaining({ status: 'rejected', status_detail: FROZEN_DROP, dek_wrapped: null }),
    ]);
    expect(after.queued).toEqual(after.keys);

    // Sending again finds nothing to send, rather than the dropped file.
    const again = await h.app.inject({ method: 'POST', url: `/api/evidence/${token}/send` });
    expect(again.statusCode).toBe(400);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('nothing_sent');
  });

  it('a logbook that is not frozen takes the answer as before', async () => {
    const { token } = await asked();
    const sent = await h.app.inject({ method: 'POST', url: `/api/evidence/${token}/send` });
    expect(sent.statusCode).toBe(200);
    expect(sent.json<{ attached: number }>().attached).toBe(1);
  });
});
