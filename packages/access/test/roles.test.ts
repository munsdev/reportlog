import { describe, expect, it } from 'vitest';
import {
  FLAGS,
  MAY_GRANT,
  SYSTEM_ROLES,
  HOLDABLE_ROLES,
  canChangeSubject,
  canHoldTogether,
  rolesSatisfy,
  toRoleSet,
  canSetFlag,
  canGrantSystemRole,
  hasAdminAuthority,
  roleSatisfies,
} from '../src/index.ts';

describe('the role ceiling', () => {
  it('makes the owner seat ungrantable: no row contains it', () => {
    for (const role of SYSTEM_ROLES) expect(MAY_GRANT[role]).not.toContain('owner');
  });

  it('stops an Access Manager minting another Access Manager', () => {
    expect(canGrantSystemRole('access_manager', 'moderator')).toBe(true);
    expect(canGrantSystemRole('access_manager', 'access_manager')).toBe(false);
  });

  it('lets only the owner appoint or change an administrator', () => {
    for (const role of SYSTEM_ROLES) {
      expect(canGrantSystemRole(role, 'admin')).toBe(role === 'owner');
      expect(canChangeSubject(role, 'admin')).toBe(role === 'owner');
      expect(canChangeSubject(role, 'owner')).toBe(false);
    }
  });
});

describe('rank', () => {
  it('has owner satisfy admin and nothing else outrank anything', () => {
    expect(roleSatisfies('owner', 'admin')).toBe(true);
    expect(roleSatisfies('admin', 'moderator')).toBe(false);
    expect(roleSatisfies('owner', 'moderator')).toBe(false);
    expect(roleSatisfies(null, 'user')).toBe(false);
    expect(hasAdminAuthority('owner')).toBe(true);
    expect(hasAdminAuthority('access_manager')).toBe(false);
  });
});

describe('the journalist role', () => {
  it('is a system role that only the owner grants or changes', () => {
    expect(SYSTEM_ROLES).toContain('journalist');
    for (const role of SYSTEM_ROLES) {
      expect(canGrantSystemRole(role, 'journalist')).toBe(role === 'owner');
      expect(canChangeSubject(role, 'journalist')).toBe(role === 'owner');
    }
    expect(MAY_GRANT.owner).toContain('journalist');
    for (const role of SYSTEM_ROLES) {
      if (role !== 'owner') expect(MAY_GRANT[role]).not.toContain('journalist');
    }
  });

  it('grants nothing and sets no flag', () => {
    expect(MAY_GRANT.journalist).toEqual([]);
    for (const flag of FLAGS) expect(canSetFlag('journalist', flag)).toBe(false);
  });

  it('outranks nothing and satisfies no staff scope', () => {
    for (const role of SYSTEM_ROLES) {
      if (role !== 'journalist') expect(roleSatisfies('journalist', role)).toBe(false);
      if (role !== 'journalist') expect(roleSatisfies(role, 'journalist')).toBe(false);
    }
    expect(roleSatisfies('journalist', 'journalist')).toBe(true);
    expect(hasAdminAuthority('journalist')).toBe(false);
  });
});

describe('flags', () => {
  it('are set by those who grant access, and by nobody else', () => {
    for (const flag of FLAGS) {
      for (const role of SYSTEM_ROLES) {
        expect(canSetFlag(role, flag)).toBe(
          role === 'owner' || role === 'admin' || role === 'access_manager',
        );
      }
      expect(canSetFlag(null, flag)).toBe(false);
    }
  });

  it('are not roles: no flag can be granted as one', () => {
    for (const flag of FLAGS) {
      expect(SYSTEM_ROLES as readonly string[]).not.toContain(flag);
    }
  });
});

describe('holding several roles', () => {
  it('lets staff roles combine and keeps the journalist apart', () => {
    expect(canHoldTogether(['moderator', 'access_manager', 'admin', 'owner'])).toBe(true);
    expect(canHoldTogether(['journalist'])).toBe(true);
    expect(canHoldTogether([])).toBe(true);
    for (const staff of ['moderator', 'access_manager', 'admin', 'owner'] as const) {
      expect(canHoldTogether(['journalist', staff])).toBe(false);
    }
  });

  it('is satisfied by any one role, with owner implying admin and nothing else', () => {
    expect(rolesSatisfy(['moderator', 'access_manager'], 'moderator')).toBe(true);
    expect(rolesSatisfy(['moderator', 'access_manager'], 'admin')).toBe(false);
    expect(rolesSatisfy(['moderator', 'owner'], 'admin')).toBe(true);
    expect(rolesSatisfy(['admin', 'access_manager'], 'moderator')).toBe(false);
    expect(rolesSatisfy([], 'moderator')).toBe(false);
  });

  it('grants and sets flags by the best role held, within the same ceiling', () => {
    expect(canGrantSystemRole(['moderator', 'access_manager'], 'moderator')).toBe(true);
    expect(canGrantSystemRole(['moderator', 'access_manager'], 'access_manager')).toBe(false);
    expect(canGrantSystemRole(['moderator', 'access_manager'], 'admin')).toBe(false);
    expect(canGrantSystemRole(['moderator', 'admin'], 'owner')).toBe(false);
    expect(canSetFlag(['moderator', 'access_manager'], 'tester')).toBe(true);
    expect(canSetFlag(['moderator'], 'tester')).toBe(false);
  });

  it('reads a stored list as a set without user or unknown values', () => {
    expect(toRoleSet(['admin', 'user', 'nonsense', 'admin'])).toEqual(['admin']);
    expect(HOLDABLE_ROLES).not.toContain('user');
  });
});
