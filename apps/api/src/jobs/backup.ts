/**
 * The backup job.
 *
 *   reportlog backup            take one now
 *   reportlog backup --check    report on what is there, take nothing
 *
 * WHAT A RUN DOES, and why each step is there:
 *
 *   1. pg_dump to a `.partial` name. A dump interrupted half way (disk full,
 *      reboot) is a plausible-looking file of the wrong length; only a
 *      finished, checked dump ever gets the real name.
 *   2. pg_restore --list reads the dump's own table of contents back. Not a
 *      restore, but proof the file is a complete dump rather than half of one.
 *   3. Keep the newest BACKUP_KEEP dumps on this server, deleting only files
 *      this job named.
 *   4. If off-site storage is configured: encrypt the dump with age to the
 *      BACKUP_AGE_RECIPIENTS public keys and upload the encrypted file. The
 *      private key is not on this server, so neither this server nor the
 *      storage provider can read the copy. A plaintext copy never leaves.
 *   5. Record what happened in STATE_DIR/backup.json for the doctor.
 *
 * Programs are run with argument arrays, never through a shell: the
 * connection string can hold a password.
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Config } from '../config.ts';
import type { JobContext, JobOutcome } from './context.ts';
import {
  ageRecipients,
  backupHealth,
  backupName,
  badRecipients,
  checkDir,
  ours,
  prune,
} from './backup-files.ts';
import type { Uploader } from './offsite.ts';
import { offsiteTarget, s3Uploader } from './offsite.ts';

const run = promisify(execFile);

/** The repository root: dumps may not go anywhere under it. */
export const CODE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * What a backup reads: the job runner's context, or the owner's screen
 * (anchor/copies.ts), which has no mailer and no command line of its own.
 */
export type BackupConfig = Pick<
  Config,
  | 'DATABASE_URL'
  | 'BACKUP_DIR'
  | 'BACKUP_KEEP'
  | 'BACKUP_MAX_AGE_HOURS'
  | 'STATE_DIR'
  | 'BACKUP_AGE_RECIPIENTS'
  | 'BACKUP_S3_ENDPOINT'
  | 'BACKUP_S3_REGION'
  | 'BACKUP_S3_BUCKET'
  | 'BACKUP_S3_PREFIX'
  | 'BACKUP_S3_ACCESS_KEY_ID'
  | 'BACKUP_S3_SECRET_ACCESS_KEY'
>;
export type BackupContext = Pick<JobContext, 'log' | 'args' | 'now'> & { config: BackupConfig };

export interface BackupState {
  local?: { at: string; name: string; bytes: number; objects: number };
  offsite?: { at: string; key: string; bytes: number };
  /** The last run that failed, and why. Cleared by the next success. */
  failure?: { at: string; step: string; why: string };
}

export function statePath(stateDir: string): string {
  return path.join(stateDir, 'backup.json');
}

async function writeState(stateDir: string, state: BackupState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const file = statePath(stateDir);
  // Renamed into place, so the doctor never reads half a file.
  await writeFile(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

export async function readState(stateDir: string): Promise<BackupState> {
  const { readFile } = await import('node:fs/promises');
  try {
    return JSON.parse(await readFile(statePath(stateDir), 'utf8')) as BackupState;
  } catch {
    return {};
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
/** What a failed program said, or the error's message when it said nothing. */
const firstLine = (err: unknown) => {
  const stderr = err instanceof Error ? ((err as { stderr?: string }).stderr?.trim() ?? '') : '';
  const text = stderr.length > 0 ? stderr : err instanceof Error ? err.message : String(err);
  return text.trim().split('\n')[0] ?? '';
};

export async function runBackup(ctx: BackupContext, uploader?: Uploader): Promise<JobOutcome> {
  const { config } = ctx;
  const where = checkDir(config.BACKUP_DIR, CODE_ROOT);
  if (!where.ok) return { ok: false, summary: `${where.why} Put the backups somewhere else.` };
  const dir = where.target;

  if (ctx.args.includes('--check')) return check(ctx, dir);

  // What the doctor will read. Each step that succeeds adds to it; a step
  // that fails records why, keeping what the earlier steps did.
  let state: BackupState = await readState(config.STATE_DIR);
  const failed = async (step: string, why: string): Promise<JobOutcome> => {
    await writeState(config.STATE_DIR, {
      ...state,
      failure: { at: ctx.now().toISOString(), step, why },
    });
    return { ok: false, summary: `Backup failed at ${step}: ${why}` };
  };

  // Checked before the dump, not after: an off-site copy that cannot be
  // encrypted must not be discovered an hour into the night.
  const target = offsiteTarget(config);
  const recipients = ageRecipients(config.BACKUP_AGE_RECIPIENTS);
  if (target) {
    const bad = badRecipients(recipients);
    if (!recipients.length || bad.length) {
      return failed(
        'settings',
        'BACKUP_AGE_RECIPIENTS must be one or more age public keys (age1…).',
      );
    }
  }

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    // On a server this is usually ReadWritePaths in the backup unit's
    // drop-in not naming BACKUP_DIR.
    return failed('directory', `${dir} cannot be created (${firstLine(err)})`);
  }
  const name = backupName(ctx.now());
  const partial = path.join(dir, `${name}.partial`);
  const finished = path.join(dir, name);

  ctx.log(`taking   ${name}`);
  try {
    await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      partial,
      '--dbname',
      config.DATABASE_URL,
    ]);
  } catch (err) {
    await rm(partial, { force: true });
    return failed('pg_dump', firstLine(err));
  }

  let objects = 0;
  try {
    const { stdout } = await run('pg_restore', ['--list', partial], {
      maxBuffer: 64 * 1024 * 1024,
    });
    objects = stdout.split('\n').filter((l) => l && !l.startsWith(';')).length;
    if (!objects) throw new Error('the dump lists nothing');
  } catch (err) {
    await rm(partial, { force: true });
    return failed(
      'read-back',
      `the dump could not be read back (${firstLine(err)}); it was deleted`,
    );
  }
  await rename(partial, finished);
  const { size } = await stat(finished);
  ctx.log(`ok       ${mb(size)}, ${String(objects)} objects, read back clean`);

  const gone = prune(await readdir(dir), config.BACKUP_KEEP);
  for (const f of gone) await rm(path.join(dir, f), { force: true });
  if (gone.length)
    ctx.log(`pruned   ${String(gone.length)} older than the newest ${String(config.BACKUP_KEEP)}`);

  state = { ...state, local: { at: ctx.now().toISOString(), name, bytes: size, objects } };
  delete state.failure;

  if (!target) {
    ctx.log('off-site  not configured (BACKUP_S3_*): this backup exists on this server only');
    await writeState(config.STATE_DIR, state);
    return { ok: true, summary: `Backed up ${name} (${mb(size)}); no off-site copy configured.` };
  }

  const encrypted = `${finished}.age`;
  try {
    await run('age', [...recipients.flatMap((r) => ['-r', r]), '-o', encrypted, finished]);
  } catch (err) {
    await rm(encrypted, { force: true });
    return failed('encrypt', firstLine(err));
  }
  const key = `${target.prefix}${name}.age`;
  try {
    const { bytes } = await (uploader ?? s3Uploader(target)).upload(encrypted, key);
    state.offsite = { at: ctx.now().toISOString(), key, bytes };
    ctx.log(`off-site ${key}, ${mb(bytes)}, encrypted to ${String(recipients.length)} key(s)`);
  } catch (err) {
    return await failed('upload', firstLine(err));
  } finally {
    // The encrypted copy exists to be sent; the plaintext dump stays here.
    await rm(encrypted, { force: true });
  }

  await writeState(config.STATE_DIR, state);
  return {
    ok: true,
    summary: `Backed up ${name} (${mb(size)}) and sent an encrypted copy off-site.`,
  };
}

async function check(ctx: BackupContext, dir: string): Promise<JobOutcome> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    ctx.log(`${dir} does not exist yet`);
  }
  const health = backupHealth(names, ctx.now(), ctx.config.BACKUP_MAX_AGE_HOURS);
  for (const f of ours(names).slice(0, 5)) {
    const { size } = await stat(path.join(dir, f));
    ctx.log(`  ${f}  ${mb(size)}`);
  }
  const state = await readState(ctx.config.STATE_DIR);
  if (state.offsite) ctx.log(`last off-site copy: ${state.offsite.key} at ${state.offsite.at}`);
  if (health.state === 'none') return { ok: false, summary: `No backups in ${dir}.` };
  return {
    ok: health.state === 'ok',
    summary: `${String(health.count)} backup(s), newest ${String(health.ageHours)}h old${
      health.state === 'stale' ? ` (older than ${String(ctx.config.BACKUP_MAX_AGE_HOURS)}h)` : ''
    }.`,
  };
}
