/**
 * THE MENU, as the staff sidebar draws it: the reorganization of 28 October
 * 2026. Groups by who you are (You, the desk, your organization), then five
 * staff areas by job (Review, Content, Site settings, People, Records and
 * system), then Help.
 *
 * What changed from the arrangement in `entries.ts`, and why:
 *
 *   - Your account is its own page (/account). /access was "People and
 *     roles", "Account" and the site password at once, under three names.
 *   - People is one directory (/people) for what four pages showed: People
 *     and roles, Who is doing what, Testers and Who granted what. Each
 *     person's roles, flags, team and desks change from their own row.
 *   - Switches (/settings/switches) holds every on/off for the whole site
 *     once. Accepting reports was only on an overview with no menu entry;
 *     the archive switch was on two pages.
 *   - Ownership leaves the access page for a page of its own, under People,
 *     so it adds no area to an Access Manager's menu.
 *   - Site and Rules become Site settings; Help sits at the end.
 *
 * TO ADD A SCREEN, add its line here, in the section it belongs to. A line
 * added to `entries.ts` instead still shows, under "Not sorted yet", until
 * somebody puts it here (entries.ts, `unsorted`).
 *
 * Every page's `for` is its route's own guard, as in entries.ts. This decides
 * what the menu shows, nothing more: every route refuses the wrong people
 * regardless.
 */
import type { MenuWaiting } from '@reportlog/contracts';
import type { Audience, StaffEntry } from './types.ts';

export interface MenuSection {
  id: string;
  label: string;
  pages: readonly StaffEntry[];
}

const MOD: readonly Audience[] = ['moderator', 'admin'];
const ADMIN: readonly Audience[] = ['admin'];
const GRANTERS: readonly Audience[] = ['admin', 'access_manager'];

const wait = (w: keyof MenuWaiting) => ({ waiting: w });

export const MENU: readonly MenuSection[] = [
  {
    id: 'you',
    label: 'You',
    pages: [
      { to: '/home', label: 'Your dashboard', for: ['anyone'] },
      { to: '/mine', label: 'My reports', for: ['anyone'], under: ['/mine/'] },
      { to: '/notifications', label: 'Email updates', for: ['anyone'] },
      { to: '/account', label: 'Your account', for: ['anyone'] },
    ],
  },
  {
    id: 'desk',
    label: 'Journalist desk',
    pages: [
      { to: '/desk', label: 'Checked links', for: ['journalist'] },
      { to: '/desk/texts', label: 'Written accounts', for: ['journalist'] },
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
      // Coordinators see only "you do not manage an organization" there.
      // Its route still admits them (intake/route.tsx); the menu offers it
      // to those it works for.
      { to: '/intake/links', label: 'Volunteer links', for: ['org_manager'] },
      // An organization's own pages, which name it in their address: these go
      // on to it, or ask which (intake/OrganizationJump.tsx).
      { to: '/intake/members', label: 'Members', for: ['org_manager'] },
      { to: '/intake/listing', label: 'Directory listing', for: ['organization'] },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    pages: [
      {
        to: '/moderate',
        label: 'Reports queue',
        for: MOD,
        under: ['/moderate/'],
        ...wait('reports'),
      },
      {
        to: '/moderate/texts',
        label: 'Written accounts',
        for: MOD,
        under: ['/moderate/texts/'],
        ...wait('texts'),
      },
      { to: '/lists/links', label: 'Links', for: MOD, ...wait('tip_links') },
      {
        to: '/lists/review',
        label: 'List entries',
        for: MOD,
        under: ['/lists/review/'],
        ...wait('list_entries'),
      },
      // Erasing a file is this page's too: it acts on one report's files.
      { to: '/files', label: 'Files waiting', for: MOD, under: ['/files/'] },
      { to: '/moderate/illegal-content', label: 'Illegal content notices', for: MOD },
      { to: '/moderate/flood', label: 'Flood screen', for: MOD },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    pages: [
      { to: '/logbooks', label: 'Logbooks', for: ADMIN, under: ['/logbooks/'] },
      // Finding somebody's entries is reached from the Lists page.
      { to: '/lists', label: 'Lists', for: ADMIN, under: ['/lists/'] },
      { to: '/maps', label: 'Maps', for: ADMIN, under: ['/maps/'] },
      {
        to: '/logbooks/pages',
        label: 'Front page and pages',
        for: ADMIN,
        under: ['/logbooks/front-page'],
      },
      { to: '/settings/starting-points', label: 'Starting points', for: ADMIN },
    ],
  },
  {
    id: 'site',
    label: 'Site settings',
    pages: [
      { to: '/settings/switches', label: 'Switches', for: ADMIN },
      // Two tabs: Name and Look (settings/NameLookTabs.tsx).
      { to: '/settings/name', label: 'Name and look', for: ADMIN },
      { to: '/settings/words', label: 'Wording', for: ADMIN },
      { to: '/settings/legal', label: 'Legal notices', for: ADMIN },
      { to: '/settings/social', label: 'Social media', for: ADMIN },
      { to: '/settings/forms', label: 'Report and tip forms', for: ADMIN },
      // Two tabs: the rules, and the moderator agreement (moderation/RulesTabs.tsx).
      { to: '/moderate/settings', label: 'Moderation rules', for: ADMIN },
      // A logbook's own limits are this page's too, not the files queue's.
      { to: '/files/settings', label: 'File limits', for: ADMIN, under: ['/files/logbooks/'] },
      // The owner's: it replaces the wording, pages, accounts and look in one go.
      { to: '/settings/bundle', label: 'Import and export', for: ['owner'] },
    ],
  },
  {
    id: 'people',
    label: 'People',
    pages: [
      { to: '/people', label: 'People', for: GRANTERS, under: ['/people/history'] },
      { to: '/access/orgs', label: 'Organizations', for: GRANTERS, under: ['/access/orgs/'] },
      // The agreement is a tab of this page (JournalistTabs).
      {
        to: '/access/journalists',
        label: 'Journalists',
        for: ['owner'],
        under: ['/access/journalists/'],
      },
      { to: '/people/ownership', label: 'Ownership', for: GRANTERS },
    ],
  },
  {
    id: 'records',
    label: 'Records and system',
    pages: [
      { to: '/transparency-log', label: 'Transparency log', for: ADMIN },
      { to: '/who-opened-what', label: 'Who opened protected data', for: ADMIN },
      { to: '/backups', label: 'Backups and exports', for: ['owner'] },
      { to: '/updates', label: 'Updates', for: ADMIN },
    ],
  },
  {
    // `help` by name: the sidebar adds "Report a bug on this page" here.
    id: 'help',
    label: 'Help',
    pages: [
      {
        to: '/docs',
        label: 'Guides',
        for: ['moderator', 'access_manager', 'admin', 'team'],
        under: ['/docs/'],
      },
      {
        to: '/feedback',
        label: 'Feedback',
        for: ['tester', 'admin', 'access_manager'],
        ...wait('feedback'),
      },
    ],
  },
];

/**
 * Pages that still open at their old address but have no line of their own
 * any more, each with the menu entry that took it over: on one of them, that
 * entry is "where you are", and "Not sorted yet" does not list it.
 */
export const FOLDED: Readonly<Record<string, string>> = {
  // Your account took the account half of /access; People took the rest.
  // For somebody who may not open People, the page is their account.
  '/access': '/people',
  '/access/security': '/account',
  '/access/roster': '/people',
  '/access/audit': '/people',
  '/feedback/testers': '/people',
  '/settings': '/settings/switches',
  '/settings/development': '/settings/switches',
  '/lists/search': '/lists',
  // The tabs of a page with one entry.
  '/settings/look': '/settings/name',
  '/moderate/agreement': '/moderate/settings',
  '/settings/feedback': '/feedback',
};
