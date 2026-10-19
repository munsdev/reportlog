/**
 * Every scheduled job, in one list.
 *
 * Each job here has a timer in `deploy/systemd/reportlog-<name>.timer` that
 * starts `reportlog-job@<name>.service`, and a unit test fails if the two
 * disagree on what exists or when it runs. So a job is added by adding an
 * entry here and its timer there, and the next deploy installs it.
 *
 * SLOTS. Some jobs belong to other workstreams and are not built yet. They
 * are listed now, with their schedule and their timer, so that the day the
 * work lands nothing about scheduling has to be remembered: the owner
 * replaces `run: undefined` with their function, in one line. Until then the
 * timer fires, the job says it is not built yet, and the doctor reports it.
 * (The old application shipped two features whose timers nobody installed;
 * nobody was told for months.)
 */
import type { JobContext, JobOutcome } from './context.ts';

export interface JobDefinition {
  name: string;
  /** One sentence, for `reportlog jobs` and the doctor. */
  what: string;
  /** Which workstream builds it (docs/workstreams.md). */
  owner: string;
  /** systemd OnCalendar=, in the server's time zone (UTC). */
  onCalendar: string;
  /** Spread over this many seconds, so deployments do not all fire at once. */
  randomizedDelaySec: number;
  /**
   * Run at boot if the machine was off when it was due. Yes for anything
   * daily: a skipped backup or anchor is a day lost. No for the hourly
   * digest, which measures its window from each subscriber's last send.
   */
  persistent: boolean;
  run: ((ctx: JobContext) => Promise<JobOutcome>) | undefined;
}

export const JOBS: readonly JobDefinition[] = [
  {
    name: 'backup',
    what: 'Dump the database, check the dump reads back, encrypt a copy and send it off the server.',
    owner: 'H',
    // First of the night: if the box falls over during the scheduled work,
    // the backup is what you want to have finished already.
    onCalendar: '*-*-* 03:00:00',
    randomizedDelaySec: 600,
    persistent: true,
    run: (ctx) => import('./backup.ts').then((m) => m.runBackup(ctx)),
  },
  {
    name: 'sweep',
    what: 'Delete expired sign-in codes, sessions and links from the named credential tables.',
    owner: 'H',
    onCalendar: '*-*-* 03:30:00',
    randomizedDelaySec: 600,
    persistent: true,
    run: (ctx) => import('./sweep.ts').then((m) => m.runSweep(ctx)),
  },
  {
    // NOT the sweep above, and never merged into it. This one ERASES the
    // personal half of expired list entries and leaves the rows standing;
    // the sweep above DELETES whole rows. A list table in the sweep's list
    // would delete the links that are meant to stay.
    name: 'lists-sweep',
    what: 'Erase the personal half of expired list entries and the spent address-hashing secrets.',
    owner: 'E',
    onCalendar: '*-*-* 03:40:00',
    randomizedDelaySec: 600,
    persistent: true,
    run: (ctx) => import('./lists-sweep.ts').then((m) => m.runListsSweep(ctx)),
  },
  {
    name: 'anchor',
    what: "Timestamp the list of every logbook's chain head and publish it to the transparency log.",
    owner: 'D',
    onCalendar: '*-*-* 04:00:00',
    // Every deployment asks the same public timestamp authorities.
    randomizedDelaySec: 1200,
    persistent: true,
    run: (ctx) => import('../anchor/job.ts').then((m) => m.runAnchorJob(ctx)),
  },
  {
    // Every minute: a reporter's files are prepared between Send and the
    // click in their email. systemd never overlaps two passes.
    name: 'files',
    what: 'Re-encode and encrypt the files reporters sent, sweep abandoned ones, delete what was taken down.',
    owner: 'F',
    onCalendar: '*-*-* *:*:00',
    randomizedDelaySec: 0,
    persistent: false,
    run: (ctx) => import('../files/job.ts').then((m) => m.runFilesJob(ctx)),
  },
  {
    name: 'digest-hourly',
    what: 'Email hourly subscribers the reports published since their last digest.',
    owner: 'G',
    onCalendar: '*-*-* *:00:00',
    randomizedDelaySec: 120,
    persistent: false,
    run: (ctx) => import('../site/jobs.ts').then((m) => m.runHourlyDigest(ctx)),
  },
  {
    name: 'digest-weekly',
    what: 'Email weekly subscribers the reports published since their last digest.',
    owner: 'G',
    onCalendar: 'Mon *-*-* 07:00:00',
    randomizedDelaySec: 600,
    persistent: true,
    run: (ctx) => import('../site/jobs.ts').then((m) => m.runWeeklyDigest(ctx)),
  },
  {
    name: 'feedback-digest',
    what: 'Email the administrator every open feedback issue, oldest-untouched first.',
    owner: 'G',
    onCalendar: 'Mon *-*-* 08:00:00',
    randomizedDelaySec: 600,
    persistent: true,
    run: (ctx) => import('../site/jobs.ts').then((m) => m.runFeedbackDigestJob(ctx)),
  },
];

export function findJob(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}

/** The timer file for a job, exactly as `deploy/systemd/` must hold it. */
export function timerUnit(job: JobDefinition): string {
  return [
    `# Generated from apps/api/src/jobs/registry.ts. Edit the registry, then`,
    `# regenerate: pnpm --filter @reportlog/api ops timers --write`,
    `[Unit]`,
    `Description=ReportLog job timer: ${job.name}`,
    ``,
    `[Timer]`,
    `OnCalendar=${job.onCalendar}`,
    `RandomizedDelaySec=${String(job.randomizedDelaySec)}`,
    `Persistent=${job.persistent ? 'true' : 'false'}`,
    `Unit=reportlog-job@${job.name}.service`,
    ``,
    `[Install]`,
    `WantedBy=timers.target`,
    ``,
  ].join('\n');
}
