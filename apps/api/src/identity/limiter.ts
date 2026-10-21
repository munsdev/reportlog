/**
 * A fixed-window counter in memory, for the routes that send mail or take a
 * password. Not the defence against guessing a code (that is the attempt
 * count on the code itself, in the database); this stops somebody flooding
 * an inbox or hammering the curtain.
 *
 * Keys may be an address or a client's IP. NEITHER IS KEPT AS GIVEN: each is
 * turned into a keyed hash under a key that lives only in memory and changes
 * every day (door/clients.ts, owner decision E2), and the counters go with
 * the key. They live only here, for the length of a window, and are never
 * logged.
 */
import { HttpError } from '../http/errors.ts';
import { processHasher as hasher } from '../door/clients.ts';

export interface Limiter {
  /** Counts one use of `key`; throws a 429 with a sentence once over the limit. */
  take(key: string): void;
}

export function limiter({ max, windowMs }: { max: number; windowMs: number }): Limiter {
  const windows = new Map<string, { start: number; count: number }>();
  hasher.onRotate(() => {
    windows.clear();
  });
  return {
    take(given) {
      const key = hasher.of(given);
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
