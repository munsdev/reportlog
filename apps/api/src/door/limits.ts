/**
 * Rate limits per network address, counted under its keyed hash (clients.ts).
 *
 * THREE WINDOWS. Reports and tips per minute and per hour, low, because each
 * one costs a moderator's attention; and requests of any kind per minute,
 * much higher, so that reading the archive stays fast while somebody floods
 * the forms (brief §02). Fixed windows: simple, and a flooder who times the
 * edge of one gets at most twice the limit for a moment, which the hour
 * window then catches.
 *
 * Every counter is dropped when the hashing key rotates: a counter under
 * yesterday's key can never be matched again, so keeping it would only be
 * keeping it.
 */
import type { ClientHasher } from './clients.ts';

export interface DoorLimits {
  submitsPerMinute: number;
  submitsPerHour: number;
  requestsPerMinute: number;
}

/** Why a submission was turned away, as the refusal counter names it. */
export type RateCheck = 'rate_minute' | 'rate_hour';

interface Window {
  start: number;
  count: number;
}

/** A fixed window per key. `take` counts one and says whether it was over. */
function windows(max: number, windowMs: number, now: () => number) {
  const map = new Map<string, Window>();
  return {
    /** The count after this one, or 0 when this one opened a new window. */
    take(key: string): number {
      const t = now();
      // Forget old windows as we go, so the map cannot grow without bound.
      if (map.size > 50_000) {
        for (const [k, w] of map) if (t - w.start >= windowMs) map.delete(k);
      }
      const w = map.get(key);
      if (!w || t - w.start >= windowMs) {
        map.set(key, { start: t, count: 1 });
        return 1;
      }
      w.count += 1;
      return w.count;
    },
    max,
    clear: () => {
      map.clear();
    },
  };
}

export interface RateLimiter {
  /** Counts a report or tip from this address; the window it broke, or null. */
  submit(ip: string): RateCheck | null;
  /**
   * Counts a request of any kind. `over` once past the limit, and `first` only
   * on the request that crossed it, so a flood is counted once per window
   * rather than once per request (counting is a database write).
   */
  request(ip: string): { over: boolean; first: boolean };
}

export function rateLimiter(
  hasher: ClientHasher,
  limits: DoorLimits,
  now: () => number = Date.now,
): RateLimiter {
  const minute = windows(limits.submitsPerMinute, 60_000, now);
  const hour = windows(limits.submitsPerHour, 3_600_000, now);
  const requests = windows(limits.requestsPerMinute, 60_000, now);
  hasher.onRotate(() => {
    minute.clear();
    hour.clear();
    requests.clear();
  });
  return {
    submit(ip) {
      const key = hasher.of(ip);
      // Both windows count every attempt, so a refusal by the minute still
      // uses up the hour.
      const inMinute = minute.take(key);
      const inHour = hour.take(key);
      if (inMinute > minute.max) return 'rate_minute';
      if (inHour > hour.max) return 'rate_hour';
      return null;
    },
    request(ip) {
      const n = requests.take(hasher.of(ip));
      return { over: n > requests.max, first: n === requests.max + 1 };
    },
  };
}
