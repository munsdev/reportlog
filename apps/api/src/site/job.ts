/**
 * What the email jobs here (the hourly and weekly digests, the feedback
 * digest) are given and hand back.
 *
 * Shaped to match the operations workstream's job runner (`JobOutcome` in
 * apps/api/src/jobs/context.ts on its branch): one line saying what
 * happened, and whether it worked. A job never reads `process.env` and never
 * opens its own database; whoever runs it passes both in.
 */
import type { Database } from '../db/database.ts';
import type { Mailer } from '../email/mailer.ts';

export interface EmailJobDeps {
  db: Database;
  mailer: Mailer;
  /** Where the website is, for the links in the emails. */
  siteOrigin: string;
  /** A line for the journal. Never an address, a token or a link with one in it. */
  log: (line: string) => void;
  now?: () => Date;
}

export interface JobOutcome {
  ok: boolean;
  summary: string;
}
