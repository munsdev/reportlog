/**
 * Backups and archive exports from the owner's screen (docs/decisions.md,
 * decision 10). Both were already commands (`reportlog backup`, `anchor
 * export`); this starts the same code from a page and hands over the file.
 *
 *   GET  /api/admin/copies               what is on the server, what is running
 *   POST /api/admin/copies {kind}        start a backup or an export
 *   GET  /api/admin/copies/:kind/:name   download one finished file
 *
 * THE OWNER ONLY, NOT EVERY ADMINISTRATOR. Either file is the whole archive:
 * every report, every account, the contact details under their keys. The
 * scope asks the owner rank from @reportlog/access (`roleGuard(['owner'])`),
 * which nothing satisfies but the owner's seat, and no grant can produce it.
 *
 * NO THIRD PARTY. The file is streamed from this server's disk to the
 * owner's browser, never through a storage provider's link. (The backup's
 * off-site copy is a separate thing: encrypted to keys not on this server.)
 *
 * EVERY DOWNLOAD IS IN THE AUDIT TRAIL (`role_audit`, axis `archive`),
 * written before the first byte leaves, where the people who grant access
 * read who changed what, and where nobody can edit it afterwards.
 *
 * STREAMED, NEVER BUFFERED. A backup is pg_dump writing to disk; an export
 * is written as it is read (archive.ts `writeArchiveFile`); a download is a
 * read stream. Nothing holds a whole archive in memory.
 *
 * Restoring is NOT here, deliberately, as in legacy: restoring rebuilds the
 * database this process is answering from, which it cannot do to itself.
 * An import, likewise, only runs into an empty database (no accounts at
 * all), which a signed-in owner's is not. Both stay on the command line.
 *
 * One job at a time, remembered in memory. A restart forgets a running job;
 * its file was being written under a `.partial` name, which nothing lists,
 * and the next export clears it.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { Database } from '../db/database.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { stepUpGuard } from '../identity/stepUp.ts';
import { bodyOf } from '../identity/http.ts';
import { backupHealth, backupTime, checkDir, ours } from '../jobs/backup-files.ts';
import { CODE_ROOT, readState, runBackup } from '../jobs/backup.ts';
import type { BackupConfig } from '../jobs/backup.ts';
import { writeArchiveFile } from './archive.ts';

export type CopiesConfig = Partial<BackupConfig>;

export interface CopyRouteDeps {
  db: Database;
  config: CopiesConfig;
  /** Lines for the server's log. Never an address or a URL. */
  log?: (line: string) => void;
  now?: () => Date;
}

/** How many exports are kept on the server. Each is the whole archive. */
export const EXPORTS_KEEP = 3;

const EXPORT_NAME = /^reportlog-archive-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json$/;

/** An export's name, from the moment it was started. The backup's own pattern, another word. */
export function exportName(when: Date): string {
  const iso = when.toISOString();
  return `reportlog-archive-${iso.slice(0, 10)}T${iso.slice(11, 13)}-${iso.slice(14, 16)}-${iso.slice(17, 19)}Z.json`;
}

function exportTime(name: string): Date | undefined {
  const m = EXPORT_NAME.exec(name);
  if (!m) return undefined;
  const d = new Date(`${m[1] ?? ''}T${m[2] ?? ''}:${m[3] ?? ''}:${m[4] ?? ''}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Only the exports this wrote, newest first. Anything else in the folder is invisible. */
export function ourExports(names: readonly string[]): string[] {
  return names
    .filter((n) => exportTime(n))
    .sort()
    .reverse();
}

/** The settings a backup needs, or why this server cannot make one. */
function usable(config: CopiesConfig): BackupConfig | string {
  const {
    DATABASE_URL,
    BACKUP_DIR,
    BACKUP_KEEP,
    BACKUP_MAX_AGE_HOURS,
    STATE_DIR,
    BACKUP_S3_PREFIX,
  } = config;
  if (
    !DATABASE_URL ||
    !BACKUP_DIR ||
    !STATE_DIR ||
    BACKUP_KEEP === undefined ||
    BACKUP_MAX_AGE_HOURS === undefined ||
    BACKUP_S3_PREFIX === undefined
  ) {
    return 'This server was started without its backup settings, so it cannot make or list copies here. Use the command line.';
  }
  for (const [name, dir] of [
    ['BACKUP_DIR', BACKUP_DIR],
    ['STATE_DIR', STATE_DIR],
  ] as const) {
    const where = checkDir(dir, CODE_ROOT);
    if (!where.ok) return where.why.replace('BACKUP_DIR', name);
  }
  return {
    ...config,
    DATABASE_URL,
    BACKUP_DIR,
    BACKUP_KEEP,
    BACKUP_MAX_AGE_HOURS,
    STATE_DIR,
    BACKUP_S3_PREFIX,
  };
}

/** Where exports are written: beside the backup job's state, which this process may write. */
export const exportsDir = (config: Pick<BackupConfig, 'STATE_DIR'>) =>
  path.join(path.resolve(config.STATE_DIR), 'exports');

async function listed(
  dir: string,
  pick: (names: string[]) => string[],
  when: (n: string) => Date | undefined,
) {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: C.CopyFile[] = [];
  for (const name of pick(names)) {
    try {
      const { size } = await stat(path.join(dir, name));
      out.push({ name, bytes: size, made_at: (when(name) ?? new Date(0)).toISOString() });
    } catch {
      // Pruned between the listing and the look: not there, so not listed.
    }
  }
  return out;
}

/** A program's error, never with the connection string in it (it can hold a password). */
function plain(text: string, config: Partial<Pick<Config, 'DATABASE_URL'>>): string {
  let out = text;
  if (config.DATABASE_URL) out = out.split(config.DATABASE_URL).join('(the database)');
  return out.replace(/postgres(?:ql)?:\/\/\S+/g, '(the database)').slice(0, 500);
}

/**
 * THE RESTORE, AS SOMEBODY TYPES IT ON THE SERVER, ported from legacy's
 * `restoreCommand`: the service stopped first (nothing answers from a
 * database being rebuilt), run AS THE SERVICE USER, because the dumps sit in
 * a folder only it can enter and a restore run as postgres cannot even open
 * the file, with the address read from the settings file, because it was
 * never in anybody's shell. Then the service started again.
 */
export function restoreCommand(dir: string): string {
  return [
    'sudo systemctl stop reportlog-api',
    "sudo -u reportlog sh -c 'pg_restore --clean --if-exists --no-owner \\",
    '  -d "$(grep ^DATABASE_URL= /etc/reportlog/reportlog.env | cut -d= -f2-)" \\',
    `  ${path.resolve(dir)}/<file>'`,
    'sudo systemctl start reportlog-api',
  ].join('\n');
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type Job = C.CopiesState['running'] & object;

export function copyRoutes(app: FastifyInstance, deps: CopyRouteDeps): void {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const log =
    deps.log ??
    ((line: string) => {
      app.log.info(line);
    });
  let running: Job | null = null;
  let last: Job | null = null;

  async function state(): Promise<C.CopiesState> {
    const cfg = usable(deps.config);
    if (typeof cfg === 'string') {
      return {
        unavailable: cfg,
        backups: [],
        exports: [],
        backup_health: { state: 'none', max_age_hours: 0 },
        offsite: null,
        failure: null,
        running,
        last,
        restore_command: null,
      };
    }
    const backupDir = path.resolve(cfg.BACKUP_DIR);
    const backups = await listed(backupDir, ours, backupTime);
    const health = backupHealth(
      backups.map((b) => b.name),
      now(),
      cfg.BACKUP_MAX_AGE_HOURS,
    );
    const saved = await readState(cfg.STATE_DIR);
    return {
      unavailable: null,
      backups,
      exports: await listed(exportsDir(cfg), ourExports, exportTime),
      backup_health: { state: health.state, max_age_hours: cfg.BACKUP_MAX_AGE_HOURS },
      offsite: saved.offsite ? { at: saved.offsite.at, bytes: saved.offsite.bytes } : null,
      failure: saved.failure ? { ...saved.failure, why: plain(saved.failure.why, cfg) } : null,
      running,
      last,
      restore_command: restoreCommand(cfg.BACKUP_DIR),
    };
  }

  /** Run one job in the background, remembering how it ended. Never throws. */
  function start(kind: 'backup' | 'export', work: () => Promise<{ ok: boolean; summary: string }>) {
    const job: Job = {
      kind,
      started_at: now().toISOString(),
      finished_at: null,
      ok: null,
      summary: null,
    };
    running = job;
    void work()
      .catch((err: unknown) => ({
        ok: false,
        summary: `It stopped: ${err instanceof Error ? err.message : String(err)}`,
      }))
      .then((out) => {
        last = {
          ...job,
          finished_at: now().toISOString(),
          ok: out.ok,
          summary: plain(out.summary, deps.config),
        };
        running = null;
        log(`copies: ${kind} ${out.ok ? 'finished' : 'failed'}`);
      });
  }

  async function backup(cfg: BackupConfig) {
    return runBackup({
      config: cfg,
      args: [],
      now,
      log: (line) => {
        log(`backup: ${line}`);
      },
    });
  }

  async function exportNow(cfg: BackupConfig) {
    const dir = exportsDir(cfg);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // A `.partial` left by a restart mid-export is never listed; clear it.
    for (const n of await readdir(dir)) {
      if (n.endsWith('.json.partial') && EXPORT_NAME.test(n.slice(0, -'.partial'.length))) {
        await rm(path.join(dir, n), { force: true });
      }
    }
    const name = exportName(now());
    const out = await writeArchiveFile(db, path.join(dir, name));
    // Keep the newest few, deleting only files this wrote.
    for (const old of ourExports(await readdir(dir)).slice(EXPORTS_KEEP)) {
      await rm(path.join(dir, old), { force: true });
    }
    return {
      ok: true,
      summary: `Exported ${String(out.reports)} report${out.reports === 1 ? '' : 's'} to ${name} (${mb(out.bytes)}). Lists are left out, as they always are.`,
    };
  }

  void app.register((owner, _opts, done) => {
    owner.addHook('preHandler', roleGuard(['owner']));

    route(owner, C.getCopies, () => state());

    // Making a copy and downloading one ask for the second factor again
    // (plan E, E3). Not the list: the screen asks it again while a copy
    // is being made, which can take longer than a step-up lasts.
    void owner.register((copying, _o, copied) => {
      copying.addHook('preHandler', stepUpGuard());
      route(copying, C.startCopy, async ({ request }) => {
        const { kind } = bodyOf(C.startCopy, request);
        const cfg = usable(deps.config);
        if (typeof cfg === 'string') throw new HttpError(503, 'not_configured', cfg);
        if (running) {
          throw new HttpError(
            409,
            'busy',
            `A ${running.kind === 'backup' ? 'backup' : 'export'} is already being made. Wait for it to finish.`,
          );
        }
        start(kind, () => (kind === 'backup' ? backup(cfg) : exportNow(cfg)));
        return state();
      });

      // Not through `route()`: the answer is the file, streamed, not JSON.
      copying.get<{ Params: { kind: string; name: string } }>(
        C.COPY_DOWNLOAD_PATH,
        async (request, reply) => {
          const user = requireUser(request);
          const cfg = usable(deps.config);
          if (typeof cfg === 'string') throw new HttpError(503, 'not_configured', cfg);
          const { kind, name } = request.params;
          // ONLY A NAME THIS SERVER LISTS. Matched against the folder's own
          // listing, never joined onto a path as given, so nothing in it can
          // reach another file.
          const dir = kind === 'backup' ? path.resolve(cfg.BACKUP_DIR) : exportsDir(cfg);
          const pick = kind === 'backup' ? ours : kind === 'export' ? ourExports : () => [];
          let names: string[] = [];
          try {
            names = pick(await readdir(dir));
          } catch {
            names = [];
          }
          if (!names.includes(name)) throw notFound('There is no such file on this server.');
          const file = path.join(dir, name);
          const { size } = await stat(file);
          const what = kind === 'backup' ? 'the database backup' : 'the archive export';
          await db
            .insertInto('role_audit')
            .values({
              actor_email: user.email,
              subject_email: user.email,
              axis: 'archive',
              action: 'download',
              detail: `${what} ${name} (${mb(size)})`,
            })
            .execute();
          return (
            reply
              .header(
                'content-type',
                kind === 'backup' ? 'application/octet-stream' : 'application/json',
              )
              .header('content-disposition', `attachment; filename="${name}"`)
              .header('content-length', String(size))
              // NEVER CACHED, by a browser or anything between: it is the whole
              // archive, and a copy in a cache is a copy nobody decided to make.
              .header('cache-control', 'no-store')
              .send(createReadStream(file))
          );
        },
      );
      copied();
    });
    done();
  });
}
