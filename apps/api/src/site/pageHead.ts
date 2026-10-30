/**
 * The website's page, with its head written for the address asked for.
 *
 * The page is drawn in a browser, so the file Caddy used to serve for every
 * address (apps/web/dist/index.html) names no page: a link-preview bot or a
 * search engine that does not run the page's script saw the same title and
 * sentence for all of them, and a 200 for an address that is nothing at all.
 * Caddy now hands every address that is not a file to this route
 * (deploy/caddy/Caddyfile), which answers that same file with the title, the
 * description, the canonical address, the robots instruction and the share
 * tags filled in, and with a real 404 where the address is clearly nothing.
 *
 * The website keeps its own head right while somebody moves about
 * (usePageTitle, features/site-pages/searchMeta.tsx). This is the first
 * answer; that is the rest.
 *
 * IN FRONT OF THE PASSWORD (identity/gate.ts), because a bot has none and a
 * visitor's browser asks before it has one. Behind a password this route
 * says nothing about the site beyond its name: the same head for every
 * address, noindex, and always 200 (a 404 would tell a stranger which
 * addresses are logbooks).
 *
 * A WRONG 404 IS WORSE THAN A SOFT 200. Only three cases are called 404:
 * a one-segment address that is no page, logbook, list or map; a map
 * address with no such map; a board address with no such published report.
 * The server cannot read the router, so everything else is 200.
 */
import { RESERVED_SLUGS, indexable, plainName, plainPath } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { boardReport } from '../board/board.ts';
import { publicArchiveAvailable } from '../board/publication.ts';
import type { Database } from '../db/database.ts';
import { gateApplies, siteAccessSettings } from '../identity/siteAccess.ts';
import { logbookByAddress } from '../logbooks/logbooks.ts';
import { listBySlug } from '../lists/rows.ts';
import { mapBySlug } from '../maps/rows.ts';
import { resolveCopy } from './copy.ts';
import { resolveSiteName } from './identity.ts';
import { readCopy, readSettings } from './settings.ts';

export const PAGE_PATH = '/api/site/page/*';
/** What the share image route answers (site/shareImage.ts, built beside this). */
export const SHARE_IMAGE_PATH = '/api/site/share.png';

/** The sentence index.html carries, for an address nothing more is known of. */
const GENERIC_DESCRIPTION = 'File and check incident reports in a tamper-evident archive.';

/**
 * What the fixed public pages are called and say, in this software's own
 * words (the operator's, where they wrote some: the front page). The titles
 * are the ones the pages put in the browser tab. One plain sentence each,
 * and nothing that promises more than the page does.
 */
const PAGES: Readonly<Record<string, { title: string; description: string }>> = {
  '/about': {
    title: 'About',
    description: 'What this archive is for, how its reports are kept, and how to read them.',
  },
  '/how': {
    title: 'How to use this',
    description:
      'How to file a report one question at a time, what happens to it afterwards, and how to check that it has not changed.',
  },
  '/standards': {
    title: 'Standards',
    description: 'What gets published here, what is held back, and who decides.',
  },
  '/journalists': {
    title: 'For journalists',
    description:
      'Alerts about new reports, the public interface, and how a journalist asks for desk access.',
  },
  '/get-involved': {
    title: 'Get involved',
    description: 'Ways to help, and ways to spread the word.',
  },
  '/board': {
    title: 'Reports',
    description: 'Every report a moderator has approved for publication.',
  },
  '/board/maps': {
    title: 'Maps',
    description:
      'Where published reports say things happened. An area with too few reports to count safely is not shaded.',
  },
  '/board/numbers': {
    title: 'By the numbers',
    description: 'Counts of the published reports, taken from the questions each logbook asks.',
  },
  '/board/activity': {
    title: 'Arrivals, declines and switches',
    description:
      'When reports arrived, how many were declined and why, and every time a moderator used a flood switch.',
  },
  '/board/press': {
    title: 'Press pack',
    description:
      'Documents about this archive, for reporters, reviewers and anybody writing about it.',
  },
  '/organizations': {
    title: 'Organizations',
    description: 'The organizations that have asked to be listed alongside this archive.',
  },
  '/verify': {
    title: 'Check a report',
    description:
      'Enter a report reference to recompute its fingerprint in your browser and compare it with the chain.',
  },
  '/illegal-content': {
    title: 'Report illegal content',
    description: 'If something on this site is illegal, tell us here. You do not need an account.',
  },
  '/legal': {
    title: 'Imprint and privacy',
    description: 'Who runs this site, and what it does with the information it holds.',
  },
  '/terms': {
    title: 'Terms of use and contact',
    description: 'What this site does with what you send it, and who to write to.',
  },
  '/docs': {
    title: 'Guides',
    description:
      'How to run this archive once it is installed: making a logbook, deciding who reviews, and checking it all works.',
  },
  '/docs/checking': {
    title: 'Checking it works',
    description:
      'What to try in a browser on every new deployment, and how anybody checks a report.',
  },
  '/docs/first-logbook': {
    title: 'Your first logbook',
    description:
      'Building the questions, the one decision that cannot be undone, appointing somebody to review, and filing a report through the whole path.',
  },
};

/** Routes of the website that take one word at the root and are not a form. */
const OTHER_ROOT_PAGES: ReadonlySet<string> = new Set(['account', 'people', 'map']);

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** A blurb as one line of at most ~200 characters, cut at a word. */
export function oneLine(text: string | null | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= 200) return flat;
  const cut = flat.slice(0, 199);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 120))}…`;
}

/** What goes in the head of one page. */
export interface HeadTags {
  siteName: string;
  /** The page's own name, or null for the generic head. */
  page: string | null;
  description: string;
  /** Present only when the page may be indexed: the address search engines should keep. */
  canonical?: string;
  /** The page's address, for og:url. Absent on the generic head. */
  url?: string;
  imageUrl: string;
}

export function headHtml(t: HeadTags): string {
  const title = t.page ? `${t.page} · ${t.siteName}` : t.siteName;
  const meta = (attr: 'name' | 'property', key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escape(value)}" />`;
  return [
    `<title>${escape(title)}</title>`,
    meta('name', 'description', t.description),
    // Said as the client says it (searchMeta.tsx): a canonical address and
    // index only for a page that may be indexed, noindex for the rest.
    meta('name', 'robots', t.canonical ? 'index, follow' : 'noindex'),
    ...(t.canonical ? [`<link rel="canonical" href="${escape(t.canonical)}" />`] : []),
    meta('property', 'og:site_name', t.siteName),
    meta('property', 'og:title', title),
    meta('property', 'og:description', t.description),
    ...(t.url ? [meta('property', 'og:url', t.url)] : []),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:image', t.imageUrl),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('name', 'twitter:card', 'summary_large_image'),
  ]
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * The built page with its own title and description taken out (index.html
 * says one sentence for every deployment) and `tags` put at the end of the
 * head. Replaced, not added to: two titles is a bot's choice.
 */
export function fillHead(template: string, tags: string): string {
  const bare = template
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\s*?\n?/i, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*>\s*?\n?/i, '');
  return /<\/head>/i.test(bare)
    ? bare.replace(/<\/head>/i, () => `${tags}\n  </head>`)
    : `${tags}\n${bare}`;
}

/** What a page with no website built beside the API (development) is: only a head. */
const BARE_PAGE =
  '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n  </head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n';

/**
 * The release's index.html, read when first asked for and kept: it does not
 * change under a running server (a deploy restarts the API). A missing file
 * is not kept, so a development checkout that builds later is found.
 */
export function templateReader(
  file: URL = new URL('../../../../apps/web/dist/index.html', import.meta.url),
) {
  let kept: string | null = null;
  return (): string => {
    if (kept !== null) return kept;
    try {
      kept = readFileSync(file, 'utf8');
      return kept;
    } catch {
      // Development runs the website under Vite, which never calls this; a
      // production release always has the file.
      return BARE_PAGE;
    }
  };
}

interface Verdict {
  status: 200 | 404;
  /** null: nothing particular is known of this address. */
  page: { title: string; description: string; path: string } | null;
}

const GENERIC: Verdict = { status: 200, page: null };

/** Which words and status an address gets, on a site anybody may read. */
export async function judge(db: Database, pathname: string): Promise<Verdict> {
  const path = plainPath(pathname);
  const parts = path.split('/').slice(1);
  const fixed = PAGES[path];
  if (fixed) return { status: 200, page: { ...fixed, path } };

  if (path === '/') {
    // The operator's own words, unless they hold a figure that only the
    // public site renders ({{ … }}): then the shipped sentence will do.
    const copy = resolveCopy(await readCopy(db));
    const plain = (s: string) => (s.includes('{{') ? '' : oneLine(s));
    return {
      status: 200,
      page: {
        title: plain(copy.home_headline),
        description: plain(copy.home_lede) || GENERIC_DESCRIPTION,
        path,
      },
    };
  }

  // /board/<ref>: a report that is not published is "not found" on the page
  // too. Never worded here: a report's words are not indexed (robots.ts in
  // contracts), and a bot that reads this head must not be given them.
  if (parts[0] === 'board' && parts.length === 2 && parts[1]) {
    const ref = parts[1];
    if (ref.length > 64) return GENERIC;
    return (await boardReport(db, ref)) ? GENERIC : { status: 404, page: null };
  }

  // /maps/<slug> (and the old /map/<slug>, which the page redirects).
  if (parts[0] === 'maps' && parts.length === 2 && parts[1]) {
    return judgeMap(db, parts[1]);
  }

  // /<address>: a logbook, a list or a map, when it is anything.
  if (parts.length === 1 && parts[0]) {
    const address = parts[0];
    const isRoute = RESERVED_SLUGS.has(address) || OTHER_ROOT_PAGES.has(address);
    // Not the shape of any address: the page decides (soft 200).
    if (isRoute || !indexable(path)) return GENERIC;

    const lb = await logbookByAddress(db, address);
    // A draft does not exist publicly (logbooks/routes.ts getPublicLogbook).
    if (lb && lb.state !== 'draft') {
      return {
        status: 200,
        page: {
          title: lb.title,
          description: oneLine(lb.blurb) || `File a report to ${lb.title}.`,
          // The real address, when the visitor came by the short one.
          path: `/${lb.slug}`,
        },
      };
    }
    const list = await listBySlug(db, address);
    if (list) {
      // Only a listed list is described; the others exist, and that is all
      // this says of them (lists/routes.ts maySee).
      return list.visibility === 'listed'
        ? {
            status: 200,
            page: {
              title: list.title,
              description: oneLine(list.blurb) || `Add your name to ${list.title}.`,
              path,
            },
          }
        : GENERIC;
    }
    const map = await judgeMap(db, address);
    if (map.status === 200) return map;
    return { status: 404, page: null };
  }
  return GENERIC;
}

async function judgeMap(db: Database, slug: string): Promise<Verdict> {
  const map = await mapBySlug(db, slug);
  if (!map) return { status: 404, page: null };
  // Described only while the map is public; otherwise the page says why not.
  if (!map.enabled || !(await publicArchiveAvailable(db))) return GENERIC;
  return {
    status: 200,
    page: {
      title: map.title,
      description: oneLine(map.blurb) || `A map of the published reports: ${map.title}.`,
      path: `/maps/${map.slug}`,
    },
  };
}

export interface PageHeadDeps {
  db: Database;
  siteOrigin: string;
  /** SEARCH_ENGINES in config.ts. Off asks every crawler to stay out. */
  searchEngines: 'on' | 'off';
  /** The built index.html. Tests pass a small one. */
  template?: string;
}

export function pageHeadRoutes(app: FastifyInstance, deps: PageHeadDeps): void {
  const { db } = deps;
  const siteOrigin = deps.siteOrigin.replace(/\/+$/, '');
  const template = deps.template === undefined ? templateReader() : () => deps.template ?? '';

  app.get<{ Params: { '*': string } }>(PAGE_PATH, async (request, reply) => {
    const asked = `/${request.params['*']}`;
    const settings = await siteAccessSettings(db);
    const siteName = plainName(resolveSiteName((await readSettings(db)).site_name));
    const behindPassword = gateApplies(settings);

    // A path that is not a path (control characters, absurd length) gets the
    // generic head, never an error: the person is trying to read a page.
    const sane = asked.length <= 300 && !/\p{Cc}/u.test(asked);
    const verdict = behindPassword || !sane ? GENERIC : await judge(db, asked);

    // Each page's own card (site/shareImage.ts), drawn from the same words as
    // this head; the plain one where nothing particular is known.
    const plainImage = `${siteOrigin}${SHARE_IMAGE_PATH}`;
    let tags: HeadTags;
    if (verdict.page) {
      const path = verdict.page.path;
      const imageUrl = `${plainImage}?path=${encodeURIComponent(path)}`;
      const index = deps.searchEngines === 'on' && indexable(path);
      tags = {
        siteName,
        page: verdict.page.title || null,
        description: verdict.page.description,
        url: siteOrigin + path,
        ...(index ? { canonical: siteOrigin + path } : {}),
        imageUrl,
      };
    } else {
      tags = { siteName, page: null, description: GENERIC_DESCRIPTION, imageUrl: plainImage };
    }

    const body = fillHead(template(), headHtml(tags));
    // The web's own policy is set by Caddy on this answer
    // (deploy/caddy/Caddyfile); the API's would forbid framing, which the
    // look editor needs.
    const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
    void reply
      .status(verdict.status)
      .type('text/html; charset=utf-8')
      // The answer changes with the site's settings and a release: always ask again.
      .header('cache-control', 'no-cache')
      .header('etag', etag);
    if (verdict.status === 200 && request.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }
    return reply.send(body);
  });
}
