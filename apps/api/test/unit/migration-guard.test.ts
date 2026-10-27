/**
 * Migrations only add (plan 2026-10-27, section 4, layer 1).
 *
 * Every migration file that is not in BASELINE_MIGRATIONS is new work, and it
 * is held to test/support/migration-rules.ts: CREATE, or ADD COLUMN that is
 * nullable or has a constant default. Nothing here touches a database, so it
 * runs with `pnpm check` and a violation shows up before the slower suites.
 *
 * A DELIBERATE EXCEPTION is listed in EXCEPTIONS by file name, with the
 * reason, and shows up in review as a change to this file. Write one only
 * when the owner has agreed that a migration may change what exists.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASELINE_MIGRATIONS } from '../support/baseline-migrations.ts';
import { isConstantDefault, judgeMigration, splitStatements } from '../support/migration-rules.ts';

/** file name -> why it may do more than add. Empty, and meant to stay so. */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  '20261027014500_filing_limits.sql':
    'Widens the CHECK on report_permissions_log.permission by one allowed value (journalist_sharing). No row changes, the log stays append-only, and an older release never writes the new value, so it runs unchanged. Reviewed by the integrator, 27 October 2026.',
};

const DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('the migrations that were on main on 27 October 2026', () => {
  it('are all still here, and unedited', () => {
    const problems: string[] = [];
    for (const [name, checksum] of Object.entries(BASELINE_MIGRATIONS)) {
      if (!files.includes(name)) {
        problems.push(`${name} is gone`);
        continue;
      }
      if (sha(readFileSync(`${DIR}${name}`, 'utf8')) !== checksum)
        problems.push(`${name} was edited. Write a new migration instead.`);
    }
    expect(problems).toEqual([]);
  });
});

describe('every newer migration only adds', () => {
  const fresh = files.filter((f) => !(f in BASELINE_MIGRATIONS));

  it('(there may be none yet)', () => {
    expect(fresh.length).toBeGreaterThanOrEqual(0);
  });

  it('is CREATE, or ADD COLUMN that is nullable or has a constant default', () => {
    const problems: string[] = [];
    for (const f of fresh) {
      if (f in EXCEPTIONS) continue;
      for (const why of judgeMigration(readFileSync(`${DIR}${f}`, 'utf8')))
        problems.push(`${f}: ${why}`);
    }
    expect(problems).toEqual([]);
  });

  it('lists an exception only for a file that exists, is new, and says why', () => {
    for (const [name, reason] of Object.entries(EXCEPTIONS)) {
      expect(files, `${name} does not exist`).toContain(name);
      expect(name in BASELINE_MIGRATIONS, `${name} is not new`).toBe(false);
      expect(reason.trim().length, `${name} has no reason`).toBeGreaterThan(20);
    }
  });
});

describe('the rules themselves', () => {
  const fails = (sql: string) => judgeMigration(sql).length > 0;

  it('allow what an additive migration is made of', () => {
    expect(fails('CREATE TABLE t (id int);')).toBe(false);
    expect(fails('CREATE TABLE IF NOT EXISTS t (id int); CREATE INDEX i ON t (id);')).toBe(false);
    expect(fails('CREATE UNIQUE INDEX i ON t (id) WHERE id > 0;')).toBe(false);
    expect(fails("CREATE TYPE mood AS ENUM ('a', 'b');")).toBe(false);
    expect(fails('ALTER TABLE t ADD COLUMN note text;')).toBe(false);
    expect(fails('ALTER TABLE t ADD COLUMN IF NOT EXISTS note text REFERENCES u (id);')).toBe(
      false,
    );
    expect(fails('ALTER TABLE t ADD COLUMN n integer NOT NULL DEFAULT 0;')).toBe(false);
    expect(fails("ALTER TABLE t ADD COLUMN r text[] NOT NULL DEFAULT '{}';")).toBe(false);
    expect(fails("ALTER TABLE t ADD COLUMN s text NOT NULL DEFAULT 'a, b';")).toBe(false);
    expect(fails("ALTER TABLE t ADD COLUMN j jsonb NOT NULL DEFAULT '[]'::jsonb;")).toBe(false);
    expect(
      fails('ALTER TABLE t ADD COLUMN a boolean NOT NULL DEFAULT false, ADD COLUMN b text;'),
    ).toBe(false);
    expect(
      fails('CREATE TABLE s (id boolean PRIMARY KEY); INSERT INTO s (id) VALUES (true);'),
    ).toBe(false);
    expect(fails('COMMENT ON TABLE t IS $$ it is UPDATE and DELETE $$;')).toBe(false);
  });

  it('allow a function or trigger whose body updates, because a body is a definition', () => {
    const sql = `
      CREATE FUNCTION guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        UPDATE other SET x = 1; DELETE FROM other; -- not run now
        RETURN NEW;
      END;
      $fn$;
      CREATE TRIGGER g BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION guard();`;
    expect(splitStatements(sql)).toHaveLength(2);
    expect(judgeMigration(sql)).toEqual([]);
  });

  it('ignore what is only in a comment or a string', () => {
    expect(
      fails(
        "-- DROP TABLE t;\n/* UPDATE t SET a = 1; /* nested */ DELETE FROM t; */ CREATE TABLE a (x text DEFAULT 'DROP; UPDATE');",
      ),
    ).toBe(false);
    expect(fails("CREATE TABLE a (x text DEFAULT E'it\\'s; DELETE FROM t');")).toBe(false);
  });

  it('refuse everything that changes what is there', () => {
    for (const sql of [
      'INSERT INTO t VALUES (1);',
      'UPDATE t SET a = 1;',
      'DELETE FROM t;',
      'DROP TABLE t;',
      'DROP INDEX i;',
      'TRUNCATE t;',
      'ALTER TABLE t RENAME TO u;',
      'ALTER TABLE t RENAME COLUMN a TO b;',
      'ALTER TABLE t ALTER COLUMN a TYPE bigint;',
      'ALTER TABLE t ALTER COLUMN a SET NOT NULL;',
      'ALTER TABLE t DROP COLUMN a;',
      'ALTER TABLE t ADD COLUMN a int, DROP COLUMN b;',
      'ALTER TABLE t ADD CONSTRAINT c CHECK (a > 0);',
      'ALTER TABLE t ADD FOREIGN KEY (a) REFERENCES u (id);',
      'ALTER TABLE t ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE t DISABLE TRIGGER ALL;',
      "ALTER TYPE mood ADD VALUE 'c';",
      'ALTER INDEX i RENAME TO j;',
      'DO $$ BEGIN UPDATE t SET a = 1; END $$;',
      "CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';",
      'CREATE VIEW v AS SELECT 1;',
      'GRANT ALL ON t TO PUBLIC;',
      "SELECT setval('s', 1);",
    ]) {
      expect(fails(sql), sql).toBe(true);
    }
  });

  it('refuse a new column that would rewrite or fail on the rows already there', () => {
    expect(fails('ALTER TABLE t ADD COLUMN a int NOT NULL;')).toBe(true);
    expect(fails('ALTER TABLE t ADD COLUMN a timestamptz NOT NULL DEFAULT now();')).toBe(true);
    expect(fails('ALTER TABLE t ADD COLUMN a timestamptz DEFAULT now();')).toBe(true);
    expect(fails('ALTER TABLE t ADD COLUMN a uuid NOT NULL DEFAULT gen_random_uuid();')).toBe(true);
    expect(fails('ALTER TABLE t ADD COLUMN a int GENERATED ALWAYS AS (b + 1) STORED;')).toBe(true);
    // An insert is allowed only into a table this same file made.
    expect(fails('INSERT INTO s (id) VALUES (true); CREATE TABLE s (id boolean);')).toBe(true);
    // A statement hidden after a harmless one is still found.
    expect(fails('CREATE TABLE a (x int); UPDATE a SET x = 1;')).toBe(true);
  });

  it('read a constant default correctly', () => {
    for (const ok of [
      '0',
      '-1',
      '1.5',
      "'a'",
      "'it''s'",
      'true',
      'FALSE',
      'null',
      "'{}'::text[]",
      "'[]'::jsonb",
      "('x')",
    ])
      expect(isConstantDefault(ok), ok).toBe(true);
    for (const bad of ['now()', 'gen_random_uuid()', "nextval('s')", '1 + 1', 'current_date'])
      expect(isConstantDefault(bad), bad).toBe(false);
  });
});
