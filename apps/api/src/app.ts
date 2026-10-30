/**
 * The application, without a port or a process. `server.ts` starts it; tests
 * call `app.inject()` on it directly.
 */
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { pressRoutes } from './board/press.ts';
import { journalistRoutes } from './journalists/routes.ts';
import { boardRoutes } from './board/routes.ts';
import type { Config } from './config.ts';
import type { Database } from './db/database.ts';
import { stderrMailer } from './email/mailer.ts';
import type { Mailer } from './email/mailer.ts';
import { copyRoutes } from './anchor/copies.ts';
import { updateRoutes } from './site/updateRoutes.ts';
import { anchorRoutes } from './anchor/routes.ts';
import { installErrorHandling } from './http/errors.ts';
import { roleGuard } from './identity/guards.ts';
import { evidenceRoutes } from './evidence/routes.ts';
import { filesFrom } from './files/context.ts';
import type { FilesConfig } from './files/context.ts';
import { fileRoutes } from './files/routes.ts';
import { filingRoutes } from './filing/routes.ts';
import { doorRoutes, makeDoor } from './door/index.ts';
import { identity } from './identity/index.ts';
import { logoRoutes } from './identity/logoRoutes.ts';
import { twoFactorKeyFrom } from './identity/twoFactorKey.ts';
import { listButtons } from './lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from './lists/retention.ts';
import type { ListSettings } from './lists/retention.ts';
import { listRoutes } from './lists/routes.ts';
import { linkKeySource } from './links/keys.ts';
import { linkRoutes } from './links/routes.ts';
import { lookRoutes } from './looks/routes.ts';
import { logbookRoutes } from './logbooks/routes.ts';
import { platformRoutes } from './moderation/platformRoutes.ts';
import { moderationRoutes } from './moderation/routes.ts';
import { textRoutes } from './moderation/texts/routes.ts';
import { floodRoutes } from './moderation/floodRoutes.ts';
import { eraseLinkRoutes } from './identity/eraseLink.ts';
import { mapRoutes } from './maps/routes.ts';
import { menuRoutes } from './menu/routes.ts';
import { healthRoutes } from './routes/health.ts';
import { publicationRoutes } from './routes/publication.ts';
import { verifyRoutes } from './routes/verify.ts';
import { feedbackRoutes } from './feedback/routes.ts';
import { sitePeopleRoutes } from './site/peopleRoutes.ts';
import { pageAdminRoutes, pageRoutes } from './pages/routes.ts';
import { headerRoutes } from './site/headerRoutes.ts';
import { sitebundleRoutes } from './sitebundle/routes.ts';
import { pageHeadRoutes } from './site/pageHead.ts';
import { robotsRoutes } from './site/robots.ts';
import { siteAdminRoutes, siteRoutes } from './site/routes.ts';
import { shareImageRoutes } from './site/shareImage.ts';
import { templateRoutes } from './site/templates.ts';
import { telemetryRoutes } from './telemetry/routes.ts';
import { offTracker } from './telemetry/tracker.ts';
import type { ErrorTracker } from './telemetry/tracker.ts';

export interface AppDeps {
  config: Pick<Config, 'LOG_LEVEL'> &
    Partial<
      Pick<
        Config,
        | 'SITE_ORIGIN'
        | 'SEARCH_ENGINES'
        | 'TRUST_PROXY'
        | 'CONTACT_KEY'
        | 'CONTACT_KEY_PREVIOUS'
        | 'TWO_FACTOR_KEY'
        | 'PUBLIC_REF_PREFIX'
        | 'FILING_SENDS_PER_CLIENT'
        | 'FILING_CONFIRMS_PER_CLIENT'
        // At the door (door/).
        | 'DOOR_KEY'
        | 'DOOR_SUBMITS_PER_MINUTE'
        | 'DOOR_SUBMITS_PER_HOUR'
        | 'DOOR_REQUESTS_PER_MINUTE'
        | 'ADMIN_EMAIL'
        | 'TRANSPARENCY_LOG_REMOTES'
        | 'ANCHOR_MAX_AGE_HOURS'
        | 'PRESS_DIR'
        // The owner's backups and exports (anchor/copies.ts).
        | 'DATABASE_URL'
        | 'BACKUP_DIR'
        | 'BACKUP_KEEP'
        | 'BACKUP_MAX_AGE_HOURS'
        | 'STATE_DIR'
        | 'BACKUP_AGE_RECIPIENTS'
        | 'BACKUP_S3_ENDPOINT'
        | 'BACKUP_S3_REGION'
        | 'BACKUP_S3_BUCKET'
        | 'BACKUP_S3_PREFIX'
        | 'BACKUP_S3_ACCESS_KEY_ID'
        | 'BACKUP_S3_SECRET_ACCESS_KEY'
      >
    > &
    FilesConfig;
  db: Database;
  /** How email leaves. Standard error until a provider is wired in. */
  mailer?: Mailer;
  /** Where unexpected errors are reported (Bugsink). Off unless a DSN is set. */
  errors?: ErrorTracker;
  /** Where log lines go. Standard output unless a test captures them. */
  logStream?: { write: (line: string) => void };
  /** How long a list keeps what is personal, and who hears of new entries. */
  lists?: ListSettings;
  /** How long the board's counts are reused. Tests pass 0. */
  statsTtlMs?: number;
  /** How long one heat map computation serves every reader. Tests pass 0. */
  mapCacheMs?: number;
  /** The website's index.html, for the page head route. Tests pass a small one. */
  pageTemplate?: string;
}

export async function buildApp({
  config,
  db,
  logStream,
  mailer,
  errors,
  lists,
  statsTtlMs,
  mapCacheMs,
  pageTemplate,
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
  // At the door: before everything, so its per-address limit sees every
  // request, and the report and tip routes below can ask it to check theirs.
  const door = makeDoor({
    db,
    key: config.DOOR_KEY,
    // The server always passes the parsed config, whose defaults are the low
    // ones (config.ts). Only a test builds an app without them, and a test
    // about something else should not trip over a limit: the door's own tests
    // set theirs.
    limits: {
      submitsPerMinute: config.DOOR_SUBMITS_PER_MINUTE ?? 100_000,
      submitsPerHour: config.DOOR_SUBMITS_PER_HOUR ?? 1_000_000,
      requestsPerMinute: config.DOOR_REQUESTS_PER_MINUTE ?? 1_000_000,
    },
  });
  doorRoutes(app, door, db);
  // First: its hooks must see every route registered after it.
  await identity(app, {
    db,
    mailer: mail,
    siteOrigin,
    twoFactorKey: twoFactorKeyFrom(config.TWO_FACTOR_KEY),
  });
  telemetryRoutes(app, { tracker: errors ?? offTracker });
  healthRoutes(app, db);
  publicationRoutes(app);
  verifyRoutes(app, db);
  siteRoutes(app, db);
  robotsRoutes(app, { db, siteOrigin, searchEngines: config.SEARCH_ENGINES ?? 'on' });
  shareImageRoutes(app, db);
  pageHeadRoutes(app, {
    db,
    siteOrigin,
    searchEngines: config.SEARCH_ENGINES ?? 'on',
    ...(pageTemplate === undefined ? {} : { template: pageTemplate }),
  });
  await lookRoutes(app, db);
  pageRoutes(app, db);
  await pageAdminRoutes(app, db, { requireAdmin: roleGuard(['admin']) });
  await siteAdminRoutes(app, db, { requireAdmin: roleGuard(['admin']) });
  await templateRoutes(app, db, { requireAdmin: roleGuard(['admin']) });
  sitePeopleRoutes(app, db);
  await feedbackRoutes(app, { db, mailer: mail, siteOrigin, adminEmail: config.ADMIN_EMAIL });
  logbookRoutes(app, db, { buttons: { lists: listButtons } });
  // One loader for the link keys, shared by lists and the link check.
  const linkKeys = linkKeySource(db, config.CONTACT_KEY, config.CONTACT_KEY_PREVIOUS);
  listRoutes(app, {
    db,
    mailer: mail,
    siteOrigin,
    settings: lists ?? DEFAULT_LIST_SETTINGS,
    keys: linkKeys,
    door,
  });
  linkRoutes(app, { db, keys: linkKeys });
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
    sendsPerClient: config.FILING_SENDS_PER_CLIENT,
    confirmsPerClient: config.FILING_CONFIRMS_PER_CLIENT,
    door,
    files: typeof files === 'string' ? null : files,
    linkKeys,
  });
  await fileRoutes(app, { db, files });
  await logoRoutes(app, { db, files });
  await headerRoutes(app, { db, files });
  await sitebundleRoutes(app, { db, files });
  await evidenceRoutes(app, {
    db,
    files,
    mailer: mail,
    siteOrigin,
    contactKey: config.CONTACT_KEY,
    publicRefPrefix: config.PUBLIC_REF_PREFIX,
  });
  await moderationRoutes(app, {
    db,
    contactKey: config.CONTACT_KEY,
    publicRefPrefix: config.PUBLIC_REF_PREFIX,
    mailer: mail,
    siteOrigin,
    linkKeys,
  });
  textRoutes(app, {
    db,
    keys: linkKeys,
    contactKey: config.CONTACT_KEY,
    publicRefPrefix: config.PUBLIC_REF_PREFIX,
  });
  await platformRoutes(app, { db, mailer: mail, siteOrigin });
  await floodRoutes(app, { db, siteOrigin, linkKeys });
  eraseLinkRoutes(app, { db });
  journalistRoutes(app, {
    db,
    mailer: mail,
    siteOrigin,
    contactKey: config.CONTACT_KEY,
    previousContactKey: config.CONTACT_KEY_PREVIOUS,
    linkKeys,
  });
  boardRoutes(app, { db, siteOrigin, ...(statsTtlMs === undefined ? {} : { statsTtlMs }) });
  pressRoutes(app, { dir: config.PRESS_DIR });
  anchorRoutes(app, {
    db,
    remotes: config.TRANSPARENCY_LOG_REMOTES?.length ?? 0,
    ...(config.ANCHOR_MAX_AGE_HOURS ? { maxAgeHours: config.ANCHOR_MAX_AGE_HOURS } : {}),
  });
  copyRoutes(app, { db, config });
  updateRoutes(app, { stateDir: config.STATE_DIR ?? '/var/lib/reportlog' });
  await menuRoutes(app, { db });
  return app;
}
