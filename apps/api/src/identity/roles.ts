/**
 * Granting a system role, and the record of every time somebody did.
 *
 * WHO MAY GRANT WHAT is decided in @reportlog/access and nowhere else. This
 * module asks it and then makes the change and writes the audit row in ONE
 * TRANSACTION, so the two cannot be separated: a path that could change a
 * role without writing the trail is a path that will one day forget to.
 */
import {
  STAFF_ROLES,
  canChangeSubject,
  canGrantSystemRole,
  canHoldTogether,
  isSystemRole,
  toRoleSet,
} from '@reportlog/access';
import type { HeldRole, SystemRole } from '@reportlog/access';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { normalizeEmail } from './secrets.ts';

export type AuditAxis = 'system' | 'owner' | 'organization' | 'site' | 'flag' | 'second_factor';

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
): Promise<{ id: number; roles: HeldRole[] }> {
  const row = await trx
    .insertInto('users')
    .values({ email: normalizeEmail(email) })
    .onConflict((oc) => oc.column('email').doUpdateSet({ updated_at: new Date() }))
    .returning(['id', 'roles'])
    .executeTakeFirstOrThrow();
  return { id: row.id, roles: toRoleSet(row.roles) };
}

/**
 * The set after adding one role. Taking a staff seat (the owner's, by
 * handover or first-run setup) drops a journalist role, because a journalist
 * holds no staff role and the database refuses the pair (decision 70).
 */
export function withRole(roles: readonly HeldRole[], role: HeldRole): HeldRole[] {
  const base = (STAFF_ROLES as readonly string[]).includes(role)
    ? roles.filter((r) => r !== 'journalist')
    : [...roles];
  return base.includes(role) ? base : [...base, role];
}

export type ChangeRoleResult =
  | { ok: true; unchanged: boolean; roles: HeldRole[] }
  | {
      ok: false;
      reason:
        | 'unknown-role'
        | 'not-permitted'
        | 'self'
        | 'protected-subject'
        | 'bad-email'
        | 'cannot-combine';
    };

/**
 * Grant or revoke ONE system role. Roles are changed one at a time, each with
 * its own audit row, under the same ceiling (decision 70): the actor needs
 * `canGrantSystemRole` for the role being added or taken away, and
 * `canChangeSubject` protects the owner's seat, administrators and journalists.
 *
 * The account is created if the address has never signed in: a moderator can
 * be appointed before they have ever logged in, and signing in later keeps
 * the role rather than resetting it.
 */
export async function changeSystemRole(
  db: Kysely<DB>,
  {
    actor,
    email,
    role,
    action,
  }: {
    actor: { email: string; roles: readonly SystemRole[] };
    email: string;
    role: string;
    action: 'grant' | 'revoke';
  },
): Promise<ChangeRoleResult> {
  const subjectEmail = normalizeEmail(email);
  // `user` is no role at all, so there is nothing to grant or revoke.
  if (!isSystemRole(role) || role === 'user') return { ok: false, reason: 'unknown-role' };
  if (!subjectEmail) return { ok: false, reason: 'bad-email' };
  if (!canGrantSystemRole(actor.roles, role)) return { ok: false, reason: 'not-permitted' };
  if (!canChangeSubject(actor.roles, role)) return { ok: false, reason: 'protected-subject' };

  return db.transaction().execute(async (trx): Promise<ChangeRoleResult> => {
    const existing = await trx
      .selectFrom('users')
      .select('roles')
      .where('email', '=', subjectEmail)
      .forUpdate()
      .executeTakeFirst();
    const current = toRoleSet(existing?.roles);
    const has = current.includes(role);
    if (action === 'grant' ? has : !has) return { ok: true, unchanged: true, roles: current };
    // Changing your own roles is how somebody either locks themselves out or
    // promotes themselves; neither should be possible by accident.
    if (subjectEmail === normalizeEmail(actor.email)) return { ok: false, reason: 'self' };

    const next = action === 'grant' ? [...current, role] : current.filter((r) => r !== role);
    // Refused here with a sentence; the CHECK on users.roles is what holds if
    // a path forgets to ask.
    if (!canHoldTogether(next)) return { ok: false, reason: 'cannot-combine' };

    await trx
      .insertInto('users')
      .values({ email: subjectEmail, roles: next })
      .onConflict((oc) => oc.column('email').doUpdateSet({ roles: next, updated_at: new Date() }))
      .execute();
    await recordRoleChange(trx, {
      actorEmail: actor.email,
      subjectEmail,
      axis: 'system',
      action,
      detail: role,
    });
    return { ok: true, unchanged: false, roles: next };
  });
}
