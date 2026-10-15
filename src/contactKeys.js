/**
 * A reporter's contact details, sealed so they can be erased.
 *
 * reports_restricted is append-only by trigger, and stays that way. A new
 * report's details are encrypted under a key of their own; that key is
 * wrapped by the master key and kept in `contact_keys`, which may delete.
 * Erasing is deleting the key: the ciphertext in reports_restricted is never
 * touched and can never be read again. The keyed digest of the email — how
 * My Reports finds a person's reports — lives beside the key for the same
 * reason, so after an erasure nothing links the report to an address.
 *
 * Rows filed before migration 029 have key_scheme NULL and are under the
 * master key directly. They read exactly as before and cannot be erased
 * without breaking the append-only rule; withdrawal still works for them.
 */
import { pool } from './db.js';
import {
  generateDek, wrapDek, unwrapDek, encryptBuffer, decryptBuffer, decryptField, hmacEmail,
} from './crypto.js';

/**
 * Write a thread's contact details. Call inside the transaction that files
 * the report, after its report_heads row exists.
 */
export async function sealRestricted(client, { threadId, org = null, observerId = null, email = null }) {
  const dek = generateDek();
  await client.query(
    'INSERT INTO contact_keys (thread_id, dek_wrapped, contact_email_hmac) VALUES ($1, $2, $3)',
    [threadId, wrapDek(dek), email ? hmacEmail(email) : null],
  );
  const enc = (v) => (v === null || v === undefined || v === ''
    ? null : encryptBuffer(Buffer.from(String(v), 'utf8'), dek));
  await client.query(
    `INSERT INTO reports_restricted
       (thread_id, observer_org_enc, observer_id_enc, observer_contact_enc, contact_email_hmac, key_scheme)
     VALUES ($1, $2, $3, $4, NULL, 'thread')`,
    [threadId, enc(org), enc(observerId), enc(email)],
  );
}

/**
 * Decrypt a reports_restricted row, whichever way it was sealed. `erased`
 * is true when the row's key has been destroyed.
 */
export async function openRestricted(row, client = pool) {
  if (row.key_scheme !== 'thread') {
    return {
      org: decryptField(row.observer_org_enc),
      observer_id: decryptField(row.observer_id_enc),
      contact: decryptField(row.observer_contact_enc),
      erased: false,
    };
  }
  const { rows } = await client.query(
    'SELECT dek_wrapped FROM contact_keys WHERE thread_id = $1', [row.thread_id],
  );
  if (!rows[0]) return { org: null, observer_id: null, contact: null, erased: true };
  const dek = unwrapDek(rows[0].dek_wrapped);
  const dec = (v) => (v ? decryptBuffer(v, dek).toString('utf8') : null);
  return {
    org: dec(row.observer_org_enc),
    observer_id: dec(row.observer_id_enc),
    contact: dec(row.observer_contact_enc),
    erased: false,
  };
}

/**
 * The email digest a thread belongs to, for either kind of row. Joined as
 * `LEFT JOIN contact_keys ck ON ck.thread_id = rr.thread_id`.
 */
export const OWNER_HMAC = 'coalesce(ck.contact_email_hmac, rr.contact_email_hmac)';

/** Whether this thread's contact details can be erased at all. */
export async function isErasable(threadId, client = pool) {
  const { rows } = await client.query(
    'SELECT key_scheme FROM reports_restricted WHERE thread_id = $1', [threadId],
  );
  return rows[0]?.key_scheme === 'thread';
}

/**
 * Destroy a thread's contact key, and the confirmation-link rows that still
 * hold the address in the clear. Returns whether a key was destroyed.
 */
export async function eraseContact(client, threadId) {
  const { rowCount } = await client.query('DELETE FROM contact_keys WHERE thread_id = $1', [threadId]);
  await client.query('DELETE FROM report_submission_tokens WHERE thread_id = $1', [threadId]);
  return rowCount > 0;
}
