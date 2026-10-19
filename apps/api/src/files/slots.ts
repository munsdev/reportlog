/**
 * Upload slots: a file between a reporter's browser and a report.
 *
 * THE PATH, in order:
 *
 *   1. A DRAFT TOKEN, server-issued, free to anybody: it grants nothing on
 *      its own. Only its hash is stored.
 *   2. A SLOT per file, against the draft, with the declared name, type and
 *      size. Every limit is checked here, before a byte is sent: the kind,
 *      the per-file size, the number of files and total for one report, and
 *      the STAGING QUOTA across every draft one address has open (a draft is
 *      free, so per-draft caps alone bound a draft and not a caller).
 *   3. THE BYTES, streamed through the site's own origin into staging,
 *      encrypted as they arrive under the file's own new key. Exactly the
 *      declared size or nothing is kept.
 *   4. SEND releases the draft's files to the worker and ties them to the
 *      submission. NOTHING IS WORKED ON BEFORE SEND: most transcoding legacy
 *      did belonged to drafts nobody sent.
 *   5. The worker sniffs, scans, re-encodes and encrypts them into the
 *      evidence store (worker.ts), and marks each `clean` or refused.
 *   6. CONFIRMATION seals the clean ones into the report (promote.ts).
 *
 * An evidence request's slots skip 1 and 4: its link authorises them, and
 * they are released when made, because its "send" hands them over at once.
 * So do a coordinator's, staged into an account of an intake batch
 * (filing/intakeFiles.ts): the coordinator is signed in and the account is
 * theirs, and attaching a file to it is handing it over.
 */
import { randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import type { Readable, TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { looksLikeEmail, sha256Hex } from '../identity/secrets.ts';
import type { Files } from './context.ts';
import { OVERHEAD, encryptStream, newDek } from './envelope.ts';
import { isAllowedType, kindFor } from './kinds.ts';
import { limitsFor, maxBytesForKind } from './limits.ts';
import { randomKey } from './storage.ts';

/** As long as a confirmation link: a staged file and its report expire together. */
export const SLOT_TTL_MS = 24 * 60 * 60 * 1000;

/** How a slot can end without reaching a report. */
export const WITHDRAWN_STATUSES = ['withdrawn', 'expired'] as const;
export const REFUSED_STATUSES = ['rejected', 'unreadable', 'infected'] as const;
const NOT_COUNTED = [...WITHDRAWN_STATUSES, ...REFUSED_STATUSES];

const refuse = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

const DRAFT = /^[a-f0-9]{48}$/;
export const newDraftToken = (): string => randomBytes(24).toString('hex');
export const draftHash = (token: string): string => sha256Hex(`reportlog-draft:${token}`);

/** The draft a request names, or a refusal. */
export function draftFrom(token: unknown): string {
  if (typeof token !== 'string' || !DRAFT.test(token)) {
    throw refuse(
      400,
      'no_draft',
      'This upload is missing the token that ties it to your report. Reload the page.',
    );
  }
  return draftHash(token);
}

/** Whose slot this is: a filing draft, or an evidence request. */
export type Owner = { draft: string } | { evidenceRequestId: number };

const ownedBy = (owner: Owner) =>
  'draft' in owner
    ? sql<boolean>`draft_hash = ${owner.draft}`
    : sql<boolean>`evidence_request_id = ${owner.evidenceRequestId}`;

export interface SlotRequest {
  name: string;
  type: string;
  size: number;
  logbookId: number;
  /** The address the form collected; required while filing. */
  email?: string | null;
  /**
   * A coordinator staging into an intake account: signed in, so no address
   * and no per-address quota (one coordinator stages many people's
   * accounts), and released at once.
   */
  coordinator?: boolean;
}

export async function createUploadSlot(
  files: Files,
  owner: Owner,
  req: SlotRequest,
): Promise<{ slot_token: string }> {
  const { db } = files;
  const filing = 'draft' in owner && req.coordinator !== true;
  const type = req.type.trim().toLowerCase();

  // WHOSE STAGING THIS IS, first, so a request without an address is refused
  // for that reason rather than for whichever limit it trips. Without it the
  // quota is decorative: a caller would simply stop sending the field.
  const email = (req.email ?? '').trim();
  if (filing && !looksLikeEmail(email)) {
    throw refuse(400, 'no_email', 'Give the email address for this report before attaching files.');
  }
  const contactHmac = filing ? files.ring.quotaDigest(email) : null;

  // What the code can handle at all is not a setting.
  if (!isAllowedType(type)) {
    throw refuse(
      400,
      'unsupported_type',
      'That kind of file cannot be attached. Photos: JPEG, PNG, HEIC or WebP. Video: MP4, MOV or WebM. Sound recordings, and PDF documents.',
    );
  }

  // THE FIRST SLOT IN A DRAFT FIXES THE LOGBOOK. A later slot naming another
  // is refused: otherwise a client picks the loosest logbook's limits on each
  // request, and a per-logbook limit is decorative.
  const existing = await db
    .selectFrom('upload_slots')
    .select([
      sql<number>`count(*)::int`.as('n'),
      sql<number>`coalesce(sum(declared_size), 0)::bigint`.as('total'),
      sql<number | null>`max(logbook_id)`.as('logbook_id'),
    ])
    .where(ownedBy(owner))
    .where('status', 'not in', NOT_COUNTED)
    .executeTakeFirstOrThrow();
  const fixed = existing.logbook_id;
  if (fixed !== null && fixed !== req.logbookId) {
    throw refuse(
      409,
      'other_logbook',
      'These files are already being attached to a report in a different logbook.',
    );
  }
  const limits = await limitsFor(db, fixed ?? req.logbookId);

  // Two refusals, worded differently on purpose: "we do not take that"
  // (above) and "we are not taking that at the moment". Telling somebody a
  // file is unsupported when it is merely switched off sends them away
  // converting it for nothing.
  const kind = kindFor(type);
  if (!kind || !limits.kinds.includes(kind)) {
    throw refuse(
      400,
      'kind_off',
      limits.kinds.length
        ? `That kind of file is not being taken at the moment. Taken now: ${limits.kinds.join(', ')}.`
        : 'Files are not being taken at the moment.',
    );
  }

  const cap = maxBytesForKind(kind, limits);
  if (!Number.isSafeInteger(req.size) || req.size <= 0 || req.size > cap) {
    const mb = Math.floor(cap / 1024 / 1024);
    // Seconds where somebody set a short limit: a thirty-second cap rounded
    // to "0 minutes" reads as broken.
    const dur =
      limits.maxVideoSeconds < 90
        ? `${String(limits.maxVideoSeconds)} seconds`
        : `${String(Math.round(limits.maxVideoSeconds / 60))} minutes`;
    throw refuse(
      400,
      'too_large',
      kind === 'video'
        ? `Each video must be under ${String(mb)} MB and ${dur}.`
        : kind === 'audio'
          ? `Each sound recording must be under ${String(mb)} MB and ${dur}.`
          : kind === 'document'
            ? `Each document must be under ${String(mb)} MB and ${String(limits.maxDocumentPages)} pages.`
            : `Each photo must be under ${String(mb)} MB.`,
    );
  }
  if (existing.n >= limits.maxFiles) {
    throw refuse(
      400,
      'too_many',
      limits.maxFiles === 1
        ? 'This form takes one file. Remove the one you attached if you meant a different one.'
        : `A report can carry at most ${String(limits.maxFiles)} files.`,
    );
  }
  if (existing.total + req.size > limits.maxTotalBytes) {
    throw refuse(
      400,
      'too_much',
      `The files on one report must add up to less than ${String(Math.floor(limits.maxTotalBytes / 1024 / 1024))} MB.`,
    );
  }

  // AND WHAT THIS ADDRESS HAS STAGED ACROSS EVERY DRAFT. Generous on purpose
  // (three reports' worth): refusing somebody's second real report is far
  // worse than some wasted staging. Bytes, not files: the cost is the bucket.
  if (contactHmac && files.quotaReports > 0) {
    const held = await db
      .selectFrom('upload_slots')
      .select(sql<number>`coalesce(sum(declared_size), 0)::bigint`.as('total'))
      .where('contact_hmac', '=', contactHmac)
      .where('promoted_at', 'is', null)
      .where('expires_at', '>', new Date())
      .where('status', 'not in', NOT_COUNTED)
      .executeTakeFirstOrThrow();
    if (held.total + req.size > limits.maxTotalBytes * files.quotaReports) {
      // Deliberately does not say how much is left: what helps the person
      // this reaches is finishing their other report, and the arithmetic
      // only helps somebody measuring the limit.
      throw refuse(
        429,
        'quota',
        'There are already files waiting against this email address. Send the report they belong to, or wait a day for them to clear.',
      );
    }
  }

  const slotToken = randomBytes(24).toString('hex');
  await db
    .insertInto('upload_slots')
    .values({
      slot_token: slotToken,
      draft_hash: 'draft' in owner ? owner.draft : null,
      evidence_request_id: 'evidenceRequestId' in owner ? owner.evidenceRequestId : null,
      logbook_id: fixed ?? req.logbookId,
      declared_name: req.name.slice(0, 255),
      declared_type: type,
      declared_size: req.size,
      // Random, never the file's name: a name is untrusted input.
      staging_key: randomKey('staging'),
      contact_hmac: contactHmac,
      expires_at: new Date(Date.now() + SLOT_TTL_MS),
      released_at: filing ? null : new Date(),
    })
    .execute();
  return { slot_token: slotToken };
}

/** Counts bytes on the way through, and fails on one too many or too few. */
function exactly(size: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      seen += chunk.length;
      if (seen > size) {
        done(new HttpError(400, 'size_mismatch', 'That file is larger than it said it was.'));
        return;
      }
      done(null, chunk);
    },
    flush(done: TransformCallback) {
      if (seen !== size) {
        done(new HttpError(400, 'size_mismatch', 'The upload was cut short. Try again.'));
        return;
      }
      done();
    },
  });
}

/**
 * Take a slot's bytes. Encrypted under a new key of the file's own as they
 * arrive, so staging never holds plaintext; the key is stored (wrapped) only
 * once every byte is safely written.
 */
export async function receiveUpload(
  files: Files,
  owner: Owner,
  slotToken: string,
  body: Readable,
): Promise<{ status: string }> {
  const { db } = files;
  const slot = await db
    .selectFrom('upload_slots')
    .select(['id', 'status', 'declared_size', 'staging_key', 'expires_at'])
    .where('slot_token', '=', slotToken)
    .where(ownedBy(owner))
    .executeTakeFirst();
  if (!slot) throw refuse(404, 'not_found', 'There is no such upload on this report.');
  if (slot.status !== 'pending' || slot.expires_at < new Date()) {
    throw refuse(409, 'not_pending', 'This file has already been sent, or was removed.');
  }
  const dek = newDek();
  const counted = exactly(slot.declared_size);
  const encrypted = encryptStream(dek);
  // The pipeline connects body → count → encrypt; storage reads from the end.
  const flowing = pipeline(body, counted, encrypted).catch((e: unknown) => {
    encrypted.destroy(e as Error);
    throw e;
  });
  await Promise.all([
    files.storage.put('staging', slot.staging_key, encrypted, slot.declared_size + OVERHEAD),
    flowing,
  ]);
  const done = await db
    .updateTable('upload_slots')
    .set({ status: 'uploaded', dek_wrapped: files.ring.wrap(dek) })
    .where('id', '=', slot.id)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (done.numUpdatedRows === 0n) {
    // Removed while it was arriving. The object goes with it.
    await queueDeletion(db, 'staging', slot.staging_key);
    throw refuse(409, 'not_pending', 'This file was removed while it was being sent.');
  }
  return { status: 'uploaded' };
}

/** What the page shows for each of a draft's files. */
export async function slotStatuses(db: Kysely<DB>, owner: Owner) {
  return db
    .selectFrom('upload_slots')
    .select(['slot_token', 'declared_name', 'declared_size', 'status', 'status_detail'])
    .where(ownedBy(owner))
    .where('status', '!=', 'withdrawn')
    .orderBy('id')
    .execute();
}

/** The reporter removing a file before sending. */
export async function discardSlot(
  db: Kysely<DB>,
  owner: Owner,
  slotToken: string,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('upload_slots')
      .set({
        status: 'withdrawn',
        status_detail: 'removed by the reporter',
        dek_wrapped: null,
        meta_enc: null,
      })
      .where('slot_token', '=', slotToken)
      .where(ownedBy(owner))
      .where('promoted_at', 'is', null)
      .where('submission_id', 'is', null)
      .returning(['staging_key', 'storage_key', 'page_count'])
      .executeTakeFirst();
    if (!row) return false;
    await queueDeletion(trx, 'staging', row.staging_key);
    if (row.storage_key) await queueEvidenceDeletion(trx, row.storage_key, row.page_count);
    return true;
  });
}

/**
 * SEND. Tie a draft's files to the submission and release them to the
 * worker. Their life is extended to the submission's link, so a file staged
 * early in the evening does not expire under a link sent late.
 *
 * Only files of this logbook, and only `pending` or `uploaded` ones: anything
 * past that is being worked on or finished, and a refused one is not work.
 * Returns how many, which the caller logs: a submission that carried files
 * and released none is the shape of a bug.
 */
export async function releaseDraft(
  db: Kysely<DB>,
  input: { draft: string; submissionId: number; logbookId: number; expiresAt: Date },
): Promise<number> {
  const out = await db
    .updateTable('upload_slots')
    .set({
      released_at: new Date(),
      submission_id: input.submissionId,
      expires_at: input.expiresAt,
    })
    .where('draft_hash', '=', input.draft)
    .where('logbook_id', '=', input.logbookId)
    .where('released_at', 'is', null)
    .where('status', 'in', ['pending', 'uploaded'])
    .executeTakeFirst();
  return Number(out.numUpdatedRows);
}

/** Whose files: a sent submission, an evidence request, or (an intake account's) a draft. */
export type Source = { submissionId: number } | { evidenceRequestId: number } | { draft: string };
const sourceIs = (where: Source) =>
  'submissionId' in where
    ? sql<boolean>`submission_id = ${where.submissionId}`
    : 'draft' in where
      ? sql<boolean>`draft_hash = ${where.draft}`
      : sql<boolean>`evidence_request_id = ${where.evidenceRequestId}`;

/**
 * Files whose bytes are here and whose work is not finished. Confirming must
 * wait for these, or it seals a report that silently does not hold a file the
 * reporter watched upload. `pending` is NOT in flight: its bytes never
 * arrived, and nothing will ever happen to it.
 */
export async function inFlightSlots(db: Kysely<DB>, where: Source) {
  return db
    .selectFrom('upload_slots')
    .select(['slot_token', 'declared_name', 'status', 'released_at'])
    .where(sourceIs(where))
    .where('promoted_at', 'is', null)
    .where('status', 'in', ['uploaded', 'processing'])
    .orderBy('id')
    .execute();
}

/** The finished files ready to be sealed: what the manifest is made from. */
export async function clearedSlots(db: Kysely<DB>, where: Source) {
  return db
    .selectFrom('upload_slots')
    .selectAll()
    .where(sourceIs(where))
    .where('status', '=', 'clean')
    .where('promoted_at', 'is', null)
    .orderBy('id')
    .execute();
}

/** Every slot of a submission, for saying which files made it and which did not. */
export async function slotsOfSubmission(db: Kysely<DB>, submissionId: number) {
  return db
    .selectFrom('upload_slots')
    .select(['declared_name', 'status', 'status_detail', 'promoted_at'])
    .where('submission_id', '=', submissionId)
    .orderBy('id')
    .execute();
}

/** An object that must leave storage, recorded in the caller's transaction. */
export async function queueDeletion(
  db: Kysely<DB>,
  bucket: 'staging' | 'evidence' | 'renditions',
  key: string,
): Promise<void> {
  await db.insertInto('storage_deletions').values({ bucket, key }).execute();
}

/** Every object derived from one stored original. */
export function evidenceKeys(storageKey: string, pageCount: number | null): string[] {
  const pages: string[] = [];
  for (let i = 2; i <= (pageCount ?? 1); i++) pages.push(`${storageKey}.page${String(i)}`);
  return [
    storageKey,
    `${storageKey}.rendition`,
    `${storageKey}.poster`,
    `${storageKey}.meta`,
    ...pages,
  ];
}

export async function queueEvidenceDeletion(
  db: Kysely<DB>,
  storageKey: string,
  pageCount: number | null,
): Promise<void> {
  for (const key of evidenceKeys(storageKey, pageCount)) await queueDeletion(db, 'evidence', key);
}
