/**
 * What gets past the site password, and what the password page offers.
 *
 * WHAT GETS PAST IT IS NAMED IN TWO PLACES AND NOWHERE ELSE:
 *
 *   1. A list decides for itself. Its routes are marked
 *      `config: { curtain: 'decides-itself' }` and call `hasSiteAccess`
 *      themselves; the gate refuses to start if a route outside the list
 *      prefixes in `gate.ts` carries that mark.
 *   2. A logbook opened outside is FILING ONLY, through `outsidePass` below:
 *      an allow-list of exactly the calls the filing form makes. It only says
 *      "the password is not the reason to refuse"; every route still applies
 *      every rule it applies to anybody.
 *
 * Never widen either to the board, the list of logbooks or a staff route.
 */
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { listDoors } from '../lists/manage.ts';

export const OUTSIDE_ACCESS = ['closed', 'link', 'door'] as const;
export type OutsideAccess = (typeof OUTSIDE_ACCESS)[number];

export interface Door {
  kind: 'logbook' | 'list';
  slug: string;
  title: string;
  href: string;
}

/**
 * Logbooks open for filing from outside. "Open" is "launched" today; when the
 * logbooks workstream adds opening and closing times, they belong in this
 * query too, so a closed logbook stops being a door.
 */
async function logbooksOpenOutside(db: Kysely<DB>) {
  return db
    .selectFrom('logbooks')
    .select(['slug', 'title', 'outside_access'])
    .where('launched_at', 'is not', null)
    .where('outside_access', 'in', ['link', 'door'])
    .orderBy('id')
    .execute();
}

/**
 * What the password page offers somebody without the password: titles and
 * addresses of what an administrator set to `door`, and nothing else. A
 * `link` logbook works without the password too but is not shown; that is the
 * whole difference between the two.
 *
 * A list is a door when it is listed, taking entries and set to `door`. The
 * lists module answers that, so the two cannot disagree about whether a list
 * is open.
 */
export async function doors(db: Kysely<DB>): Promise<Door[]> {
  const logbooks = (await logbooksOpenOutside(db))
    .filter((l) => l.outside_access === 'door')
    .map((l): Door => ({ kind: 'logbook', slug: l.slug, title: l.title, href: `/file/${l.slug}` }));
  return [...logbooks, ...(await listDoors(db))];
}

/**
 * The calls the filing form makes, by route pattern (never by raw URL, which
 * a client controls). `slug` says where the logbook is named, if the call is
 * about one; a call naming no logbook passes while any logbook is open
 * outside, because it carries nothing about a report.
 *
 * Several of these routes belong to other workstreams and may not exist yet.
 * The pattern is the agreement: a route registered under another pattern is
 * simply behind the password.
 */
const FILING_CALLS: readonly {
  method: string;
  route: string;
  slug?: (r: FastifyRequest) => unknown;
}[] = [
  // The wording of the publication card and its digest.
  { method: 'GET', route: '/api/publication-card' },
  // A logbook's form.
  {
    method: 'GET',
    route: '/api/logbooks/:slug',
    slug: (r) => (r.params as Record<string, unknown>).slug,
  },
  // Sending a report.
  {
    method: 'POST',
    route: '/api/reports',
    slug: (r) => (r.body as Record<string, unknown> | null)?.logbook,
  },
  // The confirmation link. The token is the secret, and the logbook was
  // checked when the report was sent: somebody who filed while it was open
  // can confirm after it closes, like anybody else.
  { method: 'GET', route: '/api/reports/confirm/:token' },
  { method: 'POST', route: '/api/reports/confirm/:token' },
];

/** True to let this request past the gate. Read only by the gate. */
export async function outsidePass(db: Kysely<DB>, request: FastifyRequest): Promise<boolean> {
  const route = request.routeOptions.url;
  const call = FILING_CALLS.find((c) => c.method === request.method && c.route === route);
  if (!call) return false;
  const open = await logbooksOpenOutside(db);
  if (!open.length) return false;
  if (!call.slug) return true;
  const slug = call.slug(request);
  return typeof slug === 'string' && open.some((l) => l.slug === slug);
}

export async function setOutsideAccess(
  db: Kysely<DB>,
  slug: string,
  access: OutsideAccess,
): Promise<boolean> {
  const out = await db
    .updateTable('logbooks')
    .set({ outside_access: access, updated_at: new Date() })
    .where('slug', '=', slug)
    .executeTakeFirst();
  return out.numUpdatedRows > 0n;
}
