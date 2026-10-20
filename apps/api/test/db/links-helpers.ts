/**
 * The link keys a test files and reads with: the same CONTACT_KEY the filing
 * tests use, so a test app built from filing-helpers reads what these wrote.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../../src/db/schema.gen.ts';
import { loadLinkKeys } from '../../src/links/keys.ts';
import type { LinkKeys } from '../../src/links/keys.ts';

export const LINK_CONTACT_KEY = Buffer.alloc(32, 7).toString('base64');

export const linkKeys = (db: Kysely<DB>): Promise<LinkKeys> => loadLinkKeys(db, LINK_CONTACT_KEY);
