/**
 * WHAT THE SEAL HOLDS OF AN ERASABLE VALUE: its fingerprint, never the value.
 *
 * A `private_text` or `private_link` answer (packages/fields/src/held.ts) is
 * kept outside the report, under a key of its own, so it can be erased. The
 * sealed object commits to it through two top-level keys, each written ONLY
 * WHEN IT APPLIES:
 *
 *   text_fingerprints   { "<question key>": "<fingerprint>" }
 *   link_fingerprints   { "<question key>": ["<fingerprint>", ...] }   in the order sent
 *
 * THE FINGERPRINT, by hand: SHA-256, lowercase hex, of the RFC 8785 JSON of
 * `{"nonce": <nonce>, "value": <value>}`, where the nonce is 32 random bytes
 * as 64 lowercase hex characters, made for this one value and kept with it,
 * under the same key. Why the nonce: a fingerprint of the value alone could
 * be matched by anybody who guesses the value (a link especially), so the
 * published fingerprint would say what the report held. With the nonce it
 * says nothing, and once the value and its nonce are erased nothing can.
 *
 * ERASURE LEAVES THE FINGERPRINT, so the report still verifies: the sealed
 * object is rebuilt from the fingerprints stored with the report, never from
 * the values. Whoever still holds a value and its nonce can show it is the
 * one sealed, with `heldFingerprint`.
 *
 * Pure, and runs in a browser like the rest of this package.
 */
import { HEX64, canonicalJson, sha256Hex } from './hash.ts';

/**
 * The recipe a report is sealed under when it carries a fingerprint key. A
 * report without one is sealed under recipe 1 exactly as before, with no
 * `recipe` key, so nothing filed before this changes and nothing filed after
 * it without a held value looks any different.
 */
export const HELD_RECIPE = 2;

/** The nonce's one written form: 32 bytes, lowercase hex. */
export const NONCE = HEX64;

/** A held value's fingerprint. Throws on a nonce that is not 64 lowercase hex. */
export function heldFingerprint(nonce: string, value: string): string {
  if (!NONCE.test(nonce)) throw new Error('heldFingerprint: the nonce must be 64 lowercase hex');
  return sha256Hex(canonicalJson({ nonce, value }));
}

export type TextFingerprints = Record<string, string>;
export type LinkFingerprints = Record<string, string[]>;
