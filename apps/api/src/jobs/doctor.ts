/**
 * `reportlog doctor`: is this deployment actually usable?
 *
 * /api/health says the process is alive. The doctor answers the question
 * somebody asks next: will a report get confirmed tonight, is there a
 * backup from last night, and is anything open that should not be. It
 * looks and says; it never changes anything.
 *
 * On a server (one with /etc/reportlog) it also asks systemd about every
 * timer, and checks the certificate, the disk and the update settings. On a
 * development machine those are skipped and say so.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, statfs } from 'node:fs/promises';
import { connect } from 'node:tls';
import { promisify } from 'node:util';
import { sql } from 'kysely';
import type { Config } from '../config.ts';
import type { Database } from '../db/database.ts';
import { MIGRATIONS_DIR } from '../db/migrate.ts';
import { emailReadiness } from '../email/index.ts';
import { backupHealth } from './backup-files.ts';
import { CODE_ROOT, readState } from './backup.ts';
import { CHANGED_MESSAGE, compare, recordedFingerprint } from './contact-key.ts';
import type { Finding, UnitFacts } from './doctor-checks.ts';
import {
  assessBackups,
  assessCertificate,
  assessDisk,
  assessJobUnit,
  assessListen,
  assessMigrations,
  assessNode,
  assessUnattended,
} from './doctor-checks.ts';
import { offsiteTarget } from './offsite.ts';
import { JOBS } from './registry.ts';

const run = promisify(execFile);

export const SERVER_MARKER = '/etc/reportlog';

export interface DoctorOptions {
  config: Config;
  db: Database;
  server: boolean;
  now: Date;
}

const finding = (status: Finding['status'], check: string, detail: string): Finding => ({
  status,
  check,
  detail,
});
const why = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';

export async function diagnose({ config, db, server, now }: DoctorOptions): Promise<Finding[]> {
  const out: Finding[] = [];

  // --- settings ----------------------------------------------------------
  // SITE_ORIGIN always has a value: unset, it is the development website.
  // On a server that is as wrong as a missing one: every link in every
  // email would point at somebody's laptop.
  if (server && !config.SITE_ORIGIN.startsWith('https://')) {
    out.push(
      finding(
        'fail',
        'settings',
        `SITE_ORIGIN is ${config.SITE_ORIGIN}; a server is reached over https, and every link in every email is built from it.`,
      ),
    );
  } else {
    out.push(finding('ok', 'settings', `SITE_ORIGIN is ${config.SITE_ORIGIN}`));
  }
  if (server && config.TRUST_PROXY < 1) {
    out.push(
      finding(
        'fail',
        'settings',
        'TRUST_PROXY is 0 behind Caddy: every visitor looks like 127.0.0.1, so one person can use up the sign-in limits for everybody. Set it to 1.',
      ),
    );
  }
  const key = compare(
    config.CONTACT_KEY,
    await recordedFingerprint(config.STATE_DIR),
    config.CONTACT_KEY_PREVIOUS,
  );
  if (key.state === 'unset') {
    out.push(
      finding(
        server ? 'fail' : 'warn',
        'contact key',
        'CONTACT_KEY is not set: the site takes no reports. deploy/install.sh makes one.',
      ),
    );
  } else if (key.state === 'changed') {
    out.push(finding('fail', 'contact key', CHANGED_MESSAGE));
  } else if (key.state === 'rotating') {
    out.push(
      finding(
        'warn',
        'contact key',
        'being rotated: run `reportlog contact-key rotate` to finish, then remove CONTACT_KEY_PREVIOUS.',
      ),
    );
  } else if (key.state === 'same' && key.previousLeftOver) {
    out.push(
      finding(
        'warn',
        'contact key',
        'the rotation is finished but CONTACT_KEY_PREVIOUS is still set. Remove it from the settings.',
      ),
    );
  } else if (server) {
    out.push(
      finding(
        key.state === 'same' ? 'ok' : 'warn',
        'contact key',
        key.state === 'same'
          ? 'set, and the key this archive was started with. Keep a copy off the server.'
          : 'set, not yet recorded: the next deploy records its fingerprint.',
      ),
    );
  }
  const mail = emailReadiness(config);
  out.push(
    mail.ok
      ? finding(
          'ok',
          'email',
          `${config.EMAIL_TRANSPORT}, from ${config.EMAIL_FROM_ADDRESS ?? '?'}. To prove delivery: sudo reportlog mail-test you@example.org`,
        )
      : finding(server ? 'fail' : 'warn', 'email', mail.problem ?? 'not ready'),
  );
  if (!config.OPS_ALERT_EMAIL) {
    out.push(
      finding(
        'warn',
        'alerts',
        'OPS_ALERT_EMAIL is not set: a failed job is seen only by running this.',
      ),
    );
  }

  // --- database ----------------------------------------------------------
  let dbUp = false;
  try {
    await sql`SELECT 1`.execute(db);
    dbUp = true;
    out.push(finding('ok', 'database', 'connected'));
  } catch (err) {
    out.push(finding('fail', 'database', `cannot connect: ${why(err)}`));
  }
  if (dbUp) {
    const files = (await readdir(MIGRATIONS_DIR)).filter((x) => x.endsWith('.sql')).sort();
    const applied = await sql<{ filename: string }>`SELECT filename FROM schema_migrations`
      .execute(db)
      .then((r) => r.rows.map((x) => x.filename))
      .catch(() => []);
    out.push(assessMigrations(files, applied));
    const listen = await sql<{ listen_addresses: string }>`SHOW listen_addresses`.execute(db);
    const shown = listen.rows[0]?.listen_addresses;
    if (server && shown !== undefined) out.push(assessListen(shown));
  }

  // --- the API, here and from outside -----------------------------------
  const local = `http://${config.HOST}:${String(config.PORT)}/api/health`;
  try {
    const res = await fetch(local, { signal: AbortSignal.timeout(3000) });
    out.push(
      res.ok
        ? finding('ok', 'api', `answering on ${config.HOST}:${String(config.PORT)}`)
        : finding('fail', 'api', `${local} answered ${String(res.status)}`),
    );
  } catch {
    out.push(
      finding(
        server ? 'fail' : 'warn',
        'api',
        `nothing answers on ${local}. Is reportlog-api running?`,
      ),
    );
  }
  if (server && config.SITE_ORIGIN.startsWith('https://')) {
    const host = new URL(config.SITE_ORIGIN).hostname;
    try {
      out.push(assessCertificate(host, await certificateDaysLeft(host)));
      const res = await fetch(`${config.SITE_ORIGIN}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      out.push(
        res.ok
          ? finding('ok', 'site', `${config.SITE_ORIGIN} answers through Caddy`)
          : finding(
              'fail',
              'site',
              `${config.SITE_ORIGIN}/api/health answered ${String(res.status)}`,
            ),
      );
    } catch (err) {
      out.push(
        finding(
          'fail',
          'site',
          `${config.SITE_ORIGIN} could not be reached over https: ${why(err)}`,
        ),
      );
    }
  }

  // --- backups -------------------------------------------------------------
  let names: string[] = [];
  try {
    names = await readdir(config.BACKUP_DIR);
  } catch {
    // No directory is the same answer as no backups.
  }
  out.push(
    ...assessBackups({
      health: backupHealth(names, now, config.BACKUP_MAX_AGE_HOURS),
      state: await readState(config.STATE_DIR),
      offsiteConfigured: offsiteTarget(config) !== undefined,
      now,
      maxAgeHours: config.BACKUP_MAX_AGE_HOURS,
    }),
  );

  // --- scheduled jobs ------------------------------------------------------
  if (server) {
    for (const job of JOBS) {
      out.push(assessJobUnit(await unitFacts(job.name), job.run !== undefined));
    }
  } else {
    const slots = JOBS.filter((j) => !j.run).map((j) => `${j.name} (${j.owner})`);
    if (slots.length) out.push(finding('warn', 'jobs', `not built yet: ${slots.join(', ')}`));
  }

  // --- the machine -----------------------------------------------------------
  if (server) {
    out.push(
      ...assessUnattended(
        readIfExists('/etc/apt/apt.conf.d/20auto-upgrades'),
        existsSync('/var/run/reboot-required'),
      ),
    );
    for (const path of ['/', config.BACKUP_DIR]) {
      try {
        const s = await statfs(path);
        out.push(assessDisk(path, s.bavail / s.blocks));
      } catch {
        // A missing backup directory is already reported above.
      }
    }
    const pinned = /^NODE_VERSION=(.+)$/m.exec(
      readIfExists(`${CODE_ROOT}deploy/versions.conf`) ?? '',
    )?.[1];
    out.push(assessNode(process.version, pinned));
  }
  return out;
}

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function unitFacts(job: string): Promise<UnitFacts> {
  const show = async (unit: string, props: string[]) => {
    try {
      const { stdout } = await run('systemctl', [
        'show',
        unit,
        ...props.map((p) => `--property=${p}`),
      ]);
      return Object.fromEntries(
        stdout
          .split('\n')
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      ) as Record<string, string>;
    } catch {
      return {} as Record<string, string>;
    }
  };
  const timer = await show(`reportlog-${job}.timer`, ['UnitFileState', 'ActiveState']);
  const service = await show(`reportlog-job@${job}.service`, ['Result', 'ExecMainExitTimestamp']);
  return {
    job,
    timerEnabled: timer.UnitFileState ?? '',
    timerActive: timer.ActiveState ?? '',
    result: service.Result ?? '',
    lastRun: service.ExecMainExitTimestamp ?? '',
  };
}

function certificateDaysLeft(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!socket.authorized) {
        reject(new Error(`the certificate is not trusted (${String(socket.authorizationError)})`));
        return;
      }
      resolve((Date.parse(cert.valid_to) - Date.now()) / 86_400_000);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('timed out'));
    });
    socket.on('error', reject);
  });
}

export function render(findings: readonly Finding[]): string {
  const mark = { ok: ' ok ', warn: 'warn', fail: 'FAIL' } as const;
  const width = Math.max(...findings.map((x) => x.check.length));
  return findings
    .map((x) => `  ${mark[x.status]}  ${x.check.padEnd(width)}  ${x.detail}`)
    .join('\n');
}
