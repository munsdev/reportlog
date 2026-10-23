/**
 * The browser suite's written-out menu (e2e/navigation-table.ts) is exactly
 * what entries.ts gives each role, so the browser tests check the real menu
 * and cannot quietly fall behind it.
 */
import { describe, expect, it } from 'vitest';
import { ALL_PAGES, MENU_FOR } from '../e2e/navigation-table.ts';
import type { MenuRole } from '../e2e/navigation-table.ts';
import {
  STAFF_AREAS,
  STAFF_ENTRIES,
  areasFor,
  groupsFor,
} from '../src/features/staff-nav/entries.ts';
import type { Viewer } from '../src/features/staff-nav/entries.ts';

const VIEWERS: Record<MenuRole, Viewer | null> = {
  visitor: null,
  reporter: { roles: [], tester: false },
  moderator: { roles: ['moderator'], tester: false },
  admin: { roles: ['admin'], tester: false },
  access_manager: { roles: ['access_manager'], tester: false },
  owner: { roles: ['owner'], tester: false },
  journalist: { roles: ['journalist'], tester: false },
  coordinator: { roles: [], tester: false, memberships: [{ role: 'coordinator' }] },
  tester: { roles: [], tester: true },
};

const shown = (v: Viewer | null) =>
  v
    ? [
        ...groupsFor(v).flatMap((g) => g.pages.map((p) => p.label)),
        ...areasFor(v).flatMap((a) => a.pages.map((p) => p.label)),
      ]
    : [];

describe('the browser suite’s menu table', () => {
  it.each(Object.keys(VIEWERS) as MenuRole[])('matches entries.ts for %s', (role) => {
    expect(MENU_FOR[role]).toEqual(shown(VIEWERS[role]));
  });

  it('names every staff page, at its address and in its area', () => {
    expect(ALL_PAGES.map((p) => p.label)).toEqual(STAFF_ENTRIES.map((e) => e.label));
    for (const e of STAFF_ENTRIES) {
      const row = ALL_PAGES.find((p) => p.label === e.label);
      expect(row?.href).toBe(`${e.to}${e.hash ? `#${e.hash}` : ''}`);
      expect(row?.area).toBe(STAFF_AREAS.find((a) => a.pages.includes(e))?.label);
    }
  });
});
