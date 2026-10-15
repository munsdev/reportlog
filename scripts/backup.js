/**
 * Take a backup of the archive.
 *
 *   npm run backup            take one, verify it, prune old ones
 *   npm run backup -- --check report on what is there and take nothing
 *
 * WHY A SCRIPT RATHER THAN A LINE IN THE GUIDE. A documented `pg_dump` is a
 * thing an operator does twice and then stops. This exists so there is
 * something for a timer to call, and so `npm run doctor` can notice when it
 * stopped — which is the half that actually saves somebody, because a backup
 * that quietly stopped looks exactly like one that is working.
 *
 * THREE THINGS IT DOES THAT A ONE-LINE pg_dump DOES NOT:
 *
 *   It writes to a temporary name and renames only after the dump has been
 *   read back. A dump interrupted half way — disk full, box rebooted — is a
 *   plausible-looking file of the wrong length, and the one moment nobody
 *   checks a backup is while taking it. Only a verified file ever gets the
 *   real name, so anything the directory lists has been read back at least
 *   once.
 *
 *   It verifies by asking `pg_restore --list` to read the archive's own table
 *   of contents. That is not a restore and proves nothing about a future one,
 *   but it does prove the file is a complete, parseable dump rather than a
 *   truncated one.
 *
 *   It prunes only files it wrote. A backup directory is somewhere a person
 *   also puts things by hand, and a retention job that deleted whatever it
 *   found would eventually delete one of those. src/backup.js holds the rule.
 *
 * IT DOES NOT BACK UP `.env`, deliberately — that would put the only copy of
 * two irreplaceable keys beside the ciphertext they open. src/backup.js says
 * why at more length.
 *
 * Exit code 0 on success, 1 on anything that means there is no new backup,
 * so a timer's failure is visible in `systemctl status`.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  backupName, backupSettings, backupHealth, prune, checkDir, ours,
} from '../src/backup.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const { dir, keep, maxAgeHours } = backupSettings(process.env);

const fail = (msg, hint) => {
  console.error(`\n  ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error('');
  process.exit(1);
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

console.log('\nReportLog — backup\n');

/* ---- where ----------------------------------------------------------- */
const where = checkDir(dir, { root });
if (!where.ok) {
  if (where.reason === 'inside-checkout') {
    fail(`BACKUP_DIR is inside the application directory (${where.target}).`,
      'Put it somewhere else: a dump under the checkout is a copy of the whole\n'
      + '  archive sitting where git will offer to commit it, where a release has to\n'
      + '  step around it, and — under public/ — where nginx would serve it to\n'
      + '  anybody who guessed the name.');
  }
  fail('BACKUP_DIR is not set to anything usable.', `Default is ${dir}.`);
}
const target = where.target;

/* ---- what is already there ------------------------------------------- */
let existing = [];
if (fs.existsSync(target)) {
  existing = fs.readdirSync(target);
} else if (checkOnly) {
  console.log(`  --   ${target} does not exist yet, so there are no backups`);
}

const health = backupHealth(existing, { maxAgeHours });
if (health.state === 'none') {
  console.log(`  --   no backups in ${target}`);
} else {
  const age = health.ageHours < 1 ? 'under an hour' : `${health.ageHours}h`;
  console.log(`  ${health.state === 'ok' ? 'ok  ' : '--  '} ${health.count} backup(s), newest ${age} old`);
}

if (checkOnly) {
  for (const f of ours(existing).slice(0, 5)) {
    const { size } = fs.statSync(path.join(target, f));
    console.log(`       ${f}  ${mb(size)}`);
  }
  console.log(`\n  keeping ${keep}, stale after ${maxAgeHours}h\n`);
  process.exit(health.state === 'ok' ? 0 : 1);
}

/* ---- the tools and the connection ----------------------------------- */
const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set, so there is nothing to back up.');

for (const bin of ['pg_dump', 'pg_restore']) {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
  } catch {
    fail(`${bin} is not installed.`,
      'It comes with the PostgreSQL client package — postgresql-client on Debian\n'
      + '  and Ubuntu, postgresql on Fedora and Arch. The server package includes it.');
  }
}

/* ---- take it --------------------------------------------------------- */
fs.mkdirSync(target, { recursive: true, mode: 0o700 });

const name = backupName();
// A dump in progress is NOT given the real name. See the header.
const partial = path.join(target, `${name}.partial`);
const finished = path.join(target, name);

console.log(`\n  taking   ${name}`);
try {
  // An argument array, never a shell string: the connection string holds a
  // password, and a password on a command line assembled by a shell is a
  // password in somebody's process list and history.
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges',
    '--file', partial, '--dbname', url], { stdio: ['ignore', 'inherit', 'inherit'] });
} catch (e) {
  fs.rmSync(partial, { force: true });
  fail(`pg_dump failed: ${e.message.split('\n')[0]}`,
    'Nothing was written. The previous backups are untouched.');
}

/* ---- read it back before trusting it -------------------------------- */
let entries = 0;
try {
  const toc = execFileSync('pg_restore', ['--list', partial], { encoding: 'utf8' });
  entries = toc.split('\n').filter((l) => l && !l.startsWith(';')).length;
  if (!entries) throw new Error('the dump lists nothing');
} catch (e) {
  fs.rmSync(partial, { force: true });
  fail(`the dump could not be read back: ${e.message.split('\n')[0]}`,
    'It has been deleted rather than left looking like a backup.');
}

fs.renameSync(partial, finished);
const { size } = fs.statSync(finished);
console.log(`  ok       ${mb(size)}, ${entries} objects, read back clean`);

/* ---- prune ----------------------------------------------------------- */
const gone = prune(fs.readdirSync(target), keep);
for (const f of gone) fs.rmSync(path.join(target, f), { force: true });
if (gone.length) console.log(`  pruned   ${gone.length} older than the newest ${keep}`);

/* ---- the half this cannot do for you -------------------------------- */
console.log('\n  This covers the database and nothing else. Also yours:\n');
console.log('    .env        two irreplaceable keys. Not copied here on purpose —');
console.log('                that would put them beside the ciphertext they open.');
console.log('                Off this machine, once. INSTALL.md §3.8.');
if (process.env.S3_BUCKET_EVIDENCE) {
  console.log('    the buckets attachment originals. Whatever replication your storage');
  console.log('                provider offers, turn it on.');
}
console.log('    a restore   an untested backup is a belief. INSTALL.md §5.2 has the');
console.log('                pg_restore line; try it somewhere that is not production.\n');
process.exit(0);
