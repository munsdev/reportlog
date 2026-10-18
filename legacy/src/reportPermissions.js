/**
 * Two permissions a reporter gives and takes back, and the projection that
 * says what they currently are.
 *
 * NOT PART OF THE RECORD. Nothing here is hashed, nothing here is chained,
 * and `reportCore.js` and `verify.js` must never import this file. The
 * publication question a reporter answered at filing is `may_publish` and it
 * IS sealed, because a sealed answer must never change. These two are
 * ongoing permissions that exist to be changed, so they live where changing
 * them is recorded instead.
 *
 * THE CURRENT VALUE IS A PROJECTION, never a stored flag. The newest row for
 * a thread and a permission wins. A mutable column was not the worse of two
 * options here — it was impossible: its natural home, `reports_restricted`,
 * refuses UPDATE by trigger. See `migrations/030_report_permissions.sql`.
 *
 * NO ROWS MEANS NOT GRANTED. Every thread that existed before migration 030
 * reads as neither permission given, which is the safe direction and needs
 * no backfill.
 */
import { pool } from './db.js';

/** May a moderator pass this reporter's contact details to somebody asking
 *  to follow up. Ratified 29 September. */
export const CONTACT_PASSING = 'contact_passing';

/** May the files attached to this report be published. A second layer on top
 *  of `may_publish`, which covers the report itself. */
export const ATTACHMENT_PUBLICATION = 'attachment_publication';

/**
 * May an editor come back and ask for the evidence this reporter said they
 * had. Added 4 October with the evidence declaration.
 *
 * NOT THE DECLARATION ITSELF, and the split is the point. What somebody said
 * they had at the moment they filed is a fact about the filing: it is a
 * logbook's question, it is sealed with every other answer, and it can never
 * change. Whether they are willing to be contacted about it is an ongoing
 * grant that exists to be taken back, so it lives here where taking it back
 * is recorded.
 *
 * Folding the two together — one checkbox meaning both "I have footage" and
 * "ask me about it" — would put a revocable value inside the fingerprint, and
 * a report would verify differently because somebody changed their mind about
 * being contacted. That is the same mistake `may_publish` versus this log
 * already settles one layer down.
 */
export const EVIDENCE_REQUEST = 'evidence_request';

/** All three, in the order a reporter is shown them. The database constrains
 *  this list too, so an unknown name is refused there as well as here. */
export const PERMISSIONS = [CONTACT_PASSING, ATTACHMENT_PUBLICATION, EVIDENCE_REQUEST];

/** Not granted, for a thread with no rows. Written once so no caller invents
 *  its own shape and no caller defaults one of them to true by accident. */
export const NONE_GRANTED = Object.freeze(
  PERMISSIONS.reduce((o, p) => ({ ...o, [p]: false }), {}),
);

export function isPermission(name) {
  return PERMISSIONS.includes(name);
}

/**
 * What both permissions currently are, for one thread.
 *
 * `DISTINCT ON` with the index's own ordering, so this is one index scan per
 * permission rather than a scan of the thread's history.
 */
export async function permissionsFor(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (permission) permission, granted
     FROM report_permissions_log
     WHERE thread_id = $1
     ORDER BY permission, id DESC`,
    [threadId],
  );
  const out = { ...NONE_GRANTED };
  for (const r of rows) out[r.permission] = r.granted;
  return out;
}

/**
 * The same, for a list of threads, because My Reports draws every report a
 * person filed and one query per card is how a list view gets slow quietly.
 * Returns a Map; a thread with no rows is absent from it, so read it through
 * `permissionsFor`-shaped defaults.
 */
export async function permissionsForMany(threadIds, client = pool) {
  const out = new Map();
  if (!threadIds || !threadIds.length) return out;
  const { rows } = await client.query(
    `SELECT DISTINCT ON (thread_id, permission) thread_id, permission, granted
     FROM report_permissions_log
     WHERE thread_id = ANY($1::uuid[])
     ORDER BY thread_id, permission, id DESC`,
    [threadIds],
  );
  for (const r of rows) {
    if (!out.has(r.thread_id)) out.set(r.thread_id, { ...NONE_GRANTED });
    out.get(r.thread_id)[r.permission] = r.granted;
  }
  return out;
}

/** Both permissions as a plain object for a thread, from a prepared Map. */
export function fromMap(map, threadId) {
  return map.get(threadId) || { ...NONE_GRANTED };
}

/**
 * Record a grant or a revocation.
 *
 * Only ever called for the reporter. A moderator granting a permission on
 * somebody's behalf would write the operator's decision under the reporter's
 * name, which is exactly what this log exists to make impossible — the
 * table's own CHECK constraint says `actor = 'reporter'` so that the rule is
 * stated where it cannot be forgotten by a new route.
 *
 * `actorEmail` is NULL on a thread whose contact details can be erased, the
 * same rule `self_service_log` follows: this table is append-only, so an
 * address written into it would outlive the erasure it was meant to honour.
 */
export async function setPermission(
  { threadId, permission, granted, actorEmail = null, reason = null }, client = pool,
) {
  if (!isPermission(permission)) throw new Error(`unknown permission: ${permission}`);
  const { rows } = await client.query(
    `INSERT INTO report_permissions_log (thread_id, permission, granted, actor_email, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [threadId, permission, granted === true, actorEmail, reason || null],
  );
  return rows[0];
}

/**
 * Every grant and revocation for a thread, newest first — what the reporter
 * is shown so the permission is not a switch with no memory.
 */
export async function permissionHistory(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT permission, granted, reason, created_at
     FROM report_permissions_log
     WHERE thread_id = $1
     ORDER BY id DESC`,
    [threadId],
  );
  return rows;
}
