/**
 * The database handle. Created from a URL by whoever needs one: nothing
 * connects at import time, so importing a module never needs a database.
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.gen.ts';

// bigint columns come back as strings by default. Ids here stay far inside
// Number.MAX_SAFE_INTEGER, and a sealed `corrects_id` is a number, so they
// are parsed once here instead of converted at every call site.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// A `date` stays the string Postgres sends ("2026-10-18"). Parsing it into a
// JavaScript Date would shift it by the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Database = Kysely<DB>;

export function createDatabase(connectionString: string, max = 10): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
  });
}
