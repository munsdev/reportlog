/**
 * Sentry's browser SDK, set up to send to this site's relay and to keep
 * nothing that could identify the visitor. Loaded only once an error has
 * happened and the server has said error tracking is on (report.ts).
 *
 * No integrations beyond the two that shape the error itself: no
 * breadcrumbs (each fetch's URL), no global handlers of its own (report.ts
 * has them), no sessions, no replay. `scrubEvent` (@reportlog/contracts) is
 * the allowlist, applied here and again by the relay, which does not trust
 * this side to have done it.
 */
import { ERROR_RELAY_PATH, scrubEvent } from '@reportlog/contracts';
import {
  BrowserClient,
  Scope,
  dedupeIntegration,
  defaultStackParser,
  linkedErrorsIntegration,
  makeFetchTransport,
} from '@sentry/browser';
import type { ErrorEvent } from '@sentry/browser';

/**
 * The SDK needs a DSN to build an envelope. This one names nothing real and
 * is never contacted: everything goes to the relay, which ignores it and
 * uses the server's own.
 */
const NOWHERE = 'https://website@relay.invalid/1';

export function createSender(): (err: unknown, route: string | undefined) => void {
  const client = new BrowserClient({
    dsn: NOWHERE,
    tunnel: ERROR_RELAY_PATH,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [dedupeIntegration(), linkedErrorsIntegration()],
    sendDefaultPii: false,
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event) as ErrorEvent | null,
  });
  const scope = new Scope();
  scope.setClient(client);
  client.init();
  return (err, route) => {
    try {
      const s = scope.clone();
      if (route) s.setTag('route', route);
      client.captureException(err, { originalException: err }, s);
    } catch {
      // Reporting an error must never become a second one.
    }
  };
}
