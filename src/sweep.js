/**
 * Deleting rows that expired.
 *
 * Four tables hold short-lived secrets — a sign-in code, a session, a token
 * that lets somebody confirm one report, a token that lifts the curtain.
 * Every one of them is CHECKED against `expires_at` at the moment it is
 * used, so an expired row has never been accepted and this is not a
 * security fix. What it fixes is that they were never deleted: the rows sat
 * there indefinitely, and a table of dead credentials that only grows is a
 * thing to hand an adversary who gets a copy of the database, and a thing
 * to explain to anybody asking what is retained and for how long.
 *
 * NONE OF THESE IS APPEND-ONLY. That is not an accident of which tables got
 * triggers: the archive is append-only because the record must be
 * permanent, and an expired sign-in code is not the record. The append-only
 * tables — reports, attachments, the access log, the audit trails, the
 * consent texts — are guarded against exactly this operation and are not
 * touched here. `sweepExpired` names its four tables explicitly rather than
 * scanning for an `expires_at` column, so a future table cannot be swept
 * merely because it happens to have one.
 */
import { pool } from './db.js';

// Named, never discovered. A list is reviewable; a scan is a rule nobody
// reads that quietly picks up whatever matches it next.
export const SWEPT = [
  ['otp_codes', 'one-time sign-in codes'],
  ['self_sessions', 'sessions'],
  ['report_submission_tokens', 'report confirmation links'],
  ['site_access_tokens', 'site password tokens'],
];

/**
 * Best-effort, and deliberately one statement per table.
 *
 * A single transaction over all four would mean one locked table stops the
 * other three being tidied, for no gain: these are independent, and there
 * is nothing to be consistent about between them.
 */
export async function sweepExpired({ client = pool } = {}) {
  const removed = {};
  for (const [table] of SWEPT) {
    try {
      const { rowCount } = await client.query(`DELETE FROM ${table} WHERE expires_at < now()`);
      removed[table] = rowCount;
    } catch (e) {
      // Reported rather than thrown. This runs on a timer beside the
      // anchor, and a failure to tidy must never be able to take anything
      // else down with it.
      removed[table] = { error: e.message };
    }
  }
  return removed;
}
