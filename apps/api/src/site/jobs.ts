/**
 * The three email jobs as the operations job runner calls them
 * (apps/api/src/jobs/registry.ts): `reportlog ops run digest-hourly`,
 * `digest-weekly` and `feedback-digest`, each on its own timer.
 *
 * The digests are NOT given the runner's clock: they read the database's,
 * because `report_heads.updated_at` was written by it (see digest.ts).
 */
import type { JobContext, JobOutcome } from '../jobs/context.ts';
import { runFeedbackDigest } from '../feedback/digest.ts';
import { runDigest } from './digest.ts';

const deps = (ctx: JobContext) => ({
  db: ctx.db,
  mailer: ctx.mailer,
  siteOrigin: ctx.config.SITE_ORIGIN,
  log: ctx.log,
});

export const runHourlyDigest = (ctx: JobContext): Promise<JobOutcome> =>
  runDigest({ ...deps(ctx), frequency: 'hourly' });

export const runWeeklyDigest = (ctx: JobContext): Promise<JobOutcome> =>
  runDigest({ ...deps(ctx), frequency: 'weekly' });

export const runFeedbackDigestJob = (ctx: JobContext): Promise<JobOutcome> =>
  runFeedbackDigest({ ...deps(ctx), now: ctx.now, adminEmail: ctx.config.ADMIN_EMAIL });
