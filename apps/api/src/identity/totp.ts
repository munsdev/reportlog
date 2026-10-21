/**
 * Authenticator-app codes (RFC 6238 over RFC 4226): HMAC-SHA-1, six digits,
 * a thirty-second step. The parameters every authenticator app defaults to,
 * so the QR code needs to say nothing unusual.
 *
 * Pure: no database and no clock of its own. Which step a code matched is
 * returned rather than a yes, because a code is accepted once (the caller
 * keeps the last step used and refuses any step not after it).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
/** One step either side: a phone's clock a little off, or a code typed as it turned over. */
export const TOTP_WINDOW = 1;
/** 160 bits, the size RFC 4226 recommends for SHA-1. */
export const TOTP_SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding: what an authenticator app is given. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Spaces, hyphens, padding and case are forgiven, as a person typing one would expect. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = BASE32.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4226's HOTP for one counter value. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secret: Uint8Array, ms: number): string {
  return hotp(secret, stepAt(ms));
}

/**
 * The step a code belongs to, if it is right for now or one step either
 * side; null otherwise. Every candidate is compared, in constant time, so
 * the answer takes as long whichever step (if any) matched.
 */
export function matchTotp(secret: Uint8Array, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  const typed = Buffer.from(code);
  let found: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d += 1) {
    const step = now + d;
    if (step < 0) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), typed) && found === null) found = step;
  }
  return found;
}

/**
 * What the QR code says (the Key Uri Format every authenticator app reads).
 * The issuer is the site's host, so somebody with two ReportLog sites in one
 * app can tell them apart.
 */
export function otpauthUri(secret: Uint8Array, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const q = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
