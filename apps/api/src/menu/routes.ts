/**
 * The site menu's route: `GET /api/menu/waiting`.
 *
 * GUARDED FOR THE WHOLE SCOPE: anybody signed in, nobody else. Which totals
 * a person gets is decided per total in waiting.ts, by each screen's own
 * rule. Somebody signed in with no role and no flag gets `{}`.
 *
 * Behind the site password like every call not named in front of it
 * (identity/gate.ts IN_FRONT, identity/doors.ts FILING_CALLS): the website
 * never asks it on a door.
 */
import { getMenuWaiting } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { route } from '../http/route.ts';
import { requireUser } from '../identity/guards.ts';
import { waitingFor } from './waiting.ts';

export async function menuRoutes(app: FastifyInstance, { db }: { db: Database }): Promise<void> {
  await app.register((scope, _opts, done) => {
    scope.addHook('preHandler', (request) => {
      requireUser(request);
      return Promise.resolve();
    });

    route(scope, getMenuWaiting, ({ request }) => waitingFor(db, requireUser(request)));

    done();
  });
}
