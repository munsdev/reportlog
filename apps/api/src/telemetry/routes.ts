/**
 * Error tracking's part of the API: reporting the server's own unexpected
 * errors, and the relay the website sends its errors through.
 *
 * THE RELAY EXISTS so that a visitor's browser never talks to anything but
 * this site. Sentry's browser SDK posts its envelope here (its `tunnel`
 * option), and the server passes the one error event in it on to Bugsink,
 * cleaned again, under the server's own DSN. Both routes are in front of the
 * site password (identity/gate.ts): an error on the lock screen or on a door
 * is worth knowing about, and neither route reveals anything behind it.
 */
import { ERROR_RELAY_PATH, getErrorTracking } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import type { ErrorTracker } from './tracker.ts';

/** Envelopes larger than this are not one error from our own website. */
export const RELAY_BODY_LIMIT = 64 * 1024;

/**
 * How many website errors are passed on per minute, for the whole site.
 * The relay is open to anybody who can reach the site, so this bounds what
 * a stranger can pour into Bugsink. Over it the answer is 429 with a
 * Retry-After, which Sentry's SDK honours by holding back.
 */
export const RELAY_PER_MINUTE = 30;

export function telemetryRoutes(
  app: FastifyInstance,
  { tracker, now = () => Date.now() }: { tracker: ErrorTracker; now?: () => number },
): void {
  // An unexpected error, as opposed to a refusal: an HttpError is a sentence
  // for a person, a validation error is the caller's, and anything under 500
  // (a body too large, a malformed JSON body) is the request's fault.
  app.addHook('onError', async (request, _reply, err) => {
    if (err instanceof HttpError || hasZodFastifySchemaValidationErrors(err)) return;
    if (typeof err.statusCode === 'number' && err.statusCode < 500) return;
    tracker.capture(err, {
      side: 'api',
      method: request.method,
      // The route PATTERN. request.url could carry a token.
      route: request.routeOptions.url ?? 'unmatched',
    });
  });

  route(app, getErrorTracking, () => ({ errors: tracker.on }));

  let windowStart = 0;
  let inWindow = 0;
  void app.register((relay, _opts, done) => {
    // The SDK's fetch sends the envelope as text; some versions name its type.
    relay.addContentTypeParser(
      'application/x-sentry-envelope',
      { parseAs: 'string' },
      (_req, body, done) => {
        done(null, body);
      },
    );
    relay.post(ERROR_RELAY_PATH, { bodyLimit: RELAY_BODY_LIMIT }, async (request, reply) => {
      if (!tracker.on) {
        return reply.status(404).send({
          error: { code: 'not_found', message: 'Error tracking is off on this site.' },
        });
      }
      const t = now();
      if (t - windowStart >= 60_000) {
        windowStart = t;
        inWindow = 0;
      }
      if (inWindow >= RELAY_PER_MINUTE) {
        return reply
          .status(429)
          .header('retry-after', '60')
          .send({
            error: {
              code: 'too_many',
              message: 'Too many errors reported just now. Try again in a minute.',
            },
          });
      }
      inWindow += 1;
      const body = typeof request.body === 'string' ? request.body : '';
      const outcome = await tracker.relay(body);
      // 200 for something dropped as well: a browser told "no" would retry.
      return reply.status(200).send({ relayed: outcome === 'sent' });
    });
    done();
  });
}
