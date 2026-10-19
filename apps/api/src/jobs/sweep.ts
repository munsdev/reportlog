/**
 * The credential sweep: DELETES whole rows that expired, from tables named
 * below and nowhere else.
 *
 * THERE ARE TWO SWEEPS AND THEY DO DIFFERENT THINGS. This one deletes
 * expired credentials: sign-in codes, sessions, confirmation links, site
 * password tokens. Every one of them is checked against its own `expires_at`
 * when it is used, so an expired row has never been accepted, and this is
 * not a security fix. It stops the tables growing forever with dead
 * credentials, which is a thing to hand anybody who gets a copy of the
 * database, and a thing to explain to anybody asking what is kept and for
 * how long.
 *
 * The other sweep (`lists-sweep`, workstream E, `apps/api/src/lists/`)
 * ERASES the personal half of expired list entries and leaves the row
 * standing, because a list entry's links are the half that stays. A list
 * table must never appear here: this would delete the row. The test suite
 * refuses one.
 *
 * NAMED, NEVER DISCOVERED. A list is reviewable; a scan for an `expires_at`
 * column is a rule nobody reads that quietly picks up whatever matches it
 * next. The database test makes the opposite mistake impossible too: a new
 * table WITH an `expires_at` column fails the suite until somebody decides,
 * in this file, whether it is swept.
 *
 * None of these tables is created by this workstream. Their owners create
 * them; until they exist, the sweep says so and moves on.
 */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type { JobContext, JobOutcome } from './context.ts';

/** Expired credentials: deleted whole once past `expires_at`. */
export const SWEPT: readonly { table: string; what: string; owner: string }[] = [
  { table: 'otp_codes', what: 'one-time sign-in codes', owner: 'A' },
  { table: 'sessions', what: 'sessions', owner: 'A' },
  { table: 'report_submission_tokens', what: 'report confirmation links', owner: 'C' },
  { table: 'site_access_tokens', what: 'site password tokens', owner: 'A' },
];

/**
 * Tables that have an `expires_at` column and are deliberately NOT swept,
 * each with the reason. The database test fails on a table with that column
 * that is in neither list.
 */
export const NOT_SWEPT: readonly { table: string; why: string }[] = [];

export type SweepResult = Record<string, number | 'absent' | { error: string }>;

/**
 * One statement per table, each on its own. One locked or broken table must
 * not stop the others being tidied, and there is nothing to keep consistent
 * between them.
 */
export async function sweepExpired(
  db: Database,
  tables: readonly { table: string }[] = SWEPT,
): Promise<SweepResult> {
  const result: SweepResult = {};
  for (const { table } of tables) {
    try {
      const exists = await sql<{
        r: string | null;
      }>`SELECT to_regclass(${`public.${table}`})::text AS r`
        .execute(db)
        .then((q) => q.rows[0]?.r != null);
      if (!exists) {
        result[table] = 'absent';
        continue;
      }
      const deleted = await sql`DELETE FROM ${sql.table(table)} WHERE expires_at < now()`.execute(
        db,
      );
      result[table] = Number(deleted.numAffectedRows ?? 0);
    } catch (err) {
      result[table] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return result;
}

export async function runSweep(ctx: JobContext): Promise<JobOutcome> {
  const result = await sweepExpired(ctx.db);
  let total = 0;
  let failed = 0;
  for (const { table, what, owner } of SWEPT) {
    const r = result[table];
    if (typeof r === 'number') {
      total += r;
      ctx.log(`${String(r).padStart(7)}  ${what} (${table})`);
    } else if (r === 'absent') {
      ctx.log(`      -  ${what}: table ${table} does not exist yet (workstream ${owner})`);
    } else if (r) {
      failed += 1;
      ctx.log(`FAILED   ${what} (${table}): ${r.error}`);
    }
  }
  return failed
    ? {
        ok: false,
        summary: `${String(failed)} table(s) could not be swept; ${String(total)} row(s) deleted from the rest.`,
      }
    : {
        ok: true,
        summary: total ? `${String(total)} expired row(s) deleted.` : 'Nothing had expired.',
      };
}
