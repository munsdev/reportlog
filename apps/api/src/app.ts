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
import { installErrorHandling } from './http/errors.ts';
import { logbookRoutes } from './logbooks/routes.ts';
import { healthRoutes } from './routes/health.ts';
import { publicationRoutes } from './routes/publication.ts';
import { verifyRoutes } from './routes/verify.ts';

export interface AppDeps {
  config: Pick<Config, 'LOG_LEVEL'>;
  db: Database;
  /** Where log lines go. Standard output unless a test captures them. */
  logStream?: { write: (line: string) => void };
}

export async function buildApp({ config, db, logStream }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
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
  healthRoutes(app, db);
  publicationRoutes(app);
  verifyRoutes(app, db);
  logbookRoutes(app, db);
  return app;
}
