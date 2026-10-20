/**
 * The lists sweep (workstream E's `sweepLists`), run on its own timer.
 *
 * It ERASES the personal half of expired list entries, with their links,
 * removes spent erasure links, and leaves every entry's row standing. It is
 * not the credential sweep (sweep.ts), which DELETES rows, and the two are
 * never merged: a list table in that one's list would delete the choices
 * that are meant to stay.
 *
 * This is `pnpm --filter @reportlog/api lists:sweep` (lists/sweep-cli.ts)
 * called as a function, so the timer does not need pnpm on the server and
 * a failure reaches the doctor and the alert like any other job's.
 */
import { sweepLists } from '../lists/sweep.ts';
import type { JobContext, JobOutcome } from './context.ts';

export async function runListsSweep(ctx: JobContext): Promise<JobOutcome> {
  const out = await sweepLists(ctx.db);
  let failed = 0;
  let total = 0;
  for (const [table, result] of Object.entries(out)) {
    if (typeof result === 'number') {
      total += result;
      ctx.log(`${String(result).padStart(7)}  ${table}`);
    } else {
      failed += 1;
      ctx.log(`FAILED   ${table}: ${result.error}`);
    }
  }
  return failed
    ? { ok: false, summary: `${String(failed)} step(s) of the lists sweep failed.` }
    : {
        ok: true,
        summary: total
          ? `${String(total)} row(s) had something erased or removed.`
          : 'Nothing to erase.',
      };
}
