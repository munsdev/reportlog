/**
 * What the email jobs here (the hourly and weekly digests, the feedback
 * digest) are given and hand back.
 *
 * Narrower than the job runner's `JobContext` (apps/api/src/jobs/), so the
 * tests can call them without a whole configuration; `jobs.ts` beside this
 * file is where the runner's context is turned into these.
 */
import type { Database } from '../db/database.ts';
import type { Mailer } from '../email/mailer.ts';
export type { JobOutcome } from '../jobs/context.ts';

export interface EmailJobDeps {
  db: Database;
  mailer: Mailer;
  /** Where the website is, for the links in the emails. */
  siteOrigin: string;
  /** A line for the journal. Never an address, a token or a link with one in it. */
  log: (line: string) => void;
  now?: () => Date;
}
