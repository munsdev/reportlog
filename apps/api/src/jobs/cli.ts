/**
 * The operations command line. On a server it is reached through
 * `sudo reportlog …` (deploy/bin/reportlog), which runs it as the service
 * user with the server's settings; in a checkout through
 * `pnpm --filter @reportlog/api ops …`.
 *
 *   run <job> [args]     run one scheduled job (what each timer does)
 *   jobs                 list the jobs and their schedules
 *   doctor [--server]    check this deployment
 *   mail-test <address>  send one real message
 *   alert <unit>         email OPS_ALERT_EMAIL that a unit failed
 *   timers --write       regenerate deploy/systemd/*.timer from the registry
 *   timers --check       fail if they differ (also a unit test)
 *
 * Exit codes: 0 fine, 1 something failed, 2 used wrongly.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { createEmailSender } from '../email/index.ts';
import { mailTest } from '../email/mail-test.ts';
import { CODE_ROOT } from './backup.ts';
import { diagnose, render, SERVER_MARKER } from './doctor.ts';
import { exitCode } from './doctor-checks.ts';
import { findJob, JOBS, timerUnit } from './registry.ts';

const [command = 'help', ...rest] = process.argv.slice(2);

function config(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function main(): Promise<number> {
  switch (command) {
    case 'run':
      return runJob(rest[0], rest.slice(1));
    case 'jobs':
      for (const j of JOBS) {
        const state = j.run ? '' : `   [not built yet: workstream ${j.owner}]`;
        console.log(`${j.name.padEnd(16)} ${j.onCalendar.padEnd(20)} ${j.what}${state}`);
      }
      return 0;
    case 'doctor':
      return doctor();
    case 'mail-test': {
      const c = config();
      return mailTest(
        c,
        createEmailSender(c, (l) => {
          console.warn(l);
        }),
        rest[0],
        (l) => {
          console.log(l);
        },
      );
    }
    case 'alert':
      return alert(rest[0]);
    case 'timers':
      return timers(rest.includes('--write'));
    default:
      console.log(
        readFileSync(new URL(import.meta.url), 'utf8')
          .split('\n')
          .slice(1, 16)
          .map((l) => l.replace(/^ \*\/? ?/, ''))
          .join('\n'),
      );
      return command === 'help' ? 0 : 2;
  }
}

async function runJob(name: string | undefined, args: string[]): Promise<number> {
  const job = name ? findJob(name) : undefined;
  if (!job) {
    console.error(
      `No job called '${name ?? ''}'. These exist: ${JOBS.map((j) => j.name).join(', ')}`,
    );
    return 2;
  }
  if (!job.run) {
    // Exit 0: a timer that fires for a feature not built yet is not a
    // failure, and a unit that is red for months teaches people to ignore
    // red. The doctor lists it instead.
    console.log(`${job.name}: not built yet (workstream ${job.owner}). Nothing ran.`);
    return 0;
  }
  const c = config();
  const db = createDatabase(c.DATABASE_URL, 2);
  try {
    const outcome = await job.run({
      config: c,
      db,
      email: createEmailSender(c, (l) => {
        console.warn(l);
      }),
      log: (l) => {
        console.log(l);
      },
      args,
      now: () => new Date(),
    });
    (outcome.ok ? console.log : console.error)(`${job.name}: ${outcome.summary}`);
    return outcome.ok ? 0 : 1;
  } catch (err) {
    console.error(
      `${job.name} stopped: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    return 1;
  } finally {
    await db.destroy();
  }
}

async function doctor(): Promise<number> {
  const c = config();
  const server =
    rest.includes('--server') || (!rest.includes('--local') && existsSync(SERVER_MARKER));
  const db = createDatabase(c.DATABASE_URL, 1);
  try {
    const findings = await diagnose({ config: c, db, server, now: new Date() });
    console.log(
      `\nReportLog doctor${server ? '' : ' (not a server: systemd, certificate and machine checks skipped)'}\n`,
    );
    console.log(render(findings));
    const code = exitCode(findings);
    console.log(code ? '\nSomething above needs fixing.\n' : '\nNothing needs fixing.\n');
    return code;
  } finally {
    await db.destroy();
  }
}

async function alert(unit: string | undefined): Promise<number> {
  const c = config();
  if (!c.OPS_ALERT_EMAIL) {
    console.log(`${unit ?? 'a unit'} failed; OPS_ALERT_EMAIL is not set, so nobody was emailed.`);
    return 0;
  }
  const host = c.SITE_ORIGIN ? new URL(c.SITE_ORIGIN).host : 'a ReportLog server';
  const result = await createEmailSender(c, (l) => {
    console.warn(l);
  }).send({
    to: c.OPS_ALERT_EMAIL,
    subject: `${host}: ${unit ?? 'a scheduled job'} failed`,
    text: [
      `A scheduled job on ${host} failed: ${unit ?? '(unit not named)'}.`,
      '',
      'What it said is in the journal on the server:',
      `  sudo journalctl -u ${unit ?? 'reportlog-job@*'} -n 50`,
      '',
      'And the state of everything else:',
      '  sudo reportlog doctor',
    ].join('\n'),
  });
  if (!result.sent) console.error(`The alert could not be sent: ${result.detail}`);
  return result.sent ? 0 : 1;
}

function timers(write: boolean): number {
  let stale = 0;
  for (const job of JOBS) {
    const file = `${CODE_ROOT}deploy/systemd/reportlog-${job.name}.timer`;
    const want = timerUnit(job);
    const have = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    if (have === want) continue;
    stale += 1;
    if (write) writeFileSync(file, want);
    console.log(`${write ? 'wrote' : 'differs'}  deploy/systemd/reportlog-${job.name}.timer`);
  }
  if (!stale) console.log('All timers match the registry.');
  return write || !stale ? 0 : 1;
}

process.exitCode = await main();
