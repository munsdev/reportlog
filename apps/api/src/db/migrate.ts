/**
 * The migration runner. Plain SQL files, applied in name order, each in its
 * own transaction.
 *
 * WHY PLAIN SQL. The guarantees this archive makes live in the database:
 * append-only triggers, the chain-link check, CHECK constraints. Those are
 * SQL, so the migrations are SQL, and the TypeScript types are generated from
 * the migrated database (`pnpm db:types`) rather than written beside it.
 *
 * MIGRATIONS ARE ADDITIVE AND NEVER EDITED. Each applied file's checksum is
 * recorded, and the runner refuses to run against a database where an
 * applied file has since changed or gone missing.
 *
 * NAMES ARE TIMESTAMPS (`20261018000000_core.sql`) so that parallel branches
 * never collide on a number. A file older than the newest applied one is
 * still applied: on a merged branch that is expected, not an error.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(
  connectionString: string,
  dir: string = MIGRATIONS_DIR,
  log: (line: string) => void = () => undefined,
): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const bad = files.filter((f) => !NAME.test(f));
  if (bad.length) {
    throw new Error(
      `Migration names must look like 20261018000000_what_it_does.sql: ${bad.join(', ')}`,
    );
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // One runner at a time, however many servers start at once.
    await client.query("SELECT pg_advisory_lock(hashtext('reportlog_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    const missing = [...applied.keys()].filter((f) => !files.includes(f));
    if (missing.length) {
      throw new Error(
        `This database has migrations this code does not: ${missing.join(', ')}. ` +
          'It was migrated by a newer version.',
      );
    }

    const result: MigrationResult = { applied: [], skipped: [] };
    for (const file of files) {
      const sql = await readFile(`${dir}/${file}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const recorded = applied.get(file);
      if (recorded !== undefined) {
        if (recorded !== checksum) {
          throw new Error(
            `${file} has changed since it was applied. Migrations are never edited: ` +
              'write a new one instead.',
          );
        }
        result.skipped.push(file);
        continue;
      }
      log(`Applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file} failed: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client.end();
  }
}
