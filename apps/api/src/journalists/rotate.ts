/**
 * The contact-key rotation for the alert list's rows, run by
 * filing/rotateContactKey.ts inside its transaction, so a rotation moves
 * every address this site holds or none.
 */
import type { Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import {
  emailDigest,
  openWithDek,
  tryUnwrap,
  wrapDek,
  type ContactKeyring,
} from '../filing/contactKeys.ts';

/** Returns how many rows moved; throws a plain Error if one opens under neither key. */
export async function rotateSubscriberKeys(
  trx: Transaction<DB>,
  next: ContactKeyring,
  prev: ContactKeyring,
): Promise<number> {
  const rows = await trx
    .selectFrom('journalist_subscribers')
    .select(['id', 'dek_wrapped', 'email_enc', 'email_hmac'])
    .orderBy('id')
    .forUpdate()
    .execute();
  let moved = 0;
  for (const row of rows) {
    if (tryUnwrap(next.wrapKey, row.dek_wrapped)) continue;
    const dek = tryUnwrap(prev.wrapKey, row.dek_wrapped);
    if (!dek)
      throw new Error('A subscriber key opens under neither CONTACT_KEY nor CONTACT_KEY_PREVIOUS.');
    if (emailDigest(prev, openWithDek(dek, row.email_enc)) !== row.email_hmac) {
      throw new Error('A subscriber address digest does not match under the previous key.');
    }
    await trx
      .updateTable('journalist_subscribers')
      .set({
        dek_wrapped: wrapDek(next.wrapKey, dek),
        email_hmac: emailDigest(next, openWithDek(dek, row.email_enc)),
      })
      .where('id', '=', row.id)
      .execute();
    moved += 1;
  }
  return moved;
}
