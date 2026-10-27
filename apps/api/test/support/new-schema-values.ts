/**
 * Whatever the free-text work stored in the tables and columns it added.
 *
 * "Added" means not in BASELINE_SCHEMA, so a table or column that arrives in
 * a later migration is covered the day it exists, without anybody listing it.
 * The public sweep asks every public page for each value found here.
 *
 * What is looked at: text, varchar, json/jsonb and arrays of text (every
 * string inside), and bytea (in hex and in base64, the two ways a byte string
 * is written into a page). What is skipped, because it cannot be a typed
 * answer and would only produce false alarms: short values, bare words of
 * lower case letters (a status), UUIDs, timestamps and plain numbers.
 */
import { withClient } from './upgrade.ts';
import { BASELINE_SCHEMA } from './baseline-schema.ts';

/**
 * Columns whose values are MEANT to be on a public page, as `table.column`,
 * each with the reason. Adding to it is a decision a reviewer should see,
 * which is why it is a list in a file and not a flag.
 */
export const MEANT_TO_BE_PUBLIC: Readonly<Record<string, string>> = {
  'site_bundle_backups.snapshot':
    "A copy of the site's own wording, pages and look, kept before an import so the owner can put them back: the same values the public pages show. It holds nothing anybody filed.",
};

export interface Found {
  where: string;
  value: string;
}

const TEXTUAL = new Set([
  'text',
  'character varying',
  'json',
  'jsonb',
  'ARRAY',
  'bytea',
  'USER-DEFINED',
]);

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

const worthChecking = (s: string): boolean =>
  s.length >= 12 &&
  !/^[a-z_]+$/.test(s) &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) &&
  !/^\d{4}-\d\d-\d\d([ T][\d:.+Z-]+)?$/.test(s) &&
  !/^[\d.,-]+$/.test(s);

/** `baseline` is a parameter so the machinery can be tried against a table that does exist. */
export async function valuesInNewSchema(
  url: string,
  baseline: Readonly<Record<string, readonly string[]>> = BASELINE_SCHEMA,
): Promise<Found[]> {
  return withClient(url, async (c) => {
    const { rows: cols } = await c.query<{ t: string; c: string; type: string }>(
      `SELECT table_name AS t, column_name AS c, data_type AS type
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
        ORDER BY 1, ordinal_position`,
    );
    const found: Found[] = [];
    for (const { t, c: col, type } of cols) {
      if (baseline[t]?.includes(col)) continue;
      if (`${t}.${col}` in MEANT_TO_BE_PUBLIC || !TEXTUAL.has(type)) continue;
      const where = `${t}.${col}`;
      if (type === 'bytea') {
        const { rows } = await c.query<{ v: Buffer }>(
          `SELECT "${col}" AS v FROM "${t}" WHERE "${col}" IS NOT NULL`,
        );
        for (const r of rows) {
          for (const form of [
            r.v.toString('hex'),
            r.v.toString('base64'),
            r.v.toString('base64url'),
          ])
            if (worthChecking(form)) found.push({ where, value: form });
        }
        continue;
      }
      const { rows } = await c.query<{ v: unknown }>(
        `SELECT to_jsonb("${col}") AS v FROM "${t}" WHERE "${col}" IS NOT NULL`,
      );
      for (const r of rows)
        for (const s of strings(r.v)) if (worthChecking(s)) found.push({ where, value: s });
    }
    return found;
  });
}
