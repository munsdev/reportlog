/**
 * The three hashes the archive's promise is made of.
 *
 * Canonical JSON is RFC 8785 (JCS), a documented standard serialization, so
 * the process can be described precisely to somebody who does not trust us
 * and does not have our code. SHA-256 comes from @noble/hashes rather than
 * `node:crypto` so the same code runs in a reader's browser.
 */
import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** SHA-256 of a string's UTF-8 bytes, lowercase hex. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** RFC 8785 serialization. Throws on anything JSON cannot represent. */
export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error('canonicalJson: value has no JSON representation');
  return out;
}

/** A report's own fingerprint: SHA-256 of its sealed object, canonicalized. */
export function contentHash(sealed: object): string {
  return sha256Hex(canonicalJson(sealed));
}

/** One link: SHA-256 of the content hash followed by the previous link, as hex text. */
export function chainHash(contentHashHex: string, prevChainHashHex: string): string {
  return sha256Hex(contentHashHex + prevChainHashHex);
}

/**
 * Where one logbook's chain starts.
 *
 * EVERY LOGBOOK IS ITS OWN CHAIN, starting from a value made from its slug,
 * so the first report of one logbook cannot be passed off as the first of
 * another. The slug and not an id, because the slug is what the seal carries;
 * it is never editable for this reason. By hand: sha256 of the UTF-8 string
 * "reportlog-chain:<slug>", lowercase hex.
 */
export function chainGenesis(slug: string): string {
  return sha256Hex(`reportlog-chain:${slug}`);
}

/** Lowercase hex SHA-256, the only digest shape the archive uses. */
export const HEX64 = /^[a-f0-9]{64}$/;
