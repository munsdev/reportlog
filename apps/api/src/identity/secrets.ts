/**
 * Addresses, tokens and passwords: the few primitives everything here uses.
 *
 * Every credential this workstream issues (a session, a site-access token,
 * an invitation link) is random, travels to its holder once, and is stored
 * only as a hash. A copy of the database therefore signs nobody in and opens
 * no invitation.
 */
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 32 random bytes as hex: what a cookie or a link carries. */
export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

/** A six-digit one-time code, leading zeros kept. */
export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** The one spelling of an address: trimmed and lower-cased. */
export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Deliberately loose. It refuses what is plainly not an address, and
 * anything with a space or a bracket in it; deliverability is proved by the
 * code arriving, not by a pattern.
 */
export function looksLikeEmail(value: string): boolean {
  return (
    value.length <= 254 && /^[^@\s<>()[\]"',;]+@[^@\s<>()[\]"',;]+\.[^@\s<>()[\]"',;]+$/.test(value)
  );
}

/** Compare two hex digests without leaking where they differ. */
export function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const SCRYPT_KEYLEN = 32;

function scryptHex(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
}

/** The site password, salted and stretched, as "scrypt$<salt>$<hash>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${await scryptHex(password, salt)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // No hash, no match: a password that was never set admits nobody.
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  return sameHex(await scryptHex(password, salt), hash);
}
