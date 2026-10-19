/**
 * The day's hashing secret, and the hashed address.
 *
 * THE RAW ADDRESS IS NEVER WRITTEN. Rate limiting and spotting one person
 * pressing a button fifty times work identically on the hash. What is given up
 * is any later investigation that would need the real address, and that is
 * taken knowingly: a raw IP beside free text about third parties is the
 * heaviest and least justifiable data in the system.
 *
 * WHY A SECRET AND NOT A SALT. A salted hash of an IPv4 address is not
 * one-way in any useful sense: the space is 2^32, so anybody holding the table
 * and the salt can enumerate it on a laptop. So: one random 32-byte secret per
 * UTC day, HMAC-SHA256 under it, and the sweep DESTROYS it after a short
 * window. Once the row is gone, every hash taken under it is permanently
 * uncorrelatable.
 *
 * WHAT MUST NEVER HAPPEN TO THIS FILE: deriving the day's secret from a
 * long-lived key and the date. It looks like rotation and is not: every past
 * day's hashes stay recomputable from the key forever, so nothing is ever
 * destroyed. If this file grows an `hmac(masterKey, date)`, that is the bug.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Db } from './rows.ts';

export const SALT_BYTES = 32;

/** UTC, so a deployment's day boundary does not move with the clocks. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Per process, keyed by day. A day's row never changes once it exists, so
// this cannot go stale within the day it answers for.
const cache = new Map<string, Buffer>();

/**
 * Fetch or create the secret for a day. Insert-if-absent, then read: two
 * servers taking their first entry of the day in the same millisecond must
 * end up with the SAME secret, or neither can see the other's repeats.
 */
export async function saltForDay(db: Db, day: string = utcDay()): Promise<Buffer> {
  const cached = cache.get(day);
  if (cached) return cached;
  await db
    .insertInto('list_salts')
    .values({ day, salt: randomBytes(SALT_BYTES) })
    .onConflict((oc) => oc.column('day').doNothing())
    .execute();
  const row = await db
    .selectFrom('list_salts')
    .select('salt')
    .where('day', '=', day)
    .executeTakeFirstOrThrow();
  cache.set(day, row.salt);
  return row.salt;
}

/** After the sweep destroys a secret, and for tests that watch rotation. */
export function forgetCachedSalts(): void {
  cache.clear();
}

/**
 * Hash an address under the day's secret. Null for no address, rather than a
 * hash of the empty string, which would put every address-less caller in one
 * shared bucket.
 */
export async function hashAddress(
  db: Db,
  address: string | null | undefined,
  day: string = utcDay(),
): Promise<string | null> {
  if (!address) return null;
  const salt = await saltForDay(db, day);
  return createHmac('sha256', salt).update(address).digest('hex');
}
