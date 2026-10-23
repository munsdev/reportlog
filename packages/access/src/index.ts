/**
 * The role ceiling, and rank — in one place, with no database.
 *
 * Granting itself (the audit row and the change in one transaction) is the
 * server's job. What may be granted, by whom, is decided only here, so every
 * granting path asks the same table.
 */

/**
 * `journalist` is a vetted reader of the desk (plan D, J7 to J13). It outranks
 * nothing, satisfies no staff scope and grants nothing; only the owner makes
 * or removes one.
 */
export const SYSTEM_ROLES = [
  'user',
  'moderator',
  'access_manager',
  'admin',
  'owner',
  'journalist',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ORG_ROLES = ['manager', 'coordinator'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function isSystemRole(v: unknown): v is SystemRole {
  return SYSTEM_ROLES.includes(v as SystemRole);
}

/**
 * What somebody holds: nothing, one role, or several (decision 70). Every
 * check below takes this shape and means "any of them", so a caller with one
 * role and a caller with a set ask the same function.
 */
export type Held = SystemRole | readonly SystemRole[] | null | undefined;

function asList(held: Held): readonly SystemRole[] {
  if (!held) return [];
  return typeof held === 'string' ? [held] : held;
}

/**
 * The roles a person can be given, as a set. `user` is the absence of a role,
 * never a member of the set.
 */
export type HeldRole = Exclude<SystemRole, 'user'>;
export const HOLDABLE_ROLES = SYSTEM_ROLES.filter((r): r is HeldRole => r !== 'user');

/** The staff roles: they combine freely. The journalist is not one. */
export const STAFF_ROLES = ['moderator', 'access_manager', 'admin', 'owner'] as const;

/** Narrow a stored list to roles this code knows, without `user`, once each. */
export function toRoleSet(raw: readonly string[] | null | undefined): HeldRole[] {
  const out: HeldRole[] = [];
  for (const r of raw ?? []) {
    if (isSystemRole(r) && r !== 'user' && !out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * Whether a set of roles may be held by one person. Staff roles combine
 * freely; a journalist holds no staff role (decision 70). The same rule is a
 * CHECK on `users.roles`, so it holds even if a path forgets to ask.
 */
export function canHoldTogether(roles: Held): boolean {
  const list = asList(roles);
  if (!list.includes('journalist')) return true;
  return list.every((r) => r === 'journalist');
}

/**
 * Which roles each role may hand out.
 *
 * The load-bearing line is Access Manager's: it can make Moderators and
 * CANNOT make Access Managers, so the role cannot replicate itself. Only the
 * owner can make an administrator.
 *
 * THE OWNER'S SEAT IS UNGRANTABLE: 'owner' appears in no row, its own
 * included, so no grant can produce one. The seat moves only by the
 * two-party handover or the setup wizard. A journalist is vetted by the
 * owner and nobody else, so 'journalist' is in the owner's row only. Exported so tests read the real
 * table instead of a copy.
 */
export const MAY_GRANT: Readonly<Record<SystemRole, readonly SystemRole[]>> = {
  owner: ['user', 'moderator', 'access_manager', 'admin', 'journalist'],
  admin: ['user', 'moderator', 'access_manager'],
  access_manager: ['user', 'moderator'],
  moderator: [],
  user: [],
  journalist: [],
};

export function canGrantSystemRole(actor: Held, target: SystemRole): boolean {
  return asList(actor).some((a) => MAY_GRANT[a].includes(target));
}

/**
 * Who may change one role somebody already holds (`subject` is that role, not
 * the person: roles are granted and revoked one at a time). The owner's seat
 * is untouchable through this path, by anybody including themselves; only the
 * owner may change an administrator or a journalist (revoking one is the
 * owner's, J13).
 */
export function canChangeSubject(actor: Held, subject: SystemRole): boolean {
  if (subject === 'owner') return false;
  if (subject === 'admin' || subject === 'journalist') return asList(actor).includes('owner');
  if (subject === 'access_manager') return roleSatisfies(actor, 'admin');
  return true;
}

/**
 * What each role satisfies BESIDES itself. Owner satisfies admin, and that is
 * the only implication. Deliberately not a general hierarchy: admin does NOT
 * imply moderator, and inventing a ladder would silently widen routes.
 */
const IMPLIES: Partial<Record<SystemRole, readonly SystemRole[]>> = {
  owner: ['admin'],
};

export function roleSatisfies(held: Held, required: SystemRole): boolean {
  return asList(held).some((r) => r === required || (IMPLIES[r]?.includes(required) ?? false));
}

/** Any one of the roles held satisfies the one required. */
export function rolesSatisfy(held: Held, required: SystemRole): boolean {
  return roleSatisfies(held, required);
}

/** Anybody holding administrator authority: an admin, or the owner. */
export function hasAdminAuthority(held: Held): boolean {
  return roleSatisfies(held, 'admin');
}

/**
 * FLAGS ARE NOT ROLES. The tester flag and the team-member flag compose with
 * whatever role somebody holds and open no report, so they are not rungs on
 * the ladder above. Who may set them is still decided here, beside the
 * ladder, so every grant asks this package: administrators (the owner
 * included) and Access Managers, the same people who grant access. Nobody
 * else, a flag's holder included.
 */
export const FLAGS = ['tester', 'team_member'] as const;
export type Flag = (typeof FLAGS)[number];

const MAY_SET_FLAGS: Readonly<Record<SystemRole, readonly Flag[]>> = {
  owner: FLAGS,
  admin: FLAGS,
  access_manager: FLAGS,
  moderator: [],
  user: [],
  journalist: [],
};

export function canSetFlag(actor: Held, flag: Flag): boolean {
  return asList(actor).some((a) => MAY_SET_FLAGS[a].includes(flag));
}
