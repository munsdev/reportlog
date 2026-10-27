/**
 * What the menu offers each role, written out for the browser suite
 * (e2e/navigation.spec.ts and the owner's case in e2e/owner/backups.spec.ts).
 *
 * Written out rather than imported from src/features/staff-nav/entries.ts,
 * so the browser tests load nothing of the website's own code. It cannot
 * drift: test/navigation-table.test.ts fails unless this table is exactly
 * what entries.ts gives each role.
 */

export interface MenuPage {
  label: string;
  /** The address, as the link's href ends (no trailing slash). */
  href: string;
  /** The staff area holding it, or none for the groups before the areas. */
  area?: string;
}

export const ALL_PAGES: readonly MenuPage[] = [
  { label: 'Your dashboard', href: '/home' },
  { label: 'My reports', href: '/mine' },
  { label: 'Email updates', href: '/notifications' },
  { label: 'Signing in', href: '/access/security' },
  { label: 'Checked links', href: '/desk' },
  // Review has a "Written accounts" too: same words, a different page and a
  // different reader, so anything that looks one up must go by address.
  { label: 'Written accounts', href: '/desk/texts' },
  { label: 'Sources', href: '/desk/sources' },
  { label: 'Your alerts', href: '/desk/alerts' },
  { label: 'Filing for an organization', href: '/intake' },
  { label: 'Volunteer links', href: '/intake/links' },
  { area: 'Review', label: 'Reports queue', href: '/moderate' },
  { area: 'Review', label: 'Written accounts', href: '/moderate/texts' },
  { area: 'Review', label: 'Links', href: '/lists/links' },
  { area: 'Review', label: 'List entries', href: '/lists/review' },
  { area: 'Review', label: 'Files', href: '/files' },
  { area: 'Review', label: 'Illegal content notices', href: '/moderate/illegal-content' },
  { area: 'Review', label: 'Flood screen', href: '/moderate/flood' },
  { area: 'Content', label: 'Logbooks', href: '/logbooks' },
  { area: 'Content', label: 'Lists', href: '/lists' },
  { area: 'Content', label: 'Maps', href: '/maps' },
  { area: 'Content', label: 'Find somebody’s entries', href: '/lists/search' },
  { area: 'Content', label: 'Report and tip forms', href: '/settings/forms' },
  { area: 'Content', label: 'Starting points', href: '/settings/starting-points' },
  { area: 'Content', label: 'Front page', href: '/logbooks/front-page' },
  { area: 'Site', label: 'Name', href: '/settings/name' },
  { area: 'Site', label: 'Look', href: '/settings/look' },
  { area: 'Site', label: 'Wording', href: '/settings/words' },
  { area: 'Site', label: 'Social media', href: '/settings/social' },
  { area: 'Site', label: 'Legal notices', href: '/settings/legal' },
  { area: 'Site', label: 'Development notice', href: '/settings/development' },
  { area: 'Rules', label: 'Moderation settings', href: '/moderate/settings' },
  { area: 'Rules', label: 'File limits', href: '/files/settings' },
  { area: 'Rules', label: 'Moderator agreement', href: '/moderate/agreement' },
  { area: 'Rules', label: 'Journalist agreement', href: '/access/journalists/agreement' },
  { area: 'Rules', label: 'Site password', href: '/access#site-password' },
  { area: 'People', label: 'People and roles', href: '/access' },
  { area: 'People', label: 'Organizations', href: '/access/orgs' },
  { area: 'People', label: 'Journalist requests', href: '/access/journalists' },
  { area: 'People', label: 'Testers', href: '/feedback/testers' },
  { area: 'People', label: 'Who is doing what', href: '/access/roster' },
  { area: 'Logs and system', label: 'Transparency log', href: '/transparency-log' },
  { area: 'Logs and system', label: 'Who granted what', href: '/access/audit' },
  { area: 'Logs and system', label: 'Who opened protected data', href: '/who-opened-what' },
  { area: 'Logs and system', label: 'Backups and exports', href: '/backups' },
  { area: 'Logs and system', label: 'Updates', href: '/updates' },
  { area: 'Help', label: 'Guides', href: '/docs' },
  { area: 'Help', label: 'Feedback', href: '/feedback' },
  { area: 'Help', label: 'Feedback queue', href: '/settings/feedback' },
];

export type MenuRole =
  | 'visitor'
  | 'reporter'
  | 'moderator'
  | 'admin'
  | 'access_manager'
  | 'owner'
  | 'journalist'
  | 'coordinator'
  | 'tester';

const pick = (...labels: string[]) => labels;
const YOU = ['Your dashboard', 'My reports', 'Email updates'];
/** Anyone holding a role also has the page to prove a second factor. */
const YOU_STAFF = [...YOU, 'Signing in'];
const ORG = ['Filing for an organization', 'Volunteer links'];
const DESK = ['Checked links', 'Written accounts', 'Sources', 'Your alerts'];
/** Everything but the journalist desk: "Written accounts" is also Review's, which stays. */
const WITHOUT_DESK = (...gone: string[]) => {
  const desk = new Set(
    ALL_PAGES.filter((p) => p.href === '/desk' || p.href.startsWith('/desk/')).map((p) => p.href),
  );
  return ALL_PAGES.filter((p) => !desk.has(p.href) && !gone.includes(p.label)).map((p) => p.label);
};

/** The pages each role's sidebar shows, by label, in the sidebar's order. */
export const MENU_FOR: Readonly<Record<MenuRole, readonly string[]>> = {
  visitor: [],
  reporter: YOU,
  moderator: [
    ...YOU_STAFF,
    ...pick(
      'Reports queue',
      'Written accounts',
      'Links',
      'List entries',
      'Files',
      'Illegal content notices',
      'Flood screen',
      'Guides',
    ),
  ],
  admin: WITHOUT_DESK('Journalist agreement', 'Journalist requests', 'Backups and exports', ...ORG),
  owner: WITHOUT_DESK(...ORG),
  access_manager: [
    ...YOU_STAFF,
    ...pick(
      'People and roles',
      'Organizations',
      'Testers',
      'Who is doing what',
      'Who granted what',
      'Guides',
      'Feedback',
    ),
  ],
  journalist: [...YOU_STAFF, ...DESK],
  coordinator: [...YOU, ...ORG],
  tester: [...YOU, 'Feedback'],
};

export const pageByLabel = (label: string): MenuPage => {
  const page = ALL_PAGES.find((p) => p.label === label);
  if (!page) throw new Error(`no menu page called ${label}`);
  return page;
};
