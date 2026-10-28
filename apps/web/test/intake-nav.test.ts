/**
 * The intake screens in the staff menu: shown by organization membership,
 * which no system role stands in for, as on the server (coordinatorOrgs).
 */
import { describe, expect, it } from 'vitest';
import { entriesFor } from '../src/features/staff-nav/entries.ts';
import type { Viewer } from '../src/features/staff-nav/entries.ts';

const YOU = ['Your dashboard', 'My reports', 'Email updates', 'Your account'];
const labels = (v: Viewer) => entriesFor(v).map((e) => e.label);

describe('who sees the intake screens', () => {
  it('a coordinator or manager of an organization, whatever their system role', () => {
    expect(labels({ roles: [], tester: false, memberships: [{ role: 'coordinator' }] })).toEqual([
      ...YOU,
      'Filing for an organization',
    ]);
    // Volunteer links work for managers only, so only managers are offered them.
    expect(labels({ roles: [], tester: false, memberships: [{ role: 'manager' }] })).toEqual([
      ...YOU,
      'Filing for an organization',
      'Volunteer links',
    ]);
    expect(
      labels({ roles: ['moderator'], tester: false, memberships: [{ role: 'manager' }] }),
    ).toContain('Filing for an organization');
  });

  it('not an administrator, or the owner, who is in no organization', () => {
    expect(labels({ roles: ['admin'], tester: false, memberships: [] })).not.toContain(
      'Filing for an organization',
    );
    expect(labels({ roles: ['owner'], tester: false })).not.toContain('Filing for an organization');
  });
});
