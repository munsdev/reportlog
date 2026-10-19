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
 *   contact-key          record CONTACT_KEY's fingerprint, or refuse if it changed
 *   contact-key rotate   move every row from CONTACT_KEY_PREVIOUS to CONTACT_KEY
 *   timers --write       regenerate deploy/systemd/*.timer from the registry
 *   timers --check       fail if they differ (also a unit test)
 *
 * Exit codes: 0 fine, 1 something failed, 2 used wrongly.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { createMailer } from '../email/index.ts';
import { mailTest } from '../email/mail-test.ts';
import { CODE_ROOT } from './backup.ts';
import { rotateContactKey } from '../filing/rotateContactKey.ts';
import { CHANGED_MESSAGE, checkAndRecord, recordRotated } from './contact-key.ts';
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
      return mailTest(c, createMailer(c), rest[0], (l) => {
        console.log(l);
      });
    }
    case 'alert':
      return alert(rest[0]);
    case 'contact-key':
      return rest[0] === 'rotate' ? rotateKey() : contactKey();
    case 'timers':
      return timers(rest.includes('--write'));
    default:
      console.log(
        readFileSync(new URL(import.meta.url), 'utf8')
          .split('\n')
          .slice(1, 17)
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
      mailer: createMailer(c),
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
  const host = new URL(c.SITE_ORIGIN).host;
  try {
    await createMailer(c).send({
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
    return 0;
  } catch (err) {
    // MailNotSent carries the provider's answer and never the address.
    console.error(
      `The alert could not be sent: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

/**
 * Run by deploy.sh before it switches: a changed key stops the deploy, a
 * planned rotation (the recorded key in CONTACT_KEY_PREVIOUS) goes through.
 */
async function contactKey(): Promise<number> {
  const c = config();
  const result = await checkAndRecord(c.CONTACT_KEY, c.STATE_DIR, c.CONTACT_KEY_PREVIOUS);
  switch (result.state) {
    case 'unset':
      console.log('CONTACT_KEY is not set: the site will take no reports until it is.');
      return 0;
    case 'first':
      console.log('CONTACT_KEY fingerprint recorded. From now on a changed key stops a deploy.');
      return 0;
    case 'same':
      console.log('CONTACT_KEY is the key this archive has recorded.');
      if (result.previousLeftOver) {
        console.log('The rotation is finished: remove CONTACT_KEY_PREVIOUS from the settings.');
      }
      return 0;
    case 'rotating':
      console.log(
        'CONTACT_KEY is being rotated: the recorded key is in CONTACT_KEY_PREVIOUS. ' +
          'Run `reportlog contact-key rotate` once this release is running.',
      );
      return 0;
    case 'changed':
      console.error(CHANGED_MESSAGE);
      return 1;
  }
}

/**
 * The rotation (apps/api/src/filing/rotateContactKey.ts): every row moved to
 * CONTACT_KEY in one transaction, then the new key's fingerprint recorded.
 * Safe to run again; refuses unless the key being rotated from is the one
 * this archive recorded.
 */
async function rotateKey(): Promise<number> {
  const c = config();
  if (!c.CONTACT_KEY || !c.CONTACT_KEY_PREVIOUS) {
    console.error(
      'Set CONTACT_KEY to the new key and CONTACT_KEY_PREVIOUS to the one in use, then run this again.',
    );
    return 2;
  }
  const check = await checkAndRecord(c.CONTACT_KEY, c.STATE_DIR, c.CONTACT_KEY_PREVIOUS);
  if (check.state === 'changed') {
    console.error(
      'CONTACT_KEY_PREVIOUS is not the key this archive recorded, so this is not its rotation. Nothing was changed.',
    );
    return 1;
  }
  const db = createDatabase(c.DATABASE_URL, 1);
  try {
    const out = await rotateContactKey(db, {
      current: c.CONTACT_KEY,
      previous: c.CONTACT_KEY_PREVIOUS,
    });
    await recordRotated(c.CONTACT_KEY, c.STATE_DIR);
    console.log(
      `Re-wrapped ${String(out.rewrapped)} contact keys (${String(out.already_current)} already on the new key). ` +
        'The new key is recorded. Remove CONTACT_KEY_PREVIOUS from the settings and restart the API.',
    );
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await db.destroy();
  }
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
