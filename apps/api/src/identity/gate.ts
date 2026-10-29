/**
 * THE GATE: every API route is behind the site password unless it is named
 * here.
 *
 * In front of it, always: the lock screen's own calls, the health check and
 * the digest email's stop link.
 * Past it without the password: a list deciding for itself (by prefix), and
 * through `outsidePass` (doors.ts) a logbook's filing calls and the two links
 * emailed to a reporter (confirmation, evidence request), each on its token.
 * Nothing else. Not /api/v1 (decisions.md §2): an API other people build on
 * is behind the password while the site is.
 *
 * It runs at preValidation, after the body is parsed and before it is
 * validated, so a stranger learns nothing from a validation error and the
 * filing allow-list can read which logbook a report names. Unknown addresses
 * get the same answer as known ones.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { outsidePass } from './doors.ts';
import { hasSiteAccess, locked } from './siteAccess.ts';

/**
 * Always in front of the password, by method and route pattern.
 *
 * The digest's stop link is here because stopping email somebody asked for
 * must never depend on a password they may have forgotten or that has
 * changed since. It shows nothing of the site (digestStop.ts).
 */
export const IN_FRONT: readonly string[] = [
  'GET /api/health',
  'GET /api/site-access/status',
  'POST /api/site-access/unlock',
  'GET /api/doors',
  // Error tracking (telemetry/routes.ts): whether it is on, and the relay the
  // website reports its errors through. A lock screen can break too.
  'GET /api/telemetry',
  'POST /api/telemetry/errors',
  // At the door (door/): the puzzle a report or tip form solves, and its start
  // token. A form on a door needs both; a signed random puzzle and a signed
  // moment say nothing of what is behind the password.
  'GET /api/door/challenge',
  'GET /api/door/start',
  'GET /api/notifications/stop/:token',
  'POST /api/notifications/stop/:token',
  // The alert list's email links (journalists/routes.ts): confirming and turning alerts off.
  'GET /api/journalists/confirm/:token',
  'POST /api/journalists/confirm/:token',
  'GET /api/journalists/stop/:token',
  'POST /api/journalists/stop/:token',
  // The alert settings page an alert links to (decision 47): look, change, or remove.
  'GET /api/journalists/settings/:token',
  'POST /api/journalists/settings/:token',
  'POST /api/journalists/settings/:token/remove',
  // Asking for desk access from that page (decision 69), on the same token.
  'POST /api/journalists/settings/:token/access',
  // The access request link (journalists/vetting.ts): the form it opens, and sending it.
  'GET /api/journalists/access/:token',
  'POST /api/journalists/access/:token',
  // An installed look pack's stylesheet and fonts (looks/routes.ts), so the
  // lock screen and a door wear the site's look (decision 60). Colours and
  // type, by hash; nothing the password protects.
  'GET /api/looks/:pack/:file',
  // For search engines (site/robots.ts), which never have the password. Each
  // answers "nothing here" while the site is behind it.
  'GET /api/site/robots.txt',
  'GET /api/site/sitemap.xml',
];

/**
 * The only prefixes whose routes may decide for themselves. A list's form,
 * its erasure link (asking for your own words to be deleted is a right, and
 * a password prompt in front of it is a refusal by another name) and its
 * mail confirmation.
 */
export const DECIDES_ITSELF_PREFIXES: readonly string[] = [
  '/api/lists/',
  '/api/forget/',
  '/api/list-mail/',
];

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Only for list routes: see DECIDES_ITSELF_PREFIXES. */
    curtain?: 'decides-itself';
  }
}

function decidesItself(request: FastifyRequest): boolean {
  return request.routeOptions.config.curtain === 'decides-itself';
}

export function installGate(app: FastifyInstance, db: Kysely<DB>): void {
  // Refuse to start rather than run with a hole: a route anywhere else that
  // claims to decide for itself would be a third place things get past.
  app.addHook('onRoute', (opts) => {
    const config = opts.config as { curtain?: string } | undefined;
    if (config?.curtain === undefined) return;
    if (
      config.curtain !== 'decides-itself' ||
      !DECIDES_ITSELF_PREFIXES.some((p) => opts.url.startsWith(p))
    ) {
      throw new Error(
        `${opts.url} claims to decide the site password for itself. Only list routes may (identity/gate.ts).`,
      );
    }
  });

  app.addHook('preValidation', async (request) => {
    const key = `${request.method} ${request.routeOptions.url ?? ''}`;
    if (IN_FRONT.includes(key) || decidesItself(request)) return;
    if (await hasSiteAccess(db, request)) return;
    if (await outsidePass(db, request)) return;
    throw locked();
  });
}
