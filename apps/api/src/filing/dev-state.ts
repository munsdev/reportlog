/**
 * Put filing's corner of the database in a known state, for the browser tests.
 *
 *   node src/filing/dev-state.ts outside <slug> <closed|link|door>
 *       Whether a logbook may be filed to from outside the site password.
 *   node src/filing/dev-state.ts curtain <password>
 *       Turn the site password on, with this password. `identity/dev-state.ts
 *       set-up` turns it off again.
 *
 * Refuses to run in production: it opens and closes doors.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { OUTSIDE_ACCESS, setOutsideAccess } from '../identity/doors.ts';
import type { OutsideAccess } from '../identity/doors.ts';
import { writeSiteAccess } from '../identity/siteAccess.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-state does not run in production.');
}

const [mode, a, b] = process.argv.slice(2);
const isAccess = (v: string | undefined): v is OutsideAccess =>
  (OUTSIDE_ACCESS as readonly string[]).includes(v ?? '');

const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  if (mode === 'outside' && a && isAccess(b)) {
    if (!(await setOutsideAccess(db, a, b))) throw new Error(`There is no logbook "${a}".`);
  } else if (mode === 'curtain' && a) {
    await writeSiteAccess(db, { password: a });
  } else {
    throw new Error('Usage: dev-state.ts outside <slug> <closed|link|door> | curtain <password>');
  }
} finally {
  await db.destroy();
}
