/**
 * The doctor's judgements, separate from the looking.
 *
 * Each function takes facts already gathered and says ok, warn or fail, with
 * a sentence that tells the operator what to do. Kept pure so every
 * threshold here is tested without a server to break.
 */
import type { BackupHealth } from './backup-files.ts';
import type { BackupState } from './backup.ts';

export type Status = 'ok' | 'warn' | 'fail';
export interface Finding {
  status: Status;
  check: string;
  detail: string;
}

const f = (status: Status, check: string, detail: string): Finding => ({ status, check, detail });

/** Nothing but the socket, or at most the loopback addresses. */
export function assessListen(listenAddresses: string): Finding {
  const addrs = listenAddresses
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  const local = new Set(['localhost', '127.0.0.1', '::1']);
  if (!addrs.length) return f('ok', 'postgres', 'listens on its Unix socket only');
  const open = addrs.filter((a) => !local.has(a));
  if (!open.length) return f('ok', 'postgres', `listens on ${addrs.join(', ')} and its socket`);
  return f(
    'fail',
    'postgres',
    `listen_addresses is '${listenAddresses}': PostgreSQL accepts connections from the network. ` +
      'Set it to an empty string (deploy/postgres/reportlog.conf) and restart PostgreSQL.',
  );
}

export function assessMigrations(files: readonly string[], applied: readonly string[]): Finding {
  const done = new Set(applied);
  const known = new Set(files);
  const pending = files.filter((x) => !done.has(x));
  const ahead = applied.filter((x) => !known.has(x));
  if (pending.length) {
    return f(
      'fail',
      'migrations',
      `${String(pending.length)} not applied (${pending.join(', ')}). A deploy migrates before it switches; ` +
        'this release was started some other way.',
    );
  }
  if (ahead.length) {
    return f(
      'warn',
      'migrations',
      `the database has ${String(ahead.length)} migration(s) this release does not (${ahead.join(', ')}). ` +
        'Expected after a rollback, and safe: migrations only add. Deploy forward when ready.',
    );
  }
  return f('ok', 'migrations', `all ${String(files.length)} applied`);
}

/**
 * Caddy renews a certificate when a third of its lifetime is left: about 30
 * days for today's 90-day certificates, 15 for 45-day ones, two for 6-day
 * ones. So "a few days left" is normal for short certificates, and these
 * limits only catch renewal that has actually stopped.
 */
export function assessCertificate(host: string, daysLeft: number): Finding {
  const left = daysLeft < 1 ? 'under a day' : `${String(Math.floor(daysLeft))} day(s)`;
  if (daysLeft < 3) {
    return f(
      'fail',
      'certificate',
      `${host}'s certificate expires in ${left}. Caddy should have renewed it; look at: journalctl -u caddy`,
    );
  }
  if (daysLeft < 7) {
    return f(
      'warn',
      'certificate',
      `${host}'s certificate expires in ${left}; check Caddy is renewing it.`,
    );
  }
  return f('ok', 'certificate', `${host}, valid for ${left}`);
}

export function assessDisk(path: string, freeFraction: number): Finding {
  const pct = `${String(Math.round(freeFraction * 100))}% free`;
  if (freeFraction < 0.1)
    return f('fail', 'disk', `${path}: ${pct}. A full disk stops the database and the backup.`);
  if (freeFraction < 0.2) return f('warn', 'disk', `${path}: ${pct}.`);
  return f('ok', 'disk', `${path}: ${pct}`);
}

export function assessBackups(input: {
  health: BackupHealth;
  state: BackupState;
  offsiteConfigured: boolean;
  now: Date;
  maxAgeHours: number;
}): Finding[] {
  const { health, state, offsiteConfigured, now, maxAgeHours } = input;
  const out: Finding[] = [];
  if (health.state === 'none') {
    out.push(f('fail', 'backup', 'there are no backups. Run: sudo reportlog backup'));
  } else if (health.state === 'stale') {
    out.push(
      f(
        'fail',
        'backup',
        `the newest backup is ${String(health.ageHours)}h old (limit ${String(maxAgeHours)}h). Is reportlog-backup.timer running?`,
      ),
    );
  } else {
    out.push(
      f(
        'ok',
        'backup',
        `${String(health.count)} on this server, newest ${String(health.ageHours)}h old`,
      ),
    );
  }

  if (state.failure) {
    out.push(
      f(
        'fail',
        'backup',
        `the last run failed at ${state.failure.step} (${state.failure.at}): ${state.failure.why}`,
      ),
    );
  }

  if (!offsiteConfigured) {
    out.push(
      f(
        'warn',
        'off-site',
        'no off-site copy is configured (BACKUP_S3_*). If this server is lost, so is the archive.',
      ),
    );
  } else if (!state.offsite) {
    out.push(
      f(
        'fail',
        'off-site',
        'configured, but no copy has been sent yet. Run: sudo reportlog backup',
      ),
    );
  } else {
    const hours = (now.getTime() - Date.parse(state.offsite.at)) / 3_600_000;
    out.push(
      hours > maxAgeHours
        ? f(
            'fail',
            'off-site',
            `the last off-site copy is ${String(Math.round(hours))}h old (${state.offsite.key}).`,
          )
        : f(
            'ok',
            'off-site',
            `last copy ${String(Math.round(hours))}h ago, encrypted (${state.offsite.key})`,
          ),
    );
  }
  return out;
}

/** `systemctl show` of one job's service and timer. */
export interface UnitFacts {
  job: string;
  timerEnabled: string;
  timerActive: string;
  /** "success" or the failure systemd recorded; empty if it has never run. */
  result: string;
  lastRun: string;
}

export function assessJobUnit(u: UnitFacts, built: boolean): Finding {
  const check = `job ${u.job}`;
  if (u.timerEnabled !== 'enabled' || u.timerActive !== 'active') {
    return f(
      'fail',
      check,
      `reportlog-${u.job}.timer is ${u.timerEnabled || 'missing'}/${u.timerActive || 'inactive'}. A deploy installs it; ` +
        `or: sudo systemctl enable --now reportlog-${u.job}.timer`,
    );
  }
  const ran = u.lastRun && u.lastRun !== 'n/a' && u.lastRun !== '0';
  if (ran && u.result !== 'success') {
    return f(
      'fail',
      check,
      `the last run (${u.lastRun}) ended with '${u.result}'. See: journalctl -u reportlog-job@${u.job}`,
    );
  }
  if (!built)
    return f('warn', check, 'scheduled, but not built yet: each run says so and does nothing.');
  return f('ok', check, ran ? `last run ${u.lastRun}, succeeded` : 'scheduled, not run yet');
}

/** /etc/apt/apt.conf.d/20auto-upgrades, as text. */
export function assessUnattended(text: string | undefined, rebootRequired: boolean): Finding[] {
  const on = (key: string) => new RegExp(`${key}\\s+"1"`).test(text ?? '');
  const out: Finding[] = [];
  if (!on('APT::Periodic::Update-Package-Lists') || !on('APT::Periodic::Unattended-Upgrade')) {
    out.push(
      f('fail', 'updates', 'unattended security updates are off. deploy/install.sh turns them on.'),
    );
  } else {
    out.push(f('ok', 'updates', 'unattended security updates are on'));
  }
  if (rebootRequired) {
    out.push(f('warn', 'updates', 'an installed update is waiting for a reboot.'));
  }
  return out;
}

/** Node as installed versus deploy/versions.conf. */
export function assessNode(running: string, pinned: string | undefined): Finding {
  if (!pinned)
    return f('warn', 'node', `running ${running}; deploy/versions.conf names no version`);
  if (running.replace(/^v/, '') !== pinned) {
    return f(
      'warn',
      'node',
      `running ${running}, but deploy/versions.conf pins ${pinned}. Run deploy/install.sh again.`,
    );
  }
  return f('ok', 'node', `${running}, as pinned`);
}

export function exitCode(findings: readonly Finding[]): number {
  return findings.some((x) => x.status === 'fail') ? 1 : 0;
}
