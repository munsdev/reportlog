/**
 * Which pages search engines are invited to index. ONE LIST, read by the
 * API's sitemap and by the website's robots meta tag, so the two cannot
 * disagree about a page.
 *
 * An allow-list on purpose: a page nobody thought about (a new staff screen,
 * a link carrying a token) is kept out of search until somebody adds it
 * here. The cost of forgetting a public page is that it is not found; the
 * cost of forgetting a private one would be that it is.
 *
 * A single report (/board/RL-...) is NOT here. Indexing makes a reporter's
 * published words findable by searching for them, for good, and that waits
 * on the owner's decision (DPIA risk 1). Adding `/board/` reports is the
 * whole change when it is made.
 */
import { RESERVED_SLUGS } from './slugs.ts';

/** Pages at a fixed address, in the order a sitemap lists them. */
export const INDEXED_PAGES: readonly string[] = [
  '/',
  '/about',
  '/how',
  '/standards',
  '/journalists',
  '/get-involved',
  '/board',
  '/board/maps',
  '/board/numbers',
  '/board/activity',
  '/board/press',
  '/organizations',
  '/verify',
  '/illegal-content',
  '/legal',
  '/terms',
  '/docs',
  '/docs/checking',
  '/docs/first-logbook',
];

/**
 * Single-segment pages the router has that `RESERVED_SLUGS` does not name.
 * They are routes, so they win over a logbook's address, and must not be
 * mistaken for one here.
 */
const NOT_A_FORM: ReadonlySet<string> = new Set(['account', 'people', 'map']);

/** A path without its trailing slash, the form every comparison here uses. */
export function plainPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/**
 * May search engines index this page? The fixed pages above, a public map
 * (/maps/<slug>), and a logbook's or list's form at the site's root
 * (/<slug>), which is how somebody searching for where to report finds it.
 */
export function indexable(pathname: string): boolean {
  const path = plainPath(pathname);
  if (INDEXED_PAGES.includes(path)) return true;
  const parts = path.split('/').slice(1);
  if (parts.length === 2 && parts[0] === 'maps' && parts[1]) return true;
  if (parts.length !== 1 || !parts[0]) return false;
  const slug = parts[0];
  return /^[a-z0-9-]+$/.test(slug) && !RESERVED_SLUGS.has(slug) && !NOT_A_FORM.has(slug);
}

/**
 * Paths no crawler should fetch at all, for robots.txt: the API, and every
 * page whose address carries a token from an email or a thread's id. A
 * `noindex` on such a page would only be read by fetching it, which is what
 * is to be avoided.
 */
export const NEVER_CRAWLED: readonly string[] = [
  '/api/',
  '/file/confirm/',
  '/file/erase/',
  '/evidence/',
  // With the slash: robots.txt matches by prefix, and /mine alone would
  // also keep crawlers off a logbook at /miners-strike. /mine itself says
  // noindex on the page.
  '/mine/',
  '/journalists/access/',
  '/journalists/confirm/',
  '/journalists/settings/',
  '/journalists/stop/',
  '/notifications/stop/',
  '/illegal-content/status/',
  '/organizations/join/',
  '/access/invitation/',
];
