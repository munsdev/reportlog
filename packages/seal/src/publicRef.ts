/**
 * A report's public reference: `<prefix><time base36>-<6 random>`.
 *
 * The prefix identifies the deployment and is fixed for the life of an
 * archive, because `public_ref` is inside the sealed object. Nothing may
 * parse the prefix to decide how to treat a report; lookups are exact
 * matches on the whole string.
 *
 * Crockford-style alphabet (no I, L, O, U). 32 symbols, so `byte & 31` is
 * uniform and needs no rejection sampling.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const PUBLIC_REF_PREFIX = /^[A-Z][A-Z0-9]{0,7}-$/;

export function genPublicRef(prefix: string, now: number = Date.now()): string {
  if (!PUBLIC_REF_PREFIX.test(prefix)) {
    throw new Error(`genPublicRef: prefix must look like "RL-", got ${JSON.stringify(prefix)}`);
  }
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = '';
  for (const b of bytes) suffix += ALPHABET.charAt(b & 31);
  return `${prefix}${now.toString(36).toUpperCase()}-${suffix}`;
}
