/**
 * Reading and writing the one row of site settings and the page wording.
 *
 * No cache, unlike legacy's thirty-second one: it is a single-row read by
 * primary key, and an operator who has just corrected their privacy policy
 * should not find the old one still being served.
 */
import { DEFAULT_LOOK } from '@reportlog/contracts';
import type { Look } from '@reportlog/contracts';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type { CopyRow } from './copy.ts';

export interface SettingsRow {
  site_name: string | null;
  palette: string;
  theme: string;
  impressum_text: string | null;
  privacy_text: string | null;
  /** As stored: read it through `resolveHomeSections`. */
  home_sections: unknown;
}

const EMPTY: SettingsRow = {
  site_name: null,
  palette: DEFAULT_LOOK.palette,
  theme: DEFAULT_LOOK.theme,
  impressum_text: null,
  privacy_text: null,
  home_sections: null,
};

/**
 * The row, or the shipped values if it is somehow missing. The migration
 * inserts it, so a missing row means somebody deleted it; the site still
 * comes up in its default look rather than failing every page.
 */
export async function readSettings(db: Database): Promise<SettingsRow> {
  const row = await db
    .selectFrom('site_settings')
    .select(['site_name', 'palette', 'theme', 'impressum_text', 'privacy_text', 'home_sections'])
    .where('id', '=', true)
    .executeTakeFirst();
  return row ?? EMPTY;
}

export async function readCopy(db: Database): Promise<CopyRow[]> {
  return db.selectFrom('site_copy').select(['key', 'body', 'updated_at']).execute();
}

type Writable = Partial<{
  site_name: string | null;
  palette: Look['palette'];
  theme: Look['theme'];
  impressum_text: string | null;
  privacy_text: string | null;
  /** Written whole, already resolved (`resolveHomeSections`), as JSON text. */
  home_sections: string;
}>;

/** Upserts, so a deleted row comes back rather than every write silently doing nothing. */
export async function writeSettings(db: Database, values: Writable): Promise<void> {
  await db
    .insertInto('site_settings')
    .values({ id: true, ...values })
    .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, updated_at: sql`now()` }))
    .execute();
}

/** Null removes the row, which is "use what ships". */
export async function writeCopy(db: Database, key: string, body: string | null): Promise<void> {
  if (body === null) {
    await db.deleteFrom('site_copy').where('key', '=', key).execute();
    return;
  }
  await db
    .insertInto('site_copy')
    .values({ key, body })
    .onConflict((oc) => oc.column('key').doUpdateSet({ body, updated_at: sql`now()` }))
    .execute();
}
