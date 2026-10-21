/**
 * WHO IS ASKING, WITHOUT KEEPING WHO (owner decision E2).
 *
 * A rate limit has to tell one network address from another, and that is all
 * it may know. So the address is turned at once into an HMAC under a key that
 * exists only in this process's memory and is replaced at every UTC midnight.
 * When the key goes, every hash made under it stops meaning anything, and the
 * counters keyed by them are dropped in the same step (`onRotate`): nothing
 * that could point back at an address survives a day, and nothing of it was
 * ever written down.
 *
 * WHY MEMORY AND NOT A TABLE. The API runs as one process
 * (deploy/systemd/reportlog-api.service), so a limit kept here is the whole
 * site's limit. A table would be a second copy that a backup could carry off
 * and a sweep would have to remember to empty; decision 40 already said
 * "in memory only". The cost is that a restart forgets the counts, which
 * forgives a flooder one window.
 *
 * The address comes from `request.ip`, which Fastify reads from
 * X-Forwarded-For only for the TRUST_PROXY hops configured (app.ts): behind
 * Caddy that is the visitor, and a header a visitor sets themselves is not.
 */
import { createHmac, randomBytes } from 'node:crypto';

export interface ClientHasher {
  /** The keyed hash of an address under today's key. */
  of(ip: string): string;
  /** Called with nothing when the key changes, so counters can be dropped. */
  onRotate(drop: () => void): void;
  /**
   * Replace the key if the day has changed. Also run on a timer (door/index.ts),
   * so a quiet night still drops yesterday's key and counters by morning.
   */
  tick(): void;
}

const dayOf = (ms: number) => Math.floor(ms / 86_400_000);

export function clientHasher(now: () => number = Date.now): ClientHasher {
  let day = dayOf(now());
  let key = randomBytes(32);
  const drops: (() => void)[] = [];
  const current = () => {
    const today = dayOf(now());
    if (today !== day) {
      day = today;
      key = randomBytes(32);
      for (const drop of drops) drop();
    }
    return key;
  };
  return {
    of: (ip) => createHmac('sha256', current()).update(ip).digest('base64url'),
    onRotate: (drop) => {
      drops.push(drop);
    },
    tick: () => {
      current();
    },
  };
}

/**
 * The process's one hasher, shared by the door and every in-memory limiter
 * (identity/limiter.ts), so there is one key to forget each day and one timer
 * (door/index.ts) that makes sure it is forgotten.
 */
export const processHasher: ClientHasher = clientHasher();
