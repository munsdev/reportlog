/**
 * The documentation's table of contents: every page, in reading order.
 *
 * A page is a Markdown file under `apps/site/content/` named by its slug
 * (`admin/logbooks` is `content/admin/logbooks.md`, served at
 * `/docs/admin/logbooks/`). The section "Running a server" is not listed
 * here: its pages are cut from `deploy/README.md` at build time, one per
 * `##` heading, so they follow the runbook rather than a copy of it.
 *
 * `test/build.test.ts` fails if a content file is missing from this list or
 * a listed page has no file, so a page cannot be written and forgotten.
 */
export interface NavSection {
  title: string;
  /** Slugs of hand-written pages, or OPERATE for the runbook's pages. */
  pages: readonly string[] | typeof OPERATE;
}

export const OPERATE = Symbol('operate');

export const NAV: readonly NavSection[] = [
  {
    title: 'Getting started',
    pages: ['introduction', 'how-it-works', 'quick-start', 'first-hour'],
  },
  { title: 'Running a server', pages: OPERATE },
  {
    title: 'Running the site',
    pages: [
      'admin/logbooks',
      'admin/lists',
      'admin/front-page-and-look',
      'admin/doors-and-intake',
      'admin/files',
      'admin/maps-and-numbers',
      'admin/organizations',
      'admin/journalists',
      'admin/legal-and-privacy',
      'admin/records',
    ],
  },
  {
    title: 'Moderating',
    pages: [
      'moderate/the-queue',
      'moderate/reporter-details',
      'moderate/files-and-evidence',
      'moderate/floods',
      'moderate/tips-lists-and-notices',
    ],
  },
  {
    title: 'People and access',
    pages: ['people/roles', 'people/signing-in', 'people/accounts'],
  },
  {
    title: 'Reporters and the public',
    pages: ['public/filing', 'public/my-reports', 'public/checking-a-report', 'public/the-board'],
  },
  {
    title: 'Reference',
    pages: [
      'reference/commands',
      'reference/settings',
      'reference/question-kinds',
      'reference/roles',
      'reference/public-api',
      'reference/data-and-privacy',
      'reference/trust-model',
    ],
  },
];
