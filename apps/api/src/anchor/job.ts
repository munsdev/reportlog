/**
 * The anchor as a scheduled job, for workstream H's runner
 * (`reportlog-job@anchor.service`, started daily by `reportlog-anchor.timer`).
 *
 * Takes what H's runner gives every job and nothing else: no `process.env`,
 * no pool of its own. The shapes are written out here rather than imported so
 * this file does not depend on H's folder; they match `JobContext` and
 * `JobOutcome` in apps/api/src/jobs/context.ts.
 */
import type { Config } from '../config.ts';
import type { Database } from '../db/database.ts';
import { runAnchor } from './anchor.ts';
import type { AnchorResult } from './anchor.ts';
import { checkAnchor } from './health.ts';
import type { AnchorFinding } from './health.ts';
import type { LogSettings } from './translog.ts';

type AnchorConfig = Pick<
  Config,
  | 'TSA_URL'
  | 'TRANSPARENCY_LOG_DIR'
  | 'TRANSPARENCY_LOG_REMOTES'
  | 'TRANSPARENCY_LOG_BRANCH'
  | 'TRANSPARENCY_LOG_SSH_KEY'
  | 'TRANSPARENCY_LOG_AUTHOR_NAME'
  | 'TRANSPARENCY_LOG_AUTHOR_EMAIL'
  | 'ANCHOR_MAX_AGE_HOURS'
>;

export interface AnchorJobContext {
  config: AnchorConfig;
  db: Database;
  log: (line: string) => void;
  now: () => Date;
}

/** The log's settings from configuration, or a sentence saying what is missing. */
export function logSettingsFrom(config: AnchorConfig): LogSettings | string {
  if (!config.TRANSPARENCY_LOG_DIR) {
    return 'TRANSPARENCY_LOG_DIR is not set, so there is nowhere to write the transparency log. Nothing was anchored.';
  }
  return {
    dir: config.TRANSPARENCY_LOG_DIR,
    remotes: config.TRANSPARENCY_LOG_REMOTES,
    branch: config.TRANSPARENCY_LOG_BRANCH,
    sshKey: config.TRANSPARENCY_LOG_SSH_KEY,
    author: {
      name: config.TRANSPARENCY_LOG_AUTHOR_NAME,
      email: config.TRANSPARENCY_LOG_AUTHOR_EMAIL,
    },
  };
}

export async function anchorNow(ctx: AnchorJobContext): Promise<AnchorResult | string> {
  const settings = logSettingsFrom(ctx.config);
  if (typeof settings === 'string') return settings;
  return runAnchor({
    db: ctx.db,
    tsaUrl: ctx.config.TSA_URL,
    log: settings,
    now: ctx.now,
    say: ctx.log,
  });
}

/** H's registry: `run: (ctx) => import('../anchor/job.ts').then((m) => m.runAnchorJob(ctx))`. */
export async function runAnchorJob(
  ctx: AnchorJobContext,
): Promise<{ ok: boolean; summary: string }> {
  const out = await anchorNow(ctx);
  if (typeof out === 'string') return { ok: false, summary: out };
  // A partly published day is not a failed unit: the record is public, and
  // the laggard mirror catches up tomorrow. The doctor warns about it.
  return { ok: out.exitCode === 0, summary: out.detail };
}

/** For H's doctor: `findings.push(await anchorFinding(ctx))`. */
export function anchorDoctorCheck(
  ctx: Pick<AnchorJobContext, 'config' | 'db' | 'now'>,
): Promise<AnchorFinding> {
  return checkAnchor(ctx.db, {
    now: ctx.now(),
    maxAgeHours: ctx.config.ANCHOR_MAX_AGE_HOURS,
    remotes: ctx.config.TRANSPARENCY_LOG_REMOTES.length,
  });
}
