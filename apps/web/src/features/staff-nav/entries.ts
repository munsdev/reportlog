/**
 * Every staff screen, once, with who may open it.
 *
 * TO ADD A SCREEN, ADD ONE LINE HERE. The menu reads nothing else, so a
 * screen another workstream builds (moderation, files, maps) appears for
 * exactly the people its line names:
 *
 *   { to: '/moderate', label: 'Moderation', for: ['moderator'] },
 *
 * `for` names roles from @reportlog/access, plus `tester` for the tester
 * flag. Rank is the package's: `admin` admits the owner, and admin does NOT
 * imply moderator, so a screen for both names both.
 *
 * This decides what the menu SHOWS, nothing more. Every staff route on the
 * server refuses the wrong people regardless, and every staff screen says so
 * if somebody types its address.
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import type { LinkProps } from '@tanstack/react-router';

export type Audience = SystemRole | 'tester';

export interface StaffEntry {
  to: NonNullable<LinkProps['to']>;
  label: string;
  for: readonly Audience[];
}

export const STAFF_ENTRIES: readonly StaffEntry[] = [
  { to: '/access', label: 'Access', for: ['admin', 'access_manager'] },
  { to: '/logbooks', label: 'Logbooks', for: ['admin'] },
  { to: '/logbooks/front-page', label: 'Front page', for: ['admin'] },
  { to: '/lists', label: 'Lists', for: ['admin'] },
  { to: '/lists/review', label: 'List review', for: ['moderator', 'admin'] },
  { to: '/settings', label: 'Settings', for: ['admin'] },
  { to: '/feedback', label: 'Feedback', for: ['tester', 'admin', 'access_manager'] },
  { to: '/docs', label: 'Guides', for: ['moderator', 'access_manager', 'admin'] },
];

export interface Viewer {
  role: SystemRole;
  tester: boolean;
}

export function mayOpen(entry: StaffEntry, viewer: Viewer): boolean {
  return entry.for.some((a) => (a === 'tester' ? viewer.tester : roleSatisfies(viewer.role, a)));
}

/** The entries this person may open, in the order above. */
export function entriesFor(
  viewer: Viewer,
  entries: readonly StaffEntry[] = STAFF_ENTRIES,
): StaffEntry[] {
  return entries.filter((e) => mayOpen(e, viewer));
}
