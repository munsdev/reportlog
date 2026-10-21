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
 *      an allow-list of exactly the calls the filing form makes. Two links
 *      emailed to a reporter pass the same way on their token alone: the
 *      confirmation link and the evidence-request link. It only says
 *      "the password is not the reason to refuse"; every route still applies
 *      every rule it applies to anybody.
 *
 * Never widen either to the board, the list of logbooks or a staff route.
 */
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { sha256Hex } from './secrets.ts';
import { listDoors } from '../lists/manage.ts';
import { evidenceTokenKnown } from '../evidence/requests.ts';
import { anyTakesFilesOutside, namedTakesFilesOutside } from '../files/doors.ts';

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

/** Every call the evidence page makes, by route pattern. Each carries the token. */
const EVIDENCE_ROUTES: readonly (readonly [string, string])[] = [
  ['GET', '/api/evidence/:token'],
  ['POST', '/api/evidence/:token/files'],
  ['GET', '/api/evidence/:token/files'],
  ['DELETE', '/api/evidence/:token/files/:slot'],
  ['PUT', '/api/evidence/:token/files/:slot'],
  ['POST', '/api/evidence/:token/send'],
];

/**
 * The calls the filing form makes, by route pattern (never by raw URL, which
 * a client controls). `slug` says where the logbook is named, if the call is
 * about one; a call naming no logbook passes while any logbook is open
 * outside, because it carries nothing about a report. `passes` replaces both
 * rules for a call that proves its own right to be answered.
 *
 * Several of these routes belong to other workstreams and may not exist yet.
 * The pattern is the agreement: a route registered under another pattern is
 * simply behind the password.
 */
const FILING_CALLS: readonly {
  method: string;
  route: string;
  slug?: (r: FastifyRequest) => unknown;
  passes?: (db: Kysely<DB>, r: FastifyRequest) => Promise<boolean>;
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
  // Whether the site is taking reports at all, so the form can say so on its
  // first card rather than after somebody has written everything. It answers
  // open or closed and nothing else.
  { method: 'GET', route: '/api/intake-switch' },
  // Plan E (PE3): the report and tip forms say "Intake is paused" on a door
  // too. A public notice about the site, nothing about any report.
  { method: 'GET', route: '/api/intake-pause', passes: () => Promise.resolve(true) },
  // The confirmation link. The token is the secret: it was emailed to the
  // person who sent the report, and the logbook was checked when they sent
  // it. So the link passes on the token alone, whether or not any logbook is
  // open outside NOW: somebody who filed while it was open can finish after
  // it closes. A token that names no submission gets the same `locked` as
  // anything else, so the gate says nothing about which tokens exist.
  { method: 'GET', route: '/api/reports/confirm/:token', passes: submissionExists },
  { method: 'POST', route: '/api/reports/confirm/:token', passes: submissionExists },
  // The erase link in the same email (identity/eraseLink.ts). It passes on the
  // same token, and its look changes nothing: only the POST does.
  { method: 'GET', route: '/api/erase/:token', passes: submissionExists },
  { method: 'POST', route: '/api/erase/:token', passes: submissionExists },
  // The status link in a notice-of-illegal-content email (moderation/
  // contentNotices.ts): the sender may never have had the password.
  { method: 'GET', route: '/api/illegal-content/status/:token', passes: contentNoticeKnown },
  // Attaching files while filing (files workstream). They pass only while a
  // logbook open outside ASKS FOR FILES, as legacy conditioned them; the two
  // that name their logbook pass for that logbook only. The rest carry a free
  // draft token and no logbook. See apps/api/src/files/doors.ts.
  {
    method: 'GET',
    route: '/api/uploads/config',
    passes: (db, r) => namedTakesFilesOutside(db, (r.query as Record<string, unknown>).logbook),
  },
  {
    method: 'POST',
    route: '/api/uploads',
    passes: (db, r) =>
      namedTakesFilesOutside(db, (r.body as Record<string, unknown> | null)?.logbook),
  },
  { method: 'POST', route: '/api/uploads/draft', passes: anyTakesFilesOutside },
  { method: 'PUT', route: '/api/uploads/:slot', passes: anyTakesFilesOutside },
  { method: 'GET', route: '/api/uploads/status', passes: anyTakesFilesOutside },
  { method: 'DELETE', route: '/api/uploads/:slot', passes: anyTakesFilesOutside },
  // The evidence-request link (decisions.md §4), for the same reason as the
  // confirmation link: it was emailed to the reporter, who may never have had
  // the password, and its token is the secret. Every call the page makes
  // passes on a token that names a request, open or not; whether it is still
  // open, and what it may do, is evidence/routes.ts's to say. A token naming
  // nothing gets `locked`, like anything else.
  ...EVIDENCE_ROUTES.map(([method, route]) => ({
    method,
    route,
    passes: (db: Kysely<DB>, r: FastifyRequest) =>
      evidenceTokenKnown(db, (r.params as Record<string, unknown>).token),
  })),
];

async function contentNoticeKnown(db: Kysely<DB>, request: FastifyRequest): Promise<boolean> {
  const token = (request.params as Record<string, unknown>).token;
  if (typeof token !== 'string' || !token) return false;
  const h = sha256Hex(token);
  const row = await db
    .selectFrom('content_notices')
    .select('id')
    .where((eb) => eb.or([eb('token_hash', '=', h), eb('decision_token_hash', '=', h)]))
    .executeTakeFirst();
  return row !== undefined;
}

async function submissionExists(db: Kysely<DB>, request: FastifyRequest): Promise<boolean> {
  const token = (request.params as Record<string, unknown>).token;
  if (typeof token !== 'string' || !token) return false;
  const row = await db
    .selectFrom('report_submissions')
    .select('id')
    .where('token_hash', '=', sha256Hex(token))
    .executeTakeFirst();
  return row !== undefined;
}

/** True to let this request past the gate. Read only by the gate. */
export async function outsidePass(db: Kysely<DB>, request: FastifyRequest): Promise<boolean> {
  const route = request.routeOptions.url;
  const call = FILING_CALLS.find((c) => c.method === request.method && c.route === route);
  if (!call) return false;
  if (call.passes) return call.passes(db, request);
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
