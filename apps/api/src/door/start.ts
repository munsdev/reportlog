/**
 * MINIMUM TIME ON THE FORM (brief §02).
 *
 * When a form loads, the page asks for a start token: the moment it was
 * issued and an HMAC of that moment under the door's key. It carries nothing
 * else: no address, no logbook, no session, nothing about who asked. A report
 * or tip sent sooner after its token than the door's setting is refused, as is
 * one with no token or a token we did not sign.
 *
 * Not single use: a page keeps its token for as long as it is open, so a
 * refusal on another check can be answered by sending again at once. The
 * puzzle is what stops a solution being replayed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** A token from a few seconds in the future is a clock, not a forgery. */
const SKEW_MS = 5_000;

export type StartCheck = 'start_missing' | 'too_fast';

const mac = (key: Buffer, issued: number) =>
  createHmac('sha256', key)
    .update(`form-start.${String(issued)}`)
    .digest('base64url');

export function issueStart(key: Buffer, now: number = Date.now()): string {
  return `${String(now)}.${mac(key, now)}`;
}

/** Null when the form was open long enough; otherwise which check refused it. */
export function checkStart(
  key: Buffer,
  token: unknown,
  minFormMs: number,
  now: number = Date.now(),
): StartCheck | null {
  if (typeof token !== 'string' || token.length > 200) return 'start_missing';
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return 'start_missing';
  const issued = Number(m[1]);
  const given = Buffer.from(m[2] ?? '');
  const expected = Buffer.from(mac(key, issued));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'start_missing';
  if (issued > now + SKEW_MS) return 'start_missing';
  return now - issued < minFormMs ? 'too_fast' : null;
}
