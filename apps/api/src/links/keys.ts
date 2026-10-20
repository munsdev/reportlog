/**
 * The keys a link is kept under (Plan D K9, K11, K13), and an entry's email
 * (owner ruling 40).
 *
 * ONE SECRET IN THE DATABASE, WRAPPED BY CONTACT_KEY. Every link's own key is
 * wrapped under a key derived from it, and every matching key and blocklist
 * hash is an HMAC under another. Why not derive straight from CONTACT_KEY, as
 * report contact details do: a keyed hash cannot be recomputed without the
 * address, and the blocklist never holds one. If rotating CONTACT_KEY changed
 * the hashing key, every blocklist entry would silently stop matching. This
 * way a rotation re-wraps one row, and it does so by itself: the first time
 * the secret opens only under CONTACT_KEY_PREVIOUS, it is re-wrapped under
 * the new key.
 *
 * Each value is AES-256-GCM under a random key of its own, stored beside it
 * wrapped. ERASING IS DELETING BOTH (X2): the row goes, and a backup holds a
 * wrapped key only until it rotates out.
 *
 * Nothing here reaches the seal or the chain, and the boundary check says so.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

type Db = Kysely<DB> | Transaction<DB>;

export interface LinkKeys {
  /** Wraps each value's own key. */
  wrap: Buffer;
  /** Matching keys (K11) and exact blocklist entries (K13). */
  match: Buffer;
  /** Domain blocklist entries, under a label of their own. */
  domain: Buffer;
  /** The keyed digest of an entry's email, for a subject access search. */
  email: Buffer;
}

const derive = (secret: Buffer, label: string) =>
  Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), label, 32));

function fromContactKey(key: string, name: string): Buffer {
  const secret = Buffer.from(key, 'base64');
  if (secret.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  // A label of its own: the report contact keys use 'reportlog contact …'.
  return derive(secret, 'reportlog link secret wrap v1');
}

// iv (12) | tag (16) | ciphertext, as contact details are kept.
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

function tryDecrypt(key: Buffer, sealed: Buffer): Buffer | null {
  try {
    return decrypt(key, sealed);
  } catch {
    return null;
  }
}

function keysFrom(secret: Buffer): LinkKeys {
  return {
    wrap: derive(secret, 'reportlog link wrap v1'),
    match: derive(secret, 'reportlog link match v1'),
    domain: derive(secret, 'reportlog link domain v1'),
    email: derive(secret, 'reportlog list email v1'),
  };
}

/**
 * The link keys, from the secret in `link_secrets`, made on first use.
 * `previousContactKey` only during a CONTACT_KEY rotation.
 */
export async function loadLinkKeys(
  db: Db,
  contactKey: string,
  previousContactKey?: string,
): Promise<LinkKeys> {
  const current = fromContactKey(contactKey, 'CONTACT_KEY');
  // Two processes starting at once both try; one row wins and both read it.
  await db
    .insertInto('link_secrets')
    .values({ id: 1, secret_wrapped: encrypt(current, randomBytes(32)) })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  const row = await db
    .selectFrom('link_secrets')
    .select('secret_wrapped')
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  const opened = tryDecrypt(current, row.secret_wrapped);
  if (opened) return keysFrom(opened);
  if (previousContactKey && previousContactKey !== contactKey) {
    const old = tryDecrypt(
      fromContactKey(previousContactKey, 'CONTACT_KEY_PREVIOUS'),
      row.secret_wrapped,
    );
    if (old) {
      await db
        .updateTable('link_secrets')
        .set({ secret_wrapped: encrypt(current, old) })
        .where('id', '=', 1)
        .execute();
      return keysFrom(old);
    }
  }
  throw new Error(
    'The link secret does not open under CONTACT_KEY. If CONTACT_KEY was changed, set the old one as CONTACT_KEY_PREVIOUS until the site has started once.',
  );
}

/**
 * Keys for whoever asks, loaded once per process. `null` when the site has
 * no CONTACT_KEY: then nothing that needs one is taken (lists/entries.ts).
 */
export function linkKeySource(
  db: Kysely<DB>,
  contactKey: string | undefined,
  previousContactKey?: string,
): (() => Promise<LinkKeys>) | null {
  if (!contactKey) return null;
  let loading: Promise<LinkKeys> | null = null;
  return () => {
    loading ??= loadLinkKeys(db, contactKey, previousContactKey).catch((e: unknown) => {
      loading = null;
      throw e;
    });
    return loading;
  };
}

/** A value under a key of its own. */
export function sealValue(keys: LinkKeys, plain: string): { enc: Buffer; key: Buffer } {
  const dek = randomBytes(32);
  return { enc: encrypt(dek, Buffer.from(plain, 'utf8')), key: encrypt(keys.wrap, dek) };
}

export function openValue(keys: LinkKeys, enc: Buffer, key: Buffer): string {
  return decrypt(decrypt(keys.wrap, key), enc).toString('utf8');
}

const hmac = (key: Buffer, text: string) =>
  createHmac('sha256', key).update(text, 'utf8').digest('hex');

/** The matching key of an address already normalized (normalize.ts). */
export const matchKey = (keys: LinkKeys, normalized: string) => hmac(keys.match, normalized);

/** A domain's blocklist hash. Lower-case, no trailing dot. */
export const domainHash = (keys: LinkKeys, domain: string) =>
  hmac(keys.domain, domain.toLowerCase().replace(/\.+$/, ''));

/** An entry's email digest. Normalized first, so case never splits a person in two. */
export const emailDigest = (keys: LinkKeys, email: string) =>
  hmac(keys.email, email.trim().toLowerCase());
