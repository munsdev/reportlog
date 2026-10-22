/**
 * Every staff screen, once, with who may open it, arranged as the menu
 * shows them (docs/design/navigation.md, section 04): five AREAS, each with
 * its pages (the menu's columns on a desktop, its folding rows on a phone,
 * and the area tabs on each page), and the GROUPS outside the areas that sit
 * in the menu's "You" row, by audience.
 *
 * TO ADD A SCREEN, ADD ONE LINE HERE, in the area it belongs to. The menu
 * and the tabs read nothing else, so a screen another workstream builds
 * appears for exactly the people its line names:
 *
 *   { to: '/moderate/flood', label: 'Flood screen', for: ['moderator', 'admin'] },
 *
 * `for` names roles from @reportlog/access, plus `tester` for the tester
 * flag, `team` for the team-member flag, and `organization` for anybody who
 * coordinates or manages an organization (by membership; no system role
 * stands in for it, as on the server's coordinatorOrgs). Rank is the
 * package's: `admin` admits the owner, and admin does NOT imply moderator,
 * so a screen for both names both. A page's `for` is its route's own guard
 * (`StaffOnly needs=` or `OnlyFor`), so the menu never offers a page that
 * would then refuse.
 *
 * This decides what the menu SHOWS, nothing more. Every staff route on the
 * server refuses the wrong people regardless, and every staff screen says so
 * if somebody types its address.
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import type { MenuWaiting } from '@reportlog/contracts';
import type { LinkProps } from '@tanstack/react-router';

export type Audience = SystemRole | 'tester' | 'team' | 'organization';

export interface StaffEntry {
  to: NonNullable<LinkProps['to']>;
  label: string;
  for: readonly Audience[];
  /** A shorter name for the area tabs, where the area already says the rest. */
  tab?: string;
  /**
   * Addresses under these prefixes are this page too (a report's own page is
   * the queue's), so the menu and the tabs say "you are here" on them. The
   * longest matching prefix wins, so `/lists/review/` beats `/lists/`.
   */
  under?: readonly string[];
  /** Where on the page it opens, when that is not the top. */
  hash?: string;
  /**
   * A second way to a page another entry owns (the access log, inside
   * Moderation settings until it gets a route of its own). Never marked as
   * where you are, so one page is never "here" twice.
   */
  alias?: boolean;
  /** Which of the menu's waiting totals belongs beside it. */
  waiting?: keyof MenuWaiting;
}

export type AreaId = 'moderation' | 'logbooks' | 'settings' | 'people' | 'records';

export interface StaffArea {
  id: AreaId;
  label: string;
  pages: readonly StaffEntry[];
}

const MOD: readonly Audience[] = ['moderator', 'admin'];
const ADMIN: readonly Audience[] = ['admin'];
const GRANTERS: readonly Audience[] = ['admin', 'access_manager'];

export const STAFF_AREAS: readonly StaffArea[] = [
  {
    id: 'moderation',
    label: 'Moderation',
    pages: [
      { to: '/moderate', label: 'Queue', for: MOD, under: ['/moderate/'], waiting: 'reports' },
      { to: '/moderate/flood', label: 'Flood screen', for: MOD },
      { to: '/lists/links', label: 'Tip links', for: MOD, waiting: 'tip_links' },
      {
        to: '/lists/review',
        label: 'List review',
        for: MOD,
        under: ['/lists/review/'],
        waiting: 'list_entries',
      },
      {
        to: '/moderate/illegal-content',
        label: 'Illegal content notices',
        tab: 'Notices',
        for: MOD,
      },
      { to: '/files', label: 'Files', for: MOD, under: ['/files/'] },
      { to: '/moderate/agreement', label: 'Agreement', for: ADMIN },
      { to: '/moderate/settings', label: 'Moderation settings', tab: 'Settings', for: ADMIN },
    ],
  },
  {
    id: 'logbooks',
    label: 'Logbooks and lists',
    pages: [
      { to: '/logbooks', label: 'Logbooks', for: ADMIN, under: ['/logbooks/'] },
      { to: '/logbooks/front-page', label: 'Front page', for: ADMIN },
      { to: '/lists', label: 'Lists', for: ADMIN, under: ['/lists/'] },
      { to: '/maps', label: 'Maps', for: ADMIN, under: ['/maps/'] },
      { to: '/lists/search', label: 'Find entries', for: ADMIN },
      // A logbook's own limits are this page's too, not the files queue's.
      { to: '/files/settings', label: 'File limits', for: ADMIN, under: ['/files/logbooks/'] },
    ],
  },
  {
    id: 'settings',
    label: 'Site settings',
    pages: [
      { to: '/settings', label: 'Overview', for: ADMIN },
      { to: '/settings/look', label: 'Look', for: ADMIN },
      { to: '/settings/name', label: 'Name', for: ADMIN },
      { to: '/settings/words', label: 'Wording', for: ADMIN },
      { to: '/settings/legal', label: 'Legal notices', for: ADMIN },
      { to: '/settings/forms', label: 'Report and tip forms', for: ADMIN },
      { to: '/settings/starting-points', label: 'Starting points', for: ADMIN },
      { to: '/settings/development', label: 'Development notice', for: ADMIN },
      { to: '/settings/feedback', label: 'Feedback queue', for: ADMIN },
    ],
  },
  {
    id: 'people',
    label: 'People and access',
    pages: [
      // Not `under` /access/: sign-in, invitations and the security page
      // live there too and belong to nobody's area.
      { to: '/access', label: 'Roles', for: GRANTERS },
      // Its own entry: it lives on the Roles page, where nobody looked for it.
      { to: '/access', hash: 'site-password', label: 'Site password', for: ADMIN, alias: true },
      { to: '/access/orgs', label: 'Organizations', for: GRANTERS, under: ['/access/orgs/'] },
      {
        to: '/access/journalists',
        label: 'Journalists',
        for: ['owner'],
        under: ['/access/journalists/'],
      },
      { to: '/access/roster', label: 'Who is doing what', for: GRANTERS },
      { to: '/access/audit', label: 'Who granted what', for: GRANTERS },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    pages: [
      { to: '/transparency-log', label: 'Transparency log', for: ADMIN },
      { to: '/backups', label: 'Backups and exports', for: ['owner'] },
      { to: '/updates', label: 'Updates', for: ADMIN },
      // The access log, a page of its own (settings-and-admin.md §13); it
      // was a section of Moderation settings until then.
      {
        to: '/who-opened-what',
        label: 'Who opened protected data',
        tab: 'Who opened what',
        for: ADMIN,
      },
    ],
  },
];

export type GroupId = 'organization' | 'work';

export interface StaffGroup {
  id: GroupId;
  /** Said to a screen reader and shown on a phone; a desktop row shows the links alone. */
  label: string;
  pages: readonly StaffEntry[];
}

/** Outside the areas, by audience: the menu's "You" row. */
export const STAFF_GROUPS: readonly StaffGroup[] = [
  {
    id: 'organization',
    label: 'Your organization',
    pages: [
      { to: '/intake', label: 'Intake', for: ['organization'], under: ['/intake/'] },
      { to: '/intake/links', label: 'Volunteer links', for: ['organization'] },
    ],
  },
  {
    id: 'work',
    label: 'Your work',
    pages: [
      { to: '/desk', label: 'Journalist desk', for: ['journalist'] },
      {
        to: '/feedback',
        label: 'Feedback',
        for: ['tester', 'admin', 'access_manager'],
        waiting: 'feedback',
      },
      // It had no menu entry before; its route admits these two (OnlyFor).
      { to: '/feedback/testers', label: 'Testers', for: GRANTERS },
      {
        to: '/docs',
        label: 'Guides',
        for: ['moderator', 'access_manager', 'admin', 'team'],
        // Each guide is this page too, so a staff reader stays in the staff
        // area while reading one.
        under: ['/docs/'],
      },
    ],
  },
];

/** Every staff screen in one list, areas first, in the menu's order. */
export const STAFF_ENTRIES: readonly StaffEntry[] = [
  ...STAFF_AREAS.flatMap((a) => a.pages),
  ...STAFF_GROUPS.flatMap((g) => g.pages),
];

export interface Viewer {
  role: SystemRole;
  tester: boolean;
  teamMember?: boolean;
  memberships?: readonly { role: string }[];
}

const ORGANIZATION_ROLES: readonly string[] = ['coordinator', 'manager'];

export function mayOpen(entry: Pick<StaffEntry, 'for'>, viewer: Viewer): boolean {
  return entry.for.some((a) =>
    a === 'tester'
      ? viewer.tester
      : a === 'team'
        ? viewer.teamMember === true
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

/** The areas this person may open any page of, each with only those pages. */
export function areasFor(viewer: Viewer): StaffArea[] {
  return STAFF_AREAS.map((a) => ({ ...a, pages: entriesFor(viewer, a.pages) })).filter(
    (a) => a.pages.length > 0,
  );
}

/** The groups of the "You" row this person has any page in. */
export function groupsFor(viewer: Viewer): StaffGroup[] {
  return STAFF_GROUPS.map((g) => ({ ...g, pages: entriesFor(viewer, g.pages) })).filter(
    (g) => g.pages.length > 0,
  );
}

/**
 * Where "Open the staff area" in the public menu goes: the first page this
 * person may open, in the order above. `null` for somebody with none.
 */
export function staffHome(viewer: Viewer): StaffEntry | null {
  return entriesFor(viewer)[0] ?? null;
}

const trimmed = (pathname: string) => pathname.replace(/\/+$/, '') || '/';

/**
 * Which staff page this address is, if any: its own address exactly, else
 * the entry with the longest `under` prefix that holds it. An alias is
 * never the answer.
 */
export function entryAt(
  pathname: string,
  entries: readonly StaffEntry[] = STAFF_ENTRIES,
): StaffEntry | null {
  const path = trimmed(pathname);
  const real = entries.filter((e) => !e.alias);
  const exact = real.find((e) => e.to === path);
  if (exact) return exact;
  let best: StaffEntry | null = null;
  let length = 0;
  for (const e of real) {
    for (const prefix of e.under ?? []) {
      if (path.startsWith(prefix) && prefix.length > length) {
        best = e;
        length = prefix.length;
      }
    }
  }
  return best;
}

/** The area this address belongs to, if any. */
export function areaAt(pathname: string): StaffArea | null {
  const entry = entryAt(pathname);
  if (!entry) return null;
  return STAFF_AREAS.find((a) => a.pages.includes(entry)) ?? null;
}
