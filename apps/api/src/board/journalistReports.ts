/**
 * The journalists' reports list (decision 81): the board's own list with the
 * moderators' Sources and notes beside each report, and "My states".
 *
 * IT LIVES HERE, NOT UNDER journalists/. Reading the list means calling the
 * board's own function (so counts-only logbooks, the archive switch and the
 * thin-place threshold apply exactly as on the public board), and that reaches
 * the sealing code, which nothing under journalists/ may do (the boundary
 * check `journalists-never-reach-the-chain`). The guard is the desk's, once,
 * on the whole scope: the role, an approved request and the accepted agreement.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { keyringFrom } from '../filing/contactKeys.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser } from '../identity/guards.ts';
import { deskExtras, deskGuard } from '../journalists/desk.ts';
import { deskStates } from '../journalists/list.ts';
import { json } from '../moderation/json.ts';
import { boardPage } from './board.ts';
import { boardQuery } from './routes.ts';

export interface JournalistReportDeps {
  db: Kysely<DB>;
  contactKey: string | undefined;
  previousContactKey?: string | undefined;
}

export function journalistReportRoutes(app: FastifyInstance, deps: JournalistReportDeps): void {
  const { db } = deps;
  const ring = deps.contactKey ? keyringFrom(deps.contactKey, deps.previousContactKey) : null;
  void app.register((desk, _opts, done) => {
    desk.addHook('preHandler', deskGuard(db));
    route(desk, C.deskReports, async ({ query, request }) => {
      const user = requireUser(request);
      let states: string[] | undefined;
      if (query.mine === 'true') {
        if (!ring) {
          throw new HttpError(
            503,
            'not_configured',
            'The alert list is not open on this site yet, so there are no states to search by.',
          );
        }
        states = await deskStates(db, ring, user.email);
      }
      const page = await boardPage(db, { ...boardQuery(query), ...(states ? { states } : {}) });
      if (!page.published || 'withheld' in page) return json(page);
      const extras = await deskExtras(
        db,
        user.email,
        page.reports.map((r) => r.public_ref),
      );
      return json({ ...page, extras });
    });
    route(desk, C.deskReportExtras, async ({ params, request }) => ({
      extras: (await deskExtras(db, requireUser(request).email, [params.ref]))[params.ref] ?? null,
    }));
    done();
  });
}
