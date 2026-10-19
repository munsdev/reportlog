/**
 * Stopping the digest emails from the email itself, without signing in.
 *
 * Every digest email carries a link made for it. The link is a credential
 * (whoever holds it can stop somebody's email), so it is random, travels
 * once, and is stored only as a hash.
 *
 * OPENING THE LINK CHANGES NOTHING. Mail scanners and link previews open
 * every link in a message, and an unsubscribe that fired on GET would stop
 * people's email without their asking. The page says what would stop and
 * offers a button; only the button's POST stops it.
 *
 * IN FRONT OF THE SITE PASSWORD (gate.ts). Stopping email somebody asked for
 * must never depend on remembering a password, and the page shows nothing of
 * the site: an address, partly hidden, and how often the emails come.
 *
 * An unknown link and an expired one get the same answer, so the page cannot
 * be used to learn whose address has a subscription.
 */
import type { DigestStop } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { randomToken, sha256Hex } from './secrets.ts';

/** Long enough that an old email still works for somebody who reads late. */
export const STOP_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const TOKEN = /^[a-f0-9]{64}$/;

/** "c•••@example.org": enough to tell two of your own addresses apart. */
export function partlyHidden(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** A new stop link for one person's next digest email. Call it once per email. */
export async function stopLinkFor(
  db: Kysely<DB>,
  userId: number,
  siteOrigin: string,
): Promise<string> {
  const token = randomToken();
  await db
    .insertInto('digest_stop_links')
    .values({
      token_hash: sha256Hex(token),
      user_id: userId,
      expires_at: new Date(Date.now() + STOP_LINK_TTL_MS),
    })
    .execute();
  return `${siteOrigin}/notifications/stop/${token}`;
}

async function linkOf(db: Kysely<DB>, token: string) {
  if (!TOKEN.test(token)) return null;
  return db
    .selectFrom('digest_stop_links as l')
    .innerJoin('users as u', 'u.id', 'l.user_id')
    .leftJoin('digest_subscriptions as s', 's.user_id', 'l.user_id')
    .select(['l.token_hash', 'l.user_id', 'u.email', 's.frequency'])
    .where('l.token_hash', '=', sha256Hex(token))
    .where('l.expires_at', '>', new Date())
    .executeTakeFirst();
}

function stateOf(row: { email: string; frequency: string | null }): DigestStop {
  const address = partlyHidden(row.email);
  if (row.frequency === 'hourly' || row.frequency === 'weekly') {
    return { state: 'subscribed', address, frequency: row.frequency };
  }
  return { state: 'stopped', address };
}

/** What the link would stop. Reads only. */
export async function describeStop(db: Kysely<DB>, token: string): Promise<DigestStop> {
  const row = await linkOf(db, token);
  return row ? stateOf(row) : { state: 'gone' };
}

/**
 * Stop the emails. Every digest, from every logbook: the person can choose
 * again, more narrowly, after signing in. Using a link twice is harmless.
 */
export async function applyStop(db: Kysely<DB>, token: string): Promise<DigestStop> {
  return db.transaction().execute(async (trx) => {
    const row = await linkOf(trx, token);
    if (!row) return { state: 'gone' } as const;
    await trx.deleteFrom('digest_subscriptions').where('user_id', '=', row.user_id).execute();
    await trx
      .updateTable('digest_stop_links')
      .set({ used_at: new Date() })
      .where('token_hash', '=', row.token_hash)
      .where('used_at', 'is', null)
      .execute();
    return { state: 'stopped', address: partlyHidden(row.email) } as const;
  });
}
