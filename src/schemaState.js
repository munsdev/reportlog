/**
 * Which migrations this database has actually run, against which the
 * checkout carries.
 *
 * WHY THIS EXISTS, and it is a real story rather than a tidy feature: a
 * deployment installed from `stable` on 10 October and the operator could
 * not tell whether the thing he had just built was on it. The commit hash
 * did not answer that, and the commit hash is what every version display
 * in this application shows.
 *
 * THE COMMIT AND THE SCHEMA ARE TWO DIFFERENT ANSWERS and they come apart
 * in the one direction that matters. `git pull` moves the checkout.
 * `npm run migrate` moves the database. A deploy that did the first and not
 * the second runs new code against an old schema — every feature in the new
 * code is simply absent, the version display says the new commit, and
 * nothing reports a fault. That is invisible, and it is what this makes
 * visible.
 *
 * Read-only, and it names no table but its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations',
);

/** Every migration file in this checkout, in the order migrate.js runs them. */
export function migrationFiles(dir = MIGRATIONS_DIR) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
}

/**
 * Compare the two.
 *
 * `pending` is the list that matters: files the checkout has and the
 * database has not run. `unknown` is the other direction — rows the
 * database has that this checkout does not carry, which means the checkout
 * is OLDER than the database and a downgrade has happened. Both are faults
 * and they are different faults, so they are named separately rather than
 * summed into "out of step".
 */
export async function schemaState({ client = pool, dir = MIGRATIONS_DIR } = {}) {
  const onDisk = migrationFiles(dir);
  let applied = [];
  try {
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    applied = rows.map((r) => r.filename);
  } catch {
    // No schema_migrations means nothing has ever been migrated here — a
    // real state on a fresh database, and not an error to hide.
    return {
      reachable: false,
      onDisk: onDisk.length,
      applied: 0,
      newest: null,
      pending: onDisk,
      unknown: [],
    };
  }

  const appliedSet = new Set(applied);
  const diskSet = new Set(onDisk);
  const pending = onDisk.filter((f) => !appliedSet.has(f));
  const unknown = applied.filter((f) => !diskSet.has(f)).sort();

  return {
    reachable: true,
    onDisk: onDisk.length,
    applied: applied.length,
    // The newest one the database has actually run, which is the honest
    // answer to "what shape is this archive in".
    newest: [...applied].sort().pop() || null,
    pending,
    unknown,
  };
}
