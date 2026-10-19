/**
 * Error tracking: the server's unexpected errors, and the website's relayed,
 * sent to a self-hosted Bugsink.
 *
 * Bugsink speaks Sentry's protocol, so this uses Sentry's own SDK core
 * (`@sentry/core`), not `@sentry/node`. The full Node SDK instruments every
 * module it can reach (http, pg, fastify) through OpenTelemetry, keeps
 * breadcrumbs of outgoing requests with their URLs, and sends sessions. None
 * of that is wanted here, and less code reaching into the process is less to
 * trust on a server holding people's reports. The core gives the parts that
 * matter: a stack parser, the envelope format, and a transport that honours
 * the server's rate limits.
 *
 * OFF UNLESS A DSN IS SET. With no `ERROR_TRACKING_DSN` every method here
 * does nothing, and nothing is ever sent anywhere.
 *
 * WHAT AN EVENT CARRIES is decided once, by `scrubEvent` in
 * @reportlog/contracts: an allowlist. No IP address, no URL (a URL can carry
 * a token), no request body, headers, cookies, user or breadcrumbs. The route
 * pattern is sent as a tag, never the address.
 */
import { readFileSync } from 'node:fs';
import { scrubEvent } from '@reportlog/contracts';
import type { ERROR_TAGS, ErrorEvent } from '@reportlog/contracts';
import {
  Scope,
  ServerRuntimeClient,
  createEventEnvelope,
  createStackParser,
  createTransport,
  dsnFromString,
  nodeStackLineParser,
  parseEnvelope,
} from '@sentry/core';
import type {
  ErrorEvent as SentryErrorEvent,
  Event,
  Transport,
  TransportMakeRequestResponse,
} from '@sentry/core';
import type { Config } from '../config.ts';

export type ErrorTag = (typeof ERROR_TAGS)[number];

export interface ErrorTracker {
  /** Whether a DSN is set. The website asks, through `GET /api/telemetry`. */
  readonly on: boolean;
  /** Report an unexpected error. Never throws, never waits. */
  capture(err: unknown, tags?: Partial<Record<ErrorTag, string>>): void;
  /**
   * Pass on what the website sent (a Sentry envelope), cleaned again here.
   * `sent`, or why not: `off`; `not-an-error` for anything that is not one
   * error event (sessions, replays, attachments and the like are dropped);
   * `unreachable` when Bugsink did not answer. Never throws.
   */
  relay(envelope: string): Promise<'sent' | 'off' | 'not-an-error' | 'unreachable'>;
  /** Wait for what is queued to leave, at most `ms`. For shutting down. */
  flush(ms?: number): Promise<boolean>;
}

export const offTracker: ErrorTracker = {
  on: false,
  capture: () => undefined,
  relay: () => Promise.resolve('off'),
  flush: () => Promise.resolve(true),
};

/** The release this process runs: the commit `deploy.sh` writes beside the code. */
export function releaseOf(
  revisionFile: URL = new URL('../../../../REVISION', import.meta.url),
): string | undefined {
  try {
    const sha = readFileSync(revisionFile, 'utf8').trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  } catch {
    // A checkout, not a release: there is no file, and no release to name.
    return undefined;
  }
}

interface TrackerOptions {
  config: Pick<Config, 'ERROR_TRACKING_DSN' | 'ERROR_TRACKING_ENVIRONMENT'>;
  release?: string | undefined;
  /** Tests pass their own; the server uses the global fetch. */
  fetch?: typeof fetch;
}

export function createErrorTracker({
  config,
  release,
  fetch: fetchImpl = fetch,
}: TrackerOptions): ErrorTracker {
  const dsnText = config.ERROR_TRACKING_DSN;
  const dsn = dsnText ? dsnFromString(dsnText) : undefined;
  if (!dsnText || !dsn) return offTracker;

  const makeTransport = (options: { url: string }): Transport =>
    createTransport(
      // Bounded: a Bugsink that is down must not make this process hold an
      // unbounded queue of events in memory.
      { bufferSize: 30, recordDroppedEvent: () => undefined },
      async (request): Promise<TransportMakeRequestResponse> => {
        // Nothing of the visitor's goes with it: no forwarded address, no
        // cookie. The request comes from this server.
        const res = await fetchImpl(options.url, {
          method: 'POST',
          body: request.body,
          signal: AbortSignal.timeout(10_000),
        });
        return {
          statusCode: res.status,
          headers: {
            'x-sentry-rate-limits': res.headers.get('x-sentry-rate-limits'),
            'retry-after': res.headers.get('retry-after'),
          },
        };
      },
    );

  const client = new ServerRuntimeClient({
    dsn: dsnText,
    transport: makeTransport,
    stackParser: createStackParser(nodeStackLineParser()),
    // None: no breadcrumbs, no request data, no context lines, nothing that
    // reads the process for more to send.
    integrations: [],
    sendDefaultPii: false,
    sendClientReports: false,
    platform: 'node',
    runtime: { name: 'node', version: process.version },
    environment: config.ERROR_TRACKING_ENVIRONMENT,
    ...(release ? { release } : {}),
    // The allowlist, last thing before an event leaves.
    beforeSend: (event) => scrubEvent({ ...event, platform: 'node' }) as SentryErrorEvent | null,
  });
  const scope = new Scope();
  scope.setClient(client);
  client.init();

  return {
    on: true,
    capture(err, tags = {}) {
      try {
        const s = scope.clone();
        s.setTags(tags);
        client.captureException(err, { originalException: err }, s);
      } catch {
        // Reporting an error must never become a second one.
      }
    },
    async relay(envelope) {
      const event = browserEvent(envelope);
      if (!event) return 'not-an-error';
      // The server's release and environment: the website was built from the
      // same commit, and a browser is not asked to say which.
      const out: ErrorEvent = {
        ...event,
        platform: 'javascript',
        environment: config.ERROR_TRACKING_ENVIRONMENT,
        ...(release ? { release } : {}),
        tags: { ...event.tags, side: 'website' },
      };
      // Straight to the transport, with this server's DSN. Whatever DSN or
      // address the envelope named is ignored, so the relay can only ever
      // reach the one Bugsink project configured here.
      try {
        await client.getTransport()?.send(createEventEnvelope(out as Event, dsn));
        return 'sent';
      } catch {
        return 'unreachable';
      }
    },
    flush: (ms = 2000) => Promise.resolve(client.flush(ms)),
  };
}

/** The one error event in a browser's envelope, cleaned; or null. */
export function browserEvent(envelope: string): ErrorEvent | null {
  let items: unknown[];
  try {
    items = parseEnvelope(envelope)[1];
  } catch {
    return null;
  }
  const events = items.filter(
    (item): item is [{ type: 'event' }, unknown] =>
      Array.isArray(item) && (item[0] as { type?: unknown } | undefined)?.type === 'event',
  );
  // One error per envelope is what the SDK sends. More is not the SDK.
  if (events.length !== 1 || !events[0]) return null;
  return scrubEvent(events[0][1]);
}
