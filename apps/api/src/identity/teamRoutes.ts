/**
 * The team-member flag and desks, the roster, and the digest's stop link.
 *
 * The flag's ceiling is checked twice, as a role's is: by the guard here and
 * by @reportlog/access inside flags.ts.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { route } from '../http/route.ts';
import { applyStop, describeStop } from './digestStop.ts';
import { setTeamMember } from './flags.ts';
import { requireGranter } from './guards.ts';
import { bodyOf } from './http.ts';
import { roster, ROSTER_DEFAULT_DAYS } from './roster.ts';

export function teamRoutes(app: FastifyInstance, { db }: { db: Kysely<DB> }): void {
  route(app, C.setTeamMember, async ({ request }) => {
    const actor = requireGranter(request);
    const { email, teamMember, desks } = bodyOf(C.setTeamMember, request);
    const out = await setTeamMember(db, { actor, email, teamMember, desks });
    return { ok: true as const, ...out };
  });

  route(app, C.getRoster, async ({ query, request }) => {
    requireGranter(request);
    // Already coerced and range-checked by the contract; typed as its input.
    const days = Number(query.days ?? ROSTER_DEFAULT_DAYS);
    return { days, people: await roster(db, days) };
  });

  // In front of the site password (gate.ts IN_FRONT), and no sign-in.
  route(app, C.describeDigestStop, ({ params }) => describeStop(db, params.token));
  route(app, C.stopDigest, ({ params }) => applyStop(db, params.token));
}
