/**
 * Erasure on request, for a format with no accounts.
 *
 * A list entry has no login and no identity tier, so the only thing that
 * can prove somebody owns one is a secret mailed to the address on it.
 * Reports solve the same problem with per-report contact keys
 * (src/contactKeys.js); there is no report here to key anything to.
 *
 * THE TOKEN IS STORED HASHED, unlike report_submission_tokens, and this is
 * the better of the two patterns: a copy of this table must not let whoever
 * holds it erase other people's submissions.
 *
 * A PATH THAT ONLY RUNS WHEN SOMEBODY CLICKS A LINK IN AN EMAIL IS A PATH
 * NOTHING REACHES BY ACCIDENT. Report confirmation was broken in production
 * for three days under three green suites for exactly that reason. This one
 * is aimed at deliberately by scripts/lists-selftest.mjs.
 */
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { sha256Hex } from '../crypto.js';
import { ERASABLE_COLUMNS, erasureExpiry } from './policy.js';

export { ERASABLE_COLUMNS, erasureExpiry };

/**
 * Mint a link. Returns the PLAINTEXT token, which goes into the email and
 * is never stored.
 */
export async function mintErasureToken(
  { entryId, personalExpiresAt = null },
  { client = pool, now = new Date(), env = process.env } = {},
) {
  const token = crypto.randomBytes(32).toString('base64url');
  await client.query(
    'INSERT INTO list_erasures (token_hash, entry_id, expires_at) VALUES ($1, $2, $3)',
    [sha256Hex(token), entryId, erasureExpiry(personalExpiresAt, now, env)],
  );
  return token;
}

/**
 * Redeem one. Erases the erasable half in place and leaves the row standing
 * — the links stay, the text and the contact details go.
 *
 * An expired, unknown or already-used token all answer the same way on
 * purpose: somebody probing tokens learns nothing from which one it was.
 */
export async function redeemErasureToken(token, { client = pool } = {}) {
  if (!token) return { ok: false, reason: 'no-token' };
  const hash = sha256Hex(String(token));
  const { rows } = await client.query(
    'SELECT entry_id, used_at, expires_at FROM list_erasures WHERE token_hash = $1', [hash],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not-found' };
  if (row.used_at) return { ok: false, reason: 'not-found' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'not-found' };

  await erasePersonal(row.entry_id, { client });
  await client.query('UPDATE list_erasures SET used_at = now() WHERE token_hash = $1', [hash]);
  return { ok: true, entryId: Number(row.entry_id) };
}

/**
 * Blank the erasable columns and mark the entry erased.
 *
 * One statement, so there is no window in which `erased_at` is set and the
 * columns are not — which the table's CHECK would refuse anyway, and that
 * refusal is the backstop rather than the plan.
 */
export async function erasePersonal(entryId, { client = pool } = {}) {
  const sets = ERASABLE_COLUMNS.map((c) => `${c} = NULL`).join(', ');
  const { rowCount } = await client.query(
    `UPDATE list_entries SET ${sets}, erased_at = now()
      WHERE id = $1 AND erased_at IS NULL`,
    [entryId],
  );
  return rowCount;
}
