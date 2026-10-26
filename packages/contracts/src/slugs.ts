/**
 * Web addresses a logbook or a list may not take. Both are served from the
 * root of the site (electionlog.org/volunteer), so a slug equal to a page that
 * already lives there would be unreachable, or worse, would shadow it.
 *
 * Keep this in step with the folders under apps/web/src/routes, the API
 * prefix and the files the web server serves from the root.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // public pages
  'about',
  'board',
  'desk',
  'dev',
  'docs',
  'evidence',
  'feedback',
  'file',
  'home',
  'how',
  'illegal-content',
  'journalists',
  'legal',
  'list',
  'mine',
  'notifications',
  'organizations',
  'public-api',
  'standards',
  'submit',
  'terms',
  'verify',
  // staff pages
  'access',
  'backups',
  'files',
  'intake',
  'lists',
  'logbooks',
  'maps',
  'moderate',
  'settings',
  'transparency-log',
  'updates',
  'who-opened-what',
  // not pages, but never a form
  'admin',
  'api',
  'assets',
  'health',
  'icons',
  'login',
  'static',
]);
