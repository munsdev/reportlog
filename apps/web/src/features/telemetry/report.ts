/**
 * The website's errors, reported to this site's own server (workstream H2).
 *
 * NOTHING HAPPENS UNTIL SOMETHING BREAKS. No request at start, no SDK in the
 * page: on the first error this asks the server whether error tracking is on
 * (`GET /api/telemetry`), and only if it is does it load Sentry's browser SDK
 * (its own chunk) and send. The browser only ever talks to this site: the SDK
 * posts to the relay (`/api/telemetry/errors`), and the server passes the
 * event on to Bugsink. So the site's no-third-party promise holds with error
 * tracking on.
 *
 * Both calls are in front of the site password, so a lock screen or a door
 * page reporting an error is never refused and never sent back to the lock
 * screen for it.
 */
import { getErrorTracking } from '@reportlog/contracts';
import { ApiRequestError, call } from '@/lib/api.ts';

type Send = (err: unknown, route: string | undefined) => void;

/** At most this many errors wait while the first one asks whether to send. */
const WAITING_MAX = 10;

let state: 'unknown' | 'asking' | 'off' | Send = 'unknown';
let waiting: { err: unknown; route: string | undefined }[] = [];
let routeOf: () => string | undefined = () => undefined;

/** Report an error, or do nothing if error tracking is off. Never throws. */
export function reportError(err: unknown): void {
  // A refusal the page already shows (a 404, the password) is not a fault.
  if (err instanceof ApiRequestError && err.status < 500) return;
  if (state === 'off') return;
  // The route's id (`/file/$slug`), never the address, which can carry a token.
  const route = safely(routeOf);
  if (typeof state === 'function') {
    state(err, route);
    return;
  }
  if (waiting.length < WAITING_MAX) waiting.push({ err, route });
  if (state === 'unknown') void start();
}

async function start(): Promise<void> {
  state = 'asking';
  try {
    const { errors } = await call(getErrorTracking);
    if (!errors) {
      state = 'off';
    } else {
      const { createSender } = await import('./sentry.ts');
      state = createSender();
    }
  } catch {
    // The server cannot be asked, so nothing can be sent either. Try again
    // with the next error.
    state = 'unknown';
    waiting = [];
    return;
  }
  const send = state;
  const queued = waiting;
  waiting = [];
  if (typeof send === 'function') for (const q of queued) send(q.err, q.route);
}

function safely<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

/**
 * Listen for what nothing caught. `currentRoute` names the route's pattern
 * for each report. React's own errors come through `rootErrorHandlers`.
 */
export function installErrorReporting(currentRoute: () => string | undefined): void {
  routeOf = currentRoute;
  window.addEventListener('error', (e) => {
    reportError(e.error ?? new Error(e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason);
  });
}

/**
 * For `createRoot`: React's errors, caught by an error boundary or not.
 * Still written to the console, as React's defaults do.
 */
export const rootErrorHandlers = {
  onUncaughtError: (err: unknown) => {
    console.error(err);
    reportError(err);
  },
  onCaughtError: (err: unknown) => {
    console.error(err);
    reportError(err);
  },
};

/** For tests: forget what was decided. */
export function resetErrorReporting(): void {
  state = 'unknown';
  waiting = [];
}
