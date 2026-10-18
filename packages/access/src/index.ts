/**
 * The role ceiling, and rank — in one place, with no database.
 *
 * Granting itself (the audit row and the change in one transaction) is the
 * server's job. What may be granted, by whom, is decided only here, so every
 * granting path asks the same table.
 */

export const SYSTEM_ROLES = ['user', 'moderator', 'access_manager', 'admin', 'owner'] as const;
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
 * two-party handover or the setup wizard. Exported so tests read the real
 * table instead of a copy.
 */
export const MAY_GRANT: Readonly<Record<SystemRole, readonly SystemRole[]>> = {
  owner: ['user', 'moderator', 'access_manager', 'admin'],
  admin: ['user', 'moderator', 'access_manager'],
  access_manager: ['user', 'moderator'],
  moderator: [],
  user: [],
};

export function canGrantSystemRole(actor: SystemRole, target: SystemRole): boolean {
  return MAY_GRANT[actor].includes(target);
}

/**
 * Who may change somebody who already holds a role. The owner is untouchable
 * through this path, by anybody including themselves; only the owner may
 * change an administrator.
 */
export function canChangeSubject(actor: SystemRole, subject: SystemRole): boolean {
  if (subject === 'owner') return false;
  if (subject === 'admin') return actor === 'owner';
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
