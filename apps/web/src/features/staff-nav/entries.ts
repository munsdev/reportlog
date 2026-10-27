/**
 * Every staff screen, once, with who may open it, arranged as the menu
 * shows them (docs/design/navigation.md, section 04): seven AREAS sorted
 * by job, each with its pages, and before them the GROUPS every signed-in
 * person has (their own pages, the desk, their organization), by audience.
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

/**
 * `anyone` is every signed-in person; `role` is anyone who holds a role,
 * proved a second factor yet or not (the account-and-security page is how
 * they prove it).
 */
export type Audience = SystemRole | 'tester' | 'team' | 'organization' | 'anyone' | 'role';

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

export type AreaId = 'review' | 'content' | 'site' | 'rules' | 'people' | 'logs' | 'help';

export interface StaffArea {
  id: AreaId;
  label: string;
  pages: readonly StaffEntry[];
}

const MOD: readonly Audience[] = ['moderator', 'admin'];
const ADMIN: readonly Audience[] = ['admin'];
const GRANTERS: readonly Audience[] = ['admin', 'access_manager'];

/**
 * Sorted by the job a person comes to do, not by who built the screen:
 * Review, Content, Site, Rules, People, Logs and system, Help (decision 71).
 */
export const STAFF_AREAS: readonly StaffArea[] = [
  {
    id: 'review',
    label: 'Review',
    pages: [
      {
        to: '/moderate',
        label: 'Reports queue',
        tab: 'Queue',
        for: MOD,
        under: ['/moderate/'],
        waiting: 'reports',
      },
      { to: '/lists/links', label: 'Links', for: MOD, waiting: 'tip_links' },
      {
        to: '/lists/review',
        label: 'List entries',
        for: MOD,
        under: ['/lists/review/'],
        waiting: 'list_entries',
      },
      { to: '/files', label: 'Files', for: MOD, under: ['/files/'] },
      {
        to: '/moderate/illegal-content',
        label: 'Illegal content notices',
        tab: 'Notices',
        for: MOD,
      },
      { to: '/moderate/flood', label: 'Flood screen', for: MOD },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    pages: [
      { to: '/logbooks', label: 'Logbooks', for: ADMIN, under: ['/logbooks/'] },
      { to: '/lists', label: 'Lists', for: ADMIN, under: ['/lists/'] },
      { to: '/maps', label: 'Maps', for: ADMIN, under: ['/maps/'] },
      { to: '/lists/search', label: 'Find somebody’s entries', for: ADMIN },
      { to: '/settings/forms', label: 'Report and tip forms', for: ADMIN },
      { to: '/settings/starting-points', label: 'Starting points', for: ADMIN },
      { to: '/logbooks/front-page', label: 'Front page', for: ADMIN },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    pages: [
      { to: '/settings/name', label: 'Name', for: ADMIN },
      { to: '/settings/look', label: 'Look', for: ADMIN },
      { to: '/settings/words', label: 'Wording', for: ADMIN },
      // Where the site is elsewhere: what the public pages say about it, so
      // beside its name and wording rather than with the content it collects.
      { to: '/settings/social', label: 'Social media', for: ADMIN },
      { to: '/settings/legal', label: 'Legal notices', for: ADMIN },
      { to: '/settings/development', label: 'Development notice', for: ADMIN },
    ],
  },
  {
    id: 'rules',
    label: 'Rules',
    pages: [
      { to: '/moderate/settings', label: 'Moderation settings', tab: 'Settings', for: ADMIN },
      // A logbook's own limits are this page's too, not the files queue's.
      { to: '/files/settings', label: 'File limits', for: ADMIN, under: ['/files/logbooks/'] },
      { to: '/moderate/agreement', label: 'Moderator agreement', for: ADMIN },
      // Its route asks for the owner (access/journalists_.agreement.tsx).
      { to: '/access/journalists/agreement', label: 'Journalist agreement', for: ['owner'] },
      // Its own entry: it lives on the Roles page, where nobody looked for it.
      { to: '/access', hash: 'site-password', label: 'Site password', for: ADMIN, alias: true },
    ],
  },
  {
    id: 'people',
    label: 'People',
    pages: [
      // Not `under` /access/: sign-in, invitations and the security page
      // live there too and belong to nobody's area.
      { to: '/access', label: 'People and roles', for: GRANTERS },
      { to: '/access/orgs', label: 'Organizations', for: GRANTERS, under: ['/access/orgs/'] },
      { to: '/access/journalists', label: 'Journalist requests', for: ['owner'] },
      // It had no menu entry before; its route admits these two (OnlyFor).
      { to: '/feedback/testers', label: 'Testers', for: GRANTERS },
      { to: '/access/roster', label: 'Who is doing what', for: GRANTERS },
    ],
  },
  {
    id: 'logs',
    label: 'Logs and system',
    pages: [
      { to: '/transparency-log', label: 'Transparency log', for: ADMIN },
      { to: '/access/audit', label: 'Who granted what', for: GRANTERS },
      // The access log, a page of its own (settings-and-admin.md §13).
      {
        to: '/who-opened-what',
        label: 'Who opened protected data',
        tab: 'Who opened what',
        for: ADMIN,
      },
      { to: '/backups', label: 'Backups and exports', for: ['owner'] },
      { to: '/updates', label: 'Updates', for: ADMIN },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    pages: [
      {
        to: '/docs',
        label: 'Guides',
        for: ['moderator', 'access_manager', 'admin', 'team'],
        // Each guide is this page too, so a staff reader stays in the staff
        // area while reading one.
        under: ['/docs/'],
      },
      {
        to: '/feedback',
        label: 'Feedback',
        for: ['tester', 'admin', 'access_manager'],
        waiting: 'feedback',
      },
      // A different screen from /feedback (the queue, not the form to file).
      { to: '/settings/feedback', label: 'Feedback queue', for: ADMIN },
    ],
  },
];

/**
 * Pages in the frame that no entry names: the old settings overview keeps
 * its route, and the dashboard replaced it as the menu's first entry.
 */
const FRAMED_ALSO: readonly string[] = ['/settings'];

export type GroupId = 'you' | 'desk' | 'organization';

export interface StaffGroup {
  id: GroupId;
  /** Said to a screen reader and shown on a phone; a desktop row shows the links alone. */
  label: string;
  pages: readonly StaffEntry[];
}

/** Before the areas, by audience: what is the person's own, then their work. */
export const STAFF_GROUPS: readonly StaffGroup[] = [
  {
    id: 'you',
    label: 'You',
    pages: [
      { to: '/home', label: 'Your dashboard', for: ['anyone'] },
      { to: '/mine', label: 'My reports', for: ['anyone'], under: ['/mine/'] },
      { to: '/notifications', label: 'Email updates', for: ['anyone'] },
      // The mock-up's You group has no Account row: the account chip in the
      // top bar (StaffShell.tsx) is the way to /access for everybody.
      { to: '/access/security', label: 'Signing in', for: ['role'] },
    ],
  },
  {
    id: 'desk',
    label: 'Journalist desk',
    // Account is the "You" group's own entry, so it is not named twice here.
    pages: [
      { to: '/desk', label: 'Checked links', for: ['journalist'] },
      { to: '/desk/sources', label: 'Sources', for: ['journalist'] },
      { to: '/desk/alerts', label: 'Your alerts', for: ['journalist'] },
    ],
  },
  {
    id: 'organization',
    label: 'Your organization',
    pages: [
      {
        to: '/intake',
        label: 'Filing for an organization',
        for: ['organization'],
        under: ['/intake/'],
      },
      { to: '/intake/links', label: 'Volunteer links', for: ['organization'] },
    ],
  },
];

/** Every staff screen in one list, areas first, in the menu's order. */
export const STAFF_ENTRIES: readonly StaffEntry[] = [
  ...STAFF_GROUPS.flatMap((g) => g.pages),
  ...STAFF_AREAS.flatMap((a) => a.pages),
];

export interface Viewer {
  /** Every role held; an entry opens when any one of them satisfies it (decision 70). */
  roles: readonly SystemRole[];
  /** Roles held, including those not yet acting for want of a second factor. */
  heldRoles?: readonly SystemRole[];
  tester: boolean;
  teamMember?: boolean;
  memberships?: readonly { role: string }[];
}

const ORGANIZATION_ROLES: readonly string[] = ['coordinator', 'manager'];

export function mayOpen(entry: Pick<StaffEntry, 'for'>, viewer: Viewer): boolean {
  return entry.for.some((a) =>
    a === 'anyone'
      ? true
      : a === 'role'
        ? (viewer.heldRoles ?? viewer.roles).length > 0
        : a === 'tester'
          ? viewer.tester
          : a === 'team'
            ? viewer.teamMember === true
            : a === 'organization'
              ? (viewer.memberships ?? []).some((m) => ORGANIZATION_ROLES.includes(m.role))
              : roleSatisfies(viewer.roles, a),
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

/** The groups before the areas that this person has any page in. */
export function groupsFor(viewer: Viewer): StaffGroup[] {
  return STAFF_GROUPS.map((g) => ({ ...g, pages: entriesFor(viewer, g.pages) })).filter(
    (g) => g.pages.length > 0,
  );
}

/**
 * Whether the app frame draws on this address for a signed-in person: any
 * address an entry names, or one of the few pages no entry names.
 */
export function inFrame(pathname: string): boolean {
  return entryAt(pathname) !== null || FRAMED_ALSO.includes(trimmed(pathname));
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
