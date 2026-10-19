/**
 * Envelope encryption, one key per file.
 *
 * Every file gets a random 256-bit key (its DEK) the moment its bytes arrive.
 * The file, everything derived from it (the re-encoded copy, a video's still,
 * a document's page images) and the metadata stripped out of it are all
 * encrypted under that one key. The key itself is stored only wrapped, under
 * the deployment's FILES_KEY, in ONE place at a time: the upload slot while
 * the file is staged, then attachment_heads once it belongs to a report.
 *
 * WHY ONE KEY PER FILE. Destroying a single wrapped key erases exactly that
 * file, everywhere it is stored (backups of the bucket included, which hold
 * only ciphertext), while its SHA-256 in the sealed manifest and the daily
 * anchor over it stay intact. An append-only archive can honour an erasure
 * that way without it ever looking like tampering.
 *
 * FILES_KEY IS NOT CONTACT_KEY. The media worker needs this key and parses
 * hostile files; it must not also hold the key to every reporter's address.
 *
 * THE OBJECT FORMAT: "RLF1" || iv (12) || ciphertext || tag (16), AES-256-GCM.
 * The tag goes last so a file can be encrypted as it streams, and the output
 * size is known before the first byte (input + 32), which is what an S3 PUT
 * needs. Decrypting holds back the last 16 bytes and checks the tag at the
 * end: a truncated or altered object makes the stream fail rather than end.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { DecipherGCM } from 'node:crypto';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';

const MAGIC = Buffer.from('RLF1', 'latin1');
const IV = 12;
const TAG = 16;
export const OVERHEAD = MAGIC.length + IV + TAG;
const WRAP_AAD = Buffer.from('reportlog file key v1', 'utf8');

export interface FilesKeyring {
  wrap(dek: Buffer): Buffer;
  unwrap(wrapped: Buffer): Buffer;
  /** A keyed digest of an address, for the staging quota only. */
  quotaDigest(email: string): string;
}

export function filesKeyring(filesKey: string): FilesKeyring {
  const master = Buffer.from(filesKey, 'base64');
  if (master.length !== 32) throw new Error('FILES_KEY is 32 random bytes, base64');
  const derive = (info: string) =>
    Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  const wrapKey = derive('reportlog files: key wrapping');
  const quotaKey = derive('reportlog files: staging quota');
  return {
    wrap(dek) {
      const iv = randomBytes(IV);
      const c = createCipheriv('aes-256-gcm', wrapKey, iv);
      c.setAAD(WRAP_AAD);
      return Buffer.concat([iv, c.update(dek), c.final(), c.getAuthTag()]);
    },
    unwrap(wrapped) {
      const d = createDecipheriv('aes-256-gcm', wrapKey, wrapped.subarray(0, IV));
      d.setAAD(WRAP_AAD);
      d.setAuthTag(wrapped.subarray(wrapped.length - TAG));
      return Buffer.concat([d.update(wrapped.subarray(IV, wrapped.length - TAG)), d.final()]);
    },
    quotaDigest(email) {
      return createHmac('sha256', quotaKey)
        .update(email.trim().toLowerCase(), 'utf8')
        .digest('hex');
    },
  };
}

export const newDek = (): Buffer => randomBytes(32);

/** Encrypt as the bytes go by. Output is exactly input + OVERHEAD bytes. */
export function encryptStream(dek: Buffer): Transform {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([MAGIC, iv]));
      }
      done(null, cipher.update(chunk));
    },
    flush(done: TransformCallback) {
      if (!started) this.push(Buffer.concat([MAGIC, iv]));
      const last = cipher.final();
      done(null, Buffer.concat([last, cipher.getAuthTag()]));
    },
  });
}

/** Decrypt as the bytes go by; fails at the end if anything was altered. */
export function decryptStream(dek: Buffer): Transform {
  let head = Buffer.alloc(0);
  let decipher: DecipherGCM | null = null;
  let held = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      if (!decipher) {
        head = Buffer.concat([head, chunk]);
        if (head.length < MAGIC.length + IV) {
          done();
          return;
        }
        if (!head.subarray(0, MAGIC.length).equals(MAGIC)) {
          done(new Error('not an encrypted file object'));
          return;
        }
        decipher = createDecipheriv(
          'aes-256-gcm',
          dek,
          head.subarray(MAGIC.length, MAGIC.length + IV),
        );
        chunk = head.subarray(MAGIC.length + IV);
      }
      held = Buffer.concat([held, chunk]);
      if (held.length <= TAG) {
        done();
        return;
      }
      const out = held.subarray(0, held.length - TAG);
      held = Buffer.from(held.subarray(held.length - TAG));
      done(null, decipher.update(out));
    },
    flush(done: TransformCallback) {
      if (!decipher || held.length !== TAG) {
        done(new Error('an encrypted file object was cut short'));
        return;
      }
      try {
        decipher.setAuthTag(held);
        done(null, decipher.final());
      } catch {
        done(
          new Error('an encrypted file object does not match its key: altered, or the wrong key'),
        );
      }
    },
  });
}

export function encryptBuffer(dek: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  return Buffer.concat([MAGIC, iv, c.update(plain), c.final(), c.getAuthTag()]);
}

export function decryptBuffer(dek: Buffer, packed: Buffer): Buffer {
  if (!packed.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('not an encrypted file object');
  const d = createDecipheriv('aes-256-gcm', dek, packed.subarray(MAGIC.length, MAGIC.length + IV));
  d.setAuthTag(packed.subarray(packed.length - TAG));
  return Buffer.concat([
    d.update(packed.subarray(MAGIC.length + IV, packed.length - TAG)),
    d.final(),
  ]);
}
