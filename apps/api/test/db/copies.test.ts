/**
 * Backups and archive exports from the owner's screen (decision 10), through
 * the real routes, against a database of its own (an export reads every
 * table, and the import at the end needs a source nothing else wrote into).
 *
 * What must hold:
 *   - the OWNER only: not an administrator, not a moderator, not a stranger;
 *   - a backup started here is a real dump, and the file handed over is
 *     byte for byte the one on disk;
 *   - an export started here replays into an empty archive with every
 *     fingerprint as it was, which is the whole point of one;
 *   - each download is in the audit trail before the file leaves, and
 *     nothing but a file this server lists can be asked for;
 *   - the export is written as it is read, a batch at a time.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { importArchive, writeArchive } from '../../src/anchor/archive.ts';
import type { Archive } from '../../src/anchor/archive.ts';
import { restoreCommand } from '../../src/anchor/copies.ts';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import type { Config } from '../../src/config.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import type { CapturingMailer } from '../../src/email/mailer.ts';
import { fileReport, launchedLogbook } from './helpers.ts';
import { address, seat, signIn } from './identity-helpers.ts';

const run = promisify(execFile);

let source: Throwaway;
let db: Database;
let app: FastifyInstance;
let mailer: CapturingMailer;
let tmp: string;
let config: Config;
let owner: { email: string; token: string };
let admin: string;
let moderator: string;
const refs: string[] = [];

interface Copy {
  name: string;
  bytes: number;
}
interface State {
  unavailable: string | null;
  backups: Copy[];
  exports: Copy[];
  running: { kind: string } | null;
  last: { kind: string; ok: boolean; summary: string } | null;
  restore_command: string | null;
}

const as = (token?: string) => (token ? { cookies: { session_token: token } } : {});
const getState = async (token = owner.token) =>
  (await app.inject({ method: 'GET', url: '/api/admin/copies', ...as(token) })).json<State>();
const start = (kind: string, token = owner.token) =>
  app.inject({ method: 'POST', url: '/api/admin/copies', payload: { kind }, ...as(token) });

/** Ask until the job is done, as the screen does. */
async function finished(): Promise<State> {
  for (let i = 0; i < 300; i += 1) {
    const s = await getState();
    if (!s.running) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the job never finished');
}

const downloads = () =>
  db
    .selectFrom('role_audit')
    .select(['actor_email', 'subject_email', 'detail'])
    .where('axis', '=', 'archive')
    .where('action', '=', 'download')
    .orderBy('id')
    .execute();

beforeAll(async () => {
  source = await createThrowawayDatabase(inject('serverUrl'), 'copies');
  await migrate(source.url);
  db = createDatabase(source.url, 5);
  tmp = mkdtempSync(join(tmpdir(), 'rl-copies-'));
  config = loadConfig({
    DATABASE_URL: source.url,
    BACKUP_DIR: join(tmp, 'dumps'),
    STATE_DIR: join(tmp, 'state'),
    BACKUP_KEEP: '3',
  });
  mailer = capturingMailer();
  app = await buildApp({ config: { ...config, LOG_LEVEL: 'silent' }, db, mailer });

  const lb = await launchedLogbook(db);
  for (const what of ['The first account.', 'The second account.']) {
    refs.push((await fileReport(db, lb, { what })).row.public_ref);
  }
  const h = { app, mailer, db, close: () => Promise.resolve() };
  owner = { email: address('copies-owner'), token: '' };
  await seat(db, owner.email, 'owner');
  owner.token = await signIn(h, owner.email);
  const a = address('copies-admin');
  await seat(db, a, 'admin');
  admin = await signIn(h, a);
  const m = address('copies-moderator');
  await seat(db, m, 'moderator');
  moderator = await signIn(h, m);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
  await source.drop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('the owner only', () => {
  it('refuses a stranger, a moderator and an administrator, on every route', async () => {
    await mkdir(config.BACKUP_DIR, { recursive: true });
    const name = 'reportlog-2026-10-01T03-00-00Z.dump';
    writeFileSync(join(config.BACKUP_DIR, name), 'a dump');
    for (const [who, token, status] of [
      ['a stranger', undefined, 401],
      ['a moderator', moderator, 403],
      ['an administrator', admin, 403],
    ] as const) {
      for (const req of [
        { method: 'GET' as const, url: '/api/admin/copies' },
        { method: 'POST' as const, url: '/api/admin/copies', payload: { kind: 'backup' } },
        { method: 'GET' as const, url: `/api/admin/copies/backup/${name}` },
      ]) {
        const res = await app.inject({ ...req, ...as(token) });
        expect({ who, url: req.url, status: res.statusCode }).toEqual({
          who,
          url: req.url,
          status,
        });
      }
    }
    expect(await downloads()).toEqual([]);
    expect((await getState()).running).toBeNull();
    rmSync(join(config.BACKUP_DIR, name));
  });
});

describe('a backup from the screen', () => {
  let made: Copy;

  it('starts, runs in the background, and lists the dump it took', async () => {
    const res = await start('backup');
    expect(res.statusCode).toBe(200);
    expect(res.json<State>().running).toMatchObject({ kind: 'backup' });
    const done = await finished();
    expect(done.last).toMatchObject({ kind: 'backup', ok: true });
    expect(done.last?.summary).toMatch(/Backed up reportlog-.*\.dump/);
    // The connection string (it can hold a password) is never on the screen.
    expect(JSON.stringify(done)).not.toContain(source.url);
    expect(done.backups).toHaveLength(1);
    made = done.backups[0] ?? { name: '', bytes: 0 };
    expect(made.bytes).toBeGreaterThan(0);
  });

  it('hands over exactly the file on disk, uncached, and the trail says who took it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/copies/backup/${made.name}`,
      ...as(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${made.name}"`);
    expect(res.rawPayload.equals(readFileSync(join(config.BACKUP_DIR, made.name)))).toBe(true);
    // A real dump: pg_restore reads its table of contents back.
    const copy = join(tmp, 'downloaded.dump');
    writeFileSync(copy, res.rawPayload);
    const { stdout } = await run('pg_restore', ['--list', copy]);
    expect(stdout).toMatch(/TABLE public reports/);

    const trail = await downloads();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actor_email: owner.email, subject_email: owner.email });
    expect(trail[0]?.detail).toContain(made.name);
    // And it is in the same trail the people who grant access read.
    const audit = await app.inject({ method: 'GET', url: '/api/access/audit', ...as(admin) });
    expect(audit.body).toContain(made.name);
  });

  it('one at a time: a second start while one runs is refused with a sentence', async () => {
    const first = await start('backup');
    expect(first.statusCode).toBe(200);
    const second = await start('export');
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { message: string } }>().error.message).toMatch(
      /already being made/,
    );
    await finished();
  });

  it('offers the restore as a command for the server, run as the service user', () => {
    const cmd = restoreCommand('/var/backups/reportlog');
    expect(cmd).toMatch(/^sudo -u reportlog sh -c 'pg_restore --clean --if-exists/m);
    expect(cmd).toContain('/etc/reportlog/reportlog.env');
    expect(cmd).toContain("/var/backups/reportlog/<file>'");
    expect(cmd).not.toMatch(/-u postgres/);
    expect(cmd.indexOf('systemctl stop')).toBeLessThan(cmd.indexOf('pg_restore'));
    expect(cmd.indexOf('systemctl start')).toBeGreaterThan(cmd.indexOf('pg_restore'));
  });
});

describe('an archive export from the screen', () => {
  let made: Copy;
  let file: Archive;

  it('writes the whole archive to a file and lists it', async () => {
    expect((await start('export')).statusCode).toBe(200);
    const done = await finished();
    expect(done.last).toMatchObject({ kind: 'export', ok: true });
    expect(done.last?.summary).toMatch(/Exported 2 reports to reportlog-archive-.*\.json/);
    made = done.exports[0] ?? { name: '', bytes: 0 };
    expect(made.name).toMatch(/^reportlog-archive-.*\.json$/);
  });

  it('the downloaded file replays into an empty archive with every fingerprint as it was', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/copies/export/${made.name}`,
      ...as(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    file = JSON.parse(res.body) as Archive;
    expect(file.reports.map((r) => r.sealed.public_ref)).toEqual(refs);

    const target = await createThrowawayDatabase(inject('serverUrl'), 'copiesin');
    await migrate(target.url);
    const dst = createDatabase(target.url, 2);
    try {
      const out = await importArchive(dst, file);
      expect(out.identical).toBe(true);
      const back = await dst
        .selectFrom('reports')
        .select(['public_ref', 'content_hash', 'chain_hash'])
        .orderBy('id')
        .execute();
      expect(back).toEqual(
        file.reports.map((r) => ({
          public_ref: r.sealed.public_ref,
          content_hash: r.content_hash,
          chain_hash: r.chain_hash,
        })),
      );
    } finally {
      await dst.destroy();
      await target.drop();
    }
    expect((await downloads()).map((d) => d.detail).at(-1)).toContain(made.name);
  });

  it('keeps only the newest few, deleting only files it wrote', async () => {
    const dir = join(config.STATE_DIR, 'exports');
    writeFileSync(join(dir, 'kept-by-hand.json'), '{}');
    for (let i = 0; i < 3; i += 1) {
      // Names are by the second, so each waits for a new one.
      await new Promise((r) => setTimeout(r, 1100));
      await start('export');
      await finished();
    }
    const s = await getState();
    expect(s.exports).toHaveLength(3);
    expect(s.exports.map((e) => e.name)).not.toContain(made.name);
    expect(readFileSync(join(dir, 'kept-by-hand.json'), 'utf8')).toBe('{}');
  });
});

describe('nothing but a file this server lists', () => {
  it('a name it did not write, or a path, is "not found", and is not in the trail', async () => {
    const before = (await downloads()).length;
    writeFileSync(join(config.BACKUP_DIR, 'notes.txt'), 'by hand');
    for (const url of [
      '/api/admin/copies/backup/notes.txt',
      `/api/admin/copies/backup/${encodeURIComponent('../state/backup.json')}`,
      `/api/admin/copies/export/${encodeURIComponent('../../etc/passwd')}`,
      '/api/admin/copies/elsewhere/reportlog-2026-10-01T03-00-00Z.dump',
    ]) {
      const res = await app.inject({ method: 'GET', url, ...as(owner.token) });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 404 });
    }
    expect(await downloads()).toHaveLength(before);
  });
});

describe('streamed, not buffered', () => {
  it('the export arrives a batch at a time, never as one piece', async () => {
    // Enough rows in one table to need several reads of the cursor.
    await sql`INSERT INTO role_audit (actor_email, subject_email, axis, action, detail)
      SELECT 'x@example.org', 'y@example.org', 'site', 'change', 'row ' || g
      FROM generate_series(1, 1600) g`.execute(db);
    const chunks: string[] = [];
    await writeArchive(db, (c) => {
      chunks.push(c);
      return Promise.resolve();
    });
    const text = chunks.join('');
    const parsed = JSON.parse(text) as Archive;
    expect(parsed.tables.role_audit?.rows.length).toBeGreaterThanOrEqual(1600);
    const withRows = chunks.filter((c) => c.includes('"detail":"row '));
    expect(withRows.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(text.length / 3);
  });
});

describe('a server without its backup settings', () => {
  it('says so, and starts nothing', async () => {
    const bare = await buildApp({
      config: { LOG_LEVEL: 'silent' },
      db,
      mailer,
    });
    try {
      const st = await bare.inject({ method: 'GET', url: '/api/admin/copies', ...as(owner.token) });
      expect(st.json<State>().unavailable).toMatch(/without its backup settings/);
      expect(st.json<State>().restore_command).toBeNull();
      const go = await bare.inject({
        method: 'POST',
        url: '/api/admin/copies',
        payload: { kind: 'backup' },
        ...as(owner.token),
      });
      expect(go.statusCode).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
