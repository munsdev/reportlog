/**
 * Upload slots: whose staging it is, and when the worker may touch it.
 *
 * Ports the upload half of legacy `intake-hardening-selftest` (the filing
 * half is C's), and the half of `evidence-caps-selftest` about which
 * logbook's caps apply. What needs Postgres: the staging quota is a sum
 * across every draft one address has open, and "nothing is worked on before
 * Send" is a property of the worker's own claim query run against real rows.
 */
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFormVersion } from '../../src/chain/forms.ts';
import { questionsFor } from '../../src/chain/questions.ts';
import type { Database } from '../../src/db/database.ts';
import type { Files } from '../../src/files/context.ts';
import { OVERHEAD } from '../../src/files/envelope.ts';
import { setLogbookLimits } from '../../src/files/limits.ts';
import {
  clearedSlots,
  createUploadSlot,
  discardSlot,
  draftHash,
  inFlightSlots,
  newDraftToken,
  receiveUpload,
  releaseDraft,
} from '../../src/files/slots.ts';
import type { Owner } from '../../src/files/slots.ts';
import { CONFIRM_WAIT_MS, STALE_MINUTES } from '../../src/files/worker.ts';
import { readAll } from '../../src/files/storage.ts';
import { HttpError } from '../../src/http/errors.ts';
import { sha256Hex } from '../../src/identity/secrets.ts';
import { filesFor, removeDir } from './files-helpers.ts';
import type { FieldDefinition } from '@reportlog/fields';
import { fileReport, launchedLogbook, testDatabase } from './helpers.ts';

const MB = 1024 * 1024;
const JPEG = 'image/jpeg';
let db: Database;
let files: Files & { dir: string };
let lb: { id: number; slug: string };
let loose: { id: number; slug: string };

const QS = [
  { key: 'what', kind: 'long_text', label: 'What happened', required: true },
  { key: 'photos', kind: 'file', label: 'Photos' },
];
const draft = (): Owner => ({ draft: draftHash(newDraftToken()) });
const slot = (owner: Owner, email: string | null, size = 1024, logbookId = lb.id, name = 'a.jpg') =>
  createUploadSlot(files, owner, { name, type: JPEG, size, logbookId, email });

async function refusal(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected a refusal');
}

/** A submission row to tie files to, as Send makes one. */
async function submission(logbookId: number) {
  const lbRow = await db
    .selectFrom('logbooks')
    .select(['id', 'slug', 'launched_at'])
    .where('id', '=', logbookId)
    .executeTakeFirstOrThrow();
  const form = await ensureFormVersion(db, lbRow, await questionsFor(db, logbookId));
  return db
    .insertInto('report_submissions')
    .values({
      token_hash: sha256Hex(newDraftToken()),
      logbook_id: logbookId,
      form_id: form.id,
      payload: JSON.stringify({ may_publish: false, may_publish_digest: 'x' }),
      email: 'someone@example.org',
      expires_at: new Date(Date.now() + 86_400_000),
    })
    .returning(['id', 'expires_at'])
    .executeTakeFirstOrThrow();
}

beforeAll(async () => {
  db = testDatabase();
  files = filesFor(db);
  lb = await launchedLogbook(db, QS);
  loose = await launchedLogbook(db, QS);
  // A small total so the quota trips without staging gigabytes, and maxFiles
  // wide so it is always the BYTE ceiling refusing, never the count.
  await setLogbookLimits(db, lb.id, { maxFiles: 50, maxTotalBytes: 2 * MB });
});
afterAll(async () => {
  await db.destroy();
  removeDir(files.dir);
});

describe('an address is required while filing, because the quota is keyed on it', () => {
  it('a slot with no address at all, or something that is not one, is refused', async () => {
    expect((await refusal(slot(draft(), null))).status).toBe(400);
    expect((await refusal(slot(draft(), 'not-an-address'))).status).toBe(400);
  });
});

describe('THE QUOTA IS ACROSS DRAFTS', () => {
  const mine = 'Reporter@Example.ORG';
  it('three reports’ worth is allowed, and the fourth draft is refused', async () => {
    expect((await slot(draft(), mine, 2 * MB)).slot_token).toMatch(/^[a-f0-9]{48}$/);
    await slot(draft(), mine, 2 * MB);
    await slot(draft(), mine, 2 * MB);
    expect((await refusal(slot(draft(), mine, 2 * MB))).status).toBe(429);
  });

  it('and the same address in different case and spacing is the same bucket', async () => {
    expect((await refusal(slot(draft(), '  reporter@example.org ', 2 * MB))).status).toBe(429);
  });

  it('another address is not held back by it', async () => {
    await slot(draft(), 'somebody-else@example.org', 2 * MB);
  });

  it('the row holds a keyed digest, never the address', async () => {
    const rows = await db
      .selectFrom('upload_slots')
      .select('contact_hmac')
      .where('contact_hmac', '=', files.ring.quotaDigest(mine))
      .execute();
    expect(rows.length).toBe(3);
    expect(rows.every((r) => !String(r.contact_hmac).includes('@'))).toBe(true);
  });

  it('a file that became part of a report no longer counts', async () => {
    await db
      .updateTable('upload_slots')
      .set({ promoted_at: new Date(), contact_hmac: null, dek_wrapped: null })
      .where('contact_hmac', '=', files.ring.quotaDigest(mine))
      .execute();
    await slot(draft(), mine, 2 * MB);
  });
});

describe('the client cannot choose which cap applies (evidence-caps)', () => {
  it('a draft remembers which logbook its files are for, and refuses another', async () => {
    const d = draft();
    await slot(d, 'caps@example.org', 1024, lb.id);
    const e = await refusal(slot(d, 'caps@example.org', 1024, loose.id));
    expect(e.status).toBe(409);
  });

  it('and the cap comes from the fixed logbook, not the request', async () => {
    await setLogbookLimits(db, lb.id, { maxFiles: 1 });
    try {
      const d = draft();
      await slot(d, 'onefile@example.org', 1024, lb.id);
      const e = await refusal(slot(d, 'onefile@example.org', 1024, lb.id));
      expect(e.message).toMatch(/takes one file/);
    } finally {
      await setLogbookLimits(db, lb.id, { maxFiles: 50 });
    }
  });

  it('a kind the logbook does not take is refused as not taken now, not as unsupported', async () => {
    await setLogbookLimits(db, loose.id, { kinds: ['video'] });
    const e = await refusal(slot(draft(), 'kind@example.org', 1024, loose.id));
    expect(e.code).toBe('kind_off');
    await setLogbookLimits(db, loose.id, { kinds: null });
    const t = await refusal(
      createUploadSlot(files, draft(), {
        name: 'x.exe',
        type: 'application/x-msdownload',
        size: 10,
        logbookId: loose.id,
        email: 'k@example.org',
      }),
    );
    expect(t.code).toBe('unsupported_type');
  });
});

describe('the bytes', () => {
  it('arrive encrypted under the file’s own key: staging never holds the plaintext', async () => {
    const d = draft();
    const body = Buffer.from(`\xff\xd8\xff${'plain words in a photo '.repeat(40)}`, 'latin1');
    const { slot_token } = await slot(d, 'bytes@example.org', body.length);
    await receiveUpload(
      files,
      d,
      slot_token,
      Readable.from([body.subarray(0, 100), body.subarray(100)]),
    );
    const row = await db
      .selectFrom('upload_slots')
      .selectAll()
      .where('slot_token', '=', slot_token)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('uploaded');
    expect(row.dek_wrapped).not.toBeNull();
    const stored = await files.storage.get('staging', row.staging_key);
    const bytes = stored ? await readAll(stored) : Buffer.alloc(0);
    expect(bytes.length).toBe(body.length + OVERHEAD);
    expect(bytes.includes('plain words')).toBe(false);
  });

  it('more or fewer bytes than declared keeps nothing', async () => {
    const d = draft();
    const { slot_token } = await slot(d, 'bytes@example.org', 10);
    await expect(
      receiveUpload(files, d, slot_token, Readable.from([Buffer.alloc(11)])),
    ).rejects.toThrow(/larger/);
    await expect(
      receiveUpload(files, d, slot_token, Readable.from([Buffer.alloc(9)])),
    ).rejects.toThrow(/cut short/);
    const row = await db
      .selectFrom('upload_slots')
      .selectAll()
      .where('slot_token', '=', slot_token)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
    expect(row.dek_wrapped).toBeNull();
    expect(await files.storage.head('staging', row.staging_key)).toBeNull();
  });

  it('another draft cannot send bytes to, or remove, somebody else’s slot', async () => {
    const d = draft();
    const { slot_token } = await slot(d, 'mine@example.org', 4);
    expect(
      (await refusal(receiveUpload(files, draft(), slot_token, Readable.from([Buffer.alloc(4)]))))
        .status,
    ).toBe(404);
    expect(await discardSlot(db, draft(), slot_token)).toBe(false);
    expect(await discardSlot(db, d, slot_token)).toBe(true);
  });
});

describe('NOTHING IS WORKED ON BEFORE SEND', () => {
  // The worker's claim, as a query over real rows.
  const claimable = (draftHashValue: string) =>
    db
      .selectFrom('upload_slots')
      .select('slot_token')
      .where('status', '=', 'uploaded')
      .where('released_at', 'is not', null)
      .where('expires_at', '>', new Date())
      .where('draft_hash', '=', draftHashValue)
      .execute();

  it('a staged file nobody has sent is not work; Send releases it, once', async () => {
    const d = { draft: draftHash(newDraftToken()) };
    const { slot_token } = await slot(d, 'release@example.org', 4);
    await receiveUpload(files, d, slot_token, Readable.from([Buffer.alloc(4)]));
    expect(await claimable(d.draft)).toEqual([]);

    const sub = await submission(lb.id);
    expect(
      await releaseDraft(db, {
        draft: d.draft,
        submissionId: sub.id,
        logbookId: lb.id,
        expiresAt: sub.expires_at,
      }),
    ).toBe(1);
    expect((await claimable(d.draft)).map((r) => r.slot_token)).toEqual([slot_token]);

    const before = await db
      .selectFrom('upload_slots')
      .select('released_at')
      .where('slot_token', '=', slot_token)
      .executeTakeFirstOrThrow();
    expect(
      await releaseDraft(db, {
        draft: d.draft,
        submissionId: sub.id,
        logbookId: lb.id,
        expiresAt: sub.expires_at,
      }),
    ).toBe(0);
    const after = await db
      .selectFrom('upload_slots')
      .select('released_at')
      .where('slot_token', '=', slot_token)
      .executeTakeFirstOrThrow();
    expect(after.released_at).toEqual(before.released_at);
  });

  it('Send never takes a draft’s files into another logbook’s report', async () => {
    const d = { draft: draftHash(newDraftToken()) };
    await slot(d, 'release@example.org', 4, lb.id);
    const sub = await submission(loose.id);
    expect(
      await releaseDraft(db, {
        draft: d.draft,
        submissionId: sub.id,
        logbookId: loose.id,
        expiresAt: sub.expires_at,
      }),
    ).toBe(0);
  });

  it('an evidence-request slot needs no address and is released when made', async () => {
    const filed = await fileReport(
      db,
      lb,
      { what: 'x' },
      { questions: [QS[0] as FieldDefinition] },
    );
    const thread_id = filed.row.thread_id;
    await db
      .insertInto('report_heads')
      .values({ thread_id, current_report_id: filed.row.id })
      .execute();
    const req = await db
      .insertInto('evidence_requests')
      .values({
        thread_id,
        asked_by: 'moderator@example.org',
        message: 'Please send the photographs you mentioned.',
        token_hash: sha256Hex(newDraftToken()),
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { slot_token } = await createUploadSlot(
      files,
      { evidenceRequestId: req.id },
      { name: 'e.jpg', type: JPEG, size: 4, logbookId: lb.id },
    );
    const row = await db
      .selectFrom('upload_slots')
      .select(['contact_hmac', 'released_at'])
      .where('slot_token', '=', slot_token)
      .executeTakeFirstOrThrow();
    expect(row.contact_hmac).toBeNull();
    expect(row.released_at).not.toBeNull();
    await db
      .updateTable('upload_slots')
      .set({ status: 'withdrawn' })
      .where('slot_token', '=', slot_token)
      .execute();
    await db
      .updateTable('evidence_requests')
      .set({ cancelled_at: new Date(), cancelled_by: 'test' })
      .where('id', '=', req.id)
      .execute();
  });
});

describe('CONFIRMING MUST NOT SEAL A REPORT WITHOUT A FILE THAT IS STILL COMING', () => {
  it('pending is not in flight; uploaded and processing are; clean is not, and is what the manifest gets', async () => {
    const d = { draft: draftHash(newDraftToken()) };
    const sub = await submission(lb.id);
    const { slot_token } = await slot(d, 'inflight@example.org', 4);
    await releaseDraft(db, {
      draft: d.draft,
      submissionId: sub.id,
      logbookId: lb.id,
      expiresAt: sub.expires_at,
    });
    expect(await inFlightSlots(db, { submissionId: sub.id })).toEqual([]);

    const set = (status: string) =>
      db.updateTable('upload_slots').set({ status }).where('slot_token', '=', slot_token).execute();
    await set('uploaded');
    expect((await inFlightSlots(db, { submissionId: sub.id })).length).toBe(1);
    await set('processing');
    expect((await inFlightSlots(db, { submissionId: sub.id })).length).toBe(1);
    await db
      .updateTable('upload_slots')
      .set({
        status: 'clean',
        sha256: 'e'.repeat(64),
        byte_size: 4,
        media_type: JPEG,
        storage_key: 'evidence/' + 'a'.repeat(32),
        rendition_media_type: JPEG,
        dek_wrapped: Buffer.alloc(60),
      })
      .where('slot_token', '=', slot_token)
      .execute();
    expect(await inFlightSlots(db, { submissionId: sub.id })).toEqual([]);
    expect((await clearedSlots(db, { submissionId: sub.id })).length).toBe(1);

    await set('unreadable');
    expect(await inFlightSlots(db, { submissionId: sub.id })).toEqual([]);
  });

  it('the wait outlasts the worker’s own retry, or it gives up exactly as the retry begins', () => {
    expect(CONFIRM_WAIT_MS).toBeGreaterThan(STALE_MINUTES * 60 * 1000);
  });
});
