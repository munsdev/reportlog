/**
 * The operations jobs against a real database: the credential sweep, a
 * backup that is restored into a second database and compared, the
 * encrypted off-site copy decrypted again, and the doctor.
 *
 * The backup tests run pg_dump, pg_restore, age and age-keygen, as the
 * server does. CI installs them (.github/workflows/ci.yml).
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import type { Config } from '../../src/config.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { readState, runBackup } from '../../src/jobs/backup.ts';
import type { JobContext } from '../../src/jobs/context.ts';
import { diagnose } from '../../src/jobs/doctor.ts';
import { runListsSweep } from '../../src/jobs/lists-sweep.ts';
import type { Uploader } from '../../src/jobs/offsite.ts';
import { NOT_SWEPT, runSweep, sweepExpired, SWEPT } from '../../src/jobs/sweep.ts';
import { ensureFormVersion } from '../../src/chain/forms.ts';
import { fileReport, launchedLogbook, QUESTIONS, testDatabase } from './helpers.ts';

const run = promisify(execFile);

let db: Database;
beforeAll(() => {
  db = testDatabase();
});
afterAll(async () => {
  await db.destroy();
});

function context(
  config: Config,
  args: string[] = [],
  now = new Date(),
): JobContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    config,
    db,
    mailer: capturingMailer(),
    log: (l) => lines.push(l),
    args,
    now: () => now,
    lines,
  };
}

describe('the credential sweep', () => {
  it('deletes expired rows, keeps live ones, and reports each table on its own', async () => {
    await sql`CREATE TABLE sweep_test_tokens (id serial PRIMARY KEY, expires_at timestamptz NOT NULL)`.execute(
      db,
    );
    await sql`CREATE TABLE sweep_test_broken (id serial PRIMARY KEY)`.execute(db);
    try {
      await sql`INSERT INTO sweep_test_tokens (expires_at) VALUES
        (now() - interval '1 day'), (now() - interval '1 minute'), (now() + interval '1 hour')`.execute(
        db,
      );

      const expired = 'expires_at < now()';
      const result = await sweepExpired(db, [
        { table: 'sweep_test_broken', expired },
        { table: 'sweep_test_missing', expired },
        { table: 'sweep_test_tokens', expired },
      ]);
      // A broken table and a missing one do not stop the next being swept.
      expect(result.sweep_test_broken).toMatchObject({
        error: expect.stringMatching(/expires_at/) as string,
      });
      expect(result.sweep_test_missing).toBe('absent');
      expect(result.sweep_test_tokens).toBe(2);
      const left = await sql<{ n: string }>`SELECT count(*) AS n FROM sweep_test_tokens`.execute(
        db,
      );
      expect(Number(left.rows[0]?.n)).toBe(1);

      // Safe to run twice.
      expect(
        (await sweepExpired(db, [{ table: 'sweep_test_tokens', expired }])).sweep_test_tokens,
      ).toBe(0);
    } finally {
      await sql`DROP TABLE sweep_test_tokens, sweep_test_broken`.execute(db);
    }
  });

  it('cannot delete from an append-only table even if one were listed', async () => {
    // The database refuses, whatever this list says. Belt and braces. A
    // report first: a row trigger has nothing to refuse on an empty table.
    await fileReport(db, await launchedLogbook(db), { what: 'Kept forever.' });
    const result = await sweepExpired(db, [{ table: 'reports', expired: 'true' }]);
    expect(result.reports).toMatchObject({ error: expect.any(String) as string });
  });

  it('as a job, sweeps every named table without an error', async () => {
    const ctx = context(loadConfig({ DATABASE_URL: inject('databaseUrl') }));
    const outcome = await runSweep(ctx);
    expect(outcome).toMatchObject({ ok: true });
    expect(ctx.lines.join('\n')).not.toMatch(/FAILED|does not exist/);
  });

  it('deletes an unconfirmed report past its link, and never a live one or a confirmed one', async () => {
    const lb = await launchedLogbook(db);
    const form = await ensureFormVersion(db, { ...lb, launched_at: new Date() }, QUESTIONS);
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    const common = { logbook_id: lb.id, form_id: form.id, payload: JSON.stringify({}) };
    await db
      .insertInto('report_submissions')
      .values([
        { ...common, token_hash: '1'.repeat(64), email: 'a@example.org', expires_at: past },
        { ...common, token_hash: '2'.repeat(64), email: 'b@example.org', expires_at: future },
        {
          ...common,
          token_hash: '3'.repeat(64),
          email: null,
          expires_at: past,
          confirmed_at: past,
          thread_id: '7f9c2c1e-3b4a-4d5e-8f60-1a2b3c4d5e6f',
        },
      ])
      .execute();
    await runSweep(context(loadConfig({ DATABASE_URL: inject('databaseUrl') })));
    const left = await db
      .selectFrom('report_submissions')
      .select(['email', 'confirmed_at'])
      .where('logbook_id', '=', lb.id)
      .orderBy('id')
      .execute();
    expect(left.map((r) => r.email ?? 'confirmed')).toEqual(['b@example.org', 'confirmed']);
  });

  it("never names the reporters' contact keys, their addresses, or a list table", async () => {
    const swept = SWEPT.map((t) => t.table);
    for (const never of ['contact_keys', 'report_contacts']) expect(swept).not.toContain(never);
    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND (table_name LIKE 'list%' OR table_name = 'link_index')`.execute(
      db,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { table_name } of rows) expect(swept).not.toContain(table_name);
  });

  it('has decided about every table with an expires_at column', async () => {
    // NOT discovery: the sweep never scans. This makes a NEW table with the
    // column fail here until somebody chooses, in jobs/sweep.ts, whether it
    // is swept (SWEPT) or deliberately not (NOT_SWEPT, with the reason).
    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'expires_at'`.execute(db);
    const decided = new Set([...SWEPT, ...NOT_SWEPT].map((t) => t.table));
    expect(rows.map((r) => r.table_name).filter((t) => !decided.has(t))).toEqual([]);
  });
});

describe('the backup', () => {
  let dir: string;
  let config: Config;
  let identity: string;
  let recipient: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-backup-'));
    identity = join(dir, 'key.txt');
    await run('age-keygen', ['-o', identity]);
    recipient = /public key: (age1\S+)/.exec(await readFile(identity, 'utf8'))?.[1] ?? '';
    config = loadConfig({
      DATABASE_URL: inject('databaseUrl'),
      BACKUP_DIR: join(dir, 'dumps'),
      STATE_DIR: join(dir, 'state'),
      BACKUP_KEEP: '2',
    });
    const lb = await launchedLogbook(db);
    await fileReport(db, lb, { what: 'The backup must hold this report.' });
  });

  it('takes a dump that restores into an empty database with every report intact', async () => {
    const ctx = context(config);
    const outcome = await runBackup(ctx);
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.summary).toMatch(/no off-site copy/);

    const names = await readdir(config.BACKUP_DIR);
    expect(names.filter((n) => n.endsWith('.partial'))).toEqual([]);
    const dump = names.find((n) => n.endsWith('.dump'));
    expect(dump).toBeDefined();

    const restored = await createThrowawayDatabase(inject('serverUrl'), 'restore');
    const copy = createDatabase(restored.url, 2);
    try {
      await run('pg_restore', [
        '--no-owner',
        '--dbname',
        restored.url,
        join(config.BACKUP_DIR, dump ?? ''),
      ]);
      const fingerprint = (d: Database) =>
        sql<{ n: string; h: string }>`
          SELECT count(*)::text AS n, string_agg(content_hash, ',' ORDER BY id) AS h FROM reports`
          .execute(d)
          .then((r) => r.rows[0]);
      const original = await fingerprint(db);
      expect(Number(original?.n)).toBeGreaterThan(0);
      expect(await fingerprint(copy)).toEqual(original);
    } finally {
      await copy.destroy();
      await restored.drop();
    }

    const state = await readState(config.STATE_DIR);
    expect(state.local?.name).toBe(dump);
    expect(state.offsite).toBeUndefined();
  });

  it('encrypts the off-site copy so only the private key opens it, and sends nothing in plaintext', async () => {
    const sent: { file: string; key: string; bytes: Buffer }[] = [];
    const uploader: Uploader = {
      async upload(file, key) {
        const bytes = await readFile(file);
        sent.push({ file, key, bytes });
        return { bytes: bytes.length };
      },
    };
    const offsite = loadConfig({
      DATABASE_URL: inject('databaseUrl'),
      BACKUP_DIR: config.BACKUP_DIR,
      STATE_DIR: config.STATE_DIR,
      BACKUP_KEEP: '2',
      BACKUP_AGE_RECIPIENTS: recipient,
      BACKUP_S3_ENDPOINT: 'https://objects.example.org',
      BACKUP_S3_REGION: 'fsn1',
      BACKUP_S3_BUCKET: 'b',
      BACKUP_S3_ACCESS_KEY_ID: 'id',
      BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
    });
    const later = new Date(Date.now() + 2000);
    const outcome = await runBackup(context(offsite, [], later), uploader);
    expect(outcome).toMatchObject({ ok: true });

    expect(sent).toHaveLength(1);
    const [upload] = sent;
    expect(upload?.key).toMatch(/^reportlog\/reportlog-.*Z\.dump\.age$/);
    // Not a PostgreSQL dump on the wire: custom-format dumps start "PGDMP".
    expect(upload?.bytes.subarray(0, 5).toString()).not.toBe('PGDMP');
    expect(upload?.bytes.toString('latin1')).not.toContain('The backup must hold this report.');

    // And the key that is not on the server opens it into the dump itself.
    const encrypted = join(dir, 'copy.age');
    await writeFile(encrypted, upload?.bytes ?? Buffer.alloc(0));
    const decrypted = join(dir, 'copy.dump');
    await run('age', ['-d', '-i', identity, '-o', decrypted, encrypted]);
    const local = join(
      config.BACKUP_DIR,
      (upload?.key ?? '').replace(/^reportlog\//, '').replace(/\.age$/, ''),
    );
    expect(await readFile(decrypted)).toEqual(await readFile(local));

    // The encrypted file was only ever a thing to send.
    expect((await readdir(config.BACKUP_DIR)).filter((n) => n.endsWith('.age'))).toEqual([]);
    expect((await readState(config.STATE_DIR)).offsite?.key).toBe(upload?.key);
  });

  it('records a failed upload for the doctor and keeps the local dump', async () => {
    const failing: Uploader = {
      upload: () => Promise.reject(new Error('AccessDenied: the key may not write here')),
    };
    const offsite = loadConfig({
      DATABASE_URL: inject('databaseUrl'),
      BACKUP_DIR: config.BACKUP_DIR,
      STATE_DIR: config.STATE_DIR,
      BACKUP_KEEP: '2',
      BACKUP_AGE_RECIPIENTS: recipient,
      BACKUP_S3_ENDPOINT: 'https://objects.example.org',
      BACKUP_S3_REGION: 'fsn1',
      BACKUP_S3_BUCKET: 'b',
      BACKUP_S3_ACCESS_KEY_ID: 'id',
      BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
    });
    const outcome = await runBackup(context(offsite, [], new Date(Date.now() + 4000)), failing);
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/upload.*AccessDenied/);
    const state = await readState(config.STATE_DIR);
    expect(state.failure?.step).toBe('upload');
    expect(state.local?.name).toBeDefined();
  });

  it('prunes to BACKUP_KEEP and leaves files it did not write alone', async () => {
    const byHand = join(config.BACKUP_DIR, 'before-upgrade.dump');
    const [first] = (await readdir(config.BACKUP_DIR)).filter((n) => n.endsWith('.dump')).sort();
    await copyFile(join(config.BACKUP_DIR, first ?? ''), byHand);
    await runBackup(context(config, [], new Date(Date.now() + 6000)));
    const names = (await readdir(config.BACKUP_DIR)).sort();
    expect(names.filter((n) => n.startsWith('reportlog-'))).toHaveLength(2);
    expect(names).toContain('before-upgrade.dump');
  });

  it('--check reports without taking one', async () => {
    const before = await readdir(config.BACKUP_DIR);
    const outcome = await runBackup(context(config, ['--check']));
    expect(outcome).toMatchObject({ ok: true });
    expect(await readdir(config.BACKUP_DIR)).toEqual(before);
  });

  it('refuses to put dumps inside the code', async () => {
    const inside = loadConfig({ DATABASE_URL: inject('databaseUrl'), BACKUP_DIR: 'apps/web/dist' });
    expect((await runBackup(context(inside))).ok).toBe(false);
  });

  it('fails cleanly, keeping nothing half-written, when the database cannot be dumped', async () => {
    const broken = loadConfig({
      DATABASE_URL: inject('databaseUrl').replace(/\/([^/?]+)(\?|$)/, '/does_not_exist$2'),
      BACKUP_DIR: join(dir, 'broken'),
      STATE_DIR: join(dir, 'broken-state'),
    });
    const outcome = await runBackup(context(broken));
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/pg_dump/);
    expect(await readdir(broken.BACKUP_DIR)).toEqual([]);
    expect((await readState(broken.STATE_DIR)).failure?.step).toBe('pg_dump');
  });
});

describe('the lists sweep, as a job', () => {
  it("runs E's sweep and reports each step", async () => {
    const ctx = context(loadConfig({ DATABASE_URL: inject('databaseUrl') }));
    const outcome = await runListsSweep(ctx);
    expect(outcome).toMatchObject({ ok: true });
    expect(ctx.lines.join('\n')).not.toMatch(/FAILED/);
  });
});

describe('the doctor, off a server', () => {
  it('checks the database and migrations and says what a development checkout lacks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rl-doctor-'));
    const config = loadConfig({
      DATABASE_URL: inject('databaseUrl'),
      BACKUP_DIR: join(dir, 'none'),
      STATE_DIR: dir,
      PORT: '1',
    });
    const findings = await diagnose({ config, db, server: false, now: new Date() });
    const by = (check: string) => findings.filter((f) => f.check === check).map((f) => f.status);
    expect(by('database')).toEqual(['ok']);
    expect(by('migrations')).toEqual(['ok']);
    expect(by('email')).toEqual(['warn']);
    expect(by('backup')).toEqual(['fail']);
    expect(by('jobs')).toEqual(['warn']);
    // Server-only checks are skipped, not failed.
    expect(by('postgres')).toEqual([]);
    expect(by('updates')).toEqual([]);
  });
});
