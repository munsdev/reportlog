import crypto from 'node:crypto';
import canonicalize from 'canonicalize';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Where one logbook's chain starts.
 *
 * EVERY LOGBOOK IS ITS OWN CHAIN, so that a fault in one — a row altered,
 * a row missing — breaks that logbook and no other. Each starts from a
 * value made from the logbook's slug rather than from zeros, so the first
 * report of one logbook cannot be lifted out and passed off as the first
 * report of another: its link would name the wrong start.
 *
 * The slug, not the id, because the slug is what the seal carries and what
 * somebody checking a downloaded logbook has in front of them. It is never
 * editable for this reason. Anybody can recompute this by hand:
 * sha256 of the UTF-8 string "reportlog-chain:<slug>", lowercase hex.
 */
export function chainGenesis(slug) {
  return sha256Hex(`reportlog-chain:${slug}`);
}

// Fixed for the life of an archive — see genPublicRef below.
export const REF_PREFIX = 'RL-';

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Canonical JSON per RFC 8785 (JCS) — a documented, standard serialization,
// so the hashing process can be described precisely in an FRE 902(13)
// certification later rather than reverse-engineered from source.
export function contentHash(fields) {
  return sha256Hex(canonicalize(fields));
}

export function chainHash(contentHashHex, prevChainHashHex) {
  return sha256Hex(contentHashHex + prevChainHashHex);
}

/**
 * A report's public reference.
 *
 * The prefix identifies the deployment and is fixed for the life of an
 * archive. `public_ref` is inside the object that gets fingerprinted, so a
 * reference can never be reissued under a new prefix without breaking the
 * seal on the report it belongs to. A deployment that renames itself keeps
 * issuing the old prefix, or starts a second one and lives with both
 * forever — either is correct, and neither is a defect to tidy up later.
 *
 * Nothing anywhere may parse the prefix to decide how to treat a report.
 * Lookups are exact matches on the whole string, which is what lets several
 * prefixes coexist in one archive.
 *
 * TODO: read this from deployment settings rather than a constant, once
 * first-run setup exists. It must be settable once and never after.
 */
export function genPublicRef() {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${REF_PREFIX}${Date.now().toString(36).toUpperCase()}-${suffix}`;
}

function getKey() {
  const key = Buffer.from(process.env.TIER_B_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) {
    throw new Error('TIER_B_ENCRYPTION_KEY must decode to 32 bytes (openssl rand -base64 32)');
  }
  return key;
}

// Packed format: iv(12) || authTag(16) || ciphertext. Returns null for empty input,
// so optional Tier B fields don't produce spurious ciphertext.
export function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptField(packed) {
  if (!packed) return null;
  const buf = Buffer.isBuffer(packed) ? packed : Buffer.from(packed);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// --- Envelope encryption for attachment bytes ---
//
// Tier B fields are encrypted directly under the master key because they
// are short and there are only ever a handful per report. Attachments get
// a per-object data key instead, for one reason that matters more than
// key hygiene: destroying a single wrapped DEK erases exactly one file's
// content while leaving its SHA-256 — and the RFC 3161 anchor over the
// chain containing it — completely intact. Erasure that way never looks
// like tampering, which is what lets an append-only archive honour a
// deletion request at all.
//
// Same packed layout as encryptField (iv || tag || ciphertext), so there
// is only one format to document.

export function generateDek() {
  return crypto.randomBytes(32);
}

function sealWith(key, plaintextBuf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function openWith(key, packed) {
  const buf = Buffer.isBuffer(packed) ? packed : Buffer.from(packed);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export function encryptBuffer(plaintextBuf, dek) {
  return sealWith(dek, plaintextBuf);
}

export function decryptBuffer(packed, dek) {
  return openWith(dek, packed);
}

// The DEK itself is sealed under the same master key Tier B already uses,
// so key custody stays a single problem rather than two. When the README's
// HSM/Shamir plan lands, this is the only function that has to change.
export function wrapDek(dek) {
  return sealWith(getKey(), dek);
}

export function unwrapDek(wrapped) {
  if (!wrapped) return null;
  return openWith(getKey(), wrapped);
}

// --- Streaming variants, for files too large to hold in memory ---
//
// A 150 MB video buffered twice (plaintext plus ciphertext) is 300 MB of
// resident memory per file, on a box that is also running something else.
// These keep the peak at one chunk instead.
//
// The packed layout is unchanged — iv(12) || tag(16) || ciphertext — which
// matters because the tag is only known once the last byte has been
// encrypted. So encryption writes the ciphertext to a file first and hands
// back the header for the caller to prepend when uploading; decryption
// reads the header up front and streams the rest.

export function createEncryptStream(dek) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  return {
    cipher,
    // Only valid after the cipher has flushed — i.e. once the pipe is done.
    header: () => Buffer.concat([iv, cipher.getAuthTag()]),
  };
}

// GCM verifies the tag at final(), so a truncated or altered file throws
// mid-stream rather than yielding partial plaintext to the caller.
export function createDecryptStream(header, dek) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, header.subarray(0, 12));
  decipher.setAuthTag(header.subarray(12, 28));
  return decipher;
}

export const PACKED_HEADER_BYTES = 28;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function looksLikeEmail(s) {
  return EMAIL_RE.test(String(s || '').trim());
}

// Deterministic (but non-reversible, and keyed separately from the Tier B
// encryption key) so self-service login can look up "which threads did
// this email submit" without decrypting every restricted row to check.
function getHmacKey() {
  const key = Buffer.from(process.env.CONTACT_HMAC_KEY || '', 'base64');
  if (key.length !== 32) {
    throw new Error('CONTACT_HMAC_KEY must decode to 32 bytes (openssl rand -base64 32)');
  }
  return key;
}

export function hmacEmail(email) {
  return crypto.createHmac('sha256', getHmacKey()).update(normalizeEmail(email)).digest('hex');
}
