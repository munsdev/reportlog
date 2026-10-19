/**
 * Error tracking (workstream H2): what an error event is allowed to carry.
 *
 * Events go to a self-hosted Bugsink through Sentry's SDKs. Those SDKs add a
 * great deal by default: the page's address, request headers and bodies, the
 * visitor's address, breadcrumbs of every fetch with its URL, console lines.
 * On an archive where people report things, each of those can identify
 * somebody or carry a token (a confirmation link is a URL).
 *
 * So this is an ALLOWLIST, not a blocklist. `ErrorEvent` names every key an
 * event may keep; zod drops everything else, including whatever a future SDK
 * version thinks to add. Free text that is kept (an error's message) is put
 * through `scrubText`, because a message can quote a URL or an address.
 *
 * Both sides use it: the server before anything leaves it, and the website
 * before it hands an event to the relay. The relay applies it again to what
 * the browser sent, because a browser is not trusted to have done so.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

/** Whether this site reports its website's errors. Answered in front of the site password. */
export const getErrorTracking = defineRoute({
  method: 'GET',
  path: '/api/telemetry',
  summary: 'Whether the website should send its errors to the relay.',
  response: z.object({ errors: z.boolean() }),
});

/** Where the website posts an error, as a Sentry envelope. The server relays it to Bugsink. */
export const ERROR_RELAY_PATH = '/api/telemetry/errors';

/** Tags an event may carry. Anything else a caller sets is dropped. */
export const ERROR_TAGS = ['route', 'method', 'status', 'job', 'side'] as const;

const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)\]}]+/gi;
const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}/gi;
// Sign-in codes, confirmation and erasure tokens, keys: a long run of
// letters and digits that has both. Ordinary words and identifiers do not.
const TOKEN = /[A-Za-z0-9_-]{24,}/g;

/**
 * Free text with what could identify somebody or open something taken out:
 * whole URLs (a URL can carry a token, and the page's own address is where
 * the reporter was), email addresses, IP addresses and anything token-like.
 */
export function scrubText(text: string): string {
  return text
    .replace(URL_LIKE, '[address]')
    .replace(EMAIL, '[email]')
    .replace(IPV4, '[ip]')
    .replace(IPV6, (m) =>
      // Not a time (12:30:45) or a C++-style name (Foo::bar): an IPv6
      // address has five or more colons, or "::" and a digit.
      m.split(':').length > 5 || (m.includes('::') && /\d/.test(m)) ? '[ip]' : m,
    )
    .replace(TOKEN, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '[token]' : m));
}

/**
 * A stack frame's file, as a path. In a browser it is the script's full URL
 * (`https://site/assets/index-3f2a.js?x`): the origin, query and fragment go,
 * the asset's path stays, so the frame still points at the right file.
 */
export function framePath(file: string): string {
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file)) return new URL(file).pathname;
  } catch {
    return '[address]';
  }
  return file;
}

const text = (max: number) => z.string().transform((s) => scrubText(s).slice(0, max));
// Each optional key is dropped, not fatal, when it has the wrong type: an
// event with one odd field is still worth having.
const opt = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const Frame = z.object({
  filename: opt(z.string().transform((s) => framePath(s).slice(0, 300))),
  abs_path: opt(z.string().transform((s) => framePath(s).slice(0, 300))),
  function: opt(text(200)),
  module: opt(text(200)),
  lineno: opt(z.number().int()),
  colno: opt(z.number().int()),
  in_app: opt(z.boolean()),
});

const Exception = z.object({
  type: opt(text(200)),
  value: opt(text(1000)),
  module: opt(text(200)),
  mechanism: opt(z.object({ type: opt(text(50)), handled: opt(z.boolean()) })),
  stacktrace: opt(
    z.object({
      // Sentry lists the outermost call first, so the end is where it broke.
      frames: z.array(Frame).transform((f) => f.slice(-50)),
    }),
  ),
});

const NameVersion = z.object({ name: opt(text(100)), version: opt(text(50)) });

export const ErrorEvent = z.object({
  event_id: opt(z.string().regex(/^[0-9a-f]{32}$/)),
  timestamp: opt(z.number()),
  platform: z.enum(['javascript', 'node']).catch('javascript'),
  level: z.enum(['fatal', 'error', 'warning']).catch('error'),
  release: opt(text(100)),
  environment: opt(text(64)),
  // The route PATTERN (`/api/reports/:ref`), never the address.
  transaction: opt(text(200)),
  exception: z.object({ values: z.array(Exception).min(1).max(10) }),
  tags: opt(
    z.record(z.string(), z.unknown()).transform((tags) =>
      Object.fromEntries(
        ERROR_TAGS.flatMap((k) => {
          const v = tags[k];
          return typeof v === 'string' || typeof v === 'number'
            ? [[k, scrubText(String(v)).slice(0, 200)]]
            : [];
        }),
      ),
    ),
  ),
  sdk: opt(NameVersion),
  contexts: opt(z.object({ runtime: opt(NameVersion), os: opt(NameVersion) })),
});
export type ErrorEvent = z.infer<typeof ErrorEvent>;

/**
 * An event reduced to what it may carry, or null when it is not an error
 * event at all (no exception: a message, a session, a transaction).
 */
export function scrubEvent(raw: unknown): ErrorEvent | null {
  const parsed = ErrorEvent.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
