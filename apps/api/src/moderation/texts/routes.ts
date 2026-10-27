/**
 * Written accounts over HTTP (W4). Two scopes, each guarded once:
 *   - moderators and administrators who accepted the moderator agreement:
 *     the queue, the check, the redaction and its review, and the panel on a
 *     report's page;
 *   - the signed-in reporter, for a thread their address owns: reading and
 *     erasing their own words.
 *
 * Without CONTACT_KEY nothing is held, so every route says why it cannot.
 */
import * as C from '@reportlog/contracts';
import type { BodyOf } from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../../db/schema.gen.ts';
import { keyringFrom } from '../../filing/contactKeys.ts';
import { Mine } from '../../filing/mine.ts';
import { HttpError } from '../../http/errors.ts';
import { route } from '../../http/route.ts';
import { requireUser } from '../../identity/guards.ts';
import type { LinkKeys } from '../../links/keys.ts';
import { moderatorGuard } from '../agreement.ts';
import { checkText, countsOf, detail, listPage, redactText, reviewRedaction } from './items.ts';
import type { Filter } from './items.ts';
import { eraseMyWritten, myWritten, reportWritten } from './panels.ts';

export interface TextRouteDeps {
  db: Kysely<DB>;
  keys: (() => Promise<LinkKeys>) | null;
  contactKey?: string | undefined;
  publicRefPrefix?: string | undefined;
}

export function textRoutes(app: FastifyInstance, deps: TextRouteDeps): void {
  const { db } = deps;
  const need = async () => {
    if (!deps.keys) {
      throw new HttpError(
        503,
        'no_contact_key',
        'This site has no CONTACT_KEY yet, so it keeps no written accounts. Tell whoever runs the server.',
      );
    }
    return deps.keys();
  };
  const me = (r: FastifyRequest) => requireUser(r).email;

  void app.register((mods, _opts, done) => {
    mods.addHook('preHandler', moderatorGuard(db));

    route(mods, C.listTexts, async ({ query }) => {
      const keys = await need();
      const filter: Filter = query.filter ?? 'waiting';
      const counts = await countsOf(db);
      const pages = Math.max(1, Math.ceil(counts[filter] / C.TEXT_PAGE_SIZE));
      const page = Math.min(Number(query.page ?? 1), pages);
      const { items } = await listPage(db, keys, filter, {
        limit: C.TEXT_PAGE_SIZE,
        offset: (page - 1) * C.TEXT_PAGE_SIZE,
      });
      return { filter, counts, items, page, pages };
    });
    route(mods, C.getText, async ({ params }) => detail(db, await need(), params.ref));
    route(mods, C.checkText, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof C.checkText>;
      return checkText(db, await need(), params.ref, {
        outcome: b.outcome,
        reason: b.reason,
        actor: me(request),
      });
    });
    route(mods, C.redactText, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof C.redactText>;
      return redactText(db, await need(), params.ref, {
        body: b.body,
        why: b.why,
        actor: me(request),
      });
    });
    route(mods, C.reviewRedaction, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof C.reviewRedaction>;
      return reviewRedaction(db, await need(), params.ref, {
        verdict: b.verdict,
        actor: me(request),
        isOwner: requireUser(request).roles.includes('owner'),
      });
    });
    route(mods, C.getReportWritten, async ({ params }) =>
      reportWritten(db, await need(), params.threadId),
    );
    done();
  });

  // ── the reporter's own words ──────────────────────────────────────────
  const ring = deps.contactKey ? keyringFrom(deps.contactKey) : null;
  const mine = new Mine(db, ring, deps.publicRefPrefix ?? '', deps.keys);
  void app.register((scope, _opts, done) => {
    scope.addHook('preHandler', (request) => {
      requireUser(request);
      return Promise.resolve();
    });
    route(scope, C.getMyWritten, async ({ params, request }) => {
      await mine.owned(me(request), params.threadId);
      return myWritten(db, await need(), params.threadId);
    });
    route(scope, C.eraseMyWritten, async ({ params, request }) => {
      await mine.owned(me(request), params.threadId);
      return { erased: await eraseMyWritten(db, params.threadId) };
    });
    done();
  });
}
