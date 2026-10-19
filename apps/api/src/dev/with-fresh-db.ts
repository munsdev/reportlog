/**
 * Run a command against a database that exists only for that run.
 *
 *   node src/dev/with-fresh-db.ts -- <command> [args...]
 *
 * Creates a database beside the one TEST_DATABASE_URL (or DATABASE_URL)
 * names, migrates it, runs the command with DATABASE_URL pointing at it,
 * and drops it afterwards, whatever the command did.
 *
 * WHY THE BROWSER SUITE NEEDS THIS. The archive never deletes a launched
 * logbook, by design, and every browser run launches some. Against one
 * long-lived development database they pile up until something with a
 * real limit (the front page carries at most fifty buttons) starts failing
 * for a reason that has nothing to do with the code under test. CI never
 * sees it, because CI starts empty. Now neither does anybody else.
 */
import { spawnSync } from 'node:child_process';
import { migrate } from '../db/migrate.ts';
import { createThrowawayDatabase } from '../db/throwaway.ts';

const dash = process.argv.indexOf('--');
const [command, ...args] = dash === -1 ? [] : process.argv.slice(dash + 1);
if (!command) throw new Error('Usage: with-fresh-db.ts -- <command> [args...]');
if (process.env.NODE_ENV === 'production')
  throw new Error('with-fresh-db does not run in production.');

const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!base)
  throw new Error(
    'Set TEST_DATABASE_URL (or DATABASE_URL) to the server to create the database on.',
  );

const db = await createThrowawayDatabase(base, 'e2e');
let status = 1;
try {
  await migrate(db.url);
  const run = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: db.url },
  });
  status = run.status ?? 1;
} finally {
  await db.drop();
}
process.exit(status);
