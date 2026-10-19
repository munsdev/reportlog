/**
 * The media worker as a scheduled job (workstream H's runner): one pass,
 * every minute, from `reportlog-files.timer`.
 *
 * A minute is soon enough: a reporter confirms from an email, and confirming
 * waits for files still being prepared. systemd never starts a second pass
 * while one is running, so a long video holds the next pass back rather than
 * doubling the work. `files:worker` (worker-cli.ts) is the same pass in a
 * loop, for a machine that wants it sooner.
 */
import type { JobContext, JobOutcome } from '../jobs/context.ts';
import { filesFrom } from './context.ts';
import { workOnce } from './worker.ts';

export async function runFilesJob(ctx: JobContext): Promise<JobOutcome> {
  const files = filesFrom(ctx.db, ctx.config);
  // Not taking files is a choice an operator may make: nothing to do is not a failure.
  if (typeof files === 'string')
    return { ok: true, summary: `Files are not taken here (${files}).` };
  const pass = await workOnce(files, { log: { info: ctx.log, warn: ctx.log } });
  const done = Object.entries(pass.processed)
    .map(([outcome, n]) => `${String(n)} ${outcome}`)
    .join(', ');
  return {
    // A file the worker could not finish is put back and tried again; only a
    // pass that could not run at all is a failure.
    ok: true,
    summary:
      done || pass.swept || pass.deleted
        ? `Files: ${done || 'none processed'}; ${String(pass.swept)} abandoned swept; ${String(pass.deleted)} object(s) deleted.`
        : 'Nothing to do.',
  };
}
