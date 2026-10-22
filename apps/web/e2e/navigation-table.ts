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
  /** The staff area holding it, or none for the "You" row's groups. */
  area?: string;
}

const MOD = 'Moderation';
const BOOKS = 'Logbooks and lists';
const SET = 'Site settings';
const PEOPLE = 'People and access';
const REC = 'Records';

export const ALL_PAGES: readonly MenuPage[] = [
  { area: MOD, label: 'Queue', href: '/moderate' },
  { area: MOD, label: 'Flood screen', href: '/moderate/flood' },
  { area: MOD, label: 'Tip links', href: '/lists/links' },
  { area: MOD, label: 'List review', href: '/lists/review' },
  { area: MOD, label: 'Illegal content notices', href: '/moderate/illegal-content' },
  { area: MOD, label: 'Files', href: '/files' },
  { area: MOD, label: 'Agreement', href: '/moderate/agreement' },
  { area: MOD, label: 'Moderation settings', href: '/moderate/settings' },
  { area: BOOKS, label: 'Logbooks', href: '/logbooks' },
  { area: BOOKS, label: 'Front page', href: '/logbooks/front-page' },
  { area: BOOKS, label: 'Lists', href: '/lists' },
  { area: BOOKS, label: 'Maps', href: '/maps' },
  { area: BOOKS, label: 'Find entries', href: '/lists/search' },
  { area: BOOKS, label: 'File limits', href: '/files/settings' },
  { area: SET, label: 'Overview', href: '/settings' },
  { area: SET, label: 'Look', href: '/settings/look' },
  { area: SET, label: 'Name', href: '/settings/name' },
  { area: SET, label: 'Wording', href: '/settings/words' },
  { area: SET, label: 'Legal notices', href: '/settings/legal' },
  { area: SET, label: 'Report and tip forms', href: '/settings/forms' },
  { area: SET, label: 'Starting points', href: '/settings/starting-points' },
  { area: SET, label: 'Development notice', href: '/settings/development' },
  { area: SET, label: 'Feedback queue', href: '/settings/feedback' },
  { area: PEOPLE, label: 'Roles', href: '/access' },
  { area: PEOPLE, label: 'Organizations', href: '/access/orgs' },
  { area: PEOPLE, label: 'Journalists', href: '/access/journalists' },
  { area: PEOPLE, label: 'Who is doing what', href: '/access/roster' },
  { area: PEOPLE, label: 'Who granted what', href: '/access/audit' },
  { area: REC, label: 'Transparency log', href: '/transparency-log' },
  { area: REC, label: 'Backups and exports', href: '/backups' },
  { area: REC, label: 'Who opened protected data', href: '/moderate/settings#who-opened-what' },
  { label: 'Intake', href: '/intake' },
  { label: 'Volunteer links', href: '/intake/links' },
  { label: 'Journalist desk', href: '/desk' },
  { label: 'Feedback', href: '/feedback' },
  { label: 'Testers', href: '/feedback/testers' },
  { label: 'Guides', href: '/docs' },
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
const ADMIN_PAGES = ALL_PAGES.map((p) => p.label).filter(
  (l) =>
    ![
      'Journalists',
      'Backups and exports',
      'Intake',
      'Volunteer links',
      'Journalist desk',
    ].includes(l),
);

/** The staff pages each role's menu shows, by label, in the menu's order. */
export const MENU_FOR: Readonly<Record<MenuRole, readonly string[]>> = {
  visitor: [],
  reporter: [],
  moderator: pick(
    'Queue',
    'Flood screen',
    'Tip links',
    'List review',
    'Illegal content notices',
    'Files',
    'Guides',
  ),
  admin: ADMIN_PAGES,
  owner: ALL_PAGES.map((p) => p.label).filter(
    (l) => !['Intake', 'Volunteer links', 'Journalist desk'].includes(l),
  ),
  access_manager: pick(
    'Roles',
    'Organizations',
    'Who is doing what',
    'Who granted what',
    'Feedback',
    'Testers',
    'Guides',
  ),
  journalist: pick('Journalist desk'),
  coordinator: pick('Intake', 'Volunteer links'),
  tester: pick('Feedback'),
};

export const pageByLabel = (label: string): MenuPage => {
  const page = ALL_PAGES.find((p) => p.label === label);
  if (!page) throw new Error(`no menu page called ${label}`);
  return page;
};
