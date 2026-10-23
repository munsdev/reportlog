/**
 * The flood switches, and "publish as counts only" (Plan E, PE3).
 *
 *   pause intake   a moderator stops both doors that make NEW submissions:
 *                  the report form and the list (tip) form. The forms say
 *                  "Intake is paused" and a notice appears across the site.
 *                  Separate from the administrator's intake switch
 *                  (filing/intakeSwitch.ts), which closes a site's intake
 *                  for good and says nothing about why; a pause is flood
 *                  control, used in public, with its time.
 *   harder puzzle  the proof of work's difficulty. Stored here; the door's
 *                  check (session PE2) reads `puzzleLevel`.
 *   counts only    per logbook: its published reports are counted, never
 *                  shown one by one (board/published.ts, listedReportIds).
 *   small area     per logbook, while counts only: a place with fewer
 *                  published reports than this is sent without its count
 *                  (board/places.ts, countGuards). Session PE4.
 *
 * EVERY USE IS RECORDED, who and when, in site_switch_log (append-only), in
 * the same transaction as the change, and the log is public with its time
 * and never who (getSwitchLog). A switch the public cannot see being used is
 * one a flood's victims cannot audit.
 *
 * WHAT A PAUSE DOES NOT DO. It hides nothing already filed, stops no
 * moderation, and does not stop a reporter correcting or withdrawing what
 * they already filed, nor a confirmation link: those are about the record
 * the archive holds, not new submissions.
 *
 * A LEAF MODULE: the database and an error, nothing else. The list routes
 * call `refuseWhilePaused`, and lists/ may not reach the seal or the chain
 * even transitively (.dependency-cruiser.cjs).
 */
import { SMALL_AREA_DEFAULT, SMALL_AREA_FLOOR, SMALL_AREA_MAX } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';

export type PuzzleLevel = 'normal' | 'harder';
type SwitchName = 'pause_intake' | 'puzzle' | 'counts_only' | 'small_area';

/** What the forms and the site say when the operator wrote nothing. Operator copy. */
export const PAUSED_FALLBACK =
  'Intake is paused. The moderators have stopped taking new reports and tips for now, usually because of a flood of submissions. Everything already sent is safe. Please try again later.';

export async function intakePausedAt(db: Kysely<DB>): Promise<Date | null> {
  const row = await db
    .selectFrom('flood_settings')
    .select('intake_paused_at')
    .where('id', '=', true)
    .executeTakeFirst();
  return row?.intake_paused_at ?? null;
}

/** The notice, in the operator's words, or ours. */
export async function pausedNotice(db: Kysely<DB>): Promise<string> {
  const row = await db
    .selectFrom('site_copy')
    .select('body')
    .where('key', '=', 'intake_paused_notice')
    .executeTakeFirst();
  return row?.body.trim() ? row.body.trim() : PAUSED_FALLBACK;
}

export async function intakePause(db: Kysely<DB>) {
  const since = await intakePausedAt(db);
  return {
    paused: since !== null,
    since: since ? since.toISOString() : null,
    notice: await pausedNotice(db),
  };
}

/**
 * THE ONE GUARD each door that makes a new submission calls before it does
 * anything else: the report form (filing/routes.ts) and a list entry
 * (lists/routes.ts). 503, because the site is up and will take them again.
 */
export async function refuseWhilePaused(db: Kysely<DB>): Promise<void> {
  if ((await intakePausedAt(db)) === null) return;
  throw new HttpError(503, 'intake_paused', await pausedNotice(db));
}

/** What the proof of work asks. Session PE2 maps this to a difficulty. */
export async function puzzleLevel(db: Kysely<DB>): Promise<PuzzleLevel> {
  const row = await db
    .selectFrom('flood_settings')
    .select('puzzle_level')
    .where('id', '=', true)
    .executeTakeFirst();
  return row?.puzzle_level === 'harder' ? 'harder' : 'normal';
}

async function record(
  trx: Kysely<DB>,
  use: { switch: SwitchName; value: string; subject?: string; actor: string },
) {
  await trx
    .insertInto('site_switch_log')
    .values({
      switch: use.switch,
      value: use.value,
      subject: use.subject ?? null,
      actor_email: use.actor,
    })
    .execute();
}

/**
 * Pause or resume. Saying what it already is records nothing: the log is of
 * uses, and a second "pause" is not a second pause.
 *
 * Pausing and resuming ask for the second factor again, within 5 minutes
 * (docs/plan-e.md, "Step-up"): `stepUpGuard` on the route's scope in
 * moderation/floodRoutes.ts.
 */
export async function setIntakePaused(db: Kysely<DB>, paused: boolean, actor: string) {
  await db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('flood_settings')
      .select('intake_paused_at')
      .where('id', '=', true)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if ((row.intake_paused_at !== null) === paused) return;
    await trx
      .updateTable('flood_settings')
      .set({ intake_paused_at: paused ? new Date() : null, updated_at: new Date() })
      .where('id', '=', true)
      .execute();
    await record(trx, { switch: 'pause_intake', value: paused ? 'on' : 'off', actor });
  });
}

/** Step-up guarded at the route, as setIntakePaused. */
export async function setPuzzleLevel(db: Kysely<DB>, level: PuzzleLevel, actor: string) {
  await db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('flood_settings')
      .select('puzzle_level')
      .where('id', '=', true)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (row.puzzle_level === level) return;
    await trx
      .updateTable('flood_settings')
      .set({ puzzle_level: level, updated_at: new Date() })
      .where('id', '=', true)
      .execute();
    await record(trx, { switch: 'puzzle', value: level, actor });
  });
}

/** Every use, newest first. `by` is for staff; the public read drops it. */
export async function switchUses(db: Kysely<DB>, limit = 200) {
  const rows = await db
    .selectFrom('site_switch_log')
    .select(['switch', 'value', 'subject', 'actor_email', 'created_at'])
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    switch: r.switch as SwitchName,
    value: r.value,
    subject: r.subject,
    at: r.created_at.toISOString(),
    by: r.actor_email,
  }));
}

// ── counts only ─────────────────────────────────────────────────────────

export async function countsOnlyLogbooks(db: Kysely<DB>): Promise<Set<number>> {
  const rows = await db
    .selectFrom('logbook_publication')
    .select('logbook_id')
    .where('counts_only', '=', true)
    .execute();
  return new Set(rows.map((r) => r.logbook_id));
}

/** Set it; the change is a public switch use, naming the logbook. */
export async function setCountsOnly(
  db: Kysely<DB>,
  logbook: { id: number; slug: string },
  countsOnly: boolean,
  actor: string,
) {
  await db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('logbook_publication')
      .select('counts_only')
      .where('logbook_id', '=', logbook.id)
      .forUpdate()
      .executeTakeFirst();
    if ((row?.counts_only ?? false) === countsOnly) return;
    await trx
      .insertInto('logbook_publication')
      .values({ logbook_id: logbook.id, counts_only: countsOnly, set_by: actor })
      .onConflict((oc) =>
        oc
          .column('logbook_id')
          .doUpdateSet({ counts_only: countsOnly, set_by: actor, set_at: new Date() }),
      )
      .execute();
    await record(trx, {
      switch: 'counts_only',
      value: countsOnly ? 'on' : 'off',
      subject: logbook.slug,
      actor,
    });
  });
}

// ── the small-area threshold ────────────────────────────────────────────

/**
 * A stored threshold as it may be used: whole, and never under the floor,
 * whatever the row says. The database has the same CHECK; the one setting
 * whose wrong value is a disclosure is checked everywhere it is read, as
 * the heat maps' is (maps/aggregate.ts).
 */
export const clampSmallArea = (n: number | null | undefined) =>
  Math.max(SMALL_AREA_FLOOR, Math.trunc(n ?? SMALL_AREA_DEFAULT) || SMALL_AREA_DEFAULT);

/**
 * Each COUNTS-ONLY logbook, with its small-area threshold. A logbook
 * published as entries is not in it: its reports each show their own place,
 * so the threshold would protect nothing a reader cannot count by reading
 * (decisions 20 and 21).
 */
export async function smallAreaThresholds(db: Kysely<DB>): Promise<Map<number, number>> {
  const rows = await db
    .selectFrom('logbook_publication')
    .select(['logbook_id', 'small_area'])
    .where('counts_only', '=', true)
    .execute();
  return new Map(rows.map((r) => [r.logbook_id, clampSmallArea(r.small_area)]));
}

/** Every logbook's setting, counts only or not, for the administrator's screen. */
export async function smallAreaSettings(db: Kysely<DB>): Promise<Map<number, number>> {
  const rows = await db
    .selectFrom('logbook_publication')
    .select(['logbook_id', 'small_area'])
    .execute();
  return new Map(rows.map((r) => [r.logbook_id, clampSmallArea(r.small_area)]));
}

/** Set it; the change is a public switch use, naming the logbook and the new value. */
export async function setSmallArea(
  db: Kysely<DB>,
  logbook: { id: number; slug: string },
  value: unknown,
  actor: string,
): Promise<number> {
  const n = Number(value);
  if (!Number.isInteger(n) || n < SMALL_AREA_FLOOR || n > SMALL_AREA_MAX) {
    throw new HttpError(
      400,
      'small_area',
      `The threshold is a whole number of at least ${String(SMALL_AREA_FLOOR)} and at most ${SMALL_AREA_MAX.toLocaleString('en-US')}.`,
    );
  }
  await db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('logbook_publication')
      .select('small_area')
      .where('logbook_id', '=', logbook.id)
      .forUpdate()
      .executeTakeFirst();
    if ((row?.small_area ?? SMALL_AREA_DEFAULT) === n) return;
    await trx
      .insertInto('logbook_publication')
      // No row yet is "listed as entries": a threshold set ahead of time
      // does not switch counts only on.
      .values({ logbook_id: logbook.id, counts_only: false, small_area: n, set_by: actor })
      .onConflict((oc) =>
        oc.column('logbook_id').doUpdateSet({ small_area: n, set_by: actor, set_at: new Date() }),
      )
      .execute();
    await record(trx, { switch: 'small_area', value: String(n), subject: logbook.slug, actor });
  });
  return n;
}
