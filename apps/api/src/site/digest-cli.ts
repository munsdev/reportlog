/**
 * The email jobs, as commands for a timer:
 *
 *   pnpm --filter @reportlog/api digest hourly     reports published since each hourly subscriber's last email
 *   pnpm --filter @reportlog/api digest weekly     the same, for weekly subscribers
 *   pnpm --filter @reportlog/api digest feedback   every open feedback issue, to ADMIN_EMAIL
 *
 * Prints one line saying what happened and exits non-zero if anything
 * failed. The operations workstream's timers (reportlog-digest-hourly,
 * reportlog-digest-weekly, reportlog-feedback-digest) run these; its job
 * runner can call `runDigest` and `runFeedbackDigest` directly instead.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { outboxMailer, stderrMailer } from '../email/mailer.ts';
import { runFeedbackDigest } from '../feedback/digest.ts';
import { runDigest } from './digest.ts';
import type { JobOutcome } from './job.ts';

const which = process.argv[2];
if (which !== 'hourly' && which !== 'weekly' && which !== 'feedback') {
  process.stderr.write('Say which: digest hourly, digest weekly or digest feedback.\n');
  process.exit(2);
}

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL, 2);
const deps = {
  db,
  // Until the operations workstream wires a provider, as the server does.
  mailer: config.MAIL_OUTBOX ? outboxMailer(config.MAIL_OUTBOX) : stderrMailer(),
  siteOrigin: config.SITE_ORIGIN,
  log: (line: string) => process.stdout.write(`${line}\n`),
};
try {
  const out: JobOutcome =
    which === 'feedback'
      ? await runFeedbackDigest({ ...deps, adminEmail: config.ADMIN_EMAIL })
      : await runDigest({ ...deps, frequency: which });
  process.stdout.write(`${out.summary}\n`);
  process.exitCode = out.ok ? 0 : 1;
} finally {
  await db.destroy();
}
