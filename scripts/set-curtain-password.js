/**
 * Set the curtain password. The step of the install that makes the
 * deployment reachable at all.
 *
 *   npm run set-curtain-password
 *
 * WHY THIS EXISTS: a fresh install comes up gated, with no password set.
 * No password matches a null hash, so nobody can lift the curtain — and
 * /api/auth is behind the curtain, so nobody can sign in to set one. The
 * install is locked out of itself. Every route that could fix it is on the
 * wrong side of the thing that needs fixing.
 *
 * This is the way in, and it needs a shell on the box, which is the right
 * requirement: whoever is installing has one, and nobody else does.
 *
 * THE SOFTWARE NEVER GENERATES A PASSWORD. Not on an empty answer, not as a
 * convenience, not ever. A generated credential is one nobody chose and
 * nobody read carefully, and it would be the password protecting a
 * deployment before it has anything else protecting it. Pressing enter
 * without typing gets the prompt again.
 *
 * It refuses to finish without one, which is the whole of the defence
 * behind putting the setup wizard on the curtain and nothing else.
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { sha256Hex } from '../src/crypto.js';
import { validateCurtainPassword, setupState } from '../src/setup.js';
import { askHidden, interactive, closePrompt } from '../src/prompt.js';

const state = await setupState();

console.log('\nReportLog — set the curtain password\n');
console.log('This is the password that keeps the deployment off the open internet.');
console.log('It is shared casually with whoever is testing, and changed freely. It is');
console.log('not the administrator sign-in, and it is not what protects the archive.\n');

if (state.hasAdmin || state.completedAt) {
  console.log('This deployment has already been set up. Changing the password here is');
  console.log('a recovery path; an administrator can also change it from Settings.\n');
}

// Piped input reads one line and is not asked to confirm it. A pipe cannot
// mistype, the second read would block forever on a stream that has already
// ended, and it is still a password somebody chose — it just was not typed
// at this prompt. This is how a configuration-management tool drives it.
let password = null;
if (!interactive()) {
  const check = validateCurtainPassword(await askHidden('Password'));
  if (!check.ok) {
    console.error(`\n${check.error}. Nothing was changed.\n`);
    await pool.end();
    process.exit(1);
  }
  password = check.password;
} else {
  for (let attempt = 0; attempt < 3 && !password; attempt += 1) {
    const first = await askHidden('Password');
    const check = validateCurtainPassword(first);
    if (!check.ok) { console.log(`  ${check.error}.\n`); continue; }
    const second = await askHidden('Again   ');
    if (first !== second) { console.log('  Those do not match.\n'); continue; }
    password = check.password;
  }
}

closePrompt();

if (!password) {
  console.error('\nNo password set. The deployment is still unreachable — run this again.\n');
  await pool.end();
  process.exit(1);
}

await pool.query(
  `INSERT INTO site_settings (id, access_enabled, access_password_hash)
   VALUES (true, true, $1)
   ON CONFLICT (id) DO UPDATE
     SET access_password_hash = $1, access_enabled = true, updated_at = now()`,
  [sha256Hex(password)],
);

// Existing curtain tokens are deliberately left alone on a fresh install
// (there are none) and deliberately cleared on a reset: if this is being
// run because the password leaked, a change that leaves every issued
// cookie working has not changed anything.
if (state.hasAdmin || state.completedAt) {
  const { rowCount } = await pool.query('DELETE FROM site_access_tokens');
  console.log(`\nSet. ${rowCount} existing session(s) behind the curtain were ended.`);
} else {
  console.log('\nSet. The deployment is gated and this password lifts it.');
}

const after = await setupState();
if (after.needed) {
  console.log('\nNext: open the site, enter this password, and the setup wizard will');
  console.log('ask for the administrator account. Hand over the URL and this password.\n');
} else {
  console.log('');
}

await pool.end();
