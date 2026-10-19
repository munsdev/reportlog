/**
 * The application, without a port or a process. `server.ts` starts it; tests
 * call `app.inject()` on it directly.
 */
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Config } from './config.ts';
import type { Database } from './db/database.ts';
import { stderrMailer } from './email/mailer.ts';
import type { Mailer } from './email/mailer.ts';
import { anchorRoutes } from './anchor/routes.ts';
import { installErrorHandling } from './http/errors.ts';
import { roleGuard } from './identity/guards.ts';
import { evidenceRoutes } from './evidence/routes.ts';
import { filesFrom } from './files/context.ts';
import type { FilesConfig } from './files/context.ts';
import { fileRoutes } from './files/routes.ts';
import { filingRoutes } from './filing/routes.ts';
import { identity } from './identity/index.ts';
import { listButtons } from './lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from './lists/retention.ts';
import type { ListSettings } from './lists/retention.ts';
import { listRoutes } from './lists/routes.ts';
import { logbookRoutes } from './logbooks/routes.ts';
import { mapRoutes } from './maps/routes.ts';
import { healthRoutes } from './routes/health.ts';
import { publicationRoutes } from './routes/publication.ts';
import { verifyRoutes } from './routes/verify.ts';
import { feedbackRoutes } from './feedback/routes.ts';
import { sitePeopleRoutes } from './site/peopleRoutes.ts';
import { siteAdminRoutes, siteRoutes } from './site/routes.ts';

export interface AppDeps {
  config: Pick<Config, 'LOG_LEVEL'> &
    Partial<
      Pick<
        Config,
        | 'SITE_ORIGIN'
        | 'TRUST_PROXY'
        | 'CONTACT_KEY'
        | 'CONTACT_KEY_PREVIOUS'
        | 'PUBLIC_REF_PREFIX'
        | 'ADMIN_EMAIL'
        | 'TRANSPARENCY_LOG_REMOTES'
        | 'ANCHOR_MAX_AGE_HOURS'
      >
    > &
    FilesConfig;
  db: Database;
  /** How email leaves. Standard error until a provider is wired in. */
  mailer?: Mailer;
  /** Where log lines go. Standard output unless a test captures them. */
  logStream?: { write: (line: string) => void };
  /** How long a list keeps what is personal, and who hears of new entries. */
  lists?: ListSettings;
  /** How long one heat map computation serves every reader. Tests pass 0. */
  mapCacheMs?: number;
}

export async function buildApp({
  config,
  db,
  logStream,
  mailer,
  lists,
  mapCacheMs,
}: AppDeps): Promise<FastifyInstance> {
  const hops = config.TRUST_PROXY ?? 0;
  const app = Fastify({
    // The client's address is used only by the in-memory limits in identity/,
    // and never logged. Behind a proxy it must come from X-Forwarded-For.
    trustProxy: hops > 0 ? (_address: string, hop: number) => hop < hops : false,
    logger: {
      level: config.LOG_LEVEL,
      ...(logStream ? { stream: logStream } : {}),
      // A request id, a method and a path in every log line, and never an IP
      // address or a header: the logs of an incident archive are themselves
      // sensitive. Fastify's default serializer records the remote address.
      serializers: {
        req: (req: FastifyRequest) => ({
          id: req.id,
          method: req.method,
          // The route pattern, not the URL: a URL can carry a token.
          route: req.routeOptions.url,
        }),
      },
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // The site serves no third-party anything, so the policy can be strict.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });

  installErrorHandling(app);
  const mail = mailer ?? stderrMailer();
  const siteOrigin = config.SITE_ORIGIN ?? 'http://127.0.0.1:5173';
  // First: its hooks must see every route registered after it.
  await identity(app, { db, mailer: mail, siteOrigin });
  healthRoutes(app, db);
  publicationRoutes(app);
  verifyRoutes(app, db);
  siteRoutes(app, db);
  await siteAdminRoutes(app, db, { requireAdmin: roleGuard(['admin']) });
  sitePeopleRoutes(app, db);
  await feedbackRoutes(app, { db, mailer: mail, siteOrigin, adminEmail: config.ADMIN_EMAIL });
  logbookRoutes(app, db, { buttons: { lists: listButtons } });
  listRoutes(app, { db, mailer: mail, siteOrigin, settings: lists ?? DEFAULT_LIST_SETTINGS });
  // Files: storage and FILES_KEY, or the sentence saying why files are not taken.
  const files = filesFrom(db, config);
  mapRoutes(app, { db, ...(mapCacheMs === undefined ? {} : { cacheMs: mapCacheMs }) });
  await filingRoutes(app, {
    db,
    mailer: mail,
    siteOrigin,
    contactKey: config.CONTACT_KEY,
    previousContactKey: config.CONTACT_KEY_PREVIOUS,
    publicRefPrefix: config.PUBLIC_REF_PREFIX,
    files: typeof files === 'string' ? null : files,
  });
  await fileRoutes(app, { db, files });
  await evidenceRoutes(app, {
    db,
    files,
    mailer: mail,
    siteOrigin,
    contactKey: config.CONTACT_KEY,
    publicRefPrefix: config.PUBLIC_REF_PREFIX,
  });
  anchorRoutes(app, {
    db,
    remotes: config.TRANSPARENCY_LOG_REMOTES?.length ?? 0,
    ...(config.ANCHOR_MAX_AGE_HOURS ? { maxAgeHours: config.ANCHOR_MAX_AGE_HOURS } : {}),
  });
  return app;
}
