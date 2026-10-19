/**
 * Put the identity tables in a known state, for the browser tests.
 *
 *   node src/identity/dev-state.ts set-up
 *       Setup finished and the site password off: what the rest of the
 *       browser suite expects, so the wizard does not take over its pages.
 *   node src/identity/dev-state.ts fresh-install <password>
 *       As an installer leaves a deployment: nobody holds the owner's or an
 *       administrator's seat, setup not finished, and the given password on.
 *   node src/identity/dev-state.ts seat <email> <role>
 *       Give an address a role other than owner, creating the account if it
 *       has none: how the browser suite makes the administrator its staff
 *       screens are tested as. The owner's seat is never handed out here.
 *
 * Refuses to run in production. It rewrites who holds a role.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { writeSiteAccess } from './siteAccess.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-state does not run in production.');
}

const [mode, password, role] = process.argv.slice(2);
const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  if (mode === 'set-up') {
    await db
      .updateTable('site_access')
      .set({ enabled: false, setup_completed_at: new Date() })
      .where('id', '=', true)
      .execute();
  } else if (mode === 'fresh-install' && password) {
    await db.deleteFrom('ownership_transfers').execute();
    await db
      .updateTable('users')
      .set({ role: 'user' })
      .where('role', 'in', ['owner', 'admin'])
      .execute();
    await db.updateTable('logbooks').set({ outside_access: 'closed' }).execute();
    await db
      .updateTable('site_access')
      .set({ setup_completed_at: null })
      .where('id', '=', true)
      .execute();
    await writeSiteAccess(db, { password });
  } else if (mode === 'seat' && password && role && role !== 'owner') {
    // `password` is the address in this mode: the arguments are positional.
    await db
      .insertInto('users')
      .values({ email: password.toLowerCase(), role })
      .onConflict((oc) => oc.column('email').doUpdateSet({ role }))
      .execute();
  } else {
    throw new Error('Usage: dev-state.ts set-up | fresh-install <password> | seat <email> <role>');
  }
} finally {
  await db.destroy();
}
