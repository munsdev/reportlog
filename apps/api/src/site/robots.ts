/**
 * robots.txt and the sitemap, built per deployment: both name the site's
 * own address (SITE_ORIGIN), and the sitemap lists the logbooks and maps
 * this site has. Caddy hands /robots.txt and /sitemap.xml here
 * (deploy/caddy/Caddyfile); Vite does the same in development.
 *
 * In front of the password (identity/gate.ts), because a crawler never has
 * it. Behind a password, or with SEARCH_ENGINES=off (a test server), the
 * answer is "nothing here", and the sitemap is empty: the list of logbooks
 * is behind the password like everything else.
 *
 * Which pages are listed is `INDEXED_PAGES` (packages/contracts/src/robots.ts),
 * the same list the website's robots meta tag reads.
 */
import { INDEXED_PAGES, NEVER_CRAWLED } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { publicArchiveAvailable } from '../board/publication.ts';
import type { Database } from '../db/database.ts';
import { gateApplies, siteAccessSettings } from '../identity/siteAccess.ts';
import { openLogbooks } from '../logbooks/logbooks.ts';
import { allMaps } from '../maps/rows.ts';

export const ROBOTS_PATH = '/api/site/robots.txt';
export const SITEMAP_PATH = '/api/site/sitemap.xml';

export interface RobotsDeps {
  db: Database;
  siteOrigin: string;
  /** SEARCH_ENGINES in config.ts. Off asks every crawler to stay out. */
  searchEngines: 'on' | 'off';
}

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );

export function robotsRoutes(app: FastifyInstance, deps: RobotsDeps): void {
  const { db, siteOrigin } = deps;

  /** Whether a crawler may see anything here at all, asked on each request. */
  const open = async () =>
    deps.searchEngines === 'on' && !gateApplies(await siteAccessSettings(db));

  app.get(ROBOTS_PATH, async (_request, reply) => {
    const body = (await open())
      ? [
          'User-agent: *',
          ...NEVER_CRAWLED.map((p) => `Disallow: ${p}`),
          '',
          `Sitemap: ${siteOrigin}/sitemap.xml`,
          '',
        ].join('\n')
      : 'User-agent: *\nDisallow: /\n';
    return (
      reply
        .type('text/plain; charset=utf-8')
        // Short: switching the password on should reach crawlers soon.
        .header('cache-control', 'public, max-age=300')
        .send(body)
    );
  });

  app.get(SITEMAP_PATH, async (_request, reply) => {
    const paths: string[] = [];
    if (await open()) {
      paths.push(...INDEXED_PAGES);
      // What is taking reports now: a closed logbook's form says so and
      // takes nothing, which is not a page worth sending anybody to.
      for (const lb of await openLogbooks(db)) paths.push(`/${lb.slug}`);
      // The maps the board places; a site that publishes no archive places none.
      if (await publicArchiveAvailable(db)) {
        for (const m of await allMaps(db)) if (m.enabled) paths.push(`/maps/${m.slug}`);
      }
    }
    const urls = paths.map((p) => `<url><loc>${xml(siteOrigin + p)}</loc></url>`).join('\n');
    return reply
      .type('application/xml; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}${urls ? '\n' : ''}</urlset>\n`,
      );
  });
}
