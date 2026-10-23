/**
 * Handing the owner's seat on, with both parties agreeing.
 *
 * Every other role change is one-sided, and that is right: an appointment
 * nobody uses costs nothing. Ownership is the one move whose failure is
 * permanent. Only the owner appoints administrators and only the owner hands
 * the seat on, so giving it to a typo or a dead mailbox leaves a deployment
 * nobody can run without a shell. Consent belongs where the failure cannot
 * be undone.
 *
 * The seat is not grantable: 'owner' is in no row of MAY_GRANT. It moves
 * here, or the setup wizard seats the first one.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { toRoleSet } from '@reportlog/access';
import { recordRoleChange, withRole } from './roles.ts';
import { looksLikeEmail, normalizeEmail } from './secrets.ts';

/** How long an offer stands before it lapses. */
export const TRANSFER_TTL_DAYS = 7;

export interface PendingTransfer {
  from_email: string;
  to_email: string;
  created_at: Date;
  expires_at: Date;
}

/** The one live offer, or null. An expired offer is not pending. */
export async function pendingTransfer(db: Kysely<DB>): Promise<PendingTransfer | null> {
  const row = await db
    .selectFrom('ownership_transfers')
    .select(['from_email', 'to_email', 'created_at', 'expires_at'])
    .where('id', '=', true)
    .executeTakeFirst();
  if (!row || row.expires_at <= new Date()) return null;
  return row;
}

export async function currentOwner(db: Kysely<DB>): Promise<string | null> {
  const row = await db
    .selectFrom('users')
    .select('email')
    .where(sql<boolean>`roles @> ARRAY['owner']::text[]`)
    .executeTakeFirst();
  return row?.email ?? null;
}

interface Actor {
  email: string;
  roles: readonly string[];
}

/**
 * Offer the seat. Replaces any earlier offer rather than refusing: there is
 * at most one, and an owner who changes their mind should not have to find a
 * cancel button first. No account is made: an offer confers nothing until it
 * is accepted.
 */
export async function proposeTransfer(
  db: Kysely<DB>,
  { actor, email }: { actor: Actor; email: string },
): Promise<
  | { ok: true; to: string; expiresAt: Date }
  | { ok: false; reason: 'not-owner' | 'bad-email' | 'self' }
> {
  const to = normalizeEmail(email);
  if (!actor.roles.includes('owner')) return { ok: false, reason: 'not-owner' };
  if (!looksLikeEmail(to)) return { ok: false, reason: 'bad-email' };
  if (to === normalizeEmail(actor.email)) return { ok: false, reason: 'self' };
  const expiresAt = new Date(Date.now() + TRANSFER_TTL_DAYS * 86_400_000);
  await db
    .insertInto('ownership_transfers')
    .values({
      id: true,
      from_email: normalizeEmail(actor.email),
      to_email: to,
      expires_at: expiresAt,
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({
        from_email: normalizeEmail(actor.email),
        to_email: to,
        created_at: new Date(),
        expires_at: expiresAt,
      }),
    )
    .execute();
  return { ok: true, to, expiresAt };
}

export async function cancelTransfer(
  db: Kysely<DB>,
  { actor }: { actor: Actor },
): Promise<{ ok: true } | { ok: false; reason: 'not-owner' }> {
  if (!actor.roles.includes('owner')) return { ok: false, reason: 'not-owner' };
  await db.deleteFrom('ownership_transfers').where('id', '=', true).execute();
  return { ok: true };
}

/**
 * The person offered the seat accepts, and it moves.
 *
 * ONE TRANSACTION, in an order the database forces: only one owner may
 * exist, so the outgoing owner steps down before the incoming one is raised.
 * Nobody outside the transaction ever sees two owners or none.
 *
 * THE OUTGOING OWNER BECOMES AN ADMIN, not a user, so the person who set the
 * deployment up is not stranded outside the pages they were using a moment
 * ago. Demoting them further is the new owner's call, in a second act.
 */
export async function acceptTransfer(
  db: Kysely<DB>,
  { actor }: { actor: { email: string } },
): Promise<
  | { ok: true; from: string | null; to: string }
  | { ok: false; reason: 'none-pending' | 'expired' | 'not-yours' }
> {
  const me = normalizeEmail(actor.email);
  // An expired offer is deleted on the way out, and that deletion must stick
  // even though the answer is a refusal; so it is decided first, then acted on.
  const outcome = await db.transaction().execute(async (trx) => {
    await sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`.execute(trx);
    const offer = await trx
      .selectFrom('ownership_transfers')
      .select(['to_email', 'expires_at'])
      .where('id', '=', true)
      .forUpdate()
      .executeTakeFirst();
    if (!offer) return { ok: false as const, reason: 'none-pending' as const };
    if (offer.expires_at <= new Date()) {
      await trx.deleteFrom('ownership_transfers').where('id', '=', true).execute();
      return { ok: false as const, reason: 'expired' as const };
    }
    if (offer.to_email !== me) return { ok: false as const, reason: 'not-yours' as const };

    // The seat as it is now, inside the lock, not as it was when offered.
    const outgoing = await currentOwner(trx);
    // The seat is emptied before it is filled (one owner, by a unique index).
    // The outgoing owner steps down to administrator and keeps any other role.
    if (outgoing) {
      const before = await trx
        .selectFrom('users')
        .select('roles')
        .where('email', '=', outgoing)
        .executeTakeFirstOrThrow();
      const stepped = withRole(
        toRoleSet(before.roles).filter((r) => r !== 'owner'),
        'admin',
      );
      await trx
        .updateTable('users')
        .set({ roles: stepped, updated_at: new Date() })
        .where('email', '=', outgoing)
        .execute();
    }
    const incoming = await trx
      .selectFrom('users')
      .select('roles')
      .where('email', '=', me)
      .executeTakeFirst();
    const incomingBefore = toRoleSet(incoming?.roles);
    const incomingAfter = withRole(incomingBefore, 'owner');
    await trx
      .insertInto('users')
      .values({ email: me, roles: incomingAfter })
      .onConflict((oc) =>
        oc.column('email').doUpdateSet({ roles: incomingAfter, updated_at: new Date() }),
      )
      .execute();
    // The seat is staff, so a journalist role cannot ride along with it: say so on the record.
    if (incomingBefore.includes('journalist')) {
      await recordRoleChange(trx, {
        actorEmail: me,
        subjectEmail: me,
        axis: 'system',
        action: 'revoke',
        detail: 'journalist (took the owner’s seat)',
      });
    }
    await trx.deleteFrom('ownership_transfers').where('id', '=', true).execute();

    if (outgoing) {
      await recordRoleChange(trx, {
        actorEmail: me,
        subjectEmail: outgoing,
        axis: 'owner',
        action: 'revoke',
        detail: 'owner -> admin',
      });
    }
    await recordRoleChange(trx, {
      actorEmail: me,
      subjectEmail: me,
      axis: 'owner',
      action: 'grant',
      detail: 'owner',
    });
    return { ok: true as const, from: outgoing, to: me };
  });
  return outcome;
}
