/**
 * One web address space. A logbook (/file/:slug) and a list (/list/:slug) are
 * also served at the root (/:slug), and a logbook may have a short address
 * there too (logbooks.short_slug). All of them share it: no address may be a
 * page the site already has, and no two things may share one.
 * Callers use this inside their own transaction.
 */
import { RESERVED_SLUGS } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export type SlugBlock = 'reserved' | 'taken-elsewhere';

/**
 * Why `slug` cannot be used for a `kind` of thing, or null. A list's own
 * duplicate is the caller's check (a unique column); for a logbook, pass its
 * own id when it is the one being changed, so it does not block itself.
 */
export async function slugBlock(
  db: Kysely<DB>,
  slug: string,
  kind: 'logbook' | 'list',
  ownLogbookId?: number,
): Promise<SlugBlock | null> {
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  if (kind === 'logbook') {
    const list = await db
      .selectFrom('lists')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (list) return 'taken-elsewhere';
  }
  let q = db
    .selectFrom('logbooks')
    .select('id')
    .where((eb) => eb.or([eb('slug', '=', slug), eb('short_slug', '=', slug)]));
  if (ownLogbookId !== undefined) q = q.where('id', '<>', ownLogbookId);
  return (await q.executeTakeFirst()) ? 'taken-elsewhere' : null;
}
