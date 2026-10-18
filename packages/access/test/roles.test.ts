import { describe, expect, it } from 'vitest';
import {
  MAY_GRANT,
  SYSTEM_ROLES,
  canChangeSubject,
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
