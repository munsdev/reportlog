/**
 * The pure half of the backup: what a dump is called, which old ones go,
 * and whether the newest is recent enough to be worth anything.
 *
 * WHAT IS NOT BACKED UP: the settings file (/etc/reportlog/reportlog.env).
 * It holds keys, and writing it beside the dumps would put keys and the data
 * they protect in the same place, in the same copy somebody later makes.
 * Copying it off the server is a human act, done once (deploy/README.md).
 */
import path from 'node:path';

const NAME = /^reportlog-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump$/;

/**
 * A dump's name, from the moment it was taken. Sorts as text, carries the
 * time as well as the day so two runs in a day never collide, and has no
 * colons, which are a nuisance everywhere a backup later gets copied.
 */
export function backupName(when: Date): string {
  const iso = when.toISOString();
  return `reportlog-${iso.slice(0, 10)}T${iso.slice(11, 13)}-${iso.slice(14, 16)}-${iso.slice(17, 19)}Z.dump`;
}

/** When a dump was taken, or undefined for a name this did not write. */
export function backupTime(name: string): Date | undefined {
  const m = NAME.exec(name);
  if (!m) return undefined;
  const d = new Date(`${m[1] ?? ''}T${m[2] ?? ''}:${m[3] ?? ''}:${m[4] ?? ''}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Only the files this wrote, newest first. Anything else is invisible. */
export function ours(names: readonly string[]): string[] {
  return names
    .filter((n) => backupTime(n))
    .sort()
    .reverse();
}

/**
 * Which dumps to delete, keeping the newest `keep`.
 *
 * ONLY EVER FILES THIS WROTE. A backup directory is somewhere a person also
 * puts things by hand (a dump taken before an upgrade), and a retention job
 * that deleted whatever it found would one day delete one of those. `keep`
 * below 1 counts as 1: a setting that deleted the backup just taken would be
 * a typo with no recovery.
 */
export function prune(names: readonly string[], keep: number): string[] {
  return ours(names).slice(Math.max(1, Math.floor(keep)));
}

export type BackupHealth =
  { state: 'none' } | { state: 'ok' | 'stale'; count: number; newest: string; ageHours: number };

/** Three answers, because they need different sentences: never, too old, fine. */
export function backupHealth(
  names: readonly string[],
  now: Date,
  maxAgeHours: number,
): BackupHealth {
  const list = ours(names);
  const newest = list[0];
  const taken = newest ? backupTime(newest) : undefined;
  if (!newest || !taken) return { state: 'none' };
  const ageHours = Math.round(((now.getTime() - taken.getTime()) / 3_600_000) * 10) / 10;
  return { state: ageHours > maxAgeHours ? 'stale' : 'ok', count: list.length, newest, ageHours };
}

/**
 * Is this a safe place for dumps? Not the root, and not anywhere inside the
 * code: a release directory is replaced on deploy, and anything under the
 * website's files is one guessed name away from being served.
 */
export function checkDir(
  dir: string,
  codeRoot: string,
): { ok: true; target: string } | { ok: false; why: string } {
  const target = path.resolve(dir);
  if (target === '/') return { ok: false, why: 'BACKUP_DIR is the root directory.' };
  const base = path.resolve(codeRoot);
  if (target === base || target.startsWith(`${base}${path.sep}`)) {
    return { ok: false, why: `BACKUP_DIR (${target}) is inside the application's code (${base}).` };
  }
  return { ok: true, target };
}

/**
 * age recipients from the setting: native age public keys (`age1…`),
 * separated by spaces or commas. SSH keys are not accepted here because
 * they contain spaces; make an age key for this (`age-keygen`).
 */
export function ageRecipients(setting: string | undefined): string[] {
  return (setting ?? '').split(/[\s,]+/).filter(Boolean);
}

export function badRecipients(recipients: readonly string[]): string[] {
  return recipients.filter((r) => !/^age1[02-9ac-hj-np-z]{58}$/.test(r));
}
