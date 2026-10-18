/**
 * The day's hashing secret, and the hashed address.
 *
 * THE RAW ADDRESS IS NEVER WRITTEN. Rate limiting works identically on the
 * hash, so nothing is given up operationally. What is given up is any later
 * abuse investigation that would need the real address, and that is taken
 * knowingly: a raw IP beside free text about third parties is the heaviest
 * and least justifiable data in this system.
 *
 * WHY A SECRET AND NOT A SALT. A salted hash of an IPv4 address is not a
 * one-way function in any useful sense — the space is 2^32, so anybody
 * holding the table and the salt can enumerate it on a laptop in minutes
 * and recover every address. The industry answer is an HMAC under a secret
 * (a "pepper"), which is useless to somebody holding only the table, and
 * ROTATION so that the secret for any given day stops existing.
 *
 * So: one random 32-byte secret per UTC day, HMAC-SHA256 under it, and the
 * sweep destroys it after a short window. Once that row is gone, every hash
 * taken under it is permanently uncorrelatable — which is what makes "we do
 * not hold addresses" true afterwards and not merely at the time.
 *
 * WHAT IS DELIBERATELY NOT DONE: deriving the day's secret from a
 * long-lived key and the date. It looks like rotation and is not — any past
 * day's hashes can be recomputed from the key forever, so nothing is ever
 * destroyed and the whole property above is lost. If this file ever grows
 * an `hmac(masterKey, date)`, that is the bug.
 */
import crypto from 'node:crypto';
import { pool } from '../db.js';

export const SALT_BYTES = 32;

/** UTC, so a deployment's day boundary does not move with the clocks. */
export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Per-process, keyed by day. The row for a given day never changes once it
// exists, so this cannot go stale within the day it answers for.
const cache = new Map();

/**
 * Fetch or create the secret for a day.
 *
 * Read, then insert with ON CONFLICT DO NOTHING, then read again — rather
 * than an upsert that returns. Two workers taking their first submission of
 * the day in the same millisecond must end up with the SAME secret, or the
 * two halves of the day's rate limiting cannot see each other.
 */
export async function saltForDay(day = utcDay(), { client = pool } = {}) {
  const cached = cache.get(day);
  if (cached) return cached;

  const found = await client.query('SELECT salt FROM list_salts WHERE day = $1', [day]);
  if (found.rows[0]) {
    cache.set(day, found.rows[0].salt);
    return found.rows[0].salt;
  }

  await client.query(
    'INSERT INTO list_salts (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING',
    [day, crypto.randomBytes(SALT_BYTES)],
  );
  const settled = await client.query('SELECT salt FROM list_salts WHERE day = $1', [day]);
  if (!settled.rows[0]) throw new Error('could not establish the day\'s hashing secret');
  cache.set(day, settled.rows[0].salt);
  return settled.rows[0].salt;
}

/** Only for tests, which need to watch rotation happen. */
export function forgetCachedSalts() {
  cache.clear();
}

/**
 * Hash an address under the day's secret.
 *
 * Returns null for a missing address rather than hashing the empty string,
 * which would give every address-less caller one shared bucket and a rate
 * limit they all share.
 */
export async function hashAddress(address, { day = utcDay(), client = pool } = {}) {
  if (!address) return null;
  const salt = await saltForDay(day, { client });
  return crypto.createHmac('sha256', salt).update(String(address)).digest('hex');
}
