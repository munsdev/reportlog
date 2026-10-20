/** The alert as the job runner calls it (apps/api/src/jobs/registry.ts). */
import type { JobContext, JobOutcome } from '../jobs/context.ts';
import { runJournalistAlerts } from './alerts.ts';

export const runAlertsJob = (ctx: JobContext): Promise<JobOutcome> =>
  runJournalistAlerts({
    db: ctx.db,
    mailer: ctx.mailer,
    siteOrigin: ctx.config.SITE_ORIGIN,
    log: ctx.log,
    now: ctx.now,
    contactKey: ctx.config.CONTACT_KEY,
    previousContactKey: ctx.config.CONTACT_KEY_PREVIOUS,
  });
