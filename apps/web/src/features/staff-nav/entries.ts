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
 * flag, and `organization` for anybody who coordinates or manages an
 * organization (by membership; no system role stands in for it, as on the
 * server's coordinatorOrgs). Rank is the package's: `admin` admits the owner, and admin does NOT
 * imply moderator, so a screen for both names both.
 *
 * This decides what the menu SHOWS, nothing more. Every staff route on the
 * server refuses the wrong people regardless, and every staff screen says so
 * if somebody types its address.
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import type { LinkProps } from '@tanstack/react-router';

export type Audience = SystemRole | 'tester' | 'organization';

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
  { to: '/moderate', label: 'Moderation', for: ['moderator', 'admin'] },
  { to: '/moderate/settings', label: 'Moderation settings', for: ['admin'] },
  { to: '/transparency-log', label: 'Transparency log', for: ['admin'] },
  { to: '/files', label: 'Files', for: ['moderator'] },
  { to: '/files/settings', label: 'File settings', for: ['admin'] },
  { to: '/settings', label: 'Settings', for: ['admin'] },
  { to: '/feedback', label: 'Feedback', for: ['tester', 'admin', 'access_manager'] },
  { to: '/docs', label: 'Guides', for: ['moderator', 'access_manager', 'admin'] },
  { to: '/intake', label: 'Intake', for: ['organization'] },
];

export interface Viewer {
  role: SystemRole;
  tester: boolean;
  memberships?: readonly { role: string }[];
}

const ORGANIZATION_ROLES: readonly string[] = ['coordinator', 'manager'];

export function mayOpen(entry: StaffEntry, viewer: Viewer): boolean {
  return entry.for.some((a) =>
    a === 'tester'
      ? viewer.tester
      : a === 'organization'
        ? (viewer.memberships ?? []).some((m) => ORGANIZATION_ROLES.includes(m.role))
        : roleSatisfies(viewer.role, a),
  );
}

/** The entries this person may open, in the order above. */
export function entriesFor(
  viewer: Viewer,
  entries: readonly StaffEntry[] = STAFF_ENTRIES,
): StaffEntry[] {
  return entries.filter((e) => mayOpen(e, viewer));
}
