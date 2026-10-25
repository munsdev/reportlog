/**
 * One web address space. A logbook (/file/:slug) and a list (/list/:slug) are
 * also served at the root (/:slug), so the two share it: no slug may be
 * a page the site already has, and no list may share one with a logbook.
 * Both creators call this inside their own transaction.
 */
import { RESERVED_SLUGS } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export type SlugBlock = 'reserved' | 'taken-elsewhere';

/** Why `slug` cannot be used, or null. Same-kind duplicates are the caller's own check. */
export async function slugBlock(
  db: Kysely<DB>,
  slug: string,
  kind: 'logbook' | 'list',
): Promise<SlugBlock | null> {
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  const other = await db
    .selectFrom(kind === 'logbook' ? 'lists' : 'logbooks')
    .select('id')
    .where('slug', '=', slug)
    .executeTakeFirst();
  return other ? 'taken-elsewhere' : null;
}
