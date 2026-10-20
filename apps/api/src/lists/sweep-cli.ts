/**
 * The list sweep, as a command for a timer: erases the personal half of every
 * expired entry, destroys old address-hashing secrets, and removes spent and
 * expired links. Prints what it did, one line per table, and exits non-zero if
 * any step failed.
 *
 *   pnpm --filter @reportlog/api lists:sweep
 *
 * The operations workstream schedules it (daily is enough; the sweep is
 * idempotent). It is not the credentials sweep, which deletes rows: this one
 * erases columns and leaves every row standing.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { sweepLists } from './sweep.ts';

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL, 2);
try {
  const out = await sweepLists(db);
  let failed = false;
  for (const [table, result] of Object.entries(out)) {
    if (typeof result === 'number') {
      process.stdout.write(`${table}: ${String(result)}\n`);
    } else {
      failed = true;
      process.stdout.write(`${table}: FAILED, ${result.error}\n`);
    }
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await db.destroy();
}
