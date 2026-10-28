/**
 * What the menu offers each role, written out for the browser suite
 * (e2e/navigation.spec.ts and the owner's case in e2e/owner/backups.spec.ts).
 *
 * Written out rather than imported from src/features/staff-nav/menu.ts,
 * so the browser tests load nothing of the website's own code. It cannot
 * drift: test/navigation-table.test.ts fails unless this table is exactly
 * what the menu gives each role.
 */

export interface MenuPage {
  label: string;
  /** The address, as the link's href ends (no trailing slash). */
  href: string;
  /** The staff area holding it, or none for the groups by who you are (You, the desk, the organization). */
  area?: string;
}

export const ALL_PAGES: readonly MenuPage[] = [
  { label: 'Your dashboard', href: '/home' },
  { label: 'My reports', href: '/mine' },
  { label: 'Email updates', href: '/notifications' },
  { label: 'Your account', href: '/account' },
  { label: 'Checked links', href: '/desk' },
  // Review has a "Written accounts" too: same words, a different page and a
  // different reader, so anything that looks one up must go by address.
  { label: 'Written accounts', href: '/desk/texts' },
  { label: 'Sources', href: '/desk/sources' },
  { label: 'Your alerts', href: '/desk/alerts' },
  { label: 'Filing for an organization', href: '/intake' },
  { label: 'Volunteer links', href: '/intake/links' },
  { label: 'Members', href: '/intake/members' },
  { label: 'Directory listing', href: '/intake/listing' },
  { area: 'Review', label: 'Reports queue', href: '/moderate' },
  { area: 'Review', label: 'Written accounts', href: '/moderate/texts' },
  { area: 'Review', label: 'Links', href: '/lists/links' },
  { area: 'Review', label: 'List entries', href: '/lists/review' },
  { area: 'Review', label: 'Files waiting', href: '/files' },
  { area: 'Review', label: 'Illegal content notices', href: '/moderate/illegal-content' },
  { area: 'Review', label: 'Flood screen', href: '/moderate/flood' },
  { area: 'Content', label: 'Logbooks', href: '/logbooks' },
  { area: 'Content', label: 'Lists', href: '/lists' },
  { area: 'Content', label: 'Maps', href: '/maps' },
  { area: 'Content', label: 'Front page and pages', href: '/logbooks/pages' },
  { area: 'Site settings', label: 'Switches', href: '/settings/switches' },
  { area: 'Site settings', label: 'Name and look', href: '/settings/name' },
  { area: 'Site settings', label: 'Wording', href: '/settings/words' },
  { area: 'Site settings', label: 'Legal notices', href: '/settings/legal' },
  { area: 'Site settings', label: 'Social media', href: '/settings/social' },
  { area: 'Site settings', label: 'Report and tip forms', href: '/settings/forms' },
  { area: 'Site settings', label: 'Moderation rules', href: '/moderate/settings' },
  { area: 'Site settings', label: 'File limits', href: '/files/settings' },
  { area: 'Site settings', label: 'Import and export', href: '/settings/bundle' },
  { area: 'People', label: 'People', href: '/people' },
  { area: 'People', label: 'Organizations', href: '/access/orgs' },
  { area: 'People', label: 'Journalists', href: '/access/journalists' },
  { area: 'People', label: 'Ownership', href: '/people/ownership' },
  { area: 'Records and system', label: 'Transparency log', href: '/transparency-log' },
  { area: 'Records and system', label: 'Who opened protected data', href: '/who-opened-what' },
  { area: 'Records and system', label: 'Backups and exports', href: '/backups' },
  { area: 'Records and system', label: 'Updates', href: '/updates' },
  { area: 'Help', label: 'Guides', href: '/docs' },
  { area: 'Help', label: 'Feedback', href: '/feedback' },
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
const YOU = ['Your dashboard', 'My reports', 'Email updates', 'Your account'];
const DESK = ['Checked links', 'Written accounts', 'Sources', 'Your alerts'];
/** Everything but the journalist desk and the organization's pages. */
const STAFF_ONLY = (...gone: string[]) => {
  const not = new Set(
    ALL_PAGES.filter(
      (p) => p.href === '/desk' || p.href.startsWith('/desk/') || p.href.startsWith('/intake'),
    ).map((p) => p.href),
  );
  return ALL_PAGES.filter((p) => !not.has(p.href) && !gone.includes(p.label)).map((p) => p.label);
};

/** The pages each role's sidebar shows, by label, in the sidebar's order. */
export const MENU_FOR: Readonly<Record<MenuRole, readonly string[]>> = {
  visitor: [],
  reporter: YOU,
  moderator: [
    ...YOU,
    ...pick(
      'Reports queue',
      'Written accounts',
      'Links',
      'List entries',
      'Files waiting',
      'Illegal content notices',
      'Flood screen',
      'Guides',
    ),
  ],
  admin: STAFF_ONLY('Import and export', 'Journalists', 'Backups and exports'),
  owner: STAFF_ONLY(),
  access_manager: [...YOU, ...pick('People', 'Organizations', 'Ownership', 'Guides', 'Feedback')],
  journalist: [...YOU, ...DESK],
  // Volunteer links and Members are for an organization's managers.
  coordinator: [...YOU, 'Filing for an organization', 'Directory listing'],
  tester: [...YOU, 'Feedback'],
};

export const pageByLabel = (label: string): MenuPage => {
  const page = ALL_PAGES.find((p) => p.label === label);
  if (!page) throw new Error(`no menu page called ${label}`);
  return page;
};
