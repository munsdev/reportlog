/**
 * Asking a reporter for the evidence they said they had.
 *
 * THREE GATES, every one of them read at the moment of use and never trusted
 * from when a link was made:
 *
 *   1. The report DECLARED something: an evidence_declaration question
 *      answered yes. A sealed answer, a fact about the filing.
 *   2. The reporter GRANTED the evidence_request permission. Revocable, in
 *      their own log. The permission is consent to be asked about what they
 *      mentioned, not an open channel, so both are needed.
 *   3. The report is not withdrawn.
 *
 * A link that outlived the permission that opened it would make "switch this
 * off and they stop asking" a lie, and that promise is on the reporter's own
 * page. So taking the permission back closes a link already sent, and giving
 * it again reopens it.
 *
 * WHAT THE REPORTER SENDS BECOMES A NEW VERSION, through the same append-only
 * path a correction takes: the answers carried forward byte for byte (the
 * reporter was asked for files, not invited to revise their account), the
 * files the previous version held, and the new ones after them.
 *
 * Ported from legacy `evidenceRequests.js`.
 */
import { randomBytes } from 'node:crypto';
import { rebuildSealedObject } from '@reportlog/seal';
import type { ReportFields } from '@reportlog/seal';
import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { questionsFor } from '../chain/questions.ts';
import { manifestFor, sealedReportRows, toStoredRecord } from '../chain/record.ts';
import type { DB } from '../db/schema.gen.ts';
import { sealFiles } from '../files/filing.ts';
import { filesOfVersion } from '../files/promote.ts';
import { sha256Hex } from '../identity/secrets.ts';
import { permissionsFor } from '../permissions/log.ts';

/** Two weeks: long enough to dig a clip out of a phone, short enough to be an ask and not a standing door. */
export const REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;

const TOKEN = /^[a-f0-9]{48}$/;
const hashToken = (t: string) => sha256Hex(`reportlog-evidence:${t}`);

export type Refusal =
  | 'no-report'
  | 'not-permitted'
  | 'nothing-declared'
  | 'report-withdrawn'
  | 'message-short'
  | 'message-long'
  | 'already-open'
  | 'no-actor'
  | 'bad-token'
  | 'not-found'
  | 'used'
  | 'cancelled'
  | 'expired'
  | 'permission-withdrawn';

export function validateMessage(
  raw: unknown,
): { ok: true; text: string } | { ok: false; reason: Refusal } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  // A mail with no words in it reads as a phishing attempt, which is the one
  // thing this must never look like.
  if (text.length < MESSAGE_MIN) return { ok: false, reason: 'message-short' };
  if (text.length > MESSAGE_MAX) return { ok: false, reason: 'message-long' };
  return { ok: true, text };
}

async function currentVersion(db: Kysely<DB>, threadId: string) {
  return db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select(['r.id as report_id', 'r.answers', 'r.logbook_id', 'r.public_ref', 'h.withdrawn'])
    .where('h.thread_id', '=', threadId)
    .executeTakeFirst();
}

/** Did the current version answer an evidence declaration with yes? */
async function declared(db: Kysely<DB>, logbookId: number, answers: unknown): Promise<boolean> {
  const a = (answers ?? {}) as Record<string, unknown>;
  const qs = await questionsFor(db, logbookId);
  return qs.some((q) => q.kind === 'evidence_declaration' && a[q.key] === true);
}

/** Whether this report may be asked, and if not, WHICH half is missing. */
export async function askableState(db: Kysely<DB>, threadId: string) {
  const row = await currentVersion(db, threadId);
  if (!row)
    return { ok: false as const, reason: 'no-report' as const, declared: false, permitted: false };
  const isDeclared = await declared(db, row.logbook_id, row.answers);
  const permitted = (await permissionsFor(db, threadId)).evidence_request;
  if (row.withdrawn)
    return {
      ok: false as const,
      reason: 'report-withdrawn' as const,
      declared: isDeclared,
      permitted,
    };
  if (!permitted)
    return {
      ok: false as const,
      reason: 'not-permitted' as const,
      declared: isDeclared,
      permitted,
    };
  if (!isDeclared)
    return {
      ok: false as const,
      reason: 'nothing-declared' as const,
      declared: isDeclared,
      permitted,
    };
  return {
    ok: true as const,
    declared: true,
    permitted: true,
    reportId: row.report_id,
    logbookId: row.logbook_id,
  };
}

/**
 * What a forgotten ask says instead of the moderator's words. Long enough for
 * the column's own length check, which stays as it is: the words become a
 * sentence a person reads in the history rather than the column being
 * loosened to allow nothing.
 */
export const FORGOTTEN_MESSAGE = 'Removed a year after it was sent.';

/**
 * Forget what moderators wrote a year after they asked (owner decision,
 * 23 October 2026). The ROW STAYS: that a reporter was asked, when, by whom
 * and what came of it is the history the moderator's screen shows, and the
 * files a request brought in point at it. The words are the part that can
 * carry somebody's account, so they go. A link lasts 14 days, so nothing a
 * year old can still be live. Run by the nightly sweep.
 */
export async function forgetOldMessages(db: Kysely<DB>): Promise<number> {
  const out = await db
    .updateTable('evidence_requests')
    .set({ message: FORGOTTEN_MESSAGE })
    .where('asked_at', '<', sql<Date>`now() - interval '1 year'`)
    .where('message', '<>', FORGOTTEN_MESSAGE)
    .executeTakeFirst();
  return Number(out.numUpdatedRows);
}

/**
 * Stamp asks that have run out. An index predicate cannot read the clock, so
 * the one-live-ask rule needs a stamp, and this is where expiry is noticed.
 * Without it the first ask to age out blocked every later one.
 */
export async function expireStale(db: Kysely<DB>, threadId: string): Promise<number> {
  const out = await db
    .updateTable('evidence_requests')
    .set({ expired_at: sql`expires_at` })
    .where('thread_id', '=', threadId)
    .where('expired_at', 'is', null)
    .where('used_at', 'is', null)
    .where('cancelled_at', 'is', null)
    .where('expires_at', '<=', new Date())
    .executeTakeFirst();
  return Number(out.numUpdatedRows);
}

export async function createRequest(
  db: Kysely<DB>,
  threadId: string,
  input: { message: unknown; by: string | null },
): Promise<
  | { ok: true; token: string; request: { id: number; asked_at: Date; expires_at: Date } }
  | { ok: false; reason: Refusal }
> {
  if (!input.by) return { ok: false, reason: 'no-actor' };
  const check = validateMessage(input.message);
  if (!check.ok) return check;
  const state = await askableState(db, threadId);
  if (!state.ok) return { ok: false, reason: state.reason };
  await expireStale(db, threadId);
  const token = randomBytes(24).toString('hex');
  try {
    const request = await db
      .insertInto('evidence_requests')
      .values({
        thread_id: threadId,
        asked_by: input.by,
        message: check.text,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + REQUEST_TTL_MS),
      })
      .returning(['id', 'asked_at', 'expires_at'])
      .executeTakeFirstOrThrow();
    return { ok: true, token, request };
  } catch (e) {
    // One live ask per report (the partial unique index).
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'already-open' };
    throw e;
  }
}

export async function openRequestFor(db: Kysely<DB>, threadId: string) {
  return (
    (await db
      .selectFrom('evidence_requests')
      .select(['id', 'asked_by', 'asked_at', 'message', 'expires_at'])
      .where('thread_id', '=', threadId)
      .where('used_at', 'is', null)
      .where('cancelled_at', 'is', null)
      .where('expired_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst()) ?? null
  );
}

/** Every ask, spent and withdrawn alike: withdrawing stops a link, the record of having asked survives. */
export async function requestHistory(db: Kysely<DB>, threadId: string) {
  return db
    .selectFrom('evidence_requests')
    .select([
      'id',
      'asked_by',
      'asked_at',
      'message',
      'expires_at',
      'used_at',
      'used_report_id',
      'cancelled_at',
      'cancelled_by',
      'expired_at',
    ])
    .where('thread_id', '=', threadId)
    .orderBy('asked_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
}

export async function cancelRequest(
  db: Kysely<DB>,
  threadId: string,
  input: { by: string | null },
): Promise<{ ok: true; cancelled: number } | { ok: false; reason: Refusal }> {
  if (!input.by) return { ok: false, reason: 'no-actor' };
  const out = await db
    .updateTable('evidence_requests')
    .set({ cancelled_at: new Date(), cancelled_by: input.by })
    .where('thread_id', '=', threadId)
    .where('used_at', 'is', null)
    .where('cancelled_at', 'is', null)
    .where('expired_at', 'is', null)
    .where('expires_at', '>', new Date())
    .executeTakeFirst();
  return { ok: true, cancelled: Number(out.numUpdatedRows) };
}

export interface Redeemed {
  id: number;
  threadId: string;
  message: string;
  askedAt: Date;
  expiresAt: Date;
  publicRef: string;
  logbookId: number;
  logbookTitle: string;
  currentReportId: number;
}

/**
 * Whether a token names a request at all, open or not. For the site password
 * only (identity/doors.ts): the link passes on its token, as a confirmation
 * link does, and every route behind it still checks every gate through
 * `redeem`.
 */
export async function evidenceTokenKnown(db: Kysely<DB>, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return false;
  const row = await db
    .selectFrom('evidence_requests')
    .select('id')
    .where('token_hash', '=', hashToken(token))
    .executeTakeFirst();
  return row !== undefined;
}

/** What a link opens, checked through every gate, now. */
export async function redeem(
  db: Kysely<DB>,
  token: string,
): Promise<{ ok: true; request: Redeemed } | { ok: false; reason: Refusal }> {
  if (!TOKEN.test(token)) return { ok: false, reason: 'bad-token' };
  const e = await db
    .selectFrom('evidence_requests as e')
    .innerJoin('report_heads as h', 'h.thread_id', 'e.thread_id')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .select([
      'e.id',
      'e.thread_id',
      'e.message',
      'e.asked_at',
      'e.expires_at',
      'e.used_at',
      'e.cancelled_at',
      'e.expired_at',
      'h.current_report_id',
      'h.withdrawn',
      'r.logbook_id',
      'r.public_ref',
      'l.title',
    ])
    .where('e.token_hash', '=', hashToken(token))
    .executeTakeFirst();
  if (!e) return { ok: false, reason: 'not-found' };
  if (e.used_at) return { ok: false, reason: 'used' };
  if (e.cancelled_at) return { ok: false, reason: 'cancelled' };
  // The stamp is lazy; the clock is the authority on whether a link works now.
  if (e.expired_at || e.expires_at <= new Date()) return { ok: false, reason: 'expired' };
  // THE GATE THAT MAKES THE SWITCH HONEST. Read now, never from issue.
  if (!(await permissionsFor(db, e.thread_id)).evidence_request) {
    return { ok: false, reason: 'permission-withdrawn' };
  }
  // Withdrawn since being asked: in that order the ask is overtaken.
  if (e.withdrawn) return { ok: false, reason: 'report-withdrawn' };
  return {
    ok: true,
    request: {
      id: e.id,
      threadId: e.thread_id,
      message: e.message,
      askedAt: e.asked_at,
      expiresAt: e.expires_at,
      publicRef: e.public_ref,
      logbookId: e.logbook_id,
      logbookTitle: e.title,
      currentReportId: e.current_report_id,
    },
  };
}

/**
 * SPEND THE LINK, conditionally. Two presses arriving together both pass
 * `redeem`; only one wins this UPDATE, and the loser's transaction rolls back
 * having created nothing. Done FIRST in the sending transaction.
 */
export async function markUsed(
  trx: Kysely<DB>,
  input: { requestId: number; reportId: number },
): Promise<boolean> {
  const out = await trx
    .updateTable('evidence_requests')
    .set({ used_at: new Date(), used_report_id: input.reportId })
    .where('id', '=', input.requestId)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  return out.numUpdatedRows === 1n;
}

/** Point a spent ask at the version its files LANDED on, which markUsed cannot know yet. */
export async function markLanded(
  trx: Kysely<DB>,
  input: { requestId: number; reportId: number },
): Promise<void> {
  await trx
    .updateTable('evidence_requests')
    .set({ used_report_id: input.reportId })
    .where('id', '=', input.requestId)
    .where('used_at', 'is not', null)
    .execute();
}

/**
 * The new version: the same sealed fields, the files the last version held,
 * then the new ones. In the caller's transaction, after `markUsed`.
 */
export async function attachEvidence(
  trx: Transaction<DB>,
  input: { threadId: string; requestId: number; publicRefPrefix: string },
): Promise<
  | {
      ok: true;
      report: {
        id: number;
        public_ref: string;
        corrects_id: number | null;
        content_hash: string;
        answers: unknown;
      };
      attached: number;
    }
  | { ok: false; reason: 'no-report' | 'report-withdrawn' | 'nothing-sent' }
  | { ok: false; reason: 'files-frozen'; dropped: string[] }
> {
  // Locked: a correction or a withdrawal may have landed since the link opened.
  const head = await trx
    .selectFrom('report_heads')
    .select(['current_report_id', 'withdrawn'])
    .where('thread_id', '=', input.threadId)
    .forUpdate()
    .executeTakeFirst();
  if (!head) return { ok: false, reason: 'no-report' };
  if (head.withdrawn) return { ok: false, reason: 'report-withdrawn' };

  const prev = await sealedReportRows(trx)
    .where('r.id', '=', head.current_report_id)
    .executeTakeFirstOrThrow();
  const inheritedManifest = (await manifestFor(trx, prev.id)) ?? [];
  const inherited = await filesOfVersion(trx, prev.id);
  // EXACTLY what the last version sealed, rebuilt the way the verifier
  // rebuilds it, minus what every version has of its own.
  const sealed = rebuildSealedObject(toStoredRecord(prev), null);
  // Key by key, each only when it applies (the absent-key rule).
  const fields: ReportFields = {
    logbook: sealed.logbook,
    ...(sealed.answers ? { answers: sealed.answers } : {}),
    ...(sealed.third_party
      ? {
          third_party: true as const,
          filed_via: sealed.filed_via ?? '',
          intake_method: sealed.intake_method ?? 'other',
          attested_at: sealed.attested_at ?? '',
          ...(sealed.collected_on ? { collected_on: sealed.collected_on } : {}),
        }
      : {}),
    may_publish: sealed.may_publish,
    may_publish_digest: sealed.may_publish_digest,
  };

  const files = await sealFiles(
    trx,
    { evidenceRequestId: input.requestId },
    input.threadId,
    inheritedManifest,
  );
  if (!files.count) {
    // Frozen since they were staged (decision 19): nothing to add, and the
    // reporter is told which.
    return files.dropped.length
      ? { ok: false, reason: 'files-frozen', dropped: files.dropped }
      : { ok: false, reason: 'nothing-sent' };
  }
  const { row } = await appendReportVersion(trx, {
    logbookId: prev.logbook_id,
    threadId: input.threadId,
    correctsId: prev.id,
    fields,
    attachments: files.manifest,
    // The questions the carried answers were answered against.
    ...(prev.form_id !== null ? { formId: prev.form_id } : {}),
    publicRefPrefix: input.publicRefPrefix,
    // The words did not change, so the held text and links come with them,
    // unchanged: same values, same fingerprints (W1). Without this a reporter
    // sending a photo would silently lose what they wrote.
    held: { carryFrom: prev.id },
  });
  if (inherited.length) {
    await trx
      .insertInto('report_attachments')
      .values(inherited.map((id) => ({ report_id: row.id, attachment_id: id })))
      .execute();
  }
  await files.link(row.id);
  // The words did not change, so the moderation decision stands; the new
  // files are withheld like every file until a moderator publishes them.
  await trx
    .updateTable('report_heads')
    .set({ current_report_id: row.id, updated_at: new Date() })
    .where('thread_id', '=', input.threadId)
    .execute();
  return { ok: true, report: row, attached: files.count };
}
