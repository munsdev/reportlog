/**
 * The "under active development" notice in the corner of every page.
 *
 * Stored as an EXPIRY (site_settings.dev_mode_until), never a boolean: a
 * notice left on by accident quietly trains testers to ignore it, which is
 * worse than never showing it. An expiry switches itself off. Every time is
 * the database's, so two servers with different clocks cannot disagree
 * about whether it is on.
 */
import type { DevMode } from '@reportlog/contracts';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Checked } from './result.ts';

export const DEV_MODE_HOURS = 6;
/** A week. Longer than that is not "a deploy is settling", it is a flag left on. */
export const MAX_DEV_MODE_HOURS = 168;

interface Row {
  until: Date | null;
  active: boolean;
}

function shape(row: Row | undefined): DevMode {
  const active = Boolean(row?.active && row.until);
  return {
    active,
    until: active && row?.until ? row.until.toISOString() : null,
    default_hours: DEV_MODE_HOURS,
    max_hours: MAX_DEV_MODE_HOURS,
  };
}

export async function getDevMode(db: Database): Promise<DevMode> {
  const row = await db
    .selectFrom('site_settings')
    .select([
      'dev_mode_until as until',
      sql<boolean>`coalesce(dev_mode_until > now(), false)`.as('active'),
    ])
    .where('id', '=', true)
    .executeTakeFirst();
  return shape(row);
}

/** Hours from now, or null to take it down. Refused outside (0, a week]. */
export function validateDevModeHours(hours: number | null): Checked<number | null> {
  if (hours === null) return { ok: true, value: null };
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_DEV_MODE_HOURS) {
    return {
      ok: false,
      error: `Choose between a few minutes and ${String(MAX_DEV_MODE_HOURS)} hours (a week).`,
    };
  }
  return { ok: true, value: hours };
}

export async function setDevMode(db: Database, hours: number | null): Promise<DevMode> {
  const row = await db
    .updateTable('site_settings')
    .set({
      dev_mode_until:
        hours === null ? null : sql<Date>`now() + (${hours}::numeric * interval '1 hour')`,
      updated_at: sql`now()`,
    })
    .where('id', '=', true)
    .returning([
      'dev_mode_until as until',
      sql<boolean>`coalesce(dev_mode_until > now(), false)`.as('active'),
    ])
    .executeTakeFirst();
  return shape(row);
}

export type Armed =
  | { armed: true; from: string; to: string }
  | { armed: false; reason: 'no-build' | 'no-settings-row' | 'first-start' | 'unchanged' };

/**
 * Called once as the server starts. A deploy unpacks a new release with
 * its commit in REVISION, so "the build changed since we last started" is
 * exactly "something just shipped", which is when testers should be told
 * things may move under them.
 *
 * Armed on the BUILD, not on every start, so a crash-restart loop does not
 * keep re-arming it. The first start with a build recorded has nothing to
 * compare with and arms nothing: it would be pretending a deploy just
 * happened. A checkout has no build and is left alone.
 */
export async function armDevModeOnDeploy(
  db: Database,
  build: string | undefined,
  hours = DEV_MODE_HOURS,
): Promise<Armed> {
  if (!build) return { armed: false, reason: 'no-build' };
  const row = await db
    .selectFrom('site_settings')
    .select('last_seen_build')
    .where('id', '=', true)
    .executeTakeFirst();
  if (!row) return { armed: false, reason: 'no-settings-row' };
  const previous = row.last_seen_build;
  if (previous === build) return { armed: false, reason: 'unchanged' };
  if (previous === null) {
    await db
      .updateTable('site_settings')
      .set({ last_seen_build: build, updated_at: sql`now()` })
      .where('id', '=', true)
      .execute();
    return { armed: false, reason: 'first-start' };
  }
  await db
    .updateTable('site_settings')
    .set({
      last_seen_build: build,
      // GREATEST, so a deploy never SHORTENS a window an administrator set.
      dev_mode_until: sql<Date>`greatest(coalesce(dev_mode_until, now()), now() + (${hours}::numeric * interval '1 hour'))`,
      updated_at: sql`now()`,
    })
    .where('id', '=', true)
    .execute();
  return { armed: true, from: previous, to: build };
}
