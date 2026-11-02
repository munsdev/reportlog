/**
 * Coverage's routes (decision 84). Three scopes, each guarded once, so a
 * route added to one later cannot forget to ask:
 *
 * - the journalist's own profile: `deskGuard`, the same as the board's
 *   journalist extras (the role, an approved request, the agreement);
 * - the moderators' review: `moderatorGuard`, as the reports queue;
 * - the public list, the map counts and the cards: behind the site password
 *   like every call not named in front of it (identity/gate.ts), and
 *   showing only approved, listed articles by current journalists. A card
 *   for anything else is answered only to its author or to staff.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser } from '../identity/guards.ts';
import { bodyOf } from '../identity/http.ts';
import { deskGuard } from '../journalists/desk.ts';
import { moderatorGuard } from '../moderation/agreement.ts';
import {
  addArticle,
  cardAddress,
  counts,
  decide,
  mine,
  publicList,
  queue,
  removeArticle,
  setByline,
  setListed,
} from './coverage.ts';
import { CardCache, loadCard, type FetchOptions } from './preview.ts';

export interface CoverageRouteDeps {
  db: Kysely<DB>;
  /** Tests point the card reader at their own server. */
  fetchOptions?: FetchOptions;
}

export async function coverageRoutes(
  app: FastifyInstance,
  { db, fetchOptions }: CoverageRouteDeps,
): Promise<void> {
  const cards = new CardCache((url) => loadCard(url, fetchOptions));

  await app.register((own, _opts, done) => {
    own.addHook('preHandler', deskGuard(db));
    route(own, C.getMyCoverage, ({ request }) => mine(db, requireUser(request).id));
    route(own, C.setMyByline, ({ request }) =>
      setByline(db, requireUser(request).id, bodyOf(C.setMyByline, request)),
    );
    route(own, C.addMyArticle, ({ request }) =>
      addArticle(db, requireUser(request).id, bodyOf(C.addMyArticle, request)),
    );
    route(own, C.setMyArticleListed, ({ request, params }) =>
      setListed(
        db,
        requireUser(request).id,
        Number(params.id),
        bodyOf(C.setMyArticleListed, request).listed,
      ),
    );
    route(own, C.removeMyArticle, ({ request, params }) =>
      removeArticle(db, requireUser(request).id, Number(params.id)),
    );
    done();
  });

  await app.register((mods, _opts, done) => {
    mods.addHook('preHandler', moderatorGuard(db));
    route(mods, C.listCoverageQueue, ({ query }) => queue(db, query.show ?? 'waiting'));
    route(mods, C.decideArticle, ({ request, params }) => {
      const body = bodyOf(C.decideArticle, request);
      return decide(db, Number(params.id), requireUser(request).email, body.decision, body.note);
    });
    done();
  });

  route(app, C.listCoverage, ({ query }) =>
    publicList(db, {
      place: query.place,
      page: query.page === undefined ? undefined : Number(query.page),
    }),
  );
  route(app, C.getCoverageCounts, () => counts(db));
  route(app, C.getCoverageCard, async ({ request, params }) => {
    const asker = request.user ? { id: request.user.id, roles: request.user.roles } : null;
    const url = await cardAddress(db, Number(params.id), asker);
    if (!url) throw new HttpError(404, 'not_found', 'There is no such article.');
    return cards.get(url);
  });
}
