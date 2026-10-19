/**
 * Organizations, their people, and the rules that keep them contained.
 *
 *   Managers cannot make managers. Only an administrator or an Access Manager
 *   does, or a compromised manager account entrenches itself.
 *
 *   An organization always has a manager. A removal that would leave it with
 *   none is refused: an organization nobody can run needs an administrator to
 *   rescue it, which is the work delegating was meant to avoid.
 *
 *   Removal looks forward only. Somebody who leaves keeps everything already
 *   filed under the organization's name; leaving must not edit the record.
 */
import { ORG_ROLES } from '@reportlog/access';
import type { OrgRole } from '@reportlog/access';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { recordRoleChange } from './roles.ts';
import { looksLikeEmail, normalizeEmail } from './secrets.ts';

interface Actor {
  email: string;
}

/** Blank is not a description: it is stored as none. */
function textOrNull(value: string | undefined): string | null {
  const t = value?.trim();
  return t === undefined || t === '' ? null : t;
}

export function isOrgRole(v: unknown): v is OrgRole {
  return ORG_ROLES.includes(v as OrgRole);
}

export async function listOrganizations(db: Kysely<DB>) {
  return db
    .selectFrom('organizations as o')
    .leftJoin('organization_memberships as m', 'm.organization_id', 'o.id')
    .select((eb) => [
      'o.id',
      'o.name',
      'o.details',
      'o.created_at',
      eb.fn.count<number>('m.id').filterWhere('m.role', '=', 'manager').as('manager_count'),
      eb.fn.count<number>('m.id').filterWhere('m.role', '=', 'coordinator').as('coordinator_count'),
    ])
    .groupBy('o.id')
    .orderBy('o.name')
    .execute();
}

export async function organizationName(db: Kysely<DB>, id: number): Promise<string | null> {
  const row = await db
    .selectFrom('organizations')
    .select('name')
    .where('id', '=', id)
    .executeTakeFirst();
  return row?.name ?? null;
}

/** Thrown inside a transaction to roll it back; turned into a refusal. */
class LastManager extends Error {}

/**
 * The address already has an account: the membership attaches now. It has
 * not: it waits as `joins_on_sign_in` and attaches the first time they sign
 * in. Only for administrators adding somebody directly; a manager invites.
 */
async function attachOrInvite(
  trx: Kysely<DB>,
  args: {
    actor: Actor;
    organizationId: number;
    organizationName: string;
    email: string;
    role: OrgRole;
  },
): Promise<{ pending: boolean }> {
  const user = await trx
    .selectFrom('users')
    .select('id')
    .where('email', '=', args.email)
    .executeTakeFirst();
  if (user) {
    const existing = await trx
      .selectFrom('organization_memberships')
      .select(['id', 'role'])
      .where('organization_id', '=', args.organizationId)
      .where('user_id', '=', user.id)
      .forUpdate()
      .executeTakeFirst();
    if (existing?.role === args.role) return { pending: false };
    if (existing) {
      // A change of role, not a new grant. Demoting a manager goes through the
      // same last-manager rule as removing one, and the trail says both halves.
      if (existing.role === 'manager') {
        await trx
          .selectFrom('organization_memberships')
          .select('id')
          .where('organization_id', '=', args.organizationId)
          .where('role', '=', 'manager')
          .forUpdate()
          .execute();
        const others = await trx
          .selectFrom('organization_memberships')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('organization_id', '=', args.organizationId)
          .where('role', '=', 'manager')
          .where('id', '<>', existing.id)
          .executeTakeFirstOrThrow();
        if (others.n === 0) throw new LastManager();
      }
      await trx
        .updateTable('organization_memberships')
        .set({ role: args.role })
        .where('id', '=', existing.id)
        .execute();
      await recordRoleChange(trx, {
        actorEmail: args.actor.email,
        subjectEmail: args.email,
        axis: 'organization',
        action: 'revoke',
        detail: `${existing.role} of ${args.organizationName}`,
        organizationId: args.organizationId,
      });
    } else {
      await trx
        .insertInto('organization_memberships')
        .values({ organization_id: args.organizationId, user_id: user.id, role: args.role })
        .execute();
    }
    await trx
      .deleteFrom('organization_invites')
      .where('organization_id', '=', args.organizationId)
      .where('email', '=', args.email)
      .execute();
  } else {
    await trx
      .insertInto('organization_invites')
      .values({
        organization_id: args.organizationId,
        email: args.email,
        role: args.role,
        status: 'joins_on_sign_in',
        invited_by: normalizeEmail(args.actor.email),
      })
      .onConflict((oc) =>
        oc.columns(['organization_id', 'email']).doUpdateSet({
          role: args.role,
          status: 'joins_on_sign_in',
          token_hash: null,
          expires_at: null,
        }),
      )
      .execute();
  }
  await recordRoleChange(trx, {
    actorEmail: args.actor.email,
    subjectEmail: args.email,
    axis: 'organization',
    action: 'grant',
    detail: `${args.role} of ${args.organizationName}`,
    organizationId: args.organizationId,
  });
  return { pending: !user };
}

export async function createOrganization(
  db: Kysely<DB>,
  {
    actor,
    name,
    details,
    managerEmails,
  }: { actor: Actor; name: string; details?: string; managerEmails: string[] },
): Promise<
  | { ok: true; organization: { id: number; name: string } }
  | { ok: false; reason: 'name-required' | 'manager-required' | 'name-taken' | 'bad-email' }
> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'name-required' };
  const emails = [...new Set(managerEmails.map(normalizeEmail).filter(Boolean))];
  if (!emails.length) return { ok: false, reason: 'manager-required' };
  if (!emails.every(looksLikeEmail)) return { ok: false, reason: 'bad-email' };

  return db.transaction().execute(async (trx) => {
    const org = await trx
      .insertInto('organizations')
      .values({
        name: trimmed,
        details: textOrNull(details),
        verified_by: normalizeEmail(actor.email),
      })
      .onConflict((oc) => oc.column('name').doNothing())
      .returning(['id', 'name'])
      .executeTakeFirst();
    if (!org) return { ok: false as const, reason: 'name-taken' as const };
    for (const email of emails) {
      await attachOrInvite(trx, {
        actor,
        organizationId: org.id,
        organizationName: org.name,
        email,
        role: 'manager',
      });
    }
    return { ok: true as const, organization: org };
  });
}

/**
 * Add somebody directly. `actorIsManager` says the caller came as a manager
 * of this organization rather than as an administrator, and it is the only
 * thing between a manager and an account that cannot be removed. The route
 * keeps this to administrators since invitations exist; the module refuses
 * a manager making a manager regardless.
 */
export async function addMember(
  db: Kysely<DB>,
  args: {
    actor: Actor;
    actorIsManager: boolean;
    organizationId: number;
    email: string;
    role: string;
  },
): Promise<
  | { ok: true; pending: boolean }
  | {
      ok: false;
      reason:
        | 'unknown-role'
        | 'manager-cannot-promote'
        | 'bad-email'
        | 'no-such-organization'
        | 'last-manager';
    }
> {
  if (!isOrgRole(args.role)) return { ok: false, reason: 'unknown-role' };
  const role = args.role;
  if (args.actorIsManager && role === 'manager')
    return { ok: false, reason: 'manager-cannot-promote' };
  const email = normalizeEmail(args.email);
  if (!looksLikeEmail(email)) return { ok: false, reason: 'bad-email' };

  try {
    return await db.transaction().execute(async (trx) => {
      const name = await organizationName(trx, args.organizationId);
      if (name === null) return { ok: false as const, reason: 'no-such-organization' as const };
      const out = await attachOrInvite(trx, {
        actor: args.actor,
        organizationId: args.organizationId,
        organizationName: name,
        email,
        role,
      });
      return { ok: true as const, pending: out.pending };
    });
  } catch (e) {
    if (e instanceof LastManager) return { ok: false, reason: 'last-manager' };
    throw e;
  }
}

export async function removeMember(
  db: Kysely<DB>,
  args: { actor: Actor; actorIsManager: boolean; organizationId: number; email: string },
): Promise<
  | { ok: true; revokedInvite?: true; submissionsKept?: true }
  | { ok: false; reason: 'not-a-member' | 'manager-cannot-remove-manager' | 'last-manager' }
> {
  const email = normalizeEmail(args.email);
  return db.transaction().execute(async (trx) => {
    // A waiting invitation is not a membership. Withdrawing one is tidying up,
    // and must not be mistaken for removing a person.
    const invites = await trx
      .deleteFrom('organization_invites')
      .where('organization_id', '=', args.organizationId)
      .where('email', '=', email)
      .executeTakeFirst();

    const member = await trx
      .selectFrom('organization_memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .select(['m.id', 'm.role', 'o.name'])
      .where('m.organization_id', '=', args.organizationId)
      .where('u.email', '=', email)
      .forUpdate(['m'])
      .executeTakeFirst();
    if (!member) {
      return invites.numDeletedRows > 0n
        ? { ok: true as const, revokedInvite: true as const }
        : { ok: false as const, reason: 'not-a-member' as const };
    }
    if (args.actorIsManager && member.role === 'manager') {
      return { ok: false as const, reason: 'manager-cannot-remove-manager' as const };
    }
    if (member.role === 'manager') {
      // Every manager row locked before counting, so two removals of the last
      // two managers cannot each see the other still there.
      await trx
        .selectFrom('organization_memberships')
        .select('id')
        .where('organization_id', '=', args.organizationId)
        .where('role', '=', 'manager')
        .forUpdate()
        .execute();
      const others = await trx
        .selectFrom('organization_memberships')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('organization_id', '=', args.organizationId)
        .where('role', '=', 'manager')
        .where('id', '<>', member.id)
        .executeTakeFirstOrThrow();
      if (others.n === 0) return { ok: false as const, reason: 'last-manager' as const };
    }
    await trx.deleteFrom('organization_memberships').where('id', '=', member.id).execute();
    await recordRoleChange(trx, {
      actorEmail: args.actor.email,
      subjectEmail: email,
      axis: 'organization',
      action: 'revoke',
      detail: `${member.role} of ${member.name}`,
      organizationId: args.organizationId,
    });
    // Said out loud because it is the surprising half of the rule.
    return { ok: true as const, submissionsKept: true as const };
  });
}

export async function membersOf(db: Kysely<DB>, organizationId: number) {
  const members = await db
    .selectFrom('organization_memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select(['u.email', 'm.role', 'm.joined_at'])
    .where('m.organization_id', '=', organizationId)
    .execute();
  const waiting = await db
    .selectFrom('organization_invites')
    .select(['email', 'role', 'created_at as joined_at'])
    .where('organization_id', '=', organizationId)
    .execute();
  return [
    ...members.map((m) => ({ ...m, pending: false })),
    ...waiting.map((w) => ({ ...w, pending: true })),
  ].sort(
    (a, b) =>
      Number(a.pending) - Number(b.pending) ||
      a.role.localeCompare(b.role) ||
      a.email.localeCompare(b.email),
  );
}

/**
 * At sign-in: attach what an administrator added before this address had an
 * account. ONLY `joins_on_sign_in`. An invitation with a link has to be
 * accepted by somebody who has read what it means; attaching it here would
 * make them a member because they signed in.
 */
export async function claimWaitingMemberships(
  trx: Kysely<DB>,
  userId: number,
  email: string,
): Promise<number> {
  const waiting = await trx
    .deleteFrom('organization_invites')
    .where('email', '=', normalizeEmail(email))
    .where('status', '=', 'joins_on_sign_in')
    .returning(['organization_id', 'role'])
    .execute();
  for (const w of waiting) {
    await trx
      .insertInto('organization_memberships')
      .values({ organization_id: w.organization_id, user_id: userId, role: w.role })
      .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doUpdateSet({ role: w.role }))
      .execute();
  }
  return waiting.length;
}

export async function setOrganizationDetails(
  db: Kysely<DB>,
  args: { actor: Actor; organizationId: number; details: string; isAdminOverride: boolean },
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('organizations')
      .set({ details: textOrNull(args.details), updated_at: new Date() })
      .where('id', '=', args.organizationId)
      .executeTakeFirst();
    if (updated.numUpdatedRows === 0n) return false;
    if (args.isAdminOverride) {
      // An administrator rewriting how an organization presents itself is an
      // action against that organization, so it is on the record.
      await recordRoleChange(trx, {
        actorEmail: args.actor.email,
        subjectEmail: args.actor.email,
        axis: 'organization',
        action: 'change',
        detail: 'an administrator replaced the organization’s details',
        organizationId: args.organizationId,
      });
    }
    return true;
  });
}
