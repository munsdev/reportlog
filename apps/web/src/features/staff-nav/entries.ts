/**
 * THE SIDEBAR NOW READS `menu.ts`, the reorganization of 28 October 2026.
 * The arrangement below (seven AREAS and the GROUPS before them) is the one
 * it replaced, kept where it is so that a screen another workstream adds
 * here still appears: any page named below and not in menu.ts is listed
 * under "Not sorted yet" (`unsorted`) until somebody gives it a line there.
 * The helpers at the bottom of this file (who may open what, which page an
 * address is) serve both.
 *
 * Every staff screen, once, with who may open it (docs/design/navigation.md,
 * section 04): seven AREAS sorted by job, each with its pages, and before
 * them the GROUPS every signed-in person has (their own pages, the desk,
 * their organization), by audience.
 *
 * TO ADD A SCREEN, add one line to menu.ts, in the section it belongs to. A
 * line here works too, and shows under "Not sorted yet":
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
import { FOLDED, MENU } from './menu.ts';
import type { MenuSection } from './menu.ts';
import type { Audience, StaffEntry } from './types.ts';

export type { Audience, StaffEntry } from './types.ts';

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
      {
        to: '/moderate/texts',
        label: 'Written accounts',
        for: MOD,
        under: ['/moderate/texts/'],
        waiting: 'texts',
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
      // The front page's own tab is this page too (the longer prefix wins).
      {
        to: '/logbooks/pages',
        label: 'Front page and pages',
        for: ADMIN,
        under: ['/logbooks/front-page'],
      },
      { to: '/lists/search', label: 'Find somebody’s entries', for: ADMIN },
      { to: '/settings/forms', label: 'Report and tip forms', for: ADMIN },
      { to: '/settings/starting-points', label: 'Starting points', for: ADMIN },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    pages: [
      { to: '/settings', label: 'Site settings', for: ADMIN },
      { to: '/settings/name', label: 'Name', for: ADMIN },
      { to: '/settings/look', label: 'Look', for: ADMIN },
      { to: '/settings/words', label: 'Wording', for: ADMIN },
      // Where the site is elsewhere: what the public pages say about it, so
      // beside its name and wording rather than with the content it collects.
      { to: '/settings/social', label: 'Social media', for: ADMIN },
      { to: '/settings/legal', label: 'Legal notices', for: ADMIN },
      { to: '/settings/development', label: 'Development notice', for: ADMIN },
      // The owner's: it replaces the wording, pages, accounts and look in one go.
      { to: '/settings/bundle', label: 'Import and export', for: ['owner'] },
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
      { to: '/access/journalists', label: 'Journalist requests', for: GRANTERS },
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

/** Pages in the frame that no entry names. */
const FRAMED_ALSO: readonly string[] = [];

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
    label: 'For journalists',
    // Not a desk (decision 81): the board, with more on it, and their alerts.
    pages: [{ to: '/journalists/alerts', label: 'Alerts and access', for: ['journalist'] }],
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

/** The arrangement above in one list, groups first. */
export const ARRANGED_ENTRIES: readonly StaffEntry[] = [
  ...STAFF_GROUPS.flatMap((g) => g.pages),
  ...STAFF_AREAS.flatMap((a) => a.pages),
];

const MENU_ENTRIES: readonly StaffEntry[] = MENU.flatMap((s) => s.pages);

/**
 * Pages the arrangement above names that the menu does not hold yet: not one
 * of its addresses, not folded into one of its pages, and not under one. An
 * alias is a second way to a page, so it is never listed on its own.
 */
export const UNSORTED: readonly StaffEntry[] = ARRANGED_ENTRIES.filter(
  (e) => !e.alias && entryAt(e.to, MENU_ENTRIES) === null,
);

/** Every staff screen in one list, in the menu's order, then those not sorted yet. */
export const STAFF_ENTRIES: readonly StaffEntry[] = [...MENU_ENTRIES, ...UNSORTED];

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
              : a === 'org_manager'
                ? (viewer.memberships ?? []).some((m) => m.role === 'manager')
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

// A declaration, not a const: UNSORTED calls entryAt while the module loads.
function trimmed(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Which staff page this address is, if any: its own address exactly, else
 * the menu entry it was folded into (menu.ts, FOLDED), else the entry with
 * the longest `under` prefix that holds it. An alias is never the answer.
 */
export function entryAt(
  pathname: string,
  entries: readonly StaffEntry[] = STAFF_ENTRIES,
): StaffEntry | null {
  const path = trimmed(pathname);
  const real = entries.filter((e) => !e.alias);
  const exact = real.find((e) => e.to === path);
  if (exact) return exact;
  const folded = FOLDED[path];
  const into = folded === undefined ? undefined : real.find((e) => e.to === folded);
  if (into) return into;
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

/** The menu section this address belongs to, if any ("Not sorted yet" included). */
export function sectionAt(pathname: string): MenuSection | null {
  const entry = entryAt(pathname);
  if (!entry) return null;
  return allSections().find((s) => s.pages.includes(entry)) ?? null;
}

const NOT_SORTED: MenuSection = { id: 'unsorted', label: 'Not sorted yet', pages: UNSORTED };

/** The menu's sections in order, "Not sorted yet" (when it holds anything) before Help. */
function allSections(): MenuSection[] {
  const help = MENU.filter((s) => s.id === 'help');
  return [
    ...MENU.filter((s) => s.id !== 'help'),
    ...(UNSORTED.length ? [NOT_SORTED] : []),
    ...help,
  ];
}

/** The menu's sections (menu.ts), each with only what this person may open. */
export function sectionsFor(viewer: Viewer): MenuSection[] {
  return allSections()
    .map((s) => ({ ...s, pages: entriesFor(viewer, s.pages) }))
    .filter((s) => s.pages.length > 0);
}
