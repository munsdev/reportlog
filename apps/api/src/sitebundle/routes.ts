/**
 * The site bundle over HTTP. Owner only, guarded once for the whole scope.
 * Importing and restoring also ask for the step-up (decision 50): they
 * change every public page at once.
 */
import {
  BUNDLE_MAX_BYTES,
  exportSiteBundle,
  getBundleBackup,
  importSiteBundle,
  restoreBundleBackup,
} from '@reportlog/contracts';
import type { SiteBundle } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import type { Files } from '../files/context.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { stepUpGuard } from '../identity/stepUp.ts';
import { exportBundle, importBundle, newestBackup, restoreBackup } from './bundle.ts';

export async function sitebundleRoutes(
  app: FastifyInstance,
  { db, files }: { db: Database; files: Files | string },
): Promise<void> {
  const store = typeof files === 'string' ? null : files;
  await app.register((scope, _opts, done) => {
    scope.addHook('preHandler', roleGuard(['owner']));
    scope.addHook('onRoute', (opts) => {
      opts.bodyLimit = BUNDLE_MAX_BYTES;
    });

    route(scope, exportSiteBundle, async ({ reply }) => {
      void reply.header('content-disposition', 'attachment; filename="site-bundle.json"');
      void reply.header('cache-control', 'no-store');
      return exportBundle(db, store, { packs: true, shipped: false });
    });
    route(scope, getBundleBackup, async () => ({ backup: await newestBackup(db) }));

    void scope.register((changes, _o, next) => {
      changes.addHook('preHandler', stepUpGuard());
      route(changes, importSiteBundle, ({ request }) =>
        importBundle(db, store, request.body as SiteBundle, requireUser(request).email),
      );
      route(changes, restoreBundleBackup, ({ request }) =>
        restoreBackup(db, store, requireUser(request).email),
      );
      next();
    });
    done();
  });
}
