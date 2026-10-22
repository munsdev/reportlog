/**
 * Look packs over HTTP (docs/design/looks/README.md, section 05).
 *
 *   GET  /api/looks/:pack/:file   a pack's stylesheet or font, by its hash.
 *                                 In front of the site password (gate.ts
 *                                 IN_FRONT): the lock screen and a door wear
 *                                 the site's look too (decision 60), and a
 *                                 pack's colours and fonts are not what the
 *                                 password protects.
 *   the rest                      owner and administrators, guarded per scope;
 *                                 installing, replacing and removing also ask
 *                                 for the step-up (decision 50), because they
 *                                 change every public page. Checking does not:
 *                                 it changes nothing.
 */
import {
  checkLookPack,
  installLookPack,
  listLookPacks,
  LOOK_FILES_PATH,
  LOOK_PACK_MAX_ZIP_BYTES,
  removeLookPack,
} from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db/database.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { roleGuard, requireUser } from '../identity/guards.ts';
import { stepUpGuard } from '../identity/stepUp.ts';
import { inspectPack, installPack, listPacks, packFile, removePack, summarize } from './packs.ts';

/** Base64 of the largest zip, and the JSON around it. */
const BODY_LIMIT = Math.ceil(LOOK_PACK_MAX_ZIP_BYTES / 3) * 4 + 1024;

function zipOf(request: FastifyRequest): Uint8Array {
  const body = request.body as { zip: string };
  return new Uint8Array(Buffer.from(body.zip, 'base64'));
}

export async function lookRoutes(app: FastifyInstance, db: Database): Promise<void> {
  // The name changes when the content does, so a copy never goes stale.
  app.get(LOOK_FILES_PATH, async (request, reply) => {
    const { pack, file } = request.params as { pack: string; file: string };
    const found = await packFile(db, pack, file);
    if (!found) throw notFound('There is no such look file.');
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type(found.type)
      .send(found.body);
  });

  await app.register((scope, _opts, done) => {
    scope.addHook('preHandler', roleGuard(['admin']));
    // A pack is up to 10 MB; everywhere else a body is far smaller.
    scope.addHook('onRoute', (opts) => {
      opts.bodyLimit = BODY_LIMIT;
    });

    route(scope, listLookPacks, async () => ({ packs: await listPacks(db) }));

    route(scope, checkLookPack, async ({ request }) => {
      const seen = await inspectPack(db, zipOf(request));
      return {
        problems: seen.problems,
        pack: seen.pack ? summarize(seen.pack) : null,
        replaces: seen.replaces?.version ?? null,
      };
    });

    void scope.register((changes, _o, next) => {
      // After the role guard, so somebody without the role is told that.
      changes.addHook('preHandler', stepUpGuard());

      route(changes, installLookPack, async ({ request }) => {
        const done = await installPack(db, zipOf(request), requireUser(request).email);
        if (!done.ok) throw new HttpError(400, 'pack_refused', done.problems.join(' '));
        return { pack: done.pack, replaced: done.replaced };
      });

      route(changes, removeLookPack, async ({ params, request }) => {
        const done = await removePack(db, params.id, requireUser(request).email);
        if (!done.ok)
          throw new HttpError(
            done.status,
            done.status === 404 ? 'not_found' : 'in_use',
            done.message,
          );
        return { ok: true as const };
      });
      next();
    });
    done();
  });
}
