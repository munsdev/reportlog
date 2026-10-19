/**
 * Erasure on request, for a format with no accounts.
 *
 * An entry has no login, so the only thing that can prove somebody owns one
 * is a secret mailed to the address on it. THE TOKEN IS STORED HASHED: a copy
 * of the table lets nobody erase other people's entries.
 *
 * A PATH THAT ONLY RUNS WHEN SOMEBODY CLICKS A LINK IN AN EMAIL IS A PATH
 * NOTHING REACHES BY ACCIDENT. Report confirmation was once broken in
 * production for three days under three green suites for exactly that reason.
 * This one is aimed at deliberately: a database test, a route test, and a
 * browser test that follows the link out of the email.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { ERASABLE_COLUMNS } from './policy.ts';
import { erasureExpiry } from './retention.ts';
import type { Db } from './rows.ts';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

export const hashToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** 32 random bytes, URL-safe. What a link carries; never stored. */
export const newToken = () => randomBytes(32).toString('base64url');

/** Mint a link. Returns the PLAINTEXT token, for the email, and only now. */
export async function mintErasureToken(
  db: Db,
  { entryId, personalExpiresAt }: { entryId: number; personalExpiresAt: Date | null },
  { now = new Date(), linkDays }: { now?: Date; linkDays?: number } = {},
): Promise<string> {
  const token = newToken();
  await db
    .insertInto('list_erasures')
    .values({
      token_hash: hashToken(token),
      entry_id: entryId,
      expires_at: erasureExpiry(personalExpiresAt, now, linkDays),
    })
    .execute();
  return token;
}

/**
 * Blank the erasable columns and mark the entry erased, in ONE statement, so
 * there is no moment in which `erased_at` is set and the columns are not. The
 * table's CHECK would refuse that anyway; it is the backstop, not the plan.
 */
export async function erasePersonal(db: Db, entryId: number): Promise<number> {
  const out = await db
    .updateTable('list_entries')
    .set({ ...blanks(), erased_at: sql<Date>`now()` })
    .where('id', '=', entryId)
    .where('erased_at', 'is', null)
    .executeTakeFirst();
  return Number(out.numUpdatedRows);
}

/** The columns an erasure blanks, from the one list of them. */
export function blanks(): Record<(typeof ERASABLE_COLUMNS)[number], null> {
  return Object.fromEntries(ERASABLE_COLUMNS.map((c) => [c, null])) as Record<
    (typeof ERASABLE_COLUMNS)[number],
    null
  >;
}

/**
 * Redeem a link: erase the erasable half IN PLACE and leave the row standing.
 * The links stay; the words and the address go.
 *
 * Unknown, expired and already used all answer the same, on purpose: somebody
 * probing tokens learns nothing from which it was.
 */
export async function redeemErasureToken(
  db: Db,
  token: string | null | undefined,
): Promise<{ ok: true; entryId: number } | { ok: false }> {
  if (!token || !TOKEN_PATTERN.test(token)) return { ok: false };
  const hash = hashToken(token);
  return db.transaction().execute(async (trx) => {
    // Spent in the same statement that finds it, so two clicks at once spend
    // it once.
    const row = await trx
      .updateTable('list_erasures')
      .set({ used_at: sql<Date>`now()` })
      .where('token_hash', '=', hash)
      .where('used_at', 'is', null)
      .where('expires_at', '>', sql<Date>`now()`)
      .returning('entry_id')
      .executeTakeFirst();
    if (!row) return { ok: false as const };
    await erasePersonal(trx, row.entry_id);
    return { ok: true as const, entryId: row.entry_id };
  });
}
