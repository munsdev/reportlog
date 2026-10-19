/**
 * A fixed-window counter in memory, for the routes that send mail or take a
 * password. Not the defence against guessing a code (that is the attempt
 * count on the code itself, in the database); this stops somebody flooding
 * an inbox or hammering the curtain.
 *
 * Keys may be an address or a client's IP. They live only here, in memory,
 * for the length of a window, and are never logged.
 */
import { HttpError } from '../http/errors.ts';

export interface Limiter {
  /** Counts one use of `key`; throws a 429 with a sentence once over the limit. */
  take(key: string): void;
}

export function limiter({ max, windowMs }: { max: number; windowMs: number }): Limiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(key) {
      const now = Date.now();
      // Forget old windows as we go, so the map cannot grow without bound.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      }
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return;
      }
      w.count += 1;
      if (w.count > max) {
        throw new HttpError(
          429,
          'too_many',
          'That has been tried too many times. Wait a while and try again.',
        );
      }
    },
  };
}
