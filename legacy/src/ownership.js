/**
 * Handing the owner's seat on, with both parties agreeing.
 *
 * WHY BOTH. Every other role change here is one-sided, and that is right:
 * an appointment nobody accepts simply sits there costing nothing, and
 * pre-authorising by email is a deliberate feature — somebody can be made a
 * moderator before they have ever signed in.
 *
 * Ownership is the one move whose failure is permanent. Only the owner
 * mints administrators and only the owner transfers, so handing the seat to
 * a typo, a dead mailbox or somebody who has left leaves the deployment
 * with no way back that does not involve a shell and hand-written SQL —
 * which is the state this whole feature exists to end. Consent belongs
 * where the failure cannot be undone, and nowhere else.
 *
 * The seat is NOT grantable through `setSystemRole`: 'owner' appears in no
 * row of MAY_GRANT. It moves here, or the setup wizard mints the first one.
 * That is what stops a rank above admin from handing itself out.
 */
import { pool } from './db.js';
import { normalizeEmail, hmacEmail } from './crypto.js';
import { recordRoleChange } from './roles.js';

/** How long a proposal stands before it lapses. */
export const TRANSFER_TTL_DAYS = 7;

/** The one pending handoff, or null. Expired ones are not pending. */
export async function pendingTransfer(client = pool) {
  const { rows } = await client.query(
    'SELECT from_email, to_email, created_at, expires_at FROM ownership_transfers WHERE id = true',
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) return null;
  return row;
}

/** Whoever currently holds the seat, or null on a deployment that has none. */
export async function currentOwner(client = pool) {
  const { rows } = await client.query("SELECT email FROM users WHERE role = 'owner'");
  return rows[0]?.email || null;
}

/**
 * Propose handing the seat to somebody.
 *
 * Replaces any existing proposal rather than refusing — there is at most
 * one, and an owner who changes their mind should not have to find a cancel
 * button first. The account is NOT created here: unlike an appointment,
 * this confers nothing until it is accepted, so there is nothing to
 * pre-authorise and no reason to leave a row behind if it lapses.
 */
export async function proposeTransfer({ actor, email }) {
  const toEmail = normalizeEmail(email);
  if (actor.role !== 'owner') return { ok: false, reason: 'not-owner' };
  if (!toEmail) return { ok: false, reason: 'bad-email' };
  if (toEmail === normalizeEmail(actor.email)) return { ok: false, reason: 'self' };

  const expires = new Date(Date.now() + TRANSFER_TTL_DAYS * 86400_000);
  await pool.query(
    `INSERT INTO ownership_transfers (id, from_email, to_email, to_email_hmac, created_at, expires_at)
     VALUES (true, $1, $2, $3, now(), $4)
     ON CONFLICT (id) DO UPDATE
       SET from_email = EXCLUDED.from_email, to_email = EXCLUDED.to_email,
           to_email_hmac = EXCLUDED.to_email_hmac, created_at = now(),
           expires_at = EXCLUDED.expires_at`,
    [normalizeEmail(actor.email), toEmail, hmacEmail(toEmail), expires],
  );
  return { ok: true, to: toEmail, expiresAt: expires.toISOString() };
}

/** The owner changes their mind. Idempotent. */
export async function cancelTransfer({ actor }) {
  if (actor.role !== 'owner') return { ok: false, reason: 'not-owner' };
  await pool.query('DELETE FROM ownership_transfers WHERE id = true');
  return { ok: true };
}

/**
 * The recipient accepts, and the seat moves.
 *
 * ONE TRANSACTION, and the order inside it is forced by the database: the
 * partial unique index permits only one owner, so the outgoing owner must
 * be stepped down before the incoming one is raised. A swap that half
 * applied would otherwise leave either two owners or none, and "none" is
 * unrecoverable.
 *
 * THE OUTGOING OWNER BECOMES AN ADMIN, not a user. Dropping the person who
 * installed the deployment to 'user' mid-handover would strand them outside
 * the pages they were using a second ago. Demoting them further is the new
 * owner's call, deliberately, in a second act.
 */
export async function acceptTransfer({ actor }) {
  const actorEmail = normalizeEmail(actor.email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');

    const { rows } = await client.query(
      'SELECT from_email, to_email, expires_at FROM ownership_transfers WHERE id = true FOR UPDATE',
    );
    const t = rows[0];
    if (!t) { await client.query('ROLLBACK'); return { ok: false, reason: 'none-pending' }; }
    if (new Date(t.expires_at) <= new Date()) {
      await client.query('DELETE FROM ownership_transfers WHERE id = true');
      await client.query('COMMIT');
      return { ok: false, reason: 'expired' };
    }
    if (normalizeEmail(t.to_email) !== actorEmail) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-yours' };
    }

    // Re-read the seat inside the lock rather than trusting the proposal:
    // the owner may have changed since it was written.
    const { rows: owners } = await client.query("SELECT email FROM users WHERE role = 'owner'");
    const outgoing = owners[0]?.email || null;

    if (outgoing) {
      await client.query(
        "UPDATE users SET role = 'admin', updated_at = now() WHERE email = $1",
        [outgoing],
      );
    }
    await client.query(
      `INSERT INTO users (email, email_hmac, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (email) DO UPDATE SET role = 'owner', updated_at = now()`,
      [actorEmail, hmacEmail(actorEmail)],
    );
    await client.query('DELETE FROM ownership_transfers WHERE id = true');

    // Both halves of the move, on their own axis. "Revoked owner, granted
    // owner" reads as one handover rather than two unrelated events.
    if (outgoing) {
      await recordRoleChange(client, {
        actorEmail, subjectEmail: outgoing, axis: 'owner', action: 'revoke', detail: 'owner -> admin',
      });
    }
    await recordRoleChange(client, {
      actorEmail, subjectEmail: actorEmail, axis: 'owner', action: 'grant', detail: 'owner',
    });

    await client.query('COMMIT');
    return { ok: true, from: outgoing, to: actorEmail };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The subject a handover's one-time code is stored under.
 *
 * BOTH ADDRESSES, so a code is bound to the pair it was minted for. The code
 * used to be keyed on the owner's address alone, which proved only that the
 * owner was at the keyboard: a code requested while meaning to hand the seat
 * to one person would hand it to anybody typed in afterwards, and the email
 * announcing it could name nobody at all.
 *
 * The point of emailing the owner is the RECORD it leaves — a message in their
 * mailbox saying this deployment went to this address at this time. That record
 * is only true if the seat cannot then go somewhere else on the same code. So a
 * code minted for one recipient does not verify for another, and changing the
 * recipient means a new code and a new email saying where it went.
 *
 * HERE RATHER THAN IN THE ROUTE so the route and the suite compute it with the
 * same function. A test that rebuilt this formula would pass while the route
 * used a different one.
 *
 * NUL as the separator because it cannot occur in either address, so no pair
 * can collide with another pair by concatenation.
 */
export function handoverCodeSubject(ownerEmail, recipientEmail) {
  const owner = normalizeEmail(ownerEmail);
  const to = normalizeEmail(recipientEmail);
  return hmacEmail(`${owner}\u0000handover\u0000${to}`);
}
