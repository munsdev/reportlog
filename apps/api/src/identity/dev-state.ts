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
 *   node src/identity/dev-state.ts digest-for <email>
 *       Subscribe the address to hourly digests, approve the newest report
 *       that may be published, and run the hourly digest, so the email
 *       lands in MAIL_OUTBOX with its stop link (workstream A2).
 *   node src/identity/dev-state.ts subscription <email>
 *       Print how often the address hears about reports: hourly, weekly or
 *       none. How a browser test checks that opening a link changed nothing.
 *
 * Refuses to run in production. It rewrites who holds a role.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { sql } from 'kysely';
import { outboxMailer } from '../email/mailer.ts';
import { runDigest } from '../site/digest.ts';
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
  } else if (mode === 'digest-for' && password) {
    const outbox = process.env.MAIL_OUTBOX;
    if (!outbox) throw new Error('digest-for needs MAIL_OUTBOX: where the email is written.');
    const user = await db
      .insertInto('users')
      .values({ email: password.toLowerCase() })
      .onConflict((oc) => oc.column('email').doUpdateSet({ updated_at: new Date() }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('digest_subscriptions')
      .values({ user_id: user.id, frequency: 'hourly', logbooks: null })
      .onConflict((oc) =>
        oc
          .column('user_id')
          .doUpdateSet({ frequency: 'hourly', logbooks: null, last_sent_at: null }),
      )
      .execute();
    const head = await db
      .selectFrom('report_heads as h')
      .innerJoin('reports as r', 'r.id', 'h.current_report_id')
      .select('h.thread_id')
      .where('r.may_publish', '=', true)
      .where('h.withdrawn', '=', false)
      .orderBy('r.id', 'desc')
      .executeTakeFirstOrThrow();
    // Two minutes ago: a run stops a minute behind the clock (SETTLE_MS).
    await db
      .updateTable('report_heads')
      .set({ moderation_status: 'valid', updated_at: sql<Date>`now() - interval '2 minutes'` })
      .where('thread_id', '=', head.thread_id)
      .execute();
    await runDigest({
      db,
      mailer: outboxMailer(outbox),
      siteOrigin: loadConfig().SITE_ORIGIN ?? 'http://127.0.0.1:4173',
      log: () => undefined,
      frequency: 'hourly',
    });
  } else if (mode === 'subscription' && password) {
    const row = await db
      .selectFrom('digest_subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('s.frequency')
      .where('u.email', '=', password.toLowerCase())
      .executeTakeFirst();
    process.stdout.write(`${row?.frequency ?? 'none'}\n`);
  } else {
    throw new Error(
      'Usage: dev-state.ts set-up | fresh-install <password> | seat <email> <role> | digest-for <email> | subscription <email>',
    );
  }
} finally {
  await db.destroy();
}
