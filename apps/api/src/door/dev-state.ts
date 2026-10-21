/**
 * Put the door's settings in a known state, for the browser tests.
 *
 *   node src/door/dev-state.ts min-form <seconds>
 *       The minimum time a form must be open before it is sent. The suite
 *       sets 0: a script fills in a one-card form faster than any person, and
 *       the minimum is tested where its clock can be set (test/db/door.test.ts).
 *
 * Refuses to run in production.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { writeDoorSettings } from './settings.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-state does not run in production.');
}

const [mode, a] = process.argv.slice(2);
const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  if (mode === 'min-form' && a && /^\d{1,3}$/.test(a)) {
    await writeDoorSettings(db, { minFormMs: Number(a) * 1000 });
  } else {
    throw new Error('Usage: dev-state.ts min-form <seconds>');
  }
} finally {
  await db.destroy();
}
