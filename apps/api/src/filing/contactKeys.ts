/**
 * How to reach a reporter, kept so it can be erased.
 *
 * NEVER IN A SEALED FIELD. The address is not part of a report: the report
 * is permanent and an address must not be. Each thread's details are
 * encrypted under a key of their own (AES-256-GCM); that key is wrapped by
 * the deployment's CONTACT_KEY and kept in `contact_keys`, which may delete.
 * The ciphertext sits in `report_contacts`, which is append-only. ERASING IS
 * DELETING THE KEY: the ciphertext is never touched and can never be read
 * again.
 *
 * The keyed digest of the address is how "My reports" finds somebody's
 * reports. It lives beside the key, so after an erasure nothing links the
 * report to an address. It is keyed (HMAC, not a bare hash) so a copy of the
 * table cannot be searched by hashing a guessed address.
 *
 * Both keys are derived from the one CONTACT_KEY with HKDF, under different
 * labels, so an operator keeps one secret and the two uses never share a key.
 *
 * ROTATING IT (rotateContactKey.ts) has a window with two keys: the new one
 * in CONTACT_KEY and the old in CONTACT_KEY_PREVIOUS. In it, everything new
 * is written under the new key, a thread key is read under whichever of the
 * two opens it (AES-GCM's tag says which), and an address is looked up under
 * both digests. The rotation then moves every row to the new key.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

interface Keys {
  wrapKey: Buffer;
  hmacKey: Buffer;
}

export interface ContactKeyring extends Keys {
  /** Only during a rotation: the key being rotated away from. Read with, never written with. */
  previous?: Keys;
}

function keysFrom(contactKey: string, name: string): Keys {
  const secret = Buffer.from(contactKey, 'base64');
  if (secret.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  const derive = (label: string) =>
    Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), label, 32));
  return {
    wrapKey: derive('reportlog contact wrap v1'),
    hmacKey: derive('reportlog contact hmac v1'),
  };
}

export function keyringFrom(contactKey: string, previousKey?: string): ContactKeyring {
  const ring: ContactKeyring = keysFrom(contactKey, 'CONTACT_KEY');
  if (previousKey && previousKey !== contactKey) {
    ring.previous = keysFrom(previousKey, 'CONTACT_KEY_PREVIOUS');
  }
  return ring;
}

/** The one digest of an address. Normalized first, so case never splits a person in two. */
export function emailDigest(ring: Keys, email: string): string {
  return createHmac('sha256', ring.hmacKey)
    .update(email.trim().toLowerCase(), 'utf8')
    .digest('hex');
}

/** Every digest this address may be stored under: two only during a rotation. */
export function emailDigests(ring: ContactKeyring, email: string): string[] {
  return ring.previous
    ? [emailDigest(ring, email), emailDigest(ring.previous, email)]
    : [emailDigest(ring, email)];
}

// iv (12) | tag (16) | ciphertext
function encrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

/** Wrap a thread key under a wrapping key. For the rotation, which re-wraps. */
export const wrapDek = (wrapKey: Buffer, dek: Buffer): Buffer => encrypt(wrapKey, dek);

/** Open a thread key with one wrapping key, or null if that key is not the one. */
export function tryUnwrap(wrapKey: Buffer, wrapped: Buffer): Buffer | null {
  try {
    return decrypt(wrapKey, wrapped);
  } catch {
    return null;
  }
}

/** Open a thread key under the current key, or during a rotation the previous one. */
function unwrapDek(ring: ContactKeyring, wrapped: Buffer): Buffer {
  if (ring.previous) {
    const opened = tryUnwrap(ring.wrapKey, wrapped) ?? tryUnwrap(ring.previous.wrapKey, wrapped);
    if (opened) return opened;
  }
  return decrypt(ring.wrapKey, wrapped);
}

/** A thread's address, decrypted with its own key. For the rotation, which re-computes digests. */
export const openWithDek = (dek: Buffer, sealed: Buffer): string =>
  decrypt(dek, sealed).toString('utf8');

/**
 * Write a thread's contact details. Inside the transaction that files the
 * report, after its report_heads row exists.
 *
 * Only a reporter's own address puts the report under that address's "My
 * reports" (the digest is written only for `filedBy: 'reporter'`). On a
 * coordinator's filing the address is the coordinator's, and the reporter's
 * permissions are not theirs to give.
 */
export async function sealContact(
  trx: Transaction<DB>,
  ring: ContactKeyring,
  input: {
    threadId: string;
    email: string;
    filedBy: 'reporter' | 'coordinator';
    organization?: string;
  },
): Promise<void> {
  const dek = randomBytes(32);
  await trx
    .insertInto('contact_keys')
    .values({
      thread_id: input.threadId,
      dek_wrapped: encrypt(ring.wrapKey, dek),
      email_hmac: input.filedBy === 'reporter' ? emailDigest(ring, input.email) : null,
    })
    .execute();
  await trx
    .insertInto('report_contacts')
    .values({
      thread_id: input.threadId,
      filed_by: input.filedBy,
      contact_enc: encrypt(dek, Buffer.from(input.email, 'utf8')),
      organization_enc:
        input.filedBy === 'coordinator'
          ? encrypt(dek, Buffer.from(input.organization ?? '', 'utf8'))
          : null,
    })
    .execute();
}

export interface OpenedContact {
  filed_by: 'reporter' | 'coordinator';
  /** Null once erased. */
  email: string | null;
  organization: string | null;
  erased: boolean;
}

/**
 * Read a thread's contact details. For the moderation workstream, which
 * must log every opening; nothing in filing reads them back.
 */
export async function openContact(
  db: Kysely<DB>,
  ring: ContactKeyring,
  threadId: string,
): Promise<OpenedContact | null> {
  const row = await db
    .selectFrom('report_contacts as c')
    .leftJoin('contact_keys as k', 'k.thread_id', 'c.thread_id')
    .select(['c.filed_by', 'c.contact_enc', 'c.organization_enc', 'k.dek_wrapped'])
    .where('c.thread_id', '=', threadId)
    .executeTakeFirst();
  if (!row) return null;
  const filedBy = row.filed_by === 'coordinator' ? 'coordinator' : 'reporter';
  if (!row.dek_wrapped) return { filed_by: filedBy, email: null, organization: null, erased: true };
  const dek = unwrapDek(ring, row.dek_wrapped);
  return {
    filed_by: filedBy,
    email: decrypt(dek, row.contact_enc).toString('utf8'),
    organization: row.organization_enc ? decrypt(dek, row.organization_enc).toString('utf8') : null,
    erased: false,
  };
}

/**
 * Destroy a thread's key, and the confirmation-link rows that point at it.
 * Returns whether a key was destroyed.
 */
export async function eraseContact(trx: Transaction<DB>, threadId: string): Promise<boolean> {
  const out = await trx
    .deleteFrom('contact_keys')
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  await trx.deleteFrom('report_submissions').where('thread_id', '=', threadId).execute();
  return out.numDeletedRows > 0n;
}
