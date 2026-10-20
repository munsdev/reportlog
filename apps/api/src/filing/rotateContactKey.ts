/**
 * Rotating CONTACT_KEY: re-wrap every thread's own key under the new one and
 * re-compute every address digest, IN ONE TRANSACTION. Run by
 * `reportlog contact-key rotate` (apps/api/src/jobs/cli.ts) during the
 * two-key window described in contactKeys.ts; the whole procedure is in
 * deploy/README.md and docs/status/C2-filing.md.
 *
 * Row by row:
 *   - already opens under the new key: filed during the window. Left alone.
 *   - opens under the previous key: re-wrapped under the new one, and the
 *     new wrapping opened again and compared before anything is written.
 *     Its digest, if it has one, is checked against the address it was made
 *     from (decrypted with the thread's key) and re-computed under the new
 *     key. A coordinator's filing has no digest and is given none.
 *   - opens under neither: the operator has the wrong previous key. The
 *     whole rotation stops, and nothing has changed.
 *
 * An erased thread has no row here, and a rotation only updates rows that
 * exist, so an erased thread stays erased. The ciphertext in
 * report_contacts is never read for anything but a digest and never written.
 *
 * The database lets contact_keys be updated only inside a transaction that
 * recorded a rotation (migration 20261019185427_contact_key_rotation.sql),
 * so the record row is written first.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { rotateSubscriberKeys } from '../journalists/rotate.ts';
import { rewrapLinkSecret } from '../links/keys.ts';
import { fingerprint } from '../jobs/contact-key.ts';
import { emailDigest, keyringFrom, openWithDek, tryUnwrap, wrapDek } from './contactKeys.ts';

export interface RotationResult {
  rewrapped: number;
  already_current: number;
}

export class RotationError extends Error {
  override name = 'RotationError';
}

export async function rotateContactKey(
  db: Kysely<DB>,
  keys: { current: string; previous: string },
): Promise<RotationResult> {
  if (fingerprint(keys.current) === fingerprint(keys.previous)) {
    throw new RotationError(
      'CONTACT_KEY and CONTACT_KEY_PREVIOUS are the same key: there is nothing to rotate to.',
    );
  }
  const next = keyringFrom(keys.current);
  const prev = keyringFrom(keys.previous);

  return db.transaction().execute(async (trx) => {
    // Every key row, locked: an erasure that arrives now waits, and one that
    // came first has already taken its row away.
    const rows = await trx
      .selectFrom('contact_keys as k')
      .innerJoin('report_contacts as c', 'c.thread_id', 'k.thread_id')
      .select(['k.thread_id', 'k.dek_wrapped', 'k.email_hmac', 'c.contact_enc'])
      .orderBy('k.thread_id')
      .forUpdate('k')
      .execute();

    const pending: { thread_id: string; dek_wrapped: Buffer; email_hmac: string | null }[] = [];
    let current = 0;
    for (const row of rows) {
      if (tryUnwrap(next.wrapKey, row.dek_wrapped)) {
        current += 1;
        continue;
      }
      const dek = tryUnwrap(prev.wrapKey, row.dek_wrapped);
      if (!dek) {
        throw new RotationError(
          'A contact key opens under neither CONTACT_KEY nor CONTACT_KEY_PREVIOUS. ' +
            'CONTACT_KEY_PREVIOUS is probably not the key this archive was using. Nothing was changed.',
        );
      }
      const rewrapped = wrapDek(next.wrapKey, dek);
      const check = tryUnwrap(next.wrapKey, rewrapped);
      if (!check?.equals(dek)) throw new RotationError('A re-wrapped key did not open again.');
      let digest: string | null = null;
      if (row.email_hmac !== null) {
        const address = openWithDek(dek, row.contact_enc);
        if (emailDigest(prev, address) !== row.email_hmac) {
          throw new RotationError(
            'An address digest does not match its address under the previous key. Nothing was changed.',
          );
        }
        digest = emailDigest(next, address);
      }
      pending.push({ thread_id: row.thread_id, dek_wrapped: rewrapped, email_hmac: digest });
    }
    // The journalist alert list's addresses are under the same key (journalists/rotate.ts).
    const listed = await rotateSubscriberKeys(trx, next, prev).catch((e: unknown) => {
      throw new RotationError(
        `${e instanceof Error ? e.message : 'A subscriber key failed.'} Nothing was changed.`,
      );
    });
    // The tip links' secret, one row, under the same key (links/keys.ts).
    const linkSecret = await rewrapLinkSecret(trx, keys.current, keys.previous).catch(
      (e: unknown) => {
        throw new RotationError(
          `${e instanceof Error ? e.message : 'The link secret failed.'} Nothing was changed.`,
        );
      },
    );
    const moved = listed + linkSecret;
    if (!pending.length && !moved) return { rewrapped: 0, already_current: current };

    const record = await trx
      .insertInto('contact_key_rotations')
      .values({
        from_fingerprint: fingerprint(keys.previous),
        to_fingerprint: fingerprint(keys.current),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const p of pending) {
      await trx
        .updateTable('contact_keys')
        .set({ dek_wrapped: p.dek_wrapped, email_hmac: p.email_hmac })
        .where('thread_id', '=', p.thread_id)
        .execute();
    }
    await trx
      .updateTable('contact_key_rotations')
      .set({ rewrapped: pending.length + moved })
      .where('id', '=', record.id)
      .execute();
    return { rewrapped: pending.length + moved, already_current: current };
  });
}
