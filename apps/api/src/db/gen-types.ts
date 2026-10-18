/**
 * Regenerate src/db/schema.gen.ts from the migrations.
 *
 * Migrates a throwaway database and asks kysely-codegen what it holds, so the
 * types always describe exactly what the migrations produce and nothing a
 * developer's local database happens to have. `--check` changes nothing and
 * fails if the committed file is stale; CI runs that.
 *
 * Two mappings match how src/db/database.ts parses values: int8 is a number,
 * and a `date` stays the string Postgres sent.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.ts';
import { migrate } from './migrate.ts';
import { createThrowawayDatabase } from './throwaway.ts';

const check = process.argv.includes('--check');
const out = fileURLToPath(new URL('./schema.gen.ts', import.meta.url));
const db = await createThrowawayDatabase(loadConfig().DATABASE_URL, 'types');
try {
  await migrate(db.url);
  execFileSync(
    'kysely-codegen',
    [
      '--dialect',
      'postgres',
      '--url',
      db.url,
      '--out-file',
      out,
      '--exclude-pattern',
      'schema_migrations',
      '--date-parser',
      'string',
      '--type-mapping',
      JSON.stringify({ int8: 'number' }),
      ...(check ? ['--verify'] : []),
    ],
    { stdio: 'inherit' },
  );
} finally {
  await db.drop();
}
