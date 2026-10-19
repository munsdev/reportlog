/**
 * How often somebody hears about newly published reports, and from which
 * logbooks. No row is "no emails".
 *
 * Only a launched logbook can be followed. A draft has never been public,
 * and accepting its slug here would be a way to learn that it exists, so an
 * unknown slug and a draft's slug are refused with the same sentence.
 */
import { DIGEST_FREQUENCIES } from '@reportlog/contracts';
import type { DigestFrequency, Notifications } from '@reportlog/contracts';
import type { Database } from '../db/database.ts';
import { HttpError } from '../http/errors.ts';

const refused = (message: string) => new HttpError(400, 'refused', message);

const isFrequency = (v: string): v is DigestFrequency =>
  (DIGEST_FREQUENCIES as readonly string[]).includes(v);

async function followable(db: Database) {
  return db
    .selectFrom('logbooks')
    .select(['slug', 'title'])
    .where('launched_at', 'is not', null)
    .orderBy('title')
    .execute();
}

export async function notificationsFor(db: Database, userId: number): Promise<Notifications> {
  const [row, choices] = await Promise.all([
    db
      .selectFrom('digest_subscriptions')
      .select(['frequency', 'logbooks'])
      .where('user_id', '=', userId)
      .executeTakeFirst(),
    followable(db),
  ]);
  return {
    frequency: row && isFrequency(row.frequency) ? row.frequency : 'none',
    logbooks: row?.logbooks ?? null,
    choices,
  };
}

export async function setNotifications(
  db: Database,
  userId: number,
  input: { frequency: string; logbooks: string[] | null },
): Promise<Notifications> {
  const frequency = input.frequency;
  if (!isFrequency(frequency)) throw refused('Choose hourly, weekly, or no emails.');
  if (frequency === 'none') {
    await db.deleteFrom('digest_subscriptions').where('user_id', '=', userId).execute();
    return notificationsFor(db, userId);
  }
  // An empty list is every logbook, the same as no list.
  const wanted = input.logbooks?.length ? [...new Set(input.logbooks)] : null;
  if (wanted) {
    const known = new Set((await followable(db)).map((l) => l.slug));
    if (wanted.some((s) => !known.has(s))) {
      throw refused(
        'One of those is not a logbook you can follow. Reload the page and choose again.',
      );
    }
  }
  await db
    .insertInto('digest_subscriptions')
    .values({ user_id: userId, frequency, logbooks: wanted })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet({ frequency, logbooks: wanted, updated_at: new Date() }),
    )
    .execute();
  return notificationsFor(db, userId);
}
