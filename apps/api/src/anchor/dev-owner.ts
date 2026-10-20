/**
 * Hand the owner's seat to an address and back, for ONE browser test: the
 * owner's backups and exports screen (apps/web/e2e/owner/), which nobody but
 * the owner may open.
 *
 *   node src/anchor/dev-owner.ts take <email>
 *       Seat <email> as the owner. Whoever held the seat sits as an
 *       administrator meanwhile. Prints their address, or "-" for nobody.
 *   node src/anchor/dev-owner.ts give-back <previous|-> <email>
 *       <email> goes back to no role, and the seat to <previous>.
 *
 * A fixture, not a way to grant anything: it writes the table directly, as
 * identity's dev-state.ts does for the other roles, and no grant in
 * @reportlog/access can produce an owner. Refuses to run in production.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-owner does not run in production.');
}

const [mode, first, second] = process.argv.slice(2);
const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  if (mode === 'take' && first) {
    const email = first.toLowerCase();
    const previous = await db.transaction().execute(async (trx) => {
      const held = await trx
        .selectFrom('users')
        .select('email')
        .where('role', '=', 'owner')
        .executeTakeFirst();
      // One owner, by a unique index: the seat is emptied before it is filled.
      await trx.updateTable('users').set({ role: 'admin' }).where('role', '=', 'owner').execute();
      await trx
        .insertInto('users')
        .values({ email, role: 'owner' })
        .onConflict((oc) => oc.column('email').doUpdateSet({ role: 'owner' }))
        .execute();
      return held?.email ?? '-';
    });
    process.stdout.write(`${previous}\n`);
  } else if (mode === 'give-back' && first && second) {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ role: 'user' })
        .where('email', '=', second.toLowerCase())
        .execute();
      if (first !== '-') {
        await trx.updateTable('users').set({ role: 'owner' }).where('email', '=', first).execute();
      }
    });
  } else {
    throw new Error('Usage: dev-owner.ts take <email> | give-back <previous|-> <email>');
  }
} finally {
  await db.destroy();
}
