// Who opened the protected parts of a report, when, and why.
//
// The log covers exactly two things a reporter would care about — their
// identity details, and the unstripped original of a file they attached —
// plus moderator previews of not-yet-published material, which are logged
// for oversight but are not a disclosure of anything the reporter gave us.
//
// Deliberately NOT logged: ordinary moderator browsing of the report queue.
// That is Tier A, already public or about to be, and recording every glance
// at it would bury the entries that matter under thousands that do not.
// The log means "somebody opened something protected", and it can only keep
// meaning that if it stays narrow.

import crypto from 'node:crypto';
import { pool } from './db.js';

export const KINDS = {
  IDENTITY: 'identity',
  ORIGINAL: 'attachment_original',
  PREVIEW: 'attachment_preview',
  AUDIT: 'audit_log',
};

// The two a reporter is shown. Previews are moderator workflow; a read of
// the audit log is about staff, not about any reporter's data.
export const REPORTER_VISIBLE_KINDS = [KINDS.IDENTITY, KINDS.ORIGINAL];

// Long enough to say something useful, short enough that nobody is tempted
// to paste a case file into it.
export const MAX_REASON = 500;
const MIN_REASON = 10;

/**
 * Check a reason before it is used to unlock anything.
 *
 * A reason that is required but never checked becomes "." within a week,
 * so the minimum length is enforced rather than implied. Returns an error
 * string, or null when it will do.
 */
export function validateReason(raw) {
  const reason = String(raw || '').trim();
  if (!reason) return 'A reason is required, and the reporter will see it.';
  if (reason.length < MIN_REASON) return 'Please give a real reason — the reporter whose data this is will read it.';
  if (reason.length > MAX_REASON) return `Please keep the reason under ${MAX_REASON} characters.`;
  return null;
}

export function normalizeReason(raw) {
  return String(raw || '').trim().slice(0, MAX_REASON);
}

/**
 * Record one access. Returns the new row's id.
 *
 * Every caller passes thread_id even though report_id implies it, because
 * report_id names one VERSION of a report — a corrected report scatters
 * across several — and both views group by the thread a human means.
 */
export async function recordAccess({
  staffEmail, kind, reportId = null, threadId = null, attachmentId = null, reason = null,
}, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO access_log (staff_email, kind, report_id, thread_id, attachment_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [staffEmail, kind, reportId, threadId, attachmentId, reason ? normalizeReason(reason) : null],
  );
  return rows[0].id;
}

const GRANT_TTL_MS = 5 * 60 * 1000;

/**
 * Record a reason for viewing one original, and hand back a single-use
 * token that authorises exactly one stream of it.
 *
 * The entry is written when the grant is issued, not when it is spent, so
 * a moderator who asks to open a file and then changes their mind still
 * leaves a record. That over-reports rather than under-reports, which is
 * the only direction this should ever err in: the alternative is a look at
 * someone's data that leaves no trace because the request that logged it
 * failed after the fact.
 */
export async function grantOriginalView({ staffEmail, attachment, reason }) {
  const logId = await recordAccess({
    staffEmail,
    kind: KINDS.ORIGINAL,
    reportId: attachment.report_id,
    threadId: attachment.thread_id,
    attachmentId: attachment.id,
    reason,
  });
  const token = crypto.randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO attachment_view_grants (token, attachment_id, staff_email, access_log_id, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [token, attachment.id, staffEmail, logId, new Date(Date.now() + GRANT_TTL_MS)],
  );
  return token;
}

/**
 * Spend a grant.
 *
 * Deleted as it is redeemed rather than flagged, so a leaked token is worth
 * one view at most and expired rows do not accumulate. A video the browser
 * fetches in several pieces would otherwise need the grant more than once —
 * that is why the stream is not resumable from a spent token and the client
 * asks for a fresh grant instead, which is the honest accounting: one
 * deliberate look, one entry.
 */
export async function redeemGrant(token, staffEmail, attachmentId) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return false;
  const { rows } = await pool.query(
    `DELETE FROM attachment_view_grants
     WHERE token = $1 AND staff_email = $2 AND attachment_id = $3 AND expires_at > now()
     RETURNING token`,
    [token, staffEmail, attachmentId],
  );
  return Boolean(rows[0]);
}

/** Best-effort sweep of grants nobody used. */
export async function sweepGrants() {
  await pool.query('DELETE FROM attachment_view_grants WHERE expires_at < now()').catch(() => {});
}

const DEFAULT_MONTHS = 12;

/**
 * The admin view: everything, with the staff member named.
 */
export async function recentAccesses({ months = DEFAULT_MONTHS, limit = 500, threadId = null } = {}) {
  const params = [months, limit];
  let extra = '';
  if (threadId) {
    params.push(threadId);
    extra = `AND a.thread_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.staff_email, a.kind, a.reason, a.accessed_at, a.attachment_id,
            a.thread_id, r.public_ref
     FROM access_log a
     LEFT JOIN reports r ON r.id = a.report_id
     WHERE a.accessed_at > now() - ($1 || ' months')::interval ${extra}
     ORDER BY a.accessed_at DESC
     LIMIT $2`,
    params,
  );
  return rows;
}

/**
 * The reporter view: the same events, with every trace of WHO removed.
 *
 * staff_email is not selected rather than being selected and dropped later.
 * A field that is never fetched cannot be leaked by a later change to how
 * this is serialized, and naming a specific volunteer to a reporter who is
 * unhappy with a decision is a risk to that volunteer that no amount of
 * care at the display layer would be worth.
 */
export async function accessesForThreads(threadIds, { months = DEFAULT_MONTHS } = {}) {
  if (!threadIds.length) return [];
  const { rows } = await pool.query(
    `SELECT a.thread_id, a.kind, a.reason, a.accessed_at
     FROM access_log a
     WHERE a.thread_id = ANY($1)
       AND a.kind = ANY($2)
       AND a.accessed_at > now() - ($3 || ' months')::interval
     ORDER BY a.accessed_at DESC`,
    [threadIds, REPORTER_VISIBLE_KINDS, months],
  );
  return rows;
}
