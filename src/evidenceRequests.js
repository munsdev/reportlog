/**
 * Asking a reporter for the evidence they said they had, and the scoped
 * one-time door they answer through.
 *
 * THREE GATES, AND ALL THREE ARE CHECKED AT USE. A request can only be
 * made where the report DECLARED something and the reporter GRANTED the
 * permission; a link only works while it is unspent, unexpired, uncancelled
 * — and while that permission still stands.
 *
 * THE LAST ONE IS THE ONE THAT MATTERS. A link minted while the permission
 * stood must stop working the moment it is taken back, so the grant is read
 * at the moment the link is used and never trusted from when it was issued.
 * That is the same rule src/renditions.js follows for publication: consent
 * is the ceiling, read now. A door that outlived the permission that opened
 * it would make "switch this off and they stop asking" a lie.
 *
 * WHAT THE LINK MAY DO IS NARROW ON PURPOSE. It authorises staging files
 * against ONE thread. It cannot change an answer, withdraw a report, read
 * anybody's details, or be pointed at another thread. A reporter who has
 * lost their sign-in still has to be able to answer — which is exactly why
 * it must not be a general key to their report.
 *
 * NOTHING HERE IS HASHED. A request is correspondence about a report, not
 * part of it. What the reporter sends back IS: it arrives as a new version
 * through the same append-only path a correction takes, with the files in
 * its manifest.
 */
import crypto from 'node:crypto';
import { pool } from './db.js';
import { fieldsFor, logbookById } from './logbooks.js';
import { EVIDENCE_REQUEST, permissionsFor } from './reportPermissions.js';
import { declaredEvidence } from './evidence.js';

/**
 * How long a link lasts.
 *
 * Days rather than minutes, and that is a judgement rather than an
 * oversight: the person being asked is a member of the public who may read
 * their mail on Sunday, and has to find a file on a phone before they can
 * answer. A five-minute grant (src/accessLog.js) is right for a moderator
 * clicking through to a video they are already looking at; it would be a
 * link that is always dead for this.
 *
 * Fourteen days, and it stops working the moment the reporter takes the
 * permission back, which is the control that actually matters.
 */
export const REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Plain text, like the editorial note, and for the same reason. */
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;

const hashToken = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');

export function validateMessage(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (text.length < MESSAGE_MIN) {
    // A request with no words is a mail that reads as a phishing attempt,
    // which is the one thing this must never look like.
    return { ok: false, reason: 'message-short' };
  }
  if (text.length > MESSAGE_MAX) return { ok: false, reason: 'message-long' };
  return { ok: true, text };
}

/**
 * May this thread be asked at all?
 *
 * Both halves, from their two different sources: what the report sealed,
 * and what the reporter currently permits. Returns the reason when not, so
 * a moderator is told which of the two is missing rather than "no".
 */
export async function askableState(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT r.id AS report_id, r.answers, r.logbook_id
       FROM report_heads h JOIN reports r ON r.id = h.current_report_id
      WHERE h.thread_id = $1`,
    [threadId],
  );
  if (!rows.length) return { ok: false, reason: 'no-report' };
  const row = rows[0];
  const fields = await fieldsFor(row.logbook_id, client);
  const declared = declaredEvidence(row.answers, fields);
  const perms = await permissionsFor(threadId, client);
  const permitted = perms[EVIDENCE_REQUEST] === true;

  if (!permitted) return { ok: false, reason: 'not-permitted', declared, permitted };
  // Asking somebody who never said they had anything is a cold call about
  // their report. The permission is consent to be asked for what they
  // mentioned, not an open channel.
  if (!declared) return { ok: false, reason: 'nothing-declared', declared, permitted };
  return {
    ok: true, declared, permitted, reportId: row.report_id, logbookId: row.logbook_id,
  };
}

/**
 * Ask. Returns the token ONCE, for the mail, and never again.
 *
 * The caller sends it. This does not, because a module that both writes
 * the row and sends the mail cannot be tested without a mail server, and
 * the thing worth testing is the row.
 */
export async function createRequest(threadId, { message, byEmail }, client = pool) {
  if (!byEmail) return { ok: false, reason: 'no-actor' };
  const check = validateMessage(message);
  if (!check.ok) return check;

  const state = await askableState(threadId, client);
  if (!state.ok) return { ok: false, reason: state.reason };

  // CLEAR ANYTHING THAT HAS AGED OUT FIRST. The one-live-request index
  // cannot test `expires_at` against `now()` — an index predicate has to be
  // immutable — so expiry is a column somebody has to stamp, and this is
  // where it is noticed. Without it, the first request to run out locked
  // the report forever and told the moderator to withdraw a request that
  // had already stopped working. 043 says the same at greater length.
  await expireStale(threadId, client);

  const token = crypto.randomBytes(24).toString('hex');
  try {
    const { rows } = await client.query(
      `INSERT INTO evidence_requests (thread_id, asked_by, message, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, asked_at, expires_at`,
      [threadId, byEmail, check.text, hashToken(token), new Date(Date.now() + REQUEST_TTL_MS)],
    );
    return { ok: true, token, request: rows[0] };
  } catch (e) {
    // The partial unique index: one live request per thread. Two open links
    // is two ways to spend one ask, and a reporter with two mails cannot
    // tell which is current.
    if (e.code === '23505') return { ok: false, reason: 'already-open' };
    throw e;
  }
}

/**
 * Stamp any of this thread's requests that have run out.
 *
 * Lazy on purpose: there is no sweeper, and a request that nobody looks at
 * again does not need a timestamp to be dead — `expires_at` already says
 * so. What the column is for is the unique index, which cannot read a
 * clock, so it only has to be true by the time somebody asks again.
 */
export async function expireStale(threadId, client = pool) {
  const { rows } = await client.query(
    `UPDATE evidence_requests
        SET expired_at = expires_at
      WHERE thread_id = $1 AND expired_at IS NULL
        AND used_at IS NULL AND cancelled_at IS NULL AND expires_at <= now()
      RETURNING id`,
    [threadId],
  );
  return rows.length;
}

/**
 * The live request on a thread, if there is one. For the moderator's card.
 *
 * Never returns the token — there is nothing here to leak, because the
 * column holds a hash.
 */
export async function openRequestFor(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, asked_by, asked_at, message, expires_at
       FROM evidence_requests
      WHERE thread_id = $1 AND used_at IS NULL AND cancelled_at IS NULL
        AND expired_at IS NULL AND expires_at > now()`,
    [threadId],
  );
  return rows[0] || null;
}

/** Everything ever asked of this thread, newest first. */
export async function requestHistory(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, asked_by, asked_at, message, expires_at, used_at, cancelled_at,
            cancelled_by, expired_at
       FROM evidence_requests WHERE thread_id = $1 ORDER BY asked_at DESC`,
    [threadId],
  );
  return rows;
}

/**
 * Withdraw a request.
 *
 * Not a delete: a moderator who asked by mistake needs the link to stop
 * working, and the record of having asked is exactly what should survive
 * that. Distinct from expiring and from the reporter revoking.
 */
export async function cancelRequest(threadId, { byEmail }, client = pool) {
  if (!byEmail) return { ok: false, reason: 'no-actor' };
  const { rows } = await client.query(
    `UPDATE evidence_requests
        SET cancelled_at = now(), cancelled_by = $2
      WHERE thread_id = $1 AND used_at IS NULL AND cancelled_at IS NULL
        AND expired_at IS NULL AND expires_at > now()
      RETURNING id`,
    [threadId, byEmail],
  );
  return { ok: true, cancelled: rows.length };
}

/**
 * Open the door, or say exactly why it will not open.
 *
 * EVERY GATE, EVERY TIME, including the permission — which is read now
 * rather than trusted from when the link was minted. The reasons are
 * distinguished for the server's benefit; what the reporter is shown
 * deliberately collapses several of them, because "that link has expired"
 * and "that link was withdrawn" are both just "this is no longer open" to
 * somebody holding a stale mail, and the difference would tell a stranger
 * with a guessed token something about a real report.
 */
export async function redeem(token, client = pool) {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) {
    return { ok: false, reason: 'bad-token' };
  }
  const { rows } = await client.query(
    `SELECT e.id, e.thread_id, e.message, e.asked_at, e.expires_at, e.used_at,
            e.cancelled_at, e.expired_at,
            h.current_report_id, h.withdrawn, r.logbook_id, r.public_ref
       FROM evidence_requests e
       JOIN report_heads h ON h.thread_id = e.thread_id
       JOIN reports r ON r.id = h.current_report_id
      WHERE e.token_hash = $1`,
    [hashToken(token)],
  );
  if (!rows.length) return { ok: false, reason: 'not-found' };
  const e = rows[0];
  if (e.used_at) return { ok: false, reason: 'used' };
  if (e.cancelled_at) return { ok: false, reason: 'cancelled' };
  // Either the stamp or the clock — the stamp is lazy, so the clock is
  // still the authority on whether a link works right now.
  if (e.expired_at || new Date(e.expires_at) <= new Date()) {
    return { ok: false, reason: 'expired' };
  }

  // THE GATE THAT MAKES THE SWITCH HONEST. Read now, never from issue.
  const perms = await permissionsFor(e.thread_id, client);
  if (perms[EVIDENCE_REQUEST] !== true) return { ok: false, reason: 'permission-withdrawn' };

  // A withdrawn report is not a thing to be adding evidence to. The
  // reporter may have withdrawn it since being asked, and in that order
  // the ask is simply overtaken.
  if (e.withdrawn) return { ok: false, reason: 'report-withdrawn' };

  const lb = await logbookById(e.logbook_id, client);
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
      logbookTitle: lb ? lb.title : null,
      currentReportId: e.current_report_id,
    },
  };
}

/**
 * Commit staged files to the report, as a new version of it.
 *
 * A NEW VERSION, NOT AN EDIT. `reports` is append-only and the files a
 * version commits to are in its hashed manifest, so adding files means
 * appending a version — the same path a correction takes.
 *
 * THE ANSWERS ARE CARRIED FORWARD UNTOUCHED, and that is the invariant
 * worth the most here. They are read from the previous version's stored
 * `answers` and passed straight through: not rebuilt from a request body,
 * not re-validated against the form. The reporter was asked for files, not
 * invited to revise their account, and nothing on this path may change a
 * word of it. Re-running them through the form's normalizer would also risk
 * a different byte for the same meaning, which would show up as a report
 * whose two versions disagree for no reason anybody could explain.
 *
 * LIVES HERE RATHER THAN IN THE ROUTE so it can be tested without a mail
 * server, an HTTP client or a bucket. The route is the door; this is what
 * happens on the other side of it.
 *
 * Caller supplies the transaction, and the request must already have been
 * spent in it — see `markUsed`, which has to come first so two clicks
 * cannot both get this far.
 */
export async function attachEvidence(client, { threadId, slots }) {
  const [
    { insertReportVersion, normalizeReportFields },
    { ensureFormVersion },
    { fieldsFor: fields, logbookById: book },
    A,
  ] = await Promise.all([
    import('./reportCore.js'),
    import('./logbookForms.js'),
    import('./logbooks.js'),
    import('./attachments.js'),
  ]);

  // Locked, because a correction or a withdrawal may have landed between
  // the link being opened and this running.
  const { rows: heads } = await client.query(
    `SELECT h.current_report_id, h.withdrawn, r.answers, r.may_publish,
            r.may_publish_digest, r.logbook_id
       FROM report_heads h JOIN reports r ON r.id = h.current_report_id
      WHERE h.thread_id = $1 FOR UPDATE OF h`,
    [threadId],
  );
  const head = heads[0];
  if (!head) return { ok: false, reason: 'no-report' };
  if (head.withdrawn) return { ok: false, reason: 'report-withdrawn' };

  const lb = await book(head.logbook_id, client);
  const questions = await fields(lb.id, client);
  const form = await ensureFormVersion(lb, questions, client);
  const inherited = await A.attachmentsOfReport(client, head.current_report_id);

  const reportFields = normalizeReportFields({
    logbook: lb.slug,
    answers: head.answers || undefined,
    may_publish: head.may_publish,
    may_publish_digest: head.may_publish_digest,
  });

  const ordinalFrom = await A.nextOrdinal(client, threadId);
  const report = await insertReportVersion(client, {
    threadId,
    correctsId: head.current_report_id,
    fields: reportFields,
    // Everything the previous version held, then what has just arrived,
    // numbered on from the thread's highest so a file's ordinal is stable
    // for the life of the report.
    attachmentManifest: [
      ...A.manifestFromRows(inherited),
      ...A.buildManifest(slots, { ordinalFrom }),
    ],
    logbookId: lb.id,
    formId: form.id,
  });

  if (inherited.length) {
    await A.linkAttachments(client, {
      reportId: report.id,
      attachmentIds: inherited.map((a) => a.id),
    });
  }
  await A.promoteSlots(client, { slots, threadId, reportId: report.id });

  await client.query(
    'UPDATE report_heads SET current_report_id = $1, updated_at = now() WHERE thread_id = $2',
    [report.id, threadId],
  );

  // NULL for the actor, not an address. This path never learns one — the
  // token authorises the act without identifying anybody — and
  // self_service_log is append-only, so an address written here would
  // outlive an erasure it was meant to honour.
  await client.query(
    `INSERT INTO self_service_log (thread_id, action, actor_email, comment)
     VALUES ($1, 'evidence', NULL, $2)`,
    [threadId, `Sent ${slots.length} file(s) in answer to a request`],
  );

  return { ok: true, report, inherited: inherited.length };
}

/**
 * Spend it, in the transaction that created the new version.
 *
 * Conditional on still being unspent, so two clicks arriving together
 * cannot both succeed — the UPDATE that matches no row is the one that
 * loses, rather than both writing and the second quietly overwriting.
 */
export async function markUsed(client, { requestId, reportId }) {
  const { rows } = await client.query(
    `UPDATE evidence_requests
        SET used_at = now(), used_report_id = $2
      WHERE id = $1 AND used_at IS NULL
      RETURNING id`,
    [requestId, reportId],
  );
  return rows.length === 1;
}

/**
 * Point a spent request at the version the files actually landed on.
 *
 * `markUsed` has to run BEFORE the version exists — it is what stops two
 * clicks both creating one — so it can only record the version that was
 * current when the link was spent. That is true but not the useful fact:
 * what somebody looking at this row later wants is the version carrying
 * the evidence. Stamped the moment it exists, in the same transaction.
 */
export async function markLanded(client, { requestId, reportId }) {
  await client.query(
    'UPDATE evidence_requests SET used_report_id = $2 WHERE id = $1 AND used_at IS NOT NULL',
    [requestId, reportId],
  );
}
