/**
 * Put filing's corner of the database in a known state, for the browser tests.
 *
 *   node src/filing/dev-state.ts outside <slug> <closed|link|door>
 *       Whether a logbook may be filed to from outside the site password.
 *   node src/filing/dev-state.ts curtain <password>
 *       Turn the site password on, with this password. `identity/dev-state.ts
 *       set-up` turns it off again.
 *   node src/filing/dev-state.ts coordinator <email> <organization>
 *       A coordinator of that organization (both made if missing).
 *   node src/filing/dev-state.ts intake-logbook <slug> <title>
 *       A launched logbook asking one required and one optional question.
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
const USAGE =
  'Usage: dev-state.ts outside <slug> <closed|link|door> | curtain <password> | ' +
  'coordinator <email> <organization> | intake-logbook <slug> <title>';
const isAccess = (v: string | undefined): v is OutsideAccess =>
  (OUTSIDE_ACCESS as readonly string[]).includes(v ?? '');

const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  if (mode === 'outside' && a && isAccess(b)) {
    if (!(await setOutsideAccess(db, a, b))) throw new Error(`There is no logbook "${a}".`);
  } else if (mode === 'curtain' && a) {
    await writeSiteAccess(db, { password: a });
  } else if (mode === 'coordinator' && a && b) {
    const email = a.trim().toLowerCase();
    await db
      .insertInto('users')
      .values({ email })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db
      .insertInto('organizations')
      .values({ name: b, verified_by: 'dev-state' })
      .onConflict((oc) => oc.doNothing())
      .execute();
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    const org = await db
      .selectFrom('organizations')
      .select('id')
      .where('name', '=', b)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('organization_memberships')
      .values({ organization_id: org.id, user_id: user.id, role: 'coordinator' })
      .onConflict((oc) => oc.doNothing())
      .execute();
  } else if (mode === 'intake-logbook' && a && b) {
    const lb = await db
      .insertInto('logbooks')
      .values({ slug: a, title: b, blurb: 'Made for a browser test.' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('logbook_fields')
      .values([
        {
          logbook_id: lb.id,
          key: 'what',
          kind: 'long_text',
          label: 'What happened?',
          required: true,
          settings: '{}',
          position: 0,
        },
        {
          logbook_id: lb.id,
          key: 'where',
          kind: 'short_text',
          label: 'Where was it?',
          required: false,
          settings: '{}',
          position: 1,
        },
      ])
      .execute();
    await db
      .updateTable('logbooks')
      .set({ launched_at: new Date() })
      .where('id', '=', lb.id)
      .execute();
  } else {
    throw new Error(USAGE);
  }
} finally {
  await db.destroy();
}
