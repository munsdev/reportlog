/**
 * Schema drift, against real databases (legacy schema-state-selftest).
 *
 * doctor.test.ts judges drift on made-up lists. Drift only exists once
 * `schema_migrations` has rows that disagree with the files on disk, so here
 * each state is made for real and the doctor (`diagnose`) and the migration
 * runner a deploy uses are asked about it:
 *
 *   in step         every file applied: ok
 *   database behind a release started without migrating (legacy's story: new
 *                   code, old schema, every new feature silently absent): fail
 *   database ahead  after a rollback: warn, and a deploy of the older code is
 *                   refused rather than told to migrate
 *   never migrated  a real state, reported, not thrown
 *
 * The shared test database is never touched: each state is its own database.
 */
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import { diagnose } from '../../src/jobs/doctor.ts';

const cleanup: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of cleanup.reverse()) await c();
});

async function database(label: string): Promise<{ url: string; db: Database }> {
  const t = await createThrowawayDatabase(inject('serverUrl'), label);
  const db = createDatabase(t.url, 2);
  cleanup.push(t.drop, () => db.destroy());
  return { url: t.url, db };
}

/** What the doctor says about migrations on this database, as `reportlog doctor` would. */
async function doctorSays(url: string, db: Database) {
  const dir = await mkdtemp(join(tmpdir(), 'rl-drift-'));
  const config = loadConfig({
    DATABASE_URL: url,
    BACKUP_DIR: join(dir, 'none'),
    STATE_DIR: dir,
    PORT: '1',
  });
  const found = (await diagnose({ config, db, server: false, now: new Date() })).filter(
    (f) => f.check === 'migrations',
  );
  expect(found).toHaveLength(1);
  return found[0] as { status: string; detail: string };
}

const applied = async (db: Database) =>
  (
    await sql<{
      filename: string;
    }>`SELECT filename FROM schema_migrations ORDER BY filename`.execute(db)
  ).rows.map((r) => r.filename);

const FILES = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
const NEWEST = FILES.at(-1) ?? '';
const FUTURE = '29991231235959_from_a_newer_release.sql';

describe('schema drift, on real databases', { timeout: 120_000 }, () => {
  it('reads the migrations in the order the runner applies them', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES).toEqual([...FILES].sort());
  });

  it('in step: every file applied is ok, and the doctor writes nothing', async () => {
    const { url, db } = await database('instep');
    await migrate(url);
    const before = await applied(db);
    expect(before).toEqual(FILES);
    expect(await doctorSays(url, db)).toEqual({
      status: 'ok',
      check: 'migrations',
      detail: `all ${String(FILES.length)} applied`,
    });
    expect(await applied(db)).toEqual(before);
  });

  it('database behind the code: fails and names exactly what is missing; a deploy catches it up', async () => {
    const { url, db } = await database('behind');
    // The code before the newest migration, deployed and migrated.
    const older = await mkdtemp(join(tmpdir(), 'rl-drift-older-'));
    for (const f of FILES.slice(0, -1)) await copyFile(join(MIGRATIONS_DIR, f), join(older, f));
    await migrate(url, older);

    // Then this code started without migrating.
    const behind = await doctorSays(url, db);
    expect(behind.status).toBe('fail');
    expect(behind.detail).toBe(
      `1 not applied (${NEWEST}). A deploy migrates before it switches; this release was started some other way.`,
    );

    // What a deploy does before switching: the runner applies exactly that one.
    const result = await migrate(url);
    expect(result.applied).toEqual([NEWEST]);
    expect((await doctorSays(url, db)).status).toBe('ok');
  });

  it('database ahead of the code: a warning, not a failure, and never "migrate"', async () => {
    const { url, db } = await database('ahead');
    await migrate(url);
    // As a newer release left it, before a rollback to this one.
    await sql`INSERT INTO schema_migrations (filename, checksum) VALUES (${FUTURE}, 'x')`.execute(
      db,
    );

    const ahead = await doctorSays(url, db);
    expect(ahead.status).toBe('warn');
    expect(ahead.detail).toContain(
      `the database has 1 migration(s) this release does not (${FUTURE})`,
    );
    expect(ahead.detail).toContain('Expected after a rollback');
    expect(ahead.detail).not.toMatch(/not applied/);

    // Deploying this older code is refused by the runner, and changes nothing.
    await expect(migrate(url)).rejects.toThrow(
      `This database has migrations this code does not: ${FUTURE}`,
    );
    expect(await applied(db)).toEqual([...FILES, FUTURE]);
  });

  it('a database that has never been migrated: every file reported, nothing thrown', async () => {
    const { url, db } = await database('bare');
    const bare = await doctorSays(url, db);
    expect(bare.status).toBe('fail');
    expect(bare.detail).toMatch(
      new RegExp(`^${String(FILES.length)} not applied \\(${FILES[0] ?? ''}, `),
    );
    // The doctor did not create the table on the way.
    const table = await sql<{
      t: string | null;
    }>`SELECT to_regclass('schema_migrations')::text AS t`.execute(db);
    expect(table.rows[0]?.t).toBeNull();
  });
});
