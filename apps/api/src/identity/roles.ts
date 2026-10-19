/**
 * Granting a system role, and the record of every time somebody did.
 *
 * WHO MAY GRANT WHAT is decided in @reportlog/access and nowhere else. This
 * module asks it and then makes the change and writes the audit row in ONE
 * TRANSACTION, so the two cannot be separated: a path that could change a
 * role without writing the trail is a path that will one day forget to.
 */
import { canChangeSubject, canGrantSystemRole, isSystemRole } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { normalizeEmail } from './secrets.ts';

export type AuditAxis = 'system' | 'owner' | 'organization' | 'site' | 'flag';

export interface AuditEntry {
  actorEmail: string;
  subjectEmail: string;
  axis: AuditAxis;
  action: 'grant' | 'revoke' | 'change';
  detail: string;
  organizationId?: number;
}

/** Call inside the transaction that made the change, never after it. */
export async function recordRoleChange(trx: Kysely<DB>, entry: AuditEntry): Promise<void> {
  await trx
    .insertInto('role_audit')
    .values({
      actor_email: normalizeEmail(entry.actorEmail),
      subject_email: normalizeEmail(entry.subjectEmail),
      axis: entry.axis,
      action: entry.action,
      detail: entry.detail,
      organization_id: entry.organizationId ?? null,
    })
    .execute();
}

/** The account for an address, made if it has never signed in. Never changes a role. */
export async function ensureUser(
  trx: Kysely<DB>,
  email: string,
): Promise<{ id: number; role: string }> {
  return trx
    .insertInto('users')
    .values({ email: normalizeEmail(email) })
    .onConflict((oc) => oc.column('email').doUpdateSet({ updated_at: new Date() }))
    .returning(['id', 'role'])
    .executeTakeFirstOrThrow();
}

export type SetRoleResult =
  | { ok: true; unchanged: true }
  | { ok: true; unchanged: false; from: SystemRole; to: SystemRole }
  | {
      ok: false;
      reason: 'unknown-role' | 'not-permitted' | 'self' | 'protected-subject' | 'bad-email';
    };

/**
 * Set somebody's system role.
 *
 * The account is created if the address has never signed in: a moderator can
 * be appointed before they have ever logged in, and signing in later keeps
 * the role rather than resetting it.
 */
export async function setSystemRole(
  db: Kysely<DB>,
  {
    actor,
    email,
    role,
  }: { actor: { email: string; role: SystemRole }; email: string; role: string },
): Promise<SetRoleResult> {
  const subjectEmail = normalizeEmail(email);
  if (!isSystemRole(role)) return { ok: false, reason: 'unknown-role' };
  if (!subjectEmail) return { ok: false, reason: 'bad-email' };
  if (!canGrantSystemRole(actor.role, role)) return { ok: false, reason: 'not-permitted' };
  // Changing your own role is how somebody either locks themselves out or
  // promotes themselves; neither should be possible by accident.
  if (subjectEmail === normalizeEmail(actor.email) && role !== actor.role) {
    return { ok: false, reason: 'self' };
  }

  return db.transaction().execute(async (trx): Promise<SetRoleResult> => {
    const existing = await trx
      .selectFrom('users')
      .select('role')
      .where('email', '=', subjectEmail)
      .forUpdate()
      .executeTakeFirst();
    const current: SystemRole = existing && isSystemRole(existing.role) ? existing.role : 'user';
    if (!canChangeSubject(actor.role, current)) return { ok: false, reason: 'protected-subject' };
    if (current === role) return { ok: true, unchanged: true };

    await trx
      .insertInto('users')
      .values({ email: subjectEmail, role })
      .onConflict((oc) => oc.column('email').doUpdateSet({ role, updated_at: new Date() }))
      .execute();

    // Both directions, always. "Revoked moderator, granted admin" reads as
    // two halves of one change, which is what it was.
    if (current !== 'user') {
      await recordRoleChange(trx, {
        actorEmail: actor.email,
        subjectEmail,
        axis: 'system',
        action: 'revoke',
        detail: current,
      });
    }
    if (role !== 'user') {
      await recordRoleChange(trx, {
        actorEmail: actor.email,
        subjectEmail,
        axis: 'system',
        action: 'grant',
        detail: role,
      });
    }
    return { ok: true, unchanged: false, from: current, to: role };
  });
}
