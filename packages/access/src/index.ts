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

export function canGrantSystemRole(actor: SystemRole, target: SystemRole): boolean {
  return MAY_GRANT[actor].includes(target);
}

/**
 * Who may change somebody who already holds a role. The owner is untouchable
 * through this path, by anybody including themselves; only the owner may
 * change an administrator or a journalist (revoking one is the owner's, J13).
 */
export function canChangeSubject(actor: SystemRole, subject: SystemRole): boolean {
  if (subject === 'owner') return false;
  if (subject === 'admin' || subject === 'journalist') return actor === 'owner';
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

export function roleSatisfies(
  userRole: SystemRole | null | undefined,
  required: SystemRole,
): boolean {
  if (!userRole) return false;
  if (userRole === required) return true;
  return IMPLIES[userRole]?.includes(required) ?? false;
}

/** Anybody holding administrator authority: an admin, or the owner. */
export function hasAdminAuthority(role: SystemRole | null | undefined): boolean {
  return roleSatisfies(role, 'admin');
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

export function canSetFlag(actor: SystemRole | null | undefined, flag: Flag): boolean {
  return actor ? MAY_SET_FLAGS[actor].includes(flag) : false;
}
