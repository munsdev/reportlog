/**
 * The machinery of the upgrade test (test/db/upgrade.test.ts), shared with
 * the one place that writes its data down (test/db/upgrade-fixture.build.ts).
 *
 *   baseline     a database migrated with ONLY the files in
 *                BASELINE_MIGRATIONS: the schema as it was on main on
 *                27 October 2026.
 *   rows         every table's rows as JSON, written once on that schema and
 *                loaded back into a fresh baseline database as data. Not
 *                re-created by running today's code, because today's code
 *                will one day need tables the baseline does not have.
 *   snapshot     what must not change: every row of every table, and what
 *                the running application says about them.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.ts';
import { BASELINE_MIGRATIONS } from './baseline-migrations.ts';

export const UPGRADE_DATA_DIR = new URL('../upgrade/', import.meta.url);

/** Migrate to the baseline and no further. The files are copied so their text, and so their checksums, are the real ones. */
export async function migrateToBaseline(url: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'rl-baseline-'));
  for (const name of Object.keys(BASELINE_MIGRATIONS)) {
    await copyFile(join(MIGRATIONS_DIR, name), join(dir, name));
  }
  await migrate(url, dir);
}

export type RowSet = Record<string, Record<string, unknown>[]>;

export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function tableNames(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'
      ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

/**
 * Every row of every table, as JSON, in a stable order. Ordered by the whole
 * row's text so a table without an id sorts the same way every time.
 */
export async function dumpRows(url: string): Promise<RowSet> {
  return withClient(url, async (c) => {
    const out: RowSet = {};
    for (const t of await tableNames(c)) {
      const { rows } = await c.query<{ j: Record<string, unknown> }>(
        `SELECT to_jsonb(t) AS j FROM "${t}" t ORDER BY to_jsonb(t)::text`,
      );
      out[t] = rows.map((r) => r.j);
    }
    return out;
  });
}

/** Tables in the order their foreign keys allow rows to be inserted. */
async function insertionOrder(c: pg.Client, names: string[]): Promise<string[]> {
  const { rows } = await c.query<{ child: string; parent: string }>(
    `SELECT cl.relname AS child, pl.relname AS parent
       FROM pg_constraint k
       JOIN pg_class cl ON cl.oid = k.conrelid
       JOIN pg_class pl ON pl.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE k.contype = 'f' AND n.nspname = 'public' AND cl.relname <> pl.relname`,
  );
  const before = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]));
  for (const r of rows) before.get(r.child)?.add(r.parent);
  // Not a foreign key, but a rule: a report is accepted only by a launched
  // logbook, and a logbook is launched only once its questions are in.
  before.get('reports')?.add('logbook_fields');
  const order: string[] = [];
  const placed = new Set<string>();
  while (order.length < names.length) {
    const next = names.filter(
      (n) => !placed.has(n) && [...(before.get(n) ?? [])].every((p) => placed.has(p)),
    );
    if (!next.length) throw new Error('the foreign keys form a cycle; teach insertionOrder');
    for (const n of next) {
      placed.add(n);
      order.push(n);
    }
  }
  return order;
}

/**
 * Put rows into a database migrated to the baseline. Rows that migrations
 * themselves create (the single settings rows) are already there and are left.
 *
 * A LAUNCHED LOGBOOK IS INSERTED UNLAUNCHED AND LAUNCHED AT THE END, the way
 * it came to exist: the database refuses a question added to a launched
 * logbook, and that guard is not to be bypassed to load a fixture.
 */
export async function loadRows(url: string, rows: RowSet): Promise<void> {
  await withClient(url, async (c) => {
    const names = Object.keys(rows);
    for (const t of await insertionOrder(c, names)) {
      // In id order: the database checks each report against the one before it.
      const data = [...(rows[t] ?? [])].sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
      if (!data.length) continue;
      const { rows: cols } = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
            AND is_generated = 'NEVER' ORDER BY ordinal_position`,
        [t],
      );
      // A row the migrations made themselves (the one settings row each
      // settings table starts with) takes the values the fixture recorded.
      const { rows: pk } = await c.query<{ column_name: string }>(
        `SELECT a.attname AS column_name FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
          WHERE i.indrelid = format('%I', $1::text)::regclass AND i.indisprimary`,
        [t],
      );
      const keyNames = pk.map((x) => x.column_name);
      const others = cols.map((x) => x.column_name).filter((n) => !keyNames.includes(n));
      const conflict =
        keyNames.length && others.length
          ? `ON CONFLICT (${keyNames.map((n) => `"${n}"`).join(', ')}) DO UPDATE SET ${others
              .map((n) => `"${n}" = EXCLUDED."${n}"`)
              .join(', ')}`
          : 'ON CONFLICT DO NOTHING';
      const list = cols.map((x) => `"${x.column_name}"`).join(', ');
      const patched = t === 'logbooks' ? data.map((r) => ({ ...r, launched_at: null })) : data;
      await c.query(
        `INSERT INTO "${t}" (${list}) OVERRIDING SYSTEM VALUE
         SELECT ${list} FROM jsonb_populate_recordset(null::"${t}", $1::jsonb)
         ${conflict}`,
        [JSON.stringify(patched)],
      );
      // Questions are in: now the logbooks may be launched, and take reports.
      if (t === 'logbook_fields') {
        for (const r of rows.logbooks ?? []) {
          if (r.launched_at) {
            await c.query('UPDATE logbooks SET launched_at = $2 WHERE id = $1', [
              r.id,
              r.launched_at,
            ]);
          }
        }
      }
    }
    // Sequences carry on from the rows that were loaded.
    const { rows: seqs } = await c.query<{ t: string; col: string; seq: string }>(
      `SELECT c.relname AS t, a.attname AS col, pg_get_serial_sequence(format('%I', c.relname), a.attname) AS seq
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
          AND pg_get_serial_sequence(format('%I', c.relname), a.attname) IS NOT NULL`,
    );
    for (const s of seqs) {
      await c.query(
        `SELECT setval($1, GREATEST((SELECT COALESCE(MAX("${s.col}"), 0) FROM "${s.t}"), 1))`,
        [s.seq],
      );
    }
  });
}

/**
 * `before` rows against `after` rows: nothing that was there may differ. A
 * column the migrations added is allowed (it is not in `before`); a row may
 * not appear, vanish or change in any column that existed.
 */
export function changesTo(before: RowSet, after: RowSet): string[] {
  const out: string[] = [];
  for (const [table, was] of Object.entries(before)) {
    const now = after[table];
    if (!now) {
      out.push(`${table}: table is gone`);
      continue;
    }
    if (now.length !== was.length)
      out.push(`${table}: ${String(was.length)} rows became ${String(now.length)}`);
    const keep = (row: Record<string, unknown>, like: Record<string, unknown>) =>
      JSON.stringify(
        Object.fromEntries(
          Object.keys(like)
            .sort()
            .map((k) => [k, row[k] ?? null]),
        ),
      );
    const nowByWhole = new Map<string, number>();
    for (const row of now) {
      const k = keep(row, was[0] ?? row);
      nowByWhole.set(k, (nowByWhole.get(k) ?? 0) + 1);
    }
    for (const row of was) {
      const k = keep(row, row);
      const left = nowByWhole.get(k) ?? 0;
      if (left === 0) out.push(`${table}: a row changed or went: ${k.slice(0, 200)}`);
      else nowByWhole.set(k, left - 1);
    }
  }
  return out;
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
