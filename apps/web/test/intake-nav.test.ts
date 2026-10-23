/**
 * The intake screens in the staff menu: shown by organization membership,
 * which no system role stands in for, as on the server (coordinatorOrgs).
 */
import { describe, expect, it } from 'vitest';
import { entriesFor } from '../src/features/staff-nav/entries.ts';
import type { Viewer } from '../src/features/staff-nav/entries.ts';

const labels = (v: Viewer) => entriesFor(v).map((e) => e.label);

describe('who sees the intake screens', () => {
  it('a coordinator or manager of an organization, whatever their system role', () => {
    expect(labels({ roles: [], tester: false, memberships: [{ role: 'coordinator' }] })).toEqual([
      'Intake',
      'Volunteer links',
    ]);
    expect(
      labels({ roles: ['moderator'], tester: false, memberships: [{ role: 'manager' }] }),
    ).toContain('Intake');
  });

  it('not an administrator, or the owner, who is in no organization', () => {
    expect(labels({ roles: ['admin'], tester: false, memberships: [] })).not.toContain('Intake');
    expect(labels({ roles: ['owner'], tester: false })).not.toContain('Intake');
  });
});
