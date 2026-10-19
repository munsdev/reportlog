/**
 * What a scheduled job is given, and what it hands back.
 *
 * A job never reads `process.env`, never opens its own database pool and
 * never builds its own mailer: the runner does each once, so a job can
 * be tested with a throwaway database and the capture sender.
 */
import type { Config } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { Mailer } from '../email/mailer.ts';

export interface JobContext {
  config: Config;
  db: Database;
  mailer: Mailer;
  /** A line for the journal. Never an email address, a token or a URL with one in it. */
  log: (line: string) => void;
  /** Whatever followed the job's name on the command line. */
  args: readonly string[];
  now: () => Date;
}

export interface JobOutcome {
  /** False makes the unit fail, which starts the alert and shows in the doctor. */
  ok: boolean;
  /** One line, for the journal and the alert. */
  summary: string;
}
