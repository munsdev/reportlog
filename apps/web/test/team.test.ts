/**
 * The team-member flag and desks on the website, and the digest's stop link
 * as a door.
 */
import { DESK_IDS } from '@reportlog/contracts';
import { describe, expect, it } from 'vitest';
import { STARTS_AT, desksFor } from '../src/features/identity/desks.ts';
import { isDoorPath } from '../src/features/identity/gate.tsx';
import { STAFF_ENTRIES, entriesFor } from '../src/features/staff-nav/entries.ts';

describe('the team-member flag in the staff menu', () => {
  it('opens the guides and nothing else', () => {
    expect(entriesFor({ roles: [], tester: false, teamMember: true }).map((e) => e.label)).toEqual([
      'Overview',
      'My reports',
      'Email updates',
      'Account',
      'Guides',
    ]);
  });
});

describe('desks', () => {
  it('every desk starts at a screen that is in the staff menu', () => {
    const paths = new Set(STAFF_ENTRIES.map((e) => e.to));
    for (const id of DESK_IDS) expect(paths.has(STARTS_AT[id])).toBe(true);
  });

  it('a start the person cannot open is not offered, and the desk is still shown', () => {
    const shown = desksFor(['moderating', 'outreach'], {
      roles: [],
      tester: false,
      teamMember: true,
    });
    expect(shown).toEqual([
      { id: 'moderating', label: 'Moderating reports', start: null },
      {
        id: 'outreach',
        label: 'Outreach',
        start: expect.objectContaining({ to: '/docs' }) as unknown,
      },
    ]);
  });

  it('a moderator on the moderating desk is pointed at moderation', () => {
    const [d] = desksFor(['moderating'], { roles: ['moderator'], tester: false, teamMember: true });
    expect(d?.start?.to).toBe('/moderate');
  });

  it('a desk id the list no longer names is left out', () => {
    expect(desksFor(['retired-desk'], { roles: ['admin'], tester: false })).toEqual([]);
  });
});

describe('the stop link is a door', () => {
  it('opens without the site password, and nothing beside it does', () => {
    expect(isDoorPath(`/notifications/stop/${'a'.repeat(64)}`)).toBe(true);
    expect(isDoorPath('/notifications')).toBe(false);
    expect(isDoorPath('/notifications/stop')).toBe(false);
    expect(isDoorPath(`/notifications/stop/${'a'.repeat(64)}/more`)).toBe(false);
  });
});
