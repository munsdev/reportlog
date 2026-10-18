/**
 * The pure half of `npm run backup`: what a dump is called, which old ones
 * go, and whether the newest is recent enough to be worth anything.
 *
 * WHY THIS EXISTS AT ALL. Nothing in this repository backed up a database,
 * and nothing told an operator to. For an archive whose entire value is that
 * the record survives — one that cannot delete a row by design, and whose
 * own documents say "take a pg_dump before relying on" the export script —
 * that was the largest gap in the operational story. A guide can say "set up
 * backups"; a scheduled unit and a check that notices when it stopped are
 * what actually happen on a box nobody is looking at.
 *
 * WHAT THIS DELIBERATELY DOES NOT BACK UP: `.env`.
 *
 * That file holds the only copy of two encryption keys. Writing it into the
 * backup directory would put the keys beside the ciphertext they open, on the
 * same disk, in the same tarball somebody later copies somewhere convenient —
 * which turns two separate secrets into one, and defeats the reason Tier B is
 * encrypted at all. Backing up `.env` is a human act, done once, to somewhere
 * that is not this machine. INSTALL.md §3.8 says so and this file refuses to
 * quietly do it instead.
 *
 * `pg_dump` is also NOT reimplemented here. It is called with an argument
 * array in scripts/backup.js, never a shell string, for the same reason
 * src/media.js does it that way.
 */
import path from 'node:path';

/** Keep this many dumps. Older ones are pruned once a new one is written. */
export const DEFAULT_KEEP = 14;

/**
 * How old the newest dump may be before the doctor calls it a problem.
 *
 * Two days rather than one, so a daily timer that fired late, or a box that
 * was off overnight, is not reported as a failure. Anything older than this
 * means the timer has actually stopped.
 */
export const DEFAULT_MAX_AGE_HOURS = 48;

export const DEFAULT_DIR = '/var/backups/reportlog';

const NAME_RE = /^reportlog-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump$/;

/**
 * A dump's name, from the moment it was taken.
 *
 * Sortable as text, which is what lets `prune` below order them without
 * parsing anything, and carries the time as well as the day so two runs on
 * one day cannot overwrite each other. Colons are not in it on purpose: they
 * are legal on Linux and a nuisance everywhere a backup later gets copied.
 */
export function backupName(when = new Date()) {
  const iso = when.toISOString();
  return `reportlog-${iso.slice(0, 10)}T${iso.slice(11, 13)}-${iso.slice(14, 16)}-${iso.slice(17, 19)}Z.dump`;
}

/** The moment a dump was taken, or null for a name this did not write. */
export function backupTime(name) {
  const m = NAME_RE.exec(String(name || ''));
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Only the files this wrote, newest first. Anything else is left alone. */
export function ours(names) {
  return (names || [])
    .filter((n) => backupTime(n))
    .sort((a, b) => backupTime(b) - backupTime(a));
}

/**
 * Which dumps to delete, keeping the newest `keep`.
 *
 * ONLY EVER FILES THIS SCRIPT WROTE. A backup directory is somewhere a person
 * also puts things by hand — a dump taken before an upgrade, a copy of
 * somebody else's database — and a retention job that deleted whatever it
 * found would eventually delete one of those. Everything that does not match
 * the name pattern is invisible to this function.
 *
 * `keep` below 1 is treated as 1. A retention setting that deleted the backup
 * it had just taken would be a typo with no recovery.
 */
export function prune(names, keep = DEFAULT_KEEP) {
  const n = Math.max(1, Number.isFinite(keep) ? Math.floor(keep) : DEFAULT_KEEP);
  return ours(names).slice(n);
}

/**
 * Is there a recent enough backup? What the doctor asks.
 *
 * Three answers, not two, because they need different sentences: there has
 * never been one, there is one and it is stale, or it is current.
 */
export function backupHealth(names, {
  now = new Date(), maxAgeHours = DEFAULT_MAX_AGE_HOURS,
} = {}) {
  const list = ours(names);
  if (!list.length) return { state: 'none', count: 0 };
  const newest = backupTime(list[0]);
  const ageHours = (now - newest) / 3_600_000;
  return {
    state: ageHours > maxAgeHours ? 'stale' : 'ok',
    count: list.length,
    newest: list[0],
    ageHours: Math.round(ageHours * 10) / 10,
  };
}

/**
 * Is this a safe place to put dumps? Refuses anywhere inside the checkout.
 *
 * A dump under the application directory is a copy of the whole archive
 * sitting where `git status` will offer to commit it, where a release's
 * `git pull` has to step around it, and — if it lands anywhere under
 * `public/` — where nginx will serve it to anybody who guesses the name.
 * That last one is not hypothetical enough to leave to a reader's judgement.
 */
export function checkDir(dir, { root } = {}) {
  const target = path.resolve(String(dir || ''));
  if (!target || target === '/') return { ok: false, reason: 'empty' };
  if (root) {
    const base = path.resolve(root);
    if (target === base || target.startsWith(`${base}${path.sep}`)) {
      return { ok: false, reason: 'inside-checkout', target, root: base };
    }
  }
  return { ok: true, target };
}

/** Settings from the environment, with the documented defaults. */
export function backupSettings(env = process.env) {
  const keep = Number(env.BACKUP_KEEP);
  const maxAge = Number(env.BACKUP_MAX_AGE_HOURS);
  return {
    dir: env.BACKUP_DIR || DEFAULT_DIR,
    keep: Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : DEFAULT_KEEP,
    maxAgeHours: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_MAX_AGE_HOURS,
  };
}

/**
 * The restore, as somebody types it on the box: the service stopped, the
 * dump read back AS THE SERVICE USER — the only one who can read the backup
 * directory, so a restore run as postgres cannot even open the file — into
 * the database named in .env, and the service started again.
 * --clean --if-exists replaces what is there, so the same command works on
 * the live database and on an empty one made with createdb.
 */
export function restoreCommand({ user = 'reportlog', repo = '/srv/reportlog', dir = DEFAULT_DIR } = {}) {
  return [
    'sudo systemctl stop reportlog',
    `sudo -u ${user} sh -c 'pg_restore --clean --if-exists \\`,
    `  -d "$(grep ^DATABASE_URL= ${repo}/.env | cut -d= -f2-)" \\`,
    `  ${dir}/<file>'`,
    'sudo systemctl start reportlog',
  ].join('\n');
}
