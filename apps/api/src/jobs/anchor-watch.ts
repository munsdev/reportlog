/**
 * Did the anchor run? Asked from outside the anchor, every morning.
 *
 * The anchor's own unit raises the alert when it runs and fails. It says
 * nothing when it never runs: a timer disabled by hand, a unit lost in a
 * deploy, a clock that skipped. The doctor would notice, but only when
 * somebody runs it. The old application missed six days of publication that
 * way, which is why it had `anchor-watch`; this is the same check, on its own
 * timer, so a silent anchor becomes a failed unit and an email.
 *
 * The check itself is workstream D2's `anchorDoctorCheck`, the same one the
 * doctor runs: the newest anchor's age, whether the last run refused or
 * published nothing, whether the log has anywhere to go. A warning (some
 * mirrors missed) is not a failure; the doctor shows it.
 */
import { anchorDoctorCheck } from '../anchor/job.ts';
import type { JobContext, JobOutcome } from './context.ts';

export async function runAnchorWatch(ctx: JobContext): Promise<JobOutcome> {
  const finding = await anchorDoctorCheck(ctx);
  return { ok: finding.status !== 'fail', summary: `${finding.status}: ${finding.detail}` };
}
