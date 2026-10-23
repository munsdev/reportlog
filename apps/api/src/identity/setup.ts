/**
 * First-run setup: whether this deployment has been handed over yet.
 *
 * A fresh install has no owner and no curtain password. The wizard seats the
 * owner (proved by a one-time code to their address, which also proves mail
 * works) and then makes them decide about the curtain password. There is no
 * default and no skip on that last screen: a password somebody else chose
 * would otherwise stay live in a deployment that is no longer theirs.
 *
 * "Needs setup" is the flag alone, `setup_completed_at IS NULL`. It is NOT
 * also "has no owner": seating the owner is the second step of three, and a
 * wizard that ended itself there would refuse its own last screen. The owner
 * check matters only where seating one is concerned: it may happen once.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { siteAccessSettings } from './siteAccess.ts';

export async function setupState(db: Kysely<DB>): Promise<{ needed: boolean; hasOwner: boolean }> {
  const settings = await siteAccessSettings(db);
  const owner = await db
    .selectFrom('users')
    .select('id')
    .where(sql<boolean>`roles && ARRAY['owner', 'admin']::text[]`)
    .executeTakeFirst();
  return { needed: settings.setup_completed_at === null, hasOwner: Boolean(owner) };
}
