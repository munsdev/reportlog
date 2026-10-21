/**
 * Authenticator-app secrets, encrypted at rest under TWO_FACTOR_KEY.
 *
 * A TOTP secret has to be read back to check a code, so unlike a session or
 * a recovery code it cannot be stored as a hash. It is encrypted
 * (AES-256-GCM) under a key derived from TWO_FACTOR_KEY, with the person's
 * id as associated data, so a copy of the database produces no codes and a
 * secret moved onto another person's row does not open.
 *
 * WHY A KEY OF ITS OWN and not CONTACT_KEY's keyring: the two have different
 * costs. Losing CONTACT_KEY makes every reporter's address unreadable for
 * good, so it is never changed and a deploy refuses a different one. Losing
 * or replacing this one costs each staff member setting their authenticator
 * app up again (passkeys and recovery codes are not under it, and the owner
 * or `reportlog reset-2fa` clears a factor nobody can use). Sharing a secret
 * would give one the other's blast radius, and the other's rules. For the
 * same reason there is no PREVIOUS key and no rotation window: a new key is
 * a reset, and a cheap one.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface TwoFactorKey {
  readonly key: Buffer;
}

export function twoFactorKeyFrom(base64: string | undefined): TwoFactorKey | null {
  if (!base64) return null;
  const secret = Buffer.from(base64, 'base64');
  if (secret.length !== 32) throw new Error('TWO_FACTOR_KEY must be 32 bytes, base64');
  return {
    key: Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'reportlog totp secret v1', 32)),
  };
}

const aad = (userId: number) => Buffer.from(`totp\u0000${String(userId)}`, 'utf8');

// iv (12) | tag (16) | ciphertext
export function sealTotpSecret(k: TwoFactorKey, userId: number, secret: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k.key, iv);
  cipher.setAAD(aad(userId));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Null when it does not open: another key, another person's row, or damaged. */
export function openTotpSecret(k: TwoFactorKey, userId: number, sealed: Buffer): Buffer | null {
  if (sealed.length < 29) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', k.key, sealed.subarray(0, 12));
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(sealed.subarray(12, 28));
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}
