/**
 * Reset somebody's second factor from the server: the way back in for the
 * owner, whose own nobody else may reset (plan E, E3).
 *
 *   sudo reportlog reset-2fa <email>
 *   node src/identity/reset-two-factor.ts <email>
 *
 * Clears their authenticator app, passkeys and recovery codes, and signs
 * them out everywhere; their next sign-in sets a factor up again, after the
 * emailed code. Recorded in role_audit like the owner's reset from the
 * Access screen, with the server as the one who did it. Works for anybody,
 * not only the owner: whoever can run this already holds the server.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { SERVER_ACTOR, resetSecondFactor } from './secondFactor.ts';
import { looksLikeEmail, normalizeEmail } from './secrets.ts';

const email = normalizeEmail(process.argv[2]);
if (!looksLikeEmail(email)) {
  process.stderr.write('Usage: reportlog reset-2fa <email address>\n');
  process.exit(64);
}

const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  const user = await db
    .selectFrom('users')
    .select(['id', 'email'])
    .where('email', '=', email)
    .executeTakeFirst();
  if (!user) {
    process.stderr.write(`Nobody with the address ${email} has an account here.\n`);
    process.exitCode = 1;
  } else {
    await resetSecondFactor(db, user, SERVER_ACTOR, 'on the server');
    process.stderr.write(
      `${email}'s second factor is reset and they are signed out everywhere. ` +
        'Their next sign-in, after the emailed code, sets a new one up.\n',
    );
  }
} finally {
  await db.destroy();
}
