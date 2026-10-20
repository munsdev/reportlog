/**
 * Whether this deployment publishes an archive at all.
 *
 * A delivery setting, NOT in the sealed object. Two gates, and both must be
 * open for a report to be public:
 *
 *   `may_publish`  the reporter's answer, inside the fingerprint, permanent.
 *   this switch    the operator's answer, outside it, changeable any day.
 *
 * Neither substitutes for the other, and neither substitutes for a
 * moderator, who is still the only way anything becomes public at all.
 *
 * TRI-STATE. NULL (nobody chose) is ON, because that is what the software
 * does and a migration must not empty a running board.
 *
 * EVERY PUBLIC READ OF THE ARCHIVE ASKS THIS: the board, one report, the CSV,
 * the counts, the figures, and (once they exist) published files, published
 * chain files and maps. Not cached: it is one indexed row, and a switch that
 * takes half a minute to take effect is a switch somebody distrusts.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/** What a closed archive tells anybody who asks: true, and renderable. */
export const PUBLICATION_OFF = {
  published: false as const,
  reason: 'This site does not publish a public archive.',
};

export async function storedPublicArchive(db: Kysely<DB>): Promise<boolean | null> {
  const row = await db
    .selectFrom('moderation_settings')
    .select('public_archive_enabled')
    .where('id', '=', true)
    .executeTakeFirst();
  return row?.public_archive_enabled ?? null;
}

export async function publicArchiveAvailable(db: Kysely<DB>): Promise<boolean> {
  return (await storedPublicArchive(db)) !== false;
}

/** Null puts it back to "nobody chose", which is on. */
export async function setPublicArchive(
  db: Kysely<DB>,
  enabled: boolean | null,
  byEmail: string,
): Promise<void> {
  await db
    .updateTable('moderation_settings')
    .set({
      public_archive_enabled: enabled,
      public_archive_set_by: byEmail,
      updated_at: new Date(),
    })
    .where('id', '=', true)
    .execute();
}

// ── distribution ─────────────────────────────────────────────────────────

/**
 * THE DISTRIBUTION SWITCH (decision 11): whether the archive may also be
 * carried off in bulk, as the board's spreadsheet and the published chain
 * file. A second gate after the archive switch, never instead of it: with
 * the archive off nothing is distributed whatever this says.
 *
 * TRI-STATE, AND NULL IS OFF, the opposite of the archive switch: nothing
 * distributed before the switch existed, and nothing may start because a
 * migration ran.
 *
 * NOT asked by: the board's pages, one report, the counts and figures, the
 * consent wordings, the maps, published files (each is a moderator's
 * decision about one report), the daily snapshot in the transparency log
 * (the anchor's own record, which the integrity promise depends on), and
 * the owner's backups and archive export (the operator's own copy, not a
 * distribution).
 */
export const DISTRIBUTION_OFF =
  'This site does not offer its archive for download. Read it on the board.';

export async function storedDistribution(db: Kysely<DB>): Promise<boolean | null> {
  const row = await db
    .selectFrom('moderation_settings')
    .select('distribution_enabled')
    .where('id', '=', true)
    .executeTakeFirst();
  return row?.distribution_enabled ?? null;
}

/** Both gates: the archive is published AND an administrator said yes. */
export async function distributionAvailable(db: Kysely<DB>): Promise<boolean> {
  return (await publicArchiveAvailable(db)) && (await storedDistribution(db)) === true;
}

/** Null puts it back to "nobody chose", which is off. */
export async function setDistribution(
  db: Kysely<DB>,
  enabled: boolean | null,
  byEmail: string,
): Promise<void> {
  await db
    .updateTable('moderation_settings')
    .set({ distribution_enabled: enabled, distribution_set_by: byEmail, updated_at: new Date() })
    .where('id', '=', true)
    .execute();
}
